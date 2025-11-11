// Media service for handling local and remote media streams
import { showError } from '../ui/notifications.js';
import { updateVideoUI } from '../ui/video.js';
import { startAudioLevelMonitoring, stopAudioLevelMonitoring } from '../utils/audioLevel.js';
import { updateLocalStatusIndicators } from '../utils/statusIndicators.js';

// Track state to prevent redundant operations
let mediaUpdateInProgress = false;

// Initialize media with user camera and microphone
export async function initializeMedia(constraints = null, allowViewOnly = true) {
  // Prevent multiple simultaneous initializations
  if (mediaUpdateInProgress) {
    console.log('Media update already in progress, deferring initialization');
    return new Promise(resolve => {
      setTimeout(() => {
        initializeMedia(constraints, allowViewOnly).then(resolve);
      }, 500);
    });
  }

  mediaUpdateInProgress = true;
  
  try {
    console.log('Initializing media with constraints:', constraints);
    let stream;
    
    // If no constraints provided, use default - START WITH VIDEO OFF (audio only by default)
    if (!constraints) {
      constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false  // Start with video off - users can enable it if they want
      };
      
      // Set camera state to off by default
      window.appState.isCameraOn = false;
      console.log('Starting with video off by default - users can enable camera if desired');
    }
    
    try {
      // Try to get media with provided constraints
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // If constraints requested video but we got it, disable the video track by default
      if (constraints.video && stream.getVideoTracks().length > 0) {
        const videoTracks = stream.getVideoTracks();
        videoTracks.forEach(track => {
          // Disable video track but keep it available for later
          track.enabled = false;
          console.log('Video track obtained but disabled by default');
        });
        // Ensure state reflects video is off
        window.appState.isCameraOn = false;
      }
      
      console.log('Got media stream:', {
        audio: stream.getAudioTracks().length > 0,
        video: stream.getVideoTracks().length > 0,
        videoEnabled: stream.getVideoTracks().some(t => t.enabled)
      });
    } catch (error) {
      console.warn('Failed to get both audio and video:', error);
      
      // Try with just audio if video failed
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: false
        });
        console.log('Got audio-only stream');
        
        // We're in audio-only mode
        window.appState.isCameraOn = false;
        
        // Important: Set a flag to indicate we're in audio-only mode
        // but still want to receive video
        window.appState.audioOnlyMode = true;
        window.appState.canReceiveVideo = true;
        
        // Set data attribute on body for CSS targeting
        document.body.setAttribute('data-audio-only', 'true');
        
        // Remove placeholder elements completely in audio-only mode too
        const mainVideoPlaceholder = document.getElementById('noVideoPlaceholder');
        if (mainVideoPlaceholder) {
          console.log('*** REMOVING PLACEHOLDER ELEMENT FOR AUDIO-ONLY MODE ***');
          mainVideoPlaceholder.remove(); // Completely remove from DOM
        }
        
        // Also remove any dynamic placeholders with the no-video-placeholder class
        document.querySelectorAll('.no-video-placeholder').forEach(placeholder => {
          console.log('*** REMOVING DYNAMIC PLACEHOLDER ELEMENT FOR AUDIO-ONLY MODE ***');
          placeholder.remove();
        });
        
        // Explicitly log the state for debugging
        console.log('Audio-only mode enabled with flags:', {
          audioOnlyMode: window.appState.audioOnlyMode,
          canReceiveVideo: window.appState.canReceiveVideo,
          isCameraOn: window.appState.isCameraOn
        });
      } catch (audioError) {
        console.warn('Failed to get audio:', audioError);
        
        // Try with just video as last resort
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true
          });
          console.log('Got video-only stream');
          
          // We're in video-only mode
          window.appState.isMicOn = false;
        } catch (videoError) {
          console.error('Failed to get any media:', videoError);
          
          // If we allow view-only mode, create an empty stream
          if (allowViewOnly) {
            console.log('Creating empty stream for view-only mode');
            stream = new MediaStream();
            
            // Use fake audio track to ensure peer connections can work
            try {
              // Create a silent audio context to generate a silent audio track
              const audioContext = new (window.AudioContext || window.webkitAudioContext)();
              const oscillator = audioContext.createOscillator();
              oscillator.frequency.value = 0; // Silent
              const destination = audioContext.createMediaStreamDestination();
              oscillator.connect(destination);
              oscillator.start();
              
              // Add this silent track to the stream
              const silentTrack = destination.stream.getAudioTracks()[0];
              stream.addTrack(silentTrack);
              
              console.log('Added silent audio track to enable receiving remote media');
              
              // Important: Set flags to indicate we're in view-only mode
              // but still want to receive video and audio
              window.appState.viewOnlyMode = true;
              window.appState.canReceiveVideo = true;
              window.appState.canReceiveAudio = true;
              
              // Set data attribute on body for CSS targeting
              document.body.setAttribute('data-view-only', 'true');
              
              // CRITICAL: Remove placeholder elements completely in view-only mode
              const mainVideoPlaceholder = document.getElementById('noVideoPlaceholder');
              if (mainVideoPlaceholder) {
                console.log('*** REMOVING PLACEHOLDER ELEMENT FOR VIEW-ONLY MODE ***');
                mainVideoPlaceholder.remove(); // Completely remove from DOM
              }
              
              // Also remove any dynamic placeholders with the no-video-placeholder class
              document.querySelectorAll('.no-video-placeholder').forEach(placeholder => {
                console.log('*** REMOVING DYNAMIC PLACEHOLDER ELEMENT FOR VIEW-ONLY MODE ***');
                placeholder.remove();
              });
              
              // Also make sure the main video element is visible
              const mainVideo = document.getElementById('mainVideo');
              if (mainVideo) {
                mainVideo.style.display = '';
                mainVideo.style.visibility = 'visible';
              }
            } catch (err) {
              console.warn('Could not create silent audio track:', err);
            }
            
            // Enter view-only mode
            window.appState.viewOnlyMode = true;
            window.appState.isCameraOn = false;
            window.appState.isMicOn = false;
          } else {
            throw new Error('Could not access any media devices');
          }
        }
      }
    }
    
    // Store the stream in the app state
    window.appState.localStream = stream;
    
    // Start audio level monitoring for local user (for speaking indicator)
    try {
      startAudioLevelMonitoring('local', stream);
    } catch (err) {
      console.warn('Could not start local audio level monitoring:', err);
    }
    
    // Configure tracks based on app state - don't replace tracks unnecessarily
    const updateTrackState = (track, enabled) => {
      if (track.enabled !== enabled) {
        track.enabled = enabled;
      }
    };
    
    stream.getVideoTracks().forEach(track => {
      updateTrackState(track, window.appState.isCameraOn);
    });
    
    stream.getAudioTracks().forEach(track => {
      // Ensure mic is enabled by default (isMicOn defaults to true)
      const shouldBeEnabled = window.appState.isMicOn !== false
      updateTrackState(track, shouldBeEnabled)
      // Ensure isMicOn is set correctly
      if (window.appState.isMicOn === undefined || window.appState.isMicOn === null) {
        window.appState.isMicOn = true
      }
      
      // Ensure echo cancellation is enabled
      try {
        if (track.getConstraints && !track.getConstraints().echoCancellation) {
          track.applyConstraints({
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }).catch(e => console.log('Could not apply audio constraints:', e));
        }
      } catch (e) {
        console.log('Error checking/applying audio constraints:', e);
      }
    });
    
    // Update local video element without resetting the srcObject if unnecessary
    const localVideo = document.getElementById('localVideo');
    if (localVideo) {
      const currentStream = localVideo.srcObject;
      const streamChanged = !currentStream || 
                           !areStreamsEquivalent(currentStream, stream);
      
      if (streamChanged) {
        localVideo.srcObject = stream;
        
        // IMPORTANT: Make sure the local video element is muted to prevent feedback
        localVideo.muted = true;
      }
      
      // Also update main video if it's showing local, but only if needed
      if (window.appState.pinnedParticipant === 'local') {
        const mainVideo = document.getElementById('mainVideo');
        if (mainVideo) {
          const mainCurrentStream = mainVideo.srcObject;
          const mainStreamChanged = !mainCurrentStream || 
                                  !areStreamsEquivalent(mainCurrentStream, stream);
          
          if (mainStreamChanged) {
            mainVideo.srcObject = stream;
            
            // IMPORTANT: Make sure the main video is muted when showing local stream
            mainVideo.muted = true;
          }
        }
      }
    }
    
    // Check if we're missing video tracks and update the placeholder
    const hasVideoTracks = stream.getVideoTracks().length > 0;
    if (!hasVideoTracks) {
      // Show placeholder for no video, but only if not in audio-only or view-only mode
      console.log('No video tracks found, checking if placeholders are needed');
      
      // Skip placeholders completely if in special modes
      if (!window.appState.viewOnlyMode && !window.appState.audioOnlyMode) {
        const localVideoContainer = document.getElementById('localVideoContainer');
        if (localVideoContainer) {
          let placeholder = localVideoContainer.querySelector('.no-video-placeholder');
          if (!placeholder) {
            // Create placeholder if it doesn't exist with avatar
            placeholder = document.createElement('div');
            placeholder.className = 'no-video-placeholder absolute inset-0 flex items-center justify-center zoom-like-avatar';
            
            // Get user's name for initials
            const userName = window.appState.participants['local']?.name || 
                            window.appState.participants[window.appState.socketId]?.name || 
                            'You';
            const initials = userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || 'U';
            
            placeholder.innerHTML = `
              <div class="avatar-circle bg-blue-600 text-white text-2xl font-bold flex items-center justify-center w-20 h-20 rounded-full">
                ${initials}
              </div>
              <div class="speaking-indicator absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1 hidden">
                <div class="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              </div>
            `;
            localVideoContainer.appendChild(placeholder);
          }
          placeholder.classList.remove('hidden');
        }
        
        // Also update main video if it's showing local
        if (window.appState.pinnedParticipant === 'local') {
          const mainVideoContainer = document.getElementById('mainVideoContainer');
          if (mainVideoContainer) {
            let placeholder = mainVideoContainer.querySelector('.no-video-placeholder');
            if (!placeholder) {
              // Create placeholder if it doesn't exist with avatar
              placeholder = document.createElement('div');
              placeholder.className = 'no-video-placeholder absolute inset-0 flex items-center justify-center zoom-like-avatar';
              
              const userName = window.appState.participants['local']?.name || 
                              window.appState.participants[window.appState.socketId]?.name || 
                              'You';
              const initials = userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || 'U';
              
              placeholder.innerHTML = `
                <div class="avatar-circle bg-blue-600 text-white text-4xl font-bold flex items-center justify-center w-32 h-32 rounded-full">
                  ${initials}
                </div>
                <div class="speaking-indicator absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1 hidden">
                  <div class="w-4 h-4 bg-green-500 rounded-full animate-pulse"></div>
                </div>
              `;
              mainVideoContainer.appendChild(placeholder);
            }
            placeholder.classList.remove('hidden');
          }
        }
      } else {
        console.log('In audio-only or view-only mode, skipping video placeholders');
      }
    }
    
    // Update UI to reflect media state
    updateVideoUI();
    
    // Update status indicators
    updateLocalStatusIndicators();
    
    // Now that we have attempted to get permissions, update device lists
    // Setup device selectors
    try {
      const hasDeviceSelectors = document.getElementById('cameraSelect') || 
                                 document.getElementById('micSelect') ||
                                 document.getElementById('speakerSelect');
      
      if (hasDeviceSelectors) {
        // Import the required function to avoid circular dependencies
        const { setupDeviceSelectors } = await import('../ui/devices.js');
        await setupDeviceSelectors();
      }
    } catch (error) {
      // Silently ignore if device selectors not available
      console.log('Device selectors not available:', error.message);
    }
    
    // Reconnect to any existing peer connections with the new stream
    if (window.appState.peerConnections && typeof window.appState.peerConnections === 'object' && Object.keys(window.appState.peerConnections).length > 0) {
      console.log('Reconnecting existing peer connections with updated media stream');
      // We need to import these functions dynamically to avoid circular deps
      try {
        const { broadcastMediaToAllConnections } = await import('../utils/mediaHelpers.js');
        if (typeof broadcastMediaToAllConnections === 'function') {
          setTimeout(() => {
            broadcastMediaToAllConnections();
          }, 1000); // Short delay to ensure everything is initialized
        }
      } catch (error) {
        console.error('Error broadcasting updated media to connections:', error);
      }
    }
    
    // Ensure deviceSettings exists
    if (!window.appState.deviceSettings || typeof window.appState.deviceSettings !== 'object') {
      window.appState.deviceSettings = {
        selectedCamera: null,
        selectedMic: null,
        selectedSpeaker: null
      }
    }
    
    // Ensure local audio elements are muted to prevent feedback
    muteLocalAudioElements();
    
    return stream;
  } catch (error) {
    console.error('Error initializing media:', error);
    
    // Create a minimal empty stream for receiving only
    if (allowViewOnly) {
      console.log('Falling back to a minimal stream for receive-only mode');
      const emptyStream = new MediaStream();
      window.appState.localStream = emptyStream;
      window.appState.viewOnlyMode = true;
      window.appState.isCameraOn = false;
      window.appState.isMicOn = false;
      
      // Update UI
      updateVideoUI();
      
      return emptyStream;
    }
    
    throw error;
  } finally {
    mediaUpdateInProgress = false;
  }
}

