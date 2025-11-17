# LiveKit Translation Agent

Real-time audio translation agent for LiveKit conferences using STT → Translation → TTS pipeline.

## Features

- Real-time speech-to-text transcription
- Multi-language translation
- Natural text-to-speech synthesis
- Automatic language detection
- Per-participant language preferences
- Low-latency audio processing

## Setup

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure environment:**
   ```bash
   cp env.example .env
   # Edit .env with your API keys
   ```

3. **Required API Keys:**
   - LiveKit API Key & Secret
   - Deepgram API Key (for STT)
   - Google Cloud credentials (for translation)
   - ElevenLabs API Key (for TTS)

## Running the Agent

### Development Mode
```bash
python agent.py dev
```

### Production Mode
```bash
python agent.py start
```

### With specific room
```bash
python agent.py dev --room-name "test-room"
```

## Language Support

### STT (Deepgram)
Supports 30+ languages including:
- English, Spanish, French, German, Italian
- Chinese, Japanese, Korean
- Arabic, Hindi, Russian
- And many more

### Translation (Google Translate)
Supports 100+ languages with high-quality neural translation

### TTS (ElevenLabs)
Natural voices available for major languages

## Architecture

```
Participant Audio → STT (Deepgram) → Translation (Google) → TTS (ElevenLabs) → Translated Audio
```

Each participant can:
1. Select their preferred output language
2. Enable/disable translation
3. Receive transcriptions in addition to audio

## Environment Variables

```bash
# LiveKit Configuration
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret
LIVEKIT_URL=wss://your-project.livekit.cloud

# STT Provider
DEEPGRAM_API_KEY=your_deepgram_key

# Translation
GOOGLE_APPLICATION_CREDENTIALS=path/to/credentials.json

# TTS Provider
ELEVENLABS_API_KEY=your_elevenlabs_key

# Optional
OPENAI_API_KEY=your_openai_key  # Fallback translation
LOG_LEVEL=INFO
```

## Deployment

### Using Docker
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["python", "agent.py", "start"]
```

### Using Railway/Fly.io
See deployment guides in main project README

## Cost Estimates

Per participant per hour:
- Deepgram STT: ~$0.75
- Google Translation: ~$0.10
- ElevenLabs TTS: ~$1.80
- **Total: ~$2.65/hour per translated participant**

## Troubleshooting

### Agent not receiving audio
- Check LiveKit room permissions
- Verify participant has microphone enabled
- Check agent has correct room access token

### Translation not working
- Verify language codes are supported
- Check translation API credentials
- Monitor agent logs for errors

### High latency
- Use nearest LiveKit server region
- Consider reducing audio chunk size
- Check network connectivity
