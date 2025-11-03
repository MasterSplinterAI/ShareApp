// UI events module for handling user interactions
import { initializeMedia, toggleCamera, toggleMicrophone, startScreenSharing, stopScreenSharing } from '../services/media.js';
import { joinRoom, leaveRoom } from '../services/socket.js';
import { generateRoomId, setRoomInUrl, removeRoomFromUrl, getShareableLink } from '../utils/url.js';
import { showError, showNotification } from './notifications.js';
import { updateVideoUI, updateMainVideo, setupFullscreenButton, setupLocalVideoPinButton } from './video.js';
import { setupParticipantsPanel } from './participants.js';
import { setupChatPanel } from './chat.js';
import { showDeviceSelectionModal, setupNetworkSettingsModal } from './devices.js';

// Setup all UI event listeners
export function setupUIEventListeners() {
  // Home screen buttons
  setupHostButton();
  setupJoinButton();
  
  // Control buttons
  setupToggleCameraButton();
  setupToggleMicButton();
  setupScreenShareButtons();
  setupLeaveButton();
  setupCopyLinkButton();
  
  // Setup panels
  setupParticipantsPanel();
  setupChatPanel();
  setupNetworkSettingsModal();
  
  // Fullscreen button
  setupFullscreenButton();
  
  // Pin event listener
  setupPinListener();
  
  // Setup local video pin button
  import('./video.js').then(({ setupLocalVideoPinButton }) => {
    if (typeof setupLocalVideoPinButton === 'function') {
      setupLocalVideoPinButton();
      
      // Enhance pin buttons right after setup
      setTimeout(refreshPinButtonHandlers, 500);
    }
  }).catch(err => {
    console.warn('Could not setup local video pin button:', err);
  });
  
  // Settings button
  setupSettingsButton();
  
  // Media restart listener
  setupMediaRestartListener();
  
  // Add enhanced touch handlers for problematic buttons
  enhanceTouchHandlers();
}

// Setup host button
function setupHostButton() {
  const hostBtn = document.getElementById('hostBtn');
  
  if (!hostBtn) {
    console.error('Host button not found');
    return;
  }
  
  // Add mobile touch handlers for host button
  const isMobile = window.innerWidth <= 768 || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    hostBtn.addEventListener('touchstart', function(e) {
      e.stopPropagation();
      this.style.transform = 'scale(0.98)';
    }, { passive: false });
    
    hostBtn.addEventListener('touchend', function(e) {
      e.stopPropagation();
      e.preventDefault();
      this.style.transform = '';
      // Manually trigger click
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      });
      this.dispatchEvent(clickEvent);
    }, { passive: false });
    
    hostBtn.style.cssText += 'position: relative; z-index: 100; pointer-events: auto; touch-action: manipulation; -webkit-tap-highlight-color: rgba(0,0,0,0.1); cursor: pointer;';
  }
  
  hostBtn.addEventListener('click', async () => {
    try {
      // Prompt for username first
      const userName = await promptForUserName('host');
      if (!userName) {
        console.log('User cancelled name prompt, aborting host action');
        return;
      }
      
      // Prompt for access code and host code
      const accessCodeInfo = await promptForAccessCodes();
      if (accessCodeInfo === null) {
        console.log('User cancelled access code prompt, aborting host action');
        return;
      }
      
      document.getElementById('connectionStatus').classList.remove('hidden');
      document.getElementById('connectionStatusText').innerHTML = '<i class="fas fa-circle-notch fa-spin mr-2"></i> Initializing media...';
      
      // Get media permissions first
      const stream = await initializeMedia();
      
      // Check what we got
      const hasVideo = stream.getVideoTracks().length > 0;
      const hasAudio = stream.getAudioTracks().length > 0;
      
      if (!hasVideo && !hasAudio) {
        // This should never happen due to our fallback logic, but just in case
        showError('No camera or microphone could be accessed. At least one is required for a meeting.');
        return;
      }
      
      // Generate a random room ID
      const roomId = generateRoomId();
      
      // Join as host with the provided name and access codes
      joinRoom(roomId, { 
        isHost: true, 
        userName: userName,
        roomAccessCode: accessCodeInfo.accessCode || null,
        roomHostCode: accessCodeInfo.hostCode || null
      });
      
      // Update URL with room ID
      setRoomInUrl(roomId);
      
      // Update shareable link
      const shareLinkEl = document.getElementById('shareLink');
      if (shareLinkEl) {
        const shareLink = getShareableLink(roomId);
        shareLinkEl.textContent = shareLink;
        // Store link in window for easy access
        window.appState.shareLink = shareLink;
      }
      
      const roomCodeEl = document.getElementById('roomCode');
      if (roomCodeEl) {
        roomCodeEl.textContent = roomId;
      }
      
      // Display access codes if set
      if (accessCodeInfo.accessCode || accessCodeInfo.hostCode) {
        const shareInfo = document.getElementById('shareInfo');
        if (shareInfo) {
          // Remove any existing access code display
          const existingDisplay = shareInfo.querySelector('.access-code-display');
          if (existingDisplay) {
            existingDisplay.remove();
          }
          
          const accessCodeDisplay = document.createElement('div');
          accessCodeDisplay.className = 'access-code-display mt-2 p-2 bg-blue-50 rounded text-sm';
          accessCodeDisplay.innerHTML = `
            ${accessCodeInfo.accessCode ? `<p><strong>Participant Code:</strong> <span class="font-mono">${accessCodeInfo.accessCode}</span></p>` : ''}
            ${accessCodeInfo.hostCode ? `<p><strong>Host Code:</strong> <span class="font-mono">${accessCodeInfo.hostCode}</span> <span class="text-xs text-gray-600">(save this to rejoin as host)</span></p>` : ''}
          `;
          shareInfo.appendChild(accessCodeDisplay);
        }
      }
      
      // Store access codes for later use
      window.appState.roomAccessCode = accessCodeInfo.accessCode;
      window.appState.roomHostCode = accessCodeInfo.hostCode;
      
      // Only show error if microphone is missing (camera off is intentional)
      if (!hasAudio) {
        showError('No microphone detected. You\'ll join with video only.', 5000);
      }
      // Note: We don't show error for missing camera since we intentionally start with camera off
      
      // Hide home screen, show meeting screen
      document.getElementById('home').classList.add('hidden');
      document.getElementById('meeting').classList.remove('hidden');
      document.getElementById('shareInfo').classList.remove('hidden');
    } catch (error) {
      console.error('Error hosting meeting:', error);
      if (error.name === 'NotFoundError') {
        showError('No camera or microphone found. Please connect at least one device to host a meeting.');
      } else if (error.name === 'NotAllowedError') {
        showError('Camera/microphone access denied. Please allow access to at least one device in your browser settings.');
      } else {
        showError('Could not start meeting. Please check camera/microphone permissions.');
      }
    }
  });
}

