// Video UI module for handling video display elements

import { debounce } from '../utils/helpers.js';

// Update video interface based on app state
export function updateVideoUI() {
  // Update camera button
  const toggleCameraBtn = document.getElementById('toggleCameraBtn');
  if (toggleCameraBtn) {
    if (window.appState.isCameraOn) {
      toggleCameraBtn.innerHTML = '<i class="fas fa-video"></i>';
      toggleCameraBtn.classList.remove('btn-danger');
      toggleCameraBtn.classList.add('btn-primary');
      toggleCameraBtn.title = 'Turn off camera';
    } else {
      toggleCameraBtn.innerHTML = '<i class="fas fa-video-slash"></i>';
      toggleCameraBtn.classList.remove('btn-primary');
      toggleCameraBtn.classList.add('btn-danger');
      toggleCameraBtn.title = 'Turn on camera';
    }
  }
  
  // Update microphone button
  const toggleMicBtn = document.getElementById('toggleMicBtn');
  if (toggleMicBtn) {
    if (window.appState.isMicOn) {
      toggleMicBtn.innerHTML = '<i class="fas fa-microphone"></i>';
      toggleMicBtn.classList.remove('btn-danger');
      toggleMicBtn.classList.add('btn-primary');
      toggleMicBtn.title = 'Mute microphone';
    } else {
      toggleMicBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
      toggleMicBtn.classList.remove('btn-primary');
      toggleMicBtn.classList.add('btn-danger');
      toggleMicBtn.title = 'Unmute microphone';
    }
  }
  
  // Update screen share buttons
  const shareScreenBtn = document.getElementById('shareScreenBtn');
  const stopShareBtn = document.getElementById('stopShareBtn');
  
  if (shareScreenBtn && stopShareBtn) {
    if (window.appState.isScreenSharing) {
      shareScreenBtn.classList.add('hidden');
      stopShareBtn.classList.remove('hidden');
    } else {
      shareScreenBtn.classList.remove('hidden');
      stopShareBtn.classList.add('hidden');
    }
  }
  
  // Update no video placeholder for local video
  const localVideo = document.getElementById('localVideo');
  const localVideoContainer = document.getElementById('localVideoContainer');
  
  if (localVideo && localVideoContainer) {
    // Skip placeholder creation entirely if in audio-only or view-only mode
    if (window.appState.viewOnlyMode || window.appState.audioOnlyMode) {
      // Remove any existing placeholders
      const placeholder = localVideoContainer.querySelector('.no-video-placeholder');
      if (placeholder) {
        placeholder.remove();
      }
    } else if (!window.appState.isCameraOn && !window.appState.isScreenSharing) {
      // Show placeholder if camera is off and not screen sharing (but not in special modes)
      const placeholder = localVideoContainer.querySelector('.no-video-placeholder');
      
      if (!placeholder) {
        // Create placeholder if it doesn't exist
        const newPlaceholder = document.createElement('div');
        newPlaceholder.className = 'no-video-placeholder absolute inset-0 flex items-center justify-center bg-gray-800';
        newPlaceholder.innerHTML = '<i class="fas fa-user-circle text-gray-400 text-4xl"></i>';
        localVideoContainer.appendChild(newPlaceholder);
      } else {
        placeholder.classList.remove('hidden');
      }
    } else {
      // Hide placeholder
      const placeholder = localVideoContainer.querySelector('.no-video-placeholder');
      if (placeholder) {
        placeholder.classList.add('hidden');
      }
    }
  }
  
  // Update main video
  debouncedUpdateMainVideo();
}

// Helper to ensure the main video placeholder exists
function ensurePlaceholderExists() {
  // This function is deprecated - we're using direct DOM references now
  return document.getElementById('noVideoPlaceholder');
}

// Create debounced versions of key functions
export const debouncedUpdateMainVideo = debounce(updateMainVideo, 500);
export const debouncedRefreshMediaDisplays = debounce(refreshMediaDisplays, 1000);

