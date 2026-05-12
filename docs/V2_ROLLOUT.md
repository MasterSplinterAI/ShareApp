# V2 rollout and operations

## Environments

| Environment | Branch / deploy | Frontend URL | Notes |
|-------------|-----------------|---------------|--------|
| Production classic | `main` + `deploy.sh` | `FRONTEND_URL` (e.g. share) | Legacy `/` unchanged |
| Staging V2 | `v2-foundation` + `deploy-staging.sh` | `staging` host | Isolated `PORT`, DB, and static root |

## Environment variables

### Backend (`livekit-app/backend/.env`)

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET_V2` | Signing key for V2 session JWTs (required in production) |
| `V2_DB_PATH` | Optional absolute path to `v2-platform.db` |
| `V2_AUTO_CHARGE_ENABLED` | Set to `true` when Stripe (or other) overage charging is wired (default off) |
| `STAGING_FRONTEND_URL` | Optional; CORS for staging origin |
| Existing `LIVEKIT_*`, `FRONTEND_URL`, `AGENT_NAME` | Shared with classic room flow |

### Frontend (build-time)

| Variable | Purpose |
|----------|---------|
| `VITE_V2_ENTRY_ENABLED` | When `true`, classic home shows **Try V2 workspace** (default omit/`false` in prod until ready) |
| `VITE_API_URL` | Optional override for API base (usually leave default `/api` behind nginx) |

## Rollout checklist

1. Deploy backend with new dependencies: `npm install` in `livekit-app/backend` (includes `bcryptjs`, `multer`, `jsonwebtoken` already).
2. Ensure `JWT_SECRET_V2` is set on the server before accepting real users.
3. Run staging deploy; verify `GET /api/v2/health` and `GET /api/health`.
4. Smoke test: signup → create meeting → host join → classic `/room/:name` still works.
5. Enable `VITE_V2_ENTRY_ENABLED=true` on staging build only; verify classic home unchanged when flag off.
6. For production: merge `v2-foundation` when ready, deploy `main`, then set `VITE_V2_ENTRY_ENABLED=true` after internal validation.

## Persistence

- `v2-platform.db` (SQLite) and `uploads/v2/` are **excluded from rsync delete** in `deploy.sh` / `deploy-staging.sh` so deploys do not wipe tenant data.
- Back up `v2-platform.db` with your normal server backup policy.

## Auto-charge (later)

1. Implement Stripe customer + payment method on org.
2. Set `V2_AUTO_CHARGE_ENABLED=true` only after webhook verification and idempotent settlement jobs are tested.
3. Use existing dry-run: `POST /api/v2/billing/settle-dry-run` (authenticated owner/admin) to reconcile usage vs plan before charging.

## Rollback

- Disable V2 entry: remove or set `VITE_V2_ENTRY_ENABLED=false` and redeploy frontend only.
- Disable V2 API: remove `app.use('/api/v2', ...)` from `server.js` and redeploy backend (classic `/api/*` unaffected).
