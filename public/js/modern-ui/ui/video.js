// Modern UI Video Management
// Handles video display, grid view, speaker view, and participant video containers

import { getSocketId } from '../../services/socket.js';
import { updateMainVideo } from '../../ui/video.js';

export function setupVideoUI() {
  // This will be called when participants join/leave
  // It manages the video container display
}

export function createVideoContainer(peerId, stream, name, isHost = false) {
  const wrapper = document.createElement('div');
  wrapper.className = 'video-wrapper';
  wrapper.id = `video-wrapper-${peerId}`;
  
  // Create video element
  const video = document.createElement('video');
  video.id = `video-${peerId}`;
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = stream;
  
  // Create placeholder
  const placeholder = document.createElement('div');
  placeholder.className = 'video-placeholder';
  
  // Get initials
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || 'U';
  
  placeholder.innerHTML = `
    <div class="avatar">${initials}</div>
    <div class="name">${name}${isHost ? ' (Host)' : ''}</div>
  `;
  
  // Create label
  const label = document.createElement('div');
  label.className = 'video-label';
  label.innerHTML = `
    <span class="name">${name}${isHost ? ' (Host)' : ''}</span>
    <span class="status">
      <span class="status-icon mic-status" data-peer-id="${peerId}">
        <i class="fas fa-microphone"></i>
      </span>
      <span class="status-icon video-status" data-peer-id="${peerId}">
        <i class="fas fa-video-slash"></i>
      </span>
    </span>
  `;
  
  wrapper.appendChild(video);
  wrapper.appendChild(placeholder);
  wrapper.appendChild(label);
  
  // Handle video track events
  if (stream) {
    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();
    
    if (videoTracks.length > 0 && videoTracks[0].enabled) {
      placeholder.style.display = 'none';
    } else {
      video.style.display = 'none';
    }
    
    // Listen for track changes
    videoTracks.forEach(track => {
      track.addEventListener('ended', () => {
        video.style.display = 'none';
        placeholder.style.display = 'flex';
      });
      
      track.addEventListener('mute', () => {
        video.style.display = 'none';
        placeholder.style.display = 'flex';
      });
      
      track.addEventListener('unmute', () => {
        video.style.display = 'block';
        placeholder.style.display = 'none';
      });
    });
    
    // Update mic status
    if (audioTracks.length > 0) {
      const micStatus = label.querySelector('.mic-status i');
      if (audioTracks[0].enabled) {
        micStatus.className = 'fas fa-microphone';
      } else {
        micStatus.className = 'fas fa-microphone-slash';
      }
    }
  }
  
  // Pin button
  const pinBtn = document.createElement('button');
  pinBtn.className = 'control-btn';
  pinBtn.style.cssText = 'position: absolute; top: 8px; right: 8px; width: 32px; height: 32px; z-index: 10;';
  pinBtn.innerHTML = '<i class="fas fa-thumbtack"></i>';
  pinBtn.title = 'Pin to main view';
  pinBtn.addEventListener('click', () => {
    window.appState.pinnedParticipant = peerId === 'local' ? 'local' : peerId;
    updateMainVideoDisplay();
    document.dispatchEvent(new CustomEvent('pinned-participant-changed'));
  });
  
  wrapper.appendChild(pinBtn);
  
  return wrapper;
}

export function updateMainVideoDisplay() {
  const mainVideo = document.getElementById('mainVideo');
  const mainVideoWrapper = document.getElementById('mainVideoWrapper');
  const pinnedParticipant = window.appState.pinnedParticipant || 'local';
  
  if (pinnedParticipant === 'local') {
    // Show local video
    if (window.appState.localStream) {
      mainVideo.srcObject = window.appState.localStream;
      mainVideo.muted = true;
      
      const label = mainVideoWrapper.querySelector('.video-label .name');
      if (label) label.textContent = 'You';
    }
  } else {
    // Show pinned participant video
    const peerVideo = document.getElementById(`video-${pinnedParticipant}`);
    if (peerVideo && peerVideo.srcObject) {
      mainVideo.srcObject = peerVideo.srcObject;
      mainVideo.muted = false;
      
      const participant = window.appState.participants[pinnedParticipant];
      const label = mainVideoWrapper.querySelector('.video-label .name');
      if (label) label.textContent = participant?.name || 'Participant';
    }
  }
  
  // Show/hide placeholder
  const hasVideo = mainVideo.srcObject && 
    mainVideo.srcObject.getVideoTracks().some(t => t.enabled && t.readyState === 'live');
  
  const placeholder = mainVideoWrapper.querySelector('.video-placeholder');
  if (hasVideo) {
    mainVideo.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';
  } else {
    mainVideo.style.display = 'none';
    if (placeholder) {
      placeholder.style.display = 'flex';
      const participant = window.appState.participants[pinnedParticipant] || { name: 'You' };
      const initials = participant.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || 'U';
      placeholder.querySelector('.avatar').textContent = initials;
      placeholder.querySelector('.name').textContent = participant.name;
    }
  }
}

export function addParticipantVideo(peerId, stream, name, isHost = false) {
  const grid = document.getElementById('participantsGrid');
  if (!grid) return;
  
  // Check if already exists
  const existing = document.getElementById(`video-wrapper-${peerId}`);
  if (existing) {
    // Update existing
    const video = existing.querySelector('video');
    if (video && stream) {
      video.srcObject = stream;
    }
    return;
  }
  
  const wrapper = createVideoContainer(peerId, stream, name, isHost);
  
  // Add to grid
  grid.appendChild(wrapper);
  
  // Update main video if this is the pinned participant
  if (window.appState.pinnedParticipant === peerId) {
    updateMainVideoDisplay();
  }
}

export function removeParticipantVideo(peerId) {
  const wrapper = document.getElementById(`video-wrapper-${peerId}`);
  if (wrapper) {
    wrapper.remove();
  }
  
  // If this was the pinned participant, reset to local
  if (window.appState.pinnedParticipant === peerId) {
    window.appState.pinnedParticipant = 'local';
    updateMainVideoDisplay();
  }
}

export function updateVideoStatus(peerId, micOn, cameraOn) {
  const wrapper = document.getElementById(`video-wrapper-${peerId}`);
  if (!wrapper) return;
  
  const micStatus = wrapper.querySelector('.mic-status i');
  const videoStatus = wrapper.querySelector('.video-status i');
  const video = wrapper.querySelector('video');
  const placeholder = wrapper.querySelector('.video-placeholder');
  
  if (micStatus) {
    micStatus.className = micOn ? 'fas fa-microphone' : 'fas fa-microphone-slash';
  }
  
  if (videoStatus) {
    videoStatus.className = cameraOn ? 'fas fa-video' : 'fas fa-video-slash';
  }
  
  if (video && video.srcObject) {
    const hasVideo = video.srcObject.getVideoTracks().some(t => t.enabled && t.readyState === 'live');
    if (hasVideo && cameraOn) {
      video.style.display = 'block';
      if (placeholder) placeholder.style.display = 'none';
    } else {
      video.style.display = 'none';
      if (placeholder) placeholder.style.display = 'flex';
    }
  }
}

// Listen for participant changes
document.addEventListener('participant-joined', (e) => {
  const { peerId, stream, name, isHost } = e.detail;
  addParticipantVideo(peerId, stream, name, isHost);
});

document.addEventListener('participant-left', (e) => {
  const { peerId } = e.detail;
  removeParticipantVideo(peerId);
});

document.addEventListener('pinned-participant-changed', () => {
  updateMainVideoDisplay();
});

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupVideoUI);
} else {
  setupVideoUI();
}