// Update main video based on pinned participant
export function updateMainVideo() {
  const mainVideo = document.getElementById('mainVideo');
  const mainParticipantName = document.getElementById('mainVideoLabel');
  const pinnedParticipant = window.appState.pinnedParticipant;
  const mainVideoContainer = document.getElementById('mainVideoContainer');
  
  // Get the placeholder
  const mainVideoPlaceholder = document.getElementById('noVideoPlaceholder');
  
  console.log(`Updating main video with pinned participant: ${pinnedParticipant}`);
  
  // IMPORTANT: Create an active flag to prevent multiple concurrent operations
  if (window.mainVideoUpdateInProgress) {
    console.log('Main video update already in progress, skipping this update');
    return;
  }
  
  window.mainVideoUpdateInProgress = true;
  
  try {
    // CRITICAL: Completely remove the placeholder element if we're in view-only mode,
    // audio-only mode, or if screen sharing is active or if a remote participant is pinned
    if (mainVideoPlaceholder && (window.appState.viewOnlyMode || 
        window.appState.audioOnlyMode ||
        window.appState.isScreenSharing || 
        (pinnedParticipant && pinnedParticipant !== 'local'))) {
      console.log('*** REMOVING PLACEHOLDER ELEMENT FROM DOM ***');
      mainVideoPlaceholder.remove(); // Completely remove it from DOM
    }
    
    if (mainVideo) {
      mainVideo.style.display = '';
      mainVideo.style.visibility = 'visible';
    }
    
    // Remove all special classes first
    if (mainVideoContainer) {
      mainVideoContainer.classList.remove('screen-sharing-active', 'remote-participant-pinned');
    }
    
    // Get all video containers
    const videoContainers = document.querySelectorAll('.video-container');
    
    // Show all containers first
    videoContainers.forEach(container => {
      container.classList.remove('hidden');
    });
    
    // Update the participant name display in main view
    if (mainParticipantName) {
      if (pinnedParticipant === 'local') {
        const displayText = window.appState.isHost ? 'You (Host)' : 'You';
        mainParticipantName.textContent = window.appState.isScreenSharing ? 
          `${displayText} - Screen Share` : displayText;
      } else if (pinnedParticipant && window.appState.participants[pinnedParticipant]) {
        const participant = window.appState.participants[pinnedParticipant];
        mainParticipantName.textContent = participant.isHost ? 
          `${participant.name} (Host)` : participant.name;
      } else {
        mainParticipantName.textContent = 'Main Speaker';
      }
    }
    
    // If we are showing local user in main view
    if (pinnedParticipant === 'local') {
      console.log('Setting local user as main video');
      
      // Hide the local video thumbnail in participants grid
      const localVideoContainer = document.getElementById('localVideoContainer');
      if (localVideoContainer) {
        localVideoContainer.classList.add('hidden');
      }
      
      // Set main video to local stream
      if (window.appState.screenStream && window.appState.isScreenSharing) {
        console.log('Using screen share stream for main video');
        
        // Add CSS class for screen sharing
        if (mainVideoContainer) {
          mainVideoContainer.classList.add('screen-sharing-active');
          console.log('Added screen-sharing-active class to force hide placeholder');
        }
        
        // Get the screen share video track
        const screenVideoTrack = window.appState.screenStream.getVideoTracks()[0];
        
        if (screenVideoTrack && screenVideoTrack.readyState === 'live') {
          console.log('Screen share video track is active, displaying it');
          
          try {
            // Don't reset srcObject if it's already the right stream to avoid flashing
            const currentStream = mainVideo.srcObject;
            const hasScreenTrack = currentStream && 
                                  currentStream.getVideoTracks().some(t => 
                                    t.id === screenVideoTrack.id);
            
            if (!hasScreenTrack) {
              // Create a new MediaStream with the screen share video track
              const combinedStream = new MediaStream();
              
              // Add the screen video track
              combinedStream.addTrack(screenVideoTrack);
              
              // Add audio tracks from local stream if any
              if (window.appState.localStream) {
                window.appState.localStream.getAudioTracks().forEach(track => {
                  if (track.readyState === 'live') {
                    combinedStream.addTrack(track);
                  }
                });
              }
              
              // Set required attributes before setting srcObject
              mainVideo.autoplay = true;
              mainVideo.playsInline = true;
              mainVideo.muted = true; // To prevent feedback
              
              // Make sure the video element is visible
              mainVideo.style.display = '';
              mainVideo.style.visibility = 'visible';
              
              // Make sure the video element has proper dimensions
              mainVideo.style.width = '100%';
              mainVideo.style.height = '100%';
              
              // Set the combined stream as the source
              mainVideo.srcObject = combinedStream;
              console.log('Set screen share stream to main video element');
            }
            
            // Special handling for video element in Firefox and Safari
            mainVideo.controls = false;
            
            // Now try to play safely
            const playPromise = mainVideo.play();
            if (playPromise !== undefined) {
              playPromise.then(() => {
                console.log('Screen share playing successfully in main view');
                
                // Check if video dimensions are available
                if (mainVideo.videoWidth > 0) {
                  console.log(`Video dimensions: ${mainVideo.videoWidth}x${mainVideo.videoHeight}`);
                }
              }).catch(err => {
                console.warn('Could not autoplay video:', err);
                
                // Add a click handler to try playing when the user interacts
                if (!window.hasPlayHandler) {
                  window.hasPlayHandler = true;
                  document.addEventListener('click', function tryPlay() {
                    // ... existing code ...
                  });
                }
              });
            }
          } catch (error) {
            console.error('Error setting up screen share in main video:', error);
          }
        } else {
          console.warn('Screen video track not available or not active!');
        }
      } else if (window.appState.localStream) {
        console.log('Using local camera stream for main video');
        
        try {
          // First clear any existing stream
          mainVideo.srcObject = null;
          mainVideo.load(); // This resets the video element
          
          // Set required attributes before setting srcObject
          mainVideo.autoplay = true;
          mainVideo.playsInline = true;
          mainVideo.muted = true; // To prevent feedback
          mainVideo.controls = false;
          
          // Special styling for audio-only
          const hasActiveVideo = window.appState.localStream.getVideoTracks().some(track => 
            track.enabled && track.readyState === 'live'
          );
          
          // Set the stream
          mainVideo.srcObject = window.appState.localStream;
          
          // Set video properties
          mainVideo.style.display = ''; // Show the video element
          mainVideo.style.visibility = 'visible';
            
          // Try to play the video
          mainVideo.play().catch(err => {
            console.warn('Could not autoplay local video:', err);
          });
        } catch (err) {
          console.error('Error setting local stream to main video:', err);
        }
      }
      
      // IMPORTANT: Always mute when showing local content to prevent echo
      mainVideo.muted = true;
    } 
    // If we're showing another participant
    else if (pinnedParticipant) {
      console.log(`Setting participant ${pinnedParticipant} as main video`);
      
      // Add CSS class for remote participant
      if (mainVideoContainer) {
        mainVideoContainer.classList.add('remote-participant-pinned');
        console.log('Added remote-participant-pinned class to force hide placeholder');
      }
      
      // Find the participant's video container
      const participantContainer = document.getElementById(`video-container-${pinnedParticipant}`);
      
      // Hide the participant's thumbnail in grid
      if (participantContainer) {
        participantContainer.classList.add('hidden');
      }
      
      // Get video element from participant's container
      let participantVideo = document.getElementById(`video-${pinnedParticipant}`);
      
      if (participantVideo && participantVideo.srcObject) {
        console.log(`Found video for participant ${pinnedParticipant}`);
        
        try {
          // First clear any existing stream
          mainVideo.srcObject = null;
          mainVideo.load(); // This resets the video element
          
          // Set required attributes before setting srcObject
          mainVideo.autoplay = true;
          mainVideo.playsInline = true;
          mainVideo.controls = false;
          
          // This is a remote participant, so unmute to hear them
          mainVideo.muted = false;
          
          // Ensure video is visible
          mainVideo.style.display = '';
          mainVideo.style.visibility = 'visible';
          
          // Set main video to participant's stream
          mainVideo.srcObject = participantVideo.srcObject;
          
          // Use setTimeout to ensure the srcObject is fully processed
          setTimeout(() => {
            // Ensure it's playing
            const playPromise = mainVideo.play();
            if (playPromise !== undefined) {
              playPromise.catch(err => {
                console.warn('Could not autoplay main video:', err);
                
                // Only set up the retry if it's not an abort error
                if (err.name !== 'AbortError') {
                  // Try again with a user interaction
                  mainVideo.muted = true;
                  document.addEventListener('click', function tryPlayRemote() {
                    mainVideo.play().then(() => {
                      if (!mainVideo.srcObject || mainVideo.srcObject.getAudioTracks().length === 0) {
                        // Keep muted if no audio tracks
                        mainVideo.muted = true;
                      } else {
                        mainVideo.muted = false;
                      }
                    }).catch(e => console.warn('Still cannot play main video:', e));
                    document.removeEventListener('click', tryPlayRemote);
                  }, { once: true });
                }
              });
            }
            
            // Log details about the remote stream
            console.log('Remote stream details:', {
              hasVideo: mainVideo.srcObject.getVideoTracks().length > 0,
              hasAudio: mainVideo.srcObject.getAudioTracks().length > 0,
              videoState: mainVideo.srcObject.getVideoTracks().length > 0 ? 
                mainVideo.srcObject.getVideoTracks()[0].readyState : 'N/A',
              element: {
                display: mainVideo.style.display,
                visibility: mainVideo.style.visibility,
                paused: mainVideo.paused,
                videoWidth: mainVideo.videoWidth,
                videoHeight: mainVideo.videoHeight
              }
            });
          }, 100);
        } catch (err) {
          console.error('Error setting participant stream to main video:', err);
        }
      } else {
        console.warn(`No video found for participant ${pinnedParticipant}`);
        
        // Try to find audio for this participant
        const audioEl = document.getElementById(`audio-${pinnedParticipant}`);
        if (audioEl && audioEl.srcObject) {
          console.log(`Found audio-only stream for participant ${pinnedParticipant}`);
          
          // For audio-only participants, show a placeholder
          mainVideo.srcObject = null;
        } else {
          // If no media found, reset to local
          console.warn(`No media found for participant ${pinnedParticipant}, resetting to local`);
          window.appState.pinnedParticipant = 'local';
          
          // Release the lock before recursion
          window.mainVideoUpdateInProgress = false;
          
          updateMainVideo();
          return; // Exit to avoid releasing the lock twice
        }
      }
    }
  } catch (error) {
    console.error('Error updating main video:', error);
  } finally {
    // Always clear the flag when done
    setTimeout(() => {
      window.mainVideoUpdateInProgress = false;
    }, 200);
  }
}

