// Modern UI Controls Handler
import { toggleCamera, toggleMicrophone, startScreenSharing, stopScreenSharing } from '../../services/media.js';
import { leaveMeeting } from '../../services/socket.js';

export function setupControls() {
  // Microphone toggle
  const toggleMicBtn = document.getElementById('toggleMicBtn');
  toggleMicBtn.addEventListener('click', async () => {
    const wasOn = window.appState.isMicOn;
    toggleMicrophone();
    
    // Update UI
    if (window.appState.isMicOn) {
      toggleMicBtn.classList.add('active');
      toggleMicBtn.querySelector('i').className = 'fas fa-microphone';
    } else {
      toggleMicBtn.classList.remove('active');
      toggleMicBtn.querySelector('i').className = 'fas fa-microphone-slash';
    }
  });
  
  // Camera toggle
  const toggleCameraBtn = document.getElementById('toggleCameraBtn');
  toggleCameraBtn.addEventListener('click', async () => {
    await toggleCamera();
    
    // Update UI
    if (window.appState.isCameraOn) {
      toggleCameraBtn.classList.remove('danger');
      toggleCameraBtn.querySelector('i').className = 'fas fa-video';
    } else {
      toggleCameraBtn.classList.add('danger');
      toggleCameraBtn.querySelector('i').className = 'fas fa-video-slash';
    }
  });
  
  // Screen share
  const shareScreenBtn = document.getElementById('shareScreenBtn');
  const stopShareBtn = document.getElementById('stopShareBtn');
  
  shareScreenBtn.addEventListener('click', async () => {
    await startScreenSharing();
    shareScreenBtn.style.display = 'none';
    stopShareBtn.style.display = 'flex';
  });
  
  stopShareBtn.addEventListener('click', async () => {
    await stopScreenSharing();
    shareScreenBtn.style.display = 'flex';
    stopShareBtn.style.display = 'none';
  });
  
  // Leave meeting
  const leaveBtn = document.getElementById('leaveBtn');
  leaveBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to leave the meeting?')) {
      leaveMeeting();
      document.getElementById('meetingScreen').style.display = 'none';
      document.getElementById('homeScreen').style.display = 'flex';
    }
  });
  
  // Panel toggles
  document.getElementById('participantsBtn').addEventListener('click', () => {
    const panel = document.getElementById('participantsPanel');
    panel.classList.toggle('active');
  });
  
  document.getElementById('chatBtn').addEventListener('click', () => {
    const panel = document.getElementById('chatPanel');
    panel.classList.toggle('active');
  });
  
  document.getElementById('closeParticipantsBtn').addEventListener('click', () => {
    document.getElementById('participantsPanel').classList.remove('active');
  });
  
  document.getElementById('closeChatBtn').addEventListener('click', () => {
    document.getElementById('chatPanel').classList.remove('active');
  });
  
  // Settings button
  document.getElementById('settingsBtn').addEventListener('click', () => {
    // Show device modal
    document.getElementById('deviceModal').classList.add('active');
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupControls);
} else {
  setupControls();
}

