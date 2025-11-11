// Simple room management API for the main server
const express = require('express');
const router = express.Router();

// In-memory room storage (same logic as the React app)
class RoomStorage {
  constructor() {
    this.rooms = new Map();
  }

  generateRoomId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let roomId = '';
    for (let i = 0; i < 8; i++) {
      roomId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return roomId;
  }

  generatePin() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  createRoom(customRoomId, customHostPin, customParticipantPin) {
    let roomId;
    
    // Use custom room ID if provided, otherwise generate
    if (customRoomId && !this.rooms.has(customRoomId.toUpperCase())) {
      roomId = customRoomId.toUpperCase();
    } else {
      do {
        roomId = this.generateRoomId();
      } while (this.rooms.has(roomId));
    }

    // Use custom PINs if provided, otherwise generate
    const hostPin = customHostPin || this.generatePin();
    const participantPin = customParticipantPin || this.generatePin();

    const room = {
      roomId,
      hostPin,
      participantPin,
      participants: new Set(),
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    this.rooms.set(roomId, room);
    console.log(`Room created: ${roomId} (hostPin: ${hostPin}, participantPin: ${participantPin})`);
    
    return {
      roomId,
      hostPin,
      participantPin
    };
  }

  validateRoom(roomId, pin) {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) {
      return { isValid: false };
    }

    const trimmedPin = pin.trim();
    if (room.hostPin === trimmedPin) {
      return { isValid: true, isHost: true, participantPin: room.participantPin };
    }
    
    if (room.participantPin === trimmedPin) {
      return { isValid: true, isHost: false };
    }

    return { isValid: false };
  }

  getRoom(roomId) {
    return this.rooms.get(roomId.toUpperCase());
  }

  // Cleanup old rooms (24 hours)
  cleanup() {
    const now = Date.now();
    const ttl = 24 * 60 * 60 * 1000; // 24 hours
    
    this.rooms.forEach((room, roomId) => {
      if (now - room.lastActivity > ttl) {
        this.rooms.delete(roomId);
        console.log(`Room ${roomId} expired and removed`);
      }
    });
  }
}

// Create singleton instance
const roomStorage = new RoomStorage();

// Cleanup every hour
setInterval(() => {
  roomStorage.cleanup();
}, 60 * 60 * 1000);

// API Routes
router.post('/api/rooms', (req, res) => {
  try {
    const { roomId: customRoomId, hostPin: customHostPin, participantPin: customParticipantPin } = req.body || {};
    
    // Create room with custom values if provided
    const { roomId, hostPin, participantPin } = roomStorage.createRoom(
      customRoomId,
      customHostPin,
      customParticipantPin
    );
    
    res.json({
      roomId,
      hostPin,
      participantPin,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

router.post('/api/rooms/:roomId/validate', (req, res) => {
  try {
    const { roomId } = req.params;
    const { pin } = req.body;
    
    if (!pin) {
      return res.status(400).json({ error: 'PIN is required' });
    }
    
    const validation = roomStorage.validateRoom(roomId, pin);
    
    if (!validation.isValid) {
      return res.status(401).json({ error: 'Invalid room or PIN' });
    }
    
    const room = roomStorage.getRoom(roomId);
    
    res.json({
      roomId: roomId.toUpperCase(),
      isHost: validation.isHost,
      participantPin: validation.participantPin,
      participantCount: room ? room.participants.size : 0,
      createdAt: room?.createdAt
    });
  } catch (error) {
    console.error('Error validating room:', error);
    res.status(500).json({ error: 'Failed to validate room' });
  }
});

// Export for use in server.js
module.exports = { router, roomStorage };