// Function to set up pinning for local video
export function setupLocalVideoPinButton() {
  const localVideoContainer = document.getElementById('localVideoContainer');
  if (!localVideoContainer) {
    console.error('Local video container not found');
    return;
  }
  
  // Check if controls exist
  let controls = localVideoContainer.querySelector('.local-controls');
  if (!controls) {
    // Create controls if they don't exist
    controls = document.createElement('div');
    controls.className = 'local-controls absolute top-2 right-2 flex gap-1 z-10';
    localVideoContainer.appendChild(controls);
  }
  
  // Check if pin button already exists
  let pinBtn = controls.querySelector('.pin-btn');
  if (!pinBtn) {
    // Create pin button
    pinBtn = document.createElement('button');
    pinBtn.className = 'participant-control pin-btn bg-black bg-opacity-50 text-white p-2 rounded hover:bg-opacity-75';
    pinBtn.title = 'Pin to main view';
    pinBtn.setAttribute('aria-label', 'Pin video to main view');
    pinBtn.setAttribute('data-participant-id', 'local');
    pinBtn.innerHTML = '<i class="fas fa-thumbtack"></i>';
    controls.appendChild(pinBtn);
  }
  
  // Update initial state
  updateLocalPinButtonState();
}

// Update local pin button state
export function updateLocalPinButtonState() {
  const pinBtn = document.querySelector('[data-participant-id="local"]');
  if (!pinBtn) return;
  
  if (window.appState.pinnedParticipant === 'local') {
    pinBtn.title = 'Unpin from main view';
    pinBtn.setAttribute('aria-label', 'Unpin video from main view');
    pinBtn.classList.add('active');
  } else {
    pinBtn.title = 'Pin to main view';
    pinBtn.setAttribute('aria-label', 'Pin video to main view');
    pinBtn.classList.remove('active');
  }
}

