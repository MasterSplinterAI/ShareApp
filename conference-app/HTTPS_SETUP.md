# HTTPS Setup for Mobile Testing

## 🔒 The Problem

Mobile browsers (iOS Safari, Chrome on Android) require HTTPS for:
- Camera/Microphone access (getUserMedia)
- Some WebRTC features
- Service Workers

Your test revealed:
- ✅ WebSocket can connect (after fixing Socket.io CDN)
- ✅ APIs work fine over HTTP
- ❌ getUserMedia not available over HTTP

## 🚀 Quick Solutions

### Option 1: Use ngrok (Easiest for Testing)

1. Install ngrok:
```bash
brew install ngrok
# or download from https://ngrok.com
```

2. Start your app:
```bash
cd conference-app
npm run dev:all
```

3. In another terminal, create HTTPS tunnel:
```bash
ngrok http 3000
```

4. You'll get a URL like:
```
https://abc123.ngrok.io
```

5. Update your `.env.local`:
```env
NEXT_PUBLIC_WS_URL=https://abc123.ngrok.io
```

6. Access from mobile using the ngrok HTTPS URL

### Option 2: Local HTTPS with mkcert (Better for Development)

1. Install mkcert:
```bash
brew install mkcert
mkcert -install
```

2. Generate certificates:
```bash
cd conference-app
mkdir certificates
mkcert -cert-file certificates/localhost.pem -key-file certificates/localhost-key.pem localhost 192.168.1.47
```

3. Create `server-https.js`:
```javascript
const { createServer } = require('https');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const httpsOptions = {
  key: fs.readFileSync('./certificates/localhost-key.pem'),
  cert: fs.readFileSync('./certificates/localhost.pem'),
};

app.prepare().then(() => {
  // HTTPS server for Next.js
  const server = createServer(httpsOptions, (req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  server.listen(3000, (err) => {
    if (err) throw err;
    console.log('> HTTPS Server ready on https://localhost:3000');
    console.log('> Also accessible at https://192.168.1.47:3000');
  });

  // Socket.io on same server
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Your Socket.io logic here...
});
```

4. Update package.json:
```json
"scripts": {
  "dev:https": "node server-https.js"
}
```

5. Run with HTTPS:
```bash
npm run dev:https
```

6. Access from mobile:
```
https://192.168.1.47:3000
```
(You'll need to accept the certificate warning)

### Option 3: Deploy to Vercel (Production Ready)

1. Push to GitHub
2. Connect to Vercel
3. Deploy
4. Get automatic HTTPS URL
5. Update environment variables

## 🔧 Quick Fix for Current Setup

Since you discovered the issue is HTTPS, here's the immediate workaround:

### For Testing Without Video (HTTP):

Modify the app to work without getUserMedia on HTTP:

1. Update `lib/webrtc/connection-manager.ts`:
```typescript
private async initializeLocalStream(): Promise<void> {
  // Check if we're on HTTPS
  const isSecureContext = window.isSecureContext;
  
  if (!isSecureContext) {
    console.warn('Not in secure context (HTTPS), skipping media');
    this.localStream = new MediaStream();
    this.events.onStreamAdded(this.localStream, 'local', false);
    return;
  }
  
  // Original getUserMedia code...
}
```

2. Show a warning in the UI when on HTTP:
```typescript
{!window.isSecureContext && (
  <div className="bg-yellow-100 p-4 text-yellow-800">
    ⚠️ Camera/Microphone not available over HTTP. 
    Use HTTPS for full functionality.
  </div>
)}
```

## 📱 Mobile-Specific Considerations

### iOS Safari:
- Requires HTTPS for getUserMedia (no exceptions)
- Self-signed certificates work if you trust them
- No way around this requirement

### Android Chrome:
- Also requires HTTPS for getUserMedia
- Localhost is considered secure
- Self-signed certificates work with warning

## 🎯 Recommendation

For immediate testing:
1. **Use ngrok** - Gets you up and running in 2 minutes
2. Test all features work with HTTPS
3. Then set up proper HTTPS for development

For production:
- Deploy to Vercel/Railway/etc. with automatic HTTPS
- Or use proper SSL certificates on your server

## 🔍 Test After HTTPS Setup

Once you have HTTPS:
1. Camera/Microphone will work
2. All WebRTC features available
3. Mobile experience will be complete

The app is fully functional, just needs HTTPS for media access on mobile!
