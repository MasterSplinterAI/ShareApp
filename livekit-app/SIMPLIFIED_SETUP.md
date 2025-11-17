# Simplified Setup with OpenAI Only

## The Truth About LiveKit and AI Services

**LiveKit provides:**
- ✅ Video/audio infrastructure
- ✅ WebRTC connectivity
- ✅ Agent framework (to run AI bots)

**LiveKit does NOT provide:**
- ❌ Speech-to-Text
- ❌ Translation
- ❌ Text-to-Speech

You need separate AI service API keys for these features.

## Good News: Use Your Existing OpenAI API Key!

Since you already use OpenAI with your Daily.co app, you can use the same API key here. OpenAI can handle everything:

- **Whisper** for Speech-to-Text
- **GPT-4** for translation
- **TTS API** for Text-to-Speech

## Super Simple Setup

### 1. Backend Configuration
Create `backend/.env`:
```env
# Your LiveKit credentials (already added)
LIVEKIT_URL=wss://jayme-rhmomj8r.livekit.cloud
LIVEKIT_API_KEY=APIqH4N3EmcMKkQ
LIVEKIT_API_SECRET=YjfZXR6HmqOMmgNQi2psANfCJe9A7e7h7VIbswo4im1D

PORT=3001
FRONTEND_URL=http://localhost:5174
```

### 2. Translation Agent Configuration
Create `translation-agent/.env`:
```env
# Same LiveKit credentials
LIVEKIT_URL=wss://jayme-rhmomj8r.livekit.cloud
LIVEKIT_API_KEY=APIqH4N3EmcMKkQ
LIVEKIT_API_SECRET=YjfZXR6HmqOMmgNQi2psANfCJe9A7e7h7VIbswo4im1D

# Your OpenAI API key (same one you use now)
OPENAI_API_KEY=sk-...your_key_here
```

### 3. Install and Run

```bash
# Backend
cd backend
npm install
npm run dev

# Frontend
cd frontend
npm install
npm run dev

# Translation Agent (simplified)
cd translation-agent
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements_openai.txt
python agent_openai.py dev
```

## Cost Comparison

### Your Current Setup (Daily.co + OpenAI)
- Daily.co: $0.004/min
- OpenAI Realtime: $0.06/min
- **Total: ~$0.064/min**

### New Setup (LiveKit + OpenAI)
- LiveKit: $0.004/min
- OpenAI Whisper: ~$0.006/min
- OpenAI GPT-4: ~$0.002/min
- OpenAI TTS: ~$0.015/min
- **Total: ~$0.027/min** (58% cheaper!)

## Why This is Better

1. **Simpler**: Only need LiveKit + OpenAI (2 services instead of 5)
2. **Cheaper**: Uses OpenAI's individual APIs instead of expensive Realtime API
3. **Familiar**: You already know OpenAI's services
4. **Flexible**: Can still add other providers later if needed

## Alternative: No Translation (Just Video)

If you want to start without translation:
1. Just run backend + frontend (skip translation agent)
2. Video conferencing will work perfectly
3. Add translation later when ready

## Quick Test

1. Start all services
2. Create a room
3. Join with another browser
4. Enable translation (globe icon)
5. Select a language
6. Speak and watch translations appear!

## Next Steps

1. Add your OpenAI API key to `translation-agent/.env`
2. Test the basic video conferencing
3. Test translation when ready
4. Deploy when everything works

That's it! Much simpler than the multi-provider setup.
