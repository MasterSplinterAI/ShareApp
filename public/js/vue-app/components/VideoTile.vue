<template>
  <div class="video-tile" :class="{ pinned: isPinned, local: isLocal }">
    <video
      ref="videoElement"
      :srcObject="stream"
      autoplay
      playsinline
      muted
      v-if="stream && hasVideo"
    ></video>
    
    <div v-else class="placeholder">
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
  const videoTracks = props.stream.getVideoTracks()
  return videoTracks.length > 0 && videoTracks.some(t => t.enabled)
})

const hasAudio = computed(() => {
  if (!props.stream) return false
  const audioTracks = props.stream.getAudioTracks()
  return audioTracks.length > 0 && audioTracks.some(t => t.enabled)
})

watch(() => props.stream, (newStream) => {
  if (videoElement.value && newStream) {
    videoElement.value.srcObject = newStream
    // Force video to play
    videoElement.value.play().catch(e => console.log('Video play error:', e))
  }
}, { immediate: true })

watch(() => hasVideo.value, (hasVid) => {
  // When video becomes available, ensure it's displayed
  if (hasVid && videoElement.value && props.stream) {
    videoElement.value.srcObject = props.stream
    videoElement.value.play().catch(e => console.log('Video play error:', e))
  }
})

onMounted(() => {
  if (videoElement.value && props.stream) {
    videoElement.value.srcObject = props.stream
    videoElement.value.play().catch(e => console.log('Video play error:', e))
  }
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

