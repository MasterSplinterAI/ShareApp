<template>
  <div class="video-tile" :class="{ pinned: isPinned, local: isLocal }">
    <video
      ref="videoElement"
      :srcObject="stream"
      autoplay
      playsinline
      muted
      v-show="stream && hasVideo"
    ></video>
    
    <div v-show="!hasVideo || !stream" class="placeholder">
      <div class="avatar">
        {{ initials }}
      </div>
      <div class="name">{{ participant.name }}</div>
      <div v-if="participant.isHost" class="host-badge">Host</div>
      <div v-if="!hasVideo" class="status">Camera off</div>
    </div>
    
    <div class="overlay">
      <div class="info">
        <span class="name">{{ participant.name }}</span>
        <span v-if="participant.isHost" class="host-badge">Host</span>
      </div>
      <div class="controls">
        <button @click="$emit('pin')" class="control-btn" :class="{ active: isPinned }">
          <i class="fas fa-thumbtack"></i>
        </button>
      </div>
    </div>
    
    <div class="status-indicators">
      <div class="indicator mic" :class="{ muted: !hasAudio }">
        <i :class="hasAudio ? 'fas fa-microphone' : 'fas fa-microphone-slash'"></i>
      </div>
      <div class="indicator video" :class="{ off: !hasVideo }">
        <i :class="hasVideo ? 'fas fa-video' : 'fas fa-video-slash'"></i>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  stream: {
    type: MediaStream,
    default: null,
  },
  participant: {
    type: Object,
    required: true,
  },
  isPinned: {
    type: Boolean,
    default: false,
  },
  isLocal: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['pin'])

const videoElement = ref(null)

const initials = computed(() => {
  const name = props.participant.name || 'U'
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
})

const hasVideo = computed(() => {
  if (!props.stream) return false
  try {
    const videoTracks = props.stream.getVideoTracks()
    if (videoTracks.length === 0) return false
    
    // Check for enabled tracks - accept 'live' or 'ready' states (ready happens before live)
    // Also accept tracks that are just enabled (may not have readyState set yet)
    const hasEnabledTrack = videoTracks.some(t => {
      if (!t) return false
      // Track must be enabled
      if (!t.enabled) return false
      // Accept 'live', 'ready', or tracks without readyState set yet
      // When a track is first enabled, readyState might be 'live' immediately
      return !t.readyState || t.readyState === 'live' || t.readyState === 'ready'
    })
    
    // If we have an enabled track, check video element dimensions as fallback
    if (hasEnabledTrack && videoElement.value) {
      // If video element has dimensions, definitely has video
      if (videoElement.value.videoWidth > 0 && videoElement.value.videoHeight > 0) {
        return true
      }
      // Even without dimensions yet, if track is enabled, return true
      // Video might still be loading
      return true
    }
    
    return hasEnabledTrack
  } catch (e) {
    console.error('Error checking video tracks:', e)
    return false
  }
})

const hasAudio = computed(() => {
  if (!props.stream) return false
  const audioTracks = props.stream.getAudioTracks()
  return audioTracks.length > 0 && audioTracks.some(t => t.enabled)
})

watch(() => props.stream, (newStream, oldStream) => {
  if (videoElement.value) {
    // Only update if stream actually changed (by reference or by tracks)
    const streamChanged = newStream !== oldStream
    
    if (newStream && streamChanged) {
      // Clear first to prevent play() interruption errors
      if (videoElement.value.srcObject) {
        videoElement.value.srcObject = null
      }
      
      // Small delay to ensure previous stream is cleared
      setTimeout(() => {
        if (videoElement.value && newStream === props.stream) {
          videoElement.value.srcObject = newStream
          // Force video to play
          const playPromise = videoElement.value.play()
          if (playPromise !== undefined) {
            playPromise.catch(e => {
              // Ignore AbortError - it just means a new load started
              if (!e.message || !e.message.includes('interrupted')) {
                console.log('Video play error:', e)
              }
            })
          }
        }
      }, 50)
    } else if (!newStream && videoElement.value.srcObject) {
      videoElement.value.srcObject = null
    }
  }
}, { immediate: true })

watch(() => hasVideo.value, (hasVid, oldHasVid) => {
  // Only update if video state actually changed
  if (hasVid !== oldHasVid && hasVid && videoElement.value && props.stream) {
    // Debounce to prevent rapid changes
    if (videoElement.value._updatingVideo) return
    videoElement.value._updatingVideo = true
    
    setTimeout(() => {
      if (videoElement.value && props.stream && hasVideo.value) {
        if (videoElement.value.srcObject !== props.stream) {
          videoElement.value.srcObject = props.stream
          const playPromise = videoElement.value.play()
          if (playPromise !== undefined) {
            playPromise.catch(e => {
              if (!e.message || !e.message.includes('interrupted')) {
                console.log('Video play error:', e)
              }
            })
          }
        }
      }
      if (videoElement.value) {
        videoElement.value._updatingVideo = false
      }
    }, 100)
  }
}, { immediate: true })

