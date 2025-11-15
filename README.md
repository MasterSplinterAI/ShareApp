# VideoSDK Conference App

A professional video conferencing application built with VideoSDK.live, React, and OpenAI translation.

## Features

- **Video/Audio Conferencing** - High-quality video calls powered by VideoSDK
- **Screen Sharing** - Share your screen with participants
- **Real-time Translation** - Bi-directional audio translation using OpenAI Realtime API
- **Mobile Support** - Fully responsive design for iOS and Android
- **No Login Required** - Token-based authentication, no user accounts needed
- **Chat** - Real-time text messaging during meetings
- **Professional UI** - Clean, modern interface built with Tailwind CSS

## Architecture

- **Frontend**: React + Vite + VideoSDK React SDK + Tailwind CSS
- **Backend**: Express.js (token generation, meeting management)
- **Translation**: Python AI Agent + OpenAI Realtime API

## Project Structure

```
share-app/
├── frontend/              # React frontend
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── services/       # API services
│   │   ├── utils/         # Utilities
│   │   └── hooks/         # Custom hooks
│   └── package.json
├── backend/               # Express API
│   ├── routes/            # API routes
│   ├── server.js
│   └── package.json
├── translation-agent/      # Python AI agent
│   ├── agent.py
│   ├── config.py
│   └── requirements.txt
└── README.md
```

## Setup

### Prerequisites

- Node.js (v16 or higher)
- Python 3.8+ (for translation agent)
- VideoSDK API key and secret
- OpenAI API key

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd share-app
   ```

2. **Backend Setup**
   ```bash
   cd backend
   npm install
   cp .env.example .env
   # Edit .env with your VideoSDK credentials
   ```

3. **Frontend Setup**
   ```bash
   cd frontend
   npm install
   ```

4. **Translation Agent Setup**
   ```bash
   cd translation-agent
   pip install -r requirements.txt
   cp .env.example .env
   # Edit .env with your OpenAI and VideoSDK credentials
   ```

### Environment Variables

**Backend (.env)**
```
VIDEOSDK_API_KEY=your_videosdk_api_key
VIDEOSDK_SECRET_KEY=your_videosdk_secret_key
PORT=3000
FRONTEND_URL=http://localhost:5173
```

**Translation Agent (.env)**
```
OPENAI_API_KEY=your_openai_api_key
VIDEOSDK_AUTH_TOKEN=your_videosdk_token
MEETING_ID=meeting_id_to_join
```

## Running the Application

1. **Start Backend**
   ```bash
   cd backend
   npm start
   # or for development
   npm run dev
   ```

2. **Start Frontend**
   ```bash
   cd frontend
   npm run dev
   ```

3. **Start Translation Agent** (optional, for translation feature)
   ```bash
   cd translation-agent
   python agent.py
   ```

## Usage

1. Open `http://localhost:5173` in your browser
2. Click "Host Meeting" to create a new meeting
3. Share the meeting link with participants
4. Click "Join Meeting" to join an existing meeting
5. Enable translation (host only) to activate real-time translation

## Development

- Frontend runs on `http://localhost:5173`
- Backend API runs on `http://localhost:3000`
- Frontend proxies API requests to backend

## Deployment

See `BUILD_PLAN.md` for deployment considerations. The app requires:
- HTTPS (required for WebRTC)
- Environment variables configured on server
- Backend and frontend deployed
- Translation agent can run separately or on same server

## Notes

- Recording feature not included (requires S3/storage)
- Old WebRTC app code moved to `backup/old-app/`
- Deployment scripts preserved in root directory

## License

MIT License