// Setup join button
function setupJoinButton() {
  const joinBtn = document.getElementById('joinBtn');
  
  if (!joinBtn) {
    console.error('Join button not found');
    return;
  }
  
  // Add mobile touch handlers for join button
  const isMobile = window.innerWidth <= 768 || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    joinBtn.addEventListener('touchstart', function(e) {
      e.stopPropagation();
      this.style.transform = 'scale(0.98)';
    }, { passive: false });
    
    joinBtn.addEventListener('touchend', function(e) {
      e.stopPropagation();
      e.preventDefault();
      this.style.transform = '';
      // Manually trigger click
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      });
      this.dispatchEvent(clickEvent);
    }, { passive: false });
    
    joinBtn.style.cssText += 'position: relative; z-index: 100; pointer-events: auto; touch-action: manipulation; -webkit-tap-highlight-color: rgba(0,0,0,0.1); cursor: pointer;';
  }
  
  joinBtn.addEventListener('click', async () => {
    try {
      // Check for room ID in URL first
      let roomId = window.appState.roomId;
      
      // If not found, prompt user
      if (!roomId) {
        roomId = prompt('Enter the room code:');
      }
      
      if (!roomId) {
        return; // User cancelled
      }
      
      // Prompt for username after room ID
      const userName = await promptForUserName('join');
      if (!userName) {
        console.log('User cancelled name prompt, aborting join action');
        return;
      }
      
      // Ask if user wants to join as host or participant
      const joinAsHost = await promptJoinAsHost();
      
      // If joining as host, prompt for host code first
      let accessCode = null;
      if (joinAsHost) {
        accessCode = await promptForAccessCode('host');
        if (accessCode === null) {
          // User cancelled host code prompt
          return;
        }
      }
      
      document.getElementById('connectionStatus').classList.remove('hidden');
      document.getElementById('connectionStatusText').innerHTML = '<i class="fas fa-circle-notch fa-spin mr-2"></i> Initializing media...';
      
      // Get media permissions
      const stream = await initializeMedia();
      
      // Check what we got
      const hasVideo = stream.getVideoTracks().length > 0;
      const hasAudio = stream.getAudioTracks().length > 0;
      
      if (!hasVideo && !hasAudio) {
        // This should never happen due to our fallback logic, but just in case
        showError('No camera or microphone could be accessed. At least one is required for a meeting.');
        return;
      }
      
      // Join room with provided name and access code
      joinRoom(roomId, { 
        userName: userName, 
        accessCode: accessCode,
        isHost: joinAsHost
      });
      
      // Update URL with room ID
      setRoomInUrl(roomId);
      
      // Only show error if microphone is missing (camera off is intentional)
      if (!hasAudio) {
        showError('No microphone detected. You\'ll join with video only.', 5000);
      }
      // Note: We don't show error for missing camera since we intentionally start with camera off
      
      // Hide home screen, show meeting screen
      document.getElementById('home').classList.add('hidden');
      document.getElementById('meeting').classList.remove('hidden');
    } catch (error) {
      console.error('Error joining meeting:', error);
      if (error.name === 'NotFoundError') {
        showError('No camera or microphone found. Please connect at least one device to join a meeting.');
      } else if (error.name === 'NotAllowedError') {
        showError('Camera/microphone access denied. Please allow access to at least one device in your browser settings.');
      } else {
        showError('Could not join meeting. Please check your device connections.');
      }
    }
  });
}

// Function to prompt for access codes when hosting
export async function promptForAccessCodes() {
  return new Promise((resolve) => {
    // Create modal overlay
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] modal-overlay';
    
    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.className = 'bg-white rounded-lg p-6 w-full max-w-md mx-4 shadow-lg modal-content';
    
    // Header
    const header = document.createElement('div');
    header.className = 'flex items-center mb-4 pb-3 border-b border-gray-200';
    
    const icon = document.createElement('div');
    icon.className = 'text-primary mr-3 text-2xl';
    icon.innerHTML = '<i class="fas fa-lock"></i>';
    
    const title = document.createElement('h3');
    title.className = 'text-xl font-bold';
    title.textContent = 'Meeting Security';
    
    header.appendChild(icon);
    header.appendChild(title);
    
    // Description
    const description = document.createElement('p');
    description.className = 'text-gray-600 mb-4 text-sm';
    description.textContent = 'Optionally set access codes to control who can join your meeting.';
    
    // Access code input (for participants)
    const accessCodeContainer = document.createElement('div');
    accessCodeContainer.className = 'mb-4';
    
    const accessCodeLabel = document.createElement('label');
    accessCodeLabel.className = 'block text-sm font-medium text-gray-700 mb-1';
    accessCodeLabel.innerHTML = '<i class="fas fa-users mr-1"></i> Participant Access Code (optional)';
    
    const accessCodeInput = document.createElement('input');
    accessCodeInput.type = 'text';
    accessCodeInput.placeholder = 'Enter 4-6 digit code';
    accessCodeInput.className = 'w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';
    accessCodeInput.maxLength = 6;
    accessCodeInput.pattern = '[0-9]*';
    accessCodeInput.inputMode = 'numeric';
    
    accessCodeContainer.appendChild(accessCodeLabel);
    accessCodeContainer.appendChild(accessCodeInput);
    
    // Host code input
    const hostCodeContainer = document.createElement('div');
    hostCodeContainer.className = 'mb-4';
    
    const hostCodeLabel = document.createElement('label');
    hostCodeLabel.className = 'block text-sm font-medium text-gray-700 mb-1';
    hostCodeLabel.innerHTML = '<i class="fas fa-crown mr-1"></i> Host Code (optional)';
    
    const hostCodeInput = document.createElement('input');
    hostCodeInput.type = 'text';
    hostCodeInput.placeholder = 'Enter 4-6 digit code';
    hostCodeInput.className = 'w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';
    hostCodeInput.maxLength = 6;
    hostCodeInput.pattern = '[0-9]*';
    hostCodeInput.inputMode = 'numeric';
    
    const hostCodeHint = document.createElement('p');
    hostCodeHint.className = 'text-xs text-gray-500 mt-1';
    hostCodeHint.textContent = 'Use this code to rejoin as host if you leave';
    
    hostCodeContainer.appendChild(hostCodeLabel);
    hostCodeContainer.appendChild(hostCodeInput);
    hostCodeContainer.appendChild(hostCodeHint);
    
    // Buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'flex justify-end gap-2 mt-6';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = 'Skip';
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(modalOverlay);
      resolve({ accessCode: null, hostCode: null });
    });
    
    const continueBtn = document.createElement('button');
    continueBtn.className = 'btn btn-primary';
    continueBtn.textContent = 'Continue';
    continueBtn.addEventListener('click', () => {
      const accessCode = accessCodeInput.value.trim() || null;
      const hostCode = hostCodeInput.value.trim() || null;
      
      document.body.removeChild(modalOverlay);
      resolve({ accessCode, hostCode });
    });
    
    // Allow Enter key to submit
    const handleEnter = (e) => {
      if (e.key === 'Enter') {
        continueBtn.click();
      }
    };
    accessCodeInput.addEventListener('keydown', handleEnter);
    hostCodeInput.addEventListener('keydown', handleEnter);
    
    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(continueBtn);
    
    // Assemble modal
    modalContent.appendChild(header);
    modalContent.appendChild(description);
    modalContent.appendChild(accessCodeContainer);
    modalContent.appendChild(hostCodeContainer);
    modalContent.appendChild(buttonContainer);
    modalOverlay.appendChild(modalContent);
    
    // Add to DOM
    document.body.appendChild(modalOverlay);
    
    // Focus first input
    setTimeout(() => accessCodeInput.focus(), 100);
  });
}

}

