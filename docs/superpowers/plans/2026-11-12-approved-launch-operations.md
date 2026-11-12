# Approved launch operations implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Root coordinates deployments and independently verifies evidence.

**Goal:** Finish the approved Billing return fix, independent AWS alerts to kennyrhule@proton.me, sanitized multi-worker agent logging, and qualified encrypted runtime recovery while keeping Stripe TEST and automatic overage charging off.

**Architecture:** Follow the two reviewed November 11 specs. Use existing AWS account 690248313257/us-east-2; keep monitor, log writers, and recovery permissions separate. Backup cadence/permissions remain unchanged; manifests now carry recovery references and the trusted deployment upload-root alias is resolved safely. Execute independent source changes in parallel; root serializes commits and deployment. Use existing isolated lalia-launch worktree/launch-readiness branch and draft PR12.

**Tech Stack:** Node.js/React, Python LiveKit Agents, AWS Lambda/Scheduler/CloudWatch/SNS/Secrets Manager, PostgreSQL16, SSH.

**Approval:** Owner approved setup and Proton alert recipient on November12. No further design approval needed within this scope; SNS confirmation was completed; AWS test ALARM/OK publications succeeded. Owner confirmed both ALARM and recovery (OK) emails arrived.

## Task 1: Billing return navigation
Files: backend/routes/v2/billing.js; frontend/src/v2/pages/V2OrgSettings.jsx; focused tests under backend/test and frontend tests.
- [x] Add regression asserting Checkout URLs contain section=billing and correct success/cancel marker, preserving trusted base URL.
- [x] Add navigation tests for legacy success/cancel/portal, explicit-section precedence, ordinary Profile, unknown markers, changed search parameters and manual selection stability. Run before fix and observe relevant failure.
- [x] Add explicit section=billing to Checkout success/cancel URLs; implement a small shared section resolver and effect only on search-param changes. Preserve reconciliation/auth/entitlements.
- [x] Run focused and existing relevant suites with cached NODE_PATH dependencies; root reviews diff and commits.
- [x] Root deploys branch through existing deploy.sh, creates two isolated test fixtures, performs real CUA signed-in payment/cancel returns, verifies Stripe TEST/API isolation, then cleans exact fixtures.

## Task 2: Off-host monitor and alerts
Create scripts/operations-monitor/{monitor.mjs,monitor.test.mjs,deploy.py,README.md}; deployment uses existing AWS CLI/profile jarmetals and explicit account/region checks.
- [x] Tests first: valid/malformed health JSON, bounded timeout/TLS/redirect failure, recent/stale/incomplete backup object sets, pagination, missing metrics and independent probe failure handling. Expect failing import/behavior, then green.
- [x] Implement fixed-origin /api/health GET, metadata-only S3 ListObjectsV2 pagination for exact filenames manifest.json/database.dump/uploads.tar.gz, all nonempty in one run prefix, 26-hour completion age based on manifest LastModified, independent ApiHealthy/BackupFresh/MonitorHeartbeat metrics, safe operational logs. Lambda Node runtime includes SDK or package official runtime dependencies if needed; no app/server dependency.
- [x] Provision exact resources: Lambda lalia-operations-monitor (30sec, concurrency1), Scheduler every5min, own14day log group, namespace Lalia/Operations, three missing-data-breaching 2of3 alarms and SNS lalia-operations-alerts. Runtime IAM allows only prefix ListBucket, namespace metrics, own log writes; Scheduler only invokes exact function; SNS CloudWatch source/account scope.
- [x] Subscribe kennyrhule@proton.me (explicitly approved). Report confirmation pending; do not claim delivery before receipt. Controlled alarm/recovery notification test must not stop production or backup timers.
- [x] Verify resources/policies, invoke monitor, observe metrics; test heartbeat missing-data using dedicated temporary test alarm. Remove test resources. Save sanitized evidence/runbook.

