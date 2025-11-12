// Device manager for device enumeration, selection, and change detection
import { logger } from '../core/Logger.js';
import { eventBus } from '../core/EventBus.js';
import { stateManager } from '../core/StateManager.js';

class DeviceManager {
  constructor() {
    this.devices = {
      cameras: [],
      microphones: [],
      speakers: []
    };
    this.selectedDevices = {
      camera: null,
      mic: null,
      speaker: null
    };
    this.deviceChangeListener = null;
  }

  /**
   * Enumerate devices
   */
  async enumerateDevices() {
    try {
      logger.info('DeviceManager', 'Enumerating devices...');

      const devices = await navigator.mediaDevices.enumerateDevices();

      // Reset device lists
      this.devices.cameras = [];
      this.devices.microphones = [];
      this.devices.speakers = [];

      // Categorize devices
      devices.forEach(device => {
        const deviceInfo = {
          deviceId: device.deviceId,
          label: device.label || 'Unknown Device',
          kind: device.kind,
          groupId: device.groupId
        };

        if (device.kind === 'videoinput') {
          this.devices.cameras.push(deviceInfo);
        } else if (device.kind === 'audioinput') {
          this.devices.microphones.push(deviceInfo);
        } else if (device.kind === 'audiooutput') {
          this.devices.speakers.push(deviceInfo);
        }
      });

      // Update state
      stateManager.setState({
        'devices.available.cameras': this.devices.cameras,
        'devices.available.microphones': this.devices.microphones,
        'devices.available.speakers': this.devices.speakers
      });

      logger.info('DeviceManager', 'Devices enumerated', {
        cameras: this.devices.cameras.length,
        microphones: this.devices.microphones.length,
        speakers: this.devices.speakers.length
      });

      eventBus.emit('devices:enumerated', {
        cameras: this.devices.cameras,
        microphones: this.devices.microphones,
        speakers: this.devices.speakers
      });

      return this.devices;
    } catch (error) {
      logger.error('DeviceManager', 'Failed to enumerate devices', { error });
      eventBus.emit('devices:error', { error });
      throw error;
    }
  }

  /**
   * Request device permissions (required before enumeration)
   */
  async requestPermissions(audio = true, video = true) {
    try {
      logger.info('DeviceManager', 'Requesting device permissions', { audio, video });

      const constraints = {
        audio: audio,
        video: video
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // Stop the stream immediately (we just needed permissions)
      stream.getTracks().forEach(track => track.stop());

      // Now enumerate devices (they'll have labels now)
      await this.enumerateDevices();

      logger.info('DeviceManager', 'Device permissions granted');
      eventBus.emit('devices:permissionsGranted', { audio, video });

      return true;
    } catch (error) {
      logger.error('DeviceManager', 'Failed to request device permissions', { error });
      eventBus.emit('devices:permissionsDenied', { error });
      throw error;
    }
  }

  /**
   * Select camera device
   */
  selectCamera(deviceId) {
    this.selectedDevices.camera = deviceId;
    stateManager.setState({ 'devices.camera': deviceId });
    logger.info('DeviceManager', 'Camera device selected', { deviceId });
    eventBus.emit('devices:camera:selected', { deviceId });
  }

  /**
   * Select microphone device
   */
  selectMicrophone(deviceId) {
    this.selectedDevices.mic = deviceId;
    stateManager.setState({ 'devices.mic': deviceId });
    logger.info('DeviceManager', 'Microphone device selected', { deviceId });
    eventBus.emit('devices:microphone:selected', { deviceId });
  }

  /**
   * Select speaker device
   */
  selectSpeaker(deviceId) {
    this.selectedDevices.speaker = deviceId;
    stateManager.setState({ 'devices.speaker': deviceId });
    logger.info('DeviceManager', 'Speaker device selected', { deviceId });
    eventBus.emit('devices:speaker:selected', { deviceId });
  }

  /**
   * Get selected camera
   */
  getSelectedCamera() {
    return this.selectedDevices.camera || this.devices.cameras[0]?.deviceId || null;
  }

  /**
   * Get selected microphone
   */
  getSelectedMicrophone() {
    return this.selectedDevices.mic || this.devices.microphones[0]?.deviceId || null;
  }

  /**
   * Get selected speaker
   */
  getSelectedSpeaker() {
    return this.selectedDevices.speaker || this.devices.speakers[0]?.deviceId || null;
  }

  /**
   * Get constraints for selected devices
   */
  getDeviceConstraints() {
    const constraints = {};

    const cameraId = this.getSelectedCamera();
    if (cameraId) {
      constraints.video = { deviceId: { exact: cameraId } };
    }

    const micId = this.getSelectedMicrophone();
    if (micId) {
      constraints.audio = { deviceId: { exact: micId } };
    }

    return constraints;
  }

  /**
   * Set up device change listener
   */
  setupDeviceChangeListener() {
    if (this.deviceChangeListener) {
      return; // Already set up
    }

    this.deviceChangeListener = () => {
      logger.info('DeviceManager', 'Device change detected');
      this.enumerateDevices();
      eventBus.emit('devices:changed');
    };

    navigator.mediaDevices.addEventListener('devicechange', this.deviceChangeListener);
    logger.debug('DeviceManager', 'Device change listener set up');
  }

  /**
   * Remove device change listener
   */
  removeDeviceChangeListener() {
    if (this.deviceChangeListener) {
      navigator.mediaDevices.removeEventListener('devicechange', this.deviceChangeListener);
      this.deviceChangeListener = null;
      logger.debug('DeviceManager', 'Device change listener removed');
    }
  }

  /**
   * Get all devices
   */
  getDevices() {
    return { ...this.devices };
  }

  /**
   * Get cameras
   */
  getCameras() {
    return [...this.devices.cameras];
  }

  /**
   * Get microphones
   */
  getMicrophones() {
    return [...this.devices.microphones];
  }

  /**
   * Get speakers
   */
  getSpeakers() {
    return [...this.devices.speakers];
  }
}

// Export singleton instance
export const deviceManager = new DeviceManager();
export default deviceManager;

