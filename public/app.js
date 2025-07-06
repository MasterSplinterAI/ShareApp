const socket = io();
const localVideo = document.getElementById('localVideo');
const mainVideo = document.getElementById('mainVideo');
const hostBtn = document.getElementById('hostBtn');
const joinBtn = document.getElementById('joinBtn');
const shareScreenBtn = document.getElementById('shareScreenBtn');
const stopShareBtn = document.getElementById('stopShareBtn');
const leaveBtn = document.getElementById('leaveBtn');
const roomCodeEl = document.getElementById('roomCode');
const shareLinkEl = document.getElementById('shareLink');
const participantsGrid = document.getElementById('participantsGrid');
const participantsBtn = document.getElementById('participantsBtn');
const participantsPanel = document.getElementById('participantsPanel');
const participantsList = document.getElementById('participantsList');
const closeParticipantsBtn = document.getElementById('closeParticipantsBtn');
const mainVideoLabel = document.getElementById('mainVideoLabel');
const mainFullscreenBtn = document.getElementById('mainFullscreenBtn');

// Get references to the remaining UI elements
const toggleCameraBtn = document.getElementById('toggleCameraBtn');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const copyLinkBtn = document.getElementById('copyLinkBtn');

// Add connection status elements
const statusContainer = document.createElement('div');
statusContainer.id = 'statusContainer';
statusContainer.style.margin = '10px 0';
statusContainer.style.padding = '10px';
statusContainer.style.backgroundColor = '#f5f5f5';
statusContainer.style.borderRadius = '5px';
statusContainer.style.textAlign = 'center';
document.querySelector('#controls').appendChild(statusContainer);

const connectionStatus = document.createElement('div');
connectionStatus.id = 'connectionStatus';
connectionStatus.textContent = 'Not connected';
statusContainer.appendChild(connectionStatus);

let localStream;
let screenStream;
let peerConnections = {}; // Map of peer connections by userId
let roomId;
let isHost = false;
let isSharingScreen = false;
let participants = {}; // Map of participants by userId
let currentUserID; // Our user ID
let pinnedParticipant = null; // Currently pinned participant (shown in main video)
let disconnectionTimers = {}; // Map of timers for tracking disconnected users

// Track state
let isCameraOn = false; // Default to camera off for new users
let isMicOn = true;
let activeMediaBtn = 'none'; // 'camera', 'screen', or 'none'

// Enhanced configuration with STUN and TURN servers for international connectivity
const configuration = {
  iceServers: [
    // Google STUN servers
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    
    // Additional STUN servers
    { urls: 'stun:stun.services.mozilla.com' },
    { urls: 'stun:stun.ekiga.net' },
    
    // Free TURN servers for international users (when direct connection fails)
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject', 
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  // Enhanced configuration for better connectivity
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require'
};

// Function to update the UI with connection status
function updateStatus(message, isError = false) {
  connectionStatus.textContent = message;
  connectionStatus.style.color = isError ? '#c62828' : '#2e7d32';
  console.log(isError ? `Error: ${message}` : message);
}

// Function to show error message to user
function showError(message) {
  const errorEl = document.createElement('div');
  errorEl.style.backgroundColor = '#ffebee';
  errorEl.style.color = '#c62828';
  errorEl.style.padding = '10px';
  errorEl.style.margin = '10px 0';
  errorEl.style.borderRadius = '4px';
  errorEl.style.fontWeight = 'bold';
  errorEl.textContent = `Error: ${message}`;
  
  // Remove any existing error after 5 seconds
  const existingError = document.querySelector('.error-message');
  if (existingError) {
    existingError.remove();
  }
  
  errorEl.className = 'error-message';
  document.body.insertBefore(errorEl, document.body.firstChild);
  
  // Auto-remove after 5 seconds
  setTimeout(() => errorEl.remove(), 5000);
  
  console.error(message);
}

// Function to ensure we're sending our media to all connections
async function broadcastMediaToAllConnections() {
  if (!localStream) {
    console.log('No local stream available to broadcast');
    return;
  }

  console.log('Broadcasting local media to all connections...');
  
  // Get all tracks from the local stream
  const tracks = localStream.getTracks();
  console.log(`Local stream has ${tracks.length} tracks to broadcast`);
  
  // Log each track's state
  tracks.forEach(track => {
    console.log(`Track to broadcast: ${track.kind}, label: ${track.label}, enabled: ${track.enabled}, state: ${track.readyState}`);
  });

  // Check if we need fresh audio
  const audioTracks = localStream.getAudioTracks();
  let needsFreshAudio = false;
  
  if (audioTracks.length > 0) {
    const audioTrack = audioTracks[0];
    if (audioTrack.readyState === 'ended') {
      console.log('Audio track needs refresh:', audioTrack.readyState);
      needsFreshAudio = true;
    }
  } else {
    console.log('No audio tracks found, will get fresh audio');
    needsFreshAudio = true;
  }

  // If we need fresh audio, get it
  if (needsFreshAudio) {
    try {
      let newAudioTrack;
      
      // For host, always try to get a completely fresh audio track
      if (isHost) {
        try {
          const freshAudioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              sampleRate: 48000,
              channelCount: 1,
              latency: 0
            }
          });
          
          // Store for future use
          window.persistentAudioStream = freshAudioStream.clone();
          
          newAudioTrack = freshAudioStream.getAudioTracks()[0];
          console.log('Host got completely fresh audio track:', newAudioTrack.label);
        } catch (err) {
          console.error('Host failed to get fresh audio:', err);
          // Will try fallback methods
        }
      }
      
      // If we don't have a track yet, try to get audio from persistent stream
      if (!newAudioTrack && window.persistentAudioStream) {
        const persistentTracks = window.persistentAudioStream.getAudioTracks();
        if (persistentTracks.length > 0 && persistentTracks[0].readyState === 'live') {
          newAudioTrack = persistentTracks[0].clone(); // Clone it to ensure it's fresh
          console.log('Using cloned audio track from persistent stream:', newAudioTrack.label);
        }
      }
      
      // If still no track, get completely fresh audio
      if (!newAudioTrack) {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,
            channelCount: 1,
            latency: 0
          }
        });
        newAudioTrack = audioStream.getAudioTracks()[0];
        
        // Also update persistent stream
        window.persistentAudioStream = audioStream.clone();
        
        console.log('Got fresh audio track as last resort:', newAudioTrack.label);
      }
      
      // Remove old audio tracks
      localStream.getAudioTracks().forEach(track => {
        try {
          localStream.removeTrack(track);
          track.stop();
          console.log(`Removed old audio track: ${track.label}`);
        } catch (e) {
          console.error('Error removing track:', e);
        }
      });
      
      // Add new audio track
      try {
        localStream.addTrack(newAudioTrack);
        console.log(`Added new audio track: ${newAudioTrack.label}, state: ${newAudioTrack.readyState}`);
      } catch (e) {
        console.error('Error adding new audio track:', e);
        // Try one more time with a new stream entirely
        try {
          localStream = new MediaStream([newAudioTrack]);
          console.log('Created entirely new stream with fresh audio track');
        } catch (e2) {
          console.error('Fatal error creating new stream:', e2);
          return;
        }
      }
      
      // Ensure the track is enabled based on saved state or host status
      // FIXED: Respect the host's choice to mute, don't force audio on
      if (isHost && isSharingScreen) {
        // Only force audio on during screensharing if it was previously on
        newAudioTrack.enabled = window.savedMicState !== false;
        isMicOn = window.savedMicState !== false;
        console.log(`Host is screen sharing - setting audio track to ${newAudioTrack.enabled ? 'enabled' : 'disabled'}`);
      } else {
        newAudioTrack.enabled = window.savedMicState !== false;
        isMicOn = window.savedMicState !== false;
      }
      
      console.log(`New audio track enabled state set to: ${newAudioTrack.enabled}`);
      
      // Update UI to reflect actual state
      updateMicrophoneUI(newAudioTrack.enabled);
      
      // Update main video if it's showing our stream
      if (mainVideo.srcObject === localStream) {
        mainVideo.srcObject = localStream;
      }
      
      // Update local video
      localVideo.srcObject = localStream;
      
    } catch (error) {
      console.error('Error refreshing audio track:', error);
      return;
    }
  } else if (isHost && isSharingScreen) {
    // For hosts screen sharing, respect their mic mute choice
    audioTracks.forEach(track => {
      // Only change if different from current state
      if (track.enabled !== isMicOn) {
        console.log(`Host audio track state: updating to match mute status (${isMicOn ? 'enabled' : 'disabled'})`);
        track.enabled = isMicOn;
      }
    });
  }

  // Broadcast to all peer connections
  let needsRenegotiation = false;
  
  Object.entries(peerConnections).forEach(([peerId, peerConnection]) => {
    if (peerConnection.connectionState === 'connected' || peerConnection.iceConnectionState === 'connected') {
      console.log(`Broadcasting to peer: ${peerId}`);
      
      // Get current tracks
      const currentTracks = localStream.getTracks();
      
      // Get existing senders
      const senders = peerConnection.getSenders();
      
      // Update or add tracks
      currentTracks.forEach(track => {
        const existingSender = senders.find(sender => 
          sender.track && sender.track.kind === track.kind
        );
        
        if (existingSender) {
          try {
            console.log(`Replacing ${track.kind} track for peer ${peerId}`);
            existingSender.replaceTrack(track).catch(err => {
              console.error(`Error replacing track for peer ${peerId}:`, err);
              needsRenegotiation = true;
            });
          } catch (err) {
            console.error(`Exception replacing track for peer ${peerId}:`, err);
            needsRenegotiation = true;
          }
        } else {
          try {
            console.log(`Adding new ${track.kind} track for peer ${peerId}`);
            peerConnection.addTrack(track, localStream);
            needsRenegotiation = true;
          } catch (err) {
            console.error(`Error adding track for peer ${peerId}:`, err);
          }
        }
      });
      
      // Renegotiate connection if needed
      if (needsRenegotiation || isHost || isSharingScreen) {
        console.log(`Renegotiating connection with ${peerId} to ensure updated media state`);
        renegotiateConnection(peerId);
      }
    } else {
      console.log(`Cannot broadcast to peer ${peerId}, connection state: ${peerConnection.connectionState}, ICE state: ${peerConnection.iceConnectionState}`);
    }
  });
}

// Function to detect mobile device
function isMobileDevice() {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;
  const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
  const isMobile = mobileRegex.test(userAgent) || window.innerWidth <= 768;
  
  // Add mobile-specific class to body if mobile
  if (isMobile) {
    document.body.classList.add('mobile-device');
  } else {
    document.body.classList.remove('mobile-device');
  }
  
  return isMobile;
}

// Function to get appropriate video constraints based on device
function getVideoConstraints() {
  const mobile = isMobileDevice();
  
  if (mobile) {
    // Mobile device - use lower resolution video and optimized audio
    return {
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: 'user',
        frameRate: { max: 15 }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        // Add mobile-specific audio constraints
        sampleRate: 48000,
        channelCount: 1,
        latency: 0
      }
    };
  } else {
    // Desktop device - use higher resolution
    return {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    };
  }
}

// Function to apply mobile-specific optimizations
function applyMobileOptimizations() {
  const isMobile = isMobileDevice();
  
  if (isMobile) {
    // Make buttons bigger for touch screens
    const allButtons = document.querySelectorAll('button');
    allButtons.forEach(button => {
      if (button.classList.contains('btn-circle')) {
        button.classList.add('w-14', 'h-14'); // Bigger circular buttons
      } else {
        button.classList.add('py-3'); // Taller regular buttons
      }
    });
    
    // Adjust video sizes for smaller screens
    const mainVideoContainer = document.getElementById('mainVideoContainer');
    if (mainVideoContainer) {
      mainVideoContainer.classList.add('h-[40vh]'); // Adjust main video height
    }
    
    // Make controls sticky at bottom
    const controlsDiv = document.getElementById('controls');
    if (controlsDiv) {
      controlsDiv.classList.add('sticky', 'bottom-0', 'z-10');
    }
    
    // Add touch event listeners for better mobile interaction
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
      video.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          // Single touch - toggle play/pause
          if (video.paused) {
            video.play();
          } else {
            video.pause();
          }
        }
      });
    });
    
    // Optimize participants grid for mobile
    const participantsGrid = document.getElementById('participantsGrid');
    if (participantsGrid) {
      // Apply mobile-specific styling
      participantsGrid.classList.remove('grid-cols-3', 'grid-cols-4');
      participantsGrid.classList.add('grid-cols-2'); // Always show 2 columns on mobile
      
      // Make grid items more compact
      const gridItems = participantsGrid.querySelectorAll('.video-container');
      gridItems.forEach(item => {
        item.classList.add('h-24', 'max-h-28'); // Set consistent height
        item.style.minHeight = '100px'; // Ensure minimum height
      });
    }
    
    // Add a special CSS class to help with mobile video rendering
    document.body.classList.add('mobile-optimized');
    
    // Add custom CSS for mobile optimization if it doesn't exist
    if (!document.getElementById('mobile-video-optimizations')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'mobile-video-optimizations';
      styleEl.textContent = `
        /* Force hardware acceleration for videos on mobile */
        video {
          transform: translateZ(0);
          backface-visibility: hidden;
          perspective: 1000;
          -webkit-transform: translateZ(0);
          -webkit-backface-visibility: hidden;
          -webkit-perspective: 1000;
          will-change: transform;
        }
        
        /* Better mobile video container layout */
        .mobile-optimized #participantsGrid .video-container {
          overflow: hidden;
          position: relative;
          aspect-ratio: 4/3;
          border-radius: 8px;
          background-color: #111;
          border: 1px solid rgba(255,255,255,0.1);
        }
        
        /* Optimize video display within containers */
        .mobile-optimized #participantsGrid video {
          object-fit: cover;
          width: 100%;
          height: 100%;
          position: absolute;
          left: 0;
          top: 0;
        }
        
        /* Better no-video placeholder styling */
        .mobile-optimized .no-video-placeholder {
          font-size: 12px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        
        /* Optimize video labels on mobile */
        .mobile-optimized .video-label {
          font-size: 12px;
          padding: 2px 6px;
          background-color: rgba(0,0,0,0.5);
          max-width: 90%;
          text-overflow: ellipsis;
          white-space: nowrap;
          overflow: hidden;
        }
      `;
      document.head.appendChild(styleEl);
    }
  } else {
    // Remove mobile optimizations if screen is resized to desktop
    document.body.classList.remove('mobile-optimized');
    
    // Reset grid layout for desktop
    const participantsGrid = document.getElementById('participantsGrid');
    if (participantsGrid) {
      participantsGrid.classList.remove('grid-cols-2');
      // Determine appropriate columns based on participant count
      const participantCount = Object.keys(participants).length;
      if (participantCount <= 4) {
        participantsGrid.classList.add('grid-cols-3');
      } else {
        participantsGrid.classList.add('grid-cols-4');
      }
    }
  }
}

// Function to ensure audio is properly enabled and transmitted
function ensureAudioIsEnabled() {
  if (!localStream || typeof localStream.getAudioTracks !== 'function') {
    console.warn('Cannot enable audio: No local stream available or invalid stream');
    return false;
  }
  
  const audioTracks = localStream.getAudioTracks();
  if (audioTracks.length === 0) {
    console.warn('Cannot enable audio: No audio tracks found in stream');
    
    // Try to get a new audio track and add it to the stream
    getFreshAudioTrack().then(track => {
      if (track) {
        console.log(`Adding new audio track to stream: ${track.label}`);
        localStream.addTrack(track);
        
        // Update UI
        isMicOn = true;
        toggleMicBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        toggleMicBtn.classList.add('btn-primary');
        toggleMicBtn.classList.remove('btn-secondary');
        
        // Broadcast the updated stream
        broadcastMediaToAllConnections();
      }
    });
    
    return false;
  }
  
  console.log(`Ensuring ${audioTracks.length} audio tracks are enabled...`);
  let allEnabled = true;
  let needNewTrack = false;
  
  audioTracks.forEach(track => {
    // Check if track is not enabled and enable it
    if (!track.enabled) {
      console.log(`Found disabled audio track, enabling: ${track.label}`);
      track.enabled = true;
    }
    
    // Verify it's enabled now
    if (!track.enabled) {
      console.error(`Failed to enable audio track: ${track.label}`);
      allEnabled = false;
    } else {
      console.log(`Audio track is enabled: ${track.label}`);
    }
    
    // Check if track is ended and log warning
    if (track.readyState === 'ended') {
      console.warn(`Audio track is in 'ended' state: ${track.label}`);
      allEnabled = false;
      needNewTrack = true;
    }
  });
  
  // If we have an ended track, replace it with a new one
  if (needNewTrack) {
    console.log('Found ended audio track, getting a new one');
    
    // Remove all ended tracks
    const endedTracks = audioTracks.filter(track => track.readyState === 'ended');
    endedTracks.forEach(track => {
      try {
        localStream.removeTrack(track);
      } catch (e) {
        console.error('Error removing ended track:', e);
      }
    });
    
    // Add a fresh track
    getFreshAudioTrack().then(track => {
      if (track) {
        console.log(`Adding new audio track to replace ended track: ${track.label}`);
        localStream.addTrack(track);
        
        // Make sure UI shows mic is on
        isMicOn = true;
        toggleMicBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        toggleMicBtn.classList.add('btn-primary');
        toggleMicBtn.classList.remove('btn-secondary');
        
        // Broadcast the updated stream
        broadcastMediaToAllConnections();
      }
    });
  }
  
  // Update mic UI state based on current state
  isMicOn = allEnabled;
  toggleMicBtn.innerHTML = isMicOn ? 
    '<i class="fas fa-microphone"></i>' : 
    '<i class="fas fa-microphone-slash"></i>';
  toggleMicBtn.classList.toggle('btn-primary', isMicOn);
  toggleMicBtn.classList.toggle('btn-secondary', !isMicOn);
  
  return allEnabled;
}

// Function to get a fresh audio track without affecting existing tracks
async function getFreshAudioTrack() {
  try {
    const audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    
    // Store this stream for future reuse
    window.persistentAudioStream = audioStream;
    
    return audioStream.getAudioTracks()[0];
  } catch (error) {
    console.error('Error getting fresh audio track:', error);
    return null;
  }
}