// Function to prompt if user wants to join as host
export async function promptJoinAsHost() {
  return new Promise((resolve) => {
    // Create modal overlay
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] modal-overlay';
    
    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.className = 'bg-white rounded-lg p-6 w-full max-w-md mx-4 shadow-lg modal-content';
    
    // Header
    const header = document.createElement('div');
    header.className = 'flex items-center mb-4 pb-3 border-b border-gray-200';
    
    const icon = document.createElement('div');
    icon.className = 'text-primary mr-3 text-2xl';
    icon.innerHTML = '<i class="fas fa-user-friends"></i>';
    
    const title = document.createElement('h3');
    title.className = 'text-xl font-bold';
    title.textContent = 'Join as Host or Participant?';
    
    header.appendChild(icon);
    header.appendChild(title);
    
    // Description
    const description = document.createElement('p');
    description.className = 'text-gray-600 mb-4 text-sm';
    description.textContent = 'Would you like to join as a host (if you have the host code) or as a participant?';
    
    // Buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'flex flex-col gap-2 mt-6';
    
    const hostBtn = document.createElement('button');
    hostBtn.className = 'btn btn-primary w-full';
    hostBtn.innerHTML = '<i class="fas fa-crown mr-2"></i>Join as Host';
    hostBtn.addEventListener('click', () => {
      document.body.removeChild(modalOverlay);
      resolve(true);
    });
    
    const participantBtn = document.createElement('button');
    participantBtn.className = 'btn btn-secondary w-full';
    participantBtn.innerHTML = '<i class="fas fa-user mr-2"></i>Join as Participant';
    participantBtn.addEventListener('click', () => {
      document.body.removeChild(modalOverlay);
      resolve(false);
    });
    
    buttonContainer.appendChild(hostBtn);
    buttonContainer.appendChild(participantBtn);
    
    // Assemble modal
    modalContent.appendChild(header);
    modalContent.appendChild(description);
    modalContent.appendChild(buttonContainer);
    modalOverlay.appendChild(modalContent);
    
    // Add to DOM
    document.body.appendChild(modalOverlay);
  });
}

// Function to prompt for access code when joining
export async function promptForAccessCode(mode = 'participant') {
  return new Promise((resolve) => {
    // Create modal overlay
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] modal-overlay';
    
    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.className = 'bg-white rounded-lg p-6 w-full max-w-md mx-4 shadow-lg modal-content';
    
    // Header
    const header = document.createElement('div');
    header.className = 'flex items-center mb-4 pb-3 border-b border-gray-200';
    
    const icon = document.createElement('div');
    icon.className = 'text-primary mr-3 text-2xl';
    icon.innerHTML = '<i class="fas fa-key"></i>';
    
    const title = document.createElement('h3');
    title.className = 'text-xl font-bold';
    title.textContent = mode === 'host' ? 'Enter Host Code' : 'Enter Access Code';
    
    header.appendChild(icon);
    header.appendChild(title);
    
    // Description
    const description = document.createElement('p');
    description.className = 'text-gray-600 mb-4 text-sm';
    description.textContent = mode === 'host' 
      ? 'This meeting requires a host code to join as host. Please enter the host code.' 
      : 'This meeting requires an access code to join.';
    
    // Access code input
    const inputContainer = document.createElement('div');
    inputContainer.className = 'mb-4';
    
    const label = document.createElement('label');
    label.className = 'block text-sm font-medium text-gray-700 mb-1';
    label.textContent = mode === 'host' ? 'Host Code' : 'Access Code';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = `Enter ${mode === 'host' ? 'host' : 'access'} code`;
    input.className = 'w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';
    input.maxLength = 6;
    input.pattern = '[0-9]*';
    input.inputMode = 'numeric';
    input.autofocus = true;
    
    inputContainer.appendChild(label);
    inputContainer.appendChild(input);
    
    // Buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'flex justify-end gap-2 mt-6';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(modalOverlay);
      resolve(null);
    });
    
    const continueBtn = document.createElement('button');
    continueBtn.className = 'btn btn-primary';
    continueBtn.textContent = 'Join';
    continueBtn.addEventListener('click', () => {
      const code = input.value.trim() || null;
      document.body.removeChild(modalOverlay);
      resolve(code);
    });
    
    // Allow Enter key to submit
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        continueBtn.click();
      }
    });
    
    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(continueBtn);
    
    // Assemble modal
    modalContent.appendChild(header);
    modalContent.appendChild(description);
    modalContent.appendChild(inputContainer);
    modalContent.appendChild(buttonContainer);
    modalOverlay.appendChild(modalContent);
    
    // Add to DOM
    document.body.appendChild(modalOverlay);
    
    // Focus input
    setTimeout(() => input.focus(), 100);
  });
}

