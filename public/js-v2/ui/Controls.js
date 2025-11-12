// Controls component for media control buttons and mobile touch handling
import { logger } from '../core/Logger.js';
import { eventBus } from '../core/EventBus.js';
import { stateManager } from '../core/StateManager.js';
import { commandDispatcher } from '../core/CommandDispatcher.js';
import { config } from '../core/Config.js';

class Controls {
  constructor() {
    this.buttons = new Map();
    this.setupButtons();
    this.setupEventListeners();
  }

  /**
   * Setup control buttons
   */
  setupButtons() {
    // Camera toggle
    const cameraBtn = document.getElementById('toggleCameraBtn');
    if (cameraBtn) {
      this.setupButton(cameraBtn, 'toggleCamera', () => {
        commandDispatcher.execute('toggleCamera');
      });
    }

    // Microphone toggle
    const micBtn = document.getElementById('toggleMicBtn');
    if (micBtn) {
      this.setupButton(micBtn, 'toggleMic', () => {
        commandDispatcher.execute('toggleMicrophone');
      });
    }

    // Screen share
    const screenShareBtn = document.getElementById('shareScreenBtn');
    if (screenShareBtn) {
      this.setupButton(screenShareBtn, 'screenShare', () => {
        commandDispatcher.execute('startScreenShare');
      });
    }

    // Stop screen share
    const stopShareBtn = document.getElementById('stopShareBtn');
    if (stopShareBtn) {
      this.setupButton(stopShareBtn, 'stopScreenShare', () => {
        commandDispatcher.execute('stopScreenShare');
      });
    }

    // Leave button
    const leaveBtn = document.getElementById('leaveBtn');
    if (leaveBtn) {
      this.setupButton(leaveBtn, 'leave', () => {
        commandDispatcher.execute('leaveRoom');
      });
    }
  }

  /**
   * Setup button with touch handling
   */
  setupButton(button, id, handler) {
    this.buttons.set(id, button);

    // Click handler
    button.addEventListener('click', handler);

    // Mobile touch handling
    if (config.environment.isMobile) {
      button.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        button.style.transform = 'scale(0.95)';
      }, { passive: false });

      button.addEventListener('touchend', (e) => {
        e.stopPropagation();
        e.preventDefault();
        button.style.transform = '';
        handler();
      }, { passive: false });

      button.style.cssText += `
        touch-action: manipulation;
        -webkit-tap-highlight-color: rgba(0,0,0,0.1);
        cursor: pointer;
      `;
    }
  }

  /**
   * Setup event listeners for state updates
   */
  setupEventListeners() {
    // Camera state
    stateManager.subscribe('isCameraOn', (isOn) => {
      this.updateCameraButton(isOn);
    });

    // Microphone state
    stateManager.subscribe('isMicOn', (isOn) => {
      this.updateMicrophoneButton(isOn);
    });

    // Screen share state
    stateManager.subscribe('isScreenSharing', (isSharing) => {
      this.updateScreenShareButtons(isSharing);
    });
  }

  /**
   * Update camera button state
   */
  updateCameraButton(isOn) {
    const button = this.buttons.get('toggleCamera');
    if (!button) return;

    if (isOn) {
      button.classList.remove('btn-danger');
      button.classList.add('btn-primary');
      button.innerHTML = '<i class="fas fa-video"></i>';
      button.title = 'Turn off camera';
    } else {
      button.classList.remove('btn-primary');
      button.classList.add('btn-danger');
      button.innerHTML = '<i class="fas fa-video-slash"></i>';
      button.title = 'Turn on camera';
    }
  }

  /**
   * Update microphone button state
   */
  updateMicrophoneButton(isOn) {
    const button = this.buttons.get('toggleMic');
    if (!button) return;

    if (isOn) {
      button.classList.remove('btn-danger');
      button.classList.add('btn-primary');
      button.innerHTML = '<i class="fas fa-microphone"></i>';
      button.title = 'Mute microphone';
    } else {
      button.classList.remove('btn-primary');
      button.classList.add('btn-danger');
      button.innerHTML = '<i class="fas fa-microphone-slash"></i>';
      button.title = 'Unmute microphone';
    }
  }

  /**
   * Update screen share buttons
   */
  updateScreenShareButtons(isSharing) {
    const shareBtn = this.buttons.get('screenShare');
    const stopBtn = this.buttons.get('stopScreenShare');

    if (shareBtn) {
      if (isSharing) {
        shareBtn.classList.add('hidden');
      } else {
        shareBtn.classList.remove('hidden');
      }
    }

    if (stopBtn) {
      if (isSharing) {
        stopBtn.classList.remove('hidden');
      } else {
        stopBtn.classList.add('hidden');
      }
    }
  }
}

// Export singleton instance
export const controls = new Controls();
export default controls;

