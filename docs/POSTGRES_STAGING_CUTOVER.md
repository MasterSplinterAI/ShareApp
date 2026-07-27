# Staging Postgres cutover

## Prerequisites

- Postgres DB/role `lalia_staging` on the staging host
- Connection string at `/home/ubuntu/.lalia_staging_database_url` (chmod 600)

## Steps (after code is deployed)

```bash
# On staging host
cd /var/www/share-app-staging/livekit-app/backend
export DATABASE_URL="$(cat /home/ubuntu/.lalia_staging_database_url)"

# One-time import from existing SQLite (safe to re-run; conflicts skipped)
node db/importSqliteToPostgres.js ./v2-platform.db

# Wire app env (append once)
grep -q '^DATABASE_URL=' .env || echo "DATABASE_URL=$DATABASE_URL" >> .env

pm2 restart livekit-backend-staging --update-env
pm2 logs livekit-backend-staging --lines 40
```

Expect log: `[v2Database] Ready: postgres (migrations applied=…)`.

## Smoke

- `curl -sS https://staging.jarmetals.com/api/health` (or local `:3101`)
- Signup / login
- Create meeting, open Help launcher
- Admin org list loads

## Rollback

Remove `DATABASE_URL` from `.env`, restart PM2 — app returns to `v2-platform.db` (SQLite file was not deleted).
