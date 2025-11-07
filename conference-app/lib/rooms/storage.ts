// Room storage service
// Handles persistent room data storage (in-memory for MVP, Redis for production)

import { config } from '../config';

export interface Room {
  id: string;
  hostPin: string;
  participantPin: string;
  createdAt: number;
  lastActivity: number;
  participants: Set<string>;
}

class RoomStorage {
  private rooms: Map<string, Room> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start cleanup interval to remove expired rooms
    this.startCleanup();
  }

  /**
   * Generate a random room ID
   */
  generateRoomId(): string {
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
  generatePin(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Create a new room
   */
  createRoom(): { roomId: string; hostPin: string; participantPin: string } {
    let roomId: string;
    
    // Ensure unique room ID
    do {
      roomId = this.generateRoomId();
    } while (this.rooms.has(roomId));

    const hostPin = this.generatePin();
    const participantPin = this.generatePin();

    const room: Room = {
      id: roomId,
      hostPin,
      participantPin,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      participants: new Set(),
    };

    this.rooms.set(roomId, room);

    return { roomId, hostPin, participantPin };
  }

  /**
   * Validate room access
   */
  validateRoom(roomId: string, pin: string): { isValid: boolean; isHost: boolean; participantPin?: string } {
    // Make room ID case-insensitive
    const normalizedRoomId = roomId.toUpperCase();
    const room = this.rooms.get(normalizedRoomId);
    
    if (!room) {
      console.log(`Room not found: ${normalizedRoomId}`);
      return { isValid: false, isHost: false };
    }

    // Update last activity
    room.lastActivity = Date.now();

    // Trim and compare PINs
    const trimmedPin = pin.trim();
    
    if (trimmedPin === room.hostPin) {
      console.log(`Host PIN validated for room ${normalizedRoomId}`);
      return { isValid: true, isHost: true, participantPin: room.participantPin };
    }

    if (trimmedPin === room.participantPin) {
      console.log(`Participant PIN validated for room ${normalizedRoomId}`);
      return { isValid: true, isHost: false };
    }

    console.log(`Invalid PIN for room ${normalizedRoomId}: ${trimmedPin}`);
    return { isValid: false, isHost: false };
  }

  /**
   * Get room info
   */
  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId.toUpperCase());
  }

  /**
   * Add participant to room
   */
  addParticipant(roomId: string, participantId: string): boolean {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) return false;

    room.participants.add(participantId);
    room.lastActivity = Date.now();
    return true;
  }

  /**
   * Remove participant from room
   */
  removeParticipant(roomId: string, participantId: string): boolean {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) return false;

    room.participants.delete(participantId);
    room.lastActivity = Date.now();
    return true;
  }

  /**
   * Get participant count
   */
  getParticipantCount(roomId: string): number {
    const room = this.rooms.get(roomId.toUpperCase());
    return room ? room.participants.size : 0;
  }

  /**
   * Clean up expired rooms
   */
  private cleanup(): void {
    const now = Date.now();
    const ttl = config.room.ttl;

    this.rooms.forEach((room, roomId) => {
      if (now - room.lastActivity > ttl) {
        this.rooms.delete(roomId);
        console.log(`Cleaned up expired room: ${roomId}`);
      }
    });
  }

  /**
   * Start cleanup interval
   */
  private startCleanup(): void {
    // Run cleanup every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000);
  }

  /**
   * Stop cleanup interval (for graceful shutdown)
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Singleton instance
// Export both the class and instance
export const roomStorage = new RoomStorage();

// Also export the class for server-side usage
export { RoomStorage };
