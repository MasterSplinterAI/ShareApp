# Fallback usage, agent recovery, and homepage

Stripe remains **TEST** and automatic overage charging remains **OFF**.

## Homepage

Web release `5f21ea680fc4b588a6a9c1be80408b1b9b099c81` replaces homepage/shared marketing interactive demo entry points with existing free signup and 60 free minutes. The direct demo route and enterprise contact demos remain available. Desktop, 390px mobile navigation, translated Spanish hero, all seven published homepage variants, and the `/v2/signup` destination were verified. A locale-generator regression that replaced JSON-LD before visible hero text was fixed and tested.

See [homepage evidence](evidence/2026-11-12-free-signup-homepage.json) and [mobile screenshot](evidence/2026-11-12-free-signup-mobile.png).

## Metering repair

The stable agent lacked `BACKEND_BASE_URL` and `COST_EVENT_SECRET`. Restoring those inputs enabled LLM cost reporting, but actual media exposed a separate shutdown race in both pipelines: a second cancellation could interrupt final accepted-PCM reporting. Reviewed source `a82930ad4449d2c55b79a94be2c2e7c7e1a37884` registers the final STT report in protected tasks before yielding to cleanup. All pipeline legs are cancelled synchronously. Zero-frame streams emit no usage. Existing bounded shutdown and privacy protections remain.

The regression failed before the fix; all **237 agent tests** passed with the real SDK runtime. The local sandbox blocked the forkserver test; the complete suite passed outside those process restrictions. Recovery tests separately passed **30 checks**.

Fresh isolated canaries verified final translated captions in both English/Spanish directions. Stable image `q5NLx2CmaUKC` recorded 1.2293333333 STT minutes, two exact quota mirrors, positive OpenAI costs, and 58.7706666667 minutes remaining from 60. Primary image `Ckpqp8J7B2Jw` recorded 1.2505 STT minutes, two exact quota mirrors, positive OpenAI/xAI speech costs, and 58.7495 minutes remaining; translated audio was received in both directions. These are synthetic acceptance runs, not broad language/load certification.

## Recovery acceptance

Both production profiles were independently verified again after their complete known configurations were retrieved from encrypted pending snapshots and reapplied. New-worker registration and previous-worker shutdown preceded fresh media in each unused zero-cost fixture. Logs confirmed the reviewed source and actual session completion with zero unexpected/sentinel records.

Stable's restored run recorded 1.2348333333 STT minutes, two identical usage mirrors, positive OpenAI costs, and 58.7651666667 free minutes remaining. Primary's restored run recorded 1.2528333333 STT minutes, two identical mirrors, positive OpenAI/xAI costs, and 58.7471666667 minutes remaining. Primary delivered translated audio in both directions (2.45 and 5.65 seconds received). Final translated captions passed both profiles.

AWS Secrets Manager now holds complete verified snapshots for primary (20 deployed inputs, version `de8ac17c-0ebf-4b85-a723-c748bcfa542a`) and stable (14 inputs, version `d8d5a6a7-95e3-40ef-ac10-8d83fe644a4d`). Independent readback matched the exact applied pending values, source, deployed inventory, and reviewed attestations. All fields have `known_deployed_verified` coverage. Qualification is **known values reapplied and verified, not cloud export**: LiveKit secrets remain write-only. No provider-account key was revoked. Privacy probes remain off.

The first stable repair attempt is retained as failed evidence: one dispatch reached an old worker, and the later fresh worker reported LLM costs but lost STT at shutdown. Neither that pending snapshot nor the earlier unapplied primary snapshot was marked complete. The new reviewed images and fresh fixtures supplied all acceptance evidence.

The recovery helper fails closed on missing values, identity/inventory drift, stale workers, failed media, missing telemetry, or mismatched quota. Generic capture cannot downgrade these complete agent snapshots. See the [recovery runbook](../../scripts/operations-recovery/README.md).

## Cleanup and limits

All five scoped fixtures (one failed attempt and four passing runs) were removed using the application customer-tombstone lifecycle; downstream deletion receipts were verified. Genuine provider-cost rows remain in the ledger. Temporary rooms, named canaries, and recovery-secret files were removed. Only the intended two production agents remain. Public API/home/signup returned HTTP200, one backend worker was online, and all three monitoring alarms were OK.

Full scoped records, version receipts, worker lifecycle, costs, quota checks, cleanup, and independent readback are in [the sanitized acceptance artifact](evidence/2026-11-12-agent-usage-recovery.json). These outcomes supersede the earlier operations report's pending stable-metering and agent-recovery items.

Stripe live onboarding/configuration and a real payment/refund check remain intentionally deferred. Broader language/load coverage and previously documented accounting/serialization limits are unchanged; keep one backend worker and automatic overage charging off. Recovery remains manual with daily backup recovery points, not point-in-time recovery or automatic failover.
