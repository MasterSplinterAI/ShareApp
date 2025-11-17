# LiveKit International Conference App

A modern web conferencing application with real-time video, screen sharing, and live audio translation capabilities powered by LiveKit Cloud.

## Features

- 🎥 HD video conferencing with screen sharing
- 🌍 Real-time audio translation in 30+ languages
- 🔗 No login required - share a link to join
- 🔒 End-to-end encrypted, GDPR compliant
- 📱 Works on desktop and mobile browsers
- 💬 In-meeting chat with live transcriptions

## Tech Stack

- **Frontend**: React + Vite + Tailwind CSS
- **Backend**: Node.js + Express
- **Video Infrastructure**: LiveKit Cloud
- **Translation**: Python LiveKit Agent with STT/TTS pipeline
- **Languages**: Deepgram (STT) + Google Translate + ElevenLabs (TTS)

## Quick Start

### Prerequisites

1. **LiveKit Cloud Account**
   - Sign up at [cloud.livekit.io](https://cloud.livekit.io)
   - Create a project and get your API keys

2. **Translation Services** (for audio translation feature)
   - Deepgram API key
   - Google Cloud Translation credentials
   - ElevenLabs API key

### Installation

1. **Clone the repository**
   ```bash
   cd livekit-app
   ```

2. **Set up Backend**
   ```bash
   cd backend
   npm install
   cp env.example .env
   # Edit .env with your LiveKit credentials
   npm run dev
   ```

3. **Set up Frontend**
   ```bash
   cd ../frontend
   npm install
   npm run dev
   ```

4. **Set up Translation Agent** (optional)
   ```bash
   cd ../translation-agent
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   cp env.example .env
   # Edit .env with your API keys
   python agent.py dev
   ```

### Environment Variables

#### Backend (.env)
```env
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
LIVEKIT_URL=wss://your-project.livekit.cloud
PORT=3001
FRONTEND_URL=http://localhost:5174
```

#### Frontend (.env) - Optional
```env
VITE_LIVEKIT_URL=wss://your-project.livekit.cloud
```

#### Translation Agent (.env)
```env
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
LIVEKIT_URL=wss://your-project.livekit.cloud
DEEPGRAM_API_KEY=your_deepgram_key
GOOGLE_APPLICATION_CREDENTIALS=path/to/google-creds.json
ELEVENLABS_API_KEY=your_elevenlabs_key
```

## Usage

1. **Host a Meeting**
   - Click "Host a Meeting" on the home page
   - Enter your name
   - Share the generated link with participants

2. **Join a Meeting**
   - Use the shared link
   - Enter your name
   - You're connected!

3. **Enable Translation**
   - Click the globe icon in the meeting
   - Select your preferred language
   - Translation will start automatically

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│   Frontend  │────▶│   Backend   │────▶│ LiveKit Cloud│
│   (React)   │     │  (Express)  │     │   (WebRTC)   │
└─────────────┘     └─────────────┘     └──────────────┘
                           │                     ▲
                           │                     │
                           ▼                     │
                    ┌─────────────┐              │
                    │ Translation │──────────────┘
                    │    Agent    │
                    │  (Python)   │
                    └─────────────┘
```

## Deployment

### Frontend (Vercel/Netlify)
```bash
cd frontend
npm run build
# Deploy dist/ folder
```

### Backend (Railway/Render)
```bash
cd backend
# Push to GitHub
# Connect to Railway/Render
# Set environment variables
```

### Translation Agent (Railway/Fly.io)
```bash
cd translation-agent
# Create Dockerfile
# Deploy to cloud platform
```

## Cost Estimates

- **LiveKit Cloud**: $0.004 per participant minute
- **Translation** (per participant hour):
  - Deepgram STT: ~$0.75
  - Google Translate: ~$0.10
  - ElevenLabs TTS: ~$1.80
  - Total: ~$2.65/hour

## API Endpoints

### Backend API

- `POST /api/rooms/create` - Create a new room
- `GET /api/rooms/:roomName` - Get room info
- `POST /api/auth/token` - Generate participant token
- `GET /api/health` - Health check

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
- Check the [troubleshooting guide](./docs/TROUBLESHOOTING.md)
- Open an issue on GitHub
- Contact support@livekit.io for LiveKit-specific issues
