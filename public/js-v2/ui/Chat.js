// Chat component for chat UI and message handling
import { logger } from '../core/Logger.js';
import { eventBus } from '../core/EventBus.js';
import { stateManager } from '../core/StateManager.js';
import { signalingClient } from '../webrtc/SignalingClient.js';

class Chat {
  constructor() {
    this.panel = null;
    this.messages = [];
    this.setupPanel();
    this.setupEventListeners();
  }

  /**
   * Setup chat panel
   */
  setupPanel() {
    this.panel = document.getElementById('chatPanel');
    const messagesContainer = document.getElementById('chatMessages');
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');

    if (!this.panel || !messagesContainer || !chatForm || !chatInput) {
      logger.warn('Chat', 'Chat panel elements not found');
      return;
    }

    // Close button
    const closeBtn = document.getElementById('closeChatBtn');
    if (closeBtn) {
      closeBtn.onclick = () => this.hide();
    }

    // Chat button
    const chatBtn = document.getElementById('chatBtn');
    if (chatBtn) {
      chatBtn.onclick = () => this.toggle();
    }

    // Form submission
    chatForm.onsubmit = (e) => {
      e.preventDefault();
      const message = chatInput.value.trim();
      if (message) {
        this.sendMessage(message);
        chatInput.value = '';
      }
    };
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    eventBus.on('chat:message', (data) => {
      this.addMessage(data.senderName, data.message, data.timestamp, false);
    });
  }

  /**
   * Send message
   */
  sendMessage(message) {
    const roomId = stateManager.getState('roomId');
    if (!roomId) {
      logger.warn('Chat', 'No room ID, cannot send message');
      return;
    }

    signalingClient.sendChatMessage(message, roomId);

    // Add to local messages immediately
    const socketId = stateManager.getState('socketId');
    const participants = stateManager.getState('room.participants') || new Map();
    const localParticipant = participants.get(socketId);
    const senderName = localParticipant?.name || 'You';

    this.addMessage(senderName, message, new Date().toISOString(), true);
  }

  /**
   * Add message to chat
   */
  addMessage(senderName, message, timestamp, isLocal) {
    this.messages.push({
      senderName,
      message,
      timestamp,
      isLocal
    });

    this.renderMessages();
  }

  /**
   * Render messages
   */
  renderMessages() {
    const messagesContainer = document.getElementById('chatMessages');
    if (!messagesContainer) return;

    messagesContainer.innerHTML = '';

    this.messages.forEach(msg => {
      const messageEl = document.createElement('div');
      messageEl.style.cssText = `
        padding: 8px 12px;
        margin-bottom: 8px;
        border-radius: 8px;
        background: ${msg.isLocal ? '#3b82f6' : '#e5e7eb'};
        color: ${msg.isLocal ? 'white' : 'black'};
        align-self: ${msg.isLocal ? 'flex-end' : 'flex-start'};
        max-width: 80%;
      `;

      const sender = document.createElement('div');
      sender.textContent = msg.senderName;
      sender.style.cssText = `
        font-weight: bold;
        font-size: 12px;
        margin-bottom: 4px;
      `;
      messageEl.appendChild(sender);

      const text = document.createElement('div');
      text.textContent = msg.message;
      messageEl.appendChild(text);

      messagesContainer.appendChild(messageEl);
    });

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  /**
   * Show panel
   */
  show() {
    if (this.panel) {
      this.panel.classList.remove('hidden');
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
export const chat = new Chat();
export default chat;

