# V2 rollout and operations

## Environments

| Environment | Branch / deploy | Frontend URL | Notes |
|-------------|-----------------|---------------|--------|
| Production classic | `main` + `deploy.sh` | `FRONTEND_URL` (e.g. share) | Legacy `/` unchanged |
| Staging V2 | `v2-foundation` + `deploy-staging.sh` | `staging` host | Isolated `PORT`, DB, and static root. **Nginx:** use `deploy/nginx-staging.jarmetals.com.conf` — HTML must be `no-cache` so SPA picks up new hashed JS after deploys. |

## Staging static caching

- Reference vhost: [deploy/nginx-staging.jarmetals.com.conf](../deploy/nginx-staging.jarmetals.com.conf) — hashed assets `Cache-Control: public, immutable`; `location /` uses `no-cache` for `index.html`.
- Without this, browsers may cache an old `index.html` and never load new bundles after deploy.

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
| `VITE_V2_ENTRY_ENABLED` | **Deprecated / unused.** Classic home is marketing + V2 is default; the flag is no longer read by the app. |
| `VITE_API_URL` | Optional override for API base (usually leave default `/api` behind nginx) |

### Backend feature flags (runtime)

| Variable | Purpose |
|----------|---------|
| `V2_DEFAULT_REQUIRE_INVITE` | When not `0`, new meetings require `?i=` invite token for guests (default on). Set to `0` to allow room-name-only guest links for new meetings. |
| `V2_DEFAULT_INVITE_TTL_DAYS` | Default expiry for auto-created “Default guest link” (default `7`). |
| `V2_SUPERADMIN_EMAILS` | Comma-separated emails allowed to call `GET /api/v2/orgs/admin/*` platform routes. **Must match the email on the user’s JWT** (the address they signed up with). Restart backend after changing. |

## Rollout checklist

1. Deploy backend with new dependencies: `npm install` in `livekit-app/backend` (includes `bcryptjs`, `multer`, `jsonwebtoken` already).
2. Ensure `JWT_SECRET_V2` is set on the server before accepting real users.
3. Run staging deploy; verify `GET /api/v2/health` and `GET /api/health`.
4. Smoke test: signup → create meeting → host join → `/room/:name` still works; `/` shows marketing landing.
5. ~~Enable `VITE_V2_ENTRY_ENABLED`~~ (removed): staging uses the same SPA as production for V2 paths.
6. For production: merge `v2-foundation` when ready and deploy `main` per `deploy.sh`.

## Persistence

- `v2-platform.db` (SQLite) and `uploads/v2/` are **excluded from rsync delete** in `deploy.sh` / `deploy-staging.sh` so deploys do not wipe tenant data.
- Back up `v2-platform.db` with your normal server backup policy.
- **Scale note:** SQLite is appropriate for early SaaS; for larger multi-tenant admin workloads plan a managed PostgreSQL migration (schema mirrors `v2_*` tables).

## Meeting policies and invite links

- New meetings (after this release) get a `v2_meeting_policies` row and, when `V2_DEFAULT_REQUIRE_INVITE` is on, a **Default guest link** with expiry.
- Public join preview: `GET /api/v2/join-info?roomName=&i=` (no auth). Guest LiveKit token: `POST /api/v2/guest-token` with `{ roomName, participantName, inviteToken }`.
- Org members: `GET/POST/PATCH/DELETE /api/v2/orgs/members*`. Platform admin: `GET /api/v2/orgs/admin/ping`, `GET /api/v2/orgs/admin/orgs`, `PATCH /api/v2/orgs/admin/orgs/:orgId` (superadmin emails only).
- **Org files API** (`/api/v2/files`): unmounted from the default V2 router; product UX is in-meeting file share only (planned, e.g. S3). The route module may remain in the repo for future reuse.

## Auto-charge (later)

1. Implement Stripe customer + payment method on org.
2. Set `V2_AUTO_CHARGE_ENABLED=true` only after webhook verification and idempotent settlement jobs are tested.
3. Use existing dry-run: `POST /api/v2/billing/settle-dry-run` (authenticated owner/admin) to reconcile usage vs plan before charging.

## Rollback

- **Hide marketing / V2 UI:** not applicable via this flag anymore; use auth + routing or a separate deploy if needed.
- Disable V2 API: remove `app.use('/api/v2', ...)` from `server.js` and redeploy backend (classic `/api/*` unaffected).
