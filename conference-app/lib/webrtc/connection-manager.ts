// WebRTC Connection Manager
// Manages multiple peer connections and coordinates with signaling

import { PeerConnection, PeerConnectionEvents } from './peer-connection';
import { SignalingClient } from '../signaling/socket';

export interface ConnectionManagerEvents {
  onStreamAdded: (stream: MediaStream, userId: string, isScreenShare: boolean) => void;
  onStreamRemoved: (streamId: string, userId: string) => void;
  onPeerStateChange: (userId: string, state: RTCPeerConnectionState) => void;
  onMediaStateChange: (userId: string, audio: boolean, video: boolean) => void;
}

export class ConnectionManager {
  private signaling: SignalingClient;
  private peers: Map<string, PeerConnection> = new Map();
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private iceServers: RTCIceServer[] = [];
  private events: ConnectionManagerEvents;
  private mediaState = { audio: true, video: true };

  constructor(events: ConnectionManagerEvents) {
    this.signaling = new SignalingClient();
    this.events = events;
    this.setupSignalingHandlers();
  }

  private setupSignalingHandlers(): void {
    this.signaling.on('onUserJoined', async (userId) => {
      await this.createPeerConnection(userId, true);
    });

    this.signaling.on('onUserLeft', (userId) => {
      this.removePeerConnection(userId);
    });

    this.signaling.on('onOffer', async ({ offer, from }) => {
      const pc = await this.getOrCreatePeerConnection(from, false);
      const answer = await pc.handleOffer(offer);
      if (answer) {
        this.signaling.sendAnswer(answer, from);
      }
    });

    this.signaling.on('onAnswer', async ({ answer, from }) => {
      const pc = this.peers.get(from);
      if (pc) {
        await pc.handleAnswer(answer);
      }
    });

    this.signaling.on('onIceCandidate', async ({ candidate, from }) => {
      const pc = this.peers.get(from);
      if (pc) {
        await pc.handleIceCandidate(candidate);
      }
    });

    this.signaling.on('onMediaState', ({ userId, audio, video }) => {
      this.events.onMediaStateChange(userId, audio, video);
    });

    this.signaling.on('onScreenShareStarted', (userId) => {
      // Screen share stream will come through onTrack
      console.log(`User ${userId} started screen sharing`);
    });

    this.signaling.on('onScreenShareStopped', (userId) => {
      // Handle screen share removal
      console.log(`User ${userId} stopped screen sharing`);
    });
  }

  async initialize(roomId: string, pin: string): Promise<void> {
    console.log('ConnectionManager: Starting initialization for room:', roomId);
    
    // Fetch ICE servers
    try {
      console.log('ConnectionManager: Fetching ICE servers...');
      const response = await fetch('/api/turn');
      const data = await response.json();
      this.iceServers = data.iceServers;
      console.log('ConnectionManager: Got ICE servers:', this.iceServers.length);
    } catch (error) {
      console.error('Failed to fetch ICE servers:', error);
      // Use default STUN servers
      this.iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ];
      console.log('ConnectionManager: Using default STUN servers');
    }

    // Get user media
    console.log('ConnectionManager: Getting user media...');
    await this.initializeLocalStream();

    // Connect to signaling server
    console.log('ConnectionManager: Connecting to signaling server...');
    const participants = await this.signaling.connect(roomId, pin);
    console.log('ConnectionManager: Connected, participants:', participants);
    