// Helper function to compare streams based on track IDs
function areStreamsEquivalent(stream1, stream2) {
  if (!stream1 || !stream2) return false;
  
  const videoTracks1 = stream1.getVideoTracks().map(t => t.id).sort();
  const videoTracks2 = stream2.getVideoTracks().map(t => t.id).sort();
  const audioTracks1 = stream1.getAudioTracks().map(t => t.id).sort();
  const audioTracks2 = stream2.getAudioTracks().map(t => t.id).sort();
  
  const videoEqual = JSON.stringify(videoTracks1) === JSON.stringify(videoTracks2);
  const audioEqual = JSON.stringify(audioTracks1) === JSON.stringify(audioTracks2);
  
  return videoEqual && audioEqual;
}

// Helper function to ensure all local audio elements are muted to prevent feedback
export function muteLocalAudioElements() {
  // Mute local video element to prevent feedback
  const localVideo = document.getElementById('localVideo');
  if (localVideo) {
    localVideo.muted = true;
  }
  
  // If main video is showing local stream, mute it too
  if (window.appState.pinnedParticipant === 'local') {
    const mainVideo = document.getElementById('mainVideo');
    if (mainVideo) {
      mainVideo.muted = true;
    }
  }
  
  // Also mute any other videos that might be showing our stream
  document.querySelectorAll('video').forEach(video => {
    if (video.srcObject === window.appState.localStream) {
      video.muted = true;
    }
  });
}

