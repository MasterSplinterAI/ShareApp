# Lalia External Meeting Bot (`meeting-bot`)

Autonomous AI Notetaker worker that joins **Google Meet** and **Microsoft Teams** calls, captures remote WebRTC audio into `.mp3` recordings, streams speaker-attributed transcripts via Deepgram Nova-3 (`diarize=true`), and triggers Lalia's AI Summary & Email Recap pipeline.

## Local Development (macOS / Linux)

1. Ensure `BOT_WORKER_SECRET` is set in `livekit-app/backend/.env` and `livekit-app/meeting-bot/.env`:
   ```bash
   cp .env.example .env
   npm install
   npx playwright install chromium
   ```
2. Run unit tests:
   ```bash
   npm test
   ```
3. Start the worker (set `HEADLESS=false` in `.env` if you want to watch Chromium join the call live):
   ```bash
   npm start
   ```

## Production Container Build

Run this worker on an isolated container host (Railway, Fly.io, ECS, or a dedicated worker EC2) rather than on the primary Lalia web server:

```bash
docker build -t lalia-meeting-bot .
docker run --rm --env-file .env lalia-meeting-bot
```
