const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

// Load environment variables from .env.production if it exists
if (process.env.NODE_ENV === 'production') {
  const envPath = path.join(__dirname, '.env.production');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf8');
    envFile.split('\n').forEach(line => {
      const match = line.match(/^([^=:#]+)=(.*)$/);
      if (match && !process.env[match[1].trim()]) {
        process.env[match[1].trim()] = match[2].trim();
      }
    });
    console.log('✅ Loaded environment variables from .env.production');
  }
}

// Import room storage
const { roomStorage } = require('./server-room-storage');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = process.env.PORT || 3002; // Use 3002 for production to avoid conflict

const app = next({ dev });
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

  // Socket.io on the same server
  const io = new Server(server, {
    path: '/meet/socket.io/', // Add basePath for production
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id} from ${socket.handshake.address}`);
    console.log(`Transport: ${socket.conn.transport.name}`);

    // Join room
    socket.on('join-room', ({ roomId, pin, userId }) => {
      console.log(`User ${userId} joining room ${roomId} with pin ${pin}`);

      // Validate room exists and PIN is correct
      const room = roomStorage.getRoom(roomId);
      if (!room) {
        console.log(`Room ${roomId} not found`);
        socket.emit('room-error', { error: 'Room not found' });
        return;
      }

      const validation = roomStorage.validateRoom(roomId, pin);
      if (!validation.isValid) {
        console.log(`Invalid PIN for room ${roomId}: ${pin}`);
        socket.emit('room-error', { error: 'Invalid room or PIN' });
        return;
      }

      // Join the socket.io room
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.userId = userId;
      socket.data.isHost = validation.isHost;

      // Add participant to room
      roomStorage.addParticipant(roomId, userId);

      // Notify others in the room
      socket.to(roomId).emit('user-joined', { userId });

      // Send current participants to the new user
      const participants = Array.from(room.participants).filter(id => id !== userId);
      socket.emit('current-participants', { participants });

      console.log(`User ${userId} successfully joined room ${roomId}. Total participants: ${room.participants.size}`);
    });

    // WebRTC signaling
    socket.on('offer', ({ offer, to }) => {
      console.log(`Sending offer from ${socket.data.userId} to ${to}`);
      socket.to(socket.data.roomId).emit('offer', {
        offer,
        from: socket.data.userId,
        to,
      });
    });

    socket.on('answer', ({ answer, to }) => {
      console.log(`Sending answer from ${socket.data.userId} to ${to}`);
      socket.to(socket.data.roomId).emit('answer', {
        answer,
        from: socket.data.userId,
        to,
      });
    });

    socket.on('ice-candidate', ({ candidate, to }) => {
      console.log(`Sending ICE candidate from ${socket.data.userId} to ${to}`);
      socket.to(socket.data.roomId).emit('ice-candidate', {
        candidate,
        from: socket.data.userId,
        to,
      });
    });

    // Media state changes
    socket.on('media-state', ({ audio, video }) => {
      socket.to(socket.data.roomId).emit('media-state', {
        userId: socket.data.userId,
        audio,
        video,
      });
    });

    // Screen sharing
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

    // Leave room
    socket.on('leave-room', () => {
      handleLeaveRoom(socket);
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
      handleLeaveRoom(socket);
    });
  });

  function handleLeaveRoom(socket) {
    const { roomId, userId } = socket.data;

    if (roomId && userId) {
      // Remove from participants using room storage
      roomStorage.removeParticipant(roomId, userId);
      console.log(`User ${userId} left room ${roomId}`);

      // Notify others
      socket.to(roomId).emit('user-left', { userId });
      socket.leave(roomId);

      // Check if room is empty and should be cleaned up
      const room = roomStorage.getRoom(roomId);
      if (room && room.participants.size === 0) {
        console.log(`Room ${roomId} is now empty`);
      }
    }
  }

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log('> Next.js and Socket.io running on same server');
    console.log('> Perfect for ngrok tunneling!');
  });
});
