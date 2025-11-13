// Application configuration and environment detection
import { logger } from './Logger.js';

class Config {
  constructor() {
    this.config = {
      // WebRTC configuration
      webrtc: {
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        sdpSemantics: 'unified-plan',
        rtcAudioJitterBufferMaxPackets: 50,
        rtcAudioJitterBufferFastAccelerate: true
      },

      // Media constraints defaults
      media: {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        }
      },

      // Connection settings
      connection: {
        maxRetries: 3,
        retryDelayBase: 2000,
        connectionTimeout: 30000,
        healthCheckInterval: 30000
      },

      // UI settings
      ui: {
        defaultLayoutMode: 'grid',
        gridColumns: 2,
        maxGridRows: 5,
        aspectRatio: {
          desktop: '16/9',
          mobile: '3/4'
        }
      },

      // Feature flags
      features: {
        enableScreenShare: true,
        enableChat: true,
        enableParticipants: true,
        enableFullscreen: true,
        enablePiP: true
      }
    };

    this.environment = this.detectEnvironment();
    this.applyEnvironmentOverrides();
  }

  detectEnvironment() {
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    const isMobile = this.isMobile();
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
    const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);

    return {
      isLocalhost,
      isMobile,
      isIOS,
      isAndroid,
      isSafari,
      isFirefox,
      isChrome,
      isProduction: !isLocalhost && hostname !== '127.0.0.1',
      isLandscape: false
    };
    
    // Update orientation
    this.updateOrientation();
  }

  isMobile() {
    return window.innerWidth <= 768 || 
           /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  updateOrientation() {
    if (this.environment.isMobile) {
      this.environment.isLandscape = window.innerWidth > window.innerHeight;
    }
  }

  applyEnvironmentOverrides() {
    // Mobile-specific overrides
    if (this.environment.isMobile) {
      this.config.ui.aspectRatio.mobile = '3/4';
      this.config.ui.gridColumns = 2;
    }

    // iOS-specific overrides
    if (this.environment.isIOS) {
      // iOS Safari has specific WebRTC quirks
      this.config.webrtc.iceCandidatePoolSize = 0; // iOS doesn't support pre-gathering
    }

    // Safari-specific overrides
    if (this.environment.isSafari) {
      // Safari may need different settings
      this.config.webrtc.bundlePolicy = 'max-bundle';
    }

    logger.debug('Config', 'Environment detected', this.environment);
  }

  get(path) {
    const keys = path.split('.');
    let value = this.config;
    
    for (const key of keys) {
      if (value === undefined || value === null) {
        return undefined;
      }
      value = value[key];
    }
    
    return value;
  }

  set(path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    let target = this.config;
    
    for (const key of keys) {
      if (!target[key] || typeof target[key] !== 'object') {
        target[key] = {};
      }
      target = target[key];
    }
    
    target[lastKey] = value;
    logger.debug('Config', `Set config.${path}`, value);
  }

  getWebRTCConfig() {
    return { ...this.config.webrtc };
  }

  getMediaConstraints(audio = true, video = false) {
    const constraints = {};
    
    if (audio) {
      constraints.audio = { ...this.config.media.audio };
    }
    
    if (video) {
      constraints.video = { ...this.config.media.video };
    }
    
    return constraints;
  }

  getConnectionConfig() {
    return { ...this.config.connection };
  }

  getUIConfig() {
    return { ...this.config.ui };
  }

  isFeatureEnabled(feature) {
    return this.config.features[feature] === true;
  }

  enableFeature(feature) {
    this.config.features[feature] = true;
    logger.debug('Config', `Enabled feature: ${feature}`);
  }

  disableFeature(feature) {
    this.config.features[feature] = false;
    logger.debug('Config', `Disabled feature: ${feature}`);
  }
}

// Export singleton instance
export const config = new Config();
export default config;