// Function to prompt for user name
export async function promptForUserName(mode) {
  return new Promise((resolve) => {
    // Try to get previously saved name from localStorage
    const savedName = localStorage.getItem('username') || '';
    
    // Create modal overlay
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] modal-overlay';
    
    // Add mobile detection
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
      modalOverlay.classList.add('mobile-modal-overlay');
    }
    
    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.className = 'bg-white rounded-lg p-6 w-full max-w-md mx-4 shadow-lg modal-content';
    
    // Add mobile detection
    if (isMobile) {
      modalContent.classList.add('mobile-modal-content');
    }
    
    // Header with icon
    const header = document.createElement('div');
    header.className = 'flex items-center mb-4 pb-3 border-b border-gray-200';
    
    const icon = document.createElement('div');
    icon.className = 'text-primary mr-3 text-2xl';
    icon.innerHTML = mode === 'host' ? '<i class="fas fa-crown"></i>' : '<i class="fas fa-user"></i>';
    
    // Title based on mode
    const title = document.createElement('h3');
    title.className = 'text-xl font-bold';
    title.textContent = mode === 'host' ? 'Host a Meeting' : 'Join Meeting';
    
    header.appendChild(icon);
    header.appendChild(title);
    
    // Description text
    const description = document.createElement('p');
    description.className = 'text-gray-600 mb-4';
    description.textContent = mode === 'host' 
      ? 'Enter your name to host a new meeting. You will be given a meeting code to share with others.' 
      : 'Enter your name to join this meeting. Others will see this name during the call.';
    
    // Input field
    const inputContainer = document.createElement('div');
    inputContainer.className = 'mb-4';
    
    const label = document.createElement('label');
    label.className = 'block text-sm font-medium text-gray-700 mb-1';
    label.textContent = 'Your Name';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';
    input.placeholder = 'Enter your name';
    input.value = savedName; // Set previously saved name if available
    input.setAttribute('autocomplete', 'name');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'words');
    
    // Make input more touch-friendly
    if (isMobile) {
      input.classList.add('mobile-input');
      input.style.fontSize = '16px'; // Prevent iOS zoom
    }
    
    // Focus on input when modal appears and select text if there's pre-filled content
    setTimeout(() => {
      input.focus();
      if (savedName) {
        input.select();
      }
    }, 100);
    
    // Add label and input to container
    inputContainer.appendChild(label);
    inputContainer.appendChild(input);
    
    // Remember name checkbox
    const rememberContainer = document.createElement('div');
    rememberContainer.className = 'flex items-center mb-4';
    
    const rememberCheckbox = document.createElement('input');
    rememberCheckbox.type = 'checkbox';
    rememberCheckbox.id = 'rememberName';
    rememberCheckbox.className = 'mr-2';
    rememberCheckbox.checked = savedName !== ''; // Check by default if we have a saved name
    
    // Make checkbox more touch-friendly
    if (isMobile) {
      rememberCheckbox.classList.add('mobile-checkbox');
      rememberCheckbox.style.minWidth = '24px';
      rememberCheckbox.style.minHeight = '24px';
    }
    
    const rememberLabel = document.createElement('label');
    rememberLabel.htmlFor = 'rememberName';
    rememberLabel.className = 'text-sm text-gray-700';
    rememberLabel.textContent = 'Remember my name for next time';
    
    // Make label more touch-friendly
    if (isMobile) {
      rememberLabel.classList.add('mobile-label');
      rememberLabel.style.fontSize = '14px';
      rememberLabel.style.padding = '6px 0';
    }
    
    // Improve accessibility by allowing label to toggle checkbox
    rememberLabel.addEventListener('click', (e) => {
      // Prevent default to avoid issues with the 'for' attribute
      e.preventDefault();
      // Toggle checkbox
      rememberCheckbox.checked = !rememberCheckbox.checked;
    });
    
    rememberContainer.appendChild(rememberCheckbox);
    rememberContainer.appendChild(rememberLabel);
    
    // Button container
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'flex justify-end gap-2 mt-6';
    
    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary py-2 px-4 min-w-[80px] min-h-[44px]';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.setAttribute('type', 'button');
    // Add mobile-friendly attributes
    cancelBtn.setAttribute('touch-action', 'manipulation');
    cancelBtn.style.webkitTouchCallout = 'none';
    cancelBtn.style.webkitTapHighlightColor = 'rgba(0,0,0,0.1)';
    
    // Add explicit touch event handlers for cancel button
    cancelBtn.addEventListener('touchstart', function(e) {
      e.preventDefault();
      e.stopPropagation();
      this.classList.add('active');
      console.log('Cancel button touchstart');
    }, { passive: false });
    
    cancelBtn.addEventListener('touchend', function(e) {
      e.preventDefault();
      e.stopPropagation();
      this.classList.remove('active');
      console.log('Cancel button touchend');
      // Handle cancel action
      document.body.removeChild(modalOverlay);
      resolve(null); // Resolve with null to indicate cancellation
    }, { passive: false });
    
    // Regular click handler as fallback for non-touch devices
    cancelBtn.onclick = (e) => {
      // Only handle if not triggered by touch event
      if (!e.touches) {
        document.body.removeChild(modalOverlay);
        resolve(null); // Resolve with null to indicate cancellation
      }
    };
    
    // Continue button
    const continueBtn = document.createElement('button');
    continueBtn.className = 'btn btn-primary py-2 px-4 min-w-[100px] min-h-[44px]';
    continueBtn.textContent = mode === 'host' ? 'Host Meeting' : 'Join Meeting';
    continueBtn.setAttribute('type', 'button');
    // Add mobile-friendly attributes
    continueBtn.setAttribute('touch-action', 'manipulation');
    continueBtn.style.webkitTouchCallout = 'none';
    continueBtn.style.webkitTapHighlightColor = 'rgba(0,0,0,0.1)';
    
    // Helper function for "continue" action
    const submitName = () => {
      const name = input.value.trim();
      if (name) {
        // Save to localStorage if checkbox is checked
        if (rememberCheckbox.checked) {
          localStorage.setItem('username', name);
        } else {
          // Clear if unchecked
          localStorage.removeItem('username');
        }
        
        document.body.removeChild(modalOverlay);
        resolve(name);
      } else {
        // Shake input if empty
        input.classList.add('border-red-500');
        input.placeholder = 'Name is required';
        setTimeout(() => {
          input.classList.remove('border-red-500');
        }, 1000);
      }
    };
    
    // Add explicit touch event handlers for continue button
    continueBtn.addEventListener('touchstart', function(e) {
      e.preventDefault();
      e.stopPropagation();
      this.classList.add('active');
      console.log('Continue button touchstart');
    }, { passive: false });
    
    continueBtn.addEventListener('touchend', function(e) {
      e.preventDefault();
      e.stopPropagation();
      this.classList.remove('active');
      console.log('Continue button touchend');
      // Handle continue action
      submitName();
    }, { passive: false });
    
    // Regular click handler as fallback for non-touch devices
    continueBtn.onclick = (e) => {
      // Only handle if not triggered by touch event
      if (!e.touches) {
        submitName();
      }
    };
    
    // Handle Enter key
    input.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        submitName();
      }
    });
    
    // Assemble modal
    buttonsContainer.appendChild(cancelBtn);
    buttonsContainer.appendChild(continueBtn);
    
    modalContent.appendChild(header);
    modalContent.appendChild(description);
    modalContent.appendChild(inputContainer);
    modalContent.appendChild(rememberContainer);
    modalContent.appendChild(buttonsContainer);
    
    modalOverlay.appendChild(modalContent);
    
    // Add to DOM
    document.body.appendChild(modalOverlay);
  });
}

