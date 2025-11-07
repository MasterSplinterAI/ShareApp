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
      console.log(`Received track from ${this.userId}:`, event.track.kind, event.track.label);
      const [stream] = event.streams;
      
      // Determine if this is a screen share based on multiple indicators:
      // 1. Track label contains 'screen' or 'display'
      // 2. Stream ID contains 'screen'
      // 3. Transceiver mid contains 'screen'
      // 4. Track contentHint is 'detail' (common for screen shares)
      // 5. Transceiver direction is recvonly and it's a video track (screen shares are typically video-only)
      // 6. Check if this is a separate stream (screen shares often come as new streams)
      const trackLabel = event.track.label.toLowerCase();
      const streamId = stream.id.toLowerCase();
      const transceiverMid = event.transceiver.mid?.toLowerCase() || '';
      const contentHint = event.track.contentHint || '';
      const hasAudio = stream.getAudioTracks().length > 0;
      const hasVideo = stream.getVideoTracks().length > 0;
      const isVideoOnly = hasVideo && !hasAudio;
      
      // Check if we already have a regular stream for this user
      // If this is a new video-only stream, it's likely a screen share
      const isNewVideoOnlyStream = event.track.kind === 'video' && isVideoOnly;
      
      const isScreenShare = 
        trackLabel.includes('screen') || 
        trackLabel.includes('display') ||
        trackLabel.includes('desktop') ||
        streamId.includes('screen') ||
        streamId.includes('display') ||
        transceiverMid.includes('screen') ||
        contentHint === 'detail' ||
        (isNewVideoOnlyStream && event.transceiver.direction === 'recvonly');
      
      console.log(`Track detection for ${this.userId}: isScreenShare=${isScreenShare}, label=${event.track.label}, contentHint=${contentHint}, streamId=${stream.id}, isVideoOnly=${isVideoOnly}, direction=${event.transceiver.direction}`);
      
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
    // We don't automatically create offers here - the connection manager controls this
    this.pc.onnegotiationneeded = () => {
      console.log(`Negotiation needed for ${this.userId} (signaling state: ${this.pc.signalingState})`);
      // Don't create offer automatically - let the connection manager handle it explicitly
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

  async addScreenStream(stream: MediaStream): Promise<RTCSessionDescriptionInit | null> {
    this.screenStream = stream;
    
    stream.getTracks().forEach(track => {
      console.log(`Adding screen ${track.kind} track to peer ${this.userId}`);
      // Mark track with contentHint for better detection on remote side
      try {
        if ('contentHint' in track) {
          (track as any).contentHint = 'detail';
        }
      } catch (e) {
        // contentHint might be read-only
      }
      
      // Add with screen-specific transceiver settings
      const transceiver = this.pc.addTransceiver(track, {
        direction: 'sendonly',
        streams: [stream],
      });
      
      // Set transceiver mid to include 'screen' for detection
      if (transceiver.mid) {
        // mid is read-only, but we can log it for debugging
        console.log(`Screen share transceiver mid: ${transceiver.mid}`);
      }
    });
    
    // Trigger renegotiation by creating an offer
    // Return the offer so the connection manager can send it
    try {
      const offer = await this.createOffer();
      console.log(`Created offer for screen share to ${this.userId}`);
      return offer;
    } catch (err) {
      console.error(`Error creating offer for screen share:`, err);
      return null;
    }
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
    // Check signaling state - can only set answer if we have a local offer
    const currentState = this.pc.signalingState;
    
    if (currentState === 'have-local-offer') {
      // Normal case - set the answer
      await this.pc.setRemoteDescription(answer);
      // Flush queued ICE candidates after setting remote description
      await this.flushIceCandidateQueue();
    } else if (currentState === 'stable') {
      // State is already stable - this means both peers sent offers simultaneously
      // and we already resolved it. The answer is late, so we can safely ignore it
      console.log(`Answer from ${this.userId} arrived after state became stable (already handled), ignoring gracefully`);
      return;
    } else if (currentState === 'have-remote-offer') {
      // We're in the middle of handling their offer - wait and retry
      console.log(`Answer from ${this.userId} arrived while handling their offer (state: ${currentState}), ignoring`);
      return;
    } else {
      console.warn(`Cannot set answer for ${this.userId}: signaling state is ${currentState}, expected 'have-local-offer'`);
      return;
    }
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
    // Check signaling state to prevent conflicts
    if (this.pc.signalingState === 'have-local-offer') {
      console.log(`Cannot create offer for ${this.userId}: already have local offer`);
      throw new Error('Offer already pending');
    }
    
    if (this.pc.signalingState === 'have-remote-offer') {
      console.log(`Cannot create offer for ${this.userId}: already have remote offer`);
      throw new Error('Remote offer pending');
    }
    
    // Create offer with proper options
    const offerOptions: RTCOfferOptions = {
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    };
    
    const offer = await this.pc.createOffer(offerOptions);
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