watch(() => props.stream?.getVideoTracks(), (tracks) => {
  // React to video track changes - check both tracks array and enabled state
  if (tracks && tracks.length > 0 && videoElement.value && props.stream) {
    const hasEnabledTrack = tracks.some(t => t && t.enabled && (t.readyState === 'live' || t.readyState === 'ready'))
    if (hasEnabledTrack) {
      // Debounce to prevent rapid updates
      if (videoElement.value._updatingVideo) return
      videoElement.value._updatingVideo = true
      
      setTimeout(() => {
        if (videoElement.value && props.stream && hasVideo.value) {
          if (videoElement.value.srcObject !== props.stream) {
            videoElement.value.srcObject = props.stream
            const playPromise = videoElement.value.play()
            if (playPromise !== undefined) {
              playPromise.catch(e => {
                if (!e.message || !e.message.includes('interrupted')) {
                  console.log('Video play error:', e)
                }
              })
            }
          }
        }
        if (videoElement.value) {
          videoElement.value._updatingVideo = false
        }
      }, 150)
    }
  }
}, { deep: true, immediate: true })

// Watch for track enabled/disabled events more directly
watch(() => hasVideo.value, (hasVid, oldHasVid) => {
  if (hasVid !== oldHasVid && videoElement.value && props.stream) {
    // Video state changed - force update
    if (hasVid) {
      videoElement.value.srcObject = props.stream
      videoElement.value.play().catch(e => console.log('Video play error:', e))
    } else {
      // Video disabled - clear but keep element
      videoElement.value.srcObject = null
    }
  }
}, { immediate: true })

const trackListeners = []

const setupTrackListeners = () => {
  // Clean up existing listeners
  trackListeners.forEach(({ track, handler }) => {
    track.removeEventListener('enabled', handler)
    track.removeEventListener('ended', handler)
  })
  trackListeners.length = 0
  
  if (!props.stream) return
  
  const handleTrackChange = () => {
    // Force Vue to re-evaluate hasVideo computed by triggering reactivity
    // This is a workaround - Vue doesn't automatically detect MediaStreamTrack.enabled changes
    if (videoElement.value && props.stream) {
      // Re-assign stream to force video element update
      videoElement.value.srcObject = props.stream
      // Force play attempt
      const playPromise = videoElement.value.play()
      if (playPromise !== undefined) {
        playPromise.catch(e => console.log('Video play error:', e))
      }
      
      // Also check if video has dimensions after a short delay
      setTimeout(() => {
        if (videoElement.value && videoElement.value.videoWidth > 0) {
          console.log(`Video track enabled - video dimensions: ${videoElement.value.videoWidth}x${videoElement.value.videoHeight}`)
        }
      }, 200)
    }
  }
  
  props.stream.getVideoTracks().forEach(track => {
    track.addEventListener('enabled', handleTrackChange)
    track.addEventListener('mute', handleTrackChange)
    track.addEventListener('unmute', handleTrackChange)
    track.addEventListener('ended', handleTrackChange)
    trackListeners.push({ track, handler: handleTrackChange })
  })
}

watch(() => props.stream, () => {
  setupTrackListeners()
}, { immediate: true })

onMounted(() => {
  if (videoElement.value && props.stream) {
    videoElement.value.srcObject = props.stream
    const playPromise = videoElement.value.play()
    if (playPromise !== undefined) {
      playPromise.catch(e => console.log('Video play error:', e))
    }
  }
  
  setupTrackListeners()
})

onUnmounted(() => {
  trackListeners.forEach(({ track, handler }) => {
    track.removeEventListener('enabled', handler)
    track.removeEventListener('mute', handler)
    track.removeEventListener('unmute', handler)
    track.removeEventListener('ended', handler)
  })
  trackListeners.length = 0
})
</script>

<style scoped>
.video-tile {
  position: relative;
  background: #2a2a2a;
  border-radius: 8px;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  min-height: 200px;
}

.video-tile.pinned {
  grid-column: 1 / -1;
  grid-row: 1 / -1;
}

video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 10; /* Higher than placeholder to ensure video is on top */
  pointer-events: none; /* Allow clicks to pass through to controls */
}

.placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1; /* Below video */
  pointer-events: none; /* Allow clicks to pass through to controls */
}

.avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  font-weight: bold;
  margin-bottom: 1rem;
}

.name {
  font-size: 1.2rem;
  font-weight: 500;
  margin-bottom: 0.5rem;
}

.status {
  font-size: 0.9rem;
  opacity: 0.8;
}

.overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.8), transparent);
  padding: 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  z-index: 20; /* Above video and placeholder */
  pointer-events: auto; /* Allow clicking controls */
}

.info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.info .name {
  color: white;
  font-weight: 500;
}

.host-badge {
  background: #4a6cf7;
  color: white;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
}

.controls {
  display: flex;
  gap: 0.5rem;
}

.control-btn {
  background: rgba(255, 255, 255, 0.2);
  border: none;
  color: white;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.control-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.control-btn.active {
  background: #4a6cf7;
}

.status-indicators {
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  z-index: 20; /* Above video and placeholder */
  pointer-events: auto; /* Allow interactions */
}

.indicator {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 0.875rem;
}

.indicator.muted,
.indicator.off {
  background: rgba(220, 38, 38, 0.8);
}

@media (max-width: 768px) {
  .video-tile {
    min-height: 150px;
  }
  
  .avatar {
    width: 60px;
    height: 60px;
    font-size: 1.5rem;
  }
  
  .overlay {
    padding: 0.75rem;
  }
  
  .control-btn {
    width: 32px;
    height: 32px;
  }
}
</style>

