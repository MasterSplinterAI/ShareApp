# Local Testing Guide

This guide will help you run the entire application locally for testing and debugging.

## Prerequisites

1. **Node.js** (v18+)
2. **Python 3** (v3.8+)
3. **npm** packages installed in `backend/` and `frontend/`
4. **Python venv** set up in `translation-agent/`

## Quick Start

### Option 1: Use the test script (Recommended)

```bash
# Make the script executable
chmod +x test-local.sh

# Run everything
./test-local.sh
```

### Option 2: Manual setup

#### Step 1: Start the Backend

```bash
cd backend
npm install  # If not already installed
npm run dev  # Runs with nodemon for auto-reload
# OR
npm start    # Runs without auto-reload
```

Backend will run on: `http://localhost:3000`

#### Step 2: Start the Frontend (in a new terminal)

```bash
cd frontend
npm install  # If not already installed
npm run dev  # Runs Vite dev server
```

Frontend will run on: `http://localhost:5173`

#### Step 3: Test Translation Agent (when needed)

The translation agent will be automatically started by the backend when you enable translation in a meeting.

To test it manually:
```bash
cd translation-agent
source venv/bin/activate  # On Windows: venv\Scripts\activate
python agent.py
```

## Environment Variables

Make sure these are set in `backend/.env`:

```bash
DAILY_API_KEY=your_daily_api_key
OPENAI_API_KEY=your_openai_api_key
PORT=3000
FRONTEND_URL=http://localhost:5173
```

And in `translation-agent/.env`:

```bash
OPENAI_API_KEY=your_openai_api_key
```

## Testing Flow

1. **Start Backend**: `cd backend && npm run dev`
2. **Start Frontend**: `cd frontend && npm run dev`
3. **Open Browser**: Go to `http://localhost:5173`
4. **Create/Join Meeting**: Use the UI to create or join a meeting
5. **Enable Translation**: Click the translation toggle (host only)
6. **Select Language**: Choose your preferred language
7. **Speak**: Start speaking and watch for transcriptions

## Debugging

### Backend Logs
- Backend logs will appear in the terminal where you ran `npm run dev`
- Look for:
  - `Translation agent started for meeting...`
  - `OPENAI_API_KEY from process.env: ...`
  - `Translation agent agent-xxx: ...`

### Frontend Logs
- Open browser DevTools (F12)
- Check Console tab for:
  - `Translation enabled: true`
  - `Language selector should be visible`
  - Any API errors

### Translation Agent Logs
- Check backend terminal output (agent logs are piped there)
- Look for:
  - `Translation Agent Starting...`
  - `Attempting to connect to OpenAI Realtime API...`
  - `WebSocket connection established`
  - `[Speaker: xxx -> Listener: xxx] Transcription: ...`

## Common Issues

### Backend won't start
- Check if port 3000 is already in use: `lsof -i :3000`
- Verify `.env` file exists and has correct values
- Run `npm install` in `backend/` directory

### Frontend won't start
- Check if port 5173 is already in use: `lsof -i :5173`
- Run `npm install` in `frontend/` directory
- Clear Vite cache: `rm -rf frontend/node_modules/.vite`

### Translation agent not starting
- Check Python venv is activated: `which python` should point to `venv/bin/python`
- Verify `OPENAI_API_KEY` is set in both `backend/.env` and `translation-agent/.env`
- Check Python dependencies: `pip list` should show `daily-python`, `openai`, `numpy`, etc.

### No transcriptions appearing
- Check backend logs for OpenAI connection errors
- Verify translation is enabled in the meeting
- Check browser console for API errors
- Verify language is selected in the UI

## API Endpoints (for testing with curl)

```bash
# Health check
curl http://localhost:3000/api/health

# Create meeting
curl -X POST http://localhost:3000/api/meetings/create

# Get meeting token
curl "http://localhost:3000/api/auth/daily-token?roomName=test-room&userName=TestUser&isOwner=true"

# Start translation
curl -X POST http://localhost:3000/api/translation/start \
  -H "Content-Type: application/json" \
  -d '{"meetingId": "test-room", "token": "your-token"}'

# Check translation status
curl http://localhost:3000/api/translation/status/test-room

# Get transcriptions
curl http://localhost:3000/api/translation/transcriptions/test-room/participant-id
```

## Next Steps

Once everything is running locally:
1. Test meeting creation and joining
2. Test audio/video streaming
3. Enable translation and test transcription
4. Test language selection
5. Test with multiple participants

