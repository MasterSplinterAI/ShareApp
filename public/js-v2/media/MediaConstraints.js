// Media constraints management and defaults
import { config } from '../core/Config.js';
import { logger } from '../core/Logger.js';

class MediaConstraints {
  /**
   * Get default audio constraints
   */
  getAudioConstraints(overrides = {}) {
    const defaults = config.getMediaConstraints(true, false).audio;
    return {
      ...defaults,
      ...overrides
    };
  }

  /**
   * Get default video constraints
   */
  getVideoConstraints(overrides = {}) {
    const defaults = config.getMediaConstraints(false, true).video;
    return {
      ...defaults,
      ...overrides
    };
  }

  /**
   * Get constraints for camera
   */
  getCameraConstraints(overrides = {}) {
    return {
      audio: false,
      video: {
        ...this.getVideoConstraints(),
        ...overrides.video
      }
    };
  }

  /**
   * Get constraints for microphone
   */
  getMicrophoneConstraints(overrides = {}) {
    return {
      audio: {
        ...this.getAudioConstraints(),
        ...overrides.audio
      },
      video: false
    };
  }

  /**
   * Get constraints for screen share
   */
  getScreenShareConstraints(includeAudio = false) {
    return {
      video: {
        displaySurface: 'monitor',
        cursor: 'always'
      },
      audio: includeAudio
    };
  }

  /**
   * Get constraints for audio-only mode
   */
  getAudioOnlyConstraints(overrides = {}) {
    return {
      audio: {
        ...this.getAudioConstraints(),
        ...overrides.audio
      },
      video: false
    };
  }

  /**
   * Get constraints for view-only mode (no local media)
   */
  getViewOnlyConstraints() {
    // Return empty constraints - no media requested
    return {
      audio: false,
      video: false
    };
  }

  /**
   * Apply quality constraints based on network conditions
   */
  applyQualityConstraints(constraints, quality = 'high') {
    const qualitySettings = {
      low: {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 15 }
        }
      },
      medium: {
        video: {
          width: { ideal: 960 },
          height: { ideal: 540 },
          frameRate: { ideal: 24 }
        }
      },
      high: {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        }
      }
    };

    const settings = qualitySettings[quality] || qualitySettings.high;

    if (constraints.video) {
      constraints.video = {
        ...constraints.video,
        ...settings.video
      };
    }

    return constraints;
  }
}

// Export singleton instance
export const mediaConstraints = new MediaConstraints();
export default mediaConstraints;