// Toggle camera on/off
export async function toggleCamera() {
  if (!window.appState.localStream) {
    console.warn('No local stream available, cannot toggle camera');
    return;
  }
  
  const videoTracks = window.appState.localStream.getVideoTracks();
  
  // If user wants to turn camera on but we don't have a video track yet, request it
  if (window.appState.isCameraOn === false && videoTracks.length === 0) {
    console.log('Camera is off and no video track exists, requesting camera access...');
    
    try {
      // Request camera access
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        }
      });
      
      const newVideoTrack = videoStream.getVideoTracks()[0];
      if (newVideoTrack) {
        // Add video track to existing stream
        window.appState.localStream.addTrack(newVideoTrack);
        
        // Update local video element
        const localVideo = document.getElementById('localVideo');
        if (localVideo) {
          localVideo.srcObject = window.appState.localStream;
        }
        
        // Enable the track
        newVideoTrack.enabled = true;
        window.appState.isCameraOn = true;
        
        // Reset audio-only mode
        window.appState.audioOnlyMode = false;
        document.body.removeAttribute('data-audio-only');
        
        console.log('Camera track added and enabled');
        
        // Remove placeholders
        const localVideoContainer = document.getElementById('localVideoContainer');
        if (localVideoContainer) {
          const placeholder = localVideoContainer.querySelector('.no-video-placeholder');
          if (placeholder) {
            placeholder.remove();
          }
        }
        
        // Remove placeholder from main video if showing local
        if (window.appState.pinnedParticipant === 'local') {
          const mainVideoContainer = document.getElementById('mainVideoContainer');
          if (mainVideoContainer) {
            const placeholder = mainVideoContainer.querySelector('.no-video-placeholder');
            if (placeholder) {
              placeholder.remove();
            }
          }
        }
        
        // Broadcast updated stream to all peers
        try {
          const { broadcastMediaToAllConnections } = await import('../utils/mediaHelpers.js');
          if (typeof broadcastMediaToAllConnections === 'function') {
            broadcastMediaToAllConnections();
          }
        } catch (err) {
          console.warn('Could not broadcast updated stream:', err);
        }
        
        updateVideoUI();
        updateLocalStatusIndicators();
        
        // Force update main video if local is pinned
        if (window.appState.pinnedParticipant === 'local') {
          setTimeout(() => {
            import('../ui/video.js').then(({ updateMainVideo }) => {
              if (typeof updateMainVideo === 'function') {
                updateMainVideo();
              }
            }).catch(err => console.warn('Could not update main video:', err));
          }, 100);
        }
        
        return;
      }
    } catch (error) {
      console.error('Failed to get camera access:', error);
      showError('Could not access camera. Please check permissions and try again.');
      return;
    }
  }
  
  // If we have video tracks, just toggle them
  if (videoTracks.length > 0) {
    window.appState.isCameraOn = !window.appState.isCameraOn;
    
    // Reset audio-only and view-only modes when turning camera on
    if (window.appState.isCameraOn) {
      window.appState.audioOnlyMode = false;
      window.appState.viewOnlyMode = false;
      document.body.removeAttribute('data-audio-only');
      document.body.removeAttribute('data-view-only');
    }
    
    videoTracks.forEach(track => {
      track.enabled = window.appState.isCameraOn;
    });
    
    // Broadcast updated stream to all peers
    try {
      const { broadcastMediaToAllConnections } = await import('../utils/mediaHelpers.js');
      if (typeof broadcastMediaToAllConnections === 'function') {
        broadcastMediaToAllConnections();
      }
    } catch (err) {
      console.warn('Could not broadcast updated stream:', err);
    }
    
    updateVideoUI();
    updateLocalStatusIndicators();
  }
}

// Toggle microphone on/off
export function toggleMicrophone() {
  if (!window.appState.localStream) {
    console.error('No local stream available');
    return;
  }
  
  window.appState.isMicOn = !window.appState.isMicOn;
  
  window.appState.localStream.getAudioTracks().forEach(track => {
    track.enabled = window.appState.isMicOn;
  });
  
  // Update UI
  updateVideoUI();
  updateLocalStatusIndicators();
  
  return window.appState.isMicOn;
}

