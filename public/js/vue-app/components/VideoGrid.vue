<template>
  <div class="video-grid-container">
    <div v-if="participantCount === 0" class="empty-state">
      <i class="fas fa-video"></i>
      <p>Waiting for participants...</p>
    </div>
    
    <div v-else class="video-grid" :class="gridClass">
      <!-- Local video -->
      <VideoTile
        :stream="appState.localStream"
        :participant="{ id: 'local', name: appState.userName || 'You', isHost: appState.isHost }"
        :is-pinned="appState.pinnedParticipant === 'local'"
        :is-local="true"
        @pin="handlePin('local')"
      />
      
      <!-- Remote participants -->
      <VideoTile
        v-for="participant in remoteParticipants"
        :key="participant.id"
        :stream="getStreamForParticipant(participant.id)"
        :participant="participant"
        :is-pinned="appState.pinnedParticipant === participant.id"
        :is-local="false"
        @pin="handlePin(participant.id)"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useAppState } from '../composables/useAppState.js'
import VideoTile from './VideoTile.vue'

const { appState, participantCount } = useAppState()

const remoteParticipants = computed(() => {
  if (!appState.participants || typeof appState.participants !== 'object') {
    return []
  }
  return Object.values(appState.participants).filter(p => p && p.id !== 'local')
})

const gridClass = computed(() => {
  const count = participantCount.value + 1 // +1 for local
  if (count === 1) return 'grid-1'
  if (count === 2) return 'grid-2'
  if (count <= 4) return 'grid-4'
  if (count <= 9) return 'grid-9'
  return 'grid-many'
})

const getStreamForParticipant = (participantId) => {
  // Get stream from peer connection
  const pc = appState.peerConnections[participantId]
  if (!pc) return null
  
  // Try to get remote stream from peer connection
  // Check if it's an RTCPeerConnection with remote stream
  if (pc.getRemoteStreams && pc.getRemoteStreams().length > 0) {
    return pc.getRemoteStreams()[0]
  }
  
  // Fallback: check if remoteStream property exists
  if (pc.remoteStream) {
    return pc.remoteStream
  }
  
  return null
}

const handlePin = (participantId) => {
  if (appState.pinnedParticipant === participantId) {
    appState.pinnedParticipant = 'local'
  } else {
    appState.pinnedParticipant = participantId
  }
}
</script>

<style scoped>
.video-grid-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  overflow: auto;
}

.empty-state {
  text-align: center;
  color: #888;
}

.empty-state i {
  font-size: 4rem;
  margin-bottom: 1rem;
  opacity: 0.5;
}

.video-grid {
  display: grid;
  gap: 1rem;
  width: 100%;
  height: 100%;
  max-width: 1920px;
}

.grid-1 {
  grid-template-columns: 1fr;
  grid-template-rows: 1fr;
}

.grid-2 {
  grid-template-columns: repeat(2, 1fr);
  grid-template-rows: 1fr;
}

.grid-4 {
  grid-template-columns: repeat(2, 1fr);
  grid-template-rows: repeat(2, 1fr);
}

.grid-9 {
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
}

.grid-many {
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  grid-auto-rows: minmax(200px, 1fr);
}

@media (max-width: 768px) {
  .video-grid {
    gap: 0.5rem;
    padding: 0.5rem;
  }
  
  .grid-2,
  .grid-4,
  .grid-9 {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
  }
}
</style>

