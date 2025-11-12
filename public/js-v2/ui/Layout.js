// Layout component for responsive layout modes and mobile optimizations
import { logger } from '../core/Logger.js';
import { stateManager } from '../core/StateManager.js';
import { config } from '../core/Config.js';

class Layout {
  constructor() {
    this.currentMode = 'grid';
    this.setupEventListeners();
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    stateManager.subscribe('layoutMode', (newMode) => {
      this.setLayoutMode(newMode);
    });
  }

  /**
   * Set layout mode
   */
  setLayoutMode(mode) {
    this.currentMode = mode;
    this.applyLayout(mode);
    logger.debug('Layout', 'Layout mode changed', { mode });
  }

  /**
   * Apply layout
   */
  applyLayout(mode) {
    const videoGrid = document.getElementById('videoGrid');
    const participantsGrid = document.getElementById('participantsGrid');
    const mainVideoContainer = document.getElementById('mainVideoContainer');

    if (!videoGrid || !participantsGrid) {
      return;
    }

    // Hide main video container (equal-sized tiles)
    if (mainVideoContainer) {
      mainVideoContainer.classList.add('hidden');
    }

    // Apply 2-column grid
    participantsGrid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      width: 100%;
      align-content: start;
    `;

    // Mobile adjustments
    if (config.environment.isMobile) {
      participantsGrid.style.gap = '8px';
    }
  }

  /**
   * Get current layout mode
   */
  getCurrentMode() {
    return this.currentMode;
  }
}

// Export singleton instance
export const layout = new Layout();
export default layout;