// Start screen sharing
export async function startScreenSharing() {
  if (mediaUpdateInProgress) {
    console.log('Media update already in progress, deferring screen share start');
    return new Promise(resolve => {
      setTimeout(() => {
        startScreenSharing().then(resolve);
      }, 500);
    });
  }

  mediaUpdateInProgress = true;
  
  try {
    console.log('Requesting screen share permission');
    
    // Skip if already screen sharing
    if (window.appState.isScreenSharing && window.appState.screenStream) {
      console.log('Already screen sharing, not requesting new stream');
      return window.appState.screenStream;
    }
    
    // Get screen share stream
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false // Audio capture from screen is rarely needed and can cause echo
    });
    
    // Update app state
    window.appState.isScreenSharing = true;
    window.appState.screenStream = screenStream;
    
    // Log the details of the screen share track
    const videoTrack = screenStream.getVideoTracks()[0];
    if (videoTrack) {
      console.log(`Got screen share video track: ${videoTrack.id}, enabled=${videoTrack.enabled}, state=${videoTrack.readyState}`);
      console.log('Screen share track settings:', videoTrack.getSettings());
      
      // Listen for when screen sharing is ended by the user
      videoTrack.addEventListener('ended', () => {
        console.log('Screen sharing stopped by user');
        stopScreenSharing();
      });
    }
    
    // Handle view-only mode separately
    if (window.appState.viewOnlyMode) {
      console.log('Screen sharing in view-only mode');
      
      // Instead of replacing tracks, we'll add the screen share video track to the local stream
      // This ensures we can still send the screen share to remote peers
      if (window.appState.localStream) {
        // First remove any existing video tracks
        const existingVideoTracks = window.appState.localStream.getVideoTracks();
        existingVideoTracks.forEach(track => {
          window.appState.localStream.removeTrack(track);
        });
        
        // Now add the screen share video track
        const screenVideoTrack = screenStream.getVideoTracks()[0];
        if (screenVideoTrack) {
          window.appState.localStream.addTrack(screenVideoTrack);
          console.log('Added screen share video track to local stream in view-only mode');
        }
      }
      
      // Make sure the main video element is visible
      const mainVideo = document.getElementById('mainVideo');
      if (mainVideo) {
        mainVideo.style.display = '';
        mainVideo.style.visibility = 'visible';
        console.log('Making main video element visible for screen sharing');
      }
      
      // Add a special class to the main video container to hide the placeholder via CSS
      const mainVideoContainer = document.getElementById('mainVideoContainer');
      if (mainVideoContainer) {
        mainVideoContainer.classList.add('screen-sharing-active');
        console.log('Added screen-sharing-active class to hide placeholder via CSS');
      }
      
      // Force a main video update when in view-only mode
      setTimeout(() => {
        import('../ui/video.js').then(({ updateMainVideo }) => {
          console.log('Forcing main video update in view-only mode');
          if (typeof updateMainVideo === 'function') {
            updateMainVideo();
          }
        }).catch(err => {
          console.error('Could not import video.js for main video update:', err);
        });
      }, 500);
    }
    
    // Save the camera track BEFORE replacing it in peer connections
    let cameraTrack = null;
    if (window.appState.localStream) {
      cameraTrack = window.appState.localStream.getVideoTracks().find(
        track => !track.label.toLowerCase().includes('screen') &&
                 !track.label.toLowerCase().includes('desktop') &&
                 !track.label.toLowerCase().includes('window') &&
                 !track.label.toLowerCase().includes('display')
      );
      
      // Store camera track for later restoration
      if (cameraTrack) {
        window.appState.cameraTrackBeforeScreenShare = cameraTrack;
        console.log('Saved camera track before screen sharing:', cameraTrack.id);
      }
    }
    
    // Start sending the screen share to all peers by replacing the video track
    const streamDetails = {
      hasVideo: screenStream.getVideoTracks().length > 0,
      hasAudio: window.appState.localStream ? window.appState.localStream.getAudioTracks().length > 0 : false,
      videoTrackEnabled: screenStream.getVideoTracks()[0] ? screenStream.getVideoTracks()[0].enabled : false,
      videoTrackReadyState: screenStream.getVideoTracks()[0] ? screenStream.getVideoTracks()[0].readyState : 'none'
    };
    
    console.log('Stream to share details:', streamDetails);
    
    // Only update the UI if we actually got a screen share stream
    if (streamDetails.hasVideo && streamDetails.videoTrackEnabled) {
      // Create a separate screen share tile instead of replacing local video
      const screenVideoTrack = screenStream.getVideoTracks()[0];
      
      if (screenVideoTrack) {
        // Store screen share container ID for later removal
        const screenShareContainerId = 'screen-share-local';
        window.appState.screenShareContainerId = screenShareContainerId;
        
        // Check if screen share tile already exists
        let screenShareContainer = document.getElementById(screenShareContainerId);
        
        if (!screenShareContainer) {
          console.log('Creating separate screen share tile');
          
          // Get the participants grid
          const participantsGrid = document.getElementById('participantsGrid');
          if (!participantsGrid) {
            console.error('Participants grid not found');
            return null;
          }
          
          // Create screen share container
          screenShareContainer = document.createElement('div');
          screenShareContainer.id = screenShareContainerId;
          screenShareContainer.className = 'video-container bg-black rounded-lg overflow-hidden relative screen-share-tile';
          screenShareContainer.style.aspectRatio = '16/9';
          screenShareContainer.setAttribute('data-screen-share', 'true');
          
          // Create video element for screen share
          const screenShareVideo = document.createElement('video');
          screenShareVideo.id = 'screen-share-video-local';
          screenShareVideo.className = 'w-full h-full object-contain';
          screenShareVideo.autoplay = true;
          screenShareVideo.playsInline = true;
          screenShareVideo.muted = true; // Prevent feedback
          screenShareVideo.srcObject = screenStream;
          
          // Create label
          const screenShareLabel = document.createElement('div');
          screenShareLabel.className = 'video-label absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent text-white px-3 py-2 text-sm z-10 flex items-center justify-between';
          screenShareLabel.innerHTML = `
            <span class="font-medium">🖥️ Your Screen Share</span>
            <span class="flex items-center gap-2">
              <span class="screen-share-indicator">
                <i class="fas fa-desktop text-xs"></i>
              </span>
            </span>
          `;
          
          // Assemble container (no pin button needed)
          screenShareContainer.appendChild(screenShareVideo);
          screenShareContainer.appendChild(screenShareLabel);
          
          // Add to participants grid
          participantsGrid.appendChild(screenShareContainer);
          
          // Trigger layout update
          import('../ui/layout.js').then(({ updateVideoTileLayout }) => {
            updateVideoTileLayout();
          }).catch(err => {
            console.warn('Could not import updateVideoTileLayout:', err);
          });
          
          // Try to play
          try {
            await screenShareVideo.play();
            console.log('Screen share video playing in separate tile');
          } catch (playError) {
            console.warn('Could not autoplay screen share:', playError);
          }
        } else {
          // Update existing screen share tile
          const existingVideo = screenShareContainer.querySelector('video');
          if (existingVideo) {
            existingVideo.srcObject = screenStream;
            try {
              await existingVideo.play();
            } catch (playError) {
              console.warn('Could not play screen share in existing tile:', playError);
            }
          }
        }
        
        // Add screen share as a second video track (not replacing camera)
        console.log('Adding screen share as second video track to peer connections');
        
        // Import the function to add screen share tracks
        try {
          await addScreenShareTrackToPeerConnections(screenVideoTrack);
        } catch (rtcError) {
          console.error('Error adding screen share track to peer connections:', rtcError);
        }
      }
      
      // Restore local video to show camera feed (if available)
      // IMPORTANT: This must happen AFTER creating the screen share tile
      // to ensure the local video always shows the camera, not the screen share
      const localVideo = document.getElementById('localVideo');
      if (localVideo) {
        // Use saved camera track if available, otherwise try to find it
        const cameraTrackToUse = window.appState.cameraTrackBeforeScreenShare || cameraTrack;
        
        if (cameraTrackToUse && cameraTrackToUse.readyState === 'live') {
          console.log('Restoring camera feed to local video');
          // Create a stream with just the camera track
          const cameraStream = new MediaStream([cameraTrackToUse]);
          // Also add audio tracks
          if (window.appState.localStream) {
            window.appState.localStream.getAudioTracks().forEach(track => {
              if (track.readyState === 'live') {
                cameraStream.addTrack(track);
              }
            });
          }
          localVideo.srcObject = cameraStream;
          localVideo.muted = true;
          try {
            await localVideo.play();
            console.log('Camera feed restored to local video');
          } catch (playError) {
            console.warn('Could not play camera feed:', playError);
          }
        } else if (window.appState.localStream) {
          // Fallback: try to use local stream as-is (might have camera track)
          const allVideoTracks = window.appState.localStream.getVideoTracks();
          const nonScreenTrack = allVideoTracks.find(
            track => !track.label.toLowerCase().includes('screen') &&
                     !track.label.toLowerCase().includes('desktop') &&
                     !track.label.toLowerCase().includes('window') &&
                     !track.label.toLowerCase().includes('display')
          );
          
          if (nonScreenTrack && nonScreenTrack.readyState === 'live') {
            const fallbackStream = new MediaStream([nonScreenTrack]);
            window.appState.localStream.getAudioTracks().forEach(track => {
              if (track.readyState === 'live') {
                fallbackStream.addTrack(track);
              }
            });
            localVideo.srcObject = fallbackStream;
            localVideo.muted = true;
            try {
              await localVideo.play();
              console.log('Camera feed restored via fallback');
            } catch (playError) {
              console.warn('Could not play fallback camera feed:', playError);
            }
          } else {
            // No camera track available - show placeholder or keep existing
            console.log('No camera track available to restore');
          }
        }
        
        // Ensure local video is NOT showing screen share
        if (localVideo.srcObject) {
          const videoTracks = localVideo.srcObject.getVideoTracks();
          const hasScreenTrack = videoTracks.some(track => 
            track.label.toLowerCase().includes('screen') ||
            track.label.toLowerCase().includes('desktop') ||
            track.label.toLowerCase().includes('window') ||
            track.label.toLowerCase().includes('display')
          );
          
          if (hasScreenTrack) {
            console.warn('Local video was showing screen share, fixing it...');
            // Force restore camera feed
            if (cameraTrackToUse && cameraTrackToUse.readyState === 'live') {
              const fixStream = new MediaStream([cameraTrackToUse]);
              if (window.appState.localStream) {
                window.appState.localStream.getAudioTracks().forEach(track => {
                  if (track.readyState === 'live') {
                    fixStream.addTrack(track);
                  }
                });
              }
              localVideo.srcObject = fixStream;
            }
          }
        }
      }
      
      // Update UI
      updateVideoUI();
      
      console.log('Screen sharing started successfully');
      return screenStream;
    } else {
      console.warn('Screen share stream has no video tracks or track is disabled');
      showError('Screen sharing failed. Please try again.');
      stopScreenSharing();
      return null;
    }
  } catch (error) {
    console.error('Error starting screen share:', error);
    
    // If the user cancelled the screen share, this is not an error
    if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
      console.log('User cancelled screen sharing');
    } else {
      showError('Screen sharing failed. Please try again.');
    }
    
    // Reset the screen sharing state
    window.appState.isScreenSharing = false;
    window.appState.screenStream = null;
    
    // Update UI
    updateVideoUI();
    
    return null;
  } finally {
    mediaUpdateInProgress = false;
  }
}

