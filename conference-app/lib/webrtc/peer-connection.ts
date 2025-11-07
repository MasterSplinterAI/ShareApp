// WebRTC Peer Connection Manager
// Handles peer connections, media streams, and ICE candidates

export interface PeerConnectionEvents {
  onTrack: (stream: MediaStream, userId: string, isScreenShare: boolean) => void;
  onTrackRemoved: (streamId: string, userId: string) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState, userId: string) => void;
  onDataChannel?: (channel: RTCDataChannel, userId: string) => void;
}

export class PeerConnection {
  private pc: RTCPeerConnection;
  private userId: string;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private makingOffer = false;
  private ignoreOffer = false;
  private isPolite: boolean;
  private events: PeerConnectionEvents;
  private dataChannel: RTCDataChannel | null = null;
  private iceCandidateQueue: RTCIceCandidateInit[] = [];

  constructor(
    userId: string,
    iceServers: RTCIceServer[],
    isPolite: boolean,
    events: PeerConnectionEvents
  ) {
    this.userId = userId;
    this.isPolite = isPolite;
    this.events = events;

    this.pc = new RTCPeerConnection({
      iceServers,
      iceCandidatePoolSize: 10,
    });

    this.setupEventHandlers();
    this.createDataChannel();
  }

  private setupEventHandlers(): void {
    // Handle incoming tracks
    this.pc.ontrack = (event) => {
      console.log(`Received track from ${this.userId}:`, event.track.kind);
      const [stream] = event.streams;
      
      // Determine if this is a screen share based on track settings or label
      const isScreenShare = stream.id.includes('screen') || 
                           event.track.label.includes('screen') ||
                           (event.transceiver.mid?.includes('screen') ?? false);
      
      this.events.onTrack(stream, this.userId, isScreenShare);
    };

    // Handle connection state changes
    this.pc.onconnectionstatechange = () => {
      console.log(`Connection state for ${this.userId}: ${this.pc.connectionState}`);
      this.events.onConnectionStateChange(this.pc.connectionState, this.userId);
    };

    // Handle ICE connection state
    this.pc.oniceconnectionstatechange = () => {
      console.log(`ICE state for ${this.userId}: ${this.pc.iceConnectionState}`);
    };

    // Handle negotiation needed
    this.pc.onnegotiationneeded = async () => {
      console.log(`Negotiation needed for ${this.userId}`);
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        // The offer will be sent by the connection manager
      } catch (err) {
        console.error(`Error during negotiation with ${this.userId}:`, err);
      } finally {
        this.makingOffer = false;
      }
    };

    // Handle data channel
    this.pc.ondatachannel = (event) => {
      const channel = event.channel;
      console.log(`Data channel received from ${this.userId}: ${channel.label}`);
      this.events.onDataChannel?.(channel, this.userId);
    };
  }

  private createDataChannel(): void {
    try {
      this.dataChannel = this.pc.createDataChannel('messages', {
        ordered: true,
      });
      
      this.dataChannel.onopen = () => {
        console.log(`Data channel opened with ${this.userId}`);
      };
      
      this.dataChannel.onclose = () => {
        console.log(`Data channel closed with ${this.userId}`);
      };
    } catch (err) {
      console.error(`Error creating data channel with ${this.userId}:`, err);
    }
  }

  async addLocalStream(stream: MediaStream): Promise<void> {
    this.localStream = stream;
    
    stream.getTracks().forEach(track => {
      console.log(`Adding ${track.kind} track to peer ${this.userId}`);
      this.pc.addTrack(track, stream);
    });
  }

  async addScreenStream(stream: MediaStream): Promise<void> {
    this.screenStream = stream;
    
    stream.getTracks().forEach(track => {
      console.log(`Adding screen ${track.kind} track to peer ${this.userId}`);
      // Add with screen-specific transceiver settings
      this.pc.addTransceiver(track, {
        direction: 'sendonly',
        streams: [stream],
      });
    });
  }

  removeScreenStream(): void {
    if (!this.screenStream) return;

    this.screenStream.getTracks().forEach(track => {
      const sender = this.pc.getSenders().find(s => s.track === track);
      if (sender) {
        console.log(`Removing screen track from peer ${this.userId}`);
        this.pc.removeTrack(sender);
      }
      track.stop();
    });
    
    this.screenStream = null;
  }

  async updateMediaTrack(oldTrack: MediaStreamTrack, newTrack: MediaStreamTrack): Promise<void> {
    const sender = this.pc.getSenders().find(s => s.track === oldTrack);
    if (sender) {
      await sender.replaceTrack(newTrack);
    }
  }

  async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit | null> {
    const offerCollision = this.makingOffer || this.pc.signalingState !== 'stable';
    this.ignoreOffer = !this.isPolite && offerCollision;

    if (this.ignoreOffer) {
      console.log(`Ignoring offer from ${this.userId} due to offer collision`);
      return null;
    }

    await this.pc.setRemoteDescription(offer);
    await this.pc.setLocalDescription();
    
    // Flush queued ICE candidates after setting remote description
    await this.flushIceCandidateQueue();
    
    return this.pc.localDescription!;
  }

  async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(answer);
    
    // Flush queued ICE candidates after setting remote description
    await this.flushIceCandidateQueue();
  }

  async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    // If remote description is not set, queue the candidate
    if (!this.pc.remoteDescription) {
      console.log(`Queueing ICE candidate from ${this.userId} (remote description not set yet)`);
      this.iceCandidateQueue.push(candidate);
      return;
    }

    // Try to add the candidate immediately
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (err) {
      console.error(`Error adding ICE candidate from ${this.userId}:`, err);
    }
  }

  private async flushIceCandidateQueue(): Promise<void> {
    if (this.iceCandidateQueue.length === 0) return;

    console.log(`Flushing ${this.iceCandidateQueue.length} queued ICE candidates for ${this.userId}`);
    
    while (this.iceCandidateQueue.length > 0) {
      const candidate = this.iceCandidateQueue.shift();
      if (candidate) {
        try {
          await this.pc.addIceCandidate(candidate);
        } catch (err) {
          console.error(`Error adding queued ICE candidate from ${this.userId}:`, err);
        }
      }
    }
  }

  getLocalDescription(): RTCSessionDescriptionInit | null {
    return this.pc.localDescription;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  getIceCandidates(): RTCIceCandidate[] {
    // Note: We'll send candidates as they're generated via onicecandidate
    return [];
  }

  onIceCandidate(callback: (candidate: RTCIceCandidateInit) => void): void {
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        callback(event.candidate);
      }
    };
  }

  sendDataMessage(message: string): void {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(message);
    }
  }

  setAudioEnabled(enabled: boolean): void {
    this.localStream?.getAudioTracks().forEach(track => {
      track.enabled = enabled;
    });
  }

  setVideoEnabled(enabled: boolean): void {
    this.localStream?.getVideoTracks().forEach(track => {
      track.enabled = enabled;
    });
  }

  getStats(): Promise<RTCStatsReport> {
    return this.pc.getStats();
  }

  close(): void {
    this.dataChannel?.close();
    this.localStream?.getTracks().forEach(track => track.stop());
    this.screenStream?.getTracks().forEach(track => track.stop());
    this.pc.close();
  }

  getConnectionState(): RTCPeerConnectionState {
    return this.pc.connectionState;
  }
}
