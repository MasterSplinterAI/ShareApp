// Server-side room storage (JavaScript version for Node.js)
// This is a simplified version of lib/rooms/storage.ts for server use

const config = {
  room: {
    maxParticipants: 10,
    pinLength: 6,
    ttl: 864e5 // 24 hours in milliseconds
  }
};

class RoomStorage {
  constructor() {
    this.rooms = new Map();
    this.cleanupInterval = null;
    this.startCleanup();
  }

  /**
   * Generate a random room ID
   */
  generateRoomId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let roomId = '';
    for (let i = 0; i < 8; i++) {
      roomId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return roomId;
  }

  /**
   * Generate a random PIN
   */
  generatePin() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Create a new room
   */
  createRoom() {
    let roomId;
    let attempts = 0;

    // Ensure unique room ID (with max attempts)
    do {
      roomId = this.generateRoomId();
      attempts++;
      if (attempts > 100) {
        throw new Error('Failed to generate unique room ID');
      }
    } while (this.rooms.has(roomId.toUpperCase()));

    const hostPin = this.generatePin();
    const participantPin = this.generatePin();

    const room = {
      id: roomId,
      hostPin,
      participantPin,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      participants: new Set()
    };

    this.rooms.set(roomId.toUpperCase(), room);

    console.log(`Created room ${roomId} with host PIN ${hostPin} and participant PIN ${participantPin}`);

    return { roomId, hostPin, participantPin };
  }

  /**
   * Validate room access
   */
  validateRoom(roomId, pin) {
    const room = this.rooms.get(roomId.toUpperCase());

    if (!room) {
      return { isValid: false };
    }

    // Update activity
    room.lastActivity = Date.now();

    if (pin === room.hostPin) {
      return { isValid: true, isHost: true, participantPin: room.participantPin };
    } else if (pin === room.participantPin) {
      return { isValid: true, isHost: false, participantPin: room.participantPin };
    }

    return { isValid: false };
  }

  /**
   * Get room by ID
   */
  getRoom(roomId) {
    return this.rooms.get(roomId.toUpperCase());
  }

  /**
   * Add participant to room
   */
  addParticipant(roomId, participantId) {
    const room = this.rooms.get(roomId.toUpperCase());
    if (room) {
      room.participants.add(participantId);
      room.lastActivity = Date.now();
      console.log(`Added participant ${participantId} to room ${roomId}. Total: ${room.participants.size}`);
      return true;
    }
    return false;
  }

  /**
   * Remove participant from room
   */
  removeParticipant(roomId, participantId) {
    const room = this.rooms.get(roomId.toUpperCase());
    if (room) {
      room.participants.delete(participantId);
      room.lastActivity = Date.now();
      console.log(`Removed participant ${participantId} from room ${roomId}. Remaining: ${room.participants.size}`);
      return true;
    }
    return false;
  }

  /**
   * Get participant count
   */
  getParticipantCount(roomId) {
    const room = this.rooms.get(roomId.toUpperCase());
    return room ? room.participants.size : 0;
  }

  /**
   * Start cleanup interval
   */
  startCleanup() {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // Clean up every minute
  }

  /**
   * Clean up expired rooms
   */
  cleanup() {
    const now = Date.now();
    const ttl = config.room.ttl;

    for (const [roomId, room] of this.rooms.entries()) {
      if (now - room.lastActivity > ttl) {
        console.log(`Cleaning up expired room ${roomId}`);
        this.rooms.delete(roomId);
      }
    }
  }

  /**
   * Stop cleanup
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Singleton instance
const roomStorage = new RoomStorage();

module.exports = { roomStorage, RoomStorage };
