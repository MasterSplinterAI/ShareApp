// Modern UI Video Management
// Handles video display, grid view, speaker view, and participant video containers

import { getSocketId } from '../../services/socket.js';

// Track all participants (including local) for grid display
let allParticipants = new Map();

export function setupVideoUI() {
  // Listen for track events from peer connections
  setupTrackListeners();
  
  // Listen for participant events
  setupParticipantListeners();
  
  // Add local video to grid when media is initialized
  setupLocalVideo();
  
  // Refresh grid layout when participants change
  setupGridRefresh();
}

function setupTrackListeners() {
  // Listen for when peer connections receive tracks
  document.addEventListener('peer-track-received', (event) => {
    const { peerId, track, stream } = event.detail;
    handlePeerTrack(peerId, track, stream);
  });
}

function setupParticipantListeners() {
  // Listen for participant joined - create container immediately
  document.addEventListener('participant-joined', (event) => {
    const { participantId, participantName } = event.detail;
    const participant = window.appState?.participants?.[participantId];
    if (participant) {
      createParticipantContainer(participantId, participant.name, participant.isHost);
    }
  });
  
  // Listen for participant left event
  document.addEventListener('participant-left', (event) => {
    const { peerId } = event.detail;
    removeParticipantVideo(peerId);
  });
  
  // Listen for user-joined from socket
  document.addEventListener('user-joined-event', (event) => {
    const { userId, name, isHost } = event.detail;
    if (userId && userId !== getSocketId()) {
      createParticipantContainer(userId, name, isHost);
    }
  });
}

function setupLocalVideo() {
  // Watch for local stream initialization
  const checkLocalStream = setInterval(() => {
    if (window.appState && window.appState.localStream) {
      clearInterval(checkLocalStream);
      addLocalVideoToGrid();
    }
  }, 500);
  
  // Also listen for media initialization event
  document.addEventListener('local-stream-ready', () => {
    if (window.appState && window.appState.localStream) {
      addLocalVideoToGrid();
    }
  });
}

function setupGridRefresh() {
  // Refresh grid layout when participants change
  const refreshGrid = () => {
    updateGridLayout();
  };
  
  document.addEventListener('participant-joined', refreshGrid);
  document.addEventListener('participant-left', refreshGrid);
  document.addEventListener('local-stream-ready', refreshGrid);
}

function updateGridLayout() {
  const grid = document.getElementById('participantsGrid');
  if (!grid) return;
  
  const participantCount = grid.children.length;
  
  // Dynamic grid columns based on participant count
  if (participantCount === 1) {
    grid.style.gridTemplateColumns = '1fr';
  } else if (participantCount === 2) {
    grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
  } else if (participantCount <= 4) {
    grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
  } else if (participantCount <= 6) {
    grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
  } else if (participantCount <= 9) {
    grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
  } else {
    grid.style.gridTemplateColumns = 'repeat(4, 1fr)';
  }
  
  // Mobile adjustments
  if (window.innerWidth <= 640) {
    if (participantCount <= 2) {
      grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
    } else {
      grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
    }
  }
}

function addLocalVideoToGrid() {
  if (!window.appState || !window.appState.localStream) return;
  
  const socketId = getSocketId();
  if (!socketId) return;
  
  // Check if local video already exists
  const existing = document.getElementById(`video-wrapper-local`);
  if (existing) {
    // Update existing
    updateVideoStream('local', window.appState.localStream);
    return;
  }
  
  // Add local video to grid
  const grid = document.getElementById('participantsGrid');
  if (!grid) return;
  
  const wrapper = createVideoContainer('local', window.appState.localStream, 'You', window.appState.isHost);
  
  // Set video to muted to prevent echo
  const video = wrapper.querySelector('video');
  if (video) {
    video.muted = true;
  }
  
  grid.appendChild(wrapper);
  updateGridLayout();
}

function createParticipantContainer(peerId, name, isHost = false) {
  // Check if already exists
  const existing = document.getElementById(`video-wrapper-${peerId}`);
  if (existing) return existing;
  
  const grid = document.getElementById('participantsGrid');
  if (!grid) return null;
  
  // Create container with placeholder (will show video when track arrives)
  const wrapper = createVideoContainer(peerId, null, name, isHost);
  
  // Add to grid
  grid.appendChild(wrapper);
  updateGridLayout();
  
  return wrapper;
}