// Setup toggle camera button
function setupToggleCameraButton() {
  const toggleCameraBtn = document.getElementById('toggleCameraBtn');
  
  if (!toggleCameraBtn) {
    return;
  }
  
  toggleCameraBtn.addEventListener('click', async () => {
    await toggleCamera();
  });
}

// Setup toggle microphone button
function setupToggleMicButton() {
  const toggleMicBtn = document.getElementById('toggleMicBtn');
  
  if (!toggleMicBtn) {
    return;
  }
  
  toggleMicBtn.addEventListener('click', () => {
    toggleMicrophone();
  });
}

// Setup screen share buttons
function setupScreenShareButtons() {
  const shareScreenBtn = document.getElementById('shareScreenBtn');
  const stopShareBtn = document.getElementById('stopShareBtn');
  
  if (!shareScreenBtn || !stopShareBtn) {
    return;
  }
  
  shareScreenBtn.addEventListener('click', async () => {
    try {
      await startScreenSharing();
      
      // Set up a participant join listener for screen sharing
      setupScreenShareParticipantListener();
    } catch (error) {
      console.error('Error sharing screen:', error);
      // Error is handled in startScreenSharing function
    }
  });
  
  stopShareBtn.addEventListener('click', () => {
    stopScreenSharing();
    
    // Remove the listener when screen sharing stops
    removeScreenShareParticipantListener();
  });
}

// Set up a listener for new participants joining while screen sharing
function setupScreenShareParticipantListener() {
  // Remove any existing listener first to prevent duplicates
  removeScreenShareParticipantListener();
  
  // Create the listener function
  window.screenShareParticipantListener = (event) => {
    // Only show notification if we're the one screen sharing
    if (window.appState.isScreenSharing && window.appState.screenStream) {
      const participantId = event.detail && event.detail.participantId;
      const participantName = participantId && window.appState.participants[participantId] ? 
                             window.appState.participants[participantId].name : 'New participant';
      
      // Show notification with action button to refresh screen share
      showNotification(
        `${participantName} joined. They may not see your screen share.`,
        'warning',
        10000, // 10 second duration
        'Refresh Share', // Action button text
        () => {
          // Import and call screen share refresh
          import('../services/media.js').then(({ refreshScreenSharing }) => {
            if (typeof refreshScreenSharing === 'function') {
              refreshScreenSharing();
              showNotification('Screen share refreshed', 'success', 3000);
            }
          });
        }
      );
    }
  };
  
  // Add the event listener
  document.addEventListener('participant-joined', window.screenShareParticipantListener);
}

// Remove the participant join listener
function removeScreenShareParticipantListener() {
  if (window.screenShareParticipantListener) {
    document.removeEventListener('participant-joined', window.screenShareParticipantListener);
    window.screenShareParticipantListener = null;
  }
}

// Setup leave button
function setupLeaveButton() {
  const leaveBtn = document.getElementById('leaveBtn');
  
  if (!leaveBtn) {
    return;
  }
  
  // Simple click handler - no touchend
  leaveBtn.addEventListener('click', handleLeaveMeeting);
  
  // Add explicit touch events for mobile
  leaveBtn.addEventListener('touchstart', function(e) {
    // Prevent default to avoid any zoom behavior
    e.preventDefault();
    // Add visual feedback
    this.classList.add('active');
  }, { passive: false });
  
  leaveBtn.addEventListener('touchend', function(e) {
    // Prevent default to avoid any zoom behavior
    e.preventDefault();
    // Remove visual feedback
    this.classList.remove('active');
    // Handle the leave action
    handleLeaveMeeting();
  }, { passive: false });
}

// Function to handle leaving the meeting
function handleLeaveMeeting() {
  console.log('Leaving meeting...');
  
  // Give immediate visual feedback
  const leaveBtn = document.getElementById('leaveBtn');
  if (leaveBtn) {
    leaveBtn.classList.add('active');
    leaveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i><span>Leaving...</span>';
  }
  
  // Stop media
  if (window.appState.localStream) {
    window.appState.localStream.getTracks().forEach(track => track.stop());
    window.appState.localStream = null;
  }
  
  if (window.appState.screenStream) {
    window.appState.screenStream.getTracks().forEach(track => track.stop());
    window.appState.screenStream = null;
  }
  
  // Leave room
  leaveRoom();
  
  // Reset UI
  document.getElementById('meeting').classList.add('hidden');
  document.getElementById('home').classList.remove('hidden');
  
  // Remove room from URL
  removeRoomFromUrl();
  
  // Reset button state after delay
  setTimeout(() => {
    if (leaveBtn) {
      leaveBtn.classList.remove('active');
      leaveBtn.innerHTML = '<i class="fas fa-phone-slash mr-2"></i><span>Leave</span>';
    }
  }, 500);
}

