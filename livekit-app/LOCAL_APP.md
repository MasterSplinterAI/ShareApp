# Local app development (UI, auth, meetings — no video agent)

Use this when you want to **sign up, log in, and click around the v2 app** in your browser. LiveKit rooms are optional; the rest of the product works without the translation agent.

## One-time setup

```bash
cd livekit-app/backend
cp .env.example .env   # skip if you already have .env
```

**Required in `backend/.env`:**

```bash
JWT_SECRET_V2=$(openssl rand -hex 32)   # paste into .env — backend will not start without this
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5174
```

Your existing LiveKit keys can stay as-is for when you do test rooms later.

Install deps once:

```bash
cd livekit-app/backend && npm install
cd ../frontend && npm install
```

## Start (backend + frontend only)

```bash
cd livekit-app
./start_local_app.sh
```

Open:

| URL | Purpose |
|-----|---------|
| http://localhost:5174/ | Landing page |
| http://localhost:5174/v2/signup | Create account |
| http://localhost:5174/v2/login | Sign in |
| http://localhost:5174/v2/app | Workspace (after login) |

API health: http://localhost:3001/api/health

## Stop

```bash
cd livekit-app
./stop_local_app.sh
```

## Logs

```bash
tail -f livekit-app/backend.log livekit-app/frontend.log
```

## Full stack (with translation agent)

For live captions / translation in a room, use `./start_local.sh` instead (backend + frontend + agent). See `LOCAL_DEBUG.md`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `ECONNREFUSED` on `/api/v2/...` in Vite console | Backend not running — run `./start_local_app.sh` and check `backend.log` |
| Backend crash: `JWT_SECRET_V2 is required` | Add `JWT_SECRET_V2=<32+ char random>` to `backend/.env` |
| Login works on staging but not locally | Local SQLite is separate — sign up again at `/v2/signup` or use credentials you created locally |
| Port in use | `./stop_local_app.sh` then restart |
