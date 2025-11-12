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
    // Listen for track events
    eventBus.on('webrtc:track:*', (data) => {
      this.addVideoTile(data.peerId, data.track, data.type, data.stream);
    });

    eventBus.on('webrtc:trackEnded:*', (data) => {
      this.removeVideoTile(data.peerId, data.trackType);
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
  }

  /**
   * Add video tile
   */
  addVideoTile(peerId, track, trackType, stream) {
    if (!this.container) {
      logger.warn('VideoGrid', 'Container not available');
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
      tile.video.muted = peerId !== 'local';
      tile.video.style.cssText = `
        width: 100%;
        height: 100%;
        object-fit: contain;
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

    // Play video
    tile.video.play().catch(error => {
      logger.warn('VideoGrid', 'Failed to play video', { peerId, error });
    });

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