// Stop screen sharing
export async function stopScreenSharing() {
  try {
    console.log('Stopping screen sharing');
    
    if (!window.appState.screenStream) {
      console.log('No screen sharing active, nothing to stop');
      return;
    }
    
    // Stop all tracks in the screen stream
    window.appState.screenStream.getTracks().forEach(track => {
      track.stop();
    });
    
    // Clear screen stream reference
    window.appState.screenStream = null;
    window.appState.isScreenSharing = false;
    
    // Remove screen share tile if it exists
    const screenShareContainerId = window.appState.screenShareContainerId || 'screen-share-local';
    const screenShareContainer = document.getElementById(screenShareContainerId);
    if (screenShareContainer) {
      console.log('Removing screen share tile');
      screenShareContainer.remove();
      window.appState.screenShareContainerId = null;
      
      // Trigger layout update
      import('../ui/layout.js').then(({ updateVideoTileLayout }) => {
        updateVideoTileLayout();
      }).catch(err => {
        console.warn('Could not import updateVideoTileLayout:', err);
      });
    }
    
    // If screen share was pinned, reset to local
    if (window.appState.pinnedParticipant === 'screen-share-local') {
      window.appState.pinnedParticipant = 'local';
      document.dispatchEvent(new CustomEvent('pinned-participant-changed'));
    }
    
    // Restore local video to show camera feed (if available)
    const localVideo = document.getElementById('localVideo');
    if (localVideo && window.appState.localStream) {
      // Check if we have a camera track
      const cameraTrack = window.appState.localStream.getVideoTracks().find(
        track => track.label.toLowerCase().includes('camera') || 
                 track.label.toLowerCase().includes('webcam') ||
                 !track.label.toLowerCase().includes('screen')
      );
      
      if (cameraTrack) {
        // Create a stream with just the camera track
        const cameraStream = new MediaStream([cameraTrack]);
        // Also add audio tracks
        window.appState.localStream.getAudioTracks().forEach(track => {
          cameraStream.addTrack(track);
        });
        localVideo.srcObject = cameraStream;
        localVideo.muted = true;
        try {
          await localVideo.play();
        } catch (playError) {
          console.warn('Could not play camera feed:', playError);
        }
      } else {
        // No camera track, just use the local stream as is
        localVideo.srcObject = window.appState.localStream;
        localVideo.muted = true;
        try {
          await localVideo.play();
        } catch (playError) {
          console.warn('Could not play local stream:', playError);
        }
      }
    }
    
    // Update UI buttons
    const shareScreenBtn = document.getElementById('shareScreenBtn');
    const stopShareBtn = document.getElementById('stopShareBtn');
    
    if (shareScreenBtn) shareScreenBtn.classList.remove('hidden');
    if (stopShareBtn) stopShareBtn.classList.add('hidden');
    
    // Remove screen-sharing-active CSS class
    const mainVideoContainer = document.getElementById('mainVideoContainer');
    if (mainVideoContainer) {
      mainVideoContainer.classList.remove('screen-sharing-active');
      console.log('Removed screen-sharing-active class');
    }
    
    // Check if we were in temporary view-only mode before screen sharing
    if (window.appState.tempViewOnlyMode) {
      console.log('Restoring view-only mode after screen sharing');
      window.appState.viewOnlyMode = true;
      window.appState.tempViewOnlyMode = false;
      
      // If needed, create a new empty stream for view-only mode
      if (!window.appState.localStream) {
        window.appState.localStream = new MediaStream();
        
        // Add a silent audio track
        try {
          // Create a silent audio context
          const audioContext = new (window.AudioContext || window.webkitAudioContext)();
          const oscillator = audioContext.createOscillator();
          oscillator.frequency.value = 0; // Silent
          const destination = audioContext.createMediaStreamDestination();
          oscillator.connect(destination);
          oscillator.start();
          
          // Add this silent track to the stream
          const silentTrack = destination.stream.getAudioTracks()[0];
          window.appState.localStream.addTrack(silentTrack);
          
          console.log('Added silent audio track for view-only mode');
        } catch (err) {
          console.warn('Could not create silent audio track:', err);
        }
      } else {
        // Remove any video tracks from the local stream
        const videoTracks = window.appState.localStream.getVideoTracks();
        videoTracks.forEach(track => {
          window.appState.localStream.removeTrack(track);
        });
      }
    }
    // Check if we were in temporary audio-only mode
    else if (window.appState.tempScreenSharingMode) {
      console.log('Restoring audio-only mode after screen sharing');
      window.appState.audioOnlyMode = true;
      window.appState.tempScreenSharingMode = false;
      
      // Remove video tracks from local stream if any
      if (window.appState.localStream) {
        const videoTracks = window.appState.localStream.getVideoTracks();
        videoTracks.forEach(track => {
          window.appState.localStream.removeTrack(track);
        });
      }
    }
    // Otherwise restore previous camera state
    else if (window.appState.cameraStateBeforeScreenShare) {
      console.log('Restoring camera state to:', window.appState.cameraStateBeforeScreenShare);
      // Only toggle if the current state is different from what we want to restore
      if (window.appState.isCameraOn !== window.appState.cameraStateBeforeScreenShare) {
        toggleCamera(true); // Turn camera back on without updating UI
      }
    }
    
    // Local video restoration is already handled above
    
    // Remove screen share tracks from all peer connections
    Object.entries(window.appState.peerConnections || {}).forEach(([peerId, pc]) => {
      const senders = pc.getSenders();
      const videoSenders = senders.filter(sender => 
        sender.track && sender.track.kind === 'video'
      );
      
      // Find and remove screen share senders (keep camera senders)
      videoSenders.forEach(sender => {
        const trackLabel = sender.track.label.toLowerCase();
        const isScreenShare = trackLabel.includes('screen') || 
                             trackLabel.includes('desktop') || 
                             trackLabel.includes('window') ||
                             trackLabel.includes('display');
        
        if (isScreenShare) {
          console.log(`Removing screen share track from peer ${peerId}`);
          try {
            pc.removeTrack(sender);
            renegotiateConnection(pc, peerId);
          } catch (err) {
            console.error(`Error removing screen share track from ${peerId}:`, err);
          }
        }
      });
    });
    
    // IMPORTANT: We need to update all peer connections to send the camera feed now
    restoreVideoTracks();
    
    // Keep showing current user in main view if they were pinned
    if (window.appState.pinnedParticipant === 'local') {
      // Update main view to show local stream without screen sharing
      import('../ui/video.js').then(({ updateMainVideo }) => {
        if (typeof updateMainVideo === 'function') {
          setTimeout(() => {
            updateMainVideo();
          }, 100); // Short delay to ensure streams are updated
        }
      });
    }
    
    // Update UI to reflect new state
    import('../ui/video.js').then(({ updateVideoUI }) => {
      if (typeof updateVideoUI === 'function') {
        setTimeout(() => {
          updateVideoUI();
        }, 200); // Short delay to ensure all streams are updated
      }
    });
    
    // Refresh all connections to ensure they have the most current state
    import('../services/socket.js').then(({ forceFullMeshConnections }) => {
      if (typeof forceFullMeshConnections === 'function') {
        setTimeout(() => {
          forceFullMeshConnections();
        }, 1000); // Longer delay to ensure UI is updated first
      }
    });
    
    console.log('Screen sharing stopped successfully');
  } catch (error) {
    console.error('Error stopping screen share:', error);
  }
}