// Host meeting function
async function hostMeeting() {
  try {
    isHost = true;
    roomId = generateRoomId();
    
    // Prompt for username first
    let userName = 'Host';
    
    try {
      // Dynamically import the function to avoid circular dependencies
      const { promptForUserName } = await import('./js/ui/events.js');
      if (typeof promptForUserName === 'function') {
        userName = await promptForUserName('host');
        if (!userName) {
          console.log('User cancelled name prompt, aborting host action');
          return;
        }
      }
    } catch (importError) {
      console.error('Error importing promptForUserName function:', importError);
    }
    
    updateStatus('Requesting media permissions...');
    
    // Initialize peerConnections object
    peerConnections = {};
    
    // Set initial microphone state to enabled
    window.savedMicState = true;
    isMicOn = true;
    console.log('Setting initial microphone state to enabled');
    
    // Try to get camera and microphone access with optimized constraints
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ 
        video: getVideoConstraints(), 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
          latency: 0
        }
      });
      
      // Store for persistent use
      window.persistentAudioStream = localStream.clone();
      
      updateStatus('Camera and microphone accessed successfully');
      
      // Set the active media state
      activeMediaBtn = 'camera';
      
      // Update toggle buttons
      isCameraOn = true;
      toggleCameraBtn.innerHTML = '<i class="fas fa-video"></i>';
      toggleCameraBtn.classList.add('btn-primary');
      toggleCameraBtn.classList.remove('btn-secondary');
      
      isMicOn = true;
      toggleMicBtn.innerHTML = '<i class="fas fa-microphone"></i>';
      toggleMicBtn.classList.add('btn-primary');
      toggleMicBtn.classList.remove('btn-secondary');
      
    } catch (error) {
      console.error('Media access failed:', error);
      showError(`Media access error: ${error.message}. Please check your camera and microphone settings.`);
      
      // Try with just audio as fallback
      try {
        // Get a clean audio stream with mobile-optimized constraints
        const audioOnlyStream = await navigator.mediaDevices.getUserMedia({ 
          video: false, 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,
            channelCount: 1,
            latency: 0
          }
        });
        
        // Create a global reference to our audio stream for reuse
        // Important: We need to clone this for future use
        window.persistentAudioStream = audioOnlyStream.clone();
        console.log('Created persistent audio stream for future use');
        
        // Assign to localStream
        localStream = audioOnlyStream;
        
        // Explicitly ensure audio is enabled and state is preserved
        const audioTracks = localStream.getAudioTracks();
        audioTracks.forEach(track => {
          track.enabled = true;
          console.log(`Initialized audio track: ${track.label}, enabled: ${track.enabled}, state: ${track.readyState}`);
        });
        
        updateStatus('Audio-only mode activated');
        
        // Important: Set activeMediaBtn to 'camera' even though we only have audio
        // This ensures the mic is treated as active and transmitting
        activeMediaBtn = 'camera';
        
        // Update toggle buttons
        isCameraOn = false;
        toggleCameraBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
        toggleCameraBtn.classList.remove('btn-primary');
        toggleCameraBtn.classList.add('btn-secondary');
        
        // Ensure mic UI shows as enabled
        toggleMicBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        toggleMicBtn.classList.add('btn-primary');
        toggleMicBtn.classList.remove('btn-secondary');
        
        console.log(`Audio-only mode has ${localStream.getAudioTracks().length} audio tracks`);
        localStream.getAudioTracks().forEach(track => {
          console.log(`Audio track: ${track.label}, enabled: ${track.enabled}, state: ${track.readyState}`);
        });
        
      } catch (audioError) {
        console.error('Audio access failed:', audioError);
        
        // Create an empty stream if no devices are available
        localStream = new MediaStream();
        showError('No media devices available. Participants will not be able to see or hear you.');
        
        // Update toggle buttons
        isMicOn = false;
        toggleMicBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        toggleMicBtn.classList.remove('btn-primary');
        toggleMicBtn.classList.add('btn-secondary');
        
        // Set the active media state
        activeMediaBtn = 'none';
      }
    }
    
    // Set up the local video
    localVideo.srcObject = localStream;
    if (!isCameraOn || (localStream && typeof localStream.getVideoTracks === 'function' && localStream.getVideoTracks().length === 0)) {
      showNoVideoPlaceholder(localVideo);
    }
    
    // Always mute local video to prevent feedback
    localVideo.muted = true;
    
    // Join room with the provided username
    socket.emit('join', {
      roomId: roomId,
      isHost: true,
      userName: userName
    });
    
    // Update UI
    document.getElementById('home').classList.add('hidden');
    document.getElementById('meeting').classList.remove('hidden');
    document.getElementById('shareInfo').classList.remove('hidden');
    
    // Set room info
    roomCodeEl.textContent = roomId;
    shareLinkEl.textContent = `${window.location.origin}/?room=${roomId}`;
    
    // Set main video to our stream initially
    mainVideo.srcObject = localStream;
    mainVideoLabel.textContent = `${userName} (Host)`;
    
    // Initialize connection
    await setupPeerConnection();
    
    // Ensure audio state is preserved and broadcast immediately
    if (localStream && typeof localStream.getAudioTracks === 'function') {
      const audioTracks = localStream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = true; // Always enable for host
        console.log(`Ensuring audio track enabled state: ${track.label}, enabled: ${track.enabled}, state: ${track.readyState}`);
      });
    }
    
    // Broadcast media immediately after setup
    setTimeout(() => {
      console.log('Host broadcasting initial media state...');
      broadcastMediaToAllConnections();
    }, 500);
    
    // Set up periodic check to ensure audio tracks stay live
    if (isHost) {
      setInterval(() => {
        if (localStream && typeof localStream.getAudioTracks === 'function') {
          const audioTracks = localStream.getAudioTracks();
          
          // Check if any audio tracks are in 'ended' state
          const hasEndedTracks = audioTracks.some(track => track.readyState === 'ended');
          
          if (hasEndedTracks || audioTracks.length === 0) {
            console.log('Detected ended audio track during periodic check, refreshing...');
            refreshHostAudio();
          }
        }
      }, 5000); // Check every 5 seconds
    }
    
    updateStatus('Hosting meeting, waiting for participants to join...');
    
  } catch (error) {
    updateStatus('Error hosting meeting: ' + error.message, true);
    showError(`Host error: ${error.message}`);
  }
}

// Function to refresh host audio when it goes into ended state
async function refreshHostAudio() {
  try {
    if (!isHost) return;
    
    console.log('Refreshing host audio...');
    
    // Get fresh audio
    const freshAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    
    // Store for future use
    window.persistentAudioStream = freshAudioStream.clone();
    
    // Get the audio track
    const freshAudioTrack = freshAudioStream.getAudioTracks()[0];
    
    if (freshAudioTrack) {
      console.log(`Got fresh audio track: ${freshAudioTrack.label}, state: ${freshAudioTrack.readyState}`);
      
      // Remove old audio tracks
      if (localStream && typeof localStream.getAudioTracks === 'function') {
        localStream.getAudioTracks().forEach(track => {
          localStream.removeTrack(track);
          track.stop();
        });
      }
      
      // Add the fresh track to our stream
      localStream.addTrack(freshAudioTrack);
      
      // Ensure it's enabled
      freshAudioTrack.enabled = true;
      
      // Update UI
      isMicOn = true;
      updateMicrophoneUI(true);
      
      // Broadcast to all participants
      broadcastMediaToAllConnections();
      
      console.log('Host audio refreshed successfully');
    }
  } catch (error) {
    console.error('Error refreshing host audio:', error);
  }
}

// Join meeting function
async function joinMeeting() {
  try {
    // Get room ID from prompt
    const promptedRoomId = prompt('Enter the meeting code:');
    if (!promptedRoomId) return; // User cancelled
    
    roomId = promptedRoomId;
    
    // Prompt for username
    let userName = 'Guest';
    
    try {
      // Dynamically import the function to avoid circular dependencies
      const { promptForUserName } = await import('./js/ui/events.js');
      if (typeof promptForUserName === 'function') {
        userName = await promptForUserName('join');
        if (!userName) {
          console.log('User cancelled name prompt, aborting join action');
          return;
        }
      }
    } catch (importError) {
      console.error('Error importing promptForUserName function:', importError);
    }
    
    updateStatus('Requesting media permissions...');
    
    // Initialize peerConnections object
    peerConnections = {};
    
    // Try to get camera and microphone access with optimized constraints
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ 
        video: getVideoConstraints(), 
        audio: true 
      });
      updateStatus('Camera and microphone accessed successfully');
      
      // Set the active media state
      activeMediaBtn = 'camera';
      
      // Update toggle buttons
      isCameraOn = true;
      toggleCameraBtn.innerHTML = '<i class="fas fa-video"></i>';
      toggleCameraBtn.classList.add('btn-primary');
      toggleCameraBtn.classList.remove('btn-secondary');
      
      isMicOn = true;
      toggleMicBtn.innerHTML = '<i class="fas fa-microphone"></i>';
      toggleMicBtn.classList.add('btn-primary');
      toggleMicBtn.classList.remove('btn-secondary');
      
    } catch (error) {
      console.error('Media access failed:', error);
      showError(`Media access error: ${error.message}. Please check your camera and microphone settings.`);
      
      // Try with just audio as fallback
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
          video: false, 
          audio: true 
        });
        updateStatus('Audio-only mode activated');
        
        // Store for future use
        window.persistentAudioStream = localStream.clone();
        
        // FIXED: Set activeMediaBtn to 'camera' even with no camera
        // This ensures audio tracks are properly transmitted
        activeMediaBtn = 'camera';  // Changed from 'none' to 'camera'
        
        // Update toggle buttons
        isCameraOn = false;
        toggleCameraBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
        toggleCameraBtn.classList.remove('btn-primary');
        toggleCameraBtn.classList.add('btn-secondary');
        
        // Explicitly ensure mic is on
        isMicOn = true;
        toggleMicBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        toggleMicBtn.classList.add('btn-primary');
        toggleMicBtn.classList.remove('btn-secondary');
        
        // Ensure audio tracks are actually enabled
        const audioTracks = localStream.getAudioTracks();
        audioTracks.forEach(track => {
          track.enabled = true;
          console.log(`Audio-only mode: Ensuring audio track ${track.label} is enabled`);
        });
        
      } catch (audioError) {
        console.error('Audio access failed:', audioError);
        
        // Create an empty stream if no devices are available
        localStream = new MediaStream();
        showError('No media devices available. Participants will not be able to see or hear you.');
        
        // Update toggle buttons
        isMicOn = false;
        toggleMicBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        toggleMicBtn.classList.remove('btn-primary');
        toggleMicBtn.classList.add('btn-secondary');
        
        // Set the active media state
        activeMediaBtn = 'none';
      }
    }
    
    // Set up the local video
    localVideo.srcObject = localStream;
    if (!isCameraOn || (localStream && typeof localStream.getVideoTracks === 'function' && localStream.getVideoTracks().length === 0)) {
      showNoVideoPlaceholder(localVideo);
    }
    
    // Always mute local video to prevent feedback
    localVideo.muted = true;
    
    // Join room with the provided username
    socket.emit('join', {
      roomId: roomId,
      isHost: false,
      userName: userName
    });
    
    // Update UI
    document.getElementById('home').classList.add('hidden');
    document.getElementById('meeting').classList.remove('hidden');
    
    // Initialize connection
    await setupPeerConnection();
    
    // Ensure audio state is properly set for transmission
    window.savedMicState = isMicOn;
    preserveAudioState();
    
    // Verify audio tracks are properly enabled
    if (localStream && typeof localStream.getAudioTracks === 'function') {
      const audioTracks = localStream.getAudioTracks();
      if (audioTracks.length > 0) {
        const allEnabled = audioTracks.every(track => track.enabled);
        console.log(`Joining with ${audioTracks.length} audio tracks, all enabled: ${allEnabled}`);
        if (!allEnabled && isMicOn) {
          audioTracks.forEach(track => {
            track.enabled = true;
            console.log(`Forced enabling audio track: ${track.label}`);
          });
        }
      }
    }
    
    updateStatus('Joining meeting...');
    
  } catch (error) {
    updateStatus('Error joining meeting: ' + error.message, true);
    showError(`Join error: ${error.message}`);
  }
}

// Function to leave meeting
function leaveMeeting() {
  // Stop all tracks in the local stream
  if (localStream && typeof localStream.getTracks === 'function') {
    localStream.getTracks().forEach(track => track.stop());
  }
  
  // Clear all disconnection timers
  Object.keys(disconnectionTimers).forEach(userId => {
    clearTimeout(disconnectionTimers[userId]);
  });
  disconnectionTimers = {};
  
  // Close all peer connections
  for (const userId in peerConnections) {
    const pc = peerConnections[userId];
    if (pc) {
      pc.close();
    }
  }
  
  // Send leave room event to server
  socket.emit('leave-room');
  
  // Disconnect socket
  socket.close();
  
  // Reset UI
  document.getElementById('home').classList.remove('hidden');
  document.getElementById('meeting').classList.add('hidden');
  document.getElementById('shareInfo').classList.add('hidden');
  participantsPanel.classList.add('hidden');
  
  // Reload the page for a clean start
  window.location.reload();
}

// Function to show a placeholder when video is off
function showNoVideoPlaceholder(videoElement) {
  if (!videoElement) {
    console.error('Cannot show placeholder: no video element provided');
    return;
  }
  
  // Find the parent container
  const container = videoElement.closest('.video-container');
  if (!container) {
    console.error('Cannot show placeholder: no container found for video element');
    return;
  }
  
  // Remove any existing placeholder
  const existingPlaceholder = container.querySelector('.no-video-placeholder');
  if (existingPlaceholder) {
    existingPlaceholder.remove();
  }
  
  // Create a new placeholder
  const placeholder = document.createElement('div');
  placeholder.className = 'no-video-placeholder absolute inset-0 flex items-center justify-center bg-dark text-white text-lg text-center p-4';
  placeholder.innerHTML = '<div><i class="fas fa-video-slash mb-2 text-2xl"></i><br>Camera Off</div>';
  
  // Add the placeholder to the container
  container.appendChild(placeholder);
  
  // Debug log for verification
  console.log(`Added no-video placeholder to container: ${container.id}`);
}

// Function to share screen
async function shareScreen() {
  try {
    updateStatus('Requesting screen sharing...');
    
    // Save our current stream state before getting screen
    const hasNoVideoSource = !isCameraOn || 
                          (localStream && 
                          typeof localStream.getVideoTracks === 'function' && 
                          localStream.getVideoTracks().length === 0);
    
    // Save existing audio tracks before screen sharing
    let existingAudioTracks = [];
    if (localStream && typeof localStream.getAudioTracks === 'function') {
      existingAudioTracks = localStream.getAudioTracks()
        .filter(track => track.readyState === 'live')
        .map(track => track.clone()); // Clone to ensure they stay live
    }
    
    // Save current microphone state before making changes
    const savedMicState = preserveAudioState();
    console.log(`Saving mic state before screen sharing: ${savedMicState ? 'enabled' : 'disabled'}`);
    
    // Get the screen sharing stream
    screenStream = await navigator.mediaDevices.getDisplayMedia({ 
      video: true
    });
    
    // Save previous stream to restore later
    const previousStream = localStream;
    
    // Create a new MediaStream that will contain both screen video and audio from microphone
    const combinedStream = new MediaStream();
    
    // Add the screen video track to the combined stream
    const screenVideoTrack = screenStream.getVideoTracks()[0];
    combinedStream.addTrack(screenVideoTrack);
    
    // First try to use our existing audio tracks
    let audioAdded = false;
    if (existingAudioTracks.length > 0) {
      // Use existing audio tracks that are still live
      existingAudioTracks.filter(track => track.readyState === 'live').forEach(track => {
        console.log('Preserving existing audio track during screen sharing:', track.label);
        combinedStream.addTrack(track);
        audioAdded = true;
      });
    } 
    
    // If no existing audio tracks worked, try the persistent audio stream
    if (!audioAdded && window.persistentAudioStream) {
      const persistentTracks = window.persistentAudioStream.getAudioTracks();
      if (persistentTracks.length > 0 && persistentTracks[0].readyState === 'live') {
        console.log('Using persistent audio track during screen sharing:', persistentTracks[0].label);
        combinedStream.addTrack(persistentTracks[0]);
        audioAdded = true;
      }
    }
    
    // If still no audio, get a fresh track
    if (!audioAdded) {
      try {
        const audioTrack = await getFreshAudioTrack();
        if (audioTrack) {
          console.log('Adding fresh audio track during screen sharing:', audioTrack.label);
          combinedStream.addTrack(audioTrack);
          audioAdded = true;
        }
      } catch (err) {
        console.error('Could not get fresh audio for screen sharing:', err);
      }
    }
    
    // Replace local stream with the combined stream
    localStream = combinedStream;
    
    // Apply saved audio state to new stream
    // Important: Force audio to be enabled during screen sharing
    if (isHost) {
      // For host, explicitly ensure audio is enabled regardless of previous state
      // This ensures participants can hear the host during screensharing
      window.savedMicState = true;
      isMicOn = true;
      console.log('Host screen sharing: Ensuring microphone is enabled for participants');
    }
    applyAudioState(localStream);
    
    // Double-check that audio tracks are properly enabled
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length > 0) {
      audioTracks.forEach(track => {
        if (isHost) {
          // Force host audio on during screen sharing
          track.enabled = true;
          console.log(`Host screen sharing: Forcing audio track ${track.label} enabled=true`);
        } else {
          track.enabled = isMicOn;
          console.log(`Screen sharing: Setting audio track ${track.label} enabled=${isMicOn}`);
        }
      });
    }
    
    // Update local video element with the screen sharing stream
    localVideo.srcObject = localStream;
    
    // Remove any "no video" placeholder from local video
    const localPlaceholder = document.querySelector('#localVideoContainer .no-video-placeholder');
    if (localPlaceholder) {
      localPlaceholder.remove();
    }
    
    // If we're currently pinned in the main view, update the main video
    if (pinnedParticipant === currentUserID || pinnedParticipant === 'local') {
      updateMainVideo(currentUserID);
      
      // Remove any "no video" placeholder from main video
      const mainPlaceholder = document.querySelector('#mainVideoContainer .no-video-placeholder');
      if (mainPlaceholder) {
        mainPlaceholder.remove();
      }
    }
    
    // Always show screen sharing in main video for the host
    if (isHost) {
      updateMainVideo(currentUserID);
      mainVideoLabel.textContent = 'Your Shared Screen';
      
      // Remove any "no video" placeholder from main video
      const mainPlaceholder = document.querySelector('#mainVideoContainer .no-video-placeholder');
      if (mainPlaceholder) {
        mainPlaceholder.remove();
      }
    }
    
    // Update all existing connections with the new stream
    broadcastMediaToAllConnections();
    
    // Update UI
    isSharingScreen = true;
    activeMediaBtn = 'screen';
    
    // Change button colors to indicate active state
    shareScreenBtn.classList.remove('btn-secondary');
    shareScreenBtn.classList.add('btn-primary');
    
    shareScreenBtn.classList.add('hidden');
    stopShareBtn.classList.remove('hidden');
    
    // Update microphone UI to match actual state
    if (isHost) {
      // Force update UI to show mic is on
      updateMicrophoneUI(true);
    }
    
    updateStatus('Screen sharing active with audio from microphone');
    
    // Handle the user ending the screen share
    screenVideoTrack.addEventListener('ended', () => {
      stopSharing(previousStream, hasNoVideoSource);
    });
    
    // Notify the server that we're screen sharing
    socket.emit('screen-sharing-started', {
      roomId: roomId,
      userId: currentUserID,
      isSharing: true
    });
    
  } catch (error) {
    console.error('Error sharing screen:', error);
    updateStatus('Screen sharing failed', true);
    
    if (error.name === 'NotAllowedError') {
      showError('Screen sharing permission denied. Please try again and click "Share" in the browser dialog.');
    } else {
      showError(`Could not share screen: ${error.message}`);
    }
  }
}

