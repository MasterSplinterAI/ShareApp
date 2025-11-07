// WebRTC Connection Manager
// Manages multiple peer connections and coordinates with signaling

import { PeerConnection, PeerConnectionEvents } from './peer-connection';
import { SignalingClient } from '../signaling/socket';
import { getApiUrl } from '../utils/api';

export interface ConnectionManagerEvents {
  onStreamAdded: (stream: MediaStream, userId: string, isScreenShare: boolean) => void;
  onStreamRemoved: (streamId: string, userId: string) => void;
  onParticipantRemoved?: (userId: string) => void;
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
      console.log(`[ConnectionManager] User joined: ${userId}, creating peer connection`);
      console.log(`[ConnectionManager] Local stream available: ${!!this.localStream}, stream ID: ${this.localStream?.id}`);
      await this.createPeerConnection(userId, true);
      
      // After creating peer connection, ensure local stream is broadcast to the new participant
      // This is critical for rejoining participants
      if (this.localStream && this.localStream.getTracks().length > 0) {
        setTimeout(async () => {
          const pc = this.peers.get(userId);
          if (pc) {
            console.log(`[ConnectionManager] Broadcasting local stream to new participant ${userId}`);
            const senders = pc.getSenders();
            const tracks = this.localStream!.getTracks();
            let needsRenegotiation = false;
            
            // Check and add/replace tracks
            for (const track of tracks) {
              const existingSender = senders.find(s => s.track && s.track.kind === track.kind);
              if (existingSender) {
                // Track exists, but ensure it's the current track
                if (existingSender.track !== track) {
                  console.log(`[ConnectionManager] Replacing ${track.kind} track for ${userId}`);
                  existingSender.replaceTrack(track).catch(err => {
                    console.error(`[ConnectionManager] Error replacing track:`, err);
                  });
                  needsRenegotiation = true;
                }
              } else {
                // Track missing, add it
                console.log(`[ConnectionManager] Adding missing ${track.kind} track for ${userId}`);
                try {
                  pc.addTrack(track, this.localStream!);
                  needsRenegotiation = true;
                } catch (err) {
                  console.error(`[ConnectionManager] Error adding track:`, err);
                }
              }
            }
            
            // If we added/replaced tracks and connection is established, renegotiate
            if (needsRenegotiation && pc.getConnectionState() === 'connected') {
              try {
                const offer = await pc.createOffer();
                this.signaling.sendOffer(offer, userId);
                console.log(`[ConnectionManager] Sent renegotiation offer to ${userId} with updated tracks`);
              } catch (err) {
                console.error(`[ConnectionManager] Error creating renegotiation offer:`, err);
              }
            }
          }
        }, 500);
      }
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
      const response = await fetch(getApiUrl('/api/turn'));
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
    // New user should NOT be polite (wait for offers from existing users)
    // Existing users will create offers when they see this user join
    for (const participantId of participants) {
      await this.createPeerConnection(participantId, false);
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
      console.log(`[ConnectionManager] Adding local stream to peer ${userId}, stream ID: ${this.localStream.id}, tracks: ${this.localStream.getTracks().length}`);
      const videoTracks = this.localStream.getVideoTracks();
      const audioTracks = this.localStream.getAudioTracks();
      console.log(`[ConnectionManager] Local stream has ${videoTracks.length} video tracks, ${audioTracks.length} audio tracks`);
      await pc.addLocalStream(this.localStream);
      console.log(`[ConnectionManager] Local stream added to peer ${userId}`);
    } else {
      console.warn(`[ConnectionManager] WARNING: No local stream available when creating peer connection for ${userId}`);
    }

    // Add screen stream if sharing
    if (this.screenStream) {
      await pc.addScreenStream(this.screenStream);
    }

    // If we're the polite peer (initiator), create an offer
    if (isPolite) {
      // Wait a moment for tracks to be added and any automatic negotiation to settle
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check if we already have a local description (from onnegotiationneeded)
      let offer = pc.getLocalDescription();
      
      if (!offer || offer.type !== 'offer') {
        // Create offer explicitly after adding tracks
        try {
          offer = await pc.createOffer();
          console.log(`Created and sending offer to ${userId}`);
        } catch (err: any) {
          // If offer already exists or is pending, that's okay
          if (err.message?.includes('already') || err.message?.includes('pending')) {
            console.log(`Offer already pending for ${userId}, skipping`);
            return pc;
          }
          console.error(`Error creating offer for ${userId}:`, err);
          return pc;
        }
      } else {
        console.log(`Using existing offer for ${userId}`);
      }
      
      // Send the offer
      if (offer) {
        this.signaling.sendOffer(offer, userId);
        console.log(`Sent offer to ${userId}`);
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
      console.log(`Removing peer connection for ${userId}`);
      pc.close();
      this.peers.delete(userId);
      // Remove the participant from the store (this will remove their streams)
      // Don't call onStreamRemoved with empty streamId as it causes issues
      if (this.events.onParticipantRemoved) {
        console.log(`Calling onParticipantRemoved for ${userId}`);
        this.events.onParticipantRemoved(userId);
      } else {
        console.warn(`onParticipantRemoved callback not set`);
      }
    } else {
      console.warn(`No peer connection found for ${userId}`);
    }
  }

  async startScreenShare(): Promise<void> {
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      // Mark screen share tracks with contentHint for better detection
      this.screenStream.getVideoTracks().forEach(track => {
        // Set contentHint to 'detail' to help identify as screen share
        // Note: This may not work in all browsers as contentHint is often read-only
        try {
          if ('contentHint' in track) {
            (track as any).contentHint = 'detail';
          }
        } catch (e) {
          // contentHint might be read-only, that's okay
          console.log('Could not set contentHint (read-only):', e);
        }
      });

      // Add screen share to all peer connections and send offers
      this.peers.forEach(async (pc, userId) => {
        const offer = await pc.addScreenStream(this.screenStream!);
        if (offer) {
          console.log(`Sending screen share offer to ${userId}`);
          this.signaling.sendOffer(offer, userId);
        }
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
