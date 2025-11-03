// Utility function to update video and mic status indicators for a participant
export function updateParticipantStatusIndicators(peerId, hasVideo, hasAudio, isAudioEnabled) {
  const containerId = peerId === 'local' ? 'localVideoContainer' : `video-container-${peerId}`;
  const container = document.getElementById(containerId);
  if (!container) return;
  
  // Update video status
  const videoStatus = container.querySelector(`.video-status[data-peer-id="${peerId}"]`);
  if (videoStatus) {
    const videoIcon = videoStatus.querySelector('i');
    if (videoIcon) {
      if (hasVideo) {
        videoIcon.className = 'fas fa-video text-xs text-green-400';
      } else {
        videoIcon.className = 'fas fa-video-slash text-xs text-gray-400';
      }
    }
  }
  
  // Update mic status
  const micStatus = container.querySelector(`.mic-status[data-peer-id="${peerId}"]`);
  if (micStatus) {
    const micIcon = micStatus.querySelector('i');
    if (micIcon) {
      if (hasAudio && isAudioEnabled) {
        micIcon.className = 'fas fa-microphone text-xs text-green-400';
      } else {
        micIcon.className = 'fas fa-microphone-slash text-xs text-red-400';
      }
    }
  }
}

// Call this when tracks change
export function updateLocalStatusIndicators() {
  const stream = window.appState.localStream;
  if (!stream) return;
  
  const hasVideo = stream.getVideoTracks().some(t => t.enabled && t.readyState === 'live');
  const hasAudio = stream.getAudioTracks().length > 0;
  const isAudioEnabled = stream.getAudioTracks().some(t => t.enabled);
  
  updateParticipantStatusIndicators('local', hasVideo, hasAudio, isAudioEnabled);
}
