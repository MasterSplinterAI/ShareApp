// Video UI module for handling video display elements

import { debounce } from '../utils/helpers.js';
import { getSocketId } from '../services/socket.js';

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
        // Create placeholder if it doesn't exist with avatar
        const newPlaceholder = document.createElement('div');
        newPlaceholder.className = 'no-video-placeholder absolute inset-0 flex items-center justify-center zoom-like-avatar';
        
        // Get user's name for initials
        const userName = window.appState.participants['local']?.name || 
                        window.appState.participants[getSocketId()]?.name || 
                        'You';
        const initials = userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || 'U';
        
        newPlaceholder.innerHTML = `
          <div class="avatar-circle bg-blue-600 text-white text-2xl font-bold flex items-center justify-center w-20 h-20 rounded-full">
            ${initials}
          </div>
          <div class="speaking-indicator absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1 hidden">
            <div class="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
          </div>
        `;
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
    // Don't remove placeholder here - let the individual sections handle it based on video state
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
    
    // Check if pinned participant is a screen share tile
    if (pinnedParticipant && pinnedParticipant.startsWith('screen-share-')) {
      console.log(`Setting screen share as main video: ${pinnedParticipant}`);
      
      const screenShareContainer = document.getElementById(pinnedParticipant);
      if (screenShareContainer) {
        // Hide the screen share tile in the grid
        screenShareContainer.classList.add('hidden');
        
        const screenShareVideo = screenShareContainer.querySelector('video');
        if (screenShareVideo && screenShareVideo.srcObject) {
          mainVideo.srcObject = screenShareVideo.srcObject;
          mainVideo.muted = true;
          
          // Update label
          if (mainParticipantName) {
            const label = screenShareContainer.querySelector('.video-label span');
            mainParticipantName.textContent = label ? label.textContent : 'Screen Share';
          }
          
          // Hide placeholder
          if (mainVideoPlaceholder) {
            mainVideoPlaceholder.classList.add('hidden');
          }
          
          // Try to play
          mainVideo.play().catch(err => {
            console.warn('Could not play screen share in main video:', err);
          });
          
          mainVideoUpdateInProgress = false;
          return;
        }
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
      
      // Set main video to local stream (camera feed)
      // NOTE: Screen share should NOT appear in main video when local is pinned
      // Screen share has its own separate tile
      if (window.appState.localStream) {
        console.log('Using local camera stream for main video');
        
        try {
          // Check if we have enabled video tracks (camera only, not screen share)
          const videoTracks = window.appState.localStream.getVideoTracks();
          const cameraTracks = videoTracks.filter(track => 
            !track.label.toLowerCase().includes('screen') &&
            !track.label.toLowerCase().includes('desktop') &&
            !track.label.toLowerCase().includes('window') &&
            !track.label.toLowerCase().includes('display')
          );
          
          const hasEnabledVideoTracks = cameraTracks.some(
            t => t.enabled && t.readyState === 'live'
          );
          
          // If no enabled video tracks, show placeholder
          if (!hasEnabledVideoTracks || !window.appState.isCameraOn) {
            console.log('Local video is off, showing placeholder in main video');
            
            // Clear video stream
            mainVideo.srcObject = null;
            
            // Show placeholder with avatar
            let placeholder = mainVideoContainer?.querySelector('.no-video-placeholder');
            if (!placeholder) {
              placeholder = document.createElement('div');
              placeholder.id = 'noVideoPlaceholder';
              placeholder.className = 'no-video-placeholder absolute inset-0 flex items-center justify-center zoom-like-avatar';
              
              // Get user's name for initials
              const userName = window.appState.participants['local']?.name || 
                              window.appState.participants[getSocketId()]?.name || 
                              'You';
              const initials = userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || 'U';
              
              placeholder.innerHTML = `
                <div class="flex flex-col items-center justify-center">
                  <div class="avatar-circle bg-blue-600 text-white text-5xl font-bold flex items-center justify-center w-32 h-32 rounded-full mb-4">
                    ${initials}
                  </div>
                  <div class="text-white text-lg font-medium">${userName}</div>
                  <div class="text-gray-400 text-sm mt-2">Camera is off</div>
                  <div class="speaking-indicator absolute bottom-4 left-1/2 transform -translate-x-1/2 hidden">
                    <div class="w-4 h-4 bg-green-500 rounded-full animate-pulse"></div>
                  </div>
                </div>
              `;
              
              if (mainVideoContainer) {
                mainVideoContainer.appendChild(placeholder);
              }
            } else {
              // Update placeholder if it exists
              placeholder.classList.remove('hidden');
            }
            
            // Reset container aspect ratio
            if (mainVideoContainer) {
              mainVideoContainer.style.aspectRatio = '16/9';
            }
            
            return;
          }
          
          // Remove placeholder if video is enabled
          const placeholder = mainVideoContainer?.querySelector('.no-video-placeholder');
          if (placeholder) {
            placeholder.classList.add('hidden');
          }
          
          // ANTI-FLASHING: Only reset if we need to
          const currentStream = mainVideo.srcObject;
          // Check if current stream has camera tracks (not screen share)
          const currentVideoTracks = currentStream ? currentStream.getVideoTracks() : [];
          const currentCameraTracks = currentVideoTracks.filter(track => 
            !track.label.toLowerCase().includes('screen') &&
            !track.label.toLowerCase().includes('desktop') &&
            !track.label.toLowerCase().includes('window') &&
            !track.label.toLowerCase().includes('display')
          );
          
          const needsUpdate = !currentStream || 
                             currentCameraTracks.length === 0 ||
                             !hasEnabledVideoTracks ||
                             !currentCameraTracks.some(t => t.enabled && t.readyState === 'live');
          
          if (needsUpdate || hasEnabledVideoTracks) {
            console.log('Updating main video with local stream, hasEnabledVideoTracks:', hasEnabledVideoTracks);
            
            // Set required attributes before setting srcObject
            mainVideo.autoplay = true;
            mainVideo.playsInline = true;
            mainVideo.muted = true; // To prevent feedback
            mainVideo.controls = false;
            
            // Ensure object-contain for proper aspect ratio (no cropping)
            mainVideo.style.objectFit = 'contain';
            
            // Set video properties
            mainVideo.style.display = '';
            mainVideo.style.visibility = 'visible';
            mainVideo.style.opacity = '1';
            
            // Adjust main video container aspect ratio if portrait video
            mainVideo.onloadedmetadata = () => {
              if (mainVideo.videoWidth > 0 && mainVideo.videoHeight > 0) {
                const aspectRatio = mainVideo.videoWidth / mainVideo.videoHeight;
                if (aspectRatio < 1 && mainVideoContainer) {
                  // Portrait video - adjust container
                  mainVideoContainer.style.aspectRatio = `${mainVideo.videoHeight} / ${mainVideo.videoWidth}`;
                } else if (mainVideoContainer) {
                  // Landscape video - use standard 16:9
                  mainVideoContainer.style.aspectRatio = '16/9';
                }
              }
            };
            
            // Create a clean stream with only camera tracks (no screen share)
            const cameraStream = new MediaStream();
            cameraTracks.forEach(track => {
              if (track.enabled && track.readyState === 'live') {
                cameraStream.addTrack(track);
              }
            });
            // Add audio tracks
            window.appState.localStream.getAudioTracks().forEach(track => {
              if (track.readyState === 'live') {
                cameraStream.addTrack(track);
              }
            });
            
            // Force update the stream
            mainVideo.srcObject = null; // Clear first
            setTimeout(() => {
              mainVideo.srcObject = cameraStream;
              
              // Try to play the video
              mainVideo.play().then(() => {
                console.log('Local video playing successfully in main view');
                if (mainVideo.videoWidth > 0) {
                  console.log(`Video dimensions: ${mainVideo.videoWidth}x${mainVideo.videoHeight}`);
                }
              }).catch(err => {
                console.warn('Could not autoplay local video:', err);
                // Try again on user interaction
                if (!window.hasLocalPlayHandler) {
                  window.hasLocalPlayHandler = true;
                  document.addEventListener('click', function tryPlayLocal() {
                    mainVideo.play().catch(e => console.warn('Still cannot play:', e));
                    document.removeEventListener('click', tryPlayLocal);
                  }, { once: true });
                }
              });
            }, 50);
          } else {
            console.log('No update needed for main video');
          }
        } catch (err) {
          console.error('Error setting local stream to main video:', err);
        }
      } else {
        // No local stream at all - show placeholder
        console.log('No local stream, showing placeholder');
        let placeholder = mainVideoContainer?.querySelector('.no-video-placeholder');
        if (!placeholder) {
          placeholder = document.createElement('div');
          placeholder.id = 'noVideoPlaceholder';
          placeholder.className = 'no-video-placeholder absolute inset-0 flex items-center justify-center zoom-like-avatar';
          
          const userName = window.appState.participants['local']?.name || 
                          window.appState.participants[getSocketId()]?.name || 
                          'You';
          const initials = userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || 'U';
          
          placeholder.innerHTML = `
            <div class="flex flex-col items-center justify-center">
              <div class="avatar-circle bg-blue-600 text-white text-5xl font-bold flex items-center justify-center w-32 h-32 rounded-full mb-4">
                ${initials}
              </div>
              <div class="text-white text-lg font-medium">${userName}</div>
              <div class="text-gray-400 text-sm mt-2">Camera is off</div>
            </div>
          `;
          
          if (mainVideoContainer) {
            mainVideoContainer.appendChild(placeholder);
          }
        } else {
          placeholder.classList.remove('hidden');
        }
        
        mainVideo.srcObject = null;
      }
      
      // IMPORTANT: Always mute when showing local content to prevent echo
      mainVideo.muted = true;
    } 
    // If we're showing another participant (not a screen share)
    else if (pinnedParticipant && !pinnedParticipant.startsWith('screen-share-')) {
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
        // Check if participant has enabled video tracks
        const stream = participantVideo.srcObject;
        const hasEnabledVideo = stream.getVideoTracks().some(t => t.enabled && t.readyState === 'live');
        
        if (!hasEnabledVideo) {
          // Participant has no video - show placeholder
          console.log(`Participant ${pinnedParticipant} has no video, showing placeholder`);
          mainVideo.srcObject = null;
          
          // Show placeholder with avatar
          let placeholder = mainVideoContainer?.querySelector('.no-video-placeholder');
          if (!placeholder) {
            placeholder = document.createElement('div');
            placeholder.id = 'noVideoPlaceholder';
            placeholder.className = 'no-video-placeholder absolute inset-0 flex items-center justify-center zoom-like-avatar';
            
            const participant = window.appState.participants[pinnedParticipant];
            const userName = participant?.name || `Participant ${pinnedParticipant.substring(0, 5)}`;
            const initials = userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || 'U';
            
            placeholder.innerHTML = `
              <div class="flex flex-col items-center justify-center">
                <div class="avatar-circle bg-blue-600 text-white text-5xl font-bold flex items-center justify-center w-32 h-32 rounded-full mb-4">
                  ${initials}
                </div>
                <div class="text-white text-lg font-medium">${userName}${participant?.isHost ? ' (Host)' : ''}</div>
                <div class="text-gray-400 text-sm mt-2">Camera is off</div>
              </div>
            `;
            
            if (mainVideoContainer) {
              mainVideoContainer.appendChild(placeholder);
            }
          } else {
            placeholder.classList.remove('hidden');
          }
          
          // Reset container aspect ratio
          if (mainVideoContainer) {
            mainVideoContainer.style.aspectRatio = '16/9';
          }
          
          return;
        }
        
        // Remove placeholder if video is enabled
        const placeholder = mainVideoContainer?.querySelector('.no-video-placeholder');
        if (placeholder) {
          placeholder.classList.add('hidden');
        }
        
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
            
            // Ensure object-contain for proper aspect ratio (no cropping)
            mainVideo.style.objectFit = 'contain';
            
            // Ensure video is visible
            mainVideo.style.display = '';
            mainVideo.style.visibility = 'visible';
            
            // Adjust container aspect ratio if portrait video
            participantVideo.onloadedmetadata = () => {
              if (participantVideo.videoWidth > 0 && participantVideo.videoHeight > 0) {
                const aspectRatio = participantVideo.videoWidth / participantVideo.videoHeight;
                if (aspectRatio < 1 && mainVideoContainer) {
                  // Portrait video - adjust main container
                  mainVideoContainer.style.aspectRatio = `${participantVideo.videoHeight} / ${participantVideo.videoWidth}`;
                } else if (mainVideoContainer) {
                  // Landscape video - use standard 16:9
                  mainVideoContainer.style.aspectRatio = '16/9';
                }
              }
            };
            
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
        
        // Show placeholder for audio-only participant
        const audioEl = document.getElementById(`audio-${pinnedParticipant}`);
        if (audioEl && audioEl.srcObject) {
          console.log(`Found audio-only stream for participant ${pinnedParticipant}, showing placeholder`);
          mainVideo.srcObject = null;
          
          // Show placeholder
          let placeholder = mainVideoContainer?.querySelector('.no-video-placeholder');
          if (!placeholder) {
            placeholder = document.createElement('div');
            placeholder.id = 'noVideoPlaceholder';
            placeholder.className = 'no-video-placeholder absolute inset-0 flex items-center justify-center zoom-like-avatar';
            
            const participant = window.appState.participants[pinnedParticipant];
            const userName = participant?.name || `Participant ${pinnedParticipant.substring(0, 5)}`;
            const initials = userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || 'U';
            
            placeholder.innerHTML = `
              <div class="flex flex-col items-center justify-center">
                <div class="avatar-circle bg-blue-600 text-white text-5xl font-bold flex items-center justify-center w-32 h-32 rounded-full mb-4">
                  ${initials}
                </div>
                <div class="text-white text-lg font-medium">${userName}${participant?.isHost ? ' (Host)' : ''}</div>
                <div class="text-gray-400 text-sm mt-2">Camera is off</div>
              </div>
            `;
            
            if (mainVideoContainer) {
              mainVideoContainer.appendChild(placeholder);
            }
          } else {
            placeholder.classList.remove('hidden');
          }
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
  
  console.log('Setting up fullscreen button, mobile detected:', window.innerWidth <= 768);
  
  // Add a special close button that's only visible in fullscreen mode
  const mobileCloseBtn = document.createElement('button');
  mobileCloseBtn.className = 'mobile-fullscreen-close';
  mobileCloseBtn.innerHTML = '<i class="fas fa-times"></i>';
  mobileCloseBtn.setAttribute('aria-label', 'Exit Fullscreen');
  mainVideoContainer.appendChild(mobileCloseBtn);
  
  // Ensure fullscreen button is properly touchable on mobile
  if (window.innerWidth <= 768) {
    mainFullscreenBtn.style.minWidth = '44px';
    mainFullscreenBtn.style.minHeight = '44px';
    mainFullscreenBtn.style.fontSize = '1.1rem';
    mainFullscreenBtn.style.touchAction = 'manipulation';
    mainFullscreenBtn.style.webkitTouchCallout = 'none';
    mainFullscreenBtn.style.webkitUserSelect = 'none';
    mainFullscreenBtn.style.userSelect = 'none';
    mainFullscreenBtn.style.pointerEvents = 'auto';
    mainFullscreenBtn.style.position = 'absolute';
    mainFullscreenBtn.style.zIndex = '1000';
    console.log('Applied mobile touch styles to fullscreen button');
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
    e.preventDefault();
    e.stopPropagation();
    console.log('Fullscreen button clicked');
    
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      enterFullscreen();
    } else {
      exitFullscreen();
    }
  });
  
  // Also add touch event for mobile reliability
  mainFullscreenBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Fullscreen button touched');
    
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      enterFullscreen();
    } else {
      exitFullscreen();
    }
  }, { passive: false });
  
  // Add touchstart for immediate feedback
  mainFullscreenBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    console.log('Fullscreen button touch started');
    mainFullscreenBtn.style.backgroundColor = 'rgba(52, 152, 219, 0.7)';
  }, { passive: false });
  
  // Reset style on touchend
  mainFullscreenBtn.addEventListener('touchend', (e) => {
    setTimeout(() => {
      mainFullscreenBtn.style.backgroundColor = '';
    }, 150);
  }, { passive: false });
  
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