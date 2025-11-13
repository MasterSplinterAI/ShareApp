// Signaling client wrapper around Socket.io with type-safe events and automatic reconnection
import { logger } from '../core/Logger.js';
import { eventBus } from '../core/EventBus.js';
import { stateManager } from '../core/StateManager.js';

class SignalingClient {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.reconnectTimer = null;
    this.messageQueue = [];
    this.eventHandlers = new Map();
  }

  /**
   * Initialize Socket.io connection
   */
  async connect() {
    if (this.socket && this.isConnected) {
      logger.warn('SignalingClient', 'Already connected');
      return;
    }

    if (typeof io === 'undefined') {
      throw new Error('Socket.io library not loaded');
    }

    logger.info('SignalingClient', 'Connecting to signaling server...');

    return new Promise((resolve, reject) => {
      try {
        this.socket = io();

        // Connection handlers
        this.socket.on('connect', () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          const socketId = this.socket.id;
          
          stateManager.setState({ 
            socketId,
            connectionState: 'connected'
          });

          logger.info('SignalingClient', 'Connected to signaling server', { socketId });

          // Process queued messages
          this.processMessageQueue();

          eventBus.emit('signaling:connected', { socketId });
          resolve(socketId);
        });

        this.socket.on('disconnect', (reason) => {
          this.isConnected = false;
          
          stateManager.setState({ connectionState: 'disconnected' });

          logger.warn('SignalingClient', 'Disconnected from signaling server', { reason });

          eventBus.emit('signaling:disconnected', { reason });

          // Attempt reconnection
          if (reason === 'io server disconnect') {
            // Server disconnected, reconnect manually
            this.socket.connect();
          } else {
            // Client disconnected, attempt reconnection
            this.scheduleReconnect();
          }
        });

        this.socket.on('connect_error', (error) => {
          logger.error('SignalingClient', 'Connection error', { error });
          eventBus.emit('signaling:error', { error });
          
          if (!this.isConnected) {
            reject(error);
          }
        });

        // Room events
        this.setupRoomHandlers();

        // Signaling events
        this.setupSignalingHandlers();

        // Chat events
        this.setupChatHandlers();

      } catch (error) {
        logger.error('SignalingClient', 'Failed to initialize socket', { error });
        reject(error);
      }
    });
  }

  /**
   * Setup room event handlers
   */
  setupRoomHandlers() {
    this.socket.on('room-joined', (data) => {
      logger.info('SignalingClient', 'Room joined', { 
        roomId: data.roomId, 
        hostId: data.hostId,
        participantCount: data.participants?.length || 0,
        participants: data.participants?.map(p => ({ id: p.id, name: p.name })) || []
      });
      stateManager.setState({
        roomId: data.roomId,
        isHost: data.hostId === this.socket.id,
        'room.hostId': data.hostId,
        socketId: this.socket.id
      });

      // Update participants
      const participants = new Map();
      if (data.participants && Array.isArray(data.participants)) {
        data.participants.forEach(p => {
          participants.set(p.id, {
            id: p.id,
            name: p.name,
            isHost: p.isHost,
            joinedAt: p.joinedAt ? new Date(p.joinedAt) : new Date()
          });
        });
      }
      stateManager.setState({ 'room.participants': participants });

      eventBus.emit('room:joined', data);
    });

    this.socket.on('user-joined', (data) => {
      logger.info('SignalingClient', 'User joined', { userId: data.userId });
      
      const participants = stateManager.getState('room.participants') || new Map();
      participants.set(data.userId, {
        id: data.userId,
        name: data.name,
        isHost: data.isHost,
        joinedAt: new Date()
      });
      stateManager.setState({ 'room.participants': participants });

      eventBus.emit('room:userJoined', data);
    });

    this.socket.on('user-left', (data) => {
      logger.info('SignalingClient', 'User left', { userId: data.userId });
      
      const participants = stateManager.getState('room.participants') || new Map();
      participants.delete(data.userId);
      stateManager.setState({ 'room.participants': participants });

      eventBus.emit('room:userLeft', data);
    });

    this.socket.on('join-error', (data) => {
      logger.error('SignalingClient', 'Join error', { error: data.error });
      eventBus.emit('room:joinError', data);
    });

    this.socket.on('host-changed', (data) => {
      logger.info('SignalingClient', 'Host changed', { newHostId: data.newHostId });
      stateManager.setState({
        isHost: data.newHostId === this.socket.id,
        'room.hostId': data.newHostId
      });
      eventBus.emit('room:hostChanged', data);
    });
  }

  /**
   * Setup signaling event handlers
   */
  setupSignalingHandlers() {
    this.socket.on('offer', (data) => {
      logger.info('SignalingClient', 'Received offer', {
        from: data.senderId || data.targetUserId,
        to: this.socket.id,
        hasSdp: !!data.sdp,
        sdpType: data.sdp?.type,
        roomId: data.roomId
      });
      eventBus.emit('webrtc:offer', {
        senderId: data.senderId || data.targetUserId,
        sdp: data.sdp
      });
    });

    this.socket.on('answer', (data) => {
      logger.info('SignalingClient', 'Received answer', { 
        from: data.senderId || data.targetUserId,
        to: this.socket.id,
        hasSdp: !!data.sdp
      });
      eventBus.emit('webrtc:answer', {
        senderId: data.senderId || data.targetUserId,
        sdp: data.sdp
      });
    });

    this.socket.on('ice-candidate', (data) => {
      logger.debug('SignalingClient', 'Received ICE candidate', { from: data.senderId || data.targetUserId });
      eventBus.emit('webrtc:iceCandidate', {
        senderId: data.senderId || data.targetUserId,
        candidate: data.candidate
      });
    });
  }

  /**
   * Setup chat event handlers
   */
  setupChatHandlers() {
    this.socket.on('chat-message', (data) => {
      logger.debug('SignalingClient', 'Received chat message', { from: data.senderId });
      eventBus.emit('chat:message', data);
    });
  }

  /**
   * Join a room
   */
  joinRoom(roomId, options = {}) {
    if (!this.isConnected) {
      throw new Error('Not connected to signaling server');
    }

    const joinData = {
      roomId,
      userName: options.userName || 'Guest',
      isHost: options.isHost || false,
      accessCode: options.accessCode || null,
      roomHostCode: options.roomHostCode || null,
      roomAccessCode: options.roomAccessCode || null
    };

    logger.info('SignalingClient', 'Joining room', { roomId, isHost: joinData.isHost });
    this.socket.emit('join', joinData);
  }

  /**
   * Leave current room
   */
  leaveRoom() {
    if (!this.isConnected) {
      return;
    }

    logger.info('SignalingClient', 'Leaving room');
    this.socket.emit('leave-room');
  }

  /**
   * Send WebRTC offer
   */
  sendOffer(targetUserId, sdp, roomId) {
    this.send('offer', {
      targetUserId,
      roomId,
      sdp
    });
  }

  /**
   * Send WebRTC answer
   */
  sendAnswer(targetUserId, sdp, roomId) {
    this.send('answer', {
      targetUserId,
      roomId,
      sdp
    });
  }

  /**
   * Send ICE candidate
   */
  sendIceCandidate(targetUserId, candidate, roomId) {
    this.send('ice-candidate', {
      targetUserId,
      roomId,
      candidate
    });
  }

  /**
   * Send chat message
   */
  sendChatMessage(message, roomId) {
    this.send('chat-message', {
      roomId,
      message
    });
  }

  /**
   * Send a message (with queuing if disconnected)
   */
  send(event, data) {
    if (!this.isConnected) {
      logger.warn('SignalingClient', 'Not connected, queuing message', { event });
      this.messageQueue.push({ event, data });
      return;
    }

    try {
      this.socket.emit(event, data);
      logger.debug('SignalingClient', `Sent ${event}`, { targetUserId: data.targetUserId });
    } catch (error) {
      logger.error('SignalingClient', `Failed to send ${event}`, { error });
      throw error;
    }
  }

  /**
   * Process queued messages
   */
  processMessageQueue() {
    while (this.messageQueue.length > 0) {
      const { event, data } = this.messageQueue.shift();
      try {
        this.socket.emit(event, data);
        logger.debug('SignalingClient', `Sent queued ${event}`);
      } catch (error) {
        logger.error('SignalingClient', `Failed to send queued ${event}`, { error });
        // Put back at front of queue
        this.messageQueue.unshift({ event, data });
        break;
      }
    }
  }

  /**
   * Schedule reconnection
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('SignalingClient', 'Max reconnection attempts reached');
      eventBus.emit('signaling:maxReconnectAttempts', { attempts: this.reconnectAttempts });
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff

    logger.info('SignalingClient', 'Scheduling reconnection', {
      attempt: this.reconnectAttempts,
      delay
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(error => {
        logger.error('SignalingClient', 'Reconnection failed', { error });
      });
    }, delay);
  }

  /**
   * Disconnect
   */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.isConnected = false;
    this.messageQueue = [];
    stateManager.setState({ connectionState: 'disconnected' });

    logger.info('SignalingClient', 'Disconnected from signaling server');
  }

  /**
   * Get socket ID
   */
  getSocketId() {
    return this.socket?.id || null;
  }

  /**
   * Check if connected
   */
  isConnectedToServer() {
    return this.isConnected && this.socket?.connected === true;
  }
}

// Export singleton instance
export const signalingClient = new SignalingClient();
export default signalingClient;