// New function to restore camera video tracks after screen sharing
function restoreVideoTracks() {
  if (!window.appState.localStream) {
    console.warn('No local stream available to restore video tracks');
    return;
  }
  
  // Get camera video track if available
  const cameraVideoTracks = window.appState.localStream.getVideoTracks();
  if (cameraVideoTracks.length === 0) {
    console.log('No camera video tracks to restore');
    
    // For audio-only mode, we need to remove video tracks from peer connections
    removeVideoTrackFromPeerConnections();
    return;
  }
  
  // Enable the track if the camera is supposed to be on
  const cameraVideoTrack = cameraVideoTracks[0];
  if (window.appState.isCameraOn) {
    cameraVideoTrack.enabled = true;
  }
  
  console.log(`Restoring camera video track: ${cameraVideoTrack.id} to all peer connections`);
  
  // Replace the track in all peer connections with the camera track
  if (Object.keys(window.appState.peerConnections || {}).length === 0) {
    console.log('No peer connections available to update with camera feed');
  }
  
  Object.entries(window.appState.peerConnections || {}).forEach(([peerId, pc]) => {
    const senders = pc.getSenders();
    const videoSender = senders.find(sender => 
      sender.track && sender.track.kind === 'video'
    );
    
    if (videoSender) {
      // Replace the screen share track with the camera track
      console.log(`Replacing screen share track with camera track for peer ${peerId}`);
      videoSender.replaceTrack(cameraVideoTrack)
        .then(() => {
          console.log(`Camera track restored successfully for peer ${peerId}`);
          
          // Renegotiate connection for camera stream
          renegotiateConnection(pc, peerId);
        })
        .catch(err => {
          console.error(`Failed to replace track for ${peerId}:`, err);
          
          // Try with a timeout instead
          setTimeout(() => {
            try {
              videoSender.replaceTrack(cameraVideoTrack).then(() => {
                console.log(`Camera track restored after retry for peer ${peerId}`);
                renegotiateConnection(pc, peerId);
              });
            } catch (retryErr) {
              console.error(`Still failed to restore camera track for ${peerId}:`, retryErr);
            }
          }, 1000);
        });
    } else if (window.appState.isCameraOn) {
      // If there's no video sender but camera is on, add the camera track
      try {
        pc.addTrack(cameraVideoTrack, window.appState.localStream);
        console.log(`Added camera track to peer ${peerId}`);
        
        // Renegotiate connection
        renegotiateConnection(pc, peerId);
      } catch (err) {
        console.error(`Error adding camera track to peer ${peerId}:`, err);
      }
    }
  });
  
  // Show notification to inform user
  import('../ui/notifications.js').then(({ showNotification }) => {
    if (typeof showNotification === 'function') {
      showNotification('Switched back to camera', 'info', 3000);
    }
  }).catch(err => {
    console.warn('Could not show notification:', err);
  });
  
  // Force media refresh after a short delay
  setTimeout(() => {
    import('../ui/video.js').then(({ debouncedRefreshMediaDisplays }) => {
      if (typeof debouncedRefreshMediaDisplays === 'function') {
        debouncedRefreshMediaDisplays();
      }
    });
  }, 1000);
}

// Change audio output device
export function changeAudioOutputDevice(deviceId) {
  if (!deviceId) {
    return;
  }
  
  // Store selected speaker
  window.appState.deviceSettings.selectedSpeaker = deviceId;
  
  // Apply to all video elements if the browser supports setSinkId
  const videoElements = document.querySelectorAll('video');
  videoElements.forEach(video => {
    if (video.setSinkId) {
      video.setSinkId(deviceId)
        .catch(error => {
          console.error('Error changing audio output device:', error);
        });
    }
  });
}

// Get all available media devices
export async function getAvailableDevices() {
  try {
    // Try to get devices without requesting permissions first
    let devices = await navigator.mediaDevices.enumerateDevices();
    
    // If we get empty labels, we need permissions
    const needsPermissions = devices.some(device => 
      (device.kind === 'audioinput' || device.kind === 'videoinput') && !device.label
    );
    
    if (needsPermissions) {
      try {
        // First try audio only if we have any audio inputs
        if (devices.some(device => device.kind === 'audioinput')) {
          try {
            const audioStream = await navigator.mediaDevices.getUserMedia({ 
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
              } 
            });
            devices = await navigator.mediaDevices.enumerateDevices();
            audioStream.getTracks().forEach(track => track.stop());
            
            // Store this stream for future use
            if (!window.persistentAudioStream) {
              window.persistentAudioStream = audioStream.clone();
            }
          } catch (audioError) {
            console.log('Could not access microphone:', audioError);
          }
        }
        
        // Then try video only if needed and if we have any video inputs
        if (devices.some(device => device.kind === 'videoinput') && 
            devices.some(device => device.kind === 'videoinput' && !device.label)) {
          try {
            const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            devices = await navigator.mediaDevices.enumerateDevices();
            videoStream.getTracks().forEach(track => track.stop());
          } catch (videoError) {
            console.log('Could not access camera:', videoError);
          }
        }
      } catch (error) {
        console.log('Error getting device permissions:', error);
        // Continue with limited device info
      }
    }
    
    const cameras = devices.filter(device => device.kind === 'videoinput');
    const microphones = devices.filter(device => device.kind === 'audioinput');
    const speakers = devices.filter(device => device.kind === 'audiooutput');
    
    return {
      cameras,
      microphones,
      speakers
    };
  } catch (error) {
    console.error('Error getting available devices:', error);
    // Return empty arrays instead of showing an error
    return {
      cameras: [],
      microphones: [],
      speakers: []
    };
  }
}