// Function to stop sharing
async function stopSharing(previousStream, wasNoVideoMode = false) {
  try {
    // Save mic state before transitioning
    const savedMicState = preserveAudioState();
    
    // If we're the host, respect the savedMicState instead of forcing it on
    if (isHost) {
      window.savedMicState = savedMicState;
      isMicOn = savedMicState;
      console.log('Host stopping screen share: Preserving current microphone state:', savedMicState);
    }
    
    // Get all audio tracks that we want to preserve
    let audioTracksToPreserve = [];
    
    // First try from current stream
    if (localStream && typeof localStream.getAudioTracks === 'function') {
      audioTracksToPreserve = localStream.getAudioTracks().filter(track => track.readyState === 'live');
    }
    
    // If no live tracks, try persistent audio stream
    if (audioTracksToPreserve.length === 0 && window.persistentAudioStream) {
      audioTracksToPreserve = window.persistentAudioStream.getAudioTracks().filter(track => track.readyState === 'live');
    }
    
    // If still no tracks, we'll get new ones later
    
    // Stop all video tracks in the screen sharing stream
    if (localStream && isSharingScreen && typeof localStream.getVideoTracks === 'function') {
      // Only stop video tracks, don't touch audio tracks
      localStream.getVideoTracks().forEach(track => {
        track.stop();
      });
    }
    
    // ... [keep rest of function the same]
    
    // At the end of the function, after all other operations, make sure to reset the UI state
    // Update UI
    isSharingScreen = false;
    
    // Reset button colors and visibility
    shareScreenBtn.classList.remove('btn-primary');
    shareScreenBtn.classList.add('btn-secondary');
    shareScreenBtn.classList.remove('hidden');
    stopShareBtn.classList.add('hidden');
    
    // Reset activeMediaBtn to ensure screen sharing button works again
    if (localStream && typeof localStream.getVideoTracks === 'function' && 
        localStream.getVideoTracks().length > 0 && 
        localStream.getVideoTracks()[0].enabled) {
      activeMediaBtn = 'camera';
    } else {
      activeMediaBtn = 'none';
    }
    
    // Notify other participants that screen sharing has stopped
    socket.emit('screen-sharing-stopped', {
      roomId: roomId,
      userId: currentUserID
    });
    
    updateStatus('Screen sharing stopped');
  } catch (error) {
    console.error('Error stopping screen share:', error);
    showError(`Could not revert to camera: ${error.message}`);
    
    // Still reset the screen sharing UI state even if there was an error
    isSharingScreen = false;
    shareScreenBtn.classList.remove('btn-primary');
    shareScreenBtn.classList.add('btn-secondary');
    shareScreenBtn.classList.remove('hidden');
    stopShareBtn.classList.add('hidden');
    
    // Still notify others that screen sharing stopped, even on error
    socket.emit('screen-sharing-stopped', {
      roomId: roomId,
      userId: currentUserID
    });
  }
}

// Generate a random room ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 7);
}

// Set up WebRTC peer connection with detailed logging and error handling
async function setupPeerConnection() {
  try {
    // Initialize peerConnections object if not already done
    if (!peerConnections) {
      peerConnections = {};
    }
    
    // Set up socket event handlers
    setupSocketEvents();
    
    // Create a local peer connection only if we have one
    if (roomId) {
      updateStatus('Peer connection setup complete');
    }
    
  } catch (error) {
    console.error('Error setting up peer connection:', error);
    updateStatus('Connection setup failed: ' + error.message, true);
    showError(`WebRTC setup failed: ${error.message}`);
  }
}

// Set up socket.io event handlers
function setupSocketEvents() {
  // Clean up any existing listeners
  socket.off('room-joined');
  socket.off('user-joined');
  socket.off('user-left');
  socket.off('host-changed');
  socket.off('user-updated');
  socket.off('offer');
  socket.off('answer');
  socket.off('ice-candidate');
  socket.off('screen-sharing-started');  // Add new event
  socket.off('screen-sharing-stopped');  // Add new event
  
  // Room joined handler
  socket.on('room-joined', async (data) => {
    console.log('Joined room:', data);
    
    // Save our ID
    currentUserID = data.you;
    
    // Clear existing UI and participants
    clearParticipantsUI();
    participants = {}; // Reset participants list completely
    
    // Set host status
    isHost = data.hostId === currentUserID;
    
    // First add ourselves to the participants with a clear name that includes role
    participants[currentUserID] = {
      id: currentUserID,
      name: isHost ? 'You (Host)' : 'You',
      isHost: isHost,
      joinedAt: new Date()
    };
    
    // Now add other participants
    data.participants.forEach(participant => {
      // Skip ourselves since we already added our info
      if (participant.id === currentUserID) return;
      
      // Add other participants
      participants[participant.id] = participant;
    });
    
    console.log('Parsed participants:', Object.keys(participants).map(id => {
      const p = participants[id];
      return `${p.name}${p.isHost ? ' (Host)' : ''} [${p.id}]`;
    }));
    
    // Create peer connections to all existing participants (excluding ourselves)
    for (const participant of data.participants) {
      // Skip creating connection to ourselves
      if (participant.id === currentUserID) continue;
      
      console.log(`Creating peer connection to ${participant.id}`);
      await createPeerConnection(participant.id);
      
      // Host always initiates connections to participants
      if (isHost) {
        console.log(`Host initiating connection to ${participant.id}`);
        createAndSendOffer(participant.id);
      }
      // Non-host users only initiate connection to non-host users with higher IDs
      else if (!participant.isHost && participant.id > currentUserID) {
        console.log(`Participant ${currentUserID} initiating connection to ${participant.id}`);
        createAndSendOffer(participant.id);
      }
    }
    
    console.log('Final participants list:', participants);
    
    // Update UI
    updateParticipantsUI();
    
    // Always update local video label to reflect host status
    const localLabel = document.querySelector('#localVideoContainer .video-label');
    if (localLabel) {
      localLabel.textContent = isHost ? 'You (Host)' : 'You';
    }
    
    // If we're the host, set our container as the main video
    if (isHost) {
      moveParticipantToMainView(currentUserID);
      
      // Ensure our media is broadcast to all participants
      setTimeout(() => {
        console.log('Host broadcasting media to all participants...');
        broadcastMediaToAllConnections();
      }, 1000); // Short delay to ensure connections are established
    } else {
      // If not host, find who the host is and set their container as the main video
      const hostParticipant = Object.values(participants).find(p => p.isHost && p.id !== currentUserID);
      if (hostParticipant) {
        pinnedParticipant = null; // Default to showing host
        moveParticipantToMainView(hostParticipant.id);
      } else {
        // No host found, show our own video
        moveParticipantToMainView(currentUserID);
      }
    }
  });
  
  // User joined handler
  socket.on('user-joined', async (data) => {
    console.log('User joined:', data);
    
    // Skip adding ourselves (shouldn't happen, but just in case)
    if (data.userId === currentUserID) {
      console.warn('Received user-joined event for ourselves, ignoring');
      return;
    }
    
    // Add to participants
    participants[data.userId] = {
      id: data.userId,
      name: data.name,
      isHost: data.isHost,
      joinedAt: new Date()
    };
    
    // Create new peer connection
    await createPeerConnection(data.userId);
    
    // Follow the same pattern as in room-joined:
    // Host always initiates connections
    if (isHost) {
      console.log(`Host initiating connection to new participant ${data.userId}`);
      createAndSendOffer(data.userId);
      
      // After a short delay, broadcast our media to the new participant
      setTimeout(() => {
        console.log(`Host broadcasting media to new participant ${data.userId}...`);
        
        // If we have a direct function to send to just one peer, use it
        if (localStream && peerConnections[data.userId]) {
          const pc = peerConnections[data.userId];
          const tracks = localStream.getTracks();
          const senders = pc.getSenders();
          
          tracks.forEach(track => {
            // Check if a sender for this kind of track already exists
            const trackKind = track.kind;
            const existingSender = senders.find(sender => 
              sender.track && sender.track.kind === trackKind
            );
            
            if (existingSender) {
              // If a sender already exists, replace the track
              console.log(`Replacing existing ${trackKind} track for new participant ${data.userId}`);
              try {
                existingSender.replaceTrack(track).catch(err => {
                  console.error(`Error replacing ${trackKind} track:`, err);
                });
              } catch (err) {
                console.error(`Exception replacing ${trackKind} track:`, err);
              }
            } else {
              // Otherwise add as a new track
              try {
                console.log(`Adding ${trackKind} track to connection with new participant ${data.userId}`);
                pc.addTrack(track, localStream);
              } catch (err) {
                console.error(`Error adding ${trackKind} track:`, err);
                // If adding failed, try to find and reuse any inactive senders
                const inactiveSenders = senders.filter(sender => !sender.track || sender.track.readyState === 'ended');
                if (inactiveSenders.length > 0) {
                  console.log(`Trying to reuse inactive sender for ${trackKind}`);
                  inactiveSenders[0].replaceTrack(track).catch(err => {
                    console.error(`Failed to reuse sender for ${trackKind}:`, err);
                  });
                }
              }
            }
          });
          
          // Renegotiate after adding tracks
          renegotiateConnection(data.userId);
        } else {
          // Otherwise broadcast to all 
          broadcastMediaToAllConnections();
        }
      }, 1000);
    }
    // Non-hosts only initiate to non-host users with higher IDs
    else if (!data.isHost && data.userId > currentUserID) {
      console.log(`Participant ${currentUserID} initiating connection to new participant ${data.userId}`);
      createAndSendOffer(data.userId);
    }
    
    // Update UI
    updateParticipantsUI();
    
    // If the new user is the host and we're not, set them as the main video
    if (data.isHost && !isHost) {
      // Set the host as the main video once their stream is received
      // We'll do this when we receive their media stream in the ontrack event
      console.log(`New participant ${data.userId} is the host, will set as main video when stream received`);
    }
    
    updateStatus(`${data.name} joined the room`);
  });
  
  // User left handler
  socket.on('user-left', (data) => {
    console.log('User left:', data);
    
    // Clear any disconnection timer for this user
    if (disconnectionTimers[data.userId]) {
      clearTimeout(disconnectionTimers[data.userId]);
      delete disconnectionTimers[data.userId];
    }
    
    // Clean up peer connection
    if (peerConnections[data.userId]) {
      peerConnections[data.userId].close();
      delete peerConnections[data.userId];
    }
    
    // Remove participant
    const participantName = participants[data.userId]?.name || 'Someone';
    delete participants[data.userId];
    
    // Check if we need to update the main video
    if (pinnedParticipant === data.userId) {
      // Reset pinned participant if they left
      pinnedParticipant = null;
      
      // Find the host or the first participant
      const newMainUser = Object.values(participants).find(p => p.isHost) 
                         || Object.values(participants)[0];
      
      if (newMainUser) {
        setMainVideo(newMainUser.id);
      } else {
        // If no other participants, clear main video
        mainVideo.srcObject = null;
        mainVideo.poster = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="%23444"/><text x="320" y="240" font-family="Arial" font-size="30" text-anchor="middle" fill="white">No participants</text></svg>';
        mainVideoLabel.textContent = 'Waiting for participants';
      }
    }
    
    // Explicitly remove the participant's video element from the DOM
    const participantEl = document.getElementById(`participant-${data.userId}`);
    if (participantEl) {
      participantEl.remove();
    }
    
    // Update UI
    updateParticipantsUI();
    
    updateStatus(`${participantName} left the room`);
  });
  
  // Host changed handler
  socket.on('host-changed', (data) => {
    console.log('Host changed:', data);
    
    // Update host status
    if (currentUserID === data.newHostId) {
      isHost = true;
      updateStatus('You are now the host');
      
      // Update our own participant info
      if (participants[currentUserID]) {
        participants[currentUserID].isHost = true;
        participants[currentUserID].name = 'You (Host)';
      }
      
      // Update local video label
      const localLabel = document.querySelector('#localVideoContainer .video-label');
      if (localLabel) {
        localLabel.textContent = 'You (Host)';
      }
      
      // Hide local video container since we're the host now
      const localContainer = document.getElementById('localVideoContainer');
      if (localContainer) {
        localContainer.style.display = 'none';
      }
      
      // Set our stream as the main video
      setMainVideo(currentUserID);
    }
    
    // Update participants data
    if (participants[data.previousHostId]) {
      participants[data.previousHostId].isHost = false;
      
      // If this was us, update our display name and show our local video
      if (data.previousHostId === currentUserID) {
        participants[currentUserID].name = 'You';
        
        // Show local video container since we're no longer the host
        const localContainer = document.getElementById('localVideoContainer');
        if (localContainer) {
          localContainer.style.display = 'block';
        }
      }
    }
    
    if (participants[data.newHostId] && data.newHostId !== currentUserID) {
      participants[data.newHostId].isHost = true;
    }
    
    // Update UI
    updateParticipantsUI();
    
    // Set the new host as main video if nothing is pinned
    if (!pinnedParticipant) {
      setMainVideo(data.newHostId);
    }
  });
  
  // User updated handler
  socket.on('user-updated', (data) => {
    console.log('User updated:', data);
    
    // Update participant data
    if (participants[data.userId]) {
      participants[data.userId].name = data.name;
      participants[data.userId].isHost = data.isHost;
    }
    
    // Update UI
    updateParticipantsUI();
  });
  
  // Signaling handlers
  socket.on('offer', async (data) => {
    console.log('Received offer from:', data.senderId);
    await handleOffer(data);
  });
  
  socket.on('answer', (data) => {
    console.log('Received answer from:', data.senderId);
    handleAnswer(data);
  });
  
  socket.on('ice-candidate', (data) => {
    console.log('Received ICE candidate from:', data.senderId);
    handleNewICECandidate(data);
  });
  
  // NEW: Screen sharing started event handler
  socket.on('screen-sharing-started', (data) => {
    console.log('Screen sharing started by user:', data.userId);
    
    // If we're the host or someone else in the room (but not the sharer)
    if (data.userId !== currentUserID) {
      // Automatically pin the screen sharing user
      setMainVideo(data.userId);
      
      // Update the main video label to indicate screen sharing
      const participant = participants[data.userId];
      if (participant) {
        const name = participant.isHost ? `${participant.name} (Host)` : participant.name;
        mainVideoLabel.textContent = `${name} - Screen Share`;
      }
      
      // Show toast notification
      const toastEl = document.createElement('div');
      toastEl.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 bg-dark text-white py-2 px-4 rounded-lg shadow-lg z-50 animate-fade-in';
      toastEl.textContent = `${participants[data.userId]?.name || 'Someone'} started screen sharing`;
      document.body.appendChild(toastEl);
      
      // Remove after 3 seconds
      setTimeout(() => {
        toastEl.classList.add('animate-fade-out');
        setTimeout(() => toastEl.remove(), 500);
      }, 3000);
    }
  });
  
  // NEW: Screen sharing stopped event handler
  socket.on('screen-sharing-stopped', (data) => {
    console.log('Screen sharing stopped by user:', data.userId);
    
    // If the screen sharer was pinned, reset to default view (usually the host)
    if (pinnedParticipant === data.userId) {
      // Look for the host to pin as default
      const hostParticipant = Object.values(participants).find(p => p.isHost);
      if (hostParticipant) {
        setMainVideo(hostParticipant.id);
      }
    }
    
    // Update UI elements if needed
    if (data.userId !== currentUserID) {
      // Show toast notification
      const toastEl = document.createElement('div');
      toastEl.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 bg-dark text-white py-2 px-4 rounded-lg shadow-lg z-50 animate-fade-in';
      toastEl.textContent = `${participants[data.userId]?.name || 'Someone'} stopped screen sharing`;
      document.body.appendChild(toastEl);
      
      // Remove after 3 seconds
      setTimeout(() => {
        toastEl.classList.add('animate-fade-out');
        setTimeout(() => toastEl.remove(), 500);
      }, 3000);
    }
  });
}

