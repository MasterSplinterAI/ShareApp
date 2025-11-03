// Audio level detection and visualization module
// Provides audio level monitoring for speaking indicators

let audioContext = null;
let analysers = new Map(); // Map of peerId -> AnalyserNode
let animationFrames = new Map(); // Map of peerId -> animationFrameId

// Initialize audio context if not already initialized
function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

// Start monitoring audio levels for a stream
export function startAudioLevelMonitoring(peerId, stream) {
  try {
    // Stop existing monitoring if any
    stopAudioLevelMonitoring(peerId);
    
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      return;
    }
    
    const ctx = getAudioContext();
    
    // Create audio source from stream
    const source = ctx.createMediaStreamSource(stream);
    
    // Create analyser node
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    
    // Connect source to analyser
    source.connect(analyser);
    
    // Store analyser
    analysers.set(peerId, analyser);
    
    // Start monitoring loop
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let animationFrameId;
    
    function monitor() {
      if (!analysers.has(peerId)) {
        return; // Stop monitoring if removed
      }
      
      analyser.getByteFrequencyData(dataArray);
      
      // Calculate average volume
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      
      // Normalize to 0-100
      const level = Math.min(100, (average / 255) * 100);
      
      // Determine if speaking (threshold: 10% volume)
      const isSpeaking = level > 10;
      
      // Dispatch custom event with audio level
      document.dispatchEvent(new CustomEvent('audio-level', {
        detail: {
          peerId,
          level,
          isSpeaking
        }
      }));
      
      animationFrameId = requestAnimationFrame(monitor);
      animationFrames.set(peerId, animationFrameId);
    }
    
    monitor();
    
    console.log(`Started audio level monitoring for ${peerId}`);
  } catch (error) {
    console.error(`Failed to start audio level monitoring for ${peerId}:`, error);
  }
}

// Stop monitoring audio levels for a peer
export function stopAudioLevelMonitoring(peerId) {
  const animationFrameId = animationFrames.get(peerId);
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrames.delete(peerId);
  }
  
  analysers.delete(peerId);
  console.log(`Stopped audio level monitoring for ${peerId}`);
}

// Stop all audio level monitoring
export function stopAllAudioLevelMonitoring() {
  analysers.forEach((_, peerId) => {
    stopAudioLevelMonitoring(peerId);
  });
}

// Get current audio level for a peer (if monitoring)
export function getAudioLevel(peerId) {
  const analyser = analysers.get(peerId);
  if (!analyser) {
    return 0;
  }
  
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(dataArray);
  
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    sum += dataArray[i];
  }
  
  return Math.min(100, (sum / dataArray.length / 255) * 100);
}
