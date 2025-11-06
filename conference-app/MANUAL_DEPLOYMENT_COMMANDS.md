# Manual Deployment Commands

After you SSH into the server with:
```bash
ssh -i ~/Downloads/AxisAlgo.pem ubuntu@3.16.210.84
```

Run these commands:

## 1. Create the conference app directory
```bash
sudo mkdir -p /var/www/html/meet
cd /var/www/html/meet
```

## 2. Create package.json (copy this entire block)
```bash
sudo tee package.json << 'EOF'
{
  "name": "conference-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start": "NODE_ENV=production node server-unified.js"
  },
  "dependencies": {
    "next": "14.2.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "socket.io": "^4.7.5",
    "socket.io-client": "^4.7.5",
    "zustand": "^4.5.2"
  }
}
EOF
```

## 3. Install dependencies
```bash
sudo npm install --production
```

## 4. Create the server file (copy this entire block)
```bash
sudo tee server-unified.js << 'EOF'
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = process.env.PORT || 3002;

const app = next({ dev, dir: '.' });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  const io = new Server(server, {
    path: '/meet/socket.io/',
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  const rooms = new Map();

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('join-room', ({ roomId, pin, userId }) => {
      console.log(`User ${userId} joining room ${roomId}`);
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.userId = userId;

      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
      }
      rooms.get(roomId).add(userId);

      socket.to(roomId).emit('user-joined', { userId });
      const participants = Array.from(rooms.get(roomId) || []).filter(id => id !== userId);
      socket.emit('current-participants', { participants });
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
      const { roomId, userId } = socket.data;
      if (roomId && userId) {
        const roomParticipants = rooms.get(roomId);
        if (roomParticipants) {
          roomParticipants.delete(userId);
          if (roomParticipants.size === 0) {
            rooms.delete(roomId);
          }
        }
        socket.to(roomId).emit('user-left', { userId });
      }
    });
  });

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Conference app ready on http://${hostname}:${port}`);
  });
});
EOF
```

## 5. Create environment file
```bash
sudo tee .env.production << 'EOF'
CLOUDFLARE_TURN_API_TOKEN=5ac6d30e0d584cca073a3cb922a430c826e25dcd7eaeb674e30fe25024c5e16e
CLOUDFLARE_TURN_TOKEN_ID=59d87715faf308d4ea571375623ec7a3
NEXT_PUBLIC_WS_URL=wss://share.jarmetals.com/meet
EOF
```

## 6. Start with PM2
```bash
# Delete old instance if exists
sudo pm2 delete conference-app 2>/dev/null || true

# Start new instance
sudo PORT=3002 NODE_ENV=production pm2 start server-unified.js --name conference-app

# Save PM2 config
sudo pm2 save
sudo pm2 startup
```

## 7. Update Nginx configuration
```bash
# Edit the nginx config
sudo nano /etc/nginx/sites-available/default
```

Add these location blocks inside the server block (before the closing }):

```nginx
    # Conference app at /meet
    location /meet {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Socket.io for conference app
    location /meet/socket.io/ {
        proxy_pass http://localhost:3002/meet/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

## 8. Test and reload Nginx
```bash
# Test configuration
sudo nginx -t

# If test passes, reload
sudo systemctl reload nginx
```

## 9. Check if it's working
```bash
# Check PM2 status
sudo pm2 status

# Check logs
sudo pm2 logs conference-app --lines 20

# Test the endpoint
curl http://localhost:3002/meet
```

## The app should now be accessible at:
https://share.jarmetals.com/meet/

## To monitor:
```bash
# Watch logs
sudo pm2 logs conference-app

# Check process
sudo pm2 monit
```

## If you need to restart:
```bash
sudo pm2 restart conference-app
```
