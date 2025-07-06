// Devices UI module for handling device selection
import { getAvailableDevices, changeAudioOutputDevice } from '../services/media.js';
import { showError } from './notifications.js';

// Setup device selectors
export async function setupDeviceSelectors() {
  try {
    // Get available devices (may be empty arrays if permissions not granted)
    const devices = await getAvailableDevices();
    
    // Populate selectors with whatever data we have
    populateDeviceSelector('cameraSelect', devices.cameras, 'Camera');
    populateDeviceSelector('micSelect', devices.microphones, 'Microphone');
    populateDeviceSelector('speakerSelect', devices.speakers, 'Speaker');
    
    // Set up event listeners for the device modal
    setupDeviceModalListeners();
    
    // Return devices
    return devices;
  } catch (error) {
    console.log('Device setup will be completed when permissions are granted');
    // Set up listeners anyway so the modal works when needed
    setupDeviceModalListeners();
    return null;
  }
}

// Populate a device selector dropdown
function populateDeviceSelector(selectId, devices, deviceType) {
  const select = document.getElementById(selectId);
  
  if (!select) {
    console.error(`${selectId} not found`);
    return;
  }
  
  // Clear existing options
  select.innerHTML = '';
  
  // Add default option
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = `Default ${deviceType}`;
  select.appendChild(defaultOption);
  
  // Add device options
  devices.forEach(device => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    
    // Use device label or generic name
    option.textContent = device.label || `${deviceType} ${devices.indexOf(device) + 1}`;
    
    select.appendChild(option);
    
    // Select the currently selected device if any
    if (deviceType === 'Camera' && window.appState.deviceSettings.selectedCamera === device.deviceId) {
      option.selected = true;
    } else if (deviceType === 'Microphone' && window.appState.deviceSettings.selectedMic === device.deviceId) {
      option.selected = true;
    } else if (deviceType === 'Speaker' && window.appState.deviceSettings.selectedSpeaker === device.deviceId) {
      option.selected = true;
    }
  });
  
  // Disable if no devices available
  if (devices.length === 0) {
    select.disabled = true;
    
    // Add a no devices option
    const noDevicesOption = document.createElement('option');
    noDevicesOption.value = '';
    noDevicesOption.textContent = `No ${deviceType}s available`;
    select.appendChild(noDevicesOption);
  }
}

// Set up event listeners for the device modal
function setupDeviceModalListeners() {
  const deviceModal = document.getElementById('deviceModal');
  const saveDeviceBtn = document.getElementById('saveDeviceBtn');
  const cancelDeviceBtn = document.getElementById('cancelDeviceBtn');
  
  if (!deviceModal || !saveDeviceBtn || !cancelDeviceBtn) {
    console.error('Device modal elements not found');
    return;
  }
  
  // Save button click
  saveDeviceBtn.addEventListener('click', () => {
    // Get selected devices
    const cameraSelect = document.getElementById('cameraSelect');
    const micSelect = document.getElementById('micSelect');
    const speakerSelect = document.getElementById('speakerSelect');
    
    // Store selected devices in app state
    window.appState.deviceSettings.selectedCamera = cameraSelect.value;
    window.appState.deviceSettings.selectedMic = micSelect.value;
    window.appState.deviceSettings.selectedSpeaker = speakerSelect.value;
    
    // Apply speaker selection
    if (speakerSelect.value) {
      changeAudioOutputDevice(speakerSelect.value);
    }
    
    // Close modal
    deviceModal.classList.add('hidden');
    
    // Prompt user to restart their media
    if (window.appState.localStream) {
      const shouldRestart = confirm('Device settings saved. Would you like to restart your camera and microphone to apply changes?');
      
      if (shouldRestart) {
        // Dispatch event to restart media
        document.dispatchEvent(new CustomEvent('restart-media'));
      }
    }
  });
  
  // Cancel button click
  cancelDeviceBtn.addEventListener('click', () => {
    deviceModal.classList.add('hidden');
  });
}

// Show device selection modal
export function showDeviceSelectionModal() {
  const deviceModal = document.getElementById('deviceModal');
  
  if (!deviceModal) {
    showError('Device selection not available');
    return;
  }
  
  // Show modal
  deviceModal.classList.remove('hidden');
}

// Setup network settings modal
export function setupNetworkSettingsModal() {
  const networkModal = document.getElementById('networkModal');
  const closeNetworkBtn = document.getElementById('closeNetworkBtn');
  const lowBandwidthMode = document.getElementById('lowBandwidthMode');
  
  if (!networkModal || !closeNetworkBtn || !lowBandwidthMode) {
    console.error('Network modal elements not found');
    return;
  }
  
  // Set initial state from app state
  lowBandwidthMode.checked = window.appState.networkSettings.lowBandwidthMode;
  
  // Close button click
  closeNetworkBtn.addEventListener('click', () => {
    // Save settings
    window.appState.networkSettings.lowBandwidthMode = lowBandwidthMode.checked;
    
    // Close modal
    networkModal.classList.add('hidden');
    
    // If settings changed, prompt user to restart media
    if (lowBandwidthMode.checked !== window.appState.networkSettings.lowBandwidthMode && window.appState.localStream) {
      const shouldRestart = confirm('Network settings saved. Would you like to restart your media to apply changes?');
      
      if (shouldRestart) {
        // Dispatch event to restart media
        document.dispatchEvent(new CustomEvent('restart-media'));
      }
    }
  });
}

// Show network settings modal
export function showNetworkSettingsModal() {
  const networkModal = document.getElementById('networkModal');
  
  if (!networkModal) {
    showError('Network settings not available');
    return;
  }
  
  // Show modal
  networkModal.classList.remove('hidden');
} 