// Refresh all media displays
export function refreshMediaDisplays() {
  // This function is called during initialization and when returning to the meeting view
  console.log('Refreshing all media displays');
  
  // First, check if we're in audio-only or view-only mode and remove all placeholders
  if (window.appState.audioOnlyMode || window.appState.viewOnlyMode) {
    console.log('In special mode, removing all video placeholders');
    
    // Remove static placeholder
    const staticPlaceholder = document.getElementById('noVideoPlaceholder');
    if (staticPlaceholder) {
      staticPlaceholder.remove();
    }
    
    // Remove all dynamic placeholders
    document.querySelectorAll('.no-video-placeholder').forEach(placeholder => {
      placeholder.remove();
    });
  }
  
  // Update main video first - using direct call to avoid recursive debounce
  if (!window.mainVideoUpdateInProgress) {
    updateMainVideo();
  }
  
  // Don't reset srcObject on all videos - this causes flashing
  // Instead, only update videos that need it (no source or stale source)
  const participantVideos = document.querySelectorAll('.video-container video');
  participantVideos.forEach(video => {
    // Check if this video needs its srcObject refreshed
    const participantId = video.getAttribute('data-participant-id');
    if (!participantId) return;
    
    // Only refresh if the video isn't playing or is stalled
    if (!video.srcObject || 
        video.paused || 
        video.readyState < 2 || 
        video.networkState > 2) {
      
      // For remote participants, get their stream from peerConnections
      if (participantId !== 'local' && window.appState.peerConnections[participantId]) {
        const peerConnection = window.appState.peerConnections[participantId];
        const stream = peerConnection.remoteStream;
        
        if (stream) {
          video.srcObject = stream;
          video.play().catch(err => {
            console.warn(`Could not autoplay video for ${participantId}: ${err.message}`);
          });
        }
      } 
      // For local participant, use localStream
      else if (participantId === 'local' && window.appState.localStream) {
        video.srcObject = window.appState.localStream;
        video.play().catch(err => {
          console.warn(`Could not autoplay local video: ${err.message}`);
        });
      }
    }
  });
  
  // Similarly for audio elements, only refresh those that need it
  const audioElements = document.querySelectorAll('audio');
  audioElements.forEach(audio => {
    const participantId = audio.getAttribute('data-participant-id');
    if (!participantId) return;
    
    // Only refresh if the audio isn't playing or is stalled
    if (!audio.srcObject || 
        audio.paused || 
        audio.readyState < 2 || 
        audio.networkState > 2) {
      
      if (participantId !== 'local' && window.appState.peerConnections[participantId]) {
        const peerConnection = window.appState.peerConnections[participantId];
        const stream = peerConnection.remoteStream;
        
        if (stream) {
          audio.srcObject = stream;
          audio.play().catch(err => {
            console.warn(`Could not autoplay audio for ${participantId}: ${err.message}`);
          });
        }
      }
    }
  });
  
  // Update pin button states
  updateLocalPinButtonState();
  
  // Update all participant pin buttons
  import('../ui/events.js').then(({ updatePinButtonStates, setupMobileButtonHandlers }) => {
    if (typeof updatePinButtonStates === 'function') {
      updatePinButtonStates();
    }
    
    // Set up mobile button handlers after UI refresh
    if (typeof setupMobileButtonHandlers === 'function') {
      setupMobileButtonHandlers();
    }
  }).catch(err => {
    console.warn('Could not update buttons after refresh:', err);
  });
}

