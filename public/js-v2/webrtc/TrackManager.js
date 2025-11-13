// Track manager for camera and screen track lifecycle management
import { logger } from '../core/Logger.js';
import { eventBus } from '../core/EventBus.js';
import { stateManager } from '../core/StateManager.js';

class TrackManager {
  constructor() {
    this.cameraTrack = null;
    this.screenTrack = null;
    this.audioTrack = null;
    this.localStream = null;
  }

  /**
   * Enable camera
   */
  async enableCamera(constraints = null) {
    if (this.cameraTrack && this.cameraTrack.readyState === 'live') {
      // Track already exists and is live, just enable it
      if (!this.cameraTrack.enabled) {
        this.cameraTrack.enabled = true;
        this.updateLocalStream();
        stateManager.setState({ isCameraOn: true });
        // Emit both enabled and added events so UI updates
        eventBus.emit('track:camera:enabled', { track: this.cameraTrack });
        eventBus.emit('track:camera:added', { track: this.cameraTrack });
        logger.info('TrackManager', 'Camera track enabled');
      }
      return this.cameraTrack;
    }

    try {
      logger.info('TrackManager', 'Requesting camera access...');

      const defaultConstraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(
        constraints || defaultConstraints
      );

      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error('No video track in stream');
      }

      // Stop old track if exists
      if (this.cameraTrack) {
        this.cameraTrack.stop();
      }

      this.cameraTrack = videoTrack;
      this.updateLocalStream();

      // Set up track ended handler
      this.cameraTrack.onended = () => {
        logger.info('TrackManager', 'Camera track ended');
        this.cameraTrack = null;
        stateManager.setState({ isCameraOn: false, cameraTrack: null });
        eventBus.emit('track:camera:ended');
      };

      // Update local stream
      this.updateLocalStream();

      stateManager.setState({ 
        isCameraOn: true, 
        cameraTrack: this.cameraTrack 
      });

      eventBus.emit('track:camera:added', { track: this.cameraTrack });
      logger.info('TrackManager', 'Camera track added', {
        trackId: this.cameraTrack.id,
        label: this.cameraTrack.label,
        enabled: this.cameraTrack.enabled
      });

      return this.cameraTrack;
    } catch (error) {
      logger.error('TrackManager', 'Failed to enable camera', { error });
      stateManager.setState({ isCameraOn: false });
      eventBus.emit('track:camera:error', { error });
      throw error;
    }
  }

  /**
   * Disable camera
   */
  async disableCamera() {
    if (!this.cameraTrack) {
      return;
    }

    if (this.cameraTrack.enabled) {
      this.cameraTrack.enabled = false;
      stateManager.setState({ isCameraOn: false });
      eventBus.emit('track:camera:disabled', { track: this.cameraTrack });
      logger.info('TrackManager', 'Camera track disabled');
    }
  }

  /**
   * Stop camera (remove track)
   */
  async stopCamera() {
    if (!this.cameraTrack) {
      return;
    }

    const track = this.cameraTrack;
    this.cameraTrack.stop();
    this.cameraTrack = null;
    this.updateLocalStream();

    stateManager.setState({ 
      isCameraOn: false, 
      cameraTrack: null 
    });

    eventBus.emit('track:camera:stopped', { track });
    logger.info('TrackManager', 'Camera track stopped');
  }

  /**
   * Start screen sharing
   */
  async startScreenShare() {
    if (this.screenTrack && this.screenTrack.readyState === 'live') {
      logger.warn('TrackManager', 'Screen share already active');
      return this.screenTrack;
    }

    try {
      logger.info('TrackManager', 'Requesting screen share access...');

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
          cursor: 'always'
        },
        audio: false
      });

      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error('No video track in screen share stream');
      }

      // Stop old screen track if exists
      if (this.screenTrack) {
        this.screenTrack.stop();
      }

      this.screenTrack = videoTrack;

      // Set up track ended handler
      this.screenTrack.onended = () => {
        logger.info('TrackManager', 'Screen share track ended');
        this.stopScreenShare();
      };

      stateManager.setState({ 
        isScreenSharing: true, 
        screenTrack: this.screenTrack 
      });

      eventBus.emit('track:screen:added', { track: this.screenTrack });
      logger.info('TrackManager', 'Screen share track added', {
        trackId: this.screenTrack.id,
        label: this.screenTrack.label
      });

      return this.screenTrack;
    } catch (error) {
      logger.error('TrackManager', 'Failed to start screen share', { error });
      stateManager.setState({ isScreenSharing: false });
      eventBus.emit('track:screen:error', { error });
      throw error;
    }
  }

  /**
   * Stop screen sharing
   */
  async stopScreenShare() {
    if (!this.screenTrack) {
      return;
    }

    const track = this.screenTrack;
    this.screenTrack.stop();
    this.screenTrack = null;

    stateManager.setState({ 
      isScreenSharing: false, 
      screenTrack: null 
    });

    eventBus.emit('track:screen:stopped', { track });
    logger.info('TrackManager', 'Screen share track stopped');

    // Restore camera feed if it was enabled
    if (this.cameraTrack && this.cameraTrack.readyState === 'live') {
      // Re-emit camera track to restore display
      eventBus.emit('track:camera:added', { track: this.cameraTrack });
      logger.debug('TrackManager', 'Restored camera feed after screen share stopped');
    }
  }

  /**
   * Enable microphone
   */
  async enableMicrophone(constraints = null) {
    if (this.audioTrack && this.audioTrack.readyState === 'live') {
      if (!this.audioTrack.enabled) {
        this.audioTrack.enabled = true;
        stateManager.setState({ isMicOn: true });
        eventBus.emit('track:audio:enabled', { track: this.audioTrack });
        logger.info('TrackManager', 'Audio track enabled');
      }
      return this.audioTrack;
    }

    try {
      logger.info('TrackManager', 'Requesting microphone access...');

      const defaultConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(
        constraints || defaultConstraints
      );

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        throw new Error('No audio track in stream');
      }

      // Stop old track if exists
      if (this.audioTrack) {
        this.audioTrack.stop();
      }

      this.audioTrack = audioTrack;
      this.updateLocalStream();

      // Set up track ended handler
      this.audioTrack.onended = () => {
        logger.info('TrackManager', 'Audio track ended');
        this.audioTrack = null;
        stateManager.setState({ isMicOn: false });
        eventBus.emit('track:audio:ended');
      };

      stateManager.setState({ isMicOn: true });
      eventBus.emit('track:audio:added', { track: this.audioTrack });
      logger.info('TrackManager', 'Audio track added', {
        trackId: this.audioTrack.id,
        label: this.audioTrack.label,
        enabled: this.audioTrack.enabled
      });

      return this.audioTrack;
    } catch (error) {
      logger.error('TrackManager', 'Failed to enable microphone', { error });
      stateManager.setState({ isMicOn: false });
      eventBus.emit('track:audio:error', { error });
      throw error;
    }
  }

  /**
   * Disable microphone
   */
  async disableMicrophone() {
    if (!this.audioTrack) {
      return;
    }

    if (this.audioTrack.enabled) {
      this.audioTrack.enabled = false;
      stateManager.setState({ isMicOn: false });
      eventBus.emit('track:audio:disabled', { track: this.audioTrack });
      logger.info('TrackManager', 'Audio track disabled');
    }
  }

  /**
   * Stop microphone (remove track)
   */
  async stopMicrophone() {
    if (!this.audioTrack) {
      return;
    }

    const track = this.audioTrack;
    this.audioTrack.stop();
    this.audioTrack = null;
    this.updateLocalStream();

    stateManager.setState({ 
      isMicOn: false, 
      audioTrack: null 
    });

    eventBus.emit('track:audio:stopped', { track });
    logger.info('TrackManager', 'Audio track stopped');
  }

  /**
   * Update local stream with current tracks
   */
  updateLocalStream() {
    const tracks = [];

    if (this.audioTrack) {
      tracks.push(this.audioTrack);
    }

    if (this.cameraTrack) {
      tracks.push(this.cameraTrack);
    }

    // Screen track is separate, not added to local stream
    // It's sent as a separate track in peer connections

    if (tracks.length === 0) {
      this.localStream = null;
    } else {
      if (!this.localStream) {
        this.localStream = new MediaStream();
      }

      // Remove all tracks
      this.localStream.getTracks().forEach(track => {
        this.localStream.removeTrack(track);
      });

      // Add current tracks
      tracks.forEach(track => {
        this.localStream.addTrack(track);
      });
    }

    stateManager.setState({ localStream: this.localStream });
  }

  /**
   * Get camera track
   */
  getCameraTrack() {
    return this.cameraTrack;
  }

  /**
   * Get screen track
   */
  getScreenTrack() {
    return this.screenTrack;
  }

  /**
   * Get audio track
   */
  getAudioTrack() {
    return this.audioTrack;
  }

  /**
   * Get local stream
   */
  getLocalStream() {
    return this.localStream;
  }

  /**
   * Check if camera is active
   */
  hasActiveCamera() {
    return this.cameraTrack !== null && 
           this.cameraTrack.readyState === 'live' && 
           this.cameraTrack.enabled;
  }

  /**
   * Check if screen share is active
   */
  hasActiveScreen() {
    return this.screenTrack !== null && 
           this.screenTrack.readyState === 'live';
  }

  /**
   * Check if microphone is active
   */
  hasActiveMicrophone() {
    return this.audioTrack !== null && 
           this.audioTrack.readyState === 'live' && 
           this.audioTrack.enabled;
  }

  /**
   * Stop all tracks
   */
  async stopAllTracks() {
    await Promise.all([
      this.stopCamera(),
      this.stopScreenShare()
    ]);

    if (this.audioTrack) {
      this.audioTrack.stop();
      this.audioTrack = null;
    }

    this.localStream = null;
    stateManager.setState({ 
      localStream: null,
      cameraTrack: null,
      screenTrack: null,
      isCameraOn: false,
      isMicOn: false,
      isScreenSharing: false
    });

    logger.info('TrackManager', 'All tracks stopped');
  }
}

// Export singleton instance
export const trackManager = new TrackManager();
export default trackManager;

