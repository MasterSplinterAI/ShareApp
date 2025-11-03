// Modern UI Modals Handler
// Manages device selection and network settings modals

export function setupModals() {
  // Device modal
  const deviceModal = document.getElementById('deviceModal');
  const cancelDeviceBtn = document.getElementById('cancelDeviceBtn');
  const saveDeviceBtn = document.getElementById('saveDeviceBtn');
  
  cancelDeviceBtn.addEventListener('click', () => {
    deviceModal.classList.remove('active');
  });
  
  saveDeviceBtn.addEventListener('click', () => {
    // Get selected devices
    const cameraId = document.getElementById('cameraSelect').value;
    const micId = document.getElementById('micSelect').value;
    const speakerId = document.getElementById('speakerSelect').value;
    
    // Update app state
    window.appState.deviceSettings.selectedCamera = cameraId;
    window.appState.deviceSettings.selectedMic = micId;
    window.appState.deviceSettings.selectedSpeaker = speakerId;
    
    // Close modal
    deviceModal.classList.remove('active');
    
    // Restart media with new devices
    document.dispatchEvent(new CustomEvent('restart-media'));
  });
  
  // Network modal
  const networkModal = document.getElementById('networkModal');
  const cancelNetworkBtn = document.getElementById('cancelNetworkBtn');
  
  cancelNetworkBtn.addEventListener('click', () => {
    networkModal.classList.remove('active');
  });
  
  // Low bandwidth mode toggle
  const lowBandwidthCheckbox = document.getElementById('lowBandwidthMode');
  lowBandwidthCheckbox.addEventListener('change', (e) => {
    window.appState.networkSettings.lowBandwidthMode = e.target.checked;
  });
  
  // Close modals when clicking backdrop
  [deviceModal, networkModal].forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  });
}

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupModals);
} else {
  setupModals();
}

