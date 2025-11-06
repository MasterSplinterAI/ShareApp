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
      
      <!-- Debug: Show participant info -->
      <!-- <div v-if="remoteParticipants.length > 0" style="position: fixed; top: 0; left: 0; background: rgba(0,0,0,0.8); color: white; padding: 10px; z-index: 9999; font-size: 12px;">
        Participants: {{ remoteParticipants.map(p => p.id).join(', ') }}<br>
        Peer Connections: {{ Object.keys(appState.peerConnections || {}).join(', ') }}<br>
        Streams: {{ remoteParticipants.map(p => getStreamForParticipant(p.id) ? 'has stream' : 'no stream').join(', ') }}
      </div> -->
    </div>
  </div>
</template>

<script setup>
import { computed, watch } from 'vue'
import { useAppState } from '../composables/useAppState.js'
import VideoTile from './VideoTile.vue'

const { appState, participantCount } = useAppState()

// Watch for peerConnections changes to trigger reactivity
watch(() => appState.peerConnections, () => {
  // Force reactivity when peer connections change or remoteStream is added
}, { deep: true })

// Watch for participants changes
watch(() => appState.participants, () => {
  // Force reactivity
}, { deep: true })

const remoteParticipants = computed(() => {
  if (!appState.participants || typeof appState.participants !== 'object') {
    return []
  }
  // Filter out 'local' and ensure we only get actual remote participants
  return Object.values(appState.participants).filter(p => {
    if (!p || !p.id) return false
    // Exclude 'local' ID
    if (p.id === 'local') return false
    // Ensure it's a string ID (not the word 'local')
    return typeof p.id === 'string' && p.id !== 'local'
  })
})

const gridClass = computed(() => {
  // Count = local (1) + remote participants
  const remoteCount = remoteParticipants.value.length
  const totalCount = 1 + remoteCount // Always show local + remotes
  if (totalCount === 1) return 'grid-1'
  if (totalCount === 2) return 'grid-2'
  if (totalCount <= 4) return 'grid-4'
  if (totalCount <= 9) return 'grid-9'
  return 'grid-many'
})

// Make this a computed property for reactivity
const getStreamForParticipant = (participantId) => {
  // This is called from template, so ensure it's reactive
  // Access appState properties to ensure Vue tracks dependencies
  if (!appState.peerConnections || typeof appState.peerConnections !== 'object') {
    // Try window.appState as fallback
    const windowPc = window.appState?.peerConnections?.[participantId]
    return windowPc?.remoteStream || null
  }
  
  // Get stream from peer connection - check both Vue appState and window.appState
  const pc = appState.peerConnections[participantId] || window.appState?.peerConnections?.[participantId]
  if (!pc) return null
  
  // Try to get remote stream from peer connection
  // Check if it's an RTCPeerConnection with remote stream (getRemoteStreams() method)
  if (typeof pc.getRemoteStreams === 'function') {
    const remoteStreams = pc.getRemoteStreams()
    if (remoteStreams && remoteStreams.length > 0) {
      const stream = remoteStreams[0]
      // Ensure remoteStream property is also set for consistency
      if (!pc.remoteStream || pc.remoteStream !== stream) {
        pc.remoteStream = stream
      }
      return stream
    }
  }
  
  // Fallback: check if remoteStream property exists (stored by peer-track-received handler)
  if (pc.remoteStream) {
    return pc.remoteStream
  }
  
  // Also check window.appState in case Vue appState isn't synced yet
  const windowPc = window.appState?.peerConnections?.[participantId]
  if (windowPc?.remoteStream) {
    // Sync it to Vue appState
    if (!appState.peerConnections[participantId]) {
      appState.peerConnections = { ...appState.peerConnections, [participantId]: windowPc }
    }
    if (appState.peerConnections[participantId] && !appState.peerConnections[participantId].remoteStream) {
      appState.peerConnections[participantId].remoteStream = windowPc.remoteStream
    }
    return windowPc.remoteStream
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

