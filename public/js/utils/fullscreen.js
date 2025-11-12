/**
 * Fullscreen utility for video tiles
 * Allows any video container to be fullscreened
 */

/**
 * Setup fullscreen button for a video container
 * @param {HTMLElement} container - The video container element
 * @param {HTMLElement} videoElement - The video element inside the container
 */
export function setupFullscreenForTile(container, videoElement) {
  if (!container || !videoElement) {
    console.warn('Cannot setup fullscreen - container or video element missing');
    return;
  }

  // Check if fullscreen button already exists
  let fullscreenBtn = container.querySelector('.tile-fullscreen-btn');
  if (fullscreenBtn) {
    // Button already exists, just ensure it's set up
    return;
  }

  // Create fullscreen button
  fullscreenBtn = document.createElement('button');
  fullscreenBtn.className = 'tile-fullscreen-btn absolute top-2 right-2 z-20 bg-black bg-opacity-50 hover:bg-opacity-75 text-white p-1.5 rounded text-sm';
  fullscreenBtn.style.width = '32px';
  fullscreenBtn.style.height = '32px';
  fullscreenBtn.style.display = 'flex';
  fullscreenBtn.style.alignItems = 'center';
  fullscreenBtn.style.justifyContent = 'center';
  fullscreenBtn.innerHTML = '<i class="fas fa-expand text-xs"></i>';
  fullscreenBtn.title = 'Full Screen';
  fullscreenBtn.setAttribute('aria-label', 'Toggle Full Screen');

  // Mobile touch styles
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    fullscreenBtn.style.minWidth = '44px';
    fullscreenBtn.style.minHeight = '44px';
    fullscreenBtn.style.fontSize = '1.1rem';
    fullscreenBtn.style.touchAction = 'manipulation';
    fullscreenBtn.style.webkitTouchCallout = 'none';
    fullscreenBtn.style.webkitUserSelect = 'none';
    fullscreenBtn.style.userSelect = 'none';
    fullscreenBtn.style.pointerEvents = 'auto';
  }

  // Add button to container
  container.appendChild(fullscreenBtn);

  // Ensure inline playback; do not force-disable PiP or controls
  videoElement.setAttribute('playsinline', 'true');

  // Handle PiP events for mobile
  if ('pictureInPictureEnabled' in document) {
    videoElement.addEventListener('enterpictureinpicture', () => {
      console.log('Entered PiP');
    });

    videoElement.addEventListener('leavepictureinpicture', () => {
      console.log('Exited PiP - attempting resume');
      if (videoElement.srcObject && videoElement.paused) {
        videoElement.play().catch(err => console.warn('Auto-resume after PiP failed:', err));
      }
    });
  }

  // Do not aggressively prevent pause; only resume on explicit events

  // Function to check if we should use native video fullscreen (iOS and some mobile browsers)
  const shouldUseNativeVideoFullscreen = () => {
    const isMobile = window.innerWidth <= 768 || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) && !window.MSStream;
    const isAndroid = /Android/i.test(navigator.userAgent);
    return isMobile && (isIOS || isAndroid);
  };

  // Function to enter fullscreen
  const enterFullscreen = () => {
    try {
      if (shouldUseNativeVideoFullscreen()) {
        // On iOS/mobile, use the video element's native fullscreen
        console.log('Using native video fullscreen for tile');
        videoElement.setAttribute('playsinline', 'true');
        videoElement.setAttribute('controls', 'true');
        
        if (videoElement.webkitEnterFullscreen) {
          videoElement.webkitEnterFullscreen();
        } else if (videoElement.requestFullscreen) {
          videoElement.requestFullscreen();
        } else if (videoElement.webkitRequestFullscreen) {
          videoElement.webkitRequestFullscreen();
        } else {
          // Fallback to container fullscreen
          container.requestFullscreen();
        }
      } else {
        // On desktop, use the container element's fullscreen
        if (container.requestFullscreen) {
          container.requestFullscreen();
        } else if (container.webkitRequestFullscreen) {
          container.webkitRequestFullscreen();
        } else if (container.msRequestFullscreen) {
          container.msRequestFullscreen();
        } else if (container.mozRequestFullScreen) {
          container.mozRequestFullScreen();
        }
      }
      
      fullscreenBtn.innerHTML = '<i class="fas fa-compress text-xs"></i>';
    } catch (err) {
      console.error('Fullscreen error:', err);
    }
  };

  // Function to exit fullscreen
  const exitFullscreen = () => {
    try {
      // No-op
      
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      }
      
      fullscreenBtn.innerHTML = '<i class="fas fa-expand text-xs"></i>';

      // Gently resume if paused after fullscreen exit
      if (videoElement.srcObject && videoElement.paused) {
        videoElement.play().catch(err => {
          console.warn('Resume after fullscreen failed:', err);
        });
      }
    } catch (err) {
      console.error('Exit fullscreen error:', err);
    }
  };

  // Handle click
  fullscreenBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Tile fullscreen button clicked');
    
    const isFullscreen = document.fullscreenElement || 
                        document.webkitFullscreenElement || 
                        document.mozFullScreenElement ||
                        document.msFullscreenElement;
    
    if (!isFullscreen) {
      enterFullscreen();
    } else {
      exitFullscreen();
    }
  });

  // Handle touch events for mobile
  fullscreenBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Tile fullscreen button touched');
    
    const isFullscreen = document.fullscreenElement || 
                        document.webkitFullscreenElement || 
                        document.mozFullScreenElement ||
                        document.msFullscreenElement;
    
    if (!isFullscreen) {
      enterFullscreen();
    } else {
      exitFullscreen();
    }
  });

  // Update button when fullscreen changes
  const updateButton = () => {
    const isFullscreen = document.fullscreenElement === container || 
                        document.webkitFullscreenElement === container ||
                        document.mozFullScreenElement === container ||
                        document.msFullscreenElement === container;
    
    if (isFullscreen) {
      fullscreenBtn.innerHTML = '<i class="fas fa-compress text-xs"></i>';
    } else {
      fullscreenBtn.innerHTML = '<i class="fas fa-expand text-xs"></i>';
      // Attempt resume if needed
      if (videoElement.srcObject && videoElement.paused) {
        videoElement.play().catch(err => console.warn('Resume after fullscreen change failed:', err));
      }
    }
  };

  // Listen for fullscreen changes
  document.addEventListener('fullscreenchange', updateButton);
  document.addEventListener('webkitfullscreenchange', updateButton);
  document.addEventListener('mozfullscreenchange', updateButton);
  document.addEventListener('MSFullscreenChange', updateButton);

  // Also handle native video fullscreen changes (iOS/Android)
  videoElement.addEventListener('webkitfullscreenchange', () => {
    if (!videoElement.webkitDisplayingFullscreen) {
      fullscreenBtn.innerHTML = '<i class="fas fa-expand text-xs"></i>';
      // Ensure video continues playing
      if (videoElement.paused && videoElement.srcObject) {
        videoElement.play().catch(err => {
          console.warn('Could not resume video after native fullscreen:', err);
        });
      }
    }
  });

  console.log('Fullscreen button setup complete for tile');
}

/**
 * Setup fullscreen for all existing video tiles
 */
export function setupFullscreenForAllTiles() {
  const containers = document.querySelectorAll('.video-container');
  containers.forEach(container => {
    const videoElement = container.querySelector('video');
    if (videoElement) {
      setupFullscreenForTile(container, videoElement);
    }
  });
}

