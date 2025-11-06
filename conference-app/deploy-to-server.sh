#!/bin/bash

# Complete deployment script for conference app
# Run this ON THE SERVER after SSHing in

set -e  # Exit on error

echo "=== Deploying Conference App to /meet ==="

# Configuration
APP_DIR="/var/www/html/meet"
PORT=3002

# 1. Create directory
echo "Creating app directory..."
sudo mkdir -p "$APP_DIR"
cd "$APP_DIR"

# 2. Create package.json
echo "Creating package.json..."
sudo tee package.json > /dev/null << 'EOF'
{
  "name": "conference-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start": "NODE_ENV=production PORT=3002 node server-unified.js"
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

# 3. Install dependencies
echo "Installing dependencies..."
sudo npm install --production

# 4. Create server file
echo "Creating server file..."
sudo tee server-unified.js > /dev/null << 'EOFSERVER'
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

    socket.on('offer', ({ offer, to }) => {
      socket.to(socket.data.roomId).emit('offer', {
        offer,
        from: socket.data.userId,
        to,
      });
    });

    socket.on('answer', ({ answer, to }) => {
      socket.to(socket.data.roomId).emit('answer', {
        answer,
        from: socket.data.userId,
        to,
      });
    });

    socket.on('ice-candidate', ({ candidate, to }) => {
      socket.to(socket.data.roomId).emit('ice-candidate', {
        candidate,
        from: socket.data.userId,
        to,
      });
    });

    socket.on('media-state', ({ audio, video }) => {
      socket.to(socket.data.roomId).emit('media-state', {
        userId: socket.data.userId,
        audio,
        video,
      });
    });

    socket.on('screen-share-started', () => {
      socket.to(socket.data.roomId).emit('screen-share-started', {
        userId: socket.data.userId,
      });
    });

    socket.on('screen-share-stopped', () => {
      socket.to(socket.data.roomId).emit('screen-share-stopped', {
        userId: socket.data.userId,
      });
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
EOFSERVER

# 5. Create environment file
echo "Creating environment file..."
sudo tee .env.production > /dev/null << 'EOF'
CLOUDFLARE_TURN_API_TOKEN=5ac6d30e0d584cca073a3cb922a430c826e25dcd7eaeb674e30fe25024c5e16e
CLOUDFLARE_TURN_TOKEN_ID=59d87715faf308d4ea571375623ec7a3
NEXT_PUBLIC_WS_URL=wss://share.jarmetals.com/meet
EOF

# 6. Create next.config.js
echo "Creating next.config.js..."
sudo tee next.config.js > /dev/null << 'EOFCONFIG'
module.exports = {
  basePath: '/meet',
  assetPrefix: '/meet',
  reactStrictMode: true,
  output: 'standalone',
}
EOFCONFIG

# 7. Set permissions
echo "Setting permissions..."
sudo chown -R www-data:www-data "$APP_DIR"

# 8. Start with PM2
echo "Starting with PM2..."
sudo pm2 delete conference-app 2>/dev/null || true
cd "$APP_DIR"
sudo PORT=3002 NODE_ENV=production pm2 start server-unified.js --name conference-app
sudo pm2 save

echo ""
echo "=== Conference app deployed! ==="
echo "App is running on port $PORT"
echo ""
echo "Next steps:"
echo "1. Update Nginx configuration (see below)"
echo "2. Test: curl http://localhost:$PORT/meet"
echo "3. Check logs: sudo pm2 logs conference-app"
echo ""
echo "Nginx configuration needed:"
echo "Add these to /etc/nginx/sites-available/default:"
echo ""
cat << 'EOFNginx'
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
EOFNginx
