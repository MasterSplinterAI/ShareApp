# Lalia launch-readiness implementation plan

> Execution: coordinated isolated worktree, focused agent ownership, regression tests before fixes, review before deployment.

**Goal:** verify current LiveKit compatibility, repair confirmed launch blockers, exercise sandbox billing and essential user flows, and produce an evidence-based release decision.

**Baseline:** deployed web commit 9be3bbc; LiveKit codeswitch build 4f72e28, cloud version sUuVnNMCMHJP. Production public URL is https://lalia.cloud; staging names are historical aliases, not isolation.

## 1. Evidence and configuration
- [x] Inspect live agent status/module/dispatch name and SDK versions.
- [x] Compare official current LiveKit docs and release notes.
- [x] Read effective Stripe/email settings without exposing credentials.
- [ ] Verify sandbox payment scenarios and canonical webhook configuration.
- [ ] Verify live-mode setup separately; never treat sandbox success as live-payment readiness.

## 2. Billing (billing agent)
- [ ] Regression tests for unpaid checkout, stale events, price-to-plan changes, duplicate checkout, and usable Free after cancellation.
- [ ] Implement authoritative Stripe-state reconciliation and duplicate-checkout safeguards.
- [ ] Disable automatic overage collection for launch; keep overlapping-cycle/open-ledger accounting outside paid collection until separately repaired/tested.
- [ ] Run complete backend suite and sandbox API lifecycle checks.

## 3. Access and recovery (flow agent)
- [ ] Regression tests and fix for guest provider-admin elevation across organizations/stale JWTs.
- [ ] Canonical password-reset links independent of untrusted request headers.
- [ ] Fix paid upgrade routing, password-validation logout, and invisible prejoin media errors with UI coverage.

## 4. Cloud agent (LiveKit agent)
- [ ] Restrict legacy room-global voice updates to authorized admins.
- [ ] Require actual credentials for direct provider plugins; correct Cloud-hosting assumptions.
- [ ] Preserve verified SDK versions; harden signal handling and bounded shutdown.
- [ ] Full helper tests, real room smoke, safe rollout and rollback reference.

## 5. Transcript policy (root)
- [ ] Resolve current opt-in privacy promise versus default-on storage; requested preference from user.
- [ ] Test meeting/direct-call defaults and explicit host choice; preserve existing stored records/settings.

## 6. Release evidence
- [ ] Full backend/Python regression tests, focused desktop/mobile browser flows, production build.
- [ ] Review integrated changes and deploy only tested candidate.
- [ ] Verify production health, migrations, source identity, and sandbox webhook delivery.
- [ ] Publish launch readiness with remaining owner actions and unverified manual/load gates clearly separated.