// Create a peer connection to a specific user
async function createPeerConnection(userId) {
  // Close existing connection if it exists
  if (peerConnections[userId]) {
    peerConnections[userId].close();
  }
  
  try {
    // Create new peer connection
    const peerConnection = new RTCPeerConnection(configuration);
    console.log(`Created peer connection to ${userId} with config:`, configuration);
    
    // Fix for SSL role conflict in mesh topology
    // Set DTLS role explicitly based on whether we're host or not
    if (peerConnection.getSenders) {
      const transceivers = peerConnection.getTransceivers();
      if (transceivers.length > 0 && transceivers[0].sender && transceivers[0].sender.dtmf) {
        const dtlsTransport = transceivers[0].sender.transport;
        if (dtlsTransport && dtlsTransport.getLocalParameters) {
          const params = dtlsTransport.getLocalParameters();
          // Set role based on our position in the mesh
          params.role = isHost ? 'server' : 'client';
        }
      }
    }
    
    // ICE candidate handler
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`Generated ICE candidate for ${userId}:`, event.candidate.sdpMid);
        socket.emit('ice-candidate', {
          roomId,
          targetUserId: userId,
          candidate: event.candidate
        });
      }
    };
    
    // Connection state change handler
    peerConnection.oniceconnectionstatechange = () => {
      const state = peerConnection.iceConnectionState;
      console.log(`ICE connection state changed to ${state} for ${userId}`);
      
      // Update participant UI based on connection state
      const participantEl = document.getElementById(`participant-${userId}`);
      if (participantEl) {
        if (state === 'connected' || state === 'completed') {
          participantEl.classList.remove('disconnected');
          
          // Clear any existing disconnection timer for this user
          if (disconnectionTimers[userId]) {
            console.log(`Clearing disconnection timer for ${userId} as connection is restored`);
            clearTimeout(disconnectionTimers[userId]);
            delete disconnectionTimers[userId];
          }
        } else if (state === 'failed' || state === 'disconnected') {
          participantEl.classList.add('disconnected');
          
          // Start a timer to remove the participant if they don't reconnect
          if (!disconnectionTimers[userId]) {
            console.log(`Starting disconnection timer for ${userId}`);
            disconnectionTimers[userId] = setTimeout(() => {
              console.log(`Disconnection timer expired for ${userId}, removing participant`);
              
              // Check if participant is still in disconnected state
              const currentState = peerConnections[userId]?.iceConnectionState;
              if (currentState === 'failed' || currentState === 'disconnected' || currentState === 'closed') {
                // Get participant name before removing
                const participantName = participants[userId]?.name || 'Participant';
                
                // Clean up the participant - similar to user-left handler
                if (peerConnections[userId]) {
                  peerConnections[userId].close();
                  delete peerConnections[userId];
                }
                
                // Remove participant from tracking
                delete participants[userId];
                
                // Check if we need to update the main video
                if (pinnedParticipant === userId) {
                  // Reset pinned participant if they left
                  pinnedParticipant = null;
                  
                  // Find the host or the first participant
                  const newMainUser = Object.values(participants).find(p => p.isHost) 
                                     || Object.values(participants)[0];
                  
                  if (newMainUser) {
                    setMainVideo(newMainUser.id);
                  } else {
                    // If no other participants, clear main video
                    mainVideo.srcObject = null;
                    mainVideo.poster = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="%23444"/><text x="320" y="240" font-family="Arial" font-size="30" text-anchor="middle" fill="white">No participants</text></svg>';
                    mainVideoLabel.textContent = 'Waiting for participants';
                  }
                }
                
                // Remove from UI
                const participantEl = document.getElementById(`participant-${userId}`);
                if (participantEl) {
                  participantEl.remove();
                }
                
                // Show status message
                updateStatus(`${participantName} was disconnected and removed from the meeting`);
                
                // Clean up disconnection timer
                delete disconnectionTimers[userId];
                
                // Update UI
                updateParticipantsUI();
              }
            }, 15000); // 15 seconds timeout to confirm disconnection
          }
        }
      }
    };
    
    // Also track connection state changes for more immediate detection
    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      console.log(`Connection state changed to ${state} for ${userId}`);
      
      if (state === 'connected') {
        // Clear any disconnection timer as we're connected
        if (disconnectionTimers[userId]) {
          console.log(`Clearing disconnection timer for ${userId} due to connected state`);
          clearTimeout(disconnectionTimers[userId]);
          delete disconnectionTimers[userId];
        }
        
        // Make sure participant element is visible and properly styled
        const participantEl = document.getElementById(`participant-${userId}`);
        if (participantEl) {
          participantEl.classList.remove('disconnected');
          participantEl.style.opacity = '1';
        }
      } else if (state === 'failed' || state === 'closed') {
        // Immediate cleanup for definitively closed connections
        // We won't wait for a timer in this case
        console.log(`Connection ${state} for ${userId}, cleaning up immediately`);
        
        // Clear any existing timer first
        if (disconnectionTimers[userId]) {
          clearTimeout(disconnectionTimers[userId]);
          delete disconnectionTimers[userId];
        }
        
        // Get participant name before removing
        const participantName = participants[userId]?.name || 'Participant';
        
        // Clean up connection
        if (peerConnections[userId]) {
          peerConnections[userId].close();
          delete peerConnections[userId];
        }
        
        // Remove participant from tracking
        delete participants[userId];
        
        // Check if we need to update the main video
        if (pinnedParticipant === userId) {
          // Reset pinned participant
          pinnedParticipant = null;
          
          // Find the host or the first participant
          const newMainUser = Object.values(participants).find(p => p.isHost) 
                             || Object.values(participants)[0];
          
          if (newMainUser) {
            setMainVideo(newMainUser.id);
          } else {
            // If no other participants, clear main video
            mainVideo.srcObject = null;
            mainVideo.poster = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="%23444"/><text x="320" y="240" font-family="Arial" font-size="30" text-anchor="middle" fill="white">No participants</text></svg>';
            mainVideoLabel.textContent = 'Waiting for participants';
          }
        }
        
        // Explicitly remove from UI
        const participantEl = document.getElementById(`participant-${userId}`);
        if (participantEl) {
          console.log(`Removing participant element for ${userId}`);
          participantEl.remove();
        }
        
        // Show status message
        updateStatus(`${participantName} disconnected from the meeting`);
        
        // Update UI to ensure everything is in sync
        updateParticipantsUI();
      } else if (state === 'disconnected') {
        // Participant temporarily disconnected - add visual indication
        const participantEl = document.getElementById(`participant-${userId}`);
        if (participantEl) {
          participantEl.classList.add('disconnected');
          
          // Add timer for potential permanent disconnection
          if (!disconnectionTimers[userId]) {
            console.log(`Starting disconnection timer for ${userId}`);
            disconnectionTimers[userId] = setTimeout(() => {
              console.log(`Disconnection timer expired for ${userId}, removing participant`);
              
              // Check if participant is still in disconnected state
              const currentState = peerConnections[userId]?.connectionState;
              if (currentState === 'disconnected' || currentState === 'failed' || currentState === 'closed') {
                // Clean up as if fully disconnected
                
                // Get participant name before removing
                const participantName = participants[userId]?.name || 'Participant';
                
                // Clean up connection
                if (peerConnections[userId]) {
                  peerConnections[userId].close();
                  delete peerConnections[userId];
                }
                
                // Remove participant from tracking
                delete participants[userId];
                
                // Check if we need to update the main video
                if (pinnedParticipant === userId) {
                  // Reset pinned participant
                  pinnedParticipant = null;
                  
                  // Find the host or the first participant
                  const newMainUser = Object.values(participants).find(p => p.isHost) 
                                    || Object.values(participants)[0];
                  
                  if (newMainUser) {
                    setMainVideo(newMainUser.id);
                  } else {
                    // If no other participants, clear main video
                    mainVideo.srcObject = null;
                    mainVideo.poster = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="%23444"/><text x="320" y="240" font-family="Arial" font-size="30" text-anchor="middle" fill="white">No participants</text></svg>';
                    mainVideoLabel.textContent = 'Waiting for participants';
                  }
                }
                
                // Explicitly remove from UI
                const participantEl = document.getElementById(`participant-${userId}`);
                if (participantEl) {
                  console.log(`Removing participant element for ${userId} after timeout`);
                  participantEl.remove();
                }
                
                // Show status message
                updateStatus(`${participantName} was disconnected and removed from the meeting`);
                
                // Clean up disconnection timer
                delete disconnectionTimers[userId];
                
                // Update UI
                updateParticipantsUI();
              }
            }, 15000); // 15 seconds timeout to confirm disconnection
          }
        }
      }
    };
    
    // Remote track handler - enhance for mobile
    peerConnection.ontrack = (event) => {
      console.log(`Received remote track from ${userId}:`, event.track.kind);
      
      // Log audio track details
      if (event.track.kind === 'audio') {
        console.log(`Processing audio track from ${userId}`, event.track);
        // Ensure the track is enabled and not muted
        event.track.enabled = true;
        
        // If audio appears to be inactive, log a warning
        if (event.track.muted) {
          console.warn(`Received muted audio track from ${userId}, attempting to unmute`);
          // Try to unmute if possible (browser may still enforce muting)
          try {
            event.track.muted = false;
          } catch (err) {
            console.error('Could not unmute track:', err);
          }
        }
        
        // Special handling for host audio to ensure it's heard
        if (participants[userId]?.isHost) {
          console.log(`Received HOST audio track from ${userId}, ensuring it's audible`);
          
          // If this is the host's audio track and we're not the host, prioritize it
          if (!isHost) {
            // Create an audio element specifically for the host's audio
            // This provides a fallback path for audio playback
            let hostAudioEl = document.getElementById('host-audio');
            if (!hostAudioEl) {
              hostAudioEl = document.createElement('audio');
              hostAudioEl.id = 'host-audio';
              hostAudioEl.autoplay = true;
              hostAudioEl.controls = false; // hidden controls
              hostAudioEl.volume = 1.0;
              document.body.appendChild(hostAudioEl);
            }
            
            // Create a new stream with just this audio track
            const hostAudioStream = new MediaStream([event.track]);
            hostAudioEl.srcObject = hostAudioStream;
          }
        }
      }
      
      // Check if this is from the host
      const isFromHost = participants[userId]?.isHost || false;
      
      // Save track in global ref for debugging and access from other functions
      if (event.streams && event.streams.length > 0) {
        // Save the stream globally with participant ID for reference
        window[`stream_${userId}`] = event.streams[0];
        console.log(`Saved stream for ${userId} with track type: ${event.track.kind}`);
        
        // For host streams, also save to a dedicated variable for easier access
        if (isFromHost) {
          window.hostStream = event.streams[0];
          console.log('Saved host stream to window.hostStream');
        }
      }
      
      // Find or create video element for this participant
      let participantVideo = document.getElementById(`video-${userId}`);
      let participantContainer = document.getElementById(`participant-${userId}`);
      
      if (!participantContainer) {
        // Create participant video element if it doesn't exist
        const participantEl = createParticipantVideoElement(userId);
        
        if (participantEl) {
          participantsGrid.appendChild(participantEl);
          participantContainer = participantEl;
          participantVideo = document.getElementById(`video-${userId}`);
        }
      }
      
      // Set the remote stream to the video element
      if (participantVideo && event.streams && event.streams.length > 0) {
        console.log(`Setting stream for participant ${userId} video element`);
        participantVideo.srcObject = event.streams[0];
        
        // Special handling for mobile devices
        if (isMobileDevice()) {
          // Ensure playback begins immediately - but don't add unnecessary play button
          participantVideo.play().catch(err => {
            console.warn(`Auto-play failed for ${userId} video:`, err);
          });
          
          // Set important properties for mobile video
          participantVideo.setAttribute('playsinline', 'playsinline');
          participantVideo.setAttribute('webkit-playsinline', 'webkit-playsinline');
          participantVideo.muted = false;
          
          // Force video to remain visible
          participantVideo.style.display = 'block';
          participantVideo.style.opacity = '1';
          
          // Add a class to help with CSS targeting
          participantVideo.classList.add('mobile-optimized-video');
        }
        
        // FIXED: Ensure audio is properly configured for remote participants
        // Only mute if this is the pinned participant (to prevent echo) or if it's our own video
        if (userId === currentUserID) {
          // Always mute our own video to prevent feedback
          participantVideo.muted = true;
        } else if (pinnedParticipant === userId) {
          // If this is the pinned participant, mute the grid copy to prevent echo
          // since the main video will play their audio
          participantVideo.muted = true;
          console.log(`Muting grid video for pinned participant ${userId} to prevent echo`);
        } else {
          // For all other participants, ensure audio is enabled
          participantVideo.muted = false;
          participantVideo.volume = 1.0;
          console.log(`Ensuring audio is enabled for participant ${userId}`);
        }
      }
      
      // Now that the stream is set up, determine if we should show in main view
      if (isFromHost && !isHost && pinnedParticipant === null) {
        // If this is the host and we're not pinning anyone else, show host in main view
        console.log('Moving host to main view');
        updateMainVideo(userId);
      } else if (pinnedParticipant === userId) {
        // If this participant is specifically pinned, show in main view
        console.log(`Moving pinned participant ${userId} to main view`);
        updateMainVideo(userId);
      }
      
      updateStatus('Received participant media stream');
    };
    
    // Add local tracks to the connection if we have them
    if (localStream) {
      const tracks = localStream.getTracks();
      
      if (tracks.length > 0) {
        tracks.forEach(track => {
          try {
            // Check if we already have a sender for this kind of track
            const senders = peerConnection.getSenders();
            const existingSender = senders.find(sender => 
              sender.track && sender.track.kind === track.kind
            );
            
            if (existingSender) {
              console.log(`Replacing existing ${track.kind} track in connection with ${userId}`);
              existingSender.replaceTrack(track);
            } else {
              console.log(`Adding new ${track.kind} track to connection with ${userId}`);
              peerConnection.addTrack(track, localStream);
            }
          } catch (err) {
            console.error(`Error adding ${track.kind} track to peer connection:`, err);
            // Fall back to simple add
            peerConnection.addTrack(track, localStream);
          }
        });
      } else {
        console.log('No local tracks available to add to peer connection');
        
        // Create a data channel as a fallback to establish the connection
        try {
          const dataChannel = peerConnection.createDataChannel('text');
          console.log('Created data channel as fallback for connection');
        } catch (err) {
          console.error('Could not create data channel:', err);
        }
      }
    }
    
    // Store the connection
    peerConnections[userId] = peerConnection;
    return peerConnection;
    
  } catch (error) {
    console.error(`Error setting up peer connection to ${userId}:`, error);
    updateStatus(`Connection to participant failed: ${error.message}`, true);
    showError(`WebRTC setup failed: ${error.message}`);
    return null;
  }
}

// Create and send WebRTC offer to a specific user
async function createAndSendOffer(userId) {
  try {
    const peerConnection = peerConnections[userId];
    if (!peerConnection) {
      console.error(`No peer connection found for ${userId}`);
      return;
    }
    
    console.log(`Creating offer for ${userId}`);
    
    // Set offer options to help prevent role conflicts
    const offerOptions = {
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
      voiceActivityDetection: false,
      iceRestart: peerConnection.iceConnectionState === 'failed'
    };
    
    const offer = await peerConnection.createOffer(offerOptions);
    
    // Important: When creating an offer, we MUST use actpass
    // This is the error we're encountering: "Offerer must use actpass value for setup attribute"
    let sdpModified = offer.sdp;
    
    // Ensure all media sections use actpass setup attribute
    // This is critical for WebRTC compatibility
    sdpModified = sdpModified.replace(/a=setup:(active|passive)/g, 'a=setup:actpass');
    
    // Update the offer with modified SDP
    const modifiedOffer = new RTCSessionDescription({
      type: offer.type,
      sdp: sdpModified
    });
    
    console.log(`Setting local description for ${userId}`);
    await peerConnection.setLocalDescription(modifiedOffer);
    
    console.log(`Sending offer to ${userId}`);
    socket.emit('offer', {
      roomId,
      targetUserId: userId,
      sdp: peerConnection.localDescription
    });
  } catch (error) {
    console.error(`Error creating offer for ${userId}:`, error);
    updateStatus(`Failed to create offer: ${error.message}`, true);
    
    // If we failed with an SSL role error, try recreating the connection
    if (error.message && error.message.includes('SSL role')) {
      showError('SSL role conflict detected. Attempting to reconnect...');
      
      // Close the problematic connection
      if (peerConnections[userId]) {
        peerConnections[userId].close();
        delete peerConnections[userId];
      }
      
      // Wait briefly then try to establish a new connection
      setTimeout(async () => {
        await createPeerConnection(userId);
        createAndSendOffer(userId);
      }, 1000);
    }
  }
}

// Handle received WebRTC offer
async function handleOffer(data) {
  try {
    // Get the peer connection for this user
    let peerConnection = peerConnections[data.senderId];
    
    // If we don't have a peer connection, create one
    if (!peerConnection) {
      peerConnection = await createPeerConnection(data.senderId);
      if (!peerConnection) return; // Failed to create peer connection
    }
    
    // Check if this is a renegotiation
    const isRenegotiation = data.renegotiation;
    
    // When receiving an offer, we don't modify its setup attribute
    // Just use the SDP as provided by the remote peer
    console.log(`Setting remote description from ${data.senderId}${isRenegotiation ? ' (renegotiation)' : ''}`);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    
    console.log(`Creating answer for ${data.senderId}`);
    const answer = await peerConnection.createAnswer();
    
    // For answers, we can use 'active' for performance, but not required
    // Keep the SDP as-is to avoid compatibility issues
    console.log(`Setting local description for ${data.senderId}`);
    await peerConnection.setLocalDescription(answer);
    
    console.log(`Sending answer to ${data.senderId}`);
    socket.emit('answer', {
      roomId,
      targetUserId: data.senderId,
      sdp: peerConnection.localDescription,
      renegotiation: isRenegotiation
    });
    
    if (isRenegotiation) {
      updateStatus('Media stream updated by remote peer');
    }
  } catch (error) {
    console.error('Error handling offer:', error);
    updateStatus('Failed to handle offer: ' + error.message, true);
  }
}

// Handle received WebRTC answer
function handleAnswer(data) {
  try {
    // Get the peer connection for this user
    const peerConnection = peerConnections[data.senderId];
    if (!peerConnection) {
      console.error(`No peer connection found for ${data.senderId}`);
      return;
    }
    
    // Check if the connection is in a state where we can set remote description
    // Only proceed if connection is not stable (has a pending offer)
    if (peerConnection.signalingState === 'stable') {
      console.warn(`Connection for ${data.senderId} already in stable state, ignoring answer`);
      return;
    }
    
    console.log(`Setting remote description from ${data.senderId}`);
    peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp))
      .then(() => {
        if (data.renegotiation) {
          updateStatus('Media stream update acknowledged');
        } else {
          updateStatus(`Connection established with ${participants[data.senderId]?.name || 'remote peer'}`);
        }
      })
      .catch(error => {
        console.error('Error setting remote description:', error);
        
        // Special handling for SDP format errors
        if (error.message && (error.message.includes('SSL role') || error.message.includes('setup attribute'))) {
          console.warn('Detected SDP format issue, attempting recovery...');
          showError('Connection issue detected. Attempting to reconnect...');
          
          // Log the problematic SDP for debugging
          console.log('Problematic SDP:', data.sdp.sdp);
          
          // Close the problematic connection
          if (peerConnections[data.senderId]) {
            peerConnections[data.senderId].close();
            delete peerConnections[data.senderId];
          }
          
          // Wait briefly then try to establish a new connection
          setTimeout(async () => {
            // Create a new connection with the remote peer
            const newConnection = await createPeerConnection(data.senderId);
            if (newConnection) {
              // If we're the host or have the higher ID, we initiate the connection
              if (isHost || (!participants[data.senderId]?.isHost && currentUserID > data.senderId)) {
                console.log(`Reinitiating connection to ${data.senderId}`);
                createAndSendOffer(data.senderId);
              }
            }
          }, 1000);
        } else {
          updateStatus('Failed to handle answer: ' + error.message, true);
        }
      });
  } catch (error) {
    console.error('Error handling answer:', error);
    updateStatus('Failed to handle answer: ' + error.message, true);
  }
}