// Setup copy link button
function setupCopyLinkButton() {
  const copyLinkBtn = document.getElementById('copyLinkBtn');
  
  if (!copyLinkBtn) {
    return;
  }
  
  function copyLink() {
    const shareLink = document.getElementById('shareLink');
    
    if (!shareLink) {
      return;
    }
    
    // Copy link to clipboard
    navigator.clipboard.writeText(shareLink.textContent)
      .then(() => {
        // Temporary UI feedback
        const originalText = copyLinkBtn.innerHTML;
        copyLinkBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        copyLinkBtn.classList.add('bg-green-600');
        
        setTimeout(() => {
          copyLinkBtn.innerHTML = originalText;
          copyLinkBtn.classList.remove('bg-green-600');
        }, 2000);
      })
      .catch(error => {
        console.error('Error copying link:', error);
        showError('Could not copy link. Please copy it manually.');
      });
  }
  
  // Regular click handler
  copyLinkBtn.addEventListener('click', copyLink);
  
  // Add explicit touch events for mobile
  copyLinkBtn.addEventListener('touchstart', function(e) {
    // Prevent default to avoid any zoom behavior
    e.preventDefault();
    // Add visual feedback
    this.classList.add('active');
  }, { passive: false });
  
  copyLinkBtn.addEventListener('touchend', function(e) {
    // Prevent default to avoid any zoom behavior
    e.preventDefault();
    // Remove visual feedback
    this.classList.remove('active');
    // Copy the link
    copyLink();
  }, { passive: false });
}

// Setup pin event listener
function setupPinListener() {
  // Handle pinned-participant-changed event
  document.addEventListener('pinned-participant-changed', async () => {
    console.log('Pinned participant changed to:', window.appState.pinnedParticipant);
    
    // OPTIMIZED: Only update main video, don't double-refresh
    const { debouncedUpdateMainVideo } = await import('./video.js');
    if (typeof debouncedUpdateMainVideo === 'function') {
      debouncedUpdateMainVideo();
    }
    
    // Update pin buttons immediately
    updatePinButtonStates();
  });
  
  // Handle pin button clicks directly
  document.addEventListener('click', (event) => {
    // Check if the clicked element is a pin button or its icon
    const pinButton = event.target.closest('.pin-btn');
    if (!pinButton) return;
    
    const participantId = pinButton.getAttribute('data-participant-id');
    if (!participantId) return;
    
    // If clicking the currently pinned participant, unpin it (set to local)
    if (window.appState.pinnedParticipant === participantId) {
      window.appState.pinnedParticipant = 'local';
    } else {
      // Otherwise pin this participant
      window.appState.pinnedParticipant = participantId;
    }
    
    // Trigger the pinned-participant-changed event
    document.dispatchEvent(new CustomEvent('pinned-participant-changed'));
  });
}

// Update pin button states to reflect current pinned participant
export function updatePinButtonStates() {
  // Get all pin buttons
  const pinButtons = document.querySelectorAll('.pin-btn');
  
  // Update each button
  pinButtons.forEach(button => {
    const participantId = button.getAttribute('data-participant-id');
    if (!participantId) return;
    
    // If this participant is pinned, show "unpin" state
    if (window.appState.pinnedParticipant === participantId) {
      button.title = 'Unpin from main view';
      button.setAttribute('aria-label', 'Unpin video from main view');
      button.classList.add('active');
      // Change icon to filled thumbtack
      button.innerHTML = '<i class="fas fa-thumbtack"></i>';
      
      // Also check if this participant's container should be hidden in the grid
      if (participantId !== 'local') {
        const container = document.getElementById(`video-container-${participantId}`);
        if (container) {
          container.classList.add('hidden');
        }
      } else {
        // Handle local container
        const localContainer = document.getElementById('localVideoContainer');
        if (localContainer) {
          localContainer.classList.add('hidden');
        }
      }
    } else {
      // Otherwise show "pin" state
      button.title = 'Pin to main view';
      button.setAttribute('aria-label', 'Pin video to main view');
      button.classList.remove('active');
      // Change icon to regular thumbtack
      button.innerHTML = '<i class="fas fa-thumbtack"></i>';
      
      // Make sure this participant's container is visible in the grid
      if (participantId !== 'local') {
        const container = document.getElementById(`video-container-${participantId}`);
        if (container) {
          container.classList.remove('hidden');
        }
      } else {
        // Handle local container
        const localContainer = document.getElementById('localVideoContainer');
        if (localContainer) {
          localContainer.classList.remove('hidden');
        }
      }
    }
  });
  
  // Also update the local video pin button if it's visible
  if (document.querySelector('[data-participant-id="local"]')) {
    import('./video.js').then(({ updateLocalPinButtonState }) => {
      if (typeof updateLocalPinButtonState === 'function') {
        updateLocalPinButtonState();
      }
    }).catch(err => {
      console.warn('Could not update local pin button state:', err);
    });
  }
}

