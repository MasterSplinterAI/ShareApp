// Main application entry point
import { setupSocketListeners } from './services/socket.js';
import { initializeMedia } from './services/media.js';
import { setupUIEventListeners } from './ui/events.js';
import { initRoomFromUrl } from './utils/url.js';
import { showError } from './ui/notifications.js';
import { setupDeviceSelectors } from './ui/devices.js';
import { initMobileDetection } from './utils/mobileDetect.js';
import { initializeIceServers } from './utils/iceServers.js';

// Global state object
window.appState = {
  localStream: null,
  screenStream: null,
  peerConnections: {},
  roomId: null,
  isHost: false,
  pinnedParticipant: 'local',
  participants: {},
  isCameraOn: true,
  isMicOn: true,
  isScreenSharing: false,
  deviceSettings: {
    selectedCamera: null,
    selectedMic: null,
    selectedSpeaker: null
  },
  networkSettings: {
    lowBandwidthMode: false
  }
};

// Initialize mobile detection early
initMobileDetection();

// Initialize application
async function initializeApp() {
  try {
    // Initialize ICE servers early (important for international connectivity)
    await initializeIceServers();
    
    // Setup UI event listeners first
    setupUIEventListeners();
    
    // Setup socket event listeners
    setupSocketListeners();
    
    // Initialize device selectors - this might fail without permissions
    // and that's okay, they'll be initialized when media permissions are granted
    try {
      await setupDeviceSelectors();
    } catch (error) {
      console.log('Device initialization postponed until permissions are granted');
    }
    
    // Check if we should join a room from URL
    const roomFromUrl = initRoomFromUrl();
    if (roomFromUrl) {
      // Auto-join room from URL
      document.getElementById('joinBtn').click();
    }
  } catch (error) {
    console.error('Error initializing application:', error);
    showError('Failed to initialize application. Please refresh the page and try again.');
  }
}

// Start the application when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializeApp);

// Handle beforeunload event to notify about leaving the page
window.addEventListener('beforeunload', (event) => {
  // If we're in a meeting, show a confirmation dialog
  if (window.appState.roomId) {
    event.preventDefault();
    event.returnValue = '';
    return '';
  }
}); 