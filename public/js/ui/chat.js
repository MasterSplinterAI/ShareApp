// Chat UI module for handling chat messages
import { sendChatMessage } from '../services/socket.js';

// Add a chat message to the UI
export function addChatMessage(senderId, senderName, message, isSelf = false) {
  const chatMessages = document.getElementById('chatMessages');
  
  if (!chatMessages) {
    console.error('Chat messages element not found');
    return;
  }
  
  // Create message container
  const messageContainer = document.createElement('div');
  messageContainer.className = `flex mb-2 ${isSelf ? 'justify-end' : 'justify-start'}`;
  
  // Create message bubble
  const messageBubble = document.createElement('div');
  messageBubble.className = isSelf 
    ? 'bg-blue-500 text-white rounded-lg px-3 py-2 max-w-3/4 break-words' 
    : 'bg-gray-200 text-gray-800 rounded-lg px-3 py-2 max-w-3/4 break-words';
  
  // Message content
  const content = document.createElement('div');
  
  // Sender name
  const sender = document.createElement('div');
  sender.className = 'text-xs font-medium mb-1';
  sender.textContent = isSelf ? 'You' : (senderName || `Participant ${senderId.substring(0, 5)}`);
  
  // Message text
  const text = document.createElement('div');
  text.textContent = message;
  
  // Add time
  const time = document.createElement('div');
  time.className = 'text-xs opacity-70 text-right mt-1';
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  // Assemble message
  content.appendChild(sender);
  content.appendChild(text);
  content.appendChild(time);
  messageBubble.appendChild(content);
  messageContainer.appendChild(messageBubble);
  
  // Add to chat
  chatMessages.appendChild(messageContainer);
  
  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  // Show notification if chat is not open
  if (document.getElementById('chatPanel').classList.contains('hidden')) {
    incrementUnreadCount();
  }
}

// Setup chat panel
export function setupChatPanel() {
  const chatBtn = document.getElementById('chatBtn');
  const chatPanel = document.getElementById('chatPanel');
  const closeChatBtn = document.getElementById('closeChatBtn');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  
  if (!chatBtn || !chatPanel || !closeChatBtn || !chatForm || !chatInput) {
    console.error('Chat panel elements not found');
    return;
  }
  
  // Toggle chat panel
  chatBtn.addEventListener('click', () => {
    chatPanel.classList.toggle('hidden');
    
    // Reset unread count when opening
    if (!chatPanel.classList.contains('hidden')) {
      resetUnreadCount();
      chatInput.focus();
    }
  });
  
  // Close chat panel
  closeChatBtn.addEventListener('click', () => {
    chatPanel.classList.add('hidden');
  });
  
  // Close panel when clicking outside on mobile
  document.addEventListener('click', (event) => {
    if (window.innerWidth < 768 && 
        !chatPanel.classList.contains('hidden') && 
        !chatPanel.contains(event.target) && 
        event.target !== chatBtn && 
        !chatBtn.contains(event.target)) {
      chatPanel.classList.add('hidden');
    }
  });
  
  // Handle chat form submission
  chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    
    const message = chatInput.value.trim();
    
    if (message) {
      // Send message
      sendChatMessage(message);
      
      // Add to UI
      addChatMessage('self', 'You', message, true);
      
      // Clear input
      chatInput.value = '';
    }
  });
}

// Increment unread message count
function incrementUnreadCount() {
  const unreadBadge = document.getElementById('unreadBadge');
  
  if (!unreadBadge) {
    return;
  }
  
  // Show badge
  unreadBadge.classList.remove('hidden');
  
  // Get current count
  let count = parseInt(unreadBadge.textContent) || 0;
  
  // Increment
  count++;
  
  // Update badge
  unreadBadge.textContent = count > 99 ? '99+' : count;
}

// Reset unread message count
function resetUnreadCount() {
  const unreadBadge = document.getElementById('unreadBadge');
  
  if (!unreadBadge) {
    return;
  }
  
  // Reset count
  unreadBadge.textContent = '0';
  
  // Hide badge
  unreadBadge.classList.add('hidden');
} 