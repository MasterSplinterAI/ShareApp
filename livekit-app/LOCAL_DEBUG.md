# Local Agent Debugging

Run the translation agent locally to see logs in real time and debug transcription flow.

## No ngrok needed for the agent

The agent **connects outbound** to LiveKit. It does not need to receive incoming connections. No ngrok for the agent.

## Avoid cloud agent conflict

When testing locally, the cloud agent (`translation-cloud-prod`) may also auto-join rooms matching `room-*`. To avoid two agents in the same room, either:

- Pause/disable the cloud agent in the LiveKit Cloud dashboard, or
- Rely on explicit dispatch: the backend dispatches to `translation-bot-dev`, so your local agent gets the job. The cloud agent may still join; if you see duplicate behavior, disable it in the dashboard.

## Quick start (same machine)

```bash
cd livekit-app

# 1. Ensure backend has .env with LIVEKIT_* and AGENT_NAME=translation-bot-dev
# 2. Start everything (backend, frontend, agent)
./start_local.sh

# Or run agent only (if backend + frontend already running):
./start_local_agent.sh
```

Then open http://localhost:5174 and create a meeting. Agent logs go to `agent.log` or stdout if using `start_local_agent.sh`.

## Ngrok (for remote testing – phone, another device)

Use ngrok only when you need to reach the app from another device (e.g. test on phone while debugging on laptop).

```bash
# Terminal 1: Start local stack
./start_local.sh

# Terminal 2: Expose frontend
ngrok http 5174
```

Use the ngrok HTTPS URL (e.g. `https://abc123.ngrok-free.app`) to access the app. The frontend proxies `/api` to your local backend, so both work through one ngrok tunnel.

## Environment

**Backend** (`livekit-app/backend/.env`):
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- `AGENT_NAME=translation-bot-dev` (so it dispatches to your local agent)
- `PORT=3001`

**Agent** (`livekit-app/translation-agent/.env`):
- Same LiveKit credentials
- `AGENT_NAME=translation-bot-dev`
- `OPENAI_API_KEY` (for local STT/LLM; otherwise uses LiveKit Inference)
- `LIVEKIT_CLOUD=false` (use local OpenAI for faster iteration)

## Debug tips

- **Agent logs**: `tail -f livekit-app/agent.log` or run `./start_local_agent.sh` in foreground
- **Backend logs**: `tail -f livekit-app/backend.log`
- **Browser**: Add `?debug=1` to URL for transcription debug panel
- **Console**: Look for `📡 Transcription received:` when transcriptions arrive
