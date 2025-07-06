// Video UI module for handling video display elements

import { debounce } from '../utils/helpers.js';

// Global flags to prevent concurrent operations
let mainVideoUpdateInProgress = false;
let refreshInProgress = false;

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
export const debouncedUpdateMainVideo = debounce(updateMainVideo, 150);
export const debouncedRefreshMediaDisplays = debounce(refreshMediaDisplays, 300);

// Update main video based on pinned participant - OPTIMIZED VERSION
export function updateMainVideo() {
  const mainVideo = document.getElementById('mainVideo');
  const mainParticipantName = document.getElementById('mainVideoLabel');
  const pinnedParticipant = window.appState.pinnedParticipant;
  const mainVideoContainer = document.getElementById('mainVideoContainer');
  
  // Get the placeholder
  const mainVideoPlaceholder = document.getElementById('noVideoPlaceholder');
  
  console.log(`Updating main video with pinned participant: ${pinnedParticipant}`);
  
  // CRITICAL: Prevent multiple concurrent operations
  if (mainVideoUpdateInProgress) {
    console.log('Main video update already in progress, skipping this update');
    return;
  }
  
  mainVideoUpdateInProgress = true;
  
  try {
    // CRITICAL: Remove placeholder only when necessary
    if (mainVideoPlaceholder && (window.appState.viewOnlyMode || 
        window.appState.audioOnlyMode ||
        window.appState.isScreenSharing || 
        (pinnedParticipant && pinnedParticipant !== 'local'))) {
      console.log('*** REMOVING PLACEHOLDER ELEMENT FROM DOM ***');
      mainVideoPlaceholder.remove();
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
            // ANTI-FLASHING: Check if we already have the right stream
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
              mainVideo.style.width = '100%';
              mainVideo.style.height = '100%';
              
              // ANTI-FLASHING: Set stream without resetting
              mainVideo.srcObject = combinedStream;
              console.log('Set screen share stream to main video element');
            }
            
            // Special handling for video element
            mainVideo.controls = false;
            
            // Now try to play safely
            const playPromise = mainVideo.play();
            if (playPromise !== undefined) {
              playPromise.then(() => {
                console.log('Screen share playing successfully in main view');
                if (mainVideo.videoWidth > 0) {
                  console.log(`Video dimensions: ${mainVideo.videoWidth}x${mainVideo.videoHeight}`);
                }
              }).catch(err => {
                console.warn('Could not autoplay video:', err);
                if (!window.hasPlayHandler) {
                  window.hasPlayHandler = true;
                  document.addEventListener('click', function tryPlay() {
                    mainVideo.play().catch(e => console.warn('Still cannot play:', e));
                    document.removeEventListener('click', tryPlay);
                  }, { once: true });
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
          // ANTI-FLASHING: Only reset if we need to
          const currentStream = mainVideo.srcObject;
          const needsUpdate = !currentStream || 
                             currentStream !== window.appState.localStream ||
                             !currentStream.getVideoTracks().some(t => t.readyState === 'live');
          
          if (needsUpdate) {
            // Set required attributes before setting srcObject
            mainVideo.autoplay = true;
            mainVideo.playsInline = true;
            mainVideo.muted = true; // To prevent feedback
            mainVideo.controls = false;
            
            // Set video properties
            mainVideo.style.display = '';
            mainVideo.style.visibility = 'visible';
            
            // ANTI-FLASHING: Set stream directly without reset
            mainVideo.srcObject = window.appState.localStream;
            
            // Try to play the video
            mainVideo.play().catch(err => {
              console.warn('Could not autoplay local video:', err);
            });
          }
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
          // ANTI-FLASHING: Only update if stream is different
          const currentStream = mainVideo.srcObject;
          const newStream = participantVideo.srcObject;
          
          if (currentStream !== newStream) {
            // Set required attributes before setting srcObject
            mainVideo.autoplay = true;
            mainVideo.playsInline = true;
            mainVideo.controls = false;
            mainVideo.muted = false; // Unmute for remote participants
            
            // Ensure video is visible
            mainVideo.style.display = '';
            mainVideo.style.visibility = 'visible';
            
            // ANTI-FLASHING: Set stream directly
            mainVideo.srcObject = newStream;
            
            // Use setTimeout to ensure the srcObject is fully processed
            setTimeout(() => {
              const playPromise = mainVideo.play();
              if (playPromise !== undefined) {
                playPromise.catch(err => {
                  console.warn('Could not autoplay main video:', err);
                  if (err.name !== 'AbortError') {
                    mainVideo.muted = true;
                    document.addEventListener('click', function tryPlayRemote() {
                      mainVideo.play().then(() => {
                        if (!mainVideo.srcObject || mainVideo.srcObject.getAudioTracks().length === 0) {
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
            }, 50); // Reduced timeout for faster response
          }
        } catch (err) {
          console.error('Error setting participant stream to main video:', err);
        }
      } else {
        console.warn(`No video found for participant ${pinnedParticipant}`);
        
        // Try to find audio for this participant
        const audioEl = document.getElementById(`audio-${pinnedParticipant}`);
        if (audioEl && audioEl.srcObject) {
          console.log(`Found audio-only stream for participant ${pinnedParticipant}`);
          mainVideo.srcObject = null;
        } else {
          console.warn(`No media found for participant ${pinnedParticipant}, resetting to local`);
          window.appState.pinnedParticipant = 'local';
          
          // Release the lock before recursion
          mainVideoUpdateInProgress = false;
          updateMainVideo();
          return;
        }
      }
    }
  } catch (error) {
    console.error('Error updating main video:', error);
  } finally {
    // Always clear the flag when done - reduced timeout for responsiveness
    setTimeout(() => {
      mainVideoUpdateInProgress = false;
    }, 100);
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
    controls = document.createElement('div');
    controls.className = 'local-controls absolute top-2 right-2 flex gap-1 z-10';
    localVideoContainer.appendChild(controls);
  }
  
  // Check if pin button already exists
  let pinBtn = controls.querySelector('.pin-btn');
  if (!pinBtn) {
    pinBtn = document.createElement('button');
    pinBtn.className = 'participant-control pin-btn bg-black bg-opacity-50 text-white p-2 rounded hover:bg-opacity-75';
    pinBtn.title = 'Pin to main view';
    pinBtn.setAttribute('aria-label', 'Pin video to main view');
    pinBtn.setAttribute('data-participant-id', 'local');
    pinBtn.innerHTML = '<i class="fas fa-thumbtack"></i>';
    controls.appendChild(pinBtn);
  }
  
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

// OPTIMIZED: Refresh all media displays with anti-flashing protection
export function refreshMediaDisplays() {
  console.log('Refreshing all media displays');
  
  // CRITICAL: Prevent concurrent refresh operations
  if (refreshInProgress) {
    console.log('Refresh already in progress, skipping');
    return;
  }
  
  refreshInProgress = true;
  
  try {
    // First, check if we're in audio-only or view-only mode and remove all placeholders
    if (window.appState.audioOnlyMode || window.appState.viewOnlyMode) {
      console.log('In special mode, removing all video placeholders');
      
      const staticPlaceholder = document.getElementById('noVideoPlaceholder');
      if (staticPlaceholder) {
        staticPlaceholder.remove();
      }
      
      document.querySelectorAll('.no-video-placeholder').forEach(placeholder => {
        placeholder.remove();
      });
    }
    
    // Update main video using debounced version to prevent rapid updates
    if (!mainVideoUpdateInProgress) {
      debouncedUpdateMainVideo();
    }
    
    // OPTIMIZED: Only update videos that actually need updating
    const participantVideos = document.querySelectorAll('.video-container video');
    participantVideos.forEach(video => {
      const participantId = video.getAttribute('data-participant-id');
      if (!participantId) return;
      
      // ANTI-FLASHING: Only refresh if the video has issues
      const needsRefresh = !video.srcObject || 
                          video.paused || 
                          video.readyState < 2 || 
                          video.networkState > 2;
      
      if (needsRefresh) {
        if (participantId !== 'local' && window.appState.peerConnections[participantId]) {
          const peerConnection = window.appState.peerConnections[participantId];
          const stream = peerConnection.remoteStream;
          
          if (stream && stream !== video.srcObject) {
            video.srcObject = stream;
            video.play().catch(err => {
              console.warn(`Could not autoplay video for ${participantId}: ${err.message}`);
            });
          }
        } else if (participantId === 'local' && window.appState.localStream) {
          if (window.appState.localStream !== video.srcObject) {
            video.srcObject = window.appState.localStream;
            video.play().catch(err => {
              console.warn(`Could not autoplay local video: ${err.message}`);
            });
          }
        }
      }
    });
    
    // OPTIMIZED: Similarly for audio elements
    const audioElements = document.querySelectorAll('audio');
    audioElements.forEach(audio => {
      const participantId = audio.getAttribute('data-participant-id');
      if (!participantId) return;
      
      const needsRefresh = !audio.srcObject || 
                          audio.paused || 
                          audio.readyState < 2 || 
                          audio.networkState > 2;
      
      if (needsRefresh && participantId !== 'local' && window.appState.peerConnections[participantId]) {
        const peerConnection = window.appState.peerConnections[participantId];
        const stream = peerConnection.remoteStream;
        
        if (stream && stream !== audio.srcObject) {
          audio.srcObject = stream;
          audio.play().catch(err => {
            console.warn(`Could not autoplay audio for ${participantId}: ${err.message}`);
          });
        }
      }
    });
    
    // Update pin button states
    updateLocalPinButtonState();
    
    // Update all participant pin buttons with debouncing
    setTimeout(() => {
      import('../ui/events.js').then(({ updatePinButtonStates, setupMobileButtonHandlers }) => {
        if (typeof updatePinButtonStates === 'function') {
          updatePinButtonStates();
        }
        
        if (typeof setupMobileButtonHandlers === 'function') {
          setupMobileButtonHandlers();
        }
      }).catch(err => {
        console.warn('Could not update buttons after refresh:', err);
      });
    }, 100);
    
  } finally {
    // Release the refresh lock after a short delay
    setTimeout(() => {
      refreshInProgress = false;
    }, 200);
  }
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
  
  // Make fullscreen button more prominent on mobile
  if (window.innerWidth <= 768) {
    mainFullscreenBtn.style.fontSize = '1.2rem';
    mainFullscreenBtn.style.padding = '0.75rem';
    mainFullscreenBtn.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    mainFullscreenBtn.style.borderRadius = '50%';
    mainFullscreenBtn.style.zIndex = '1000';
  }
  
  // Function to check if we should use native video fullscreen (iOS and some mobile browsers)
  const shouldUseNativeVideoFullscreen = () => {
    // Check if we're on mobile
    const isMobile = window.innerWidth <= 768 || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    
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
  
  // REMOVED: Video container click/touch handlers to allow play/pause interaction
  // Now only the fullscreen button can trigger fullscreen, leaving video area free for play/pause
  
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
      // CRITICAL: Restore video state after exiting fullscreen
      restoreVideoAfterFullscreen();
    }
  });
  
  // Also handle webkit prefixed event for Safari
  document.addEventListener('webkitfullscreenchange', () => {
    if (document.webkitFullscreenElement) {
      mainFullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
    } else {
      mainFullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
      // CRITICAL: Restore video state after exiting fullscreen
      restoreVideoAfterFullscreen();
    }
  });
  
  // Also handle native video fullscreen changes (iOS/Android)
  mainVideo.addEventListener('webkitfullscreenchange', () => {
    if (!mainVideo.webkitDisplayingFullscreen) {
      // Exiting native video fullscreen
      mainFullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
      restoreVideoAfterFullscreen();
    }
  });
  
  // Function to restore video state after exiting fullscreen
  function restoreVideoAfterFullscreen() {
    console.log('Restoring video after fullscreen exit');
    
    setTimeout(() => {
      // Remove controls that were added for fullscreen
      mainVideo.removeAttribute('controls');
      
      // CRITICAL: Force remove any poster attribute that might be showing
      mainVideo.removeAttribute('poster');
      
      // Store current stream reference before restoration
      const currentStream = mainVideo.srcObject;
      console.log('Current stream after fullscreen:', currentStream);
      
      // MOBILE FIX: Force reset the video element to clear any stuck states
      const originalStream = currentStream;
      
      // Temporarily clear and restore the stream to force refresh
      mainVideo.srcObject = null;
      
      // Add a temporary play hint overlay for mobile users
      if (window.innerWidth <= 768) {
        const playHint = document.createElement('div');
        playHint.className = 'play-hint-overlay';
        playHint.innerHTML = '<i class="fas fa-play"></i><br><small>Tap to resume</small>';
        playHint.style.cssText = `
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(0, 0, 0, 0.8);
          color: white;
          padding: 1rem;
          border-radius: 0.5rem;
          text-align: center;
          z-index: 999;
          pointer-events: none;
        `;
        mainVideoContainer.appendChild(playHint);
        
        // Remove the hint after 3 seconds
        setTimeout(() => {
          if (playHint.parentNode) {
            playHint.remove();
          }
        }, 3000);
      }
      
      setTimeout(() => {
        // If we lost the stream, restore it
        if (!originalStream) {
          console.log('Stream was lost during fullscreen, restoring...');
          
          // Restore the appropriate stream based on pinned participant
          if (window.appState.pinnedParticipant === 'local') {
            if (window.appState.screenStream && window.appState.isScreenSharing) {
              // Restore screen share stream
              const combinedStream = new MediaStream();
              const screenVideoTrack = window.appState.screenStream.getVideoTracks()[0];
              if (screenVideoTrack && screenVideoTrack.readyState === 'live') {
                combinedStream.addTrack(screenVideoTrack);
              }
              if (window.appState.localStream) {
                window.appState.localStream.getAudioTracks().forEach(track => {
                  if (track.readyState === 'live') {
                    combinedStream.addTrack(track);
                  }
                });
              }
              mainVideo.srcObject = combinedStream;
            } else if (window.appState.localStream) {
              // Restore local camera stream
              mainVideo.srcObject = window.appState.localStream;
            }
          } else if (window.appState.pinnedParticipant && window.appState.peerConnections[window.appState.pinnedParticipant]) {
            // Restore remote participant stream
            const peerConnection = window.appState.peerConnections[window.appState.pinnedParticipant];
            if (peerConnection.remoteStream) {
              mainVideo.srcObject = peerConnection.remoteStream;
            }
          }
        } else {
          // Restore the original stream
          mainVideo.srcObject = originalStream;
        }
        
        // Ensure video is set to autoplay and muted appropriately
        mainVideo.autoplay = true;
        mainVideo.playsInline = true;
        mainVideo.controls = false;
        
        // MOBILE FIX: Force remove any visual artifacts
        mainVideo.style.objectFit = 'contain';
        mainVideo.style.background = 'transparent';
        
        // For local video, always mute to prevent feedback
        if (window.appState.pinnedParticipant === 'local') {
          mainVideo.muted = true;
        } else {
          // For remote participants, unmute
          mainVideo.muted = false;
        }
        
        // CRITICAL: Force the video to play again with multiple attempts
        console.log('Attempting to play video after fullscreen exit');
        
        const forcePlay = () => {
          const playPromise = mainVideo.play();
          if (playPromise !== undefined) {
            playPromise.then(() => {
              console.log('✅ Video resumed playing after fullscreen exit');
              
              // MOBILE FIX: Force trigger a resize/redraw to clear any stuck UI
              setTimeout(() => {
                mainVideo.style.transform = 'scale(1.0001)';
                setTimeout(() => {
                  mainVideo.style.transform = 'scale(1)';
                }, 50);
              }, 100);
              
            }).catch(err => {
              console.warn('❌ Could not resume video after fullscreen:', err);
              
              // If autoplay fails, try with muted first
              if (!mainVideo.muted) {
                console.log('Trying muted playback as fallback');
                mainVideo.muted = true;
                mainVideo.play().then(() => {
                  console.log('✅ Video playing muted after fullscreen exit');
                  // Try to unmute after a short delay if it's a remote participant
                  if (window.appState.pinnedParticipant !== 'local') {
                    setTimeout(() => {
                      console.log('Attempting to unmute remote participant');
                      mainVideo.muted = false;
                    }, 1000);
                  }
                }).catch(e => {
                  console.warn('❌ Still cannot play video after fullscreen:', e);
                  
                  // Last resort: trigger a complete video update
                  console.log('Triggering complete video update as last resort');
                  setTimeout(() => {
                    updateMainVideo();
                  }, 500);
                });
              } else {
                // Already muted and still can't play - trigger video update
                console.log('Video already muted but still cannot play, triggering update');
                setTimeout(() => {
                  updateMainVideo();
                }, 500);
              }
            });
          }
        };
        
        // Try playing immediately and with a small delay
        forcePlay();
        setTimeout(forcePlay, 100);
        
        // Also trigger a debounced video update to ensure proper state
        setTimeout(() => {
          console.log('Triggering debounced video update after fullscreen');
          debouncedUpdateMainVideo();
        }, 1000);
        
      }, 50); // Small delay to ensure the srcObject reset takes effect
      
    }, 200); // Increased delay to ensure fullscreen transition is complete
  }
}