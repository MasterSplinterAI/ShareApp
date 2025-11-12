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
      this.removeVideoTile('local-screen');
    });

    // Listen for remote track events
    eventBus.on('webrtc:track:*', (data) => {
      if (data.peerId !== 'local') {
        this.addVideoTile(data.peerId, data.track, data.type, data.stream);
      }
    });

    eventBus.on('webrtc:trackEnded:*', (data) => {
      if (data.peerId !== 'local') {
        this.removeVideoTile(data.peerId, data.trackType);
      }
    });

    // Listen for participant changes
    eventBus.on('room:userJoined', (data) => {
      // Tile will be created when track arrives
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
      if (!isOn) {
        this.showPlaceholder('local');
      }
    });
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

    // Get or create tile container
    let tile = this.tiles.get(peerId);
    if (!tile) {
      tile = this.createTileContainer(peerId);
      this.tiles.set(peerId, tile);
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

    // Play video with retry logic
    const playVideo = async () => {
      try {
        await tile.video.play();
        logger.debug('VideoGrid', 'Video playing', { peerId });
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

    // Update label
    this.updateTileLabel(peerId, trackType);

    // Setup fullscreen
    this.setupFullscreen(tile.container, tile.video);

    logger.info('VideoGrid', 'Video tile added', { peerId, trackType });
    this.updateLayout();
  }

  /**
   * Create tile container
   */
  createTileContainer(peerId) {
    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = `video-tile-${peerId}`;
    container.style.cssText = `
      background: #000;
      border-radius: 8px;
      overflow: hidden;
      position: relative;
      aspect-ratio: ${config.environment.isMobile ? '3/4' : '16/9'};
    `;

    // Label
    const label = document.createElement('div');
    label.className = 'video-label';
    label.style.cssText = `
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: linear-gradient(to top, rgba(0,0,0,0.7), transparent);
      color: white;
      padding: 8px 12px;
      font-size: 14px;
      z-index: 10;
    `;
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
    const tile = this.tiles.get(peerId);
    if (!tile) return;

    const participants = stateManager.getState('room.participants') || new Map();
    const participant = participants.get(peerId);
    const name = participant?.name || (peerId === 'local' ? 'You' : 'Participant');

    let labelText = name;
    if (trackType === 'screen') {
      labelText += ' (Screen Share)';
    }

    tile.label.textContent = labelText;
  }

  /**
   * Remove video tile
   */
  removeVideoTile(peerId, trackType = null) {
    const tile = this.tiles.get(peerId);
    if (!tile) return;

    // If removing specific track type, check if other tracks exist
    if (trackType) {
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
    this.tiles.delete(peerId);

    logger.info('VideoGrid', 'Video tile removed', { peerId });
    this.updateLayout();
  }

  /**
   * Setup fullscreen functionality
   */
  setupFullscreen(container, video) {
    const fullscreenBtn = container.querySelector('.tile-fullscreen-btn');
    if (!fullscreenBtn) return;

    fullscreenBtn.onclick = async () => {
      try {
        if (!document.fullscreenElement) {
          await container.requestFullscreen();
          fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
        } else {
          await document.exitFullscreen();
          fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
        }
      } catch (error) {
        logger.warn('VideoGrid', 'Fullscreen failed', { error });
      }
    };

    // Update button on fullscreen change
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement === container) {
        fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
      } else {
        fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
      }
    });
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

    if (track && track.readyState === 'live') {
      // Create stream from track
      const stream = new MediaStream([track]);
      localVideo.srcObject = stream;
      localVideo.play().catch(error => {
        logger.warn('VideoGrid', 'Failed to play local video', { error });
      });
      
      // Hide placeholder
      this.hidePlaceholder(localContainer);
    } else {
      // Show placeholder
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
   * Show placeholder
   */
  showPlaceholder(containerOrId) {
    const container = typeof containerOrId === 'string' 
      ? document.getElementById(containerOrId === 'local' ? 'localVideoContainer' : containerOrId)
      : containerOrId;
    
    if (!container) return;

    // Check if placeholder already exists
    let placeholder = container.querySelector('.no-video-placeholder');
    if (!placeholder) {
      placeholder = document.createElement('div');
      placeholder.className = 'no-video-placeholder';
      placeholder.style.cssText = `
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #1f2937;
        z-index: 5;
      `;
      
      const icon = document.createElement('i');
      icon.className = 'fas fa-user-circle';
      icon.style.cssText = 'font-size: 64px; color: #6b7280;';
      placeholder.appendChild(icon);
      
      container.appendChild(placeholder);
    }
    placeholder.style.display = 'flex';
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

    // Apply 2-column grid layout
    this.container.style.cssText = `
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      width: 100%;
    `;

    logger.debug('VideoGrid', 'Layout updated', { layoutMode, tileCount });
  }

  /**
   * Clear all tiles
   */
  clear() {
    this.tiles.forEach((tile, peerId) => {
      tile.container.remove();
    });
    this.tiles.clear();
  }
}

// Export singleton instance
export const videoGrid = new VideoGrid();
export default videoGrid;

