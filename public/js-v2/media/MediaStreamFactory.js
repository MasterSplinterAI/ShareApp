// Media stream factory for creating and managing streams
import { logger } from '../core/Logger.js';
import { eventBus } from '../core/EventBus.js';
import { mediaConstraints } from './MediaConstraints.js';

class MediaStreamFactory {
  constructor() {
    this.activeStreams = new Map(); // streamId -> MediaStream
  }

  /**
   * Create a media stream with constraints
   */
  async createStream(constraints, streamId = null) {
    try {
      logger.info('MediaStreamFactory', 'Creating media stream', { constraints });

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      const id = streamId || `stream-${Date.now()}-${Math.random()}`;
      this.activeStreams.set(id, stream);

      logger.info('MediaStreamFactory', 'Media stream created', {
        streamId: id,
        audioTracks: stream.getAudioTracks().length,
        videoTracks: stream.getVideoTracks().length
      });

      eventBus.emit('media:stream:created', { streamId: id, stream });

      return { streamId: id, stream };
    } catch (error) {
      logger.error('MediaStreamFactory', 'Failed to create media stream', { error, constraints });
      eventBus.emit('media:stream:error', { error, constraints });
      throw error;
    }
  }

  /**
   * Create camera stream
   */
  async createCameraStream(overrides = {}) {
    const constraints = mediaConstraints.getCameraConstraints(overrides);
    return this.createStream(constraints);
  }

  /**
   * Create microphone stream
   */
  async createMicrophoneStream(overrides = {}) {
    const constraints = mediaConstraints.getMicrophoneConstraints(overrides);
    return this.createStream(constraints);
  }

  /**
   * Create screen share stream
   */
  async createScreenShareStream(includeAudio = false) {
    try {
      logger.info('MediaStreamFactory', 'Creating screen share stream', { includeAudio });

      const constraints = mediaConstraints.getScreenShareConstraints(includeAudio);
      const stream = await navigator.mediaDevices.getDisplayMedia(constraints);

      const streamId = `screen-${Date.now()}-${Math.random()}`;
      this.activeStreams.set(streamId, stream);

      // Handle track ended (user stops sharing)
      stream.getVideoTracks().forEach(track => {
        track.onended = () => {
          logger.info('MediaStreamFactory', 'Screen share track ended');
          this.stopStream(streamId);
          eventBus.emit('media:screenShare:ended', { streamId });
        };
      });

      logger.info('MediaStreamFactory', 'Screen share stream created', { streamId });
      eventBus.emit('media:screenShare:created', { streamId, stream });

      return { streamId, stream };
    } catch (error) {
      logger.error('MediaStreamFactory', 'Failed to create screen share stream', { error });
      eventBus.emit('media:screenShare:error', { error });
      throw error;
    }
  }

  /**
   * Clone a stream
   */
  cloneStream(stream) {
    const clonedTracks = stream.getTracks().map(track => track.clone());
    return new MediaStream(clonedTracks);
  }

  /**
   * Stop a stream
   */
  stopStream(streamId) {
    const stream = this.activeStreams.get(streamId);
    if (!stream) {
      logger.warn('MediaStreamFactory', 'Stream not found', { streamId });
      return;
    }

    // Stop all tracks
    stream.getTracks().forEach(track => {
      track.stop();
    });

    this.activeStreams.delete(streamId);

    logger.info('MediaStreamFactory', 'Stream stopped', { streamId });
    eventBus.emit('media:stream:stopped', { streamId });
  }

  /**
   * Stop all streams
   */
  stopAllStreams() {
    const streamIds = Array.from(this.activeStreams.keys());
    streamIds.forEach(streamId => this.stopStream(streamId));
    logger.info('MediaStreamFactory', 'All streams stopped');
  }

  /**
   * Get stream by ID
   */
  getStream(streamId) {
    return this.activeStreams.get(streamId);
  }

  /**
   * Get all active streams
   */
  getAllStreams() {
    return Array.from(this.activeStreams.entries()).map(([id, stream]) => ({
      streamId: id,
      stream
    }));
  }

  /**
   * Check if stream exists
   */
  hasStream(streamId) {
    return this.activeStreams.has(streamId);
  }
}

// Export singleton instance
export const mediaStreamFactory = new MediaStreamFactory();
export default mediaStreamFactory;

