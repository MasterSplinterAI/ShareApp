// Room service for room creation, joining, and PIN management
import { logger } from '../core/Logger.js';
import { eventBus } from '../core/EventBus.js';
import { stateManager } from '../core/StateManager.js';
import { commandDispatcher } from '../core/CommandDispatcher.js';
import { signalingClient } from '../webrtc/SignalingClient.js';

class RoomService {
  constructor() {
    this.currentRoomId = null;
  }

  /**
   * Generate a random room ID
   */
  generateRoomId() {
    return `room-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate a random PIN code
   */
  generatePin() {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  /**
   * Create a room
   */
  async createRoom(userName, options = {}) {
    try {
      logger.info('RoomService', 'Creating room...', { userName });

      // Generate room ID and PINs
      const roomId = options.roomId || this.generateRoomId();
      const hostCode = options.hostCode || this.generatePin();
      const participantCode = options.participantCode || this.generatePin();

      // Update state
      stateManager.setState({
        roomId,
        isHost: true,
        'room.id': roomId,
        'room.hostId': signalingClient.getSocketId(),
        'room.hostCode': hostCode,
        'room.participantCode': participantCode
      });

      this.currentRoomId = roomId;

      // Join room as host
      await signalingClient.joinRoom(roomId, {
        userName,
        isHost: true,
        roomHostCode: hostCode,
        roomAccessCode: participantCode
      });

      logger.info('RoomService', 'Room created', {
        roomId,
        hostCode,
        participantCode
      });

      eventBus.emit('room:created', {
        roomId,
        hostCode,
        participantCode
      });

      return {
        roomId,
        hostCode,
        participantCode
      };
    } catch (error) {
      logger.error('RoomService', 'Failed to create room', { error });
      eventBus.emit('room:createError', { error });
      throw error;
    }
  }

  /**
   * Join a room
   */
  async joinRoom(roomId, userName, accessCode = null) {
    try {
      logger.info('RoomService', 'Joining room...', { roomId, userName, hasAccessCode: !!accessCode });

      // Update state
      stateManager.setState({
        roomId,
        isHost: false,
        'room.id': roomId
      });

      this.currentRoomId = roomId;

      // Join room
      await signalingClient.joinRoom(roomId, {
        userName,
        isHost: false,
        accessCode
      });

      logger.info('RoomService', 'Room join request sent', { roomId });
    } catch (error) {
      logger.error('RoomService', 'Failed to join room', { error });
      eventBus.emit('room:joinError', { error });
      throw error;
    }
  }

  /**
   * Leave current room
   */
  async leaveRoom() {
    if (!this.currentRoomId) {
      return;
    }

    try {
      logger.info('RoomService', 'Leaving room', { roomId: this.currentRoomId });

      await signalingClient.leaveRoom();

      // Reset state
      stateManager.setState({
        roomId: null,
        isHost: false,
        'room.id': null,
        'room.hostId': null,
        'room.hostCode': null,
        'room.participantCode': null,
        'room.participants': new Map()
      });

      this.currentRoomId = null;

      eventBus.emit('room:left');
      logger.info('RoomService', 'Room left');
    } catch (error) {
      logger.error('RoomService', 'Failed to leave room', { error });
      throw error;
    }
  }

  /**
   * Get shareable link with participant PIN
   */
  getShareableLink(roomId, participantCode = null) {
    const baseUrl = window.location.origin + window.location.pathname;
    const url = new URL(baseUrl);
    
    url.searchParams.set('room', roomId);
    if (participantCode) {
      url.searchParams.set('pin', participantCode);
    }

    return url.toString();
  }

  /**
   * Get PIN from URL
   */
  getPinFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('pin');
  }

  /**
   * Get room ID from URL
   */
  getRoomIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('room');
  }

  /**
   * Get current room ID
   */
  getCurrentRoomId() {
    return this.currentRoomId || stateManager.getState('roomId');
  }
}

// Export singleton instance
export const roomService = new RoomService();
export default roomService;

