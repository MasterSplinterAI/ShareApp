# November 12 approved launch operations

Owner approved the setup and `kennyrhule@proton.me` as alert recipient. Stripe
remains **TEST**, and automatic overage charging remains **OFF**. This work does
not activate paid public launch or introduce automatic database failover.

## Checkout

Web/backend release `e224afce9d4db7137b4841b62686add42c6bb8c5` preserves the
already-published OpsHub release and adds explicit Billing success/cancel URLs.
Older return URLs also select Billing, while explicit sections and manual tabs
retain their behavior. Two disposable accounts verified real hosted Sandbox
payment and cancellation while authenticated. The paid account returned directly
to Billing with Starter active; the canceled Pro checkout returned to Billing
with Free active. Legacy success navigation and manual Account selection passed.

Screenshots: [Starter](evidence/2026-11-12-signed-checkout-starter.png),
[cancellation](evidence/2026-11-12-signed-checkout-cancel.png).
All disposable Stripe/app fixtures were cleaned, their old tokens rejected, and
OpsHub deletion events applied. See [checkout evidence](evidence/2026-11-12-signed-checkout-fixed.json).
The current release writes payment receipts to `ops_verified_stripe_receipts`;
all three relevant paid-flow events were delivered on the first attempt.

## Independent monitoring

The five-minute Lambda/Scheduler monitor is outside the app server. It checks
the API health response, complete recent backup object sets, and its own metric
heartbeat. Three alarms treat missing metrics as failures and send failure and
recovery notifications through SNS. The Proton subscription is confirmed; AWS
reported successful publication of both controlled test notifications. The owner
confirmed that both the ALARM and recovery (OK) emails arrived at Proton, completing
end-to-end notification verification.

The monitor cannot read database dumps, runtime secrets or customer records.
Root independently read all three alarms as OK and verified both log-writer
identities cannot read/delete logs, write another group's streams or read secrets.
See [monitor evidence](../../scripts/operations-monitor/verification.json) and
[runbook](../../scripts/operations-monitor/README.md).

## Recovery

The effective backend environment is captured in Secrets Manager with a pinned
settings-key generation. Retrieval matched the captured payload without exposing
values. An actual S3 backup restored into an isolated socket-only PostgreSQL16
cluster: **84 tables, 134 constraints, one uploaded file**, and all six encrypted
settings authenticated using the recovered key. The
drill ran no application/background jobs or provider calls, and temporary files
and the cluster were removed. New backup manifests include the exact recovery
reference. A trusted upload-root symlink is resolved without following nested
symlinks; a regression test and the actual backup/restore passed. Root independently
verified installed source hashes, active timers and successful backup/freshness
services. See [restore evidence](../../scripts/operations-recovery/restore-verification.json).

Agent recovery is explicitly partial: provider credential copies on disk cannot
be proven identical to LiveKit's write-only deployed secrets. They remain
candidate/unknown, not verified recovery credentials. Newly issued log-writer
keys are preserved encrypted before use. No provider or settings keys were
rotated. Recovery permissions are separate and are not attached to the backup,
monitor or log-writer identities.

Daily backups remain a daily recovery point, not point-in-time recovery, an
atomic database/upload snapshot or automatic failover. Baseline additional AWS
cost was estimated at $2–5/month plus actual log usage.

## Agent logging rollout

Reviewed source `947b932e9be6e9cf9d5fa44739ea8b13f5222aa8` removes dynamic speech,
provider-body and identity logs, rebuilds safe structured records, and gates raw
process output across workers. Caption and transcript product behavior is
unchanged. The full agent suite passed 229 tests; root independently reran all
16 privacy tests with the real SDK environment.

Primary image `M9VUJFcXh9BM` and stable image `CqPbKWM3fgks` were promoted
from their tested named canaries. Primary verified translated captions plus audible
TTS in both English/Spanish directions; stable verified translated captions only.
Actual CloudWatch acceptance matched the reviewed build and rollout time window:
four worker streams per profile, startup/job/error/session-end events, and zero
unexpected or synthetic sentinel messages. History survived a rolling restart.
Both synthetic probes are off; groups retain 30 days. Previous production images
are retained as rollback references; disable writer access before reverting to
an older image that may emit speech.

Both temporary named deployments and all four canary rooms were removed; only
the two intended production agents remain Running. See [rollout and cleanup
evidence](evidence/2026-11-12-agent-privacy-rollout.json). Final API health was OK
and all three independent monitor alarms were OK.

Deployment and actual CloudWatch acceptance results are recorded in
[drain evidence](evidence/2026-11-12-agent-log-drains.json).
See the [logging runbook](../../scripts/operations-logging/README.md) for
activation gates and rollback order.

## Remaining launch work

- Owner intentionally deferred live Stripe onboarding/configuration and an
  approved real-payment/refund check. Do not switch modes without that decision.
- Agent provider-secret recovery remains qualified until authoritative values
  are retained securely or an explicitly planned rotation establishes them.
- The stable fallback profile's pre-existing missing `BACKEND_BASE_URL` /
  `COST_EVENT_SECRET` still disables usage reporting, observed during its canary.
  Its successful caption/logging tests do not certify billing telemetry. Repair
  and verify that path before relying on the fallback for metered paid service.
- Existing bounded English/Spanish synthetic tests do not establish all-language
  quality, human-device coverage or unrestricted concurrency.
- Keep one backend worker and automatic overage charging off; the previously
  documented accounting limitations are outside this operations setup.
