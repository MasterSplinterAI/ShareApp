# LiveKit App Testing Guide

This guide helps you test the complete LiveKit conferencing app with translation features.

## Prerequisites

Before testing, ensure you have:
1. LiveKit Cloud account with API credentials
2. All services running (backend, frontend, translation agent)
3. Multiple browser windows/devices for multi-participant testing

## Local Development Setup

### 1. Backend Setup
```bash
cd backend
npm install
cp env.example .env
# Add your LiveKit credentials to .env
npm run dev
# Backend runs on http://localhost:3001
```

### 2. Frontend Setup
```bash
cd frontend
npm install
npm run dev
# Frontend runs on http://localhost:5174
```

### 3. Translation Agent Setup
```bash
cd translation-agent
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp env.example .env
# Add your API keys to .env
python agent.py dev
```

## Test Scenarios

### Scenario 1: Basic Room Creation and Joining

1. **Create a Room**
   - Open http://localhost:5174
   - Click "Host a Meeting"
   - Enter your name (e.g., "Host")
   - You should enter the meeting room
   - Note the shareable link shown

2. **Join as Participant**
   - Open new browser window/incognito
   - Use the shareable link
   - Enter different name (e.g., "Guest")
   - Both participants should see each other

**Expected Results:**
- ✅ Video/audio works for both participants
- ✅ Screen sharing available
- ✅ Chat functionality works
- ✅ No login required

### Scenario 2: Translation Feature Testing

1. **Enable Translation Agent**
   - Ensure translation agent is running
   - Check agent logs show "connected to room"

2. **Test Single Language Translation**
   - Host speaks in English
   - Guest enables translation (globe icon)
   - Guest selects Spanish
   - Host speaks: "Hello, how are you?"
   - Guest should hear Spanish translation

3. **Test Multi-Language Support**
   - Add third participant
   - Each selects different target language
   - Verify each hears their selected language

**Expected Results:**
- ✅ Translation toggle works
- ✅ Language selection updates properly
- ✅ Transcriptions appear in display
- ✅ Audio translation plays for participants
- ✅ Original speaker hears no translation

### Scenario 3: Transcription Display

1. **Enable Transcriptions**
   - Enable translation for any participant
   - Transcription panel should appear
   - Speak several sentences

2. **Verify Display Features**
   - Original text shows
   - Translated text shows (if applicable)
   - Speaker names appear
   - Timestamps are correct
   - Auto-scroll works

**Expected Results:**
- ✅ Transcriptions appear in real-time
- ✅ Both original and translated text shown
- ✅ Can minimize/maximize panel
- ✅ Can close and reopen panel

### Scenario 4: Performance Testing

1. **Multiple Participants**
   - Create room with 4-5 participants
   - Enable translation for 2-3 participants
   - All speak simultaneously

2. **Monitor Performance**
   - Check CPU usage
   - Monitor network bandwidth
   - Verify audio quality remains good
   - Check translation latency

**Expected Results:**
- ✅ Latency < 2 seconds for translation
- ✅ No audio drops or quality issues
- ✅ UI remains responsive
- ✅ All participants receive translations

### Scenario 5: Edge Cases

1. **Network Issues**
   - Simulate poor connection (browser dev tools)
   - Verify graceful degradation
   - Check reconnection works

2. **Language Switching**
   - Change language mid-conversation
   - Toggle translation on/off rapidly
   - Verify no audio feedback loops

3. **Agent Failure**
   - Stop translation agent
   - Verify app continues working
   - Restart agent - verify reconnection

**Expected Results:**
- ✅ No app crashes on agent failure
- ✅ Language changes apply immediately
- ✅ Reconnection works smoothly

## Testing Checklist

### Frontend Testing
- [ ] Home page loads correctly
- [ ] Room creation works
- [ ] Join with link works
- [ ] Name modal functions properly
- [ ] Video/audio controls work
- [ ] Screen sharing works
- [ ] Chat functions properly
- [ ] Language selector works
- [ ] Transcription display works
- [ ] Share modal shows correct links
- [ ] Responsive design works

### Backend Testing
- [ ] Room creation API works
- [ ] Token generation works
- [ ] CORS properly configured
- [ ] Error handling works
- [ ] Environment variables load

### Translation Agent Testing
- [ ] Connects to LiveKit room
- [ ] Receives participant audio
- [ ] STT transcription works
- [ ] Translation accurate
- [ ] TTS generation works
- [ ] Audio injection works
- [ ] Multiple languages supported
- [ ] Handles disconnections

## Debugging Tips

### Check Browser Console
```javascript
// LiveKit connection status
console.log(room.state)

// Participant list
console.log(Array.from(room.participants.values()))

// Data channel messages
room.on('data_received', console.log)
```

### Backend Logs
- Check room creation logs
- Verify token generation
- Monitor API requests

### Agent Logs
- Verify room connection
- Check STT/TTS pipeline
- Monitor translation requests

### Common Issues

1. **No Translation Audio**
   - Check agent is running
   - Verify API keys are correct
   - Check participant has audio enabled
   - Verify language selection

2. **High Latency**
   - Check network connection
   - Verify closest LiveKit region
   - Monitor agent performance

3. **Transcription Not Showing**
   - Verify data channel connected
   - Check message format
   - Ensure translation enabled

## Performance Benchmarks

Target metrics for good user experience:
- Room join time: < 2 seconds
- Translation latency: < 2 seconds
- Audio quality: Opus 48kHz
- Video quality: 720p+ for active speaker
- CPU usage: < 30% per participant
- Memory usage: < 200MB frontend

## Test Automation

For automated testing, see `tests/` directory (to be implemented):
- Unit tests for components
- Integration tests for API
- E2E tests with Playwright
- Load testing with k6

Remember to test with real users in different network conditions and devices for best results!
