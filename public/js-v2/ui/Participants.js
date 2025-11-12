// Participants component for participant list UI
import { logger } from '../core/Logger.js';
import { eventBus } from '../core/EventBus.js';
import { stateManager } from '../core/StateManager.js';

class Participants {
  constructor() {
    this.panel = null;
    this.list = null;
    this.setupPanel();
    this.setupEventListeners();
  }

  /**
   * Setup participants panel
   */
  setupPanel() {
    this.panel = document.getElementById('participantsPanel');
    this.list = document.getElementById('participantsList');
    
    if (!this.panel || !this.list) {
      logger.warn('Participants', 'Participants panel not found');
      return;
    }

    // Close button
    const closeBtn = document.getElementById('closeParticipantsBtn');
    if (closeBtn) {
      closeBtn.onclick = () => this.hide();
    }

    // Participants button
    const participantsBtn = document.getElementById('participantsBtn');
    if (participantsBtn) {
      participantsBtn.onclick = () => this.toggle();
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    stateManager.subscribe('room.participants', () => {
      this.updateList();
    });
  }

  /**
   * Update participants list
   */
  updateList() {
    if (!this.list) return;

    const participants = stateManager.getState('room.participants') || new Map();
    const socketId = stateManager.getState('socketId');
    const isHost = stateManager.getState('isHost');

    // Clear list
    this.list.innerHTML = '';

    // Add local participant
    const localParticipant = {
      id: socketId,
      name: 'You',
      isHost: isHost
    };
    this.addParticipantItem(localParticipant, true);

    // Add remote participants
    participants.forEach((participant, id) => {
      if (id !== socketId) {
        this.addParticipantItem(participant, false);
      }
    });
  }

  /**
   * Add participant item to list
   */
  addParticipantItem(participant, isLocal) {
    const item = document.createElement('div');
    item.className = 'participant-item';
    item.style.cssText = `
      padding: 12px;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      align-items: center;
      gap: 12px;
    `;

    // Name
    const name = document.createElement('span');
    name.textContent = participant.name || 'Participant';
    name.style.flex = '1';
    item.appendChild(name);

    // Host badge
    if (participant.isHost) {
      const badge = document.createElement('span');
      badge.textContent = 'Host';
      badge.style.cssText = `
        background: #3b82f6;
        color: white;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 12px;
      `;
      item.appendChild(badge);
    }

    this.list.appendChild(item);
  }

  /**
   * Show panel
   */
  show() {
    if (this.panel) {
      this.panel.classList.remove('hidden');
      this.updateList();
    }
  }

  /**
   * Hide panel
   */
  hide() {
    if (this.panel) {
      this.panel.classList.add('hidden');
    }
  }

  /**
   * Toggle panel
   */
  toggle() {
    if (this.panel?.classList.contains('hidden')) {
      this.show();
    } else {
      this.hide();
    }
  }
}

// Export singleton instance
export const participants = new Participants();
export default participants;