// Setup settings button
function setupSettingsButton() {
  // Add settings button to the controls
  const controlsDiv = document.querySelector('#controls .flex:nth-child(2)');
  
  if (!controlsDiv) {
    console.error('Controls container not found');
    return;
  }
  
  // Create settings button
  const settingsBtn = document.createElement('button');
  settingsBtn.id = 'settingsBtn';
  settingsBtn.className = 'btn-circle btn-secondary';
  settingsBtn.title = 'Settings';
  settingsBtn.setAttribute('aria-label', 'Settings');
  settingsBtn.innerHTML = '<i class="fas fa-cog"></i>';
  // Ensure mobile clickability
  settingsBtn.style.cssText = 'position: relative; z-index: 1000; pointer-events: auto; touch-action: manipulation; -webkit-tap-highlight-color: transparent; cursor: pointer;';
  
  // Create settings menu
  const settingsMenu = document.createElement('div');
  settingsMenu.id = 'settingsMenu';
  settingsMenu.className = 'absolute bottom-full right-0 mb-2 bg-gray-800 rounded-lg shadow-xl z-50 hidden border border-gray-700';
  
  // Add menu items
  settingsMenu.innerHTML = `
    <ul class="py-2">
      <li>
        <button id="devicesBtn" class="w-full text-left px-4 py-2 hover:bg-gray-700 text-white transition-colors">
          <i class="fas fa-headset mr-2"></i> Audio & Video Devices
        </button>
      </li>
      <li>
        <button id="networkSettingsBtn" class="w-full text-left px-4 py-2 hover:bg-gray-700 text-white transition-colors">
          <i class="fas fa-network-wired mr-2"></i> Network Settings
        </button>
      </li>
      <li>
        <button id="reconnectBtn" class="w-full text-left px-4 py-2 hover:bg-gray-700 text-white transition-colors">
          <i class="fas fa-sync mr-2"></i> Reconnect All Peers
        </button>
      </li>
      <li id="uiToggleMenuItem">
        <!-- UI toggle will be added here by uiManager -->
      </li>
    </ul>
  `;
  
  // Append menu to settings button
  settingsBtn.appendChild(settingsMenu);
  
  // Insert settings button before leave button
  controlsDiv.insertBefore(settingsBtn, controlsDiv.lastElementChild);
  
  // Add mobile touch handlers for settings button
  const isMobile = window.innerWidth <= 768 || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    // Add touch handlers for mobile
    settingsBtn.addEventListener('touchstart', function(e) {
      e.stopPropagation();
      this.style.transform = 'scale(0.95)';
    }, { passive: false });
    
    settingsBtn.addEventListener('touchend', function(e) {
      e.stopPropagation();
      e.preventDefault();
      this.style.transform = '';
      // Manually trigger click
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      });
      this.dispatchEvent(clickEvent);
    }, { passive: false });
    
    // Ensure button is clickable
    settingsBtn.style.cssText += 'position: relative !important; z-index: 10001 !important; pointer-events: auto !important; touch-action: manipulation !important; -webkit-tap-highlight-color: transparent !important;';
  }
  
  // Toggle settings menu
  settingsBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    // Don't toggle if clicking on a menu item
    if (event.target.closest('#settingsMenu')) {
      return;
    }
    
    settingsMenu.classList.toggle('hidden');
  });
  
  // Handle clicks on menu items
  document.getElementById('devicesBtn').addEventListener('click', () => {
    settingsMenu.classList.add('hidden');
    showDeviceSelectionModal();
  });
  
  document.getElementById('networkSettingsBtn').addEventListener('click', () => {
    settingsMenu.classList.add('hidden');
    // Show network settings modal
    const networkSettingsModal = document.getElementById('networkSettingsModal');
    if (networkSettingsModal) {
      networkSettingsModal.classList.remove('hidden');
    }
  });
  
  // Add reconnect handler
  document.getElementById('reconnectBtn').addEventListener('click', () => {
    settingsMenu.classList.add('hidden');
    // Import and call the force mesh connections function
    import('../services/socket.js').then(({ forceFullMeshConnections }) => {
      if (typeof forceFullMeshConnections === 'function') {
        forceFullMeshConnections();
      }
    }).catch(err => {
      console.error('Error forcing mesh connections:', err);
    });
  });
  
  // Add mobile touch handlers for menu items
  const devicesBtn = document.getElementById('devicesBtn');
  const networkSettingsBtn = document.getElementById('networkSettingsBtn');
  const reconnectBtn = document.getElementById('reconnectBtn');
  
  const addMobileTouchHandlers = (btn) => {
    if (!btn) return;
    const isMobileCheck = window.innerWidth <= 768 || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobileCheck) {
      btn.addEventListener('touchstart', function(e) {
        e.stopPropagation();
        this.style.backgroundColor = 'rgba(55, 65, 81, 0.5)';
      }, { passive: false });
      
      btn.addEventListener('touchend', function(e) {
        e.stopPropagation();
        e.preventDefault();
        this.style.backgroundColor = '';
        const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        this.dispatchEvent(clickEvent);
      }, { passive: false });
      
      btn.style.cssText += 'position: relative !important; z-index: 10003 !important; pointer-events: auto !important; touch-action: manipulation !important; -webkit-tap-highlight-color: rgba(0,0,0,0.1) !important; cursor: pointer !important;';
    }
  };
  
  if (devicesBtn) addMobileTouchHandlers(devicesBtn);
  if (networkSettingsBtn) addMobileTouchHandlers(networkSettingsBtn);
  if (reconnectBtn) addMobileTouchHandlers(reconnectBtn);
  
  // Ensure menu itself is clickable on mobile (reuse isMobile from line 887)
  if (isMobile) {
    settingsMenu.style.cssText += 'position: absolute !important; z-index: 10002 !important; pointer-events: auto !important; touch-action: auto !important;';
  }
}

// Setup media restart listener
function setupMediaRestartListener() {
  document.addEventListener('restart-media', async () => {
    try {
      // Stop existing tracks
      if (window.appState.localStream) {
        window.appState.localStream.getTracks().forEach(track => track.stop());
      }
      
      // Reinitialize media
      await initializeMedia();
      
      // Update UI
      updateVideoUI();
    } catch (error) {
      console.error('Error restarting media:', error);
      showError('Failed to restart media. Please refresh the page.');
    }
  });
}

// Add enhanced touch handlers for problematic mobile buttons
function enhanceTouchHandlers() {
  // Fix for participants button
  const participantsBtn = document.getElementById('participantsBtn');
  if (participantsBtn) {
    participantsBtn.addEventListener('touchstart', function(e) {
      e.preventDefault();
      this.classList.add('active');
    }, { passive: false });
    
    participantsBtn.addEventListener('touchend', function(e) {
      e.preventDefault();
      this.classList.remove('active');
      // Manually toggle participants panel
      const panel = document.getElementById('participantsPanel');
      if (panel) {
        panel.classList.toggle('hidden');
      }
    }, { passive: false });
  }
  
  // Fix for pin buttons - add global delegated touch handlers
  enhancePinButtonsTouchHandling();
  
  // Set up a mutation observer to enhance new pin buttons as they are added to the DOM
  setupPinButtonObserver();
}