// Handle received ICE candidate
function handleNewICECandidate(data) {
  try {
    // Get the peer connection for this user
    const peerConnection = peerConnections[data.senderId];
    if (!peerConnection) {
      console.error(`No peer connection found for ${data.senderId}`);
      return;
    }
    
    peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
      .catch(error => {
        console.error('Error adding ICE candidate:', error);
      });
  } catch (error) {
    console.error('Error handling ICE candidate:', error);
  }
}

// Fix the createParticipantVideoElement function to always create host container for non-hosts
function createParticipantVideoElement(userId) {
  // If participant does not exist, skip
  if (!participants[userId]) {
    console.warn(`Cannot create video element for unknown participant: ${userId}`);
    return null;
  }
  
  // If this is the host and we are the host, don't create a separate element
  // as the host is shown in the main view
  if (participants[userId].isHost && isHost) {
    console.log(`Not creating a separate video element for host (ourselves)`);
    return null;
  }
  
  // Always create a container for all participants, including host
  console.log(`Creating video element for participant: ${userId}, isHost: ${participants[userId].isHost}`);
  
  // Create the video container
  const participantDiv = document.createElement('div');
  participantDiv.id = `participant-${userId}`;
  participantDiv.className = 'video-container h-video-thumb-mobile md:h-video-thumb';
  
  // If this is the host, add host-specific styling
  if (participants[userId].isHost) {
    participantDiv.classList.add('host-container');
  }
  
  // Create video element
  const video = document.createElement('video');
  video.id = `video-${userId}`;
  video.className = 'w-full h-full object-cover';
  video.autoplay = true;
  video.playsinline = true;
  participantDiv.appendChild(video);
  
  // Create the label
  const label = document.createElement('div');
  label.className = 'video-label';
  if (participants[userId].isHost) {
    label.classList.add('host-label');
  }
  
  label.textContent = participants[userId].isHost ? 
    `${participants[userId].name} (Host)` : participants[userId].name;
  participantDiv.appendChild(label);
  
  // Create pin button
  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'absolute top-2 right-2 flex gap-1 z-10';
  
  const pinBtn = document.createElement('button');
  pinBtn.className = 'participant-control pin-btn';
  pinBtn.title = pinnedParticipant === userId ? 'Unpin from main view' : 'Pin to main view';
  pinBtn.dataset.participantId = userId;
  
  if (pinnedParticipant === userId) {
    pinBtn.classList.add('active');
  }
  
  const pinIcon = document.createElement('i');
  pinIcon.className = 'fas fa-thumbtack';
  pinBtn.appendChild(pinIcon);
  
  // Add click handler to pin button with larger touch target for mobile
  pinBtn.style.touchAction = 'manipulation';
  pinBtn.style.WebkitTapHighlightColor = 'rgba(0,0,0,0)';
  
  // Ensure larger touch target size for mobile
  pinBtn.style.minWidth = '44px';
  pinBtn.style.minHeight = '44px';
  pinBtn.style.padding = '10px';
  pinBtn.style.zIndex = '50';
  
  // Add custom class for mobile styling
  if (isMobileDevice()) {
    pinBtn.classList.add('mobile-pin-btn');
  }
  
  pinBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    
    setMainVideo(userId);
  });
  
  controlsDiv.appendChild(pinBtn);
  participantDiv.appendChild(controlsDiv);
  
  // Make sure the container is visible
  participantDiv.style.display = 'block';
  
  return participantDiv;
}

// Clear participants UI
function clearParticipantsUI() {
  // Preserve local video container if it exists
  const localContainer = document.getElementById('localVideoContainer');
  if (localContainer) {
    // Temporarily remove to clear everything else
    if (localContainer.parentNode) {
      localContainer.parentNode.removeChild(localContainer);
    }
  }
  
  // Now clear everything in the grid
  while (participantsGrid.firstChild) {
    participantsGrid.removeChild(participantsGrid.firstChild);
  }
  
  // Re-add local video container first
  if (localContainer) {
    participantsGrid.appendChild(localContainer);
  }
  
  // Clear participants list
  participantsList.innerHTML = '';
}

// Modify updateParticipantsUI to properly show/hide host container based on pinned state
function updateParticipantsUI() {
  console.log('Updating participants UI. Current participants:', Object.keys(participants));
  
  // Update participants list panel
  participantsList.innerHTML = '';
  
  // Create a map of processed user IDs to prevent duplicates
  const processedUserIds = new Set();
  
  // Clean up any video containers for participants who are no longer in the meeting
  const participantElements = document.querySelectorAll('[id^="participant-"]');
  participantElements.forEach(element => {
    const elementUserId = element.id.replace('participant-', '');
    // Skip our own local container
    if (elementUserId === 'local') return;
    
    // If participant no longer exists, remove the element
    if (!participants[elementUserId]) {
      console.log(`Removing video container for departed participant: ${elementUserId}`);
      element.remove();
    }
  });
  
  // First, add ourselves to the participants list
  if (participants[currentUserID]) {
    const item = document.createElement('div');
    item.className = 'flex items-center p-2 border-b border-gray-200';
    
    const name = document.createElement('div');
    name.className = 'flex-grow';
    name.textContent = 'You';
    
    item.appendChild(name);
    
    if (isHost) {
      const hostBadge = document.createElement('span');
      hostBadge.className = 'ml-2 px-2 py-1 bg-primary text-white text-xs rounded';
      hostBadge.textContent = 'Host';
      name.appendChild(hostBadge);
    }
    
    participantsList.appendChild(item);
  }
  
  // Find the host (might be ourselves)
  const hostId = Object.values(participants).find(p => p.isHost)?.id;
  
  // Add all other participants to the list
  for (const userId in participants) {
    // Skip ourselves as we already added above
    if (userId === currentUserID) continue;
    
    const isUserHost = participants[userId].isHost;
    
    // Add to participants list in the panel
    const item = document.createElement('div');
    item.className = 'flex items-center p-2 border-b border-gray-200';
    
    const name = document.createElement('div');
    name.className = 'flex-grow';
    name.textContent = participants[userId].name;
    
    if (isUserHost) {
      const hostBadge = document.createElement('span');
      hostBadge.className = 'ml-2 px-2 py-1 bg-primary text-white text-xs rounded';
      hostBadge.textContent = 'Host';
      name.appendChild(hostBadge);
    }
    
    item.appendChild(name);
    participantsList.appendChild(item);
    
    // Create video container if it doesn't exist
    let participantDiv = document.getElementById(`participant-${userId}`);
    
    if (!participantDiv) {
      participantDiv = createParticipantVideoElement(userId);
      if (participantDiv) {
        participantsGrid.appendChild(participantDiv);
      }
    } else {
      // Update participant name/host status in case it changed
      const label = participantDiv.querySelector('.video-label');
      if (label) {
        label.textContent = isUserHost ? 
          `${participants[userId].name} (Host)` : participants[userId].name;
      }
      
      // Make sure the container is visible
      participantDiv.style.display = 'block';
    }
    
    // Mark as processed
    processedUserIds.add(userId);
  }
  
  // If there's a pinned participant, make sure main video shows them
  if (pinnedParticipant && participants[pinnedParticipant]) {
    // Update main video with the pinned participant's stream
    updateMainVideo(pinnedParticipant);
    
    // Find and add highlight to the pinned participant container
    const pinnedContainer = document.getElementById(`participant-${pinnedParticipant}`) || 
                            (pinnedParticipant === currentUserID ? document.getElementById('localVideoContainer') : null);
    
    if (pinnedContainer) {
      pinnedContainer.classList.add('pinned-participant');
    }
  } else if (hostId && !isHost) {
    // If no pinned participant, show host in main view (unless we are the host)
    updateMainVideo(hostId);
  } else if (isHost) {
    // If we are the host and no one is pinned, show ourselves
    updateMainVideo(currentUserID);
  } else if (Object.keys(participants).length > 0) {
    // Otherwise, show the first participant
    updateMainVideo(Object.keys(participants)[0]);
  }
  
  console.log(`Participants UI updated with ${Object.keys(participants).length} participants`);
}

// Function to move a participant container to the main view or back to the grid
function moveParticipantToMainView(userId) {
  console.log(`Moving participant ${userId} to main view`);
  
  // First, ensure all containers are in their default state
  resetAllVideoContainers();
  
  // Find the container for the selected user
  let targetContainer;
  if (userId === currentUserID || userId === 'local') {
    targetContainer = document.getElementById('localVideoContainer');
  } else {
    targetContainer = document.getElementById(`participant-${userId}`);
  }
  
  if (!targetContainer) {
    console.error(`Could not find container for participant ${userId}`);
    return false;
  }
  
  // Get the main video container reference
  const mainVideoContainer = document.getElementById('mainVideoContainer');
  if (!mainVideoContainer) {
    console.error('Main video container not found');
    return false;
  }
  
  // Remove any no-video placeholders from main video container
  const existingPlaceholder = document.querySelector('#mainVideoContainer .no-video-placeholder');
  if (existingPlaceholder) {
    existingPlaceholder.remove();
  }
  
  // Get the video element within the container
  const videoElement = targetContainer.querySelector('video');
  
  if (!videoElement) {
    console.error('No video element found in the target container');
    return false;
  }
  
  // Ensure main video container is fully visible
  mainVideoContainer.style.opacity = '1';
  mainVideoContainer.style.pointerEvents = 'auto';
  
  // Update the main video label based on the participant
  if (userId === currentUserID || userId === 'local') {
    mainVideoLabel.textContent = isHost ? 'You (Host)' : 'You';
  } else {
    const participant = participants[userId];
    if (participant) {
      mainVideoLabel.textContent = participant.isHost ? 
        `${participant.name} (Host)` : participant.name;
      
      // Update host indicator if needed
      updateMainViewHostIndicator(participant.isHost);
    }
  }
  
  // Highlight the currently pinned participant container in the grid
  targetContainer.classList.add('pinned-participant');
  
  // Set the stream to the main video
  if (videoElement && videoElement.srcObject) {
    console.log(`Moving stream from ${userId} to main video`, videoElement.srcObject);
    
    // Set the main video's source to this stream
    mainVideo.srcObject = videoElement.srcObject;
    
    // Force play to start (for browsers that require it)
    mainVideo.play().catch(err => console.warn('Could not autoplay main video:', err));
    
    // Ensure the main video is visible
    mainVideo.style.display = 'block';
    
    // If there are no video tracks, show a placeholder
    if (!videoElement.srcObject.getVideoTracks || 
        videoElement.srcObject.getVideoTracks().length === 0 ||
        (videoElement.srcObject.getVideoTracks().length > 0 && 
         videoElement.srcObject.getVideoTracks()[0].readyState === 'ended')) {
      showNoVideoPlaceholder(mainVideo);
    }
  } else {
    console.error('No video stream found in the target container');
    showNoVideoPlaceholder(mainVideo);
    return false;
  }
  
  // Make sure audio settings are correct
  if (videoElement) {
    // Always mute our own video in the grid to prevent feedback
    if (userId === currentUserID || userId === 'local') {
      videoElement.muted = true;
      mainVideo.muted = true;
    } else {
      // IMPORTANT: Keep the grid's copy of this participant muted to prevent echo
      videoElement.muted = true;
      
      // Ensure main video is unmuted for remote participants
      mainVideo.muted = false;
      mainVideo.volume = 1.0;
    }
    
    // FIXED: Ensure all OTHER videos in the grid remain unmuted
    // This allows audio from all participants to be heard regardless of who is pinned
    document.querySelectorAll('#participantsGrid video').forEach(video => {
      // Skip our own video (local) and the pinned participant's video in the grid
      if (video === videoElement || video === localVideo) {
        return;
      }
      
      // Ensure all other participant videos are NOT muted
      video.muted = false;
      video.volume = 1.0;
      
      console.log(`Ensuring video element ${video.id} is unmuted for continued audio`);
    });
  }
  
  return true;
}

// Helper function to reset all video containers to their default state
function resetAllVideoContainers() {
  const allContainers = document.querySelectorAll('.video-container');
  allContainers.forEach(container => {
    // Skip the main video container
    if (container.id === 'mainVideoContainer') {
      return;
    }
    
    // Remove any special classes or styles
    container.classList.remove('pinned-participant', 'main-position');
    
    // Reset any inline styles
    container.style.position = '';
    container.style.top = '';
    container.style.left = '';
    container.style.width = '';
    container.style.height = '';
    container.style.zIndex = '';
    container.style.opacity = '1';
    container.style.display = 'block';
  });
  
  // Make sure main video container is visible
  const mainVideoContainer = document.getElementById('mainVideoContainer');
  if (mainVideoContainer) {
    mainVideoContainer.style.opacity = '1';
    mainVideoContainer.style.pointerEvents = 'auto';
  }
}

// Function to initialize the container-based layout system
function initializeContainerBasedLayout() {
  // Add necessary CSS
  const styleEl = document.createElement('style');
  styleEl.id = 'container-layout-styles';
  styleEl.textContent = `
    .grid-position {
      position: relative;
      transition: all 0.3s ease;
    }
    
    .main-position {
      transition: all 0.3s ease;
      box-shadow: 0 0 10px rgba(0,0,0,0.5);
      border-radius: 8px;
      overflow: hidden;
    }
    
    #mainVideoContainer {
      transition: opacity 0.3s ease;
    }
    
    /* Fix for container positions */
    #videoGrid {
      position: relative;
    }
  `;
  document.head.appendChild(styleEl);
  
  // Hide the main video container initially
  const mainVideoContainer = document.getElementById('mainVideoContainer');
  if (mainVideoContainer) {
    // Just make it invisible but keep its space in the layout
    mainVideoContainer.style.opacity = '0';
    mainVideoContainer.style.pointerEvents = 'none';
  }
  
  console.log('Initialized container-based layout system');
}

// Modified setMainVideo function to use the original approach
function setMainVideo(userId) {
  console.log(`Setting main video for user: ${userId}, current pinned: ${pinnedParticipant}`);
  
  // If already pinned, unpin it (toggle behavior)
  if (pinnedParticipant === userId) {
    console.log(`Unpinning user ${userId}, returning to default view`);
    
    // Unpin: show the host or first participant
    pinnedParticipant = null;
    
    // Clear any pinned-participant class from all containers
    document.querySelectorAll('.pinned-participant').forEach(el => {
      el.classList.remove('pinned-participant');
    });
    
    // Remove any existing placeholders from main container
    const existingPlaceholder = document.querySelector('#mainVideoContainer .no-video-placeholder');
    if (existingPlaceholder) {
      existingPlaceholder.remove();
    }
    
    // Find the host
    const hostParticipant = Object.values(participants).find(p => p.isHost);
    
    if (hostParticipant) {
      console.log(`Found host participant ${hostParticipant.id}, setting as main video`);
      // Use the original update method for main video
      updateMainVideo(hostParticipant.id);
    } else if (Object.keys(participants).length > 0) {
      // Otherwise use first participant
      const firstParticipantId = Object.keys(participants)[0];
      console.log(`No host found, using first participant ${firstParticipantId}`);
      updateMainVideo(firstParticipantId);
    } else {
      // No other participants, show local video
      console.log('No other participants, showing own video');
      updateMainVideo(currentUserID);
    }
    
    // Update all pin buttons to be unpinned
    const pinBtns = document.querySelectorAll('.pin-btn');
    pinBtns.forEach(btn => {
      btn.classList.remove('active');
      btn.title = 'Pin to main view';
    });
    
    // FIXED: Ensure all participants' audio is unmuted after unpinning
    // We pass null to ensure nothing is muted
    ensureAllParticipantAudioUnmuted(null);
    
    return;
  }
  
  // Otherwise, pin the selected user
  console.log(`Pinning user ${userId}`);
  
  // First make sure to clear any previous pinned status
  document.querySelectorAll('.pinned-participant').forEach(el => {
    el.classList.remove('pinned-participant');
  });
  
  // Set new pinned participant
  pinnedParticipant = userId;
  
  // Show the selected user in main view
  moveParticipantToMainView(userId);
  
  // Update all pin buttons
  const pinBtns = document.querySelectorAll('.pin-btn');
  pinBtns.forEach(btn => {
    if (btn.dataset.participantId === userId) {
      btn.classList.add('active');
      btn.title = 'Unpin from main view';
    } else {
      btn.classList.remove('active');
      btn.title = 'Pin to main view';
    }
  });
}