function handlePeerTrack(peerId, track, stream) {
  console.log(`Modern UI: Handling track for ${peerId}, kind: ${track.kind}`);
  
  // Ensure appState is initialized
  if (!window.appState) {
    console.warn('appState not initialized yet, skipping track handling');
    return;
  }
  
  // Ensure container exists
  let wrapper = document.getElementById(`video-wrapper-${peerId}`);
  
  if (!wrapper) {
    // Create new container
    const participant = window.appState.participants && window.appState.participants[peerId];
    const name = participant?.name || `Participant ${peerId.substring(0, 5)}`;
    const isHost = participant?.isHost || false;
    
    wrapper = createVideoContainer(peerId, stream, name, isHost);
    
    // Add to grid
    const grid = document.getElementById('participantsGrid');
    if (grid) {
      grid.appendChild(wrapper);
      updateGridLayout();
    } else {
      console.warn('Participants grid not found');
      return;
    }
  } else {
    // Update existing container with stream
    updateVideoStream(peerId, stream);
  }
  
  // Update status indicators
  if (track.kind === 'audio') {
    updateMicStatus(peerId, track.enabled);
  }
  
  if (track.kind === 'video') {
    updateVideoStatus(peerId, track.enabled);
  }
  
  // Update main video if this is pinned
  if (window.appState.pinnedParticipant === peerId) {
    updateMainVideoDisplay();
  }
}

function updateVideoStream(peerId, stream) {
  const wrapper = document.getElementById(`video-wrapper-${peerId}`);
  if (!wrapper) return;
  
  const video = wrapper.querySelector(`#video-${peerId}`) || wrapper.querySelector('video');
  const placeholder = wrapper.querySelector('.video-placeholder');
  
  if (video && stream) {
    // Check if stream already set
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      
      // Try to play
      video.play().catch(err => {
        console.warn(`Could not autoplay video for ${peerId}:`, err);
      });
    }
    
    // Update visibility based on video tracks
    const hasEnabledVideo = stream.getVideoTracks().some(t => t.enabled && t.readyState === 'live');
    
    if (hasEnabledVideo) {
      video.style.display = 'block';
      if (placeholder) placeholder.style.display = 'none';
    } else {
      video.style.display = 'none';
      if (placeholder) placeholder.style.display = 'flex';
    }
  } else if (!stream || !stream.getVideoTracks().some(t => t.enabled && t.readyState === 'live')) {
    // No video - show placeholder
    if (video) video.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
  }
}

function updateMicStatus(peerId, enabled) {
  const wrapper = document.getElementById(`video-wrapper-${peerId}`);
  if (!wrapper) return;
  
  const micStatus = wrapper.querySelector('.mic-status i');
  if (micStatus) {
    micStatus.className = enabled ? 'fas fa-microphone' : 'fas fa-microphone-slash';
  }
}

function updateVideoStatus(peerId, enabled) {
  const wrapper = document.getElementById(`video-wrapper-${peerId}`);
  if (!wrapper) return;
  
  const videoStatus = wrapper.querySelector('.video-status i');
  if (videoStatus) {
    videoStatus.className = enabled ? 'fas fa-video' : 'fas fa-video-slash';
  }
  
  // Update video visibility
  const video = wrapper.querySelector('video');
  const placeholder = wrapper.querySelector('.video-placeholder');
  
  if (video && video.srcObject) {
    const stream = video.srcObject;
    const hasVideo = stream.getVideoTracks().some(t => t.enabled && t.readyState === 'live');
    
    if (hasVideo && enabled) {
      video.style.display = 'block';
      if (placeholder) placeholder.style.display = 'none';
    } else {
      video.style.display = 'none';
      if (placeholder) placeholder.style.display = 'flex';
    }
  }
}

