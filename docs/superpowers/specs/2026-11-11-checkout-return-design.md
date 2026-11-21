# Return Stripe Checkout customers to Billing

Status: approved by owner on November 12, 2026; implementation tracked in the November 12 plan.

## Observed problem

The signed-in sandbox test reproduced the same navigation defect after payment and cancellation. Account A bought Starter, returned with authentication intact, and had an active Starter subscription and paid $49 test invoice. Account B canceled a Pro Checkout, returned authenticated, and remained Free with no invoice or subscription. Both landed on the Profile section of Settings instead of Billing.

`backend/routes/v2/billing.js` creates return URLs ending in `/v2/app/settings?billing=success` and `?billing=cancel`. `frontend/src/v2/pages/V2OrgSettings.jsx` initializes its section from `section`, defaulting to `profile`. Success triggers subscription reconciliation but does not select Billing. Paths above are relative to `livekit-app/`.

The configured frontend host is `www.lalia.cloud`; nginx redirects it to `lalia.cloud` with the request URI preserved. Browser testing confirmed the existing apex login survived the return. No hostname or authentication change is needed for this defect.

## Recommended behavior

New Checkout sessions should use:

- Success: `/v2/app/settings?section=billing&billing=success`
- Cancellation: `/v2/app/settings?section=billing&billing=cancel`

The existing trusted configured frontend base remains unchanged. Do not derive a return host from untrusted request headers.

Settings should also select Billing when a recognized `billing=success`, `billing=cancel`, or `billing=portal` marker is present and no explicit `section` is provided. This supports existing open Checkout sessions and historical return URLs. An explicit section keeps its existing precedence; unknown billing markers do not override the normal Profile default. Apply this when return search parameters change as well as on initial render, without continually resetting a user's subsequent manual tab selection for an unchanged URL.

Subscription state remains authoritative. A success query parameter does not grant entitlements, mark an invoice paid, or change the plan. Preserve the existing reconciliation behavior and error handling. A canceled Checkout remains unpaid and leaves the current plan unchanged.

## Alternatives

1. Backend URLs plus frontend compatibility fallback (recommended): correct new sessions and existing sessions with a small, focused change.
2. Backend URLs only: smaller diff, but existing Checkout sessions still return to Profile.
3. Frontend fallback only: repairs the visible behavior, but leaves new return URLs implicit instead of naming the intended Settings section.

## Verification and acceptance

Add a focused backend regression that captures Stripe session creation parameters and checks both return URLs preserve the configured origin and specify `section=billing` with the correct success/cancel marker. Retain card-only payment methods and existing checkout idempotency behavior.

Add frontend navigation regressions covering success, cancel, and portal legacy returns without `section`; new explicit Billing URLs; normal Settings defaulting to Profile; unknown markers; explicit section precedence; and an in-app URL transition into a recognized legacy return. Do not simulate paid access solely from the return query.

After the existing relevant test suites pass, deploy only through the separately approved release procedure. Repeat the browser flow with fresh disposable accounts and Stripe TEST mode: A signs in, buys Starter, returns authenticated directly to Billing, sees the correct plan, and has a paid test invoice; B starts and cancels Pro Checkout, returns directly to Billing as the same B user, remains Free, and has no paid invoice. Verify backend tenant isolation and processed webhooks. Clean the exact test fixtures afterward.

Stripe must remain TEST and automatic overage charging must remain off. No real-tenant, global settings, email, or live-payment changes are part of this design.

## Evidence

Sanitized pre-fix API results, parent-observed browser outcomes, and fixture cleanup are recorded in `docs/launch/evidence/2026-11-11-signed-checkout.json`. The test ran on 12 November UTC / 11 November America/New_York. It establishes a navigation defect, not an authentication or entitlement defect.
