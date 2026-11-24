# Operations alerts, agent logs, and runtime-secret recovery

Status: approved by owner on November 12, 2026; alert recipient kennyrhule@proton.me. This document does not authorize or perform resource creation, secret copying, email subscription, agent restart, or deployment. Existing backup timers remain running. Stripe remains TEST and automatic charging remains off.

## Outcome and scope

Provide off-host failure alerts, retain sanitized runtime logs from both selectable LiveKit agents, and preserve the runtime secrets needed to recover the verified database/upload backups. Use the existing AWS account `690248313257` and region `us-east-2`.

Approved notification recipient: **kennyrhule@proton.me**. After subscription creation, the recipient must also complete Amazon SNS's email confirmation. Do not claim email delivery is working until a controlled alert and recovery notification are received. [SNS confirmation requirements](https://docs.aws.amazon.com/sns/latest/dg/sns-email-notifications.html)

This adds no automatic remediation, customer-account changes, payment changes, provider-key rotation, or customer audio recording. It does not promise full disaster independence from the AWS account/region, complete provider invoice reconciliation, or continuous end-to-end RTC testing.

## Evidence and existing dependencies

Read-only discovery against the current deployment found:

- No SNS topics/subscriptions, CloudWatch alarms, Lambda functions, EventBridge rules/schedules, or Secrets Manager records in `us-east-2`.
- Daily PostgreSQL/upload backup and hourly local freshness timers are installed on EC2 `i-0272367e1422b061d`. A real S3 restore verified 58 table counts, 104 constraints, and one upload. See [backup evidence](../../launch/evidence/2026-11-11-backup-restore.json).
- The dedicated backup bucket is `lalia-backups-690248313257-us-east-2`. `LaliaDailyBackupWriter` can upload encrypted objects beneath `lalia/daily/`, but cannot read or delete backups. Preserve these permissions.
- Backend `/var/www/share-app-staging/livekit-app/backend/.env` is 3,454 bytes; its parsed JSON is 2,551 bytes. `SETTINGS_ENCRYPTION_KEY` is present and matches the active PM2 inherited key. `secretCrypto.js` derives its AES-GCM key from that value, falling back to JWT secrets only when the dedicated key is absent.
- The dedicated key is needed for database-stored email, Stripe, storage, marketing, and VAPID secrets. The APNS private key is inline in the backend environment. Runtime recovery therefore requires more than a database restore.
- PM2's `FRONTEND_URL` and `PUBLIC_FRONTEND_BASE_URL` differ from the file. Snapshot effective application configuration, including these overrides; do not silently restore stale file values.
- The local agent `.env` contains nonempty provider credentials, but this does not prove equality with deployed cloud values. It also contains repeated `AGENT_NAME` entries and lacks deployed `AGENT_MODULE`, `TTS_ENABLED`, `TTS_PROVIDER`, and `AGENT_BUILD_REF` fields.
- The primary agent is `CA_do6qoLXhxqA7`; hosts can also select stable agent `CA_gKYczmp9DCNy`. Both need the logging/recovery review. Neither has configured AWS log-drain keys. Stable has eight deployed secret names: `AGENT_BUILD_REF`, `AGENT_MODULE`, `AGENT_NAME`, `CAPTION_UTTERANCE_END_DELAY_SEC`, `DEEPGRAM_API_KEY`, `LLM_PROVIDER`, `OPENAI_API_KEY`, and `STT_PROVIDER`. Its missing `BACKEND_BASE_URL`/`COST_EVENT_SECRET` are a preexisting telemetry/recovery coverage gap; do not silently copy primary credentials as part of logging setup.

No secret values were printed or copied during discovery. Key names, presence, sizes, and equality booleans are evidence of configuration dependencies, not evidence that every provider credential is current.

## 1. Independent health and backup-freshness monitoring

Create one standard SNS topic, `lalia-operations-alerts`, and one Lambda function, `lalia-operations-monitor`. A dedicated EventBridge Scheduler schedule invokes the function every five minutes. Run outside the application's VPC so monitoring does not depend on the EC2 instance or require a paid NAT gateway. Use a 30-second function timeout, bounded HTTP requests, and reserved concurrency of one.

The monitor performs two independent checks and publishes three fixed-dimension metrics in `Lalia/Operations`:

| Metric | Success condition | Alarm |
| --- | --- | --- |
| `ApiHealthy` | HTTPS GET of `https://lalia.cloud/api/health` succeeds with the expected JSON `{status: "ok", service: "livekit-backend"}`. Reject unexpected bodies, invalid TLS, and redirects to other origins. | Value below 1 in two of three five-minute periods. |
| `BackupFresh` | S3 listing contains exactly the three expected objects for a completed run under one `lalia/daily/` prefix: `manifest.json`, `database.dump`, and `uploads.tar.gz`, each nonempty, with a manifest last-modified age no greater than 26 hours. The manifest is the last-uploaded completion marker, not a fourth object. Select by timestamp and paginate; do not rely on a local server stamp. | Value below 1 in two of three five-minute periods. |
| `MonitorHeartbeat` | One successful monitoring invocation reaches metric publication. A failed individual probe still publishes its failure metric. | Missing/breaching data in two of three five-minute periods. |

Configure missing data as breaching on all three alarms. Publish both ALARM and OK state transitions to SNS. Messages contain the check name, age/status, timestamp, and a runbook link, with no credentials, customer identifiers, response bodies, or manifest contents. CloudWatch alarm notifications occur on state changes, so this design is not an escalating pager or repeated reminder service. [CloudWatch alarm behavior](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Alarms.html)

The Lambda needs only prefix-constrained `s3:ListBucket` on the backup bucket, `cloudwatch:PutMetricData` restricted by namespace, and write access to its own precreated log group. It does not download database dumps, uploads, or secret values. The scheduler role may invoke only this function. Restrict the SNS resource policy to the intended CloudWatch alarms/account. Retain monitor logs for 14 days; they contain only operational statuses.

The current health endpoint is a process-availability check; it does not query PostgreSQL or exercise translation. The metadata-only backup check does not verify cryptographic integrity, row counts, or restorability. Preserve periodic isolated restore drills and separate RTC canaries; do not grant dump-download access to the monitor. This monitor is independent of the EC2 host but shares AWS region/account failure modes.

## 2. Privacy-safe LiveKit runtime log drains

Precreate two Standard CloudWatch log groups in `us-east-2`, each with 30-day retention:

| Agent | Exact log group | Dedicated writer identity |
| --- | --- | --- |
| Primary codeswitch | `CA_do6qoLXhxqA7` | `lalia-primary-agent-log-writer` |
| Host-selectable stable | `CA_gKYczmp9DCNy` | `lalia-stable-agent-log-writer` |

Use a different access-key pair for each identity. Grant `logs:CreateLogGroup` only on that agent's exact group ARN, and `logs:CreateLogStream`/`logs:PutLogEvents` only on its `:log-stream:*` ARN. For example, the primary group ARN is `arn:aws:logs:us-east-2:690248313257:log-group:CA_do6qoLXhxqA7`. Do not grant read, delete, retention changes, wildcard-group access, S3, IAM, or Secrets Manager permissions. Do not add `Describe*` unless an observed sidecar requirement justifies a reviewed change.

LiveKit's native sidecar uses the agent ID as group name and worker ID as stream name. Configure only `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and explicit `AWS_REGION=us-east-2`; the documented region default is different. The sidecar forwards raw stdout/stderr from every replica, including startup/dispatch failures. Build logs are outside this drain. [Native drain contract and permissions](https://docs.livekit.io/deploy/agents/log-drains/#cloudwatch-integration)

### Required redaction before enabling any drain

Current code logs speech/translation snippets and provider response bodies. Do not activate external persistence of those lines. First change both agent variants and shared helpers to emit operational event names, counts, durations, status codes, build references, and opaque diagnostic identifiers. Remove transcript text, translated text, participant display names/emails, tokens, authorization headers, provider response bodies, and credential-bearing URLs. Exception messages and third-party debug output need the same review; a narrow source change plus a defensive logging filter is preferable to regex masking alone.

Known audit targets include `transcription_codeswitch_agent.py` turn/final-segment logs, corresponding `transcription_only_agent.py` logs, `cost_reporter.py`, `demo_orchestrator.py`, TTS lane error paths, and provider wrapper exceptions. Redaction must not disable captions or application transcript storage: this concerns diagnostic output only.

Run negative tests against actual formatted stderr/JSON output, including SDK handlers and third-party loggers, at normal and debug levels. Synthetic speech, provider bodies, JWT/Bearer/API-key sentinels, and credential-bearing URLs must not appear, including through `str(exception)` or `exc_info`. Retain safe exception types/status/provider/latency. Persistent logging cannot repair previously emitted LiveKit logs retroactively.

### Activation and restart boundary

Capture newly created writer credentials in encrypted recovery storage before injection. Pass them through a private 0600 temporary secrets file containing only the three new AWS fields, never shell argument values or logs. Use merge semantics; never use a partial `--overwrite` manifest. Remove the temporary file afterward.

LiveKit secret updates trigger a rolling restart. Each variant needs its own sanitized-image canary and exact-image promotion before its drain is enabled. Verify primary selects `transcription_codeswitch_agent` and registers `translation-cloud-deepgram-codeswitch`; stable selects `transcription_only_agent` and registers `translation-cloud-prod`. Do not infer existing stable settings from local defaults. Verify readiness, synthetic RTC behavior, and shutdown for both profiles; do not claim stable TTS behavior without testing it. Drain secrets apply per agent, not per named canary deployment. Cloud secret values cannot be read back through the CLI/dashboard. [Secret update semantics](https://docs.livekit.io/deploy/agents/secrets/)

## 3. Encrypted runtime recovery snapshots

Create three versioned JSON records in AWS Secrets Manager using its AWS-managed encryption key:

- `lalia/prod/recovery/backend`
- `lalia/prod/recovery/agent-primary`
- `lalia/prod/recovery/agent-stable`

Use separate operator-controlled writer and recovery-reader permissions scoped to these exact ARNs. Initial capture and refresh use the approved operator workflow, without granting Secrets Manager permissions to the existing EC2 backup writer or log-drain identities. Recovery snapshots are not a runtime dependency: a Secrets Manager outage must not stop a running application. Do not store the owner's AWS credentials or SSH private key in these application records.

For the backend, capture the parsed application `.env` plus the effective overrides for those application keys. Include the exact settings-encryption key, JWT secret, database connection credentials, LiveKit backend credentials, cost-reporting secret, APNS material, and configured integration credentials. Do not copy all of PM2's environment indiscriminately. Record source paths, capture time, application revision, key names, effective-key source, and any unresolved coverage in the encrypted record. Plaintext remains inside the source/capture process or an encrypted transport pipe; avoid plaintext local artifact files and command arguments.

For each agent, assemble an explicit recovery manifest from qualified authoritative sources, preserving provider credentials, cost-reporting credentials, selected variant/provider settings, and its new dedicated log-writer credentials. LiveKit-provided `LIVEKIT_*` agent credentials are regenerated by LiveKit on deployment; recover the operator's project access separately.

### Source coverage and qualification

Classify every field as one of:

1. **Verified effective source:** current backend effective configuration, or a known deployment input whose use is recorded and verified.
2. **Known newly issued source:** the new dedicated AWS log-writer credentials, verified by successful delivery to the exact group.
3. **Candidate local copy:** provider credentials found locally but not proven equal to cloud values.
4. **Unrecoverable/unknown:** cloud-only values with no authoritative retained input.

A nonempty local key or matching key name is not qualification. Do not call the agent snapshot complete while required fields remain candidate or unknown. Resolve those fields using owner-confirmed authoritative deployment material or a separately approved rotation/redeployment; this design does **not** authorize rotating existing provider credentials. Safe validation may use a separately approved synthetic canary with a recovered manifest, but successful API authentication alone does not prove equality with the current deployment's key.

Record per-field coverage and per-agent completeness in sanitized evidence, showing names/status only. An incomplete snapshot can preserve known material while explicitly stating its limits; it must not overwrite or replace a previously verified complete snapshot.

### Version and historical-key policy

Create a new snapshot only when effective configuration changes, not on every timer tick. Refresh it as part of the controlled configuration/deployment workflow and verify the resulting version before marking recovery current. Record the compatible recovery version ID with each database backup's recovery metadata; keep the underlying key generation recoverable for every retained backup.

Do not rotate `SETTINGS_ENCRYPTION_KEY` as part of this work. Changing it without re-encrypting database settings would break decryption. Before a future rotation, pin the old key generation in a labeled recovery version or an explicit encrypted key ring until all dependent backup versions have actually expired and deletion has been verified. Do not rely only on `AWSCURRENT`/`AWSPREVIOUS`; unlabeled historical versions can be removed. If labeled-version limits become relevant, use a reviewed key-ring or separate generation record rather than silently dropping recoverability. [Secrets Manager versions](https://docs.aws.amazon.com/secretsmanager/latest/userguide/whats-in-a-secret.html)

No automatic secret deletion or rotation is enabled. A retirement runbook must check backup dependencies first, remove access, and use a recoverable deletion window. Secrets Manager version removal/deletion is not immediate or an exact 30-day purge mechanism. These infrastructure credentials are distinct from customer transcript-retention policy. [Secret deletion semantics](https://docs.aws.amazon.com/secretsmanager/latest/userguide/manage_delete-secret.html)

## Alternatives considered

| Alternative | Tradeoff | Decision |
| --- | --- | --- |
| AWS Scheduler/Lambda/CloudWatch/SNS and Secrets Manager | Uses the existing account and backup destination; low fixed cost; off-host checks; still shares AWS regional/account risks. | Recommended. |
| Separate uptime/logging SaaS | Adds provider-independent visibility and potentially better paging, but needs another account, credentials, destination/privacy review, and pricing decision. | Revisit when independent-provider coverage or on-call escalation is needed. |
| Host-only systemd/email alerts | Simple, but host/network failures can disable the alerting mechanism itself. | Keep local freshness checks as supporting diagnostics, not the sole alert path. |
| A plaintext env archive beside database backups | Easy to produce, but mixes the decryption key with encrypted application data and gives a broader backup reader access to runtime credentials. | Reject. |
| LiveKit secret inventory as recovery source | Convenient names-only inventory, but values cannot be exported. | Use to identify coverage gaps, not as a secret backup. |

## Verification and acceptance evidence

Perform implementation and local tests before changing cloud configuration. Then verify these independently:

1. **Monitoring:** IAM policy simulation denies dump/secret reads and unrelated resources. Invoke healthy and controlled failure fixtures; verify metric values for malformed health JSON, TLS/timeout errors, stale backups, incomplete runs, pagination, and permission failures. Exercise a dedicated test alarm and the confirmed email subscription, including recovery. Verify missing heartbeat behavior without stopping production backup timers. Record alert receipt rather than treating SNS acceptance as email-delivery proof.
2. **Redaction:** Both agent variants and shared error paths pass synthetic sentinel tests. A named canary produces expected safe startup/session/failure markers and no test speech/secret sentinel. No customer transcript search/export is required.
3. **Log drains:** Each writer can write only its own group and cannot read/delete/change retention. Both exact groups have 30-day retention and receive current worker streams after restart. Verify at least two distinct worker streams for the same agent across a controlled rolling restart or autoscale, retaining the earlier stream; do not treat one current stream per agent as proof of multi-instance coverage. Verify safe markers from each agent, including a controlled error; confirm log-drain operation is not mistaken for alert configuration. HTTP/backup alarms are the initial failure alerts; any future agent-error alarm needs a reviewed signal/threshold.
4. **Recovery:** Retrieve each newly stored secret into an isolated process; compare internally and output only counts/booleans/version IDs. Use a fresh isolated PostgreSQL restore and the recovered historical/current settings key to decrypt stored encrypted settings without displaying values or starting background application jobs. Confirm no email, billing, support, or provider calls occur during this check. Explicitly report incomplete agent source coverage.
5. **Cleanup and evidence:** Remove temporary secret files, test artifacts, temporary clusters, and test resources. Verify existing backups/timers and application health remain intact. Save sanitized resource IDs, policies, retention, snapshot versions/coverage, alert receipt, and verification results; exclude secret values and plaintext log samples.

## Rollback and failure handling

- Monitoring rollback disables the new Scheduler schedule/alarm actions first. It leaves existing backup services/timers and S3 artifacts untouched. Remove only the new monitor resources after investigation; do not delete recovery snapshots automatically.
- Log-drain emergency rollback deactivates only the affected dedicated IAM access key. This stops new AWS writes without rotating provider credentials or restarting the agent. Later remove the AWS drain fields through a safe supported deletion path or a **complete verified** replacement manifest; never use a partial overwrite of write-only cloud secrets.
- If rolling back agent redaction to an older image that logs speech, deactivate its drain key **before** rollback. Existing copied logs remain subject to retention/deletion behavior; stopping a drain does not remove them.
- Recovery rollback retains the previous verified secret version and marks a failed candidate as unverified. Do not restore a mismatched settings key over the running backend. No automated secret deletion, provider rotation, or application-config replacement occurs.
- New monitoring/logging failures must not terminate translation sessions or stop database backups. Alerting should report failures, not perform unreviewed remediation.

## Retention and cost

Set 30-day retention on the two agent log groups before any write. CloudWatch typically takes up to 72 additional hours to remove expired events and can take longer; describe this as scheduled expiry, not guaranteed permanent deletion exactly at day 30. [CloudWatch retention behavior](https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_PutRetentionPolicy.html)

At low initial volume, budget approximately **$2–5/month** for monitoring and three recovery secrets, plus usage-dependent agent-log ingestion/storage and queries. This is an estimate, not a spending cap; free-tier eligibility and regional/account usage can change the bill.

| Component | Planning basis |
| --- | --- |
| Three custom metrics and three standard alarms | About $1.20/month at published $0.30/metric and $0.10/alarm-metric examples. |
| Three Secrets Manager records | About $1.20/month at $0.40/secret, plus API calls. No extra customer-managed KMS key is proposed. |
| Five-minute monitor | Approximately 8,640 invocations per 30 days; modest Lambda compute, API, S3 listing, and status-log usage. Scheduler includes a published free invocation allowance, subject to eligibility/terms. |
| Agent logs | Usage-dependent: published examples use $0.50/GB ingestion and $0.03/GB-month archived storage. One GB/month across both agents is roughly $0.53 before queries and allowances; verbose/debug output can increase this substantially. |
| SNS | Low notification volume is expected; delivery/API charges remain usage-dependent. No SMS or paid paging integration is proposed. |

Check actual usage after the first week, reduce noisy diagnostic volume, and review retention rather than enabling unlimited debug logging. Sources checked November 11, 2026: [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/), [Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/), [Lambda pricing](https://aws.amazon.com/lambda/pricing/), [EventBridge pricing](https://aws.amazon.com/eventbridge/pricing/), [SNS pricing](https://aws.amazon.com/sns/pricing/), [AWS-managed Secrets Manager encryption](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html).

## Review decision

Approve or revise: AWS account/region and resources above; candidate alert recipient; 30-day sanitized agent-log retention; source redaction before drains; separate scoped writer credentials; encrypted effective-runtime recovery with explicit incomplete-source labeling; controlled canary/restart and notification verification. Approval must not be interpreted as permission to rotate unrecoverable provider keys or overwrite existing agent secrets with an incomplete manifest.

After design approval, prepare separate implementation tasks for monitor/alerts, source redaction/log drains, and recovery capture/verification. None of those implementation changes are part of this document.
