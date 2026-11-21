# Verify backup and recovered settings key

`verify_restore.py` selects the newest complete daily S3 backup by manifest timestamp, reads its recovery reference, retrieves that exact backend Secrets Manager version into memory (or its pinned key-generation source only if that version is missing), and streams the backup and settings key through authenticated SSH to the existing source host. No AWS credentials or Secrets Manager permissions are installed on EC2. No customer artifacts or plaintext key files are written locally.

The remote helper `verify-restore.cjs` uses `/opt/lalia-backup/restore-drill.cjs` to create a fresh, unprivileged PostgreSQL 16 cluster on a private Unix socket with TCP disabled. It checks dump/upload SHA256, table counts, constraint definitions and upload inventory; then it authenticates every `enc:v1:` value in the four platform email, billing, storage and push settings tables. Decrypted bytes are discarded without being returned or printed. A wrong key, authentication failure, or zero encrypted settings fails the check. It imports only PostgreSQL and backup helpers, never application modules, routes, support/consent services, or background jobs. No application/provider calls occur.

Run from the repository root using the existing operator AWS profile and SSH identity:

```sh
python3 scripts/operations-recovery/verify_restore.py
```

The default input is the sanitized backend reference in `docs/launch/evidence/2026-11-12-runtime-recovery.json`. For new manifests, the embedded exact reference takes precedence. Existing backups without recovery metadata use that qualified evidence reference, and evidence explicitly records that the manifest lacked a reference. The real decryption check then establishes compatibility with that older backup; it must not be assumed from timestamps alone.

Only a Secrets Manager `ResourceNotFoundException` for the exact version permits fallback to the recorded `key-generation-...` staging label. The returned ARN, complete snapshot status, recorded generation and independently computed key generation must all match. Permission/network failures do not trigger fallback. Evidence records requested versus actual version and whether fallback occurred. A generation fallback proves compatibility of the decryption key only; it does not recover the exact historical environment configuration.

Only ARN/version/key-generation identifiers, backup prefix, aggregate counts and booleans are saved in `scripts/operations-recovery/restore-verification.json`. Success is reported only after the isolated database has stopped and been removed and the private artifact directory is removed. On failure, command/SQL output is withheld. The existing cluster helper deliberately preserves a cluster directory if shutdown fails; investigate that condition rather than deleting files beneath a live database.

## Ongoing backup recovery references

`/etc/lalia-backup-recovery.json` is an operator-maintained, root-owned mode-0644 file containing exactly:

```json
{
  "format": 1,
  "backend": {
    "secretArn": "arn:aws:secretsmanager:us-east-2:690248313257:secret:lalia/prod/recovery/backend-EXAMPL",
    "versionId": "00000000-0000-0000-0000-000000000000",
    "keyGeneration": "key-generation-000000000000000000000000"
  }
}
```

These are references, never secret values. Unknown fields, other accounts/regions/record types, malformed identifiers, symlinks, non-root ownership, group/world writes and oversized files are rejected. The backup compares the referenced generation with its existing configured settings key, then embeds the validated reference under `manifest.recovery`. It does not contact Secrets Manager. A missing/mismatched reference fails the backup visibly rather than asserting unverified recovery compatibility; keep the previous known-good metadata until the replacement snapshot is verified.

Generate the file from the verified backend evidence, install it before the reviewed `recovery-metadata.cjs` and `backup.cjs`, and keep all three root-owned. Replace the entry atomically as part of a controlled configuration change. Do not rotate the settings key or grant EC2 secret-read access. After installation, start the existing `lalia-backup.service` once, leave its timer unchanged, and verify a fresh three-object run with the exact reference. Repeat the isolated restore on that run.

The generation staging label preserves the historical key source. Retain the exact referenced version for all retained dependent backups; before configuration refreshes, check both version and generation dependencies. This setup does not automatically retire versions or rotate keys. Recovery verification does not authorize replacing the running application's configuration.

## Tests

```sh
node --test scripts/operations-backup/backup.test.cjs scripts/operations-backup/recovery-metadata.test.cjs scripts/operations-recovery/verify-restore.test.cjs
python3 -m unittest discover -s scripts/operations-recovery -p 'test_verify_restore.py'
BACKUP_TEST_BACKEND_DIR=/path/to/backend-with-pg-dependency BACKUP_TEST_PG_BIN=/path/to/postgresql16/bin node --test scripts/operations-backup/roundtrip.test.cjs
```

The synthetic round trip proves reference persistence, successful authenticated decryption after restore, rejection of a wrong key, and temporary-cluster cleanup. It uses synthetic data only.

The November 12 drill exposed that the newly deployed backend uses an uploads-root symlink to persistent storage. Backup now canonicalizes only that trusted deployment root after its existing realpath allowlist comparison. Nested symlinks and unrelated roots remain rejected; no user files or upload layout were changed.
