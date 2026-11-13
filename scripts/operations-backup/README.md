# Lalia backup and isolated restore

Installed with explicit owner approval on November 11, 2026. The first encrypted S3 backup completed at 23:13:24 UTC; an isolated PostgreSQL 16 restore verified 58 tables, 104 constraints (none unvalidated), and one uploaded file. Downloaded restore inputs and the temporary cluster were removed. The daily backup and hourly freshness timers are enabled. Sanitized evidence, installed-file hashes, and verification commands are recorded in [the backup/restore evidence](../../docs/launch/evidence/2026-11-11-backup-restore.json). Stripe remains TEST and was not changed.

## Design and boundaries

- PostgreSQL 16 custom dump and table counts/constraint definitions share an exported repeatable-read snapshot. Production queries are read-only. Credentials are parsed quietly from backend `.env`, passed to `pg_dump` through its environment, never command-line arguments or logs.
- Local uploads are inventoried before/after archival. The approved deployment upload-root alias is canonicalized; nested symlinks, special files and `.env` files cause failure. Only the upload directory is archived. A cross-resource atomic snapshot is not provided: avoid concurrent attachment deletion for the initial drill; later backups capture the database snapshot and the subsequently stabilized uploads. Database and uploads are both verified on restore, but this does not prove application-level attachment references.
- Artifacts use SHA256; S3 verifies upload checksums. Manifest uploads last and marks a complete run. Private temporary files are removed on success/failure. The systemd private temp namespace and 30-minute service deadline bound abandoned work. Each child command has a 5-minute timeout with TERM then KILL; DB statements have 5-minute timeouts.
- EC2 role only permits encrypted `PutObject` beneath `lalia/daily/`. It cannot list, read, delete or change retention. No AWS CLI or static AWS credentials on the server. The backup uses the backend's installed S3 SDK and instance credentials.
- Dedicated S3 bucket: private, all public access blocked, bucket-owner-enforced, versioned, SSE-S3 AES256, TLS-only. Current objects expire after 30 days, noncurrent versions after 1 day; S3 lifecycle deletion is asynchronous and is not a strict 30-day erasure guarantee. Unique run prefixes prevent accidental replacement.
- Daily 03:15 UTC timer with up to 15-minute jitter. Hourly local freshness check fails if no completed backup within 26 hours. This surfaces failed systemd status/journal; it does **not** send email or provide an external alert. The separately approved [AWS operations monitor](../operations-monitor/README.md) now checks S3 completion metadata and sends external failure/recovery alerts.
- Restore uses only supplied artifact files and a newly initialized unprivileged PostgreSQL 16 cluster under `/tmp/lalia-pg-drill-*`, on a private Unix socket with TCP disabled. It cannot connect to production. It checks table counts, constraint definitions/validation state and file hashes, printing aggregate counts only. Existing unvalidated constraints are reported as a count, not silently declared validated. A failed cluster shutdown preserves its directory for operator inspection instead of deleting files beneath a running server.
- `.env` and operating-system roles/configuration are not in the backup. Recover runtime secrets through the owner's separate secure secret-recovery process. This is application-data recovery, not a complete host image. Daily backups imply up to roughly 24 hours of data loss; no PITR is configured.

## Review and provision (owner only)

Review `prepare-aws.sh` and all JSON policies. It targets account `690248313257`, region `us-east-2`, instance `i-0272367e1422b061d`, bucket `lalia-backups-690248313257-us-east-2`, role/profile `LaliaDailyBackupWriter`.

After explicit authorization, from this directory:

```sh
LALIA_APPROVED_BACKUP_SETUP=yes bash prepare-aws.sh
```

This intentionally fails rather than modifying an existing instance role or silently reusing existing resources. If partially completed, inspect actual state and resume individual reviewed commands; do not rerun blindly. IAM propagation can delay profile association.

## Install (after parent review and authorization)

Copy the reviewed `scripts/operations-backup` directory to the server. As root, install runtime files (`backup.cjs`, `common.cjs`, `recovery-metadata.cjs`, `restore-drill.cjs`, `freshness.cjs`, `safe-extract.py`) in `/opt/lalia-backup`, owned by root and mode 0644. Keep the directory mode 0755. Install the four `.service`/`.timer` files in `/etc/systemd/system` mode 0644. Verify `/usr/bin/node`, `/usr/bin/flock`, `/usr/lib/postgresql/16/bin/{pg_dump,initdb,pg_restore,pg_ctl}`, and `python3` exist, and `ubuntu` can read backend `.env` and uploads.

Before starting the service, install root-owned mode 0644 `/etc/lalia-backup-recovery.json` containing only the verified backend secret ARN, exact version ID and key-generation reference. The backup validates this strict schema and compares the generation to its configured settings key; missing or mismatched metadata fails closed. Never put the settings key in this reference file. Follow the [recovery metadata procedure](../operations-recovery/VERIFY-RESTORE.md). The November 12 actual backup/restore verified 84 tables, 134 constraints and six encrypted settings.

```sh
sudo systemd-analyze verify /etc/systemd/system/lalia-backup.service /etc/systemd/system/lalia-backup.timer /etc/systemd/system/lalia-backup-freshness.service /etc/systemd/system/lalia-backup-freshness.timer
sudo systemctl daemon-reload
sudo systemctl start lalia-backup.service
sudo systemctl status lalia-backup.service --no-pager
sudo systemctl start lalia-backup-freshness.service
sudo systemctl enable --now lalia-backup.timer lalia-backup-freshness.timer
```

Do not claim success from timer installation alone. Require a completed manifest plus the off-host restore below. The journal intentionally has no database rows, credentials, filenames or constraint definitions.

## Off-host verification and real isolated drill

Use owner AWS credentials locally. Discover the newest **manifest** under the dedicated prefix with `s3api list-objects-v2` and inspect only LastModified/key metadata. Reject recovery points older than 26 hours. Validate bucket encryption, public-access block, versioning, lifecycle and the instance role policy with their read-only `get-*`/`list-*` APIs.

Download exactly `manifest.json`, `database.dump`, and `uploads.tar.gz` from the same committed prefix. Keep them private, or stream `aws s3 cp s3://BUCKET/PREFIX/FILE -` through SSH directly into a server-side `mktemp -d /tmp/lalia-restore-input.XXXXXX` directory with umask 077. Do not print their contents. The write-only server instance role cannot download them; do not copy owner credentials to the server.

After parent coordinates the real drill, on the server as `ubuntu`:

```sh
LALIA_BACKEND_DIR=/var/www/share-app-staging/livekit-app/backend node /opt/lalia-backup/restore-drill.cjs /tmp/lalia-restore-input.EXACT_RUN
```

Require `restore_verified` aggregate output and exit 0. Remove only that exact input directory after the result is recorded. The script removes its own temporary cluster; input artifacts remain operator-owned until explicitly removed. Record backup timestamp, SHA256 verification, table/constraint/file counts, duration and cleanup result without customer data. Repeat after schema/storage changes and periodically from off-host copies.

## Local synthetic tests

```sh
node --test scripts/operations-backup/backup.test.cjs
python3 scripts/operations-backup/test_safe_extract.py
BACKUP_TEST_BACKEND_DIR=/path/to/backend-with-installed-dependencies BACKUP_TEST_PG_BIN=/path/to/postgresql16/bin node --test scripts/operations-backup/roundtrip.test.cjs
```

The integration test creates only synthetic rows/uploads in two temporary local clusters, validates a successful round trip, and proves failed upload cleanup and the absence of a completion manifest. It performs no AWS calls and uses no production database connection.
