# VideoSDK Conference App - Build Plan

## Project Overview

Building a professional video conferencing app from scratch using:
- **VideoSDK.live** - Video/audio infrastructure
- **React** - Frontend framework
- **Tailwind CSS** - Styling
- **Express.js** - Backend API
- **OpenAI Realtime API** - Translation service (via Python agent)

## Project Structure

```
share-app/
├── frontend/                 # React app
│   ├── src/
│   │   ├── components/      # React components
│   │   ├── services/         # API services
│   │   ├── utils/           # Utilities
│   │   └── App.jsx
│   ├── package.json
│   └── vite.config.js
│
├── backend/                 # Express API
│   ├── routes/              # API routes
│   ├── server.js
│   └── package.json
│
├── translation-agent/        # Python AI agent
│   ├── agent.py
│   ├── requirements.txt
│   └── .env
│
├── deploy.sh                # Deployment script (keep)
├── aws-ports.sh             # AWS config (keep)
├── package.json             # Root package.json
└── .env                     # Environment variables
```

## Phase 1: Setup & Infrastructure ✅

- [x] Clean up old code (moved to backup/)
- [ ] Initialize React frontend with Vite
- [ ] Initialize Express backend
- [ ] Set up Python translation agent structure
- [ ] Configure environment variables
- [ ] Set up Tailwind CSS

## Phase 2: Backend API

- [ ] Token generation endpoint (`/api/videosdk-token`)
- [ ] Meeting creation endpoint (`/api/meetings/create`)
- [ ] Meeting validation endpoint (`/api/meetings/:id/validate`)
- [ ] Translation agent trigger endpoint (`/api/translation/start`)

## Phase 3: Frontend - Home Screen

- [ ] Beautiful home screen with Host/Join buttons
- [ ] Name input modal
- [ ] Join meeting form (link/ID input)
- [ ] QR code generation for sharing
- [ ] Mobile-responsive design

## Phase 4: Frontend - Meeting Room

- [ ] VideoSDK MeetingProvider setup
- [ ] Video grid component (responsive)
- [ ] Controls bar (mic, camera, screen share, leave)
- [ ] Chat panel
- [ ] Participants list
- [ ] Share link modal
- [ ] Translation toggle (host only)

## Phase 5: Translation Integration

- [ ] Python agent setup
- [ ] OpenAI Realtime API integration
- [ ] Agent joins meeting automatically
- [ ] Translation UI controls
- [ ] Language selection

## Phase 6: Mobile Optimization

- [ ] Touch-optimized controls
- [ ] Mobile video grid layout
- [ ] Swipe gestures
- [ ] Camera switching
- [ ] Mobile-specific UI adjustments

## Phase 7: Polish & Testing

- [ ] Error handling
- [ ] Loading states
- [ ] Toast notifications
- [ ] URL parsing (auto-join from links)
- [ ] Cross-browser testing
- [ ] Mobile device testing

## Features (Future - Not in Initial Build)

- Recording (requires S3/storage)
- Waiting room
- Meeting history
- Analytics
- Breakout rooms

## Environment Variables Needed

### Backend (.env)
```
VIDEOSDK_API_KEY=your_videosdk_api_key
VIDEOSDK_SECRET_KEY=your_videosdk_secret_key
PORT=3000
```

### Translation Agent (.env)
```
OPENAI_API_KEY=your_openai_api_key
VIDEOSDK_AUTH_TOKEN=generated_token
```

## Next Steps

1. Initialize React frontend
2. Set up Express backend
3. Create token generation endpoint
4. Build home screen UI
5. Integrate VideoSDK components

