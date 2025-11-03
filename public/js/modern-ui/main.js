// Modern UI Main Entry Point
// This is a completely new frontend that uses the existing backend services

import { setupSocketListeners } from '../services/socket.js';
import { initializeMedia } from '../services/media.js';
import { initRoomFromUrl, generateRoomId, setRoomInUrl, getShareableLink } from '../utils/url.js';
import { showError } from '../ui/notifications.js';
import { setupDeviceSelectors } from '../ui/devices.js';
import { initMobileDetection } from '../utils/mobileDetect.js';
import { initializeIceServers } from '../utils/iceServers.js';
import { joinRoom } from '../services/socket.js';
import './ui/controls.js';
import './ui/video.js';
import './ui/panels.js';
import './ui/modals.js';

// Global state object (same as before)
window.appState = {
  localStream: null,
  screenStream: null,
  peerConnections: {},
  roomId: null,
  isHost: false,
  pinnedParticipant: 'local',
  participants: {},
  isCameraOn: false,
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
    // Initialize ICE servers early
    await initializeIceServers();
    
    // Setup socket event listeners
    setupSocketListeners();
    
    // Initialize device selectors
    try {
      await setupDeviceSelectors();
    } catch (error) {
      console.log('Device initialization postponed until permissions are granted');
    }
    
    // Setup UI
    setupUI();
    
    // Check if we should join a room from URL
    const roomFromUrl = initRoomFromUrl();
    if (roomFromUrl) {
      document.getElementById('joinBtn').click();
    }
  } catch (error) {
    console.error('Error initializing application:', error);
    showError('Failed to initialize application. Please refresh the page and try again.');
  }
}

function setupUI() {
  // Home screen buttons
  document.getElementById('hostBtn').addEventListener('click', async () => {
    try {
      const userName = prompt('Enter your name:');
      if (!userName) return;
      
      showMeetingScreen();
      document.getElementById('connectionStatus').classList.add('active');
      document.getElementById('connectionStatus').textContent = 'Initializing media...';
      
      // Get media permissions
      await initializeMedia();
      
      // Generate room ID and join as host
      const roomId = generateRoomId();
      joinRoom(roomId, { isHost: true, userName: userName });
      setRoomInUrl(roomId);
      
      // Show shareable link
      const link = getShareableLink(roomId);
      console.log('Room created:', roomId);
      console.log('Share this link:', link);
      
      document.getElementById('connectionStatus').classList.remove('active');
    } catch (error) {
      console.error('Error hosting meeting:', error);
      showError('Failed to host meeting. Please try again.');
      document.getElementById('connectionStatus').classList.remove('active');
    }
  });
  
  document.getElementById('joinBtn').addEventListener('click', async () => {
    try {
      const roomId = prompt('Enter room code:');
      if (!roomId) return;
      
      const userName = prompt('Enter your name:');
      if (!userName) return;
      
      showMeetingScreen();
      document.getElementById('connectionStatus').classList.add('active');
      document.getElementById('connectionStatus').textContent = 'Joining meeting...';
      
      // Get media permissions
      await initializeMedia();
      
      // Join room
      joinRoom(roomId, { isHost: false, userName: userName });
      setRoomInUrl(roomId);
      
      document.getElementById('connectionStatus').classList.remove('active');
    } catch (error) {
      console.error('Error joining meeting:', error);
      showError('Failed to join meeting. Please check the room code and try again.');
      document.getElementById('connectionStatus').classList.remove('active');
    }
  });
  
  // View toggle
  const viewToggle = document.getElementById('viewToggle');
  viewToggle.addEventListener('click', () => {
    const container = document.getElementById('videoContainer');
    const isGridView = container.classList.contains('grid-view');
    
    if (isGridView) {
      container.classList.remove('grid-view');
      container.classList.add('speaker-view');
      viewToggle.innerHTML = '<i class="fas fa-th"></i> <span>Grid</span>';
    } else {
      container.classList.remove('speaker-view');
      container.classList.add('grid-view');
      viewToggle.innerHTML = '<i class="fas fa-user"></i> <span>Speaker</span>';
    }
  });
  
  // UI toggle (switch back to classic)
  const uiToggle = document.getElementById('uiToggle');
  if (uiToggle) {
    uiToggle.addEventListener('click', () => {
      localStorage.setItem('uiMode', 'classic');
      window.location.href = 'index.html' + window.location.search;
    });
  }
}

function showMeetingScreen() {
  document.getElementById('homeScreen').style.display = 'none';
  document.getElementById('meetingScreen').style.display = 'flex';
}

// Start the application when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializeApp);

// Handle beforeunload event
window.addEventListener('beforeunload', (event) => {
  if (window.appState.roomId) {
    event.preventDefault();
    event.returnValue = '';
    return '';
  }
});

