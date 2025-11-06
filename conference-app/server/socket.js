const { createServer } = require('http');
const { Server } = require('socket.io');
const { parse } = require('url');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = 3001;

// Socket.io server for WebRTC signaling
const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: '*', // Allow all origins for testing (restrict in production)
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'], // Support both transports
  allowEIO3: true, // Allow different Socket.io versions
});

// Track room participants
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id} from ${socket.handshake.address}`);
  console.log(`Transport: ${socket.conn.transport.name}`);

  // Join room
  socket.on('join-room', ({ roomId, pin, userId }) => {
    console.log(`User ${userId} joining room ${roomId} with pin ${pin}`);
    
    // Join the socket.io room
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userId = userId;

    // Track participants
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(userId);

    // Notify others in the room
    socket.to(roomId).emit('user-joined', { userId });

    // Send current participants to the new user
    const participants = Array.from(rooms.get(roomId) || []).filter(id => id !== userId);
    socket.emit('current-participants', { participants });
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
    // Remove from room tracking
    const roomParticipants = rooms.get(roomId);
    if (roomParticipants) {
      roomParticipants.delete(userId);
      if (roomParticipants.size === 0) {
        rooms.delete(roomId);
      }
    }

    // Notify others
    socket.to(roomId).emit('user-left', { userId });
    socket.leave(roomId);
  }
}

httpServer.listen(port, () => {
  console.log(`> Socket.io server running on http://${hostname}:${port}`);
});
