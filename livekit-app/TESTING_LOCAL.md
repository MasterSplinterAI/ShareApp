# 🧪 Local Testing Guide

## Quick Test Steps

### 1️⃣ Start All Services (if not already running)
```bash
# Terminal 1 - Backend
cd livekit-app/backend
npm run dev

# Terminal 2 - Frontend  
cd livekit-app/frontend
npm run dev

# Terminal 3 - Translation Agent
cd livekit-app/translation-agent
source venv/bin/activate
python realtime_agent.py dev
```

### 2️⃣ Open Browser
- Go to: **http://localhost:5174**

### 3️⃣ Host a Meeting
1. Click **"Host a Meeting"**
2. Enter your name
3. Click **"Continue"**

### 4️⃣ Join from Another Window
1. Copy the shareable link
2. Open in incognito/private window
3. Enter a different name
4. Join the meeting

### 5️⃣ Test Features

#### Video/Audio
- ✅ Camera toggle
- ✅ Microphone toggle
- ✅ Speaker selection
- ✅ Screen sharing

#### Translation
1. Click language selector (top-right)
2. Choose a language:
   - 🇪🇸 Spanish
   - 🇫🇷 French
   - 🇩🇪 German
   - 🇮🇹 Italian
   - 🇵🇹 Portuguese
   - 🇷🇺 Russian
   - 🇯🇵 Japanese
   - 🇰🇷 Korean
   - 🇨🇳 Chinese
   - 🇸🇦 Arabic
   - 🇮🇳 Hindi

3. Toggle **"Enable Translation"**
4. Watch for test transcriptions (appear every 5 seconds)

#### Chat
- Send messages
- Links are clickable
- Emoji support

### 6️⃣ Monitor Agent Activity

Watch the terminal running `realtime_agent.py`:
```
INFO - Translation Agent starting in room: room-xxx
INFO - Connected to room with 0 participants
INFO - Participant connected: TestUser
INFO - Language update from TestUser: es (enabled: true)
INFO - Translation activated for TestUser -> es
INFO - Sent test transcription to TestUser
```

## Testing Matrix

| Feature | Status | How to Test |
|---------|--------|-------------|
| Room Creation | ✅ | Click "Host a Meeting" |
| Room Joining | ✅ | Use shareable link |
| Video | ✅ | Toggle camera button |
| Audio | ✅ | Toggle mic button |
| Screen Share | ✅ | Click screen share button |
| Chat | ✅ | Send messages |
| Language Selection | ✅ | Choose from dropdown |
| Translation Toggle | ✅ | Enable/disable switch |
| Agent Connection | ✅ | Check LiveKit dashboard |
| Test Transcriptions | ✅ | Enable translation, wait 5s |

## Troubleshooting

### Can't connect to room?
- Check backend is running: `curl http://localhost:3001/api/auth/token`
- Check .env file has LiveKit credentials

### Agent not connecting?
- Check .env has LIVEKIT_API_KEY, LIVEKIT_API_SECRET, OPENAI_API_KEY
- Check agent logs for errors

### No video/audio?
- Browser permissions: Allow camera/microphone
- Check LiveKit Cloud dashboard for room activity

### Translation not working?
- Ensure agent is running
- Check language is selected and enabled
- Look for test transcriptions first

## Mobile Testing

1. Get your local IP:
   ```bash
   ipconfig getifaddr en0  # Mac
   ```

2. Access from mobile:
   ```
   http://YOUR_IP:5174
   ```

3. Or scan QR code in share modal

## What's Next?

The app is ready for testing! The translation agent currently:
- ✅ Connects to rooms
- ✅ Receives language preferences
- ✅ Sends test transcriptions

To add real translation:
- Implement audio processing pipeline
- Add OpenAI Whisper for STT
- Add GPT-4 for translation
- Add OpenAI TTS for speech synthesis
