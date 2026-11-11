# Lalia launch verification — 11 November 2026

Production is **https://lalia.cloud**. The `staging.jarmetals.com` hostname and server directory/process names are historical aliases for this same environment, not an isolated staging system.

## Release decision

**Paid public launch is not yet cleared.** Web fixes are deployed at `d7a8b916ae22171629946efbf90b6cd5226c2747`. The connected Stripe configuration is test mode, and account capability checks reported charges/payouts disabled and onboarding details incomplete. The cloud-agent candidate must pass its isolated deployment and real RTC checks before promotion.

## What changed

- Checkout now prevents duplicate subscriptions, reuses pending sessions, and safely replaces an unpaid session when the customer changes plans. Existing subscribers use Stripe's portal.
- Subscription webhooks fetch authoritative Stripe state and map the actual price to the local plan. Unpaid Checkout does not grant paid access; cancellation restores usable Free; stale events cannot restore canceled entitlements. Resume uses mutually exclusive Stripe cancellation parameters correctly.
- Automatic overage charging is disabled in the platform settings. Known cycle overlap, rate snapshot, ledger finalization, and collection/retry issues need a separate accounting repair before enabling it.
- Guest controls require current membership in the meeting's organization. A role from another organization or stale/disabled account cannot grant provider administration.
- Password-reset links use trusted canonical configuration. Incorrect current-password validation no longer logs the user out, while expired authentication still redirects to sign-in.
- Prejoin microphone/camera errors are visible. New meetings and direct calls store transcripts only with explicit boolean opt-in; existing policy values and stored records are preserved.
- Agent candidate: admin-only legacy global voice changes, explicit provider credential requirements, pinned verified SDK versions, direct signal forwarding, bounded shutdown that drains final cost reports, and credential-free Docker runtime checks.

## Verified evidence

| Check | Result |
|---|---|
| Backend regression suite | 137 passed |
| PostgreSQL billing and transcript checks | 24 passed against isolated PostgreSQL 16 |
| Desktop/mobile Chromium launch and missed-call cases | 22 cases passed; responsive navigation test selector corrected and rerun |
| Frontend full production build and prerender | Passed; existing large-chunk warning |
| Agent Python regression suite | 200 passed; these use SDK stubs where applicable |
| Real Python 3.11 / Agents 1.8.11 imports, CLI startup, Silero | Passed locally and during the actual Linux cloud image build |
| Existing production agent real RTC smoke | English → Spanish and Spanish → English final captions plus audible translated speech passed |
| Actual Stripe sandbox app integration | 10 checks passed, dedicated fixtures cleaned |
| Public health, home, sign-in, support health | HTTP 200 after deployment |
| Deployed billing, meetings, and guest-token sources | SHA256 matched tested local files |

Actual sandbox API checks exercised successful payment/refund, expected card decline, a payment requiring 3DS action, subscription creation, Starter-to-Pro update, portal session creation, scheduled cancellation/resume, final cancellation, stale event replay, and concurrent/replaced Checkout sessions. No live funds were charged. Hosted Checkout completion and the interactive 3DS challenge were **not** completed; an API result is not evidence that the full hosted browser flow passed.

The existing sandbox webhook endpoint was updated to `https://lalia.cloud/api/v2/billing/webhook`, preserving its signing secret and prior event subscriptions. Added `invoice.paid`, `invoice.payment_failed`, and asynchronous Checkout success/failure events. Real sandbox subscription, invoice, and refund events appeared as processed in the production webhook ledger. Failed-payment webhook delivery/retry remains a separate manual scenario; local signed duplicate/retry tests passed.

## LiveKit compatibility and deployment

Observed production codeswitch agent: `CA_do6qoLXhxqA7`, dispatch name `translation-cloud-deepgram-codeswitch`, EU Central; original version `sUuVnNMCMHJP`, source label `4f72e28`. It runs Agents **1.8.11** and RTC **1.2.0**, using xAI STT with fallback providers and `gpt-4.1-mini` translation. Agents 1.8.11 was the current release at review; RTC 1.2.1 was newer, so RTC was retained at the verified version rather than upgraded without validation.

The custom RTC transcription architecture is supported; an AgentSession rewrite is not required. `WorkerOptions` remains supported by the installed SDK. LiveKit hosting credentials do not authenticate direct provider plugins. Core SDK/plugin versions are pinned, but this is not a full transitive lockfile. Complete dependency locking and a non-root image remain improvements.

An isolated CLI 2.19.4 binary was checksum-verified. Named source deployment `launch-canary` built versions `eostLfCuzCzk` and `jyW8324R6EJe`; both reported CrashLoop while production stayed on `sUuVnNMCMHJP`. The second image passed provider imports, both agent startup CLIs, and Silero loading in the actual Linux build. CLI runtime-log requests returned no log entries, so the runtime failure's cause is **unconfirmed**. The initial two-participant candidate test timed out waiting for agent readiness. The failing named deployment was deleted to stop its crash loop; it was never promoted. **Do not promote a candidate on build success alone.**

The unchanged production agent passed the same isolated synthetic English/Spanish test, including final translations in both directions and at least 4.08s / 5.89s of non-silent translated audio. This verifies the current service path, not a candidate rollout or linguistic accuracy. The reusable harness is `livekit-app/translation-agent/scripts/verify_rtc_smoke.py` (macOS synthetic voices, RTC 1.2.0, current CLI; explicit test room required). No human microphone or customer conversation was used.

## Remaining launch gates

1. Owner completes Stripe onboarding and supplies live-mode keys, live recurring prices, and a live webhook signing secret through secure admin configuration. Never paste secrets into chat. Verify live account capabilities and approved real-payment/refund flow before accepting paying customers.
2. Obtain runtime termination details from LiveKit Cloud dashboard/support, resolve the named-agent runtime failure, pass real two-way captions/audio on the candidate, then promote the tested image and verify production. No support message was sent. Preserve the previous production version for rollback.
3. Complete hosted Checkout/portal/3DS browser flows, password recovery to an owner-approved mailbox, and physical iOS/Safari/Android microphone/reconnect checks. The Resend sender domain `lalia.cloud` was verified; actual recipient delivery was not tested.
4. Run a representative multilingual concurrency/long-call soak and verify usage accuracy. No capacity or language-quality certification is implied by unit tests or a short synthetic smoke.
5. Verify recurring off-host PostgreSQL and local-upload backups with a restore drill. Deployment preserves uploads, but that is not backup verification. Confirm business/legal identity, policies, and support ownership.

Keep one backend worker until subscription reconciliation uses database-level serialization/versioning. Current verification confirmed one PM2 fork worker; local locks do not coordinate multiple replicas.

## Primary references

- [LiveKit agent servers](https://docs.livekit.io/agents/server/) and [job lifecycle](https://docs.livekit.io/agents/server/job/)
- [Cloud Docker builds](https://docs.livekit.io/deploy/agents/builds/) and [named deployments](https://docs.livekit.io/deploy/agents/deployments/)
- [LiveKit CLI 2.19.4](https://github.com/livekit/livekit-cli/releases/tag/v2.19.4)
- [Stripe testing](https://docs.stripe.com/testing), [billing testing](https://docs.stripe.com/billing/testing), and [pending cancellation](https://docs.stripe.com/billing/subscriptions/cancel#stop-a-pending-cancellation)

The named-deployment source-build path is intentional: the CLI's `--image` / `--image-tar` paths ignore `--deployment`. Always specify `--deployment launch-canary` when deleting the canary; omitting it targets the whole agent. Secrets are shared between named deployments, so do not modify shared secrets as a canary experiment.
