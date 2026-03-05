# Translation Agent Deployment Guide

This guide covers deploying the translation agent to LiveKit Cloud and verifying the full production stack (backend, frontend, agent).

## Architecture Overview

- **Backend + Frontend**: Deployed to production server via `deploy.sh` (SSH, git fetch, build, PM2)
- **Translation Agent**: Deployed to **LiveKit Cloud** (not on the production server) via `lk agent deploy`

**Important**: `deploy.sh` does NOT auto-deploy the translation agent. Agent updates require a separate `lk agent deploy` after pushing code.

---

## Prerequisites

### LiveKit CLI (for agent deployment)

```bash
# macOS
brew install livekit-cli

# Or download from: https://docs.livekit.io/agents/v0/deployment/
```

Verify:

```bash
lk --version
```

### Authentication

```bash
lk cloud auth
```

Opens a browser window to authenticate. Once done, the CLI is linked to your LiveKit Cloud project.

---

## Deployment Steps

### 1. Commit and Push

```bash
git add -A
git commit -m "Your commit message"
git push origin main
```

### 2. Deploy Backend and Frontend (Production Server)

From the project root:

```bash
./deploy.sh
```

This script:
- Pushes to git if there are uncommitted changes
- SSHs to production server (`3.16.210.84`)
- Fetches latest code from git
- Builds frontend
- Copies backend and frontend to `/var/www/share-app/`
- Restarts backend via PM2 (`livekit-backend`)

### 3. Deploy Translation Agent (LiveKit Cloud)

After backend/frontend deploy, deploy the agent:

```bash
cd livekit-app/translation-agent
lk agent deploy
```

This will:
- Upload updated code (including `realtime_agent_simple.py`)
- Build a new container image
- Deploy to LiveKit Cloud with rolling deployment
- Update existing agent (uses `livekit.toml` agent ID)

### 4. Verify Deployment

**Agent status:**

```bash
lk agent status
```

**Agent logs:**

```bash
lk agent logs --tail 50
```

Look for:
- `Using Semantic VAD (eagerness=...) - reduces false interruptions`
- `Using hybrid architecture: OpenAI Semantic VAD + Silero VAD + Contextual Turn Detector`
- No errors during startup

**Server verification (SSH):**

```bash
ssh -i ~/Downloads/AxisAlgo.pem ubuntu@3.16.210.84
```

On the server:

```bash
pm2 status
pm2 logs livekit-backend --lines 50
```

---

## Agent Configuration

`livekit.toml` in `livekit-app/translation-agent/`:

```toml
[project]
  subdomain = "production-uiycx4ku"

[agent]
  id = "CA_kB6CS2YTqS56"
  name = "translation-cloud-prod"
  room_pattern = "room-*"
```

The agent ID tells LiveKit which existing agent to update when you run `lk agent deploy`.

---

## Environment Variables

### LiveKit Cloud Dashboard (Agent)

Set these in the LiveKit Cloud dashboard for your agent:

- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_URL` (e.g. `wss://production-uiycx4ku.livekit.cloud`)
- `OPENAI_API_KEY`
- `DEEPGRAM_API_KEY` (optional, for contextual turn detector)

### Production Server (Backend)

In `/var/www/share-app/livekit-app/backend/.env`:

- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_URL`
- `PORT` (e.g. 3001)
- `FRONTEND_URL`
- `NODE_ENV=production`

---

## Useful Commands

### Agent

```bash
lk agent deploy                  # Deploy updated code
lk agent status                  # Check status
lk agent logs --tail 100          # View logs
lk agent logs --follow           # Stream logs
lk agent versions                # List versions
lk agent rollback <version-id>   # Rollback if needed
lk agent list                    # List all agents
```

### Server (SSH)

```bash
ssh -i ~/Downloads/AxisAlgo.pem ubuntu@3.16.210.84
pm2 status
pm2 logs livekit-backend
pm2 restart livekit-backend      # If needed
```

---

## Troubleshooting

### Agent Not Found

- Verify `livekit.toml` has the correct agent ID (`CA_kB6CS2YTqS56`)
- Run `lk cloud auth`
- Run `lk agent list`

### Deployment Fails

- Ensure dependencies are in `requirements_livekit.txt`
- Check environment variables in LiveKit Cloud dashboard
- Inspect `lk agent logs`

### Code Changes Not Reflected

- Confirm changes are committed and pushed
- Redeploy: `lk agent deploy`
- If needed: `lk agent delete CA_kB6CS2YTqS56` then `lk agent deploy` (creates new agent)

### Backend Not Running on Server

- SSH to server and run `pm2 status`
- Restart: `pm2 restart livekit-backend`
- Check `.env` in backend directory

---

## Quick Reference

| Component      | Deploy Command                    | Location                    |
|---------------|-----------------------------------|-----------------------------|
| Backend       | `./deploy.sh`                     | Production server (PM2)     |
| Frontend      | `./deploy.sh`                     | Production server (static)  |
| Translation Agent | `cd livekit-app/translation-agent && lk agent deploy` | LiveKit Cloud |
