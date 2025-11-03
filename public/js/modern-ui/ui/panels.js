// Modern UI Panels Handler
// Manages participants panel and chat panel

import { getSocketId } from '../../services/socket.js';

export function setupPanels() {
  // Participants panel is already handled in controls.js
  // Chat panel is already handled in controls.js
  // This module handles the content updates
}

export function updateParticipantsList() {
  const list = document.getElementById('participantsList');
  if (!list) return;
  
  list.innerHTML = '';
  
  // Add local user
  const socketId = getSocketId();
  if (socketId) {
    const localItem = createParticipantItem({
      id: socketId,
      name: 'You',
      isHost: window.appState.isHost
    }, true);
    list.appendChild(localItem);
  }
  
  // Add other participants
  Object.values(window.appState.participants).forEach(participant => {
    if (participant.id !== socketId) {
      const item = createParticipantItem(participant, false);
      list.appendChild(item);
    }
  });
}

function createParticipantItem(participant, isSelf) {
  const item = document.createElement('div');
  item.style.cssText = 'padding: 12px; border-bottom: 1px solid #e0e0e0; display: flex; align-items: center; gap: 12px;';
  
  // Avatar
  const avatar = document.createElement('div');
  avatar.style.cssText = 'width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center; color: white; font-weight: 600;';
  const initials = participant.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || 'U';
  avatar.textContent = initials;
  
  // Info
  const info = document.createElement('div');
  info.style.flex = '1';
  
  const name = document.createElement('div');
  name.style.cssText = 'font-weight: 600; margin-bottom: 4px;';
  name.textContent = participant.name;
  
  const badges = document.createElement('div');
  badges.style.cssText = 'font-size: 12px; color: #666;';
  
  if (participant.isHost) {
    const hostBadge = document.createElement('span');
    hostBadge.style.cssText = 'margin-right: 8px; color: #f59e0b;';
    hostBadge.textContent = 'Host';
    badges.appendChild(hostBadge);
  }
  
  if (isSelf) {
    const selfBadge = document.createElement('span');
    selfBadge.style.color = '#2563eb';
    selfBadge.textContent = 'You';
    badges.appendChild(selfBadge);
  }
  
  info.appendChild(name);
  info.appendChild(badges);
  
  item.appendChild(avatar);
  item.appendChild(info);
  
  return item;
}

export function addChatMessage(message, senderId, senderName) {
  const messages = document.getElementById('chatMessages');
  if (!messages) return;
  
  const messageDiv = document.createElement('div');
  messageDiv.style.cssText = 'margin-bottom: 16px; padding: 12px; background: #f5f5f5; border-radius: 8px;';
  
  const sender = document.createElement('div');
  sender.style.cssText = 'font-weight: 600; margin-bottom: 4px; color: #2563eb;';
  sender.textContent = senderName || 'Unknown';
  
  const text = document.createElement('div');
  text.textContent = message;
  
  messageDiv.appendChild(sender);
  messageDiv.appendChild(text);
  
  messages.appendChild(messageDiv);
  messages.scrollTop = messages.scrollHeight;
}

// Listen for participant updates
document.addEventListener('participant-list-updated', () => {
  updateParticipantsList();
});

// Listen for chat messages
document.addEventListener('chat-message', (e) => {
  const { message, senderId, senderName } = e.detail;
  addChatMessage(message, senderId, senderName);
});

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupPanels);
} else {
  setupPanels();
}