// Actual function to update the main video
function updateMainVideo(userId) {
  console.log(`Updating main video for participant: ${userId}`);
  
  // First, clear any existing placeholders from the main video container
  const existingPlaceholder = document.querySelector('#mainVideoContainer .no-video-placeholder');
  if (existingPlaceholder) {
    existingPlaceholder.remove();
  }
  
  // If it's the local user
  if (userId === currentUserID || userId === 'local') {
    // Update main video with local stream
    mainVideo.srcObject = localVideo.srcObject;
    mainVideoLabel.textContent = isHost ? 'You (Host)' : 'You';
    
    // Local video is always muted to prevent feedback
    mainVideo.muted = true;
    
    // Add fullscreen hint class to main video
    mainVideo.classList.add('clickable-for-fullscreen');
    
    // Add host indicator if we are the host
    updateMainViewHostIndicator(isHost);
    
    // Show placeholder if needed
    if (!localVideo.srcObject || (localVideo.srcObject.getVideoTracks && localVideo.srcObject.getVideoTracks().length === 0)) {
      showNoVideoPlaceholder(mainVideo);
    }
    
    // Make sure main video container is visible
    const mainVideoContainer = document.getElementById('mainVideoContainer');
    if (mainVideoContainer) {
      mainVideoContainer.style.opacity = '1';
      mainVideoContainer.style.pointerEvents = 'auto';
    }
    
    // FIXED: Ensure all other participants' audio remains unmuted
    ensureAllParticipantAudioUnmuted(userId);
    
    return;
  }
  
  // Find the participant's info
  const participant = participants[userId];
  if (!participant) {
    showError('Cannot display this participant as they are not in the meeting');
    return;
  }
  
  // Get the participant's video element
  const participantVideo = document.getElementById(`video-${userId}`);
  if (!participantVideo) {
    console.error(`Video element not found for participant ${userId}`);
    return;
  }
  
  // Explicitly log what we're using for the main video stream
  console.log(`Setting main video stream from participant ${userId}`, participantVideo.srcObject);
  
  // Copy the stream to the main video
  mainVideo.srcObject = participantVideo.srcObject;
  
  // Force the main video to play (for some browsers that need explicit play call)
  mainVideo.play().catch(e => console.log('Auto-play prevented:', e));
  
  // Ensure the main video is visible
  mainVideo.style.display = 'block';
  
  // Ensure main video is not muted for remote participants
  mainVideo.muted = false;
  mainVideo.volume = 1.0;
  
  // FIXED: Mute only this participant's grid video to prevent echo
  participantVideo.muted = true;
  
  // FIXED: Ensure all other participants' audio remains unmuted
  ensureAllParticipantAudioUnmuted(userId);
  
  // Update the label
  mainVideoLabel.textContent = participant.isHost ? 
    `${participant.name} (Host)` : participant.name;
  
  // Update host indicator
  updateMainViewHostIndicator(participant.isHost);
  
  console.log(`Main video updated to show participant: ${userId}`);
  
  // Make sure main video container is visible
  const mainVideoContainer = document.getElementById('mainVideoContainer');
  if (mainVideoContainer) {
    mainVideoContainer.style.opacity = '1';
    mainVideoContainer.style.pointerEvents = 'auto';
  }
  
  // If the main video has no stream or valid video tracks, show placeholder
  if (!mainVideo.srcObject || 
      (mainVideo.srcObject.getVideoTracks && 
       mainVideo.srcObject.getVideoTracks().length === 0) ||
      (mainVideo.srcObject.getVideoTracks && 
       mainVideo.srcObject.getVideoTracks().length > 0 && 
       mainVideo.srcObject.getVideoTracks()[0].readyState === 'ended')) {
    showNoVideoPlaceholder(mainVideo);
  }
}

// FIXED: Helper function to ensure all participants' audio remains unmuted except the pinned one
function ensureAllParticipantAudioUnmuted(pinnedUserId) {
  console.log('Ensuring all participant audio remains unmuted except pinned participant');
  
  // Get all participant videos
  const participantVideos = document.querySelectorAll('#participantsGrid video');
  
  participantVideos.forEach(video => {
    // Skip our own local video - always mute that
    if (video === localVideo) {
      video.muted = true;
      return;
    }
    
    // If no participant is pinned (pinnedUserId is null), unmute everyone
    if (pinnedUserId === null) {
      video.muted = false;
      video.volume = 1.0;
      const videoId = video.id;
      console.log(`Unmuting all participant videos after unpinning: ${videoId}`);
      return;
    }
    
    // Skip the pinned participant's grid video (to prevent echo)
    const videoId = video.id;
    const participantId = videoId.replace('video-', '');
    
    if (participantId === pinnedUserId) {
      // Mute the grid copy of the pinned participant (shown in main view)
      video.muted = true;
      console.log(`Muted grid video for pinned participant ${participantId} to prevent echo`);
    } else {
      // Ensure all other participant videos are NOT muted
      video.muted = false;
      video.volume = 1.0;
      console.log(`Ensuring video for participant ${participantId} is unmuted for continued audio`);
    }
  });
}

// New function to add a host indicator badge to the main video
function updateMainViewHostIndicator(isHostView) {
  // Remove any existing indicator first
  const existingIndicator = document.getElementById('main-host-indicator');
  if (existingIndicator) {
    existingIndicator.remove();
  }
  
  // If this is the host's view, add a prominent indicator
  if (isHostView) {
    const mainVideoContainer = document.getElementById('mainVideoContainer');
    
    if (mainVideoContainer) {
      const hostIndicator = document.createElement('div');
      hostIndicator.id = 'main-host-indicator';
      hostIndicator.className = 'absolute top-4 left-4 z-10 bg-primary text-white px-3 py-1 rounded-full shadow-lg flex items-center animate-fade-in';
      hostIndicator.innerHTML = '<i class="fas fa-crown mr-2"></i> Host';
      
      // Add a subtle animation to make it noticeable
      hostIndicator.style.animation = 'pulse 2s infinite';
      
      // Add some CSS for the pulse animation if it doesn't exist
      if (!document.getElementById('host-indicator-style')) {
        const styleEl = document.createElement('style');
        styleEl.id = 'host-indicator-style';
        styleEl.textContent = `
          @keyframes pulse {
            0% { opacity: 0.8; }
            50% { opacity: 1; transform: scale(1.05); }
            100% { opacity: 0.8; }
          }
        `;
        document.head.appendChild(styleEl);
      }
      
      mainVideoContainer.appendChild(hostIndicator);
    }
  }
}

// Check URL for room parameters on load
window.addEventListener('load', () => {
  // Add device detection
  checkAvailableDevices();
  
  // Set up socket events
  setupSocketEvents();
  
  // Initialize our new container-based layout system
  initializeContainerBasedLayout();
  
  // Check URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const roomFromUrl = urlParams.get('room');
  
  if (roomFromUrl) {
    // Set room ID and automatically join (no need to prompt for room ID)
    console.log('Found room in URL parameters:', roomFromUrl);
    roomId = roomFromUrl;
    
    // Wait a bit to ensure the DOM and resources are fully loaded
    setTimeout(() => {
      // Instead of clicking the join button, we'll directly join the meeting
      autoJoinMeeting(roomId);
    }, 1000);
  } else if (window.location.hash) {
    // Support for hash-based room IDs
    roomId = window.location.hash.substring(1);
    setTimeout(() => {
      autoJoinMeeting(roomId);
    }, 1000);
  }
  
  // Check if we're running in a secure context
  if (window.isSecureContext === false) {
    showError('This page is not being served over HTTPS. WebRTC features like camera and screen sharing may not work properly.');
  }
  
  // Call mobile optimizations on load and resize
  applyMobileOptimizations();
  window.addEventListener('resize', applyMobileOptimizations);
  
  // Setup main video fullscreen logic AFTER DOM is fully loaded
  setTimeout(setupMainVideoFullscreen, 1000);
  
  // Setup mobile video refresh checking
  setupMobileVideoRefresh();
});

// Add a dedicated function for setting up main video fullscreen functionality
function setupMainVideoFullscreen() {
  console.log('Setting up main video fullscreen functionality');
  
  const mainVideoContainer = document.getElementById('mainVideoContainer');
  const mainVideo = document.getElementById('mainVideo');
  
  if (!mainVideoContainer || !mainVideo) {
    console.error('Main video elements not found');
    return;
  }
  
  // Add a visible fullscreen button specifically for mobile
  const mobileFullscreenBtn = document.createElement('button');
  mobileFullscreenBtn.className = 'absolute right-4 bottom-4 z-10 bg-black bg-opacity-50 text-white p-3 rounded-full md:hidden';
  mobileFullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
  mobileFullscreenBtn.style.fontSize = '18px';
  
  // Add it to the container
  mainVideoContainer.appendChild(mobileFullscreenBtn);
  
  // Handle click on the mobile fullscreen button
  mobileFullscreenBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Mobile fullscreen button clicked');
    toggleFullscreenForElement(mainVideoContainer); // Use container instead of video
  });
  
  // Add click handler to the main video container
  mainVideoContainer.addEventListener('click', (e) => {
    // Don't trigger if clicking a button inside the container
    if (e.target.tagName.toLowerCase() === 'button' || 
        e.target.closest('button') || 
        e.target.tagName.toLowerCase() === 'i') {
      return;
    }
    
    console.log('Main video container clicked, attempting fullscreen');
    toggleFullscreenForElement(mainVideoContainer); // Use container instead of video
  });
  
  // Add specific touch event handlers for mobile
  mainVideoContainer.addEventListener('touchend', (e) => {
    // Don't trigger if touching a button
    if (e.target.tagName.toLowerCase() === 'button' || 
        e.target.closest('button') || 
        e.target.tagName.toLowerCase() === 'i') {
      return;
    }
    
    // Prevent default to avoid double-firing with click event
    e.preventDefault();
    
    // Only trigger fullscreen if it was a simple tap (not a scroll or pinch)
    if (e.changedTouches.length === 1) {
      console.log('Main video container touched, attempting fullscreen');
      toggleFullscreenForElement(mainVideoContainer); // Use container instead of video
    }
  });
  
  // Set cursor style to indicate it's clickable
  mainVideoContainer.style.cursor = 'pointer';
  
  // Add a visual indicator that it's clickable
  const fullscreenHint = document.createElement('div');
  fullscreenHint.className = 'absolute top-4 right-4 z-10 bg-black bg-opacity-50 text-white px-3 py-1 rounded text-sm hidden';
  fullscreenHint.innerHTML = 'Tap for fullscreen';
  mainVideoContainer.appendChild(fullscreenHint);
  
  // Show the hint briefly when the page loads
  setTimeout(() => {
    fullscreenHint.classList.remove('hidden');
    setTimeout(() => {
      fullscreenHint.classList.add('hidden');
    }, 3000);
  }, 2000);
  
  console.log('Main video fullscreen setup complete');
}

// Helper function to toggle fullscreen for any element
function toggleFullscreenForElement(element) {
  if (!element) return;
  
  // Check if we're already in fullscreen mode
  const isFullscreen = document.fullscreenElement || 
                       document.webkitFullscreenElement || 
                       document.mozFullScreenElement ||
                       document.msFullscreenElement ||
                       document.querySelector('[data-fallback-fullscreen="true"]');
  
  if (!isFullscreen) {
    // ENTERING FULLSCREEN
    console.log('Entering fullscreen mode');
    
    try {
      // Try different fullscreen methods for maximum compatibility
      if (element.requestFullscreen) {
        element.requestFullscreen().catch(err => {
          console.error('Error requesting fullscreen:', err);
          // Fallback to CSS method if standard API fails
          applyFallbackFullscreen(element);
        });
      } else if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen();
      } else if (element.msRequestFullscreen) {
        element.msRequestFullscreen();
      } else if (element.mozRequestFullScreen) {
        element.mozRequestFullScreen();
      } else {
        // Fallback for iOS Safari which doesn't support true fullscreen
        applyFallbackFullscreen(element);
      }
    } catch (err) {
      console.error('Fullscreen error:', err);
      // Try fallback if standard method throws an error
      applyFallbackFullscreen(element);
    }
  } else {
    // EXITING FULLSCREEN
    console.log('Exiting fullscreen mode');
    
    try {
      // Check if we're using the fallback method
      const fallbackElement = document.querySelector('[data-fallback-fullscreen="true"]');
      if (fallbackElement) {
        // Exit fallback fullscreen
        exitFallbackFullscreen(fallbackElement);
      } else if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      }
    } catch (err) {
      console.error('Exit fullscreen error:', err);
    }
  }
  
  // Update the fullscreen button icon
  updateFullscreenButton();
}

// Apply fallback fullscreen method for iOS Safari and other browsers without fullscreen API
function applyFallbackFullscreen(element) {
  // Apply fullscreen styles
  element.style.position = 'fixed';
  element.style.top = '0';
  element.style.left = '0';
  element.style.width = '100%';
  element.style.height = '100%';
  element.style.zIndex = '9999';
  element.style.backgroundColor = '#000'; // Black background
  element.style.display = 'flex';
  element.style.alignItems = 'center';
  element.style.justifyContent = 'center';
  
  // Hide scrollbars
  document.body.style.overflow = 'hidden';
  
  // Ensure video is centered and properly sized
  const video = element.querySelector('video');
  if (video) {
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'contain'; // Ensure video is fully visible
  }
  
  // Make sure controls remain visible
  const controls = document.getElementById('controls');
  if (controls) {
    controls.style.zIndex = '10000';
    controls.style.position = 'fixed';
    controls.style.bottom = '0';
    controls.style.left = '0';
    controls.style.width = '100%';
    controls.style.backgroundColor = 'rgba(0,0,0,0.5)';
  }
  
  // Add an exit fullscreen button
  let exitBtn = document.getElementById('ios-exit-fullscreen');
  if (!exitBtn) {
    exitBtn = document.createElement('button');
    exitBtn.id = 'ios-exit-fullscreen';
    exitBtn.innerHTML = '<i class="fas fa-compress"></i>';
    exitBtn.style.position = 'fixed';
    exitBtn.style.top = '20px';
    exitBtn.style.right = '20px';
    exitBtn.style.zIndex = '10000';
    exitBtn.style.backgroundColor = 'rgba(0,0,0,0.5)';
    exitBtn.style.color = 'white';
    exitBtn.style.border = 'none';
    exitBtn.style.borderRadius = '50%';
    exitBtn.style.width = '44px';
    exitBtn.style.height = '44px';
    exitBtn.style.fontSize = '20px';
    exitBtn.style.display = 'flex';
    exitBtn.style.alignItems = 'center';
    exitBtn.style.justifyContent = 'center';
    exitBtn.style.padding = '0';
    
    // Make the button clearly visible and tappable for mobile
    exitBtn.style.boxShadow = '0 0 10px rgba(255,255,255,0.5)';
    
    exitBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      exitFallbackFullscreen(element);
    });
    
    document.body.appendChild(exitBtn);
  }
  
  // Add tap-anywhere-to-exit instructions
  let instructionEl = document.getElementById('fullscreen-instructions');
  if (!instructionEl) {
    instructionEl = document.createElement('div');
    instructionEl.id = 'fullscreen-instructions';
    instructionEl.textContent = 'Tap the × button to exit fullscreen';
    instructionEl.style.position = 'fixed';
    instructionEl.style.top = '70px';
    instructionEl.style.right = '20px';
    instructionEl.style.zIndex = '10000';
    instructionEl.style.backgroundColor = 'rgba(0,0,0,0.5)';
    instructionEl.style.color = 'white';
    instructionEl.style.padding = '5px 10px';
    instructionEl.style.borderRadius = '4px';
    instructionEl.style.fontSize = '14px';
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      instructionEl.style.opacity = '0';
      instructionEl.style.transition = 'opacity 0.5s';
      
      // Remove after fade out
      setTimeout(() => {
        if (instructionEl.parentNode) {
          instructionEl.parentNode.removeChild(instructionEl);
        }
      }, 500);
    }, 3000);
    
    document.body.appendChild(instructionEl);
  }
  
  // Mark this element as being in fallback fullscreen mode
  element.dataset.fallbackFullscreen = 'true';
}

// Exit fallback fullscreen mode
function exitFallbackFullscreen(element) {
  // Remove fullscreen styles
  element.style.position = '';
  element.style.top = '';
  element.style.left = '';
  element.style.width = '';
  element.style.height = '';
  element.style.zIndex = '';
  element.style.backgroundColor = '';
  element.style.display = '';
  element.style.alignItems = '';
  element.style.justifyContent = '';
  element.dataset.fallbackFullscreen = 'false';
  document.body.style.overflow = '';
  
  // Reset video styling
  const video = element.querySelector('video');
  if (video) {
    video.style.width = '';
    video.style.height = '';
    video.style.objectFit = '';
  }
  
  // Reset controls styling
  const controls = document.getElementById('controls');
  if (controls) {
    controls.style.zIndex = '';
    controls.style.position = '';
    controls.style.bottom = '';
    controls.style.left = '';
    controls.style.width = '';
    controls.style.backgroundColor = '';
  }
  
  // Remove the exit button
  const exitBtn = document.getElementById('ios-exit-fullscreen');
  if (exitBtn) exitBtn.remove();
  
  // Remove any instructions
  const instructionEl = document.getElementById('fullscreen-instructions');
  if (instructionEl) instructionEl.remove();
  
  // Update button icons
  updateFullscreenButton();
}

// Modify the toggle fullscreen function to use our new helper
function toggleFullscreen() {
  const mainVideoContainer = document.getElementById('mainVideoContainer');
  toggleFullscreenForElement(mainVideoContainer); // Use container instead of video
}

