// Participants UI module for managing the participants list
import { getSocketId } from '../services/socket.js';
import { updateLayoutForParticipantCount } from './layout.js';

// Update the participants list in the UI
export function updateParticipantList() {
  const participantsList = document.getElementById('participantsList');
  
  if (!participantsList) {
    console.error('Participants list element not found');
    return;
  }
  
  // Clear existing list
  participantsList.innerHTML = '';
  
  // Get current socket ID
  const currentSocketId = getSocketId();
  
  // Check for duplicate containers in the video grid
  checkForAndCleanupDuplicateContainers();
  
  // Add current user first
  if (currentSocketId) {
    const selfParticipant = {
      id: currentSocketId,
      name: 'You',
      isHost: window.appState.isHost
    };
    
    addParticipantToList(participantsList, selfParticipant, true);
  }
  
  // Add other participants
  Object.values(window.appState.participants)
    .filter(participant => participant.id !== currentSocketId)
    .forEach(participant => {
      addParticipantToList(participantsList, participant, false);
    });
    
  // Update count in button
  const participantsBtn = document.getElementById('participantsBtn');
  if (participantsBtn) {
    const count = Object.keys(window.appState.participants).length;
    participantsBtn.setAttribute('title', `Participants (${count})`);
  }
  
  // Update layout if in grid-only mode
  updateLayoutForParticipantCount();
}

// Function to check for and clean up duplicate participant containers
function checkForAndCleanupDuplicateContainers() {
  // Get all participant IDs
  const participantIds = Object.keys(window.appState.participants);
  
  // Check each participant ID for multiple containers
  participantIds.forEach(userId => {
    // Get all container elements that might exist for this participant
    const containers = [
      document.getElementById(`participant-${userId}`),
      document.getElementById(`video-container-${userId}`)
    ].filter(Boolean); // Remove null values
    
    if (containers.length > 1) {
      console.log(`Found ${containers.length} containers for participant ${userId}, cleaning up duplicates`);
      
      // Keep only the first one that has video content
      let containerToKeep = containers.find(container => container.querySelector('video')?.srcObject) || containers[0];
      
      // Remove all others
      containers.forEach(container => {
        if (container !== containerToKeep) {
          console.log(`Removing duplicate container for ${userId}`);
          container.remove();
        }
      });
    }
  });
}

// Add a participant to the list
function addParticipantToList(listElement, participant, isSelf) {
  // Create participant item
  const item = document.createElement('div');
  item.className = 'flex items-center justify-between py-2 border-b border-gray-100 last:border-0';
  item.id = `participant-item-${participant.id}`;
  
  // Create left content with name and status
  const leftContent = document.createElement('div');
  leftContent.className = 'flex items-center';
  
  // User icon
  const userIcon = document.createElement('span');
  userIcon.className = 'w-8 h-8 bg-blue-100 text-blue-500 rounded-full flex items-center justify-center mr-2';
  userIcon.innerHTML = '<i class="fas fa-user"></i>';
  
  // If participant is host, show a crown icon
  if (participant.isHost) {
    userIcon.className = 'w-8 h-8 bg-yellow-100 text-yellow-500 rounded-full flex items-center justify-center mr-2';
    userIcon.innerHTML = '<i class="fas fa-crown"></i>';
  }
  
  // Name with host badge if applicable
  const nameElement = document.createElement('div');
  nameElement.className = 'flex flex-col';
  
  const nameText = document.createElement('span');
  nameText.className = 'font-medium';
  nameText.textContent = participant.name || `Participant ${participant.id.substring(0, 5)}`;
  
  nameElement.appendChild(nameText);
  
  // Status badges
  if (participant.isHost) {
    const hostBadge = document.createElement('span');
    hostBadge.className = 'text-xs text-yellow-600';
    hostBadge.textContent = 'Host';
    nameElement.appendChild(hostBadge);
  }
  
  if (isSelf) {
    const selfBadge = document.createElement('span');
    selfBadge.className = 'text-xs text-blue-600';
    selfBadge.textContent = 'You';
    nameElement.appendChild(selfBadge);
  }
  
  // Assemble left content
  leftContent.appendChild(userIcon);
  leftContent.appendChild(nameElement);
  
  // Create right content with actions
  const rightContent = document.createElement('div');
  rightContent.className = 'flex items-center gap-2';
  
  // Pin button to pin this participant to main view
  const pinBtn = document.createElement('button');
  pinBtn.className = 'text-gray-500 hover:text-blue-500';
  pinBtn.title = 'Pin to main view';
  pinBtn.innerHTML = '<i class="fas fa-thumbtack"></i>';
  
  // Only add pin functionality for remote participants or self
  pinBtn.addEventListener('click', () => {
    window.appState.pinnedParticipant = isSelf ? 'local' : participant.id;
    document.dispatchEvent(new CustomEvent('pinned-participant-changed'));
    
    // Close participants panel on mobile
    if (window.innerWidth < 768) {
      const participantsPanel = document.getElementById('participantsPanel');
      if (participantsPanel) {
        participantsPanel.classList.add('hidden');
      }
    }
  });
  
  rightContent.appendChild(pinBtn);
  
  // Add additional actions for host (e.g., mute others, remove participant)
  if (window.appState.isHost && !isSelf) {
    // Mute button
    const muteBtn = document.createElement('button');
    muteBtn.className = 'text-gray-500 hover:text-red-500';
    muteBtn.title = 'Mute participant';
    muteBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
    
    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'text-gray-500 hover:text-red-500';
    removeBtn.title = 'Remove participant';
    removeBtn.innerHTML = '<i class="fas fa-times-circle"></i>';
    
    rightContent.appendChild(muteBtn);
    rightContent.appendChild(removeBtn);
  }
  
  // Assemble the participant item
  item.appendChild(leftContent);
  item.appendChild(rightContent);
  
  // Add to the list
  listElement.appendChild(item);
}

// Set up the participants panel toggle
export function setupParticipantsPanel() {
  const participantsBtn = document.getElementById('participantsBtn');
  const participantsPanel = document.getElementById('participantsPanel');
  const closeParticipantsBtn = document.getElementById('closeParticipantsBtn');
  
  if (!participantsBtn || !participantsPanel || !closeParticipantsBtn) {
    console.error('Participants panel elements not found');
    return;
  }
  
  // Toggle panel when button is clicked
  participantsBtn.addEventListener('click', () => {
    participantsPanel.classList.toggle('hidden');
    
    // Update participant list when opening
    if (!participantsPanel.classList.contains('hidden')) {
      updateParticipantList();
    }
  });
  
  // Close panel when close button is clicked
  closeParticipantsBtn.addEventListener('click', () => {
    participantsPanel.classList.add('hidden');
  });
  
  // Close panel when clicking outside on mobile
  document.addEventListener('click', (event) => {
    if (window.innerWidth < 768 && 
        !participantsPanel.classList.contains('hidden') && 
        !participantsPanel.contains(event.target) && 
        event.target !== participantsBtn && 
        !participantsBtn.contains(event.target)) {
      participantsPanel.classList.add('hidden');
    }
  });
} 