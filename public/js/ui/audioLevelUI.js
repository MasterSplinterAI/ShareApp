// UI module for handling audio level events and updating speaking indicators
// Listens to audio-level events and updates UI accordingly

export function setupAudioLevelUI() {
  // Listen for audio level events
  document.addEventListener('audio-level', (event) => {
    const { peerId, level, isSpeaking } = event.detail;
    
    // Update speaking indicator - handle both 'local' and actual peer IDs
    const containerId = peerId === 'local' ? 'localVideoContainer' : `video-container-${peerId}`;
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Find speaking indicator elements
    const speakingWrapper = container.querySelector('.speaking-indicator-wrapper');
    const speakingIndicator = container.querySelector('.speaking-indicator');
    const placeholder = container.querySelector('.no-video-placeholder');
    
    if (isSpeaking) {
      // Show speaking indicators
      if (speakingWrapper) {
        speakingWrapper.classList.remove('hidden');
      }
      if (speakingIndicator) {
        speakingIndicator.classList.remove('hidden');
      }
      
      // Add speaking class to container for styling
      container.classList.add('speaking');
      
      // Add border highlight when speaking
      if (!container.classList.contains('speaking-border')) {
        container.classList.add('speaking-border');
      }
    } else {
      // Hide speaking indicators
      if (speakingWrapper) {
        speakingWrapper.classList.add('hidden');
      }
      if (speakingIndicator) {
        speakingIndicator.classList.add('hidden');
      }
      
      // Remove speaking class
      container.classList.remove('speaking', 'speaking-border');
    }
    
    // Update mic status based on audio level
    const micStatus = container.querySelector(`.mic-status[data-peer-id="${peerId}"]`);
    if (micStatus) {
      const micIcon = micStatus.querySelector('i');
      if (micIcon) {
        if (level > 0) {
          micIcon.className = 'fas fa-microphone text-xs text-green-400';
        } else {
          micIcon.className = 'fas fa-microphone-slash text-xs text-red-400';
        }
      }
    }
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupAudioLevelUI);
} else {
  setupAudioLevelUI();
}
