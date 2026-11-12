# Lalia launch-readiness implementation plan

> Execution: coordinated isolated worktree, focused agent ownership, regression tests before fixes, review before deployment.

**Goal:** verify current LiveKit compatibility, repair confirmed launch blockers, exercise sandbox billing and essential user flows, and produce an evidence-based release decision.

**Baseline:** deployed web commit 9be3bbc; LiveKit codeswitch build 4f72e28, cloud version sUuVnNMCMHJP. Production public URL is https://lalia.cloud; staging names are historical aliases, not isolation.

## 1. Evidence and configuration
- [x] Inspect live agent status/module/dispatch name and SDK versions.
- [x] Compare official current LiveKit docs and release notes.
- [x] Read effective Stripe/email settings without exposing credentials.
- [x] Verify sandbox payment scenarios and canonical webhook configuration.
- [ ] Verify live-mode setup separately; never treat sandbox success as live-payment readiness.

## 2. Billing (billing agent)
- [x] Regression tests for unpaid checkout, stale events, price-to-plan changes, duplicate checkout, and usable Free after cancellation.
- [x] Implement authoritative Stripe-state reconciliation and duplicate-checkout safeguards.
- [x] Disable automatic overage collection for launch; keep overlapping-cycle/open-ledger accounting outside paid collection until separately repaired/tested.
- [x] Run complete backend suite and sandbox API lifecycle checks.

## 3. Access and recovery (flow agent)
- [x] Regression tests and fix for guest provider-admin elevation across organizations/stale JWTs.
- [x] Canonical password-reset links independent of untrusted request headers.
- [x] Fix paid upgrade routing, password-validation logout, and invisible prejoin media errors with UI coverage.

## 4. Cloud agent (LiveKit agent)
- [x] Restrict legacy room-global voice updates to authorized admins.
- [x] Require actual credentials for direct provider plugins; correct Cloud-hosting assumptions.
- [x] Preserve verified SDK versions; harden signal handling and bounded shutdown.
- [x] Full helper tests, real room smoke, safe rollout and rollback reference.

## 5. Transcript policy (root)
- [x] Owner selected default-on transcripts with clear disclosure; align backend defaults, prejoin notices, privacy, and FAQs.
- [x] Test meeting/direct-call defaults and explicit host choice; preserve existing stored records/settings.

## 6. Release evidence
- [x] Full backend/Python regression tests, focused desktop/mobile browser flows, production build.
- [x] Review integrated changes and deploy only tested candidate.
- [x] Verify production health, migrations, source identity, and sandbox webhook delivery.
- [x] Publish launch readiness with remaining owner actions and unverified manual/load gates clearly separated.

## Release status

Backend `4fa02a1` is deployed and verified. LiveKit image `jN9YKCyo7vv9` is deployed after 40 canary and 24 production translation/audio checks with reconnects; rollback image `sUuVnNMCMHJP` is retained. Hosted sandbox Checkout/3DS/portal lifecycle checks passed. Stripe remains test mode by owner instruction; automatic overage charging remains off. See `docs/launch/2026-11-11-readiness.md` for evidence and limitations.

Owner decision follow-up: new meetings/direct calls save transcripts by default with clear prejoin disclosure and host opt-out. Existing records/settings are preserved. This is deployed and verified.

## Owner-authorized follow-up

- [x] Provision the approved private encrypted backup bucket and upload-only instance role, install daily backups, and restore an actual off-host recovery point in an isolated database.
- [x] Send one ordinary delivery test through the production mailer; provider delivery and Proton Primary inbox placement verified.
- [x] Complete password recovery with the subsequently approved existing Gmail account: real email/form observed, owner reset password on phone, token consumption and successful subsequent login verified.
- [x] Record mobile testing as owner-verified; this does not imply a documented device/browser matrix.
- [x] Publish Oracle Orchestration LLC as the confirmed Wyoming operator and disclose backup retention.
- [x] Publish and verify the Florida/Hillsborough/Tampa dispute clause with explicit owner approval.
- [ ] Independent legal review and any Florida foreign-LLC qualification assessment remain recommended follow-ups.
- [x] Update final readiness evidence and the existing PR after verification.