// Function to automatically join a meeting without prompting
async function autoJoinMeeting(roomIdToJoin) {
  try {
    updateStatus('Automatically joining room: ' + roomIdToJoin);
    
    // Prompt for username first
    let userName = 'Guest';
    
    try {
      // Dynamically import the function to avoid circular dependencies
      const { promptForUserName } = await import('./js/ui/events.js');
      if (typeof promptForUserName === 'function') {
        userName = await promptForUserName('join');
        if (!userName) {
          console.log('User cancelled name prompt, aborting auto-join');
          // Reset URL and return to home screen
          window.history.pushState({}, '', window.location.pathname);
          updateStatus('Join cancelled by user');
          return;
        }
      } else {
        console.warn('promptForUserName function not found, using default name "Guest"');
      }
    } catch (importError) {
      console.error('Error importing promptForUserName function:', importError);
    }
    
    updateStatus('Requesting media permissions...');
    
    // Initialize peerConnections object
    peerConnections = {};
    
    // Try to get camera and microphone first with optimized constraints
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ 
        video: getVideoConstraints(), 
        audio: true 
      });
      updateStatus('Camera and microphone accessed successfully');
      
      // Set the active media state
      activeMediaBtn = 'camera';
      
      // Update toggle buttons
      isCameraOn = true;
      toggleCameraBtn.innerHTML = '<i class="fas fa-video"></i>';
      toggleCameraBtn.classList.add('btn-primary');
      toggleCameraBtn.classList.remove('btn-secondary');
      
      isMicOn = true;
      toggleMicBtn.innerHTML = '<i class="fas fa-microphone"></i>';
      toggleMicBtn.classList.add('btn-primary');
      toggleMicBtn.classList.remove('btn-secondary');
    } catch (error) {
      console.error('Media access failed:', error);
      
      // Try with just audio as fallback
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
          video: false, 
          audio: true 
        });
        updateStatus('Audio-only mode activated');
        
        // Store for future use
        window.persistentAudioStream = localStream.clone();
        
        // FIXED: Set activeMediaBtn to 'camera' even with no camera
        // This ensures audio tracks are properly transmitted
        activeMediaBtn = 'camera';  // Changed from 'none' to 'camera'
        
        // Update toggle buttons
        isCameraOn = false;
        toggleCameraBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
        toggleCameraBtn.classList.remove('btn-primary');
        toggleCameraBtn.classList.add('btn-secondary');
        
        // Explicitly ensure mic is on
        isMicOn = true;
        toggleMicBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        toggleMicBtn.classList.add('btn-primary');
        toggleMicBtn.classList.remove('btn-secondary');
        
        // Ensure audio tracks are actually enabled
        const audioTracks = localStream.getAudioTracks();
        audioTracks.forEach(track => {
          track.enabled = true;
          console.log(`Audio-only mode: Ensuring audio track ${track.label} is enabled`);
        });
        
      } catch (audioError) {
        console.error('Audio access failed:', audioError);
        
        // Create an empty stream as last resort
        localStream = new MediaStream();
        showError('No media devices available. Others will not be able to see or hear you.');
        
        // Update toggle buttons
        isCameraOn = false;
        toggleCameraBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
        toggleCameraBtn.classList.remove('btn-primary');
        toggleCameraBtn.classList.add('btn-secondary');
        
        isMicOn = false;
        toggleMicBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        toggleMicBtn.classList.remove('btn-primary');
        toggleMicBtn.classList.add('btn-secondary');
        
        // Set active media state
        activeMediaBtn = 'none';
      }
    }
    
    // Set up the local video
    localVideo.srcObject = localStream;
    if (!isCameraOn || (localStream && typeof localStream.getVideoTracks === 'function' && localStream.getVideoTracks().length === 0)) {
      showNoVideoPlaceholder(localVideo);
    }
    
    // Always mute local video to prevent feedback
    localVideo.muted = true;
    
    // Join room
    socket.emit('join', {
      roomId: roomIdToJoin,
      isHost: false,
      userName: userName
    });
    
    // Update UI
    document.getElementById('home').classList.add('hidden');
    document.getElementById('meeting').classList.remove('hidden');
    
    // In auto-join mode, initially show our video in the main display
    // This will be updated once we join the room and get host info
    mainVideo.srcObject = localStream;
    mainVideoLabel.textContent = 'You';
    
    // Initialize connection
    await setupPeerConnection();
    
    // Ensure audio state is properly set for transmission
    window.savedMicState = isMicOn;
    preserveAudioState();
    
    // Verify audio tracks are properly enabled
    if (localStream && typeof localStream.getAudioTracks === 'function') {
      const audioTracks = localStream.getAudioTracks();
      if (audioTracks.length > 0) {
        const allEnabled = audioTracks.every(track => track.enabled);
        console.log(`Joining with ${audioTracks.length} audio tracks, all enabled: ${allEnabled}`);
        if (!allEnabled && isMicOn) {
          audioTracks.forEach(track => {
            track.enabled = true;
            console.log(`Forced enabling audio track: ${track.label}`);
          });
        }
      }
    }
    
  } catch (error) {
    updateStatus('Connection failed: ' + error.message, true);
    showError(`Connection error: ${error.message}`);
  }
}

// Function to check available devices and inform user
async function checkAvailableDevices() {
  try {
    // Add device info at the top
    const deviceInfo = document.createElement('div');
    deviceInfo.id = 'deviceInfo';
    deviceInfo.style.padding = '10px';
    deviceInfo.style.backgroundColor = '#f5f5f5';
    deviceInfo.style.marginBottom = '10px';
    deviceInfo.style.borderRadius = '5px';
    deviceInfo.style.fontSize = '14px';
    deviceInfo.textContent = 'Checking available devices...';
    
    // Insert at the top of the container
    const container = document.querySelector('.container');
    container.insertBefore(deviceInfo, container.firstChild);
    
    // Check for permission to enumerate devices
    let devices = [];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch (err) {
      deviceInfo.textContent = 'Could not detect devices. You may need to grant permission first.';
      deviceInfo.style.color = '#c62828';
      return;
    }
    
    // Count devices by type
    const videoDevices = devices.filter(device => device.kind === 'videoinput');
    const audioDevices = devices.filter(device => device.kind === 'audioinput');
    
    // Update UI based on available devices
    if (videoDevices.length === 0 && audioDevices.length === 0) {
      deviceInfo.textContent = 'No camera or microphone detected. You can still join meetings but won\'t be able to share audio/video.';
      deviceInfo.style.color = '#c62828';
    } else if (videoDevices.length === 0) {
      deviceInfo.textContent = 'No camera detected. You can share audio but not video.';
      deviceInfo.style.color = '#e65100';
    } else if (audioDevices.length === 0) {
      deviceInfo.textContent = 'No microphone detected. You can share video but not audio.';
      deviceInfo.style.color = '#e65100';
    } else {
      deviceInfo.textContent = `Detected: ${videoDevices.length} camera(s) and ${audioDevices.length} microphone(s)`;
      deviceInfo.style.color = '#2e7d32';
    }
    
    console.log('Detected devices:', {
      video: videoDevices.length,
      audio: audioDevices.length,
      allDevices: devices
    });
  } catch (error) {
    console.error('Error checking devices:', error);
  }
}

// Helper function to safely add click event listeners
function addClickListener(element, handler) {
  if (element) {
    element.addEventListener('click', handler);
  } else {
    console.warn(`Element not found for event listener: ${handler.name || 'anonymous'}`);
  }
}

// Toggle camera on/off - Now this will handle both turning on/off and switching modes
function toggleCamera() {
  console.log('Toggle camera clicked');
  
  if (!localStream || typeof localStream.getVideoTracks !== 'function') {
    // Try to get camera access
    console.log('No video stream available, attempting to switch to camera');
    switchToCamera();
    return;
  }
  
  const videoTracks = localStream.getVideoTracks();
  
  // If we don't have a camera track yet, but want to turn it on
  if (videoTracks.length === 0) {
    // User clicked camera button but doesn't have a camera.
    // In this case, we should just ensure the audio is enabled
    console.log("No video tracks available but camera button clicked. Ensuring audio is working.");
    
    // Save current mic state
    const currentMicState = isMicOn;
    console.log(`Current mic state before ensuring audio: ${currentMicState ? 'enabled' : 'disabled'}`);
    
    // Set activeMediaBtn to 'camera' to ensure audio is transmitted
    activeMediaBtn = 'camera';
    
    // Check if any audio tracks are in 'ended' state
    const audioTracks = localStream.getAudioTracks();
    const hasEndedAudio = audioTracks.some(track => track.readyState === 'ended');
    const hasNoAudio = audioTracks.length === 0;
    
    if (hasEndedAudio || hasNoAudio) {
      console.log('Creating new audio stream since current audio is ended or missing');
      
      // If we have a persistent audio stream with live tracks, use that first
      if (window.persistentAudioStream) {
        const persistentTracks = window.persistentAudioStream.getAudioTracks();
        const liveTracks = persistentTracks.filter(t => t.readyState === 'live');
        
        if (liveTracks.length > 0) {
          console.log(`Using existing persistent audio track: ${liveTracks[0].label}`);
          
          // Remove any ended tracks from current stream
          if (hasEndedAudio) {
            audioTracks.forEach(track => {
              if (track.readyState === 'ended') {
                try {
                  localStream.removeTrack(track);
                } catch (e) {
                  console.error('Error removing ended track:', e);
                }
              }
            });
          }
          
          // Add the live track to our stream
          try {
            const clonedTrack = liveTracks[0].clone();
            localStream.addTrack(clonedTrack);
            
            // Restore the saved mic state
            if (!isHost) {
              clonedTrack.enabled = currentMicState;
              isMicOn = currentMicState;
            } else {
              clonedTrack.enabled = true; // Hosts always have audio enabled
              isMicOn = currentMicState; // But show UI according to saved state
            }
            
            updateMicrophoneUI(isMicOn);
            
            // Broadcast the updated stream
            broadcastMediaToAllConnections();
            
            return;
          } catch (e) {
            console.error('Error adding track from persistent stream:', e);
            // Fall through to creating new stream
          }
        }
      }
      
      // Create a completely new stream for audio
      navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      })
      .then(audioStream => {
        // Save for future use
        window.persistentAudioStream = audioStream.clone();
        
        // Replace the entire localStream with the new audio stream
        localStream = audioStream;
        localVideo.srcObject = localStream;
        
        // If the main video is showing our stream, update it too
        if (pinnedParticipant === currentUserID || pinnedParticipant === 'local') {
          mainVideo.srcObject = localStream;
        }
        
        // Restore the saved mic state
        if (!isHost) {
          const newAudioTracks = localStream.getAudioTracks();
          newAudioTracks.forEach(track => {
            track.enabled = currentMicState;
          });
          isMicOn = currentMicState;
        } else {
          // Hosts always have audio enabled
          const newAudioTracks = localStream.getAudioTracks();
          newAudioTracks.forEach(track => {
            track.enabled = true;
          });
          // But we show the UI state as saved
          isMicOn = currentMicState;
        }
        
        updateMicrophoneUI(isMicOn);
        
        // Show no-video placeholder
        showNoVideoPlaceholder(localVideo);
        
        // Update all connections with the new stream
        broadcastMediaToAllConnections();
        
        console.log('Successfully created new audio stream:', localStream);
      })
      .catch(error => {
        console.error('Error creating new audio stream:', error);
        showError(`Could not access microphone: ${error.message}`);
      });
    } else {
      // Make sure audio tracks are enabled
      ensureAudioIsEnabled();
      
      // Update toggle camera button to show camera is still off
      toggleCameraBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
      toggleCameraBtn.classList.remove('btn-primary');
      toggleCameraBtn.classList.add('btn-secondary');
      
      // Show no-video placeholder
      showNoVideoPlaceholder(localVideo);
      
      // Check if we need to broadcast media
      broadcastMediaToAllConnections();
    }
    
    return;
  }
  
  // Save mic state before toggling camera
  const savedMicState = isMicOn;
  
  // Otherwise just toggle the existing tracks
  isCameraOn = !isCameraOn;
  
  // Update all video tracks
  videoTracks.forEach(track => {
    track.enabled = isCameraOn;
  });
  
  // Update button UI
  toggleCameraBtn.innerHTML = isCameraOn ? 
    '<i class="fas fa-video"></i>' : 
    '<i class="fas fa-video-slash"></i>';
  
  toggleCameraBtn.classList.toggle('btn-primary', isCameraOn);
  toggleCameraBtn.classList.toggle('btn-secondary', !isCameraOn);
  
  // Show/hide placeholder
  if (!isCameraOn) {
    showNoVideoPlaceholder(localVideo);
  } else {
    // Remove placeholder if it exists
    const placeholder = document.querySelector('#localVideoContainer .no-video-placeholder');
    if (placeholder) {
      placeholder.remove();
    }
  }
  
  // Ensure the saved mic state is preserved
  const audioTracks = localStream.getAudioTracks();
  if (audioTracks.length > 0) {
    if (!isHost) {
      audioTracks.forEach(track => {
        track.enabled = savedMicState;
      });
    } else {
      // Hosts always have audio enabled
      audioTracks.forEach(track => {
        track.enabled = true;
      });
    }
  }
  
  // Broadcast the updated stream
  broadcastMediaToAllConnections();
}

// Function to explicitly switch to camera mode
async function switchToCamera() {
  try {
    // Save current mic state before any changes
    const savedMicState = preserveAudioState();
    console.log(`Saving mic state before switching to camera: ${savedMicState ? 'enabled' : 'disabled'}`);
    
    // Stop any existing tracks
    if (localStream && typeof localStream.getTracks === 'function') {
      // Save any audio tracks that are still live
      const liveAudioTracks = localStream.getAudioTracks()
        .filter(track => track.readyState === 'live');
      
      // Stop all tracks
      localStream.getTracks().forEach(track => track.stop());
    }
    
    updateStatus('Switching to camera...');
    
    try {
      // Get camera and microphone
      const newStream = await navigator.mediaDevices.getUserMedia({ 
        video: getVideoConstraints(), 
        audio: true 
      });
      
      // Store audio for future use
      window.persistentAudioStream = new MediaStream(
        newStream.getAudioTracks().map(track => track.clone())
      );
      
      // Update local stream
      localStream = newStream;
      localVideo.srcObject = localStream;
      
      // Update states
      activeMediaBtn = 'camera';
      isCameraOn = true;
      
      // Restore saved mic state
      if (!isHost) { // Hosts always have mic on
        const audioTracks = localStream.getAudioTracks();
        audioTracks.forEach(track => {
          track.enabled = savedMicState;
          console.log(`Restoring audio track state to ${savedMicState ? 'enabled' : 'disabled'}`);
        });
        isMicOn = savedMicState;
      } else {
        // Hosts always have audio enabled
        const audioTracks = localStream.getAudioTracks();
        audioTracks.forEach(track => {
          track.enabled = true;
        });
        // But we show the UI state as saved
        isMicOn = savedMicState;
      }
      
      // Update button UI
      toggleCameraBtn.innerHTML = '<i class="fas fa-video"></i>';
      toggleCameraBtn.classList.add('btn-primary');
      toggleCameraBtn.classList.remove('btn-secondary');
      
      updateMicrophoneUI(isMicOn);
      
      // Remove any placeholder
      const placeholder = document.querySelector('#localVideoContainer .no-video-placeholder');
      if (placeholder) {
        placeholder.remove();
      }
      
      // If the main video is showing our stream, update it too
      if (pinnedParticipant === currentUserID || pinnedParticipant === 'local') {
        mainVideo.srcObject = localStream;
      }
      
      // Update all connections with the new stream
      broadcastMediaToAllConnections();
      
      updateStatus('Camera active');
      
    } catch (error) {
      console.error('Error accessing camera:', error);
      showError(`Could not access camera: ${error.message}`);
      
      // Try audio only as fallback
      try {
        // Save any live audio tracks we had before
        let audioTrack = null;
        if (window.persistentAudioStream) {
          const liveTracks = window.persistentAudioStream.getAudioTracks()
            .filter(track => track.readyState === 'live');
          if (liveTracks.length > 0) {
            audioTrack = liveTracks[0].clone();
            console.log('Using existing live audio track as fallback');
          }
        }
        
        // If no existing track, get a new one
        if (!audioTrack) {
          const audioStream = await navigator.mediaDevices.getUserMedia({ 
            video: false, 
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          });
          audioTrack = audioStream.getAudioTracks()[0];
          
          // Store for future use
          window.persistentAudioStream = audioStream.clone();
        }
        
        // Create a new stream with just our audio track
        const newStream = new MediaStream();
        newStream.addTrack(audioTrack);
        localStream = newStream;
        localVideo.srcObject = localStream;
        
        // UPDATE: Even though we only have audio, set mode to 'camera' to ensure audio transmits
        activeMediaBtn = 'camera';
        isCameraOn = false;
        
        // Restore mic state
        if (!isHost) {
          audioTrack.enabled = savedMicState;
          isMicOn = savedMicState;
        } else {
          // Hosts always have audio enabled
          audioTrack.enabled = true;
          // But we show the UI state as saved
          isMicOn = savedMicState;
        }
        
        // Update UI
        toggleCameraBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
        toggleCameraBtn.classList.remove('btn-primary');
        toggleCameraBtn.classList.add('btn-secondary');
        
        updateMicrophoneUI(isMicOn);
        
        // Show placeholder
        showNoVideoPlaceholder(localVideo);
        
        updateStatus('Audio-only mode activated');
        
        // If the main video is showing our stream, update it too
        if (pinnedParticipant === currentUserID || pinnedParticipant === 'local') {
          mainVideo.srcObject = localStream;
          showNoVideoPlaceholder(mainVideo);
        }
        
        // Update all connections with the new stream
        broadcastMediaToAllConnections();
        
      } catch (audioError) {
        console.error('Error accessing microphone:', audioError);
        showError(`Could not access any media devices: ${audioError.message}`);
        
        // Create empty stream
        localStream = new MediaStream();
        localVideo.srcObject = localStream;
        
        // Update states
        activeMediaBtn = 'none';
        isCameraOn = false;
        isMicOn = false;
        
        // Update UI
        toggleCameraBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
        toggleCameraBtn.classList.remove('btn-primary');
        toggleCameraBtn.classList.add('btn-secondary');
        
        toggleMicBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
        toggleMicBtn.classList.remove('btn-primary');
        toggleMicBtn.classList.add('btn-secondary');
        
        // Show placeholder
        showNoVideoPlaceholder(localVideo);
        
        updateStatus('No media devices available');
      }
    }
  } catch (error) {
    console.error('Error in switchToCamera:', error);
    showError(`Failed to switch to camera: ${error.message}`);
  }
}