    // Create peer connections for existing participants
    for (const participantId of participants) {
      await this.createPeerConnection(participantId, true);
    }
  }

  private async initializeLocalStream(): Promise<void> {
    try {
      // Start with audio only if video fails (common on mobile)
      let constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          facingMode: 'user',
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      };

      try {
        this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (videoError) {
        console.warn('Failed to get video, trying audio only:', videoError);
        // Try audio only if video fails
        constraints = {
          video: false,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        };
        this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      }

      // Add local stream to the UI
      this.events.onStreamAdded(this.localStream, 'local', false);
    } catch (error) {
      console.error('Failed to get user media:', error);
      // Continue without local media rather than failing completely
      this.localStream = new MediaStream();
      this.events.onStreamAdded(this.localStream, 'local', false);
    }
  }

  private async createPeerConnection(userId: string, isPolite: boolean): Promise<PeerConnection> {
    const pcEvents: PeerConnectionEvents = {
      onTrack: (stream, userId, isScreenShare) => {
        this.events.onStreamAdded(stream, userId, isScreenShare);
      },
      onTrackRemoved: (streamId, userId) => {
        this.events.onStreamRemoved(streamId, userId);
      },
      onConnectionStateChange: (state, userId) => {
        this.events.onPeerStateChange(userId, state);
        if (state === 'failed' || state === 'closed') {
          this.removePeerConnection(userId);
        }
      },
    };

    const pc = new PeerConnection(userId, this.iceServers, isPolite, pcEvents);
    this.peers.set(userId, pc);

    // Set up ICE candidate handling
    pc.onIceCandidate((candidate) => {
      this.signaling.sendIceCandidate(candidate, userId);
    });

    // Add local stream if available
    if (this.localStream) {
      await pc.addLocalStream(this.localStream);
    }

    // Add screen stream if sharing
    if (this.screenStream) {
      await pc.addScreenStream(this.screenStream);
    }

    // If we're the polite peer (initiator), create an offer
    if (isPolite) {
      const offer = pc.getLocalDescription();
      if (offer) {
        this.signaling.sendOffer(offer, userId);
      }
    }

    return pc;
  }

  private async getOrCreatePeerConnection(userId: string, isPolite: boolean): Promise<PeerConnection> {
    let pc = this.peers.get(userId);
    if (!pc) {
      pc = await this.createPeerConnection(userId, isPolite);
    }
    return pc;
  }

  private removePeerConnection(userId: string): void {
    const pc = this.peers.get(userId);
    if (pc) {
      pc.close();
      this.peers.delete(userId);
      this.events.onStreamRemoved('', userId);
    }
  }

  async startScreenShare(): Promise<void> {
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      // Add screen share to all peer connections
      this.peers.forEach(async (pc, userId) => {
        await pc.addScreenStream(this.screenStream!);
      });

      // Handle screen share ending
      this.screenStream.getVideoTracks()[0].onended = () => {
        this.stopScreenShare();
      };

      // Notify others
      this.signaling.startScreenShare();
      
      // Add to local UI
      this.events.onStreamAdded(this.screenStream, 'local', true);
    } catch (error) {
      console.error('Failed to start screen share:', error);
      throw error;
    }
  }

  stopScreenShare(): void {
    if (!this.screenStream) return;

    // Remove from all peer connections
    this.peers.forEach((pc, userId) => {
      pc.removeScreenStream();
    });

    // Stop tracks
    this.screenStream.getTracks().forEach(track => track.stop());
    
    // Remove from UI
    this.events.onStreamRemoved(this.screenStream.id, 'local');
    
    this.screenStream = null;
    
    // Notify others
    this.signaling.stopScreenShare();
  }

  setAudioEnabled(enabled: boolean): void {
    this.mediaState.audio = enabled;
    this.localStream?.getAudioTracks().forEach(track => {
      track.enabled = enabled;
    });
    
    // Update all peer connections
    this.peers.forEach((pc, userId) => {
      pc.setAudioEnabled(enabled);
    });
    
    // Notify others
    this.signaling.updateMediaState(enabled, this.mediaState.video);
  }

  setVideoEnabled(enabled: boolean): void {
    this.mediaState.video = enabled;
    this.localStream?.getVideoTracks().forEach(track => {
      track.enabled = enabled;
    });
    
    // Update all peer connections
    this.peers.forEach((pc, userId) => {
      pc.setVideoEnabled(enabled);
    });
    
    // Notify others
    this.signaling.updateMediaState(this.mediaState.audio, enabled);
  }

  async switchCamera(): Promise<void> {
    if (!this.localStream) return;

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    // Get current facing mode
    const constraints = videoTrack.getConstraints();
    const currentMode = constraints.facingMode || 'user';
    const newMode = currentMode === 'user' ? 'environment' : 'user';

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newMode },
        audio: false,
      });

      const newVideoTrack = newStream.getVideoTracks()[0];
      
      // Replace track in local stream
      this.localStream.removeTrack(videoTrack);
      this.localStream.addTrack(newVideoTrack);
      videoTrack.stop();

      // Update all peer connections
      this.peers.forEach(async (pc, userId) => {
        await pc.updateMediaTrack(videoTrack, newVideoTrack);
      });
    } catch (error) {
      console.error('Failed to switch camera:', error);
    }
  }

  disconnect(): void {
    // Stop all streams
    this.localStream?.getTracks().forEach(track => track.stop());
    this.screenStream?.getTracks().forEach(track => track.stop());
    
    // Close all peer connections
    this.peers.forEach((pc, userId) => {
      pc.close();
    });
    this.peers.clear();
    
    // Disconnect from signaling
    this.signaling.disconnect();
  }

  getMediaState(): { audio: boolean; video: boolean } {
    return { ...this.mediaState };
  }

  isScreenSharing(): boolean {
    return this.screenStream !== null;
  }
}