// Setup fullscreen button
export function setupFullscreenButton() {
  const mainFullscreenBtn = document.getElementById('mainFullscreenBtn');
  const mainVideoContainer = document.getElementById('mainVideoContainer');
  const mainVideo = document.getElementById('mainVideo');
  
  if (!mainFullscreenBtn || !mainVideoContainer || !mainVideo) {
    console.error('Fullscreen elements not found');
    return;
  }
  
  // Add a special close button that's only visible in fullscreen mode
  const mobileCloseBtn = document.createElement('button');
  mobileCloseBtn.className = 'mobile-fullscreen-close';
  mobileCloseBtn.innerHTML = '<i class="fas fa-times"></i>';
  mobileCloseBtn.setAttribute('aria-label', 'Exit Fullscreen');
  mainVideoContainer.appendChild(mobileCloseBtn);
  
  // Function to check if we should use native video fullscreen (iOS and some mobile browsers)
  const shouldUseNativeVideoFullscreen = () => {
    // Check if we're on mobile
    const isMobile = window.innerWidth <= 768 || navigator.userAgent.match(/Mobi/);
    
    // iOS devices always need native video fullscreen
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) && !window.MSStream;
    
    // Also use native video fullscreen on Android
    const isAndroid = /Android/i.test(navigator.userAgent);
    
    return isMobile && (isIOS || isAndroid);
  };
  
  // Function to enter fullscreen safely
  const enterFullscreen = () => {
    try {
      if (shouldUseNativeVideoFullscreen()) {
        // On iOS/mobile, use the video element's native fullscreen
        console.log('Using native video fullscreen');
        
        // Make sure video has proper attributes for fullscreen
        mainVideo.setAttribute('playsinline', 'true');
        mainVideo.setAttribute('controls', 'true');
        
        // iOS Safari and some Android browsers need the webkitEnterFullscreen method
        if (mainVideo.webkitEnterFullscreen) {
          mainVideo.webkitEnterFullscreen();
        } else if (mainVideo.requestFullscreen) {
          mainVideo.requestFullscreen();
        } else if (mainVideo.webkitRequestFullscreen) {
          mainVideo.webkitRequestFullscreen();
        } else {
          // Fallback to container fullscreen
          mainVideoContainer.requestFullscreen();
        }
      } else {
        // On desktop, use the container element's fullscreen
        if (mainVideoContainer.requestFullscreen) {
          mainVideoContainer.requestFullscreen();
        } else if (mainVideoContainer.webkitRequestFullscreen) {
          mainVideoContainer.webkitRequestFullscreen();
        } else if (mainVideoContainer.msRequestFullscreen) {
          mainVideoContainer.msRequestFullscreen();
        }
      }
      
      mainFullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
    } catch (err) {
      console.error('Fullscreen error:', err);
    }
  };
  
  // Function to exit fullscreen safely
  const exitFullscreen = () => {
    try {
      // Hide video controls when exiting fullscreen
      if (shouldUseNativeVideoFullscreen()) {
        mainVideo.removeAttribute('controls');
      }
      
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
      
      mainFullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
    } catch (err) {
      console.error('Exit fullscreen error:', err);
    }
  };
  
  // Handle regular fullscreen button
  mainFullscreenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      enterFullscreen();
    } else {
      exitFullscreen();
    }
  });
  
  // Also make the video container clickable to enter fullscreen (for mobile)
  mainVideoContainer.addEventListener('click', (e) => {
    // Don't trigger if clicking on a button or control
    if (e.target.tagName === 'BUTTON' || 
        e.target.closest('button') || 
        e.target.tagName === 'I' ||
        e.target.closest('.video-label')) {
      return;
    }
    
    // Only on mobile
    if (window.innerWidth <= 768) {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        enterFullscreen();
      }
    }
  });
  
  // Handle mobile fullscreen close button
  mobileCloseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exitFullscreen();
  });
  
  // Update button when fullscreen changes
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
      mainFullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
    } else {
      mainFullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
      // Make sure controls are removed when exiting fullscreen
      mainVideo.removeAttribute('controls');
    }
  });
  
  // Also handle webkit prefixed event for Safari
  document.addEventListener('webkitfullscreenchange', () => {
    if (document.webkitFullscreenElement) {
      mainFullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
    } else {
      mainFullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
      // Make sure controls are removed when exiting fullscreen
      mainVideo.removeAttribute('controls');
    }
  });
}