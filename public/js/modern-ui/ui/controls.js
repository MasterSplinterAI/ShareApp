// Modern UI Controls Handler
import { toggleCamera, toggleMicrophone, startScreenSharing, stopScreenSharing } from '../../services/media.js';
import { leaveRoom, sendChatMessage } from '../../services/socket.js';

export function setupControls() {
  // Microphone toggle
  const toggleMicBtn = document.getElementById('toggleMicBtn');
  toggleMicBtn.addEventListener('click', async () => {
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
  
  if (shareScreenBtn && stopShareBtn) {
    shareScreenBtn.addEventListener('click', async () => {
      try {
        await startScreenSharing();
        shareScreenBtn.style.display = 'none';
        stopShareBtn.style.display = 'flex';
      } catch (error) {
        console.error('Error starting screen share:', error);
      }
    });
    
    stopShareBtn.addEventListener('click', async () => {
      try {
        await stopScreenSharing();
        shareScreenBtn.style.display = 'flex';
        stopShareBtn.style.display = 'none';
      } catch (error) {
        console.error('Error stopping screen share:', error);
      }
    });
  }
  
  // Leave meeting
  const leaveBtn = document.getElementById('leaveBtn');
  if (leaveBtn) {
    leaveBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to leave the meeting?')) {
        leaveRoom();
        document.getElementById('meetingScreen').style.display = 'none';
        document.getElementById('homeScreen').style.display = 'flex';
        window.appState.roomId = null;
      }
    });
  }
  
  // Panel toggles
  const participantsBtn = document.getElementById('participantsBtn');
  if (participantsBtn) {
    participantsBtn.addEventListener('click', () => {
      const panel = document.getElementById('participantsPanel');
      if (panel) panel.classList.toggle('active');
    });
  }
  
  const chatBtn = document.getElementById('chatBtn');
  if (chatBtn) {
    chatBtn.addEventListener('click', () => {
      const panel = document.getElementById('chatPanel');
      if (panel) panel.classList.toggle('active');
    });
  }
  
  const closeParticipantsBtn = document.getElementById('closeParticipantsBtn');
  if (closeParticipantsBtn) {
    closeParticipantsBtn.addEventListener('click', () => {
      const panel = document.getElementById('participantsPanel');
      if (panel) panel.classList.remove('active');
    });
  }
  
  const closeChatBtn = document.getElementById('closeChatBtn');
  if (closeChatBtn) {
    closeChatBtn.addEventListener('click', () => {
      const panel = document.getElementById('chatPanel');
      if (panel) panel.classList.remove('active');
    });
  }
  
  // Settings button
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      const modal = document.getElementById('deviceModal');
      if (modal) modal.classList.add('active');
    });
  }
  
  // Chat form
  const chatForm = document.getElementById('chatForm');
  if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('chatInput');
      if (input) {
        const message = input.value.trim();
        if (message) {
          sendChatMessage(message);
          input.value = '';
        }
      }
    });
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupControls);
} else {
  setupControls();
}