// Function to toggle microphone on/off
function toggleMicrophone() {
  console.log('Toggle microphone clicked');
  
  // First, check if we have a valid localStream
  if (!localStream || typeof localStream.getAudioTracks !== 'function') {
    console.log('No local stream with audio tracks, attempting to get microphone access');
    // Try to get microphone if not available
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(stream => {
        // Save to persistent stream
        window.persistentAudioStream = stream.clone();
        
        // Get the audio track
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          // Add the audio track to the local stream
          if (!localStream) {
            localStream = new MediaStream();
          }
          localStream.addTrack(audioTrack);
          
          // Set initial state to enabled
          isMicOn = true;
          audioTrack.enabled = true;
          updateMicrophoneUI(true);
          
          // Save the state
          preserveAudioState();
          
          // Update all connections with the new stream
          broadcastMediaToAllConnections();
          console.log('Successfully acquired and added new audio track');
        }
      })
      .catch(error => {
        console.error('Error accessing microphone:', error);
        showError('Could not access microphone: ' + error.message);
      });
    return;
  }
  
  // Get existing audio tracks
  const audioTracks = localStream.getAudioTracks();
  
  // Check if we have any audio tracks
  if (audioTracks.length === 0) {
    console.log('No audio tracks found, attempting to get microphone');
    // Try to get microphone if no audio tracks
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(stream => {
        // Save to persistent stream
        window.persistentAudioStream = stream.clone();
        
        // Get the audio track
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          // Add the audio track to the local stream
          localStream.addTrack(audioTrack);
          
          // Set initial state to enabled
          isMicOn = true;
          audioTrack.enabled = true;
          updateMicrophoneUI(true);
          
          // Save the state
          preserveAudioState();
          
          // Update all connections with the new stream
          broadcastMediaToAllConnections();
          console.log('Successfully acquired and added new audio track');
        }
      })
      .catch(error => {
        console.error('Error accessing microphone:', error);
        showError('Could not access microphone: ' + error.message);
      });
    return;
  }
  
  // Check if we have any ended audio tracks that need replacement when trying to unmute
  const hasEndedTracks = audioTracks.some(track => track.readyState === 'ended');
  
  // If we're unmuting and have ended tracks, get fresh audio
  if (!isMicOn && hasEndedTracks) {
    console.log('Detected ended audio tracks while unmuting, getting fresh audio');
    
    // Get fresh audio track
    getFreshAudioTrack().then(newTrack => {
      if (newTrack) {
        // Remove old tracks
        audioTracks.forEach(track => {
          try {
            localStream.removeTrack(track);
            track.stop();
          } catch (e) {
            console.error('Error removing track:', e);
          }
        });
        
        // Add new track
        localStream.addTrack(newTrack);
        
        // Enable the track
        newTrack.enabled = true;
        isMicOn = true;
        
        // Update UI
        updateMicrophoneUI(true);
        
        // Save state
        preserveAudioState();
        
        // Update connections
        broadcastMediaToAllConnections();
        console.log('Successfully replaced ended audio track when unmuting');
      } else {
        console.error('Failed to get fresh audio track when unmuting');
        showError('Failed to unmute microphone. Please try again.');
      }
    });
    return;
  }
  
  // We're changing from muted to unmuted
  if (!isMicOn && isHost) {
    console.log('Host unmuting microphone - ensuring track is live and transmitting');
    
    // First check if tracks are in a good state
    const hasLiveAudioTracks = audioTracks.some(track => track.readyState === 'live');
    
    if (!hasLiveAudioTracks) {
      console.log('Host unmuting with no live audio tracks - getting fresh audio');
      // Get a fresh audio track
      getFreshAudioTrack().then(newTrack => {
        if (newTrack) {
          // Remove old tracks
          audioTracks.forEach(track => {
            try {
              localStream.removeTrack(track);
              track.stop();
            } catch (e) {
              console.error('Error removing track:', e);
            }
          });
          
          // Add new track
          localStream.addTrack(newTrack);
          
          // Enable the track
          newTrack.enabled = true;
          isMicOn = true;
          
          // Update UI
          updateMicrophoneUI(true);
          
          // Save state
          preserveAudioState();
          
          // Force renegotiation with all peers to ensure updated audio is transmitted
          Object.keys(peerConnections).forEach(peerId => {
            renegotiateConnection(peerId);
          });
          
          // Update connections
          broadcastMediaToAllConnections();
          console.log('Host unmuted with fresh audio track');
        } else {
          console.error('Failed to get fresh audio track for host unmute');
          showError('Failed to unmute microphone. Please try again.');
        }
      });
      return;
    }
  }
  
  // Toggle microphone state for all users (including host)
  isMicOn = !isMicOn;
  
  // Update all audio tracks
  audioTracks.forEach(track => {
    track.enabled = isMicOn;
    console.log(`Setting audio track ${track.label} enabled=${isMicOn}`);
  });
  
  // Update UI
  updateMicrophoneUI(isMicOn);
  
  // Save the state for future transitions
  preserveAudioState();
  
  // For hosts who just unmuted, force renegotiation to ensure audio is transmitted
  if (isMicOn && isHost) {
    console.log('Host unmuted - force renegotiating all connections');
    Object.keys(peerConnections).forEach(peerId => {
      renegotiateConnection(peerId);
    });
  }
  
  // Always broadcast updates to ensure remote peers get current state
  broadcastMediaToAllConnections();
}

// Function to update UI for microphone
function updateMicrophoneUI(enabled) {
  isMicOn = enabled;
  
  toggleMicBtn.innerHTML = isMicOn ? 
    '<i class="fas fa-microphone"></i>' : 
    '<i class="fas fa-microphone-slash"></i>';
  
  toggleMicBtn.classList.toggle('btn-primary', isMicOn);
  toggleMicBtn.classList.toggle('btn-secondary', !isMicOn);
  
  console.log(`Updated microphone UI to reflect state: ${isMicOn ? 'enabled' : 'disabled'}`);
}

// Function to initiate renegotiation after media change
async function renegotiateConnection(userId) {
  if (!peerConnections[userId]) {
    console.error(`Cannot renegotiate - no connection found for ${userId}`);
    return;
  }
  
  try {
    updateStatus('Updating connection for media change...');
    
    // Create a new offer to renegotiate
    const peerConnection = peerConnections[userId];
    
    // Check if connection is in a usable state
    if (peerConnection.connectionState === 'failed' || 
        peerConnection.iceConnectionState === 'failed') {
      console.log(`Connection with ${userId} is in failed state, recreating...`);
      
      // Close the failed connection
      peerConnection.close();
      
      // Create a new connection
      await createPeerConnection(userId);
      
      // If we're the host or have the higher ID, initiate a new offer
      if (isHost || (!participants[userId]?.isHost && currentUserID > userId)) {
        console.log(`Initiating new offer after connection reset for ${userId}`);
        createAndSendOffer(userId);
      }
      
      return;
    }
    
    // Only proceed if connection is in proper state for renegotiation
    if (peerConnection.signalingState !== 'stable') {
      console.warn(`Connection for ${userId} not in stable state (current: ${peerConnection.signalingState}), waiting...`);
      
      // Wait a bit and try again if the connection is not yet stable
      setTimeout(() => {
        if (peerConnections[userId] && peerConnections[userId].signalingState === 'stable') {
          console.log(`Connection with ${userId} is now stable, proceeding with renegotiation`);
          renegotiateConnection(userId);
        } else {
          console.warn(`Connection with ${userId} still not stable, abandoning renegotiation`);
        }
      }, 1000);
      
      return;
    }
    
    // Create the offer with restart option to refresh ICE
    const offerOptions = {
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
      voiceActivityDetection: false,
      iceRestart: true  // Always do ice restart to refresh the connection
    };
    
    const offer = await peerConnection.createOffer(offerOptions);
    
    // Important: Ensure proper setup attribute in SDP for compatibility
    let sdpModified = offer.sdp;
    sdpModified = sdpModified.replace(/a=setup:(active|passive)/g, 'a=setup:actpass');
    
    // Create modified offer
    const modifiedOffer = new RTCSessionDescription({
      type: offer.type,
      sdp: sdpModified
    });
    
    // Set as local description
    await peerConnection.setLocalDescription(modifiedOffer);
    
    // Send the offer to the remote peer with renegotiation flag
    console.log(`Sending renegotiation offer to ${userId}`);
    socket.emit('offer', {
      roomId,
      targetUserId: userId,
      sdp: peerConnection.localDescription,
      renegotiation: true
    });
  } catch (error) {
    console.error('Renegotiation error:', error);
    updateStatus('Failed to update connection: ' + error.message, true);
    
    // If we encounter a serious error, try reconnecting
    if (error.message && (error.message.includes('Failed to set local offer') || 
                          error.message.includes('ICE') ||
                          error.message.includes('state'))) {
      console.log(`Critical error in renegotiation, attempting to recreate connection with ${userId}`);
      
      // Close and recreate the connection
      if (peerConnections[userId]) {
        peerConnections[userId].close();
        delete peerConnections[userId];
      }
      
      // Short delay before reconnecting
      setTimeout(async () => {
        try {
          // Create a new connection
          await createPeerConnection(userId);
          
          // If we're the host or have the higher ID, initiate a new offer
          if (isHost || (!participants[userId]?.isHost && currentUserID > userId)) {
            console.log(`Initiating new offer after error recovery for ${userId}`);
            createAndSendOffer(userId);
          }
        } catch (recoverError) {
          console.error('Failed to recover connection:', recoverError);
        }
      }, 1000);
    }
  }
}

// Function to copy meeting link to clipboard
function copyMeetingLink() {
  const linkText = shareLinkEl.textContent;
  navigator.clipboard.writeText(linkText)
    .then(() => {
      const originalText = copyLinkBtn.innerHTML;
      copyLinkBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
      setTimeout(() => {
        copyLinkBtn.innerHTML = originalText;
      }, 2000);
    })
    .catch(err => {
      showError('Failed to copy link: ' + err);
    });
}

// Function to switch between camera, screen sharing, and no video
async function switchMediaMode(mode) {
  // If we're already in this mode, do nothing
  if (mode === activeMediaBtn) return;
  
  // Update button UI first
  cameraBtn.classList.toggle('active', mode === 'camera');
  shareScreenBtn.classList.toggle('active', mode === 'screen');
  noVideoBtn.classList.toggle('active', mode === 'none');
  
  try {
    // Stop any existing tracks
    if (localStream && typeof localStream.getTracks === 'function') {
      localStream.getTracks().forEach(track => track.stop());
    }
    
    if (screenStream && typeof screenStream.getTracks === 'function' && mode !== 'screen') {
      screenStream.getTracks().forEach(track => track.stop());
      screenStream = null;
    }
    
    // Get the appropriate media based on the mode
    let newStream;
    
    switch (mode) {
      case 'camera':
        updateStatus('Switching to camera...');
        try {
          newStream = await navigator.mediaDevices.getUserMedia({ 
            video: getVideoConstraints(), 
            audio: true 
          });
          
          // Update camera and mic state
          isCameraOn = true;
          toggleCameraBtn.innerHTML = '<i class="fas fa-video"></i>';
          toggleCameraBtn.classList.add('btn-primary');
          toggleCameraBtn.classList.remove('btn-secondary');
          
          isMicOn = true;
          toggleMicBtn.innerHTML = '<i class="fas fa-microphone"></i>';
          toggleMicBtn.classList.add('btn-primary');
          toggleMicBtn.classList.remove('btn-secondary');
          
        } catch (err) {
          console.error('Error getting camera:', err);
          showError('Could not access camera: ' + err.message);
          
          // Try with just audio as fallback
          try {
            newStream = await navigator.mediaDevices.getUserMedia({ 
              video: false, 
              audio: true 
            });
            
            // Fall back to no-video mode
            mode = 'none';
            noVideoBtn.classList.add('active');
            cameraBtn.classList.remove('active');
            
            // Update state
            isCameraOn = false;
            toggleCameraBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
            toggleCameraBtn.classList.remove('btn-primary');
            toggleCameraBtn.classList.add('btn-secondary');
            
            isMicOn = true;
            toggleMicBtn.innerHTML = '<i class="fas fa-microphone"></i>';
            toggleMicBtn.classList.add('btn-primary');
            toggleMicBtn.classList.remove('btn-secondary');
            
            updateStatus('Camera not available, using audio only', true);
          } catch (audioErr) {
            console.error('Error getting audio:', audioErr);
            // Create an empty stream as last resort
            newStream = new MediaStream();
            
            // Update state
            isCameraOn = false;
            toggleCameraBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
            toggleCameraBtn.classList.remove('btn-primary');
            toggleCameraBtn.classList.add('btn-secondary');
            
            isMicOn = false;
            toggleMicBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
            toggleMicBtn.classList.remove('btn-primary');
            toggleMicBtn.classList.add('btn-secondary');
            
            updateStatus('No media devices available', true);
          }
        }
        break;
        
      case 'screen':
        // Just call shareScreen function instead of duplicating code
        shareScreen();
        return; // Return early as shareScreen handles everything
        
      case 'none':
        updateStatus('Video turned off');
        // Try to get just audio
        try {
          newStream = await navigator.mediaDevices.getUserMedia({ 
            video: false, 
            audio: true 
          });
          
          // Update state
          isCameraOn = false;
          toggleCameraBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
          toggleCameraBtn.classList.remove('btn-primary');
          toggleCameraBtn.classList.add('btn-secondary');
          
          isMicOn = true;
          toggleMicBtn.innerHTML = '<i class="fas fa-microphone"></i>';
          toggleMicBtn.classList.add('btn-primary');
          toggleMicBtn.classList.remove('btn-secondary');
          
        } catch (err) {
          console.error('Error getting audio:', err);
          // Create an empty stream as last resort
          newStream = new MediaStream();
          
          // Update state
          isCameraOn = false;
          toggleCameraBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
          toggleCameraBtn.classList.remove('btn-primary');
          toggleCameraBtn.classList.add('btn-secondary');
          
          isMicOn = false;
          toggleMicBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
          toggleMicBtn.classList.remove('btn-primary');
          toggleMicBtn.classList.add('btn-secondary');
          
          updateStatus('No media devices available', true);
        }
        break;
    }
    
    // Update the local stream and video element
    localStream = newStream;
    localVideo.srcObject = localStream;
    
    // Show a placeholder for video if needed
    if (mode === 'none' || (localStream && typeof localStream.getVideoTracks === 'function' && !localStream.getVideoTracks().length)) {
      showNoVideoPlaceholder(localVideo);
    } else {
      // Remove placeholder if it exists
      const placeholder = document.querySelector('#localVideoContainer .no-video-placeholder');
      if (placeholder) {
        placeholder.remove();
      }
    }
    
    // If the main video is showing our stream, update it too
    if (pinnedParticipant === currentUserID || pinnedParticipant === 'local') {
      mainVideo.srcObject = localStream;
      
      if (mode === 'none' || (localStream && typeof localStream.getVideoTracks === 'function' && !localStream.getVideoTracks().length)) {
        showNoVideoPlaceholder(mainVideo);
      } else {
        // Remove placeholder if it exists
        const placeholder = document.querySelector('#mainVideoContainer .no-video-placeholder');
        if (placeholder) {
          placeholder.remove();
        }
      }
    }
    
    // Update all peers with the new media stream
    broadcastMediaToAllConnections();
    
    // Update active mode
    activeMediaBtn = mode;
    updateStatus(mode === 'camera' ? 'Camera active' : mode === 'screen' ? 'Screen sharing active' : 'Video off');
    
  } catch (error) {
    console.error('Error switching media mode:', error);
    showError(`Failed to switch media: ${error.message}`);
  }
}

// Function to toggle participants panel
function toggleParticipantsPanel() {
  // Using classList to toggle hidden class
  participantsPanel.classList.toggle('hidden');
  
  // If on mobile, add a class to prevent scrolling of the body when panel is open
  if (!participantsPanel.classList.contains('hidden')) {
    document.body.classList.add('overflow-hidden');
  } else {
    document.body.classList.remove('overflow-hidden');
  }
}

// Automatically pin the local user to main view when they become host
socket.on('host-changed', (data) => {
  if (data.newHostId === currentUserID) {
    // If we became the host, pin ourselves to the main view
    setMainVideo(currentUserID);
  }
});

// Function to preserve and restore audio state
function preserveAudioState() {
  // Store current audio state before making changes
  window.savedMicState = isMicOn;
  
  console.log(`Saving current mic state: ${window.savedMicState ? 'enabled' : 'disabled'}`);
  
  return window.savedMicState;
}

// Function to apply the saved audio state to a stream
function applyAudioState(stream) {
  if (!stream || typeof stream.getAudioTracks !== 'function') {
    return;
  }
  
  // Get saved state, default to true if not set
  const savedState = typeof window.savedMicState !== 'undefined' ? window.savedMicState : true;
  console.log(`Applying saved mic state: ${savedState ? 'enabled' : 'disabled'}`);
  
  // Apply state to all audio tracks
  const audioTracks = stream.getAudioTracks();
  audioTracks.forEach(track => {
    track.enabled = savedState;
    console.log(`Set audio track ${track.label} enabled=${savedState}`);
  });
  
  // Update UI to reflect the correct state
  updateMicrophoneUI(savedState);
}

// Initialize audio state with defaults
window.addEventListener('DOMContentLoaded', function() {
  // Set default microphone state to be on
  if (typeof window.savedMicState === 'undefined') {
    window.savedMicState = true;
    isMicOn = true;
    console.log('Setting initial microphone state to enabled');
  }
  
  // Add click listeners for host and join buttons
  hostBtn.addEventListener('click', hostMeeting);
  joinBtn.addEventListener('click', joinMeeting);
  
  // Add click listeners for other main controls if not already done
  addClickListener(toggleCameraBtn, toggleCamera);
  addClickListener(toggleMicBtn, toggleMicrophone);
  addClickListener(shareScreenBtn, shareScreen);
  addClickListener(stopShareBtn, () => stopSharing(localStream));
  addClickListener(leaveBtn, leaveMeeting);
  addClickListener(mainFullscreenBtn, toggleFullscreen);
  addClickListener(copyLinkBtn, copyMeetingLink);
  addClickListener(participantsBtn, toggleParticipantsPanel);
  addClickListener(closeParticipantsBtn, toggleParticipantsPanel);
}); 

// Add back the fullscreen change event listeners right after the window load event listener

// Listen for fullscreen change event
document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
document.addEventListener('mozfullscreenchange', updateFullscreenButton);
document.addEventListener('MSFullscreenChange', updateFullscreenButton);

// Add back the updateFullscreenButton function
function updateFullscreenButton() {
  const mainFullscreenBtn = document.getElementById('mainFullscreenBtn');
  const mobileFullscreenBtn = document.querySelector('#mainVideoContainer > button');
  
  // Check if we're in any fullscreen mode (standard API or fallback)
  const isFullscreen = document.fullscreenElement || 
                     document.webkitFullscreenElement || 
                     document.mozFullScreenElement ||
                     document.msFullscreenElement ||
                     document.querySelector('[data-fallback-fullscreen="true"]');
  
  if (isFullscreen) {
    if (mainFullscreenBtn) {
      mainFullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
    }
    
    if (mobileFullscreenBtn) {
      mobileFullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
    }
  } else {
    if (mainFullscreenBtn) {
      mainFullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
    }
    
    if (mobileFullscreenBtn) {
      mobileFullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
    }
  }
}

// Add function to periodically check and refresh videos on mobile
function setupMobileVideoRefresh() {
  // Only run on mobile devices
  if (!isMobileDevice()) return;
  
  console.log('Setting up mobile video refresh checks');
  
  // Every 5 seconds, check if any videos need refreshing
  setInterval(() => {
    const participantVideos = document.querySelectorAll('#participantsGrid video');
    
    participantVideos.forEach(video => {
      // Check if the video is actually displaying content
      const isPlaying = !video.paused && 
                       !video.ended && 
                       video.readyState > 2;
      
      // If video seems stalled, try to refresh it
      if (!isPlaying && video.srcObject) {
        console.log(`Refreshing stalled video: ${video.id}`);
        
        // Try reattaching the stream
        const stream = video.srcObject;
        video.srcObject = null;
        setTimeout(() => {
          video.srcObject = stream;
          video.play().catch(err => console.warn('Failed to restart video:', err));
        }, 100);
      }
    });
  }, 5000);
}