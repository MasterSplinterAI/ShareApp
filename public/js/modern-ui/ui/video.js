// Modern UI Video Management
// Handles video display, grid view, speaker view, and participant video containers

import { getSocketId } from '../../services/socket.js';

export function setupVideoUI() {
  // Listen for track events from peer connections
  setupTrackListeners();
  
  // Listen for participant events
  setupParticipantListeners();
  
  // Add local video to grid when media is initialized
  setupLocalVideo();
}

function setupTrackListeners() {
  // Listen for when peer connections receive tracks
  // This is triggered by peerConnection.js ontrack event
  document.addEventListener('peer-track-received', (event) => {
    const { peerId, track, stream } = event.detail;
    handlePeerTrack(peerId, track, stream);
  });
  
  // Also listen for when streams are added to peer connections
  // This happens when the connection is established
  // Note: We don't need to monitor peerConnections directly here as the events will handle it
}

function setupParticipantListeners() {
  // Listen for participant joined event
  document.addEventListener('participant-joined', (event) => {
    const { peerId, name, isHost } = event.detail;
    // Video will be added when track is received
  });
  
  // Listen for participant left event
  document.addEventListener('participant-left', (event) => {
    const { peerId } = event.detail;
    removeParticipantVideo(peerId);
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

function addLocalVideoToGrid() {
  if (!window.appState || !window.appState.localStream) return;
  
  const socketId = getSocketId();
  if (!socketId) return;
  
  // Check if local video already exists
  const existing = document.getElementById(`video-wrapper-local`);
  if (existing) return;
  
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
}

function handlePeerTrack(peerId, track, stream) {
  console.log(`Modern UI: Handling track for ${peerId}, kind: ${track.kind}`);
  
  // Ensure appState is initialized
  if (!window.appState) {
    console.warn('appState not initialized yet, skipping track handling');
    return;
  }
  
  // Check if video container exists
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
    } else {
      console.warn('Participants grid not found');
      return;
    }
  }
  
  // Update video element with stream
  const video = wrapper.querySelector(`#video-${peerId}`) || wrapper.querySelector('video');
  if (video && stream) {
    // Check if stream already set
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      
      // Try to play
      video.play().catch(err => {
        console.warn(`Could not autoplay video for ${peerId}:`, err);
      });
    }
    
    // Update visibility based on track type and state
    if (track.kind === 'video') {
      const hasEnabledVideo = stream.getVideoTracks().some(t => t.enabled && t.readyState === 'live');
      const placeholder = wrapper.querySelector('.video-placeholder');
      
      if (hasEnabledVideo) {
        video.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
      } else {
        video.style.display = 'none';
        if (placeholder) placeholder.style.display = 'flex';
      }
    }
  }
  
  // Update status indicators
  if (track.kind === 'audio') {
    const micStatus = wrapper.querySelector('.mic-status i');
    if (micStatus) {
      micStatus.className = track.enabled ? 'fas fa-microphone' : 'fas fa-microphone-slash';
    }
  }
  
  if (track.kind === 'video') {
    const videoStatus = wrapper.querySelector('.video-status i');
    if (videoStatus) {
      videoStatus.className = track.enabled ? 'fas fa-video' : 'fas fa-video-slash';
    }
  }
  
  // Update main video if this is pinned
  if (window.appState.pinnedParticipant === peerId) {
    updateMainVideoDisplay();
  }
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
  if (stream) {
    video.srcObject = stream;
  }
  if (peerId === 'local') {
    video.muted = true; // Mute local video to prevent echo
  }
  
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
        updateVideoStatus(peerId, audioTracks[0]?.enabled || false, false);
      });
      
      track.addEventListener('mute', () => {
        video.style.display = 'none';
        placeholder.style.display = 'flex';
        updateVideoStatus(peerId, audioTracks[0]?.enabled || false, false);
      });
      
      track.addEventListener('unmute', () => {
        video.style.display = 'block';
        placeholder.style.display = 'none';
        updateVideoStatus(peerId, audioTracks[0]?.enabled || false, true);
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
  pinBtn.className = 'control-btn';
  pinBtn.style.cssText = 'position: absolute; top: 8px; right: 8px; width: 32px; height: 32px; z-index: 10;';
  pinBtn.innerHTML = '<i class="fas fa-thumbtack"></i>';
  pinBtn.title = 'Pin to main view';
  pinBtn.addEventListener('click', () => {
    if (window.appState) {
      window.appState.pinnedParticipant = peerId === 'local' ? 'local' : peerId;
      updateMainVideoDisplay();
      document.dispatchEvent(new CustomEvent('pinned-participant-changed'));
    }
  });
  
  wrapper.appendChild(pinBtn);
  
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
    const video = existing.querySelector('video');
    if (video && stream) {
      video.srcObject = stream;
      
      // Check if video should be visible
      const hasVideo = stream.getVideoTracks().some(t => t.enabled && t.readyState === 'live');
      const placeholder = existing.querySelector('.video-placeholder');
      
      if (hasVideo) {
        video.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
      } else {
        video.style.display = 'none';
        if (placeholder) placeholder.style.display = 'flex';
      }
    }
    return;
  }
  
  const wrapper = createVideoContainer(peerId, stream, name, isHost);
  
  // Add to grid
  grid.appendChild(wrapper);
  
  // Update main video if this is the pinned participant
  if (window.appState && window.appState.pinnedParticipant === peerId) {
    updateMainVideoDisplay();
  }
}

export function removeParticipantVideo(peerId) {
  const wrapper = document.getElementById(`video-wrapper-${peerId}`);
  if (wrapper) {
    wrapper.remove();
  }
  
  // If this was the pinned participant, reset to local
  if (window.appState && window.appState.pinnedParticipant === peerId) {
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
    const stream = video.srcObject;
    const hasVideo = stream.getVideoTracks().some(t => t.enabled && t.readyState === 'live');
    
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
  const { peerId, name, isHost } = e.detail;
  // Video will be added when track is received via handlePeerTrack
});

document.addEventListener('participant-left', (e) => {
  const { peerId } = e.detail;
  removeParticipantVideo(peerId);
});

document.addEventListener('pinned-participant-changed', () => {
  updateMainVideoDisplay();
});

// Hook into peerConnection.js ontrack event
// We'll modify peerConnection.js to dispatch events that this module can listen to
// For now, let's also check periodically for new streams
let trackCheckInterval = null;

function startTrackMonitoring() {
  if (trackCheckInterval) return;
  
  trackCheckInterval = setInterval(() => {
    // Ensure appState is initialized
    if (!window.appState || !window.appState.peerConnections) {
      return; // Skip if not initialized yet
    }
    
    // Check all peer connections for tracks
    Object.entries(window.appState.peerConnections).forEach(([peerId, pc]) => {
      if (pc && pc.getReceivers) {
        const receivers = pc.getReceivers();
        receivers.forEach(receiver => {
          if (receiver.track) {
            const stream = receiver.track ? new MediaStream([receiver.track]) : null;
            if (stream && !document.getElementById(`video-wrapper-${peerId}`)) {
              // Track exists but no video container - create one
              const participant = window.appState.participants && window.appState.participants[peerId];
              if (participant) {
                handlePeerTrack(peerId, receiver.track, stream);
              }
            }
          }
        });
      }
    });
  }, 2000); // Check every 2 seconds
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupVideoUI();
    setTimeout(startTrackMonitoring, 3000); // Start monitoring after 3 seconds
  });
} else {
  setupVideoUI();
  setTimeout(startTrackMonitoring, 3000);
}