export function createVideoContainer(peerId, stream, name, isHost = false) {
  const wrapper = document.createElement('div');
  wrapper.className = 'video-wrapper';
  wrapper.id = `video-wrapper-${peerId}`;
  wrapper.style.cssText = `
    position: relative;
    background: #000;
    border-radius: 4px;
    overflow: hidden;
    aspect-ratio: 16/9;
    min-height: 0;
    z-index: 1;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  `;
  
  // Create video element
  const video = document.createElement('video');
  video.id = `video-${peerId}`;
  video.autoplay = true;
  video.playsInline = true;
  video.style.cssText = `
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: none;
    pointer-events: auto;
  `;
  
  if (stream) {
    video.srcObject = stream;
    if (peerId === 'local') {
      video.muted = true; // Mute local video to prevent echo
    }
  }
  
  // Create placeholder
  const placeholder = document.createElement('div');
  placeholder.className = 'video-placeholder';
  placeholder.style.cssText = `
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #1a1a1a;
    z-index: 2;
    pointer-events: none;
  `;
  
  // Get initials
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || 'U';
  
  placeholder.innerHTML = `
    <div class="avatar" style="width: 64px; height: 64px; border-radius: 50%; background: #3b82f6; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px; font-weight: bold; margin-bottom: 8px;">${initials}</div>
    <div class="name" style="color: white; font-size: 14px; font-weight: 500;">${name}${isHost ? ' (Host)' : ''}</div>
  `;
  
  // Create label
  const label = document.createElement('div');
  label.className = 'video-label';
  label.style.cssText = `
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
    padding: 8px 12px;
    color: white;
    font-size: 12px;
    z-index: 10;
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
  `;
  
  label.innerHTML = `
    <span class="name" style="font-weight: 500;">${name}${isHost ? ' (Host)' : ''}</span>
    <span class="status" style="display: flex; gap: 8px;">
      <span class="status-icon mic-status" data-peer-id="${peerId}">
        <i class="fas fa-microphone" style="font-size: 12px;"></i>
      </span>
      <span class="status-icon video-status" data-peer-id="${peerId}">
        <i class="fas fa-video-slash" style="font-size: 12px;"></i>
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
    
    // Check initial state
    const hasEnabledVideo = videoTracks.length > 0 && videoTracks[0].enabled && videoTracks[0].readyState === 'live';
    
    if (hasEnabledVideo) {
      placeholder.style.display = 'none';
      video.style.display = 'block';
    } else {
      video.style.display = 'none';
      placeholder.style.display = 'flex';
    }
    
    // Listen for track changes
    videoTracks.forEach(track => {
      track.addEventListener('ended', () => {
        video.style.display = 'none';
        placeholder.style.display = 'flex';
        updateVideoStatus(peerId, false);
      });
      
      track.addEventListener('mute', () => {
        video.style.display = 'none';
        placeholder.style.display = 'flex';
        updateVideoStatus(peerId, false);
      });
      
      track.addEventListener('unmute', () => {
        video.style.display = 'block';
        placeholder.style.display = 'none';
        updateVideoStatus(peerId, true);
      });
    });
    
    // Update mic status
    if (audioTracks.length > 0) {
      const micStatus = label.querySelector('.mic-status i');
      if (micStatus) {
        micStatus.className = audioTracks[0].enabled ? 'fas fa-microphone' : 'fas fa-microphone-slash';
      }
    }
  }
  
  // Pin button
  const pinBtn = document.createElement('button');
  pinBtn.className = 'control-btn pin-btn';
  pinBtn.style.cssText = `
    position: absolute;
    top: 8px;
    right: 8px;
    width: 32px;
    height: 32px;
    z-index: 20;
    background: rgba(0, 0, 0, 0.6);
    border: none;
    border-radius: 4px;
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    pointer-events: auto;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  `;
  pinBtn.innerHTML = '<i class="fas fa-thumbtack"></i>';
  pinBtn.title = 'Pin to main view';
  pinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (window.appState) {
      window.appState.pinnedParticipant = peerId === 'local' ? 'local' : peerId;
      updateMainVideoDisplay();
      document.dispatchEvent(new CustomEvent('pinned-participant-changed'));
    }
  });
  
  // Fullscreen button
  const fullscreenBtn = document.createElement('button');
  fullscreenBtn.className = 'control-btn fullscreen-btn';
  fullscreenBtn.style.cssText = `
    position: absolute;
    top: 8px;
    right: 44px;
    width: 32px;
    height: 32px;
    z-index: 20;
    background: rgba(0, 0, 0, 0.6);
    border: none;
    border-radius: 4px;
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    pointer-events: auto;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  `;
  fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
  fullscreenBtn.title = 'Fullscreen';
  fullscreenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const videoEl = wrapper.querySelector('video');
    if (videoEl && videoEl.srcObject) {
      if (videoEl.requestFullscreen) {
        videoEl.requestFullscreen();
      } else if (videoEl.webkitRequestFullscreen) {
        videoEl.webkitRequestFullscreen();
      } else if (videoEl.mozRequestFullScreen) {
        videoEl.mozRequestFullScreen();
      } else if (videoEl.msRequestFullscreen) {
        videoEl.msRequestFullscreen();
      }
    }
  });
  
  wrapper.appendChild(pinBtn);
  wrapper.appendChild(fullscreenBtn);
  
  return wrapper;
}

export function updateMainVideoDisplay() {
  const mainVideo = document.getElementById('mainVideo');
  const mainVideoWrapper = document.getElementById('mainVideoWrapper');
  
  if (!mainVideo || !mainVideoWrapper || !window.appState) return;
  
  const pinnedParticipant = window.appState.pinnedParticipant || 'local';
  
  if (pinnedParticipant === 'local') {
    // Show local video
    if (window.appState.localStream) {
      mainVideo.srcObject = window.appState.localStream;
      mainVideo.muted = true;
      
      const label = mainVideoWrapper.querySelector('.video-label .name');
      if (label) label.textContent = 'You';
      
      // Update placeholder
      const hasVideo = window.appState.localStream.getVideoTracks().some(
        t => t.enabled && t.readyState === 'live'
      );
      
      const placeholder = mainVideoWrapper.querySelector('.video-placeholder');
      if (hasVideo) {
        mainVideo.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
      } else {
        mainVideo.style.display = 'none';
        if (placeholder) {
          placeholder.style.display = 'flex';
          const initials = 'You'.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || 'U';
          placeholder.querySelector('.avatar').textContent = initials;
          placeholder.querySelector('.name').textContent = 'You';
        }
      }
    }
  } else {
    // Show pinned participant video
    const peerVideo = document.getElementById(`video-${pinnedParticipant}`);
    if (peerVideo && peerVideo.srcObject) {
      mainVideo.srcObject = peerVideo.srcObject;
      mainVideo.muted = false;
      
      const participant = window.appState.participants && window.appState.participants[pinnedParticipant];
      const label = mainVideoWrapper.querySelector('.video-label .name');
      if (label) label.textContent = participant?.name || 'Participant';
      
      // Update placeholder
      const stream = peerVideo.srcObject;
      const hasVideo = stream.getVideoTracks().some(t => t.enabled && t.readyState === 'live');
      
      const placeholder = mainVideoWrapper.querySelector('.video-placeholder');
      if (hasVideo) {
        mainVideo.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
      } else {
        mainVideo.style.display = 'none';
        if (placeholder) {
          placeholder.style.display = 'flex';
          const participant = (window.appState.participants && window.appState.participants[pinnedParticipant]) || { name: 'Participant' };
          const initials = participant.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || 'U';
          placeholder.querySelector('.avatar').textContent = initials;
          placeholder.querySelector('.name').textContent = participant.name;
        }
      }
      
      mainVideo.play().catch(err => {
        console.warn('Could not play main video:', err);
      });
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
    updateVideoStream(peerId, stream);
    return;
  }
  
  const wrapper = createVideoContainer(peerId, stream, name, isHost);
  
  // Add to grid
  grid.appendChild(wrapper);
  updateGridLayout();
  
  // Update main video if this is the pinned participant
  if (window.appState && window.appState.pinnedParticipant === peerId) {
    updateMainVideoDisplay();
  }
}

export function removeParticipantVideo(peerId) {
  const wrapper = document.getElementById(`video-wrapper-${peerId}`);
  if (wrapper) {
    wrapper.remove();
    updateGridLayout();
  }
  
  // If this was the pinned participant, reset to local
  if (window.appState && window.appState.pinnedParticipant === peerId) {
    window.appState.pinnedParticipant = 'local';
    updateMainVideoDisplay();
  }
}

// Listen for participant changes
document.addEventListener('participant-joined', (e) => {
  const { participantId, participantName } = e.detail;
  const participant = window.appState?.participants?.[participantId];
  if (participant) {
    createParticipantContainer(participantId, participant.name, participant.isHost);
  }
});

document.addEventListener('participant-left', (e) => {
  const { peerId } = e.detail;
  removeParticipantVideo(peerId);
});

document.addEventListener('pinned-participant-changed', () => {
  updateMainVideoDisplay();
});

// Hook into socket events
const originalSocketOn = window.socket?.on;
if (originalSocketOn) {
  window.socket.on('user-joined', (data) => {
    document.dispatchEvent(new CustomEvent('user-joined-event', {
      detail: {
        userId: data.userId,
        name: data.name,
        isHost: data.isHost
      }
    }));
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupVideoUI();
  });
} else {
  setupVideoUI();
}
