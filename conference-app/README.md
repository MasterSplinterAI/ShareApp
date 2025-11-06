# WebRTC Conference App

A modern web-based conference application with screen sharing capabilities, built with Next.js, WebRTC, and Cloudflare TURN relay.

## Features

- **Persistent Rooms**: Rooms remain active even when the host disconnects
- **Dual PIN System**: Separate PINs for hosts (with admin controls) and participants
- **Screen Sharing**: Multiple participants can share screens simultaneously
- **Mobile Optimized**: Responsive design with Picture-in-Picture support
- **Real-time Communication**: Low-latency video/audio using WebRTC
- **Secure**: All connections use Cloudflare TURN relay for privacy

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React, TypeScript, Tailwind CSS
- **State Management**: Zustand
- **WebRTC**: Native WebRTC API with Cloudflare TURN
- **Signaling**: Socket.io
- **Styling**: Tailwind CSS

## Prerequisites

- Node.js 18+ and npm
- Cloudflare TURN credentials (API token and Token ID)

## Setup

1. **Clone and install dependencies**:
```bash
cd conference-app
npm install
```

2. **Configure environment variables**:

Create a `.env.local` file in the root directory:

```env
# Cloudflare TURN Credentials
CLOUDFLARE_TURN_API_TOKEN=your_api_token_here
CLOUDFLARE_TURN_TOKEN_ID=59d87715faf308d4ea571375623ec7a3

# WebSocket URL (for local development)
NEXT_PUBLIC_WS_URL=http://localhost:3001
```

3. **Run the development servers**:

You need to run both the Next.js app and the Socket.io signaling server:

```bash
# Install concurrently if not already installed
npm install

# Run both servers
npm run dev:all
```

Or run them separately in different terminals:

```bash
# Terminal 1: Next.js app (port 3000)
npm run dev

# Terminal 2: Socket.io server (port 3001)
npm run dev:socket
```

4. **Access the application**:

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### Hosting a Meeting

1. Click "Host a Meeting" on the home page
2. Click "Create Room" to generate a new room
3. You'll receive:
   - A unique Room ID
   - A Host PIN (for you)
   - A Participant PIN (to share with guests)
4. Share the Room ID and Participant PIN with others

### Joining a Meeting

1. Click "Join a Meeting" on the home page
2. Enter the Room ID and PIN provided by the host
3. Click "Join" to enter the room

### In-Meeting Features

- **Audio/Video Controls**: Toggle microphone and camera
- **Screen Sharing**: Share your screen (creates a new tile)
- **Picture-in-Picture**: Available for remote video streams
- **Mobile Support**: Optimized controls and layout for mobile devices

## Production Deployment

### Building for Production

```bash
npm run build
```

### Running in Production

```bash
# Start both servers
npm run start:all
```

### Environment Variables for Production

Update your production environment variables:

```env
CLOUDFLARE_TURN_API_TOKEN=your_production_api_token
CLOUDFLARE_TURN_TOKEN_ID=your_production_token_id
NEXT_PUBLIC_WS_URL=wss://your-domain.com
```

### Deployment Options

1. **Vercel** (Recommended for Next.js):
   - Deploy the Next.js app to Vercel
   - Deploy Socket.io server separately (e.g., Railway, Render)

2. **Self-Hosted**:
   - Use PM2 or similar to run both processes
   - Configure Nginx for reverse proxy
   - Ensure WSS (secure WebSocket) for production

## Architecture

### Room Persistence

Rooms are stored in-memory (can be upgraded to Redis for production) with:
- 24-hour TTL (configurable)
- Automatic cleanup of expired rooms
- Participant tracking

### WebRTC Flow

1. User joins room via Socket.io signaling
2. Fetches TURN credentials from Cloudflare
3. Establishes peer connections with other participants
4. Handles renegotiation for screen sharing

### Security

- PIN-based access control
- Server-side room validation
- Cloudflare TURN relay prevents IP exposure
- Rate limiting on room creation (can be added)

## Troubleshooting

### Connection Issues

1. Ensure both servers are running (Next.js and Socket.io)
2. Check browser console for errors
3. Verify TURN credentials are correct
4. Check firewall/network settings

### Video/Audio Issues

1. Ensure browser has camera/microphone permissions
2. Check if other apps are using the devices
3. Try refreshing the page
4. Test with a different browser

### Screen Sharing Issues

1. Some browsers require HTTPS for screen sharing
2. Check browser permissions
3. Some apps/screens may not be shareable due to DRM

## Browser Support

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support (iOS 14.5+)
- Mobile browsers: Optimized UI with PiP support

## Contributing

Feel free to submit issues and enhancement requests!

## License

MIT
