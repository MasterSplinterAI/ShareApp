# Translation Troubleshooting Guide

## Issue: No Logs or Transcriptions Appearing

### Step 1: Check Backend Logs

When you click "Enable Translation", check your backend terminal. You should see:

```
Starting translation agent with: /path/to/venv/bin/python3 /path/to/agent.py
Working directory: /path/to/translation-agent
OPENAI_API_KEY present: true/false
Translation agent agent-1234567890 started for meeting room-xxx
Translation agent agent-1234567890 process spawned successfully
```

### Step 2: Check Python Agent Output

The backend should log Python agent output. Look for:

```
Translation agent agent-xxx: ============================================================
Translation agent agent-xxx: Translation Agent Starting...
Translation agent agent-xxx: ============================================================
Translation agent agent-xxx: MEETING_ID: room-xxx
Translation agent agent-xxx: DAILY_ROOM_URL: https://...
Translation agent agent-xxx: DAILY_TOKEN: ***...
Translation agent agent-xxx: OPENAI_API_KEY: ***...
```

### Step 3: Common Issues

#### Issue: "OPENAI_API_KEY not set"
**Fix:** Add to `backend/.env`:
```
OPENAI_API_KEY=sk-proj-your-key-here
```

#### Issue: "Translation agent exited with code 1"
**Possible causes:**
- Python dependencies not installed
- Daily.co Python SDK not installed
- Missing environment variables

**Fix:**
```bash
cd translation-agent
source venv/bin/activate
pip install daily-python openai python-dotenv numpy aiohttp websockets
```

#### Issue: "No logs at all"
**Possible causes:**
- Backend not receiving `/api/translation/start` request
- Frontend error preventing request

**Fix:**
1. Open browser console (F12)
2. Look for errors when clicking "Enable Translation"
3. Check Network tab for `/api/translation/start` request
4. Verify backend is running on correct port

#### Issue: "Agent starts but no transcriptions"
**Possible causes:**
- Agent not joining Daily.co room
- Audio not being captured
- OpenAI Realtime API not connecting

**Check:**
1. Look for "Translation agent joined meeting" in logs
2. Look for "Audio renderer set up" in logs
3. Look for "Connected to OpenAI Realtime API" in logs
4. Speak in the meeting and check for audio processing logs

### Step 4: Manual Testing

Test the agent manually:

```bash
cd translation-agent
source venv/bin/activate

export MEETING_ID=your-meeting-id
export DAILY_ROOM_URL=https://your-domain.daily.co/room-name
export DAILY_TOKEN=your-daily-token
export OPENAI_API_KEY=your-openai-key

python agent.py
```

You should see:
- Agent initialization
- Room join success
- Audio processing setup
- Transcription logs when you speak

### Step 5: Check Frontend

1. **Browser Console** - Check for errors
2. **Network Tab** - Verify API calls are successful
3. **TranslationDisplay Component** - Should appear at bottom when enabled
4. **Check API Response** - `/api/translation/start` should return `{ success: true }`

### Step 6: Verify Environment Variables

**Backend `.env` must have:**
```
DAILY_API_KEY=your-daily-api-key
OPENAI_API_KEY=your-openai-api-key
PORT=3000
FRONTEND_URL=http://localhost:5173
```

**Translation Agent** (set by backend automatically):
- MEETING_ID
- DAILY_ROOM_URL
- DAILY_TOKEN
- OPENAI_API_KEY (from backend .env)

### Step 7: Check Daily.co Room

1. Verify room exists: `GET /api/meetings/${meetingId}/info`
2. Verify token is valid
3. Verify room URL is correct format: `https://domain.daily.co/room-name`

### Debug Checklist

- [ ] Backend running on correct port
- [ ] Frontend can reach backend API
- [ ] `OPENAI_API_KEY` set in backend `.env`
- [ ] `DAILY_API_KEY` set in backend `.env`
- [ ] Python venv exists and has dependencies
- [ ] Agent process spawns (check backend logs)
- [ ] Agent joins Daily.co room (check agent logs)
- [ ] Audio renderer set up (check agent logs)
- [ ] OpenAI Realtime API connects (check agent logs)
- [ ] Participants speaking (check audio capture logs)
- [ ] Transcriptions stored (check backend `/api/translation/transcriptions` endpoint)

### Getting More Debug Info

Add to `backend/routes/translation.js`:
```javascript
// After spawning process
agentProcess.stdout.on('data', (data) => {
  console.log(`[AGENT STDOUT] ${data.toString()}`);
});

agentProcess.stderr.on('data', (data) => {
  console.error(`[AGENT STDERR] ${data.toString()}`);
});
```

This will show all Python agent output in backend logs.

