// Connection manager for peer connection lifecycle and track management
import { logger } from '../core/Logger.js';
import { eventBus } from '../core/EventBus.js';
import { stateManager } from '../core/StateManager.js';
import { config } from '../core/Config.js';
import { iceServersManager } from './IceServersManager.js';
import { signalingClient } from './SignalingClient.js';
import ConnectionStateMachine from './ConnectionStateMachine.js';

class ConnectionManager {
  constructor() {
    this.connections = new Map(); // peerId -> RTCPeerConnection
    this.stateMachines = new Map(); // peerId -> ConnectionStateMachine
    this.transceivers = new Map(); // peerId -> { camera, screen, audio }
    this.pendingOffers = new Map(); // peerId -> Promise
    this.pendingAnswers = new Map(); // peerId -> Promise
    this.iceCandidateQueues = new Map(); // peerId -> Array<ICE candidate>
    this.renegotiationQueue = new Set(); // Set of peerIds waiting for renegotiation
    this.isRenegotiating = false;
  }

  /**
   * Create a peer connection
   */
  async createConnection(peerId, skipOffer = false) {
    // Prevent self-connection
    const socketId = signalingClient.getSocketId();
    if (peerId === socketId) {
      logger.warn('ConnectionManager', 'Cannot create connection to self', { peerId });
      return null;
    }

    // Check if connection already exists
    if (this.connections.has(peerId)) {
      const existing = this.connections.get(peerId);
      const state = existing.connectionState;
      
      if (state === 'connected' || state === 'connecting') {
        logger.debug('ConnectionManager', 'Connection already exists', { peerId, state });
        return existing;
      }
      
      // Close unhealthy connection
      logger.info('ConnectionManager', 'Closing unhealthy connection', { peerId, state });
      this.closeConnection(peerId);
    }

    logger.info('ConnectionManager', 'Creating peer connection', { peerId, skipOffer });

    try {
      // Get ICE servers
      const iceServers = await iceServersManager.getIceServers();
      
      // Create RTCPeerConnection with proper configuration
      const pc = new RTCPeerConnection({
        iceServers,
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        sdpSemantics: 'unified-plan'
      });

      // Create state machine
      const stateMachine = new ConnectionStateMachine(peerId);
      this.stateMachines.set(peerId, stateMachine);
      stateMachine.transition('connecting');

      // Store connection
      this.connections.set(peerId, pc);

      // Don't create transceivers upfront - let tracks create them naturally
      // This prevents DTLS role conflicts in mesh topology
      this.transceivers.set(peerId, {
        camera: null,
        screen: null,
        audio: null
      });

      // Set up event handlers
      this.setupConnectionHandlers(pc, peerId, stateMachine);

      // Always create transceivers for receiving tracks, even if we don't have local tracks
      // This ensures we can receive remote audio/video
      // Use addTransceiver with 'recvonly' to ensure SDP has m-lines for receiving
      const transceivers = this.transceivers.get(peerId);
      if (!transceivers.audio) {
        transceivers.audio = pc.addTransceiver('audio', { 
          direction: 'recvonly',
          streams: []
        });
        logger.debug('ConnectionManager', 'Created audio transceiver for receiving', { peerId });
      }
      if (!transceivers.camera) {
        transceivers.camera = pc.addTransceiver('video', { 
          direction: 'recvonly',
          streams: []
        });
        logger.debug('ConnectionManager', 'Created video transceiver for receiving', { peerId });
      }

      // Add local tracks (will update transceivers if tracks exist)
      await this.addLocalTracks(pc, peerId);

      // Create and send offer (unless we're expecting an incoming offer)
      if (!skipOffer) {
        await this.createAndSendOffer(peerId);
      } else {
        logger.debug('ConnectionManager', 'Skipping offer creation, expecting incoming offer', { peerId });
      }

      // Update state
      const peers = stateManager.getState('peers') || new Map();
      peers.set(peerId, {
        connection: pc,
        state: 'connecting',
        tracks: { camera: null, screen: null, audio: null },
        metadata: {}
      });
      stateManager.setState({ peers });

      eventBus.emit('webrtc:connection:created', { peerId });

      return pc;
    } catch (error) {
      logger.error('ConnectionManager', 'Failed to create connection', { peerId, error });
      const stateMachine = this.stateMachines.get(peerId);
      if (stateMachine) {
        stateMachine.transition('failed', error.message);
      }
      throw error;
    }
  }

