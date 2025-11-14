// Video grid component for tile management, layout, and fullscreen
import { logger } from '../core/Logger.js';
import { eventBus } from '../core/EventBus.js';
import { stateManager } from '../core/StateManager.js';
import { config } from '../core/Config.js';

class VideoGrid {
  constructor() {
    this.container = null;
    this.tiles = new Map(); // peerId -> { container, video, label }
    this.setupContainer();
    this.setupEventListeners();
  }

  /**
   * Setup container element
   */
  setupContainer() {
    this.container = document.getElementById('participantsGrid');
    if (!this.container) {
      logger.warn('VideoGrid', 'Participants grid container not found');
      return;
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Listen for local track events
    eventBus.on('track:camera:added', (data) => {
      this.updateLocalVideo('local', data.track, 'camera');
    });

    eventBus.on('track:camera:stopped', () => {
      this.updateLocalVideo('local', null, 'camera');
    });

    eventBus.on('track:screen:added', (data) => {
      // Create a separate tile for screen share
      this.addVideoTile('local-screen', data.track, 'screen', null);
    });

    eventBus.on('track:screen:stopped', () => {
      this.removeVideoTile('local-screen', 'screen');
    });

    // Listen for remote track events
    eventBus.on('webrtc:track:*', (data) => {
      if (data.peerId !== 'local') {
        // If this is a video track, check if it's enabled before hiding placeholder
        if (data.type === 'camera' || data.type === 'screen') {
          const tileId = data.type === 'screen' ? `${data.peerId}-screen` : data.peerId;
          const tile = this.tiles.get(tileId);
          if (tile) {
            const placeholder = tile.container.querySelector('.no-video-placeholder');
            // Only hide placeholder if track is enabled and ready
            if (placeholder && data.track && data.track.enabled && data.track.readyState === 'live') {
              placeholder.style.display = 'none';
            } else if (placeholder && (!data.track || !data.track.enabled)) {
              // Track is disabled - keep placeholder visible and update state
              placeholder.style.display = 'flex';
              this.updatePlaceholderState(placeholder, data.peerId, null);
            }
          }
        }
        
        // Add video tile with proper labeling
        this.addVideoTile(data.peerId, data.track, data.type, data.stream);
        
        // Update status indicators when track is added
        const tileId = data.type === 'screen' ? `${data.peerId}-screen` : data.peerId;
        setTimeout(() => {
          this.updateStatusIndicators(data.peerId, tileId);
        }, 100);
      }
    });

    eventBus.on('webrtc:trackEnded:*', (data) => {
      logger.info('VideoGrid', 'Track ended event received', { peerId: data.peerId, trackType: data.trackType });
      
      // Handle both local and remote track ended events
      if (data.trackType === 'screen') {
        // Remove screen share tile (local or remote)
        // Use the actual peerId - removeVideoTile will construct the correct tileId
        const peerIdForRemoval = data.peerId === 'local' || data.peerId === 'local-screen' ? 'local' : data.peerId;
        logger.info('VideoGrid', 'Removing screen share tile', { peerId: peerIdForRemoval, trackType: 'screen' });
        this.removeVideoTile(peerIdForRemoval, 'screen');
      } else if (data.trackType === 'camera' && data.peerId !== 'local') {
        // Camera track ended - show placeholder
        const tile = this.tiles.get(data.peerId);
        if (tile) {
          tile.video.style.display = 'none';
          this.showPlaceholder(tile.container);
        }
      } else if (data.peerId !== 'local') {
        this.removeVideoTile(data.peerId, data.trackType);
      }
    });

    // Listen for track disabled events (camera turned off)
    eventBus.on('webrtc:trackDisabled:*', (data) => {
      if (data.trackType === 'camera' && data.peerId !== 'local') {
        const tile = this.tiles.get(data.peerId);
        if (tile && tile.video) {
          // Hide video but keep srcObject attached (track is still live, just disabled)
          tile.video.style.display = 'none';
          tile.video.style.visibility = 'hidden';
          this.showPlaceholder(tile.container);
          logger.info('VideoGrid', 'Showing placeholder for disabled camera', { peerId: data.peerId });
        }
      }
    });

    // Listen for track enabled events (camera turned back on)
    eventBus.on('webrtc:trackEnabled:*', (data) => {
      if (data.trackType === 'camera' && data.peerId !== 'local') {
        const tile = this.tiles.get(data.peerId);
        if (tile && tile.video && data.track) {
          // Show video and hide placeholder
          tile.video.style.display = 'block';
          tile.video.style.visibility = 'visible';
          this.hidePlaceholder(tile.container);
          
          // Ensure video is playing
          if (tile.video.paused && tile.video.srcObject) {
            tile.video.play().catch(err => {
              logger.warn('VideoGrid', 'Failed to play video after re-enable', { peerId: data.peerId, error: err });
            });
          }
          logger.info('VideoGrid', 'Restored video for re-enabled camera', { peerId: data.peerId });
        }
      }
    });

    // Listen for participant changes
    eventBus.on('room:userJoined', (data) => {
      // Create placeholder tile for new participant immediately
      // This ensures they see a placeholder even if video is disabled
      if (data.userId !== stateManager.getState('socketId')) {
        // Check if tile already exists (might have been created from room:joined)
        if (!this.tiles.has(data.userId)) {
          this.createParticipantPlaceholder(data.userId, data.name);
        } else {
          // Update existing placeholder
          const tile = this.tiles.get(data.userId);
          if (tile) {
            const placeholder = tile.container.querySelector('.no-video-placeholder');
            if (placeholder) {
              this.updatePlaceholderState(placeholder, data.userId, data.name);
            }
          }
        }
      }
    });
    
    // Listen for audio level events to show speaking indicator
    eventBus.on('webrtc:audioLevel:*', (data) => {
      const { peerId, isSpeaking } = data;
      const tileId = peerId === 'local' ? 'local' : peerId;
      const tile = this.tiles.get(tileId);
      
      if (tile) {
        // Update speaking indicator in placeholder
        const placeholder = tile.container.querySelector('.no-video-placeholder');
        if (placeholder) {
          const speakingIndicator = placeholder.querySelector('.speaking-indicator');
          if (speakingIndicator) {
            if (isSpeaking) {
              speakingIndicator.classList.remove('hidden');
              tile.container.classList.add('speaking');
            } else {
              speakingIndicator.classList.add('hidden');
              tile.container.classList.remove('speaking');
            }
          }
        }
        
        // Update speaking indicator in label (matching original app)
        if (tile.label) {
          const speakingWrapper = tile.label.querySelector(`.speaking-indicator-wrapper[data-peer-id="${peerId}"]`);
          if (speakingWrapper) {
            if (isSpeaking) {
              speakingWrapper.classList.remove('hidden');
              tile.container.classList.add('speaking');
            } else {
              speakingWrapper.classList.add('hidden');
              tile.container.classList.remove('speaking');
            }
          }
        }
      }
    });
    
    // Listen for peer track updates to update status indicators
    eventBus.on('webrtc:peer:trackUpdated:*', (data) => {
      const { peerId } = data;
      const tileId = peerId === 'local' ? 'local' : peerId;
      const tile = this.tiles.get(tileId);
      
      if (tile) {
        // Update status indicators in label
        this.updateStatusIndicators(peerId, tileId);
        
        // Update placeholder avatar if needed
        const placeholder = tile.container.querySelector('.no-video-placeholder');
        if (placeholder) {
          const participants = stateManager.getState('room.participants') || new Map();
          const participant = participants.get(peerId);
          const name = participant?.name || (peerId === 'local' ? 'You' : peerId.substring(0, 5));
          this.updatePlaceholderState(placeholder, peerId, name);
        }
      }
    });
    
    // Listen for local state changes to update local placeholder and status indicators
    stateManager.subscribe('isMicOn', (isMicOn) => {
      const localTile = this.tiles.get('local');
      if (localTile) {
        this.updateStatusIndicators('local', 'local');
      }
      const localContainer = document.getElementById('localVideoContainer');
      if (localContainer) {
        const placeholder = localContainer.querySelector('.no-video-placeholder');
        if (placeholder) {
          this.updatePlaceholderState(placeholder, 'local', 'You');
        }
      }
    });

    // Listen for room joined to create placeholders for existing participants
    eventBus.on('room:joined', (data) => {
      const socketId = stateManager.getState('socketId');
      if (data.participants && Array.isArray(data.participants)) {
        data.participants.forEach(participant => {
          if (participant.id !== socketId && !this.tiles.has(participant.id)) {
            this.createParticipantPlaceholder(participant.id, participant.name);
            // Update status indicators after creating placeholder
            setTimeout(() => {
              this.updateStatusIndicators(participant.id, participant.id);
            }, 100);
          }
        });
      }
    });

    eventBus.on('room:userLeft', (data) => {
      this.removeVideoTile(data.userId);
    });

    // Listen for state changes
    stateManager.subscribe('layoutMode', (newMode) => {
      this.updateLayout();
    });

    // Listen for local stream changes
    stateManager.subscribe('localStream', (stream) => {
      this.updateLocalVideoFromStream(stream);
    });

    stateManager.subscribe('isCameraOn', (isOn) => {
      const localContainer = document.getElementById('localVideoContainer');
      const localVideo = document.getElementById('localVideo');
      
      // Update status indicators in label
      const localTile = this.tiles.get('local');
      if (localTile) {
        this.updateStatusIndicators('local', 'local');
      }
      
      // Update placeholder state
      const placeholder = localContainer?.querySelector('.no-video-placeholder');
      if (placeholder) {
        this.updatePlaceholderState(placeholder, 'local', 'You');
      }
      
      if (!isOn) {
        // Show placeholder and hide video
        if (localVideo) {
          localVideo.style.display = 'none';
        }
        this.showPlaceholder('local');
      } else {
        // Camera is on - check if we have a track and update display
        const cameraTrack = stateManager.getState('cameraTrack');
        if (cameraTrack && cameraTrack.readyState === 'live' && cameraTrack.enabled) {
          // Small delay to ensure state is fully updated
          setTimeout(() => {
            this.updateLocalVideo('local', cameraTrack, 'camera');
          }, 50);
        } else {
          // No track yet, or track is disabled - show placeholder
          if (localVideo) {
            localVideo.style.display = 'none';
          }
          this.showPlaceholder('local');
        }
      }
    });

    // Also listen for camera enabled event
    eventBus.on('track:camera:enabled', (data) => {
      if (data.track && data.track.readyState === 'live' && data.track.enabled) {
        this.updateLocalVideo('local', data.track, 'camera');
      }
    });

    // Listen for camera added event (includes re-enabled tracks)
    eventBus.on('track:camera:added', (data) => {
      if (data.track && data.track.readyState === 'live' && data.track.enabled) {
        this.updateLocalVideo('local', data.track, 'camera');
      }
    });

    // Listen for orientation changes on mobile
    if (config.environment.isMobile) {
      let orientationTimeout;
      const handleOrientationChange = () => {
        clearTimeout(orientationTimeout);
        orientationTimeout = setTimeout(() => {
          // Update config with new orientation
          const isLandscape = window.innerWidth > window.innerHeight;
          config.environment.isLandscape = isLandscape;
          config.updateOrientation();
          
          // Update all tile aspect ratios
          this.updateTileAspectRatios(isLandscape);
          
          // Update layout
          this.updateLayout();
          
          logger.info('VideoGrid', 'Orientation changed', { isLandscape });
        }, 100);
      };

      window.addEventListener('orientationchange', handleOrientationChange);
      window.addEventListener('resize', handleOrientationChange);
    }
  }

  /**
   * Add video tile
   */
  addVideoTile(peerId, track, trackType, stream) {
    if (!this.container) {
      logger.warn('VideoGrid', 'Container not available');
      return;
    }

    // Special handling for local video - use existing container
    if (peerId === 'local' && trackType === 'camera') {
      this.updateLocalVideo('local', track, 'camera');
      return;
    }

    // For screen share, use a separate tile ID to avoid replacing camera feed
    const tileId = trackType === 'screen' ? `${peerId}-screen` : peerId;

    // Get or create tile container
    let tile = this.tiles.get(tileId);
    if (!tile) {
      tile = this.createTileContainer(tileId);
      this.tiles.set(tileId, tile);
    }

    // Create video element if needed
    if (!tile.video) {
      tile.video = document.createElement('video');
      tile.video.autoplay = true;
      tile.video.playsInline = true;
      tile.video.muted = peerId !== 'local' && peerId !== 'local-screen';
      tile.video.setAttribute('playsinline', 'true');
      tile.video.setAttribute('webkit-playsinline', 'true');
      tile.video.style.cssText = `
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: #000;
        position: absolute;
        top: 0;
        left: 0;
        z-index: 1;
      `;
      tile.container.appendChild(tile.video);
    }

    // Set stream source
    if (stream) {
      tile.video.srcObject = stream;
    } else if (track) {
      const newStream = new MediaStream([track]);
      tile.video.srcObject = newStream;
    }

    // Check if track is enabled before showing video
    // For camera tracks, if disabled, show placeholder but keep srcObject attached
    const shouldShowVideo = !track || (track.enabled && track.readyState === 'live') || trackType === 'screen';
    
    // Get placeholder reference
    const placeholder = tile.container.querySelector('.no-video-placeholder');
    
    if (shouldShowVideo) {
      // Hide placeholder when video is enabled and ready
      if (placeholder) {
        placeholder.style.display = 'none';
      }

      // Ensure video is visible
      tile.video.style.display = 'block';
      tile.video.style.visibility = 'visible';
    } else {
      // Track is disabled or not ready - show placeholder, keep video hidden but srcObject attached
      tile.video.style.display = 'none';
      tile.video.style.visibility = 'hidden';
      if (!placeholder) {
        // Create placeholder if it doesn't exist
        const participants = stateManager.getState('room.participants') || new Map();
        const participant = participants.get(peerId);
        const name = participant?.name || (peerId === 'local' ? 'You' : peerId.substring(0, 5));
        this.showPlaceholder(tile.container);
      } else {
        // Update existing placeholder state
        placeholder.style.display = 'flex';
        const participants = stateManager.getState('room.participants') || new Map();
        const participant = participants.get(peerId);
        const name = participant?.name || (peerId === 'local' ? 'You' : peerId.substring(0, 5));
        this.updatePlaceholderState(placeholder, peerId, name);
      }
    }

    // Play video with retry logic
    const playVideo = async () => {
      try {
        await tile.video.play();
        logger.debug('VideoGrid', 'Video playing', { peerId });
        // Once playing, ensure placeholder is hidden
        if (placeholder) {
          placeholder.style.display = 'none';
        }
      } catch (error) {
        logger.warn('VideoGrid', 'Failed to play video, will retry', { peerId, error });
        // Retry after a short delay
        setTimeout(() => {
          tile.video.play().catch(err => {
            logger.warn('VideoGrid', 'Retry play failed', { peerId, error: err });
          });
        }, 500);
      }
    };

    // Try to play immediately
    playVideo();

    // Also listen for metadata loaded
    tile.video.addEventListener('loadedmetadata', () => {
      playVideo();
    }, { once: true });

    // Listen for video track ended to show placeholder
    if (track) {
      track.onended = () => {
        logger.info('VideoGrid', 'Video track ended, showing placeholder', { peerId });
        this.showPlaceholder(tile.container);
        tile.video.style.display = 'none';
      };
    }

    // Update label (use original peerId for name lookup)
    this.updateTileLabel(peerId, trackType);
    
    // Update status indicators when video is added
    this.updateStatusIndicators(peerId, tileId);

    // Setup fullscreen
    this.setupFullscreen(tile.container, tile.video);

    logger.info('VideoGrid', 'Video tile added', { peerId, tileId, trackType });
    this.updateLayout();
  }

  /**
   * Create tile container
   */
  createTileContainer(peerId) {
    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = `video-tile-${peerId}`;
    const isMobile = config.environment.isMobile;
    const isLandscape = isMobile && window.innerWidth > window.innerHeight;
    
    // Dynamic aspect ratio based on orientation
    // Desktop: consistent 16/9 for all tiles
    // Mobile: responsive based on orientation
    let aspectRatio = '16/9';
    let maxHeight = 'none';
    
    if (isMobile) {
      if (isLandscape) {
        aspectRatio = '16/9'; // Wider in landscape
        maxHeight = 'calc(100vh - 200px)';
      } else {
        aspectRatio = '4/3'; // Portrait
        maxHeight = 'calc((100vh - 300px) / 2)';
      }
    } else {
      // Desktop: ensure all tiles are equal size
      aspectRatio = '16/9';
      maxHeight = 'none';
    }
    
    container.style.cssText = `
      background: #000;
      border-radius: 8px;
      overflow: hidden;
      position: relative;
      aspect-ratio: ${aspectRatio};
      ${maxHeight !== 'none' ? `max-height: ${maxHeight};` : ''}
      width: 100%;
      height: auto;
    `;

    // Label with status indicators (matching original app)
    const label = document.createElement('div');
    label.className = 'video-label absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent text-white px-3 py-2 text-sm z-10 flex items-center justify-between';
    
    // Name section
    const nameSpan = document.createElement('span');
    nameSpan.className = 'font-medium';
    nameSpan.textContent = peerId === 'local' ? 'You' : 'Participant';
    
    // Status indicators section (inside label, matching original app)
    const statusSpan = document.createElement('span');
    statusSpan.className = 'flex items-center gap-2';
    statusSpan.innerHTML = `
      <span class="mic-status" data-peer-id="${peerId}">
        <i class="fas fa-microphone text-xs"></i>
      </span>
      <span class="video-status" data-peer-id="${peerId}">
        <i class="fas fa-video text-xs"></i>
      </span>
      <span class="speaking-indicator-wrapper hidden" data-peer-id="${peerId}">
        <div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
      </span>
    `;
    
    label.appendChild(nameSpan);
    label.appendChild(statusSpan);
    container.appendChild(label);

    // Fullscreen button
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.className = 'tile-fullscreen-btn';
    fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
    fullscreenBtn.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 20;
      background: rgba(0,0,0,0.5);
      color: white;
      border: none;
      border-radius: 4px;
      padding: 8px;
      cursor: pointer;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    container.appendChild(fullscreenBtn);

    this.container.appendChild(container);

    return {
      container,
      video: null,
      label,
      fullscreenBtn
    };
  }

  /**
   * Update tile label
   */
  updateTileLabel(peerId, trackType) {
    // For screen share tiles, use the screen tile ID
    const tileId = trackType === 'screen' ? `${peerId}-screen` : peerId;
    const tile = this.tiles.get(tileId);
    if (!tile) return;

    const participants = stateManager.getState('room.participants') || new Map();
    const participant = participants.get(peerId);
    const name = participant?.name || (peerId === 'local' ? 'You' : 'Participant');

    let labelText = name;
    if (trackType === 'screen') {
      labelText = `${name} (Screen Share)`;
    }

    // Update name span (first child of label)
    const nameSpan = tile.label.querySelector('span.font-medium');
    if (nameSpan) {
      nameSpan.textContent = labelText;
    } else {
      // Fallback if structure is different
      tile.label.textContent = labelText;
    }
  }

  /**
   * Remove video tile
   */
  removeVideoTile(peerId, trackType = null) {
    // For screen share, use the screen tile ID
    // Handle local screen share specially
    const tileId = trackType === 'screen' 
      ? (peerId === 'local' ? 'local-screen' : `${peerId}-screen`)
      : peerId;
    
    const tile = this.tiles.get(tileId);
    if (!tile) {
      logger.warn('VideoGrid', 'Tile not found for removal', { peerId, trackType, tileId });
      return;
    }

    // If removing specific track type, check if other tracks exist
    // For screen share, always remove the tile completely
    if (trackType && trackType !== 'screen') {
      const peers = stateManager.getState('peers') || new Map();
      const peer = peers.get(peerId);
      if (peer && peer.tracks) {
        // Check if other tracks exist
        const hasOtherTracks = Object.values(peer.tracks).some((t, type) => 
          type !== trackType && t !== null
        );
        if (hasOtherTracks) {
          // Don't remove tile, just update
          this.updateTileLabel(peerId, null);
          return;
        }
      }
    }

    // Remove tile completely
    tile.container.remove();
    this.tiles.delete(tileId);

    logger.info('VideoGrid', 'Video tile removed', { peerId, tileId, trackType });
    this.updateLayout();
  }

  /**
   * Setup fullscreen functionality
   */
  setupFullscreen(container, video) {
    let fullscreenBtn = container.querySelector('.tile-fullscreen-btn');
    if (!fullscreenBtn || !video) return;

    const isMobile = config.environment.isMobile;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);

    // Remove any existing button and create a fresh one to avoid event listener issues
    if (fullscreenBtn.parentNode) {
      const newBtn = fullscreenBtn.cloneNode(true);
      fullscreenBtn.parentNode.replaceChild(newBtn, fullscreenBtn);
      fullscreenBtn = newBtn;
    }

    // Make button more touch-friendly on mobile
    if (isMobile) {
      fullscreenBtn.style.cssText = `
        position: absolute;
        top: 8px;
        right: 8px;
        min-width: 48px;
        min-height: 48px;
        font-size: 20px;
        touch-action: manipulation;
        -webkit-touch-callout: none;
        pointer-events: auto;
        z-index: 9999;
        cursor: pointer;
        background-color: rgba(0, 0, 0, 0.7);
        border: none;
        border-radius: 6px;
        padding: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      `;
    } else {
      fullscreenBtn.style.cssText = `
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 20;
        background: rgba(0,0,0,0.5);
        color: white;
        border: none;
        border-radius: 4px;
        padding: 8px;
        cursor: pointer;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
    }

    // Ensure video has playsinline for mobile
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');

    const enterFullscreen = async () => {
      try {
        logger.info('VideoGrid', 'Entering fullscreen', { isMobile, isIOS, isAndroid });
        
        // On mobile iOS, use webkitEnterFullscreen (native video player)
        if (isMobile && isIOS) {
          if (video.webkitEnterFullscreen) {
            logger.info('VideoGrid', 'Using iOS webkitEnterFullscreen');
            video.webkitEnterFullscreen();
            btn.innerHTML = '<i class="fas fa-compress"></i>';
            return;
          } else {
            // Fallback: enable controls and let user tap video
            logger.warn('VideoGrid', 'webkitEnterFullscreen not available, enabling controls');
            video.setAttribute('controls', 'true');
            video.style.width = '100%';
            video.style.height = '100%';
            return;
          }
        }
        
        // On Android, enable controls and use requestFullscreen on video
        if (isMobile && isAndroid) {
          logger.info('VideoGrid', 'Using Android fullscreen');
          video.setAttribute('controls', 'true');
          if (video.requestFullscreen) {
            await video.requestFullscreen();
          } else if (video.webkitRequestFullscreen) {
            await video.webkitRequestFullscreen();
          } else if (video.mozRequestFullScreen) {
            await video.mozRequestFullScreen();
          }
          btn.innerHTML = '<i class="fas fa-compress"></i>';
          return;
        }

        // Desktop or fallback: use container fullscreen
        logger.info('VideoGrid', 'Using container fullscreen');
        if (container.requestFullscreen) {
          await container.requestFullscreen();
        } else if (container.webkitRequestFullscreen) {
          await container.webkitRequestFullscreen();
        } else if (container.mozRequestFullScreen) {
          await container.mozRequestFullScreen();
        } else if (container.msRequestFullscreen) {
          await container.msRequestFullscreen();
        }
        btn.innerHTML = '<i class="fas fa-compress"></i>';
      } catch (error) {
        logger.error('VideoGrid', 'Fullscreen failed', { error, message: error.message });
        // On iOS, if fullscreen fails, enable controls as fallback
        if (isMobile && isIOS) {
          video.setAttribute('controls', 'true');
        }
      }
    };

    const exitFullscreen = async () => {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        } else if (document.webkitFullscreenElement) {
          await document.webkitExitFullscreen();
        } else if (document.mozFullScreenElement) {
          await document.mozCancelFullScreen();
        } else if (document.msFullscreenElement) {
          await document.msExitFullscreen();
        }
        btn.innerHTML = '<i class="fas fa-expand"></i>';
        
        // Remove controls on mobile after exiting
        if (isMobile) {
          video.removeAttribute('controls');
        }
        
        // Ensure video continues playing
        if (video.paused && video.srcObject) {
          video.play().catch(err => {
            logger.warn('VideoGrid', 'Failed to resume video after fullscreen', { error: err });
          });
        }
      } catch (error) {
        logger.warn('VideoGrid', 'Exit fullscreen failed', { error });
      }
    };

    // Use both click and touch events for better mobile support
    const handleFullscreen = async (e) => {
      e.stopPropagation();
      e.preventDefault();
      e.stopImmediatePropagation();
      
      const isFullscreen = document.fullscreenElement === container ||
                           document.webkitFullscreenElement === container ||
                           document.mozFullScreenElement === container ||
                           document.msFullscreenElement === container ||
                           (isIOS && video.webkitDisplayingFullscreen);

      logger.info('VideoGrid', 'Fullscreen button clicked', { isFullscreen, isMobile, isIOS });
      
      if (isFullscreen) {
        await exitFullscreen();
      } else {
        await enterFullscreen();
      }
    };

    // Use capture phase and ensure button is on top
    fullscreenBtn.addEventListener('click', handleFullscreen, { capture: true, passive: false });
    fullscreenBtn.addEventListener('touchend', handleFullscreen, { capture: true, passive: false });
    fullscreenBtn.addEventListener('touchstart', (e) => {
      e.stopPropagation();
    }, { capture: true, passive: false });
    
    // Ensure button is always on top
    fullscreenBtn.style.pointerEvents = 'auto';
    fullscreenBtn.style.userSelect = 'none';
    fullscreenBtn.style.webkitUserSelect = 'none';

    // Update button on fullscreen change
    const updateButton = () => {
      const isFullscreen = document.fullscreenElement === container ||
                          document.webkitFullscreenElement === container ||
                          document.mozFullScreenElement === container ||
                          document.msFullscreenElement === container ||
                          (isIOS && video.webkitDisplayingFullscreen);

      if (isFullscreen) {
        btn.innerHTML = '<i class="fas fa-compress"></i>';
      } else {
        btn.innerHTML = '<i class="fas fa-expand"></i>';
        // Remove controls on mobile after exiting
        if (isMobile) {
          video.removeAttribute('controls');
        }
      }
    };

    document.addEventListener('fullscreenchange', updateButton);
    document.addEventListener('webkitfullscreenchange', updateButton);
    document.addEventListener('mozfullscreenchange', updateButton);
    document.addEventListener('MSFullscreenChange', updateButton);

    // Handle iOS native video fullscreen
    if (isIOS) {
      video.addEventListener('webkitfullscreenchange', () => {
        logger.info('VideoGrid', 'iOS fullscreen changed', { displaying: video.webkitDisplayingFullscreen });
        if (!video.webkitDisplayingFullscreen) {
          btn.innerHTML = '<i class="fas fa-expand"></i>';
          video.removeAttribute('controls');
          if (video.paused && video.srcObject) {
            video.play().catch(err => {
              logger.warn('VideoGrid', 'Failed to resume video after iOS fullscreen', { error: err });
            });
          }
        }
      });
    }
  }

  /**
   * Update tile aspect ratios based on orientation
   */
  updateTileAspectRatios(isLandscape) {
    const aspectRatio = isLandscape ? '16/9' : '4/3';
    const maxHeight = isLandscape ? 'calc(100vh - 200px)' : 'calc((100vh - 300px) / 2)';

    this.tiles.forEach((tile, peerId) => {
      if (tile.container) {
        tile.container.style.aspectRatio = aspectRatio;
        tile.container.style.maxHeight = maxHeight;
      }
    });

    // Also update local video container
    const localContainer = document.getElementById('localVideoContainer');
    if (localContainer) {
      localContainer.style.aspectRatio = aspectRatio;
      localContainer.style.maxHeight = maxHeight;
    }
  }

  /**
   * Update local video display
   */
  updateLocalVideo(peerId, track, trackType) {
    // Use existing localVideoContainer from HTML
    const localContainer = document.getElementById('localVideoContainer');
    const localVideo = document.getElementById('localVideo');
    
    if (!localContainer || !localVideo) {
      logger.warn('VideoGrid', 'Local video container not found');
      return;
    }

    if (track && track.readyState === 'live' && track.enabled) {
      // Create stream from track
      const stream = new MediaStream([track]);
      localVideo.srcObject = stream;
      localVideo.style.display = 'block';
      localVideo.style.visibility = 'visible';
      localVideo.style.zIndex = '1';
      localVideo.style.position = 'absolute';
      localVideo.style.top = '0';
      localVideo.style.left = '0';
      localVideo.style.width = '100%';
      localVideo.style.height = '100%';
      localVideo.play().catch(error => {
        // AbortError is common when srcObject changes - retry after a short delay
        if (error.name === 'AbortError') {
          setTimeout(() => {
            if (localVideo.srcObject && localVideo.paused) {
              localVideo.play().catch(err => {
                logger.debug('VideoGrid', 'Retry play after AbortError', { error: err });
              });
            }
          }, 100);
        } else {
          logger.warn('VideoGrid', 'Failed to play local video', { error });
        }
      });
      
      // Hide placeholder
      this.hidePlaceholder(localContainer);
    } else {
      // Show placeholder and hide video
      localVideo.style.display = 'none';
      localVideo.srcObject = null;
      this.showPlaceholder(localContainer);
    }
  }

  /**
   * Update local video from stream
   */
  updateLocalVideoFromStream(stream) {
    const localVideo = document.getElementById('localVideo');
    if (!localVideo) return;

    if (stream && stream.getVideoTracks().length > 0) {
      localVideo.srcObject = stream;
      localVideo.play().catch(error => {
        logger.warn('VideoGrid', 'Failed to play local video', { error });
      });
    }
  }

  /**
   * Create participant placeholder tile
   */
  createParticipantPlaceholder(peerId, name) {
    if (peerId === 'local' || peerId === 'local-screen') {
      return; // Don't create placeholder for local (handled separately)
    }

    // Check if tile already exists
    if (this.tiles.has(peerId)) {
      const tile = this.tiles.get(peerId);
      const placeholder = tile.container.querySelector('.no-video-placeholder');
      if (placeholder) {
        this.updatePlaceholderState(placeholder, peerId, name);
      }
      return;
    }

    // Create tile container
    const tile = this.createTileContainer(peerId);
    this.tiles.set(peerId, tile);

    // Create placeholder with original app styling
    const placeholder = document.createElement('div');
    placeholder.className = 'no-video-placeholder absolute inset-0 flex items-center justify-center bg-gray-800';
    placeholder.setAttribute('data-peer-id', peerId);

    // Generate initials from name
    const initials = name ? name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : 'P';
    
    // Create avatar circle with purple gradient (matching original app)
    const avatarCircle = document.createElement('div');
    avatarCircle.style.cssText = `
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      font-size: 32px;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    avatarCircle.textContent = initials;
    
    // Speaking indicator (green pulse when speaking) - at bottom center
    const speakingIndicator = document.createElement('div');
    speakingIndicator.className = 'speaking-indicator absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1 hidden';
    speakingIndicator.innerHTML = '<div class="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>';
    
    placeholder.appendChild(avatarCircle);
    placeholder.appendChild(speakingIndicator);

    tile.container.appendChild(placeholder);

    // Update label
    this.updateTileLabel(peerId, null);

    logger.info('VideoGrid', 'Created participant placeholder', { peerId, name, initials });
    this.updateLayout();
  }

  /**
   * Show placeholder
   */
  showPlaceholder(containerOrId) {
    const container = typeof containerOrId === 'string' 
      ? document.getElementById(containerOrId === 'local' ? 'localVideoContainer' : `video-container-${containerOrId}`)
      : containerOrId;
    
    if (!container) return;

    const peerId = containerOrId === 'local' ? 'local' : containerOrId;
    
    // Check if placeholder already exists
    let placeholder = container.querySelector('.no-video-placeholder');
    if (!placeholder) {
      // Create placeholder with original app styling
      placeholder = document.createElement('div');
      placeholder.className = 'no-video-placeholder absolute inset-0 flex items-center justify-center bg-gray-800';
      placeholder.setAttribute('data-peer-id', peerId);
      
      // Get name for initials
      let name = 'You';
      if (peerId !== 'local') {
        const participants = stateManager.getState('room.participants') || new Map();
        const participant = participants.get(peerId);
        name = participant?.name || peerId.substring(0, 5);
      } else {
        const participants = stateManager.getState('room.participants') || new Map();
        const socketId = stateManager.getState('socketId');
        const participant = participants.get(socketId);
        name = participant?.name || 'You';
      }
      
      const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || 'U';
      
      // Create avatar circle with purple gradient (matching original app)
      const avatarCircle = document.createElement('div');
      avatarCircle.style.cssText = `
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        font-size: 32px;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
      avatarCircle.textContent = initials;
      
      // Speaking indicator (green pulse when speaking) - at bottom center
      const speakingIndicator = document.createElement('div');
      speakingIndicator.className = 'speaking-indicator absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1 hidden';
      speakingIndicator.innerHTML = '<div class="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>';
      
      placeholder.appendChild(avatarCircle);
      placeholder.appendChild(speakingIndicator);
      
      container.appendChild(placeholder);
    } else {
      // Update existing placeholder state
      if (peerId !== 'local') {
        const participants = stateManager.getState('room.participants') || new Map();
        const participant = participants.get(peerId);
        const name = participant?.name || peerId.substring(0, 5);
        this.updatePlaceholderState(placeholder, peerId, name);
      } else {
        this.updatePlaceholderState(placeholder, 'local', 'You');
      }
    }
    
    placeholder.style.display = 'flex';
    placeholder.style.zIndex = '2';
  }

  /**
   * Update placeholder state (muted, camera off, speaking)
   */
  updatePlaceholderState(placeholder, peerId, name) {
    if (!placeholder) return;
    
    // Update avatar initials if name changed
    const avatarCircle = placeholder.querySelector('div[style*="linear-gradient"]');
    if (avatarCircle && name) {
      const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
      avatarCircle.textContent = initials;
    }
    
    // Status indicators are now in the label, not the placeholder
    // Update them via the tile's label
    const tileId = peerId === 'local' ? 'local' : peerId;
    const tile = this.tiles.get(tileId);
    if (tile && tile.label) {
      this.updateStatusIndicators(peerId, tileId);
    }
  }
  
  /**
   * Update status indicators in label (matching original app)
   */
  updateStatusIndicators(peerId, tileId) {
    const tile = this.tiles.get(tileId);
    if (!tile || !tile.label) return;
    
    // Get status indicators from label
    const micStatus = tile.label.querySelector(`.mic-status[data-peer-id="${peerId}"]`);
    const videoStatus = tile.label.querySelector(`.video-status[data-peer-id="${peerId}"]`);
    
    // Determine states
    let hasCamera = false;
    let hasAudio = false;
    
    if (peerId === 'local') {
      hasCamera = stateManager.getState('isCameraOn');
      hasAudio = stateManager.getState('isMicOn');
    } else {
      const peers = stateManager.getState('peers') || new Map();
      const peer = peers.get(peerId);
      hasCamera = peer && peer.tracks && peer.tracks.camera && peer.tracks.camera.readyState === 'live' && peer.tracks.camera.enabled;
      hasAudio = peer && peer.tracks && peer.tracks.audio && peer.tracks.audio.readyState === 'live' && peer.tracks.audio.enabled;
    }
    
    // Update mic status
    if (micStatus) {
      const icon = micStatus.querySelector('i');
      if (icon) {
        if (hasAudio) {
          icon.className = 'fas fa-microphone text-xs text-green-400';
        } else {
          icon.className = 'fas fa-microphone-slash text-xs text-red-400';
        }
      }
    }
    
    // Update camera status
    if (videoStatus) {
      const icon = videoStatus.querySelector('i');
      if (icon) {
        if (hasCamera) {
          icon.className = 'fas fa-video text-xs text-green-400';
        } else {
          icon.className = 'fas fa-video-slash text-xs text-gray-400';
        }
      }
    }
  }

  /**
   * Hide placeholder
   */
  hidePlaceholder(containerOrId) {
    const container = typeof containerOrId === 'string'
      ? document.getElementById(containerOrId === 'local' ? 'localVideoContainer' : containerOrId)
      : containerOrId;
    
    if (!container) return;

    const placeholder = container.querySelector('.no-video-placeholder');
    if (placeholder) {
      placeholder.style.display = 'none';
    }
  }

  /**
   * Update layout
   */
  updateLayout() {
    if (!this.container) return;

    const layoutMode = stateManager.getState('layoutMode') || 'grid';
    const tileCount = this.tiles.size;
    const isMobile = config.environment.isMobile;
    const gap = isMobile ? '8px' : '12px';

    // Apply 2-column grid layout with mobile optimizations
    // On desktop, ensure consistent tile sizing
    this.container.style.cssText = `
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: ${gap};
      width: 100%;
      ${isMobile ? 'max-height: calc(100vh - 250px); overflow-y: auto;' : 'align-content: start;'}
    `;

    logger.debug('VideoGrid', 'Layout updated', { layoutMode, tileCount, isMobile });
  }

  /**
   * Clear all tiles
   */
  clear() {
    this.tiles.forEach((tile, peerId) => {
      if (tile.container && tile.container.parentNode) {
        tile.container.remove();
      }
      // Stop video playback
      if (tile.video) {
        tile.video.srcObject = null;
        tile.video.pause();
      }
    });
    this.tiles.clear();
    
    // Also clear local video placeholder
    const localContainer = document.getElementById('localVideoContainer');
    if (localContainer) {
      const placeholder = localContainer.querySelector('.no-video-placeholder');
      if (placeholder) {
        placeholder.remove();
      }
    }
    
    logger.info('VideoGrid', 'All tiles cleared');
  }
}

// Export singleton instance
export const videoGrid = new VideoGrid();
export default videoGrid;

