if (navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices) {
    navigator.mediaDevices.getDisplayMedia({ video: true })
        .then(stream => {
            // Handle successful stream
            // ... existing code ...
        })
        .catch(error => {
            console.error('Error sharing screen:', error);
            alert('Failed to share screen. Please ensure you have granted the necessary permissions.');
        });
} else {
    console.error('Screen sharing is not supported in this browser.');
    alert('Screen sharing is not supported in your browser. Please use a supported browser like Chrome or Edge.');
}

// Initialize the application
async function initializeApp() {
  try {
    // Initialize app state
    window.appState = {
      participants: {},
      peerConnections: {},
      isCameraOn: true,
      isMicOn: true,
      isScreenSharing: false,
      pinnedParticipant: 'local',
      isHost: false,
      deviceSettings: {
        selectedCamera: null,
        selectedMicrophone: null,
        selectedSpeaker: null
      }
    };
    
    // ... existing initialization code ...
    
    // Initialize UI event handlers
    setupEventHandlers();
    
    // Set up mobile-specific button handlers
    import('./ui/events.js').then(({ setupMobileButtonHandlers }) => {
      if (typeof setupMobileButtonHandlers === 'function') {
        setupMobileButtonHandlers();
      }
    }).catch(err => {
      console.warn('Could not initialize mobile button handlers:', err);
    });
    
    // ... rest of initialization code ...
  } catch (error) {
    console.error('Error initializing app:', error);
    showError('Could not initialize application.');
  }
} 