  /**
   * Set up connection event handlers
   */
  setupConnectionHandlers(pc, peerId, stateMachine) {
    // ICE candidate handler
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        logger.debug('ConnectionManager', 'ICE candidate generated', { peerId });
        
        // Queue candidate if remote description not set yet
        if (pc.remoteDescription === null) {
          if (!this.iceCandidateQueues.has(peerId)) {
            this.iceCandidateQueues.set(peerId, []);
          }
          this.iceCandidateQueues.get(peerId).push(event.candidate);
          logger.debug('ConnectionManager', 'Queued ICE candidate', { peerId });
        } else {
          // Send immediately
          const roomId = stateManager.getState('roomId');
          signalingClient.sendIceCandidate(peerId, event.candidate, roomId);
        }
      } else {
        logger.info('ConnectionManager', 'ICE gathering complete', { peerId });
        eventBus.emit(`webrtc:iceGatheringComplete:${peerId}`, { peerId });
      }
    };

    // ICE connection state change
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      logger.info('ConnectionManager', 'ICE connection state changed', { peerId, state });

      if (state === 'connected' || state === 'completed') {
        stateMachine.transition('connected');
        const peers = stateManager.getState('peers') || new Map();
        if (peers.has(peerId)) {
          peers.get(peerId).state = 'connected';
          stateManager.setState({ peers });
        }
        eventBus.emit(`webrtc:connection:established:${peerId}`, { peerId });
      } else if (state === 'disconnected') {
        stateMachine.transition('disconnected');
        const peers = stateManager.getState('peers') || new Map();
        if (peers.has(peerId)) {
          peers.get(peerId).state = 'disconnected';
          stateManager.setState({ peers });
        }
        eventBus.emit(`webrtc:connection:disconnected:${peerId}`, { peerId });
      } else if (state === 'failed') {
        stateMachine.transition('failed', 'ICE connection failed');
        const peers = stateManager.getState('peers') || new Map();
        if (peers.has(peerId)) {
          peers.get(peerId).state = 'failed';
          stateManager.setState({ peers });
        }
        eventBus.emit(`webrtc:connection:failed:${peerId}`, { peerId });
      }
    };

    // Track handler
    pc.ontrack = (event) => {
      logger.info('ConnectionManager', 'ontrack event fired', {
        peerId,
        streams: event.streams?.length || 0,
        track: event.track ? {
          id: event.track.id,
          kind: event.track.kind,
          label: event.track.label,
          enabled: event.track.enabled,
          readyState: event.track.readyState
        } : null
      });

      const track = event.track;
      if (!track) {
        logger.warn('ConnectionManager', 'No track in ontrack event', { peerId, event });
        return;
      }

      logger.info('ConnectionManager', 'Received remote track', {
        peerId,
        trackId: track.id,
        kind: track.kind,
        label: track.label,
        enabled: track.enabled,
        readyState: track.readyState
      });

      // Determine track type
      const trackType = this.determineTrackType(track, peerId);

      // Update peer tracks
      const peers = stateManager.getState('peers') || new Map();
      if (peers.has(peerId)) {
        const peer = peers.get(peerId);
        if (trackType === 'camera') {
          peer.tracks.camera = track;
        } else if (trackType === 'screen') {
          peer.tracks.screen = track;
        } else if (trackType === 'audio') {
          peer.tracks.audio = track;
        }
        stateManager.setState({ peers });
      }

      // Emit track event
      eventBus.emit(`webrtc:track:${peerId}`, {
        peerId,
        track,
        type: trackType,
        stream: event.streams[0]
      });

      // Set up track ended handler
      track.onended = () => {
        logger.info('ConnectionManager', 'Remote track ended', { peerId, trackType });
        const peers = stateManager.getState('peers') || new Map();
        if (peers.has(peerId)) {
          const peer = peers.get(peerId);
          if (trackType === 'camera') {
            peer.tracks.camera = null;
          } else if (trackType === 'screen') {
            peer.tracks.screen = null;
          } else if (trackType === 'audio') {
            peer.tracks.audio = null;
          }
          stateManager.setState({ peers });
        }
        eventBus.emit(`webrtc:trackEnded:${peerId}`, { peerId, trackType });
      };
    };

    // Connection state change
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      logger.info('ConnectionManager', 'Connection state changed', { peerId, state });
      eventBus.emit(`webrtc:connectionState:${peerId}`, { peerId, state });
    };
  }

  /**
   * Determine track type (camera, screen, or audio)
   */
  determineTrackType(track, peerId) {
    if (track.kind === 'audio') {
      return 'audio';
    }

    // Check track settings for screen share
    try {
      const settings = track.getSettings();
      if (settings.displaySurface === 'monitor' || 
          settings.displaySurface === 'window' ||
          settings.displaySurface === 'browser') {
        return 'screen';
      }
    } catch (e) {
      // Fallback: check track label
      if (track.label && (
          track.label.includes('screen') ||
          track.label.includes('Screen') ||
          track.label.includes('Display'))) {
        return 'screen';
      }
    }

    // Check if we already have a camera track for this peer
    const peers = stateManager.getState('peers') || new Map();
    if (peers.has(peerId)) {
      const peer = peers.get(peerId);
      if (peer.tracks.camera && track.id !== peer.tracks.camera.id) {
        // We have a camera track, this must be screen
        return 'screen';
      }
    }

    // Default to camera
    return 'camera';
  }

  /**
   * Add local tracks to connection
   */
  async addLocalTracks(pc, peerId) {
    const { trackManager } = await import('./TrackManager.js');
    
    let transceivers = this.transceivers.get(peerId);
    if (!transceivers) {
      transceivers = { camera: null, screen: null, audio: null };
      this.transceivers.set(peerId, transceivers);
    }

    // Add audio track - update transceiver if it exists
    const audioTrack = trackManager.getAudioTrack();
    if (audioTrack && audioTrack.readyState === 'live') {
      if (transceivers.audio && transceivers.audio.sender) {
        // Transceiver exists and has sender, replace track
        await transceivers.audio.sender.replaceTrack(audioTrack);
        logger.debug('ConnectionManager', 'Added audio track to existing transceiver', { peerId });
      } else if (transceivers.audio) {
        // Transceiver exists but is recvonly (no sender), add track which will create sender
        pc.addTrack(audioTrack);
        // Find the transceiver that now has this track
        const transceiversList = pc.getTransceivers();
        const audioTransceiver = transceiversList.find(t => 
          t.receiver.track?.kind === 'audio' && t.sender.track === audioTrack
        );
        if (audioTransceiver) {
          transceivers.audio = audioTransceiver;
        }
        logger.debug('ConnectionManager', 'Added audio track to recvonly transceiver', { peerId });
      } else {
        // Create new transceiver with track
        transceivers.audio = pc.addTransceiver(audioTrack, { direction: 'sendrecv' });
        logger.debug('ConnectionManager', 'Created audio transceiver with track', { peerId });
      }
    }

    // Add camera track - update transceiver if it exists
    const cameraTrack = trackManager.getCameraTrack();
    if (cameraTrack && cameraTrack.readyState === 'live' && cameraTrack.enabled) {
      if (transceivers.camera && transceivers.camera.sender) {
        // Transceiver exists and has sender, replace track
        await transceivers.camera.sender.replaceTrack(cameraTrack);
        logger.debug('ConnectionManager', 'Added camera track to existing transceiver', { peerId });
      } else if (transceivers.camera) {
        // Transceiver exists but is recvonly (no sender), add track which will create sender
        pc.addTrack(cameraTrack);
        // Find the transceiver that now has this track
        const transceiversList = pc.getTransceivers();
        const videoTransceiver = transceiversList.find(t => 
          t.receiver.track?.kind === 'video' && t.sender.track === cameraTrack
        );
        if (videoTransceiver) {
          transceivers.camera = videoTransceiver;
        }
        logger.debug('ConnectionManager', 'Added camera track to recvonly transceiver', { peerId });
      } else {
        // Create new transceiver with track
        transceivers.camera = pc.addTransceiver(cameraTrack, { direction: 'sendrecv' });
        logger.debug('ConnectionManager', 'Created camera transceiver with track', { peerId });
      }
    }

    // Screen track is added separately when screen sharing starts
  }

  /**
   * Create and send offer
   */
  async createAndSendOffer(peerId) {
    const pc = this.connections.get(peerId);
    if (!pc) {
      throw new Error(`No connection found for peer ${peerId}`);
    }

    // Wait for stable signaling state
    if (pc.signalingState !== 'stable') {
      logger.debug('ConnectionManager', 'Waiting for stable signaling state', {
        peerId,
        currentState: pc.signalingState
      });
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout waiting for stable signaling state'));
        }, 10000);

        const checkStable = () => {
          if (pc.signalingState === 'stable') {
            clearTimeout(timeout);
            pc.removeEventListener('signalingstatechange', checkStable);
            this.createAndSendOffer(peerId).then(resolve).catch(reject);
          }
        };

        pc.addEventListener('signalingstatechange', checkStable);
      });
    }

    // Check if offer already pending
    if (this.pendingOffers.has(peerId)) {
      logger.debug('ConnectionManager', 'Offer already pending', { peerId });
      return this.pendingOffers.get(peerId);
    }

    const offerPromise = (async () => {
      try {
        logger.info('ConnectionManager', 'Creating offer', { peerId });

        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });

        await pc.setLocalDescription(offer);

        const roomId = stateManager.getState('roomId');
        signalingClient.sendOffer(peerId, pc.localDescription, roomId);

        logger.info('ConnectionManager', 'Offer sent', { peerId });
        return offer;
      } catch (error) {
        logger.error('ConnectionManager', 'Failed to create/send offer', { peerId, error });
        throw error;
      } finally {
        this.pendingOffers.delete(peerId);
      }
    })();

    this.pendingOffers.set(peerId, offerPromise);
    return offerPromise;
  }

  /**
   * Handle received offer
   */
  async handleOffer(peerId, sdp) {
    logger.info('ConnectionManager', 'Handling offer', { 
      peerId, 
      currentState: this.connections.get(peerId)?.signalingState,
      hasSdp: !!sdp,
      sdpType: sdp?.type
    });

    let pc = this.connections.get(peerId);
    
    // Create connection if it doesn't exist (skip offer creation since we're receiving one)
    if (!pc) {
      logger.info('ConnectionManager', 'No connection exists, creating new one for offer', { peerId });
      pc = await this.createConnection(peerId, true); // Skip offer creation
    }

    try {
      // Handle glare scenario: if we have a local offer, rollback and accept remote offer
      if (pc.signalingState === 'have-local-offer') {
        logger.warn('ConnectionManager', 'Glare detected: both peers created offers. Rolling back local offer.', { peerId });
        
        // Cancel pending offer
        this.pendingOffers.delete(peerId);
        
        // Rollback local description to resolve conflict
        try {
          await pc.setLocalDescription({ type: 'rollback' });
          logger.debug('ConnectionManager', 'Rollback successful, state is now:', { peerId, state: pc.signalingState });
        } catch (rollbackError) {
          // Rollback may not be supported, close and recreate connection
          logger.warn('ConnectionManager', 'Rollback not supported, recreating connection', { peerId, error: rollbackError });
          pc.close();
          this.connections.delete(peerId);
          this.transceivers.delete(peerId);
          pc = await this.createConnection(peerId);
        }
      }

      // Wait for stable state if needed
      if (pc.signalingState !== 'stable') {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Timeout waiting for stable signaling state'));
          }, 5000);

          const checkStable = () => {
            if (pc.signalingState === 'stable') {
              clearTimeout(timeout);
              pc.removeEventListener('signalingstatechange', checkStable);
              resolve();
            }
          };

          pc.addEventListener('signalingstatechange', checkStable);
          // Also check immediately in case already stable
          if (pc.signalingState === 'stable') {
            clearTimeout(timeout);
            resolve();
          }
        });
      }

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));

      // Process queued ICE candidates
      if (this.iceCandidateQueues.has(peerId)) {
        const queue = this.iceCandidateQueues.get(peerId);
        logger.debug('ConnectionManager', 'Processing queued ICE candidates', {
          peerId,
          count: queue.length
        });

        for (const candidate of queue) {
          try {
            await pc.addIceCandidate(candidate);
          } catch (error) {
            logger.warn('ConnectionManager', 'Failed to add queued ICE candidate', { error });
          }
        }

        this.iceCandidateQueues.delete(peerId);
      }

      // Create and send answer
      await this.createAndSendAnswer(peerId);
    } catch (error) {
      logger.error('ConnectionManager', 'Failed to handle offer', { peerId, error });
      throw error;
    }
  }

  /**
   * Create and send answer
   */
  async createAndSendAnswer(peerId) {
    const pc = this.connections.get(peerId);
    if (!pc) {
      throw new Error(`No connection found for peer ${peerId}`);
    }

    // Check if answer already pending
    if (this.pendingAnswers.has(peerId)) {
      logger.debug('ConnectionManager', 'Answer already pending', { peerId });
      return this.pendingAnswers.get(peerId);
    }

    const answerPromise = (async () => {
      try {
        logger.info('ConnectionManager', 'Creating answer', { peerId });

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        const roomId = stateManager.getState('roomId');
        signalingClient.sendAnswer(peerId, pc.localDescription, roomId);

        logger.info('ConnectionManager', 'Answer sent', { peerId });
        return answer;
      } catch (error) {
        logger.error('ConnectionManager', 'Failed to create/send answer', { peerId, error });
        throw error;
      } finally {
        this.pendingAnswers.delete(peerId);
      }
    })();

    this.pendingAnswers.set(peerId, answerPromise);
    return answerPromise;
  }

  /**
   * Handle received answer
   */
  async handleAnswer(peerId, sdp) {
    logger.info('ConnectionManager', 'Handling answer', { peerId, currentState: this.connections.get(peerId)?.signalingState });

    const pc = this.connections.get(peerId);
    if (!pc) {
      logger.warn('ConnectionManager', 'No connection found for answer', { peerId });
      return;
    }

    try {
      // Check if we're in the right state to set remote answer
      const currentState = pc.signalingState;
      
      if (currentState === 'stable') {
        logger.debug('ConnectionManager', 'Already stable, answer may have been processed', { peerId });
        return;
      }
      
      if (currentState !== 'have-local-offer') {
        logger.warn('ConnectionManager', 'Cannot set remote answer: wrong signaling state', {
          peerId,
          state: currentState
        });
        
        // Wait for correct state with timeout
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            logger.warn('ConnectionManager', 'Timeout waiting for have-local-offer state', { peerId, finalState: pc.signalingState });
            resolve(); // Don't reject, just continue
          }, 2000);

          const checkState = () => {
            if (pc.signalingState === 'have-local-offer') {
              clearTimeout(timeout);
              pc.removeEventListener('signalingstatechange', checkState);
              resolve();
            } else if (pc.signalingState === 'stable') {
              // Already stable, answer was processed
              clearTimeout(timeout);
              pc.removeEventListener('signalingstatechange', checkState);
              resolve();
            }
          };

          pc.addEventListener('signalingstatechange', checkState);
          checkState();
        });
      }

      // Double-check state before setting remote description
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        logger.debug('ConnectionManager', 'Remote answer set successfully', { peerId, newState: pc.signalingState });
      } else {
        logger.warn('ConnectionManager', 'Skipping answer - still in wrong state', { peerId, state: pc.signalingState });
        return;
      }

      // Process queued ICE candidates
      if (this.iceCandidateQueues.has(peerId)) {
        const queue = this.iceCandidateQueues.get(peerId);
        logger.debug('ConnectionManager', 'Processing queued ICE candidates', {
          peerId,
          count: queue.length
        });

        for (const candidate of queue) {
          try {
            await pc.addIceCandidate(candidate);
          } catch (error) {
            logger.warn('ConnectionManager', 'Failed to add queued ICE candidate', { error });
          }
        }

        this.iceCandidateQueues.delete(peerId);
      }
    } catch (error) {
      logger.error('ConnectionManager', 'Failed to handle answer', { peerId, error, state: pc.signalingState });
      // Don't throw - log and continue, connection might still work
      logger.warn('ConnectionManager', 'Continuing despite answer handling error', { peerId });
    }
  }

  /**
   * Handle ICE candidate
   */
  async handleIceCandidate(peerId, candidate) {
    const pc = this.connections.get(peerId);
    if (!pc) {
      // Queue candidate if connection doesn't exist yet
      if (!this.iceCandidateQueues.has(peerId)) {
        this.iceCandidateQueues.set(peerId, []);
      }
      this.iceCandidateQueues.get(peerId).push(candidate);
      logger.debug('ConnectionManager', 'Queued ICE candidate', { peerId });
      return;
    }

    try {
      await pc.addIceCandidate(candidate);
      logger.debug('ConnectionManager', 'Added ICE candidate', { peerId });
    } catch (error) {
      logger.warn('ConnectionManager', 'Failed to add ICE candidate', { peerId, error });
    }
  }

  /**
   * Add track to connection
   */
  async addTrack(peerId, track, type) {
    const pc = this.connections.get(peerId);
    if (!pc) {
      throw new Error(`No connection found for peer ${peerId}`);
    }

    let transceivers = this.transceivers.get(peerId);
    if (!transceivers) {
      transceivers = { camera: null, screen: null, audio: null };
      this.transceivers.set(peerId, transceivers);
    }

    try {
      if (type === 'camera') {
        if (!transceivers.camera) {
          transceivers.camera = pc.addTransceiver(track, { direction: 'sendrecv' });
        } else {
          await transceivers.camera.sender.replaceTrack(track);
        }
        logger.info('ConnectionManager', 'Added camera track', { peerId });
      } else if (type === 'screen') {
        if (!transceivers.screen) {
          transceivers.screen = pc.addTransceiver(track, { direction: 'sendrecv' });
        } else {
          await transceivers.screen.sender.replaceTrack(track);
        }
        logger.info('ConnectionManager', 'Added screen track', { peerId });
      } else if (type === 'audio') {
        if (!transceivers.audio) {
          transceivers.audio = pc.addTransceiver(track, { direction: 'sendrecv' });
        } else {
          await transceivers.audio.sender.replaceTrack(track);
        }
        logger.info('ConnectionManager', 'Added audio track', { peerId });
      }

      // Renegotiate
      await this.renegotiateConnection(peerId);
    } catch (error) {
      logger.error('ConnectionManager', 'Failed to add track', { peerId, type, error });
      throw error;
    }
  }

  /**
   * Remove track from connection
   */
  async removeTrack(peerId, type) {
    const pc = this.connections.get(peerId);
    if (!pc) {
      return;
    }

    const transceivers = this.transceivers.get(peerId);
    if (!transceivers) {
      return;
    }

    try {
      if (type === 'camera') {
        await transceivers.camera.sender.replaceTrack(null);
        logger.info('ConnectionManager', 'Removed camera track', { peerId });
      } else if (type === 'screen') {
        await transceivers.screen.sender.replaceTrack(null);
        logger.info('ConnectionManager', 'Removed screen track', { peerId });
      } else if (type === 'audio') {
        await transceivers.audio.sender.replaceTrack(null);
        logger.info('ConnectionManager', 'Removed audio track', { peerId });
      }

      // Renegotiate
      await this.renegotiateConnection(peerId);
    } catch (error) {
      logger.error('ConnectionManager', 'Failed to remove track', { peerId, type, error });
      throw error;
    }
  }

  /**
   * Renegotiate connection
   */
  async renegotiateConnection(peerId) {
    if (this.isRenegotiating) {
      this.renegotiationQueue.add(peerId);
      return;
    }

    this.isRenegotiating = true;
    this.renegotiationQueue.add(peerId);

    try {
      while (this.renegotiationQueue.size > 0) {
        const targetPeerId = Array.from(this.renegotiationQueue)[0];
        this.renegotiationQueue.delete(targetPeerId);

        const pc = this.connections.get(targetPeerId);
        if (!pc || pc.signalingState !== 'stable') {
          continue;
        }

        logger.info('ConnectionManager', 'Renegotiating connection', { peerId: targetPeerId });
        await this.createAndSendOffer(targetPeerId);
      }
    } finally {
      this.isRenegotiating = false;
    }
  }

  /**
   * Close connection
   */
  closeConnection(peerId) {
    const pc = this.connections.get(peerId);
    if (pc) {
      pc.close();
      this.connections.delete(peerId);
      logger.info('ConnectionManager', 'Connection closed', { peerId });
    }

    const stateMachine = this.stateMachines.get(peerId);
    if (stateMachine) {
      stateMachine.destroy();
      this.stateMachines.delete(peerId);
    }

    this.transceivers.delete(peerId);
    this.pendingOffers.delete(peerId);
    this.pendingAnswers.delete(peerId);
    this.iceCandidateQueues.delete(peerId);
    this.renegotiationQueue.delete(peerId);

    // Update state
    const peers = stateManager.getState('peers') || new Map();
    peers.delete(peerId);
    stateManager.setState({ peers });

    eventBus.emit('webrtc:connection:closed', { peerId });
  }

  /**
   * Close all connections
   */
  closeAllConnections() {
    const peerIds = Array.from(this.connections.keys());
    peerIds.forEach(peerId => this.closeConnection(peerId));
    logger.info('ConnectionManager', 'All connections closed');
  }

  /**
   * Get connection
   */
  getConnection(peerId) {
    return this.connections.get(peerId);
  }

  /**
   * Get all connections
   */
  getAllConnections() {
    return Array.from(this.connections.entries()).map(([peerId, pc]) => ({ peerId, pc }));
  }
}

// Export singleton instance
export const connectionManager = new ConnectionManager();
export default connectionManager;

