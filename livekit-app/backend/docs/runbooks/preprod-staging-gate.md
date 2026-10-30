# Pre-production staging gate (before SEO)

Complete this checklist on **staging** before starting any SEO / marketing work. SEO is explicitly out of scope until this gate is green.

## Environment

| Check | How |
| --- | --- |
| Strong JWT | `JWT_SECRET_V2` ≥ 32 chars, not a placeholder (`change-me`, `secret`, etc.). Backend refuses weak secrets. |
| Stripe webhook secret | Set in Admin → Billing **or** `STRIPE_WEBHOOK_SECRET`. Unsigned Stripe webhooks fail in production. |
| Resend inbound secret | Set in Admin → Communications **or** `RESEND_WEBHOOK_SECRET`. Unsigned Resend inbound fails in production. |
| Platform secrets at rest | Stripe + Resend keys saved via Admin encrypt with `secretCrypto` (AES-GCM). Plaintext rows re-encrypt on read. |
| Stable encryption key | Set `SETTINGS_ENCRYPTION_KEY` (32+ random bytes hex) **separately from** `JWT_SECRET_V2` so JWT rotation never bricks Admin secrets. |
| Settlement scheduler | `V2_OVERAGE_SETTLEMENT_INTERVAL_MS=3600000` (or rely on default 1h when `NODE_ENV=production` / `APP_ENV=staging`). Confirm Admin → Billing shows scheduler **on**. |
| LiveKit staging project | Use **separate** LiveKit project / API keys from production (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, webhook). Do not share prod keys. |
| Deploy hygiene | Prefer clean git tree; `deploy-staging.sh` no longer auto `git add -A`. |

## Billing / overage (Stripe test mode)

1. Dual opt-in: platform “Allow customers to opt in to overage auto-charge” **and** org Settings → Billing opt-in.
2. Confirm copy: charges are **after the billing period** for soft overage only; hard stop still at **2×** (not an instant top-up).
3. Dry-run: close a test cycle (or use Admin settle) with pending ledger → draft invoice items → finalize → ledger moves to `pending_payment` / `charged` (never `charged` before finalize).
4. Optional: one real **test-mode** invoice payment + webhook `invoice.paid` → ledger `charged`.
5. Dispute path still works (existing Admin dispute UI / webhook handlers).

## Usage warnings & hard stop (manual)

1. Soft-overage meeting: past included minutes, under hard cap — meeting continues; Settings / upgrade copy says soft overage, not “limit reached” as a hard stop.
2. Near hard-cap banner: host sees in-meeting usage banner (~90% of hard cap).
3. Hard-cap create/join blocked for new hosts/guests; guest join-info/message for `hard_cap_*` when invite is valid.
4. Live kick / `ROOM_DELETED` for usage limit shows limit-specific message + Settings/Upgrade CTA (not generic “Meeting ended”).
5. Email alerts at ~80% included, 100% included, ~90% hard cap (owners/admins; 1/day dedupe).

## Security smoke

1. `join-info` **without** a valid invite token: no title / meetingId / branding leak.
2. Guest LiveKit identity is `guest-{uuid}` (display name is metadata/`name` only).
3. `POST /api/quality-events` without quality token or session JWT → 401.

## Automated regression (local / CI)

```bash
cd livekit-app/backend
node --test test/launchReadiness.test.js test/usageAlerts.test.js test/overageSettlement.test.js
node scripts/check-preprod-env.js   # critical gates from local/staging .env
```

On the staging host after deploy:

```bash
cd /var/www/share-app-staging/livekit-app/backend
node scripts/check-preprod-env.js
pm2 logs livekit-backend-staging --lines 50 | grep -E 'overage-settlement|error' || true
curl -sS http://127.0.0.1:3101/api/health
```

## Production cutover (same code path)

When promoting this build to the production server, repeat the env table with **production** LiveKit + Stripe **live** keys (never reuse staging secrets). Minimum:

1. `JWT_SECRET_V2` strong and unique to prod.
2. Stripe live secret + webhook endpoint pointing at prod `/api/v2/billing/webhook`.
3. Resend webhook secret set (fail-closed inbound).
4. `V2_OVERAGE_SETTLEMENT_INTERVAL_MS=3600000` (or `NODE_ENV=production` default).
5. Confirm Admin → Billing: payments on, auto-charge platform flag intentional, pending ledger KPI visible.
6. Smoke: create meeting → guest join with invite → soft-overage copy → hard-cap block path.
7. Do **not** run SEO work until staging gate above is green.

## Exit criteria

All tables above checked on staging, settlement run observed (or dry-run), hard-stop UX verified once. Then open a **separate** SEO plan.