// Helper function to add screen share as a second video track (not replacing camera)
function addScreenShareTrackToPeerConnections(screenVideoTrack) {
  console.log('Adding screen share as second video track to all peer connections');
  
  // Ensure the video track is enabled
  if (!screenVideoTrack.enabled) {
    console.log('Enabling screen share track before adding to peer connections');
    screenVideoTrack.enabled = true;
  }
  
  // If we don't have any peer connections yet, log that fact
  if (Object.keys(window.appState.peerConnections || {}).length === 0) {
    console.log('No peer connections available to update with screen share');
    return;
  }
  
  Object.entries(window.appState.peerConnections || {}).forEach(([peerId, pc]) => {
    const senders = pc.getSenders();
    const videoSenders = senders.filter(sender => 
      sender.track && sender.track.kind === 'video'
    );
    
    // Check if we already have a screen share sender
    const hasScreenShareSender = videoSenders.some(sender => {
      const trackLabel = sender.track.label.toLowerCase();
      return trackLabel.includes('screen') || 
             trackLabel.includes('desktop') || 
             trackLabel.includes('window') ||
             trackLabel.includes('display');
    });
    
    if (hasScreenShareSender) {
      // Update existing screen share sender
      const screenShareSender = videoSenders.find(sender => {
        const trackLabel = sender.track.label.toLowerCase();
        return trackLabel.includes('screen') || 
               trackLabel.includes('desktop') || 
               trackLabel.includes('window') ||
               trackLabel.includes('display');
      });
      
      if (screenShareSender) {
        console.log(`Updating existing screen share track for peer ${peerId}`);
        screenShareSender.replaceTrack(screenVideoTrack)
          .then(() => {
            console.log(`Screen share track updated for peer ${peerId}`);
            renegotiateConnection(pc, peerId);
          })
          .catch(err => {
            console.error(`Failed to update screen share track for ${peerId}:`, err);
          });
      }
    } else {
      // Add screen share as a new video track (second transceiver)
      console.log(`Adding screen share as second video track for peer ${peerId}`);
      
      try {
        // Create a separate stream for screen share
        const screenShareStream = new MediaStream([screenVideoTrack]);
        
        // Add the track to the peer connection as a new transceiver
        pc.addTrack(screenVideoTrack, screenShareStream);
        console.log(`Successfully added screen share track to peer ${peerId}`);
        
        // Renegotiate connection
        renegotiateConnection(pc, peerId);
      } catch (err) {
        console.error(`Error adding screen share track to peer ${peerId}:`, err);
        
        // Try with a timeout instead
        setTimeout(() => {
          try {
            const screenShareStream = new MediaStream([screenVideoTrack]);
            pc.addTrack(screenVideoTrack, screenShareStream);
            console.log(`Added screen share track to peer ${peerId} after retry`);
            renegotiateConnection(pc, peerId);
          } catch (retryErr) {
            console.error(`Still failed to add screen share track for ${peerId}:`, retryErr);
          }
        }, 1000);
      }
    }
  });
  
  // Force media refresh after a short delay
  setTimeout(() => {
    import('../ui/video.js').then(({ debouncedRefreshMediaDisplays }) => {
      if (typeof debouncedRefreshMediaDisplays === 'function') {
        debouncedRefreshMediaDisplays();
      }
    });
  }, 1000);
}

// Helper function to replace video tracks in all peer connections
function replaceVideoTrackInPeerConnections(newVideoTrack) {
  console.log('Replacing video track in all peer connections');
  
  // Ensure the video track is enabled
  if (!newVideoTrack.enabled) {
    console.log('Enabling video track before adding to peer connections');
    newVideoTrack.enabled = true;
  }
  
  // If we don't have any peer connections yet, log that fact
  if (Object.keys(window.appState.peerConnections || {}).length === 0) {
    console.log('No peer connections available to update with screen share');
  }
  
  Object.entries(window.appState.peerConnections || {}).forEach(([peerId, pc]) => {
    const senders = pc.getSenders();
    const videoSender = senders.find(sender => 
      sender.track && sender.track.kind === 'video'
    );
    
    if (videoSender) {
      // Replace existing video track
      console.log(`Replacing video track for peer ${peerId}`);
      videoSender.replaceTrack(newVideoTrack)
        .then(() => {
          console.log(`Track replaced successfully for peer ${peerId}`);
          
          // Renegotiate connection
          renegotiateConnection(pc, peerId);
        })
        .catch(err => {
          console.error(`Failed to replace track for ${peerId}:`, err);
          
          // Try with a timeout instead
          setTimeout(() => {
            try {
              videoSender.replaceTrack(newVideoTrack).then(() => {
                console.log(`Track replaced after retry for peer ${peerId}`);
                renegotiateConnection(pc, peerId);
              });
            } catch (retryErr) {
              console.error(`Still failed to replace track for ${peerId}:`, retryErr);
            }
          }, 1000);
        });
    } else {
      // Add new video track if we don't have one yet
      console.log(`Adding new video track for peer ${peerId}`);
      
      try {
        // Create a stream to use - either use the local stream or create a new one
        let streamToUse = window.appState.localStream;
        if (!streamToUse) {
          console.log(`Creating new stream for peer ${peerId} to add video track`);
          streamToUse = new MediaStream([newVideoTrack]);
        }
        
        // Add the track to the peer connection
        pc.addTrack(newVideoTrack, streamToUse);
        console.log(`Successfully added video track to peer ${peerId}`);
        
        // Renegotiate connection
        renegotiateConnection(pc, peerId);
      } catch (err) {
        console.error(`Error adding video track to peer ${peerId}:`, err);
        
        // Try with a timeout instead
        setTimeout(() => {
          try {
            // Create a new stream just for this track
            const freshStream = new MediaStream([newVideoTrack]);
            pc.addTrack(newVideoTrack, freshStream);
            console.log(`Added video track to peer ${peerId} after retry`);
            renegotiateConnection(pc, peerId);
          } catch (retryErr) {
            console.error(`Still failed to add track for ${peerId}:`, retryErr);
          }
        }, 1000);
      }
    }
  });
  
  // Force media refresh after a short delay - use debounced version
  setTimeout(() => {
    import('../ui/video.js').then(({ debouncedRefreshMediaDisplays }) => {
      if (typeof debouncedRefreshMediaDisplays === 'function') {
        debouncedRefreshMediaDisplays();
      }
    });
  }, 1000);
}