// Add touch event handling specifically for pin buttons
function enhancePinButtonsTouchHandling() {
  console.log('Setting up enhanced touch handling for pin buttons');
  
  // Find all existing pin buttons and enhance them
  const pinButtons = document.querySelectorAll('.pin-btn');
  pinButtons.forEach(enhancePinButton);
}

// Function to enhance a single pin button with better touch handling
function enhancePinButton(button) {
  // Skip if already enhanced
  if (button.dataset.touchEnhanced === 'true') return;
  
  console.log('Enhancing pin button:', button.dataset.participantId);
  
  // Mark as enhanced to avoid duplicate handlers
  button.dataset.touchEnhanced = 'true';
  
  // Set touch-friendly styles
  button.style.touchAction = 'manipulation';
  button.style.WebkitTapHighlightColor = 'rgba(0,0,0,0)';
  button.style.minWidth = '44px';
  button.style.minHeight = '44px';
  button.style.zIndex = '50';
  
  // Add touchstart handler
  button.addEventListener('touchstart', function(e) {
    e.preventDefault();
    e.stopPropagation();
    this.classList.add('touch-active');
  }, { passive: false });
  
  // Add touchend handler
  button.addEventListener('touchend', function(e) {
    e.preventDefault();
    e.stopPropagation();
    this.classList.remove('touch-active');
    
    // Get participant ID
    const participantId = this.getAttribute('data-participant-id');
    if (!participantId) return;
    
    console.log('Pin button touch tapped for:', participantId);
    
    // If clicking the currently pinned participant, unpin it (set to local)
    if (window.appState.pinnedParticipant === participantId) {
      window.appState.pinnedParticipant = 'local';
    } else {
      // Otherwise pin this participant
      window.appState.pinnedParticipant = participantId;
    }
    
    // Trigger the pinned-participant-changed event
    document.dispatchEvent(new CustomEvent('pinned-participant-changed'));
  }, { passive: false });
  
  // Add touchcancel handler
  button.addEventListener('touchcancel', function(e) {
    this.classList.remove('touch-active');
  }, { passive: true });
}

// Set up a mutation observer to enhance new pin buttons as they are added
function setupPinButtonObserver() {
  // Create an observer to watch for new pin buttons being added to the DOM
  const observer = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          // Check if the added node is an element
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if this element is a pin button
            if (node.classList && node.classList.contains('pin-btn')) {
              enhancePinButton(node);
            }
            
            // Check for pin buttons inside this element
            const pinButtons = node.querySelectorAll('.pin-btn');
            pinButtons.forEach(enhancePinButton);
          }
        });
      }
    });
  });
  
  // Start observing the body with the configured parameters
  observer.observe(document.body, { childList: true, subtree: true });
  
  console.log('Pin button observer set up to enhance new buttons');
}

// Setup mobile-specific button handlers
export function setupMobileButtonHandlers() {
  console.log('Setting up mobile button handlers');
  
  // Check if we're on a mobile device
  const isMobile = window.innerWidth <= 768 || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  
  if (!isMobile) {
    console.log('Not on mobile, skipping mobile button setup');
    return;
  }
  
  // Add tap handler to camera toggle button
  const setupCameraButton = () => {
    const toggleCameraBtn = document.getElementById('toggleCameraBtn');
    if (toggleCameraBtn) {
      // Remove any existing handlers to prevent duplicates
      toggleCameraBtn.removeEventListener('click', handleCameraToggle);
      toggleCameraBtn.removeEventListener('touchend', handleCameraToggle);
      
      // Add both click and touchend events for better mobile handling
      toggleCameraBtn.addEventListener('click', handleCameraToggle);
      toggleCameraBtn.addEventListener('touchend', handleCameraToggle);
      
      // Increase tap target size for mobile
      toggleCameraBtn.style.minWidth = '44px';
      toggleCameraBtn.style.minHeight = '44px';
      toggleCameraBtn.style.zIndex = '50';  // Ensure high z-index
      
      console.log('Camera button handler attached');
    }
  };
  
  // Add tap handler to microphone toggle button
  const setupMicButton = () => {
    const toggleMicBtn = document.getElementById('toggleMicBtn');
    if (toggleMicBtn) {
      // Remove any existing handlers to prevent duplicates
      toggleMicBtn.removeEventListener('click', handleMicToggle);
      toggleMicBtn.removeEventListener('touchend', handleMicToggle);
      
      // Add both click and touchend events for better mobile handling
      toggleMicBtn.addEventListener('click', handleMicToggle);
      toggleMicBtn.addEventListener('touchend', handleMicToggle);
      
      // Increase tap target size for mobile
      toggleMicBtn.style.minWidth = '44px';
      toggleMicBtn.style.minHeight = '44px';
      toggleMicBtn.style.zIndex = '50';  // Ensure high z-index
      
      console.log('Mic button handler attached');
    }
  };
  
  // Handler for camera toggle
  async function handleCameraToggle(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('Camera toggle button clicked/tapped');
    
    // Import dynamically to avoid circular dependencies
    const { toggleCamera } = await import('../services/media.js');
    if (typeof toggleCamera === 'function') {
      await toggleCamera();
    }
  }
  
  // Handler for mic toggle
  function handleMicToggle(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('Mic toggle button clicked/tapped');
    
    // Import dynamically to avoid circular dependencies
    import('../services/media.js').then(({ toggleMicrophone }) => {
      if (typeof toggleMicrophone === 'function') {
        toggleMicrophone();
      }
    });
  }
  
  // Run setup immediately
  setupCameraButton();
  setupMicButton();
  
  // Also attach to DOM updates to handle UI changes
  // Use MutationObserver to detect when buttons are added/changed
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList' || mutation.type === 'attributes') {
        setupCameraButton();
        setupMicButton();
      }
    }
  });
  
  // Start observing the control bar that contains the buttons
  const controlsContainer = document.querySelector('.controls-container') || 
                           document.querySelector('.controls') || 
                           document.body;
                           
  if (controlsContainer) {
    observer.observe(controlsContainer, { 
      childList: true, 
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'disabled']
    });
    console.log('Observer attached to controls container');
  }
}

// Export this function so it can be called when participants join
export function refreshPinButtonHandlers() {
  console.log('Manually refreshing pin button handlers');
  enhancePinButtonsTouchHandling();
} 