## Task 3: Private agent logs
Files: translation-agent privacy logging helper/tests, both transcription variants and shared helpers with content-bearing logs.
- [x] Audit source/SDK log setup; write synthetic content/credential/exception/URL sentinel tests on real formatted output before implementation.
- [x] Remove speech/provider response bodies/participant names and sanitize exception paths; retain safe event metadata. Install defensive filtering at actual handlers, including child processes/debug output; do not alter transcript/caption product behavior.
- [x] Run privacy tests and existing agent suite; use real SDK startup verification. Root reviews before cloud changes.
- [x] For each agent profile separately, build named canary from reviewed committed source, verify real synthetic media/shutdown and correct profile, promote exact image. Preserve rollback refs. No speculative provider rotations or shared-secret overwrite.
- [x] Root provisions exact30day CloudWatch groups CA_do6qoLXhxqA7 and CA_gKYczmp9DCNy, separate narrowly scoped write-only IAM users/keys. Store new credentials encrypted before injecting3AWS fields with merge semantics using0600 temporary files, removed afterward.
- [x] Verify safe startup/job/error/shutdown logs, no sentinels, and at least2worker streams/history for sameagent after restart/autoscale; denied crossgroup/read/delete IAM simulation. Rollback disables writer key before reverting to image with raw speech logs.

## Task 4: Recovery capture and verification
Create scripts/operations-recovery/{capture.py,verify.py,README.md} or equivalent small scoped tools; never store secret values in repository/arguments/tool output.
- [x] Provision separate exact-record recovery writer and reader permissions; do not grant either to backup/monitor/log-writer identities. Never replace a verified complete snapshot with an incomplete candidate.
- [x] Implement capture using secure SSH/memory pipes and AWS SDK input, scoped to3exact records lalia/prod/recovery/{backend,agent-primary,agent-stable}. Preserve effective app.env plus selected PM2 overrides; no entire PM2 environment copy.
- [x] Unit tests cover duplicate/missing/candidate source classification and historical key retention. Capture exact SETTINGS_ENCRYPTION_KEY without rotation. Record version IDs and qualified source status only in evidence.
- [x] Build agent manifests from authoritative retained deployment inputs and newly issued log keys; mark local-only copies candidate/unknown, never claim equivalent deployed secrets without evidence. Do not rotate providers or replace write-only cloud config.
- [x] Verify encrypted snapshots by retrieval/internal equality booleans; download existing backup by private pipe to isolatedPG16 and prove recovered encryption key decrypts encrypted settings without plaintext output/provider calls. Clean temporary database/files.
- [x] Associate recovery version/key generation with backup recovery evidence; retain old generations while any dependent backup remains. No automatic deletion/rotation.

## Task 5: Review, integrate, verify and report
- [x] Independent reviewer checks each diff/spec compliance and security-sensitive permissions; root resolves findings.
- [x] Root runs relevant tests once after integration, commits exact files, pushes existing draft PR. Source changes deployed only after tests/review and with coordination.
- [x] Verify health, StripeTEST/autochargeOFF, existing backup/timers, monitor/alarm delivery, actual multiworker logs, and recovery coverage. Update docs/launch/2026-11-11-readiness.md and new November12 evidence truthfully, including any pending SNS confirmation or unknown agent-source coverage.
- [x] Final report states installed changes, observed verification, costs/limitations and only genuinely required owner actions. No claim of automatic failover or paid-launch readiness.

## Acceptance notes — November 12

- Checkout success/cancel and legacy success return passed live Sandbox UI checks; fixtures and private credential files cleaned, OpsHub tombstones applied.
- Independent monitor installed; all three alarms OK. SNS subscription confirmed and controlled ALARM/OK actions succeeded; owner confirmed both emails arrived.
- Both sanitized agent profiles promoted; each log group shows four matching reviewed-build workers, safe lifecycle/error events, and retained restart history. Named canary cleanup is recorded in final rollout evidence.
- Backend key recovery passed against a fresh actual S3 backup: 84 tables, 134 constraints, six encrypted settings, temporary-data cleanup. Exact references are embedded in ongoing backups.
- Agent provider credential coverage remains candidate/unknown where cloud values cannot be exported. Stable fallback usage reporting has a pre-existing missing backend URL/cost credential; this is not certified by caption/logging tests.
- Independent review findings on historical key fallback, durable-key retry handling and fresh-build log acceptance were fixed and re-reviewed. Stripe remains TEST; autocharge OFF; paid launch deferred.