// Helper function to remove video tracks from all peer connections
function removeVideoTrackFromPeerConnections() {
  console.log('Removing video tracks from all peer connections');
  
  Object.entries(window.appState.peerConnections).forEach(([peerId, pc]) => {
    const senders = pc.getSenders();
    const videoSender = senders.find(sender => 
      sender.track && sender.track.kind === 'video'
    );
    
    if (videoSender) {
      console.log(`Removing video track from peer ${peerId}`);
      try {
        pc.removeTrack(videoSender);
        
        // Renegotiate connection
        renegotiateConnection(pc, peerId);
      } catch (err) {
        console.error(`Could not remove track for ${peerId}:`, err);
      }
    }
  });
  
  // Force media refresh after a short delay - use debounced version
  setTimeout(() => {
    import('../ui/video.js').then(({ debouncedRefreshMediaDisplays }) => {
      if (typeof debouncedRefreshMediaDisplays === 'function') {
        debouncedRefreshMediaDisplays();
      }
    });
  }, 1000);
}

// Helper function for renegotiating a connection after track changes
function renegotiateConnection(peerConnection, peerId) {
  console.log(`Renegotiating connection with peer ${peerId}`);
  
  // Check if connection is in a valid state for renegotiation
  if (peerConnection.signalingState === 'have-local-offer') {
    console.warn(`Cannot renegotiate ${peerId}: already have pending offer. Waiting for answer.`);
    return;
  }
  
  // Wait a bit if we just set remote description
  if (peerConnection.signalingState === 'have-remote-offer') {
    console.warn(`Cannot renegotiate ${peerId}: waiting for answer to remote offer.`);
    return;
  }
  
  // Check if connection is healthy
  if (peerConnection.connectionState === 'closed' || 
      peerConnection.connectionState === 'failed') {
    console.warn(`Cannot renegotiate ${peerId}: connection is ${peerConnection.connectionState}`);
    return;
  }
  
  peerConnection.createOffer({
    offerToReceiveAudio: true, 
    offerToReceiveVideo: true
  })
  .then(offer => {
    return peerConnection.setLocalDescription(offer);
  })
  .then(() => {
    // Import dynamically to avoid circular dependencies
    import('./socket.js').then(({ sendScreenSharingOffer, sendRenegotiationOffer }) => {
      if (typeof sendScreenSharingOffer === 'function' && window.appState.isScreenSharing) {
        // Use specialized function for screen sharing
        sendScreenSharingOffer(peerId, peerConnection.localDescription);
      } else if (typeof sendRenegotiationOffer === 'function') {
        // Use regular renegotiation for other cases
        sendRenegotiationOffer(peerId, peerConnection.localDescription);
      }
    }).catch(err => {
      console.error('Error importing socket functions:', err);
    });
  })
  .catch(err => {
    console.error(`Failed to create offer for ${peerId}:`, err);
  });
}

// Function to refresh screen sharing for all participants
export function refreshScreenSharing() {
  console.log('Refreshing screen sharing for all participants');
  
  // Check if we are screen sharing
  if (!window.appState.isScreenSharing || !window.appState.screenStream) {
    console.log('Not currently screen sharing, nothing to refresh');
    return;
  }
  
  const screenVideoTrack = window.appState.screenStream.getVideoTracks()[0];
  if (!screenVideoTrack) {
    console.warn('No screen video track found to refresh');
    return;
  }
  
  // Log track details for debugging
  console.log(`Refreshing screen share track: ${screenVideoTrack.id}, enabled=${screenVideoTrack.enabled}, state=${screenVideoTrack.readyState}`);
  
  // Replace the track in all peer connections
  // IMPORTANT: Use addScreenShareTrackToPeerConnections to add as second track, not replace
  addScreenShareTrackToPeerConnections(screenVideoTrack);
  
  // Update UI to reflect screen sharing state
  import('../ui/video.js').then(({ updateVideoUI }) => {
    if (typeof updateVideoUI === 'function') {
      updateVideoUI();
    }
  });
  
  console.log('Screen sharing refresh initiated');
}

// Function to update screen share for a specific new participant
export function updateScreenShareForNewParticipant(participantId) {
  console.log(`Updating screen share for new participant: ${participantId}`);
  
  // Check if we are screen sharing
  if (!window.appState.isScreenSharing || !window.appState.screenStream) {
    console.log('Not currently screen sharing, nothing to update');
    return;
  }
  
  // Check if we have a connection to this participant
  const peerConnection = window.appState.peerConnections[participantId];
  if (!peerConnection) {
    console.warn(`No peer connection found for participant ${participantId}`);
    return;
  }
  
  // Get the screen share video track
  const screenVideoTrack = window.appState.screenStream.getVideoTracks()[0];
  if (!screenVideoTrack) {
    console.warn('No screen video track found to send');
    return;
  }
  
  // Log track details for debugging
  console.log(`Sending screen share track to ${participantId}: ${screenVideoTrack.id}, enabled=${screenVideoTrack.enabled}, state=${screenVideoTrack.readyState}`);
  
  // Find existing video senders
  const senders = peerConnection.getSenders();
  const videoSenders = senders.filter(sender => 
    sender.track && sender.track.kind === 'video'
  );
  
  // Check if we already have a screen share sender
  const hasScreenShareSender = videoSenders.some(sender => {
    const trackLabel = sender.track.label.toLowerCase();
    return trackLabel.includes('screen') || 
           trackLabel.includes('desktop') || 
           trackLabel.includes('window') ||
           trackLabel.includes('display');
  });
  
  // Check if we have a camera sender (non-screen-share)
  const cameraSender = videoSenders.find(sender => {
    const trackLabel = sender.track.label.toLowerCase();
    return !trackLabel.includes('screen') && 
           !trackLabel.includes('desktop') && 
           !trackLabel.includes('window') &&
           !trackLabel.includes('display');
  });
  
  try {
    if (hasScreenShareSender) {
      // Update existing screen share sender
      const screenShareSender = videoSenders.find(sender => {
        const trackLabel = sender.track.label.toLowerCase();
        return trackLabel.includes('screen') || 
               trackLabel.includes('desktop') || 
               trackLabel.includes('window') ||
               trackLabel.includes('display');
      });
      
      if (screenShareSender) {
        console.log(`Updating existing screen share track for peer ${participantId}`);
        screenShareSender.replaceTrack(screenVideoTrack)
          .then(() => {
            console.log(`Screen share track updated for peer ${participantId}`);
            renegotiateConnection(peerConnection, participantId);
          })
          .catch(err => {
            console.error(`Failed to update screen share track for ${participantId}:`, err);
          });
      }
    } else {
      // Add screen share as a NEW video track (second transceiver) - don't replace camera
      console.log(`Adding screen share as second video track for peer ${participantId}`);
      
      // Create a separate stream for screen share
      const screenShareStream = new MediaStream([screenVideoTrack]);
      
      // Add the track to the peer connection as a new transceiver
      peerConnection.addTrack(screenVideoTrack, screenShareStream);
      console.log(`Successfully added screen share track to peer ${participantId}`);
      
      // Renegotiate connection
      renegotiateConnection(peerConnection, participantId);
    }
  } catch (err) {
    console.error(`Error updating screen share for participant ${participantId}:`, err);
  }
} 