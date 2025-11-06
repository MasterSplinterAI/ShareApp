import { io, Socket } from 'socket.io-client';
import { config } from '../config';

export interface SignalingEvents {
  onUserJoined: (userId: string) => void;
  onUserLeft: (userId: string) => void;
  onOffer: (data: { offer: RTCSessionDescriptionInit; from: string; to: string }) => void;
  onAnswer: (data: { answer: RTCSessionDescriptionInit; from: string; to: string }) => void;
  onIceCandidate: (data: { candidate: RTCIceCandidateInit; from: string; to: string }) => void;
  onMediaState: (data: { userId: string; audio: boolean; video: boolean }) => void;
  onScreenShareStarted: (userId: string) => void;
  onScreenShareStopped: (userId: string) => void;
}

export class SignalingClient {
  private socket: Socket | null = null;
  private roomId: string | null = null;
  private userId: string | null = null;
  private events: Partial<SignalingEvents> = {};

  constructor() {
    this.userId = this.generateUserId();
  }

  private generateUserId(): string {
    return `user_${Math.random().toString(36).substr(2, 9)}`;
  }

  connect(roomId: string, pin: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      this.roomId = roomId;
      
      console.log('SignalingClient: Connecting to', config.websocket.url);
      
      this.socket = io(config.websocket.url, {
        transports: ['websocket', 'polling'], // Add polling as fallback
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      this.socket.on('connect', () => {
        console.log('SignalingClient: Connected to signaling server');
        this.socket!.emit('join-room', { roomId, pin, userId: this.userId });
      });

      this.socket.on('current-participants', ({ participants }) => {
        console.log('SignalingClient: Current participants:', participants);
        resolve(participants);
      });

      this.socket.on('connect_error', (error) => {
        console.error('SignalingClient: Connection error:', error.message, error.type);
        reject(error);
      });

      // Add timeout
      setTimeout(() => {
        if (!this.socket?.connected) {
          console.error('SignalingClient: Connection timeout');
          reject(new Error('Connection timeout - could not connect to signaling server'));
        }
      }, 10000); // 10 second timeout

      this.setupEventHandlers();
    });
  }

  private setupEventHandlers(): void {
    if (!this.socket) return;

    this.socket.on('user-joined', ({ userId }) => {
      console.log('User joined:', userId);
      this.events.onUserJoined?.(userId);
    });

    this.socket.on('user-left', ({ userId }) => {
      console.log('User left:', userId);
      this.events.onUserLeft?.(userId);
    });

    this.socket.on('offer', (data) => {
      console.log('Received offer from:', data.from);
      this.events.onOffer?.(data);
    });

    this.socket.on('answer', (data) => {
      console.log('Received answer from:', data.from);
      this.events.onAnswer?.(data);
    });

    this.socket.on('ice-candidate', (data) => {
      console.log('Received ICE candidate from:', data.from);
      this.events.onIceCandidate?.(data);
    });

    this.socket.on('media-state', (data) => {
      console.log('Media state update:', data);
      this.events.onMediaState?.(data);
    });

    this.socket.on('screen-share-started', ({ userId }) => {
      console.log('Screen share started by:', userId);
      this.events.onScreenShareStarted?.(userId);
    });

    this.socket.on('screen-share-stopped', ({ userId }) => {
      console.log('Screen share stopped by:', userId);
      this.events.onScreenShareStopped?.(userId);
    });
  }

  on<K extends keyof SignalingEvents>(event: K, handler: SignalingEvents[K]): void {
    this.events[event] = handler;
  }

  sendOffer(offer: RTCSessionDescriptionInit, to: string): void {
    this.socket?.emit('offer', { offer, to });
  }

  sendAnswer(answer: RTCSessionDescriptionInit, to: string): void {
    this.socket?.emit('answer', { answer, to });
  }

  sendIceCandidate(candidate: RTCIceCandidateInit, to: string): void {
    this.socket?.emit('ice-candidate', { candidate, to });
  }

  updateMediaState(audio: boolean, video: boolean): void {
    this.socket?.emit('media-state', { audio, video });
  }

  startScreenShare(): void {
    this.socket?.emit('screen-share-started');
  }

  stopScreenShare(): void {
    this.socket?.emit('screen-share-stopped');
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.emit('leave-room');
      this.socket.disconnect();
      this.socket = null;
    }
  }

  getUserId(): string {
    return this.userId || '';
  }

  getRoomId(): string {
    return this.roomId || '';
  }
}
