# Testing Guide for Translation Backend API

This guide helps you test the translation backend API and verify OpenAI integration.

## 1. Test Backend API Endpoints

### Check Backend Health
```bash
curl http://localhost:3000/health
# Should return: {"status":"ok","timestamp":"..."}
```

### Test Translation Status
```bash
curl http://localhost:3000/api/translation/status/room-7f3qce0p75g-mi0z57mo
# Should return: {"active":true/false,"agentId":"...","meetingId":"...","processRunning":true/false}
```

### Test Transcriptions Endpoint
```bash
curl http://localhost:3000/api/translation/transcriptions/room-7f3qce0p75g-mi0z57mo/28780cc9-5e09-49ae-8965-c68b97fc2b62
# Should return: {"meetingId":"...","participantId":"...","transcriptions":[]}
```

### Test Language Preferences
```bash
# Set language preference
curl -X POST http://localhost:3000/api/translation/language \
  -H "Content-Type: application/json" \
  -d '{"meetingId":"room-7f3qce0p75g-mi0z57mo","participantId":"28780cc9-5e09-49ae-8965-c68b97fc2b62","languageCode":"es"}'

# Get language preference
curl http://localhost:3000/api/translation/language/room-7f3qce0p75g-mi0z57mo/28780cc9-5e09-49ae-8965-c68b97fc2b62
```

## 2. Test OpenAI Realtime API Directly

### Run the Test Script
```bash
cd translation-agent
source venv/bin/activate
python3 test_openai.py
```

This script will:
- ✅ Connect to OpenAI Realtime API
- ✅ Send test audio
- ✅ Verify transcription callbacks work
- ✅ Verify audio output callbacks work

### Expected Output
```
============================================================
Testing OpenAI Realtime API Integration
============================================================
API Key: ***...your_key
1. Connecting to OpenAI Realtime API...
✅ Connected successfully!

2. Sending test audio (silence)...
✅ Test audio sent

3. Waiting for responses (5 seconds)...
============================================================
Test Results
============================================================
Transcriptions received: 0
  ⚠️  No transcriptions received (this is normal for silence)
Audio chunks received: 0
  ⚠️  No audio received (this is normal if no speech detected)

4. Closing connection...
✅ Connection closed

============================================================
✅ OpenAI Realtime API Test PASSED
============================================================
```

## 3. Test Full Translation Pipeline

### Step 1: Start Translation Agent
1. Join a Daily.co meeting
2. Click "Enable" on Translation Controls (host only)
3. Check backend logs: `pm2 logs share-app-backend`

### Step 2: Verify Agent Started
```bash
# On server
pm2 logs share-app-backend | grep "Translation agent"
# Should see: "Translation agent agent-XXX started for meeting room-XXX"
```

### Step 3: Speak and Check Logs
1. Speak into your microphone
2. Check backend logs for:
   - "Audio renderer set up for participant XXX"
   - "Processing audio with OpenAI"
   - "Transcription: ..."
   - "Injected translated audio for XXX"

### Step 4: Check Transcriptions API
```bash
curl http://localhost:3000/api/translation/transcriptions/room-XXX/participant-XXX
# Should return transcriptions array with text
```

## 4. Test on Production Server

### SSH into Server
```bash
ssh -i ~/Downloads/AxisAlgo.pem ubuntu@3.16.210.84
```

### Check Backend Status
```bash
pm2 status
pm2 logs share-app-backend --lines 50
```

### Test API Endpoints
```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/translation/status/room-XXX
curl http://localhost:3000/api/translation/transcriptions/room-XXX/participant-XXX
```

### Test OpenAI Integration
```bash
cd /var/www/share-app/translation-agent
source venv/bin/activate
python3 test_openai.py
```

## 5. Troubleshooting

### Issue: 404 on Transcriptions Endpoint
**Solution:** Ensure `backend/routes/translation.js` has the `/transcriptions/:meetingId/:participantId` route and restart backend:
```bash
pm2 restart share-app-backend
```

### Issue: No Transcriptions Appearing
**Check:**
1. Translation agent is running: `pm2 logs share-app-backend | grep "agent"`
2. Audio renderer is set up: Look for "Audio renderer set up"
3. OpenAI connection: Look for "Connected to OpenAI Realtime API"
4. Audio is being processed: Look for "Processing audio with OpenAI"

### Issue: OpenAI API Errors
**Check:**
1. API key is set: `echo $OPENAI_API_KEY`
2. Run test script: `python3 test_openai.py`
3. Check OpenAI dashboard for usage/errors

### Issue: No Audio Injection
**Check:**
1. CustomAudioTrack is created: Look for "Added custom audio track"
2. Audio frames are written: Look for "Injected translated audio"
3. Daily.co SDK version compatibility

## 6. Monitoring

### Real-time Logs
```bash
# Backend logs
pm2 logs share-app-backend --lines 100

# Filter for translation
pm2 logs share-app-backend | grep -E "translation|agent|OpenAI|audio"
```

### Check Agent Process
```bash
ps aux | grep "agent.py"
# Should see Python process running
```

### Check API Response Times
```bash
time curl http://localhost:3000/api/translation/status/room-XXX
```

## 7. Performance Testing

### Test Multiple Participants
1. Join meeting with 2+ participants
2. Enable translation
3. Have each participant speak
4. Verify each gets their own translation

### Test Language Switching
1. Set language preference to Spanish
2. Speak in English
3. Verify transcription appears in Spanish
4. Change language to French
5. Verify new transcriptions appear in French

