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

      // Add local tracks - this will create transceivers automatically
      // Using addTrack() ensures transceivers are created properly
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
      if (!peers.has(peerId)) {
        // Initialize peer if doesn't exist
        peers.set(peerId, {
          connection: pc,
          state: 'connected',
          tracks: { camera: null, screen: null, audio: null },
          metadata: {}
        });
      }
      
      const peer = peers.get(peerId);
      if (trackType === 'camera') {
        peer.tracks.camera = track;
      } else if (trackType === 'screen') {
        peer.tracks.screen = track;
      } else if (trackType === 'audio') {
        peer.tracks.audio = track;
        // Start audio level monitoring for audio tracks
        this.startAudioLevelMonitoring(peerId, track);
        
        // Monitor track enabled/disabled state for audio tracks (when mic is muted/unmuted)
        let enabledState = track.enabled;
        let enabledCheckInterval = setInterval(() => {
          if (track.readyState === 'ended') {
            clearInterval(enabledCheckInterval);
            return;
          }
          
          if (track.enabled !== enabledState) {
            enabledState = track.enabled;
            logger.info('ConnectionManager', 'Remote audio track enabled state changed', {
              peerId,
              enabled: track.enabled,
              readyState: track.readyState
            });
            
            // Emit event to update status indicators
            eventBus.emit(`webrtc:peer:trackUpdated:${peerId}`, {
              peerId,
              trackType: 'audio'
            });
          }
        }, 500);
        
        // Clean up interval when track ends
        const originalAudioOnEnded = track.onended;
        track.onended = () => {
          clearInterval(enabledCheckInterval);
          if (originalAudioOnEnded) {
            originalAudioOnEnded();
          }
        };
      }
      stateManager.setState({ peers });
      
      // Update status indicators
      eventBus.emit(`webrtc:peer:trackUpdated:${peerId}`, { peerId, trackType });

      // Emit track event
      eventBus.emit(`webrtc:track:${peerId}`, {
        peerId,
        track,
        type: trackType,
        stream: event.streams[0]
      });

      // For audio tracks, create an audio element and play it
      if (trackType === 'audio' && track.kind === 'audio') {
        this.setupAudioPlayback(peerId, track);
      }

      // Set up track ended handler
      const originalOnEnded = () => {
        logger.info('ConnectionManager', 'Remote track ended', { peerId, trackType });
        const peers = stateManager.getState('peers') || new Map();
        if (peers.has(peerId)) {
          const peer = peers.get(peerId);
          if (trackType === 'camera') {
            peer.tracks.camera = null;
            // Emit track ended event so VideoGrid can show placeholder
            eventBus.emit(`webrtc:trackEnded:${peerId}`, {
              peerId,
              trackType: 'camera'
            });
          } else if (trackType === 'screen') {
            peer.tracks.screen = null;
            // Emit track ended event so VideoGrid can remove the screen share tile
            eventBus.emit(`webrtc:trackEnded:${peerId}`, {
              peerId,
              trackType: 'screen'
            });
            // When screen share ends, ensure camera feed is still visible
            if (peer.tracks.camera && peer.tracks.camera.readyState === 'live') {
              // Re-emit camera track to ensure it's displayed
              eventBus.emit(`webrtc:track:${peerId}`, {
                peerId,
                track: peer.tracks.camera,
                type: 'camera',
                stream: new MediaStream([peer.tracks.camera])
              });
            }
          } else if (trackType === 'audio') {
            peer.tracks.audio = null;
            // Remove audio element
            const audioElement = document.getElementById(`audio-${peerId}`);
            if (audioElement) {
              audioElement.srcObject = null;
              audioElement.remove();
            }
          }
          stateManager.setState({ peers });
        }
      };

      // Set up track ended handler - ensure it's called when track ends
      // This fires when the remote peer stops sending the track
      track.onended = () => {
        logger.info('ConnectionManager', 'Remote track onended event fired', { peerId, trackType, trackId: track.id });
        originalOnEnded();
      };
      
      // Also listen for track ended event as backup
      track.addEventListener('ended', () => {
        logger.info('ConnectionManager', 'Remote track ended event listener fired', { peerId, trackType, trackId: track.id });
        originalOnEnded();
      }, { once: true });
      
      // For screen tracks, also monitor readyState changes and transceiver state
      if (trackType === 'screen' && track.kind === 'video') {
        let readyStateCheckInterval = setInterval(() => {
          if (track.readyState === 'ended') {
            clearInterval(readyStateCheckInterval);
            logger.info('ConnectionManager', 'Screen track readyState changed to ended', { peerId, trackId: track.id });
            originalOnEnded();
          }
          
          // Also check if the transceiver receiver track is null or ended
          const transceivers = this.transceivers.get(peerId);
          if (transceivers && transceivers.screen) {
            const receiverTrack = transceivers.screen.receiver.track;
            if (!receiverTrack || receiverTrack.readyState === 'ended') {
              clearInterval(readyStateCheckInterval);
              logger.info('ConnectionManager', 'Screen transceiver receiver track ended', { peerId, trackId: track.id });
              originalOnEnded();
            }
          }
        }, 100);
        
        // Clean up interval when track ends
        const originalOnEndedWithCleanup = () => {
          if (readyStateCheckInterval) {
            clearInterval(readyStateCheckInterval);
            readyStateCheckInterval = null;
          }
          originalOnEnded();
        };
        track.onended = originalOnEndedWithCleanup;
        
        // Store interval reference for cleanup
        if (!this.trackMonitoringIntervals) {
          this.trackMonitoringIntervals = new Map();
        }
        if (!this.trackMonitoringIntervals.has(peerId)) {
          this.trackMonitoringIntervals.set(peerId, new Map());
        }
        this.trackMonitoringIntervals.get(peerId).set(track.id, readyStateCheckInterval);
      }

      // Monitor track enabled/disabled state for camera tracks (when camera is turned on/off)
      if (trackType === 'camera' && track.kind === 'video') {
        let enabledState = track.enabled;
        let enabledCheckInterval = null;

        const checkTrackEnabled = () => {
          if (track.readyState === 'ended') {
            if (enabledCheckInterval) {
              clearInterval(enabledCheckInterval);
              enabledCheckInterval = null;
            }
            return;
          }

          if (track.enabled !== enabledState) {
            enabledState = track.enabled;
            logger.info('ConnectionManager', 'Remote camera track enabled state changed', { 
              peerId, 
              enabled: track.enabled,
              readyState: track.readyState 
            });

            if (!track.enabled && track.readyState === 'live') {
              // Track is disabled but still live - show placeholder
              eventBus.emit(`webrtc:trackDisabled:${peerId}`, {
                peerId,
                trackType: 'camera',
                track: track
              });
            } else if (track.enabled && track.readyState === 'live') {
              // Track is enabled - ensure video is shown
              // Don't recreate the tile, just restore the video display
              eventBus.emit(`webrtc:trackEnabled:${peerId}`, {
                peerId,
                trackType: 'camera',
                track: track
              });
            }
          }
        };

        // Check immediately
        checkTrackEnabled();

        // Poll for changes (MediaStreamTrack doesn't have enabled change event)
        enabledCheckInterval = setInterval(checkTrackEnabled, 500);

        // Clean up interval when track ends
        const originalOnEndedHandler = track.onended;
        track.onended = () => {
          if (enabledCheckInterval) {
            clearInterval(enabledCheckInterval);
            enabledCheckInterval = null;
          }
          if (originalOnEndedHandler) {
            originalOnEndedHandler();
          }
        };
      }
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

    // Add audio track using addTrack - this automatically creates/updates transceivers
    const audioTrack = trackManager.getAudioTrack();
    if (audioTrack && audioTrack.readyState === 'live') {
      try {
        // Check if we already have an audio sender
        const existingSenders = pc.getSenders().filter(s => s.track?.kind === 'audio');
        if (existingSenders.length > 0) {
          // Replace track on existing sender
          await existingSenders[0].replaceTrack(audioTrack);
          logger.debug('ConnectionManager', 'Replaced audio track', { peerId });
        } else {
          // Use addTrack which automatically creates transceiver
          const sender = pc.addTrack(audioTrack);
          // Find the transceiver that now has this track
          const transceiversList = pc.getTransceivers();
          const audioTransceiver = transceiversList.find(t => t.sender === sender);
          if (audioTransceiver) {
            transceivers.audio = audioTransceiver;
            logger.debug('ConnectionManager', 'Added audio track', { peerId, transceiverMid: audioTransceiver.mid });
          }
        }
      } catch (error) {
        logger.error('ConnectionManager', 'Failed to add audio track', { peerId, error });
      }
    }

    // Add camera track using addTrack - this automatically creates/updates transceivers
    const cameraTrack = trackManager.getCameraTrack();
    if (cameraTrack && cameraTrack.readyState === 'live' && cameraTrack.enabled) {
      try {
        // Check if we already have a video sender (but not screen share)
        const existingSenders = pc.getSenders().filter(s => {
          if (s.track?.kind !== 'video') return false;
          // Don't replace screen share senders
          const settings = s.track.getSettings();
          return !settings?.displaySurface;
        });
        if (existingSenders.length > 0) {
          // Replace track on existing sender
          await existingSenders[0].replaceTrack(cameraTrack);
          logger.debug('ConnectionManager', 'Replaced camera track', { peerId });
        } else {
          // Use addTrack which automatically creates transceiver
          const sender = pc.addTrack(cameraTrack);
          // Find the transceiver that now has this track
          const transceiversList = pc.getTransceivers();
          const videoTransceiver = transceiversList.find(t => t.sender === sender);
          if (videoTransceiver) {
            transceivers.camera = videoTransceiver;
            logger.debug('ConnectionManager', 'Added camera track', { peerId, transceiverMid: videoTransceiver.mid });
          }
        }
      } catch (error) {
        logger.error('ConnectionManager', 'Failed to add camera track', { peerId, error });
      }
    }

    // Add screen track if available
    const screenTrack = trackManager.getScreenTrack();
    if (screenTrack && screenTrack.readyState === 'live') {
      try {
        // Check if we already have a screen share sender
        const existingSenders = pc.getSenders().filter(s => {
          if (s.track?.kind !== 'video') return false;
          const settings = s.track.getSettings();
          return settings?.displaySurface; // Screen share has displaySurface
        });
        if (existingSenders.length > 0) {
          // Replace track on existing screen sender
          await existingSenders[0].replaceTrack(screenTrack);
          logger.debug('ConnectionManager', 'Replaced screen track', { peerId });
        } else {
          // Use addTrack which automatically creates transceiver
          const sender = pc.addTrack(screenTrack);
          // Find the transceiver that now has this track
          const transceiversList = pc.getTransceivers();
          const screenTransceiver = transceiversList.find(t => t.sender === sender);
          if (screenTransceiver) {
            transceivers.screen = screenTransceiver;
            logger.debug('ConnectionManager', 'Added screen track', { peerId, transceiverMid: screenTransceiver.mid });
          }
        }
      } catch (error) {
        logger.error('ConnectionManager', 'Failed to add screen track', { peerId, error });
      }
    }
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

        // Log SDP to verify tracks are included
        const sdpLines = offer.sdp.split('\n');
        const audioMLines = sdpLines.filter(l => l.startsWith('m=audio'));
        const videoMLines = sdpLines.filter(l => l.startsWith('m=video'));
        const senders = pc.getSenders();
        const receivers = pc.getReceivers();
        logger.info('ConnectionManager', 'Offer SDP details', {
          peerId,
          audioMLines: audioMLines.length,
          videoMLines: videoMLines.length,
          senders: senders.length,
          receivers: receivers.length,
          senderTracks: senders.map(s => ({ kind: s.track?.kind, label: s.track?.label, enabled: s.track?.enabled }))
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
          pc = await this.createConnection(peerId, true); // Still skip offer since we're receiving one
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
      
      // Log transceivers after setting remote description to see what tracks we can receive
      const transceiversAfterRemote = pc.getTransceivers();
      logger.info('ConnectionManager', 'Transceivers after setting remote offer', {
        peerId,
        count: transceiversAfterRemote.length,
        transceivers: transceiversAfterRemote.map(t => ({
          mid: t.mid,
          direction: t.direction,
          kind: t.receiver.track?.kind || 'unknown',
          hasSender: !!t.sender.track,
          hasReceiver: !!t.receiver.track,
          receiverTrackLabel: t.receiver.track?.label,
          senderTrackLabel: t.sender.track?.label
        }))
      });

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
        
        // Log SDP to verify tracks are included
        const sdpLines = answer.sdp.split('\n');
        const audioMLines = sdpLines.filter(l => l.startsWith('m=audio'));
        const videoMLines = sdpLines.filter(l => l.startsWith('m=video'));
        const senders = pc.getSenders();
        const receivers = pc.getReceivers();
        logger.info('ConnectionManager', 'Answer SDP details', {
          peerId,
          audioMLines: audioMLines.length,
          videoMLines: videoMLines.length,
          senders: senders.length,
          receivers: receivers.length,
          senderTracks: senders.map(s => ({ kind: s.track?.kind, label: s.track?.label, enabled: s.track?.enabled }))
        });
        
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
    logger.info('ConnectionManager', 'Handling answer', { 
      peerId, 
      currentState: this.connections.get(peerId)?.signalingState,
      hasSdp: !!sdp,
      sdpType: sdp?.type
    });

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
        
        // Log transceivers after setting remote answer
        const transceiversAfterAnswer = pc.getTransceivers();
        logger.info('ConnectionManager', 'Transceivers after setting remote answer', {
          peerId,
          count: transceiversAfterAnswer.length,
          transceivers: transceiversAfterAnswer.map(t => ({
            mid: t.mid,
            direction: t.direction,
            kind: t.receiver.track?.kind || 'unknown',
            hasSender: !!t.sender.track,
            hasReceiver: !!t.receiver.track,
            receiverTrackLabel: t.receiver.track?.label,
            senderTrackLabel: t.sender.track?.label
          }))
        });
        
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
        // Emit track disabled event so peers can show placeholder
        eventBus.emit(`webrtc:trackDisabled:${peerId}`, {
          peerId,
          trackType: 'camera'
        });
        logger.info('ConnectionManager', 'Removed camera track', { peerId });
      } else if (type === 'screen') {
        // Stop the track first
        const screenTrack = transceivers.screen.sender.track;
        if (screenTrack) {
          // Stop the track - this will trigger onended on peer side
          screenTrack.stop();
          logger.info('ConnectionManager', 'Stopped screen track', { peerId, trackId: screenTrack.id });
        }
        
        // Replace with null to remove from connection
        await transceivers.screen.sender.replaceTrack(null);
        
        // NOTE: Do NOT emit trackEnded event here - it should be emitted on the peer side
        // when their remote track.onended fires. The peer's ConnectionManager will handle
        // the track.onended event and emit webrtc:trackEnded locally.
        
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
    
    // Clear all state
    this.connections.clear();
    this.stateMachines.clear();
    this.transceivers.clear();
    this.pendingOffers.clear();
    this.pendingAnswers.clear();
    this.iceCandidateQueues.clear();
    this.renegotiationQueue.clear();
    this.isRenegotiating = false;
    
    // Clear peer state
    stateManager.setState({ peers: new Map() });
    
    // Remove all audio elements
    document.querySelectorAll('audio[id^="audio-"]').forEach(audio => {
      audio.srcObject = null;
      audio.remove();
    });
    
    logger.info('ConnectionManager', 'All connections closed and state cleared');
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

  /**
   * Setup audio playback for remote audio track
   */
  setupAudioPlayback(peerId, audioTrack) {
    // Check if audio element already exists
    let audioElement = document.getElementById(`audio-${peerId}`);
    if (!audioElement) {
      audioElement = document.createElement('audio');
      audioElement.id = `audio-${peerId}`;
      audioElement.autoplay = true;
      audioElement.playsInline = true;
      audioElement.style.display = 'none';
      document.body.appendChild(audioElement);
    }

    // Create stream from track and set as source
    const audioStream = new MediaStream([audioTrack]);
    audioElement.srcObject = audioStream;
    
    // Play audio
    audioElement.play().catch(error => {
      logger.warn('ConnectionManager', 'Failed to play remote audio', { peerId, error });
    });

    logger.debug('ConnectionManager', 'Audio playback setup', { peerId });
  }

  /**
   * Start audio level monitoring for a peer's audio track
   */
  startAudioLevelMonitoring(peerId, audioTrack) {
    if (!audioTrack || audioTrack.kind !== 'audio') {
      return;
    }

    try {
      // Create audio context for level monitoring
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;

      const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let isMonitoring = true;

      const checkLevel = () => {
        if (!isMonitoring) return;

        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        const level = average / 255; // Normalize to 0-1
        const isSpeaking = level > 0.1; // Threshold for speaking

        // Emit audio level event
        eventBus.emit(`webrtc:audioLevel:${peerId}`, {
          peerId,
          level,
          isSpeaking
        });

        if (isMonitoring) {
          requestAnimationFrame(checkLevel);
        }
      };

      checkLevel();

      // Stop monitoring when track ends
      audioTrack.onended = () => {
        isMonitoring = false;
        audioContext.close();
      };

      logger.debug('ConnectionManager', 'Started audio level monitoring', { peerId });
    } catch (error) {
      logger.warn('ConnectionManager', 'Failed to start audio level monitoring', { peerId, error });
    }
  }
}

// Export singleton instance
export const connectionManager = new ConnectionManager();
export default connectionManager;

