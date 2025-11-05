<template>
  <div class="controls-bar">
    <div class="controls-left">
      <button
        @click="toggleMic"
        class="control-btn"
        :class="{ active: appState.isMicOn, danger: !appState.isMicOn }"
        :title="appState.isMicOn ? 'Mute' : 'Unmute'"
      >
        <i :class="appState.isMicOn ? 'fas fa-microphone' : 'fas fa-microphone-slash'"></i>
      </button>
      
      <button
        @click="toggleCam"
        class="control-btn"
        :class="{ active: appState.isCameraOn, danger: !appState.isCameraOn }"
        :title="appState.isCameraOn ? 'Turn off camera' : 'Turn on camera'"
      >
        <i :class="appState.isCameraOn ? 'fas fa-video' : 'fas fa-video-slash'"></i>
      </button>
      
      <button
        v-if="!appState.isScreenSharing"
        @click="startScreenShare"
        class="control-btn"
        title="Share screen"
      >
        <i class="fas fa-desktop"></i>
      </button>
      
      <button
        v-else
        @click="stopScreenShare"
        class="control-btn danger"
        title="Stop sharing"
      >
        <i class="fas fa-stop"></i>
      </button>
    </div>
    
    <div class="controls-center">
      <div class="meeting-info">
        <span class="room-id">{{ appState.roomId }}</span>
        <span v-if="appState.isHost" class="host-label">Host</span>
      </div>
    </div>
    
    <div class="controls-right">
      <button
        @click="leaveRoom"
        class="control-btn danger leave-btn"
        title="Leave meeting"
      >
        <i class="fas fa-phone-slash"></i>
        <span>Leave</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { useAppState } from '../composables/useAppState.js'
import { useSocket } from '../composables/useSocket.js'
import { useMedia } from '../composables/useMedia.js'

const { appState } = useAppState()
const { leaveRoom: leave } = useSocket()
const { toggleCam, toggleMic, startScreenShare, stopScreenShare } = useMedia()

const leaveRoom = () => {
  if (confirm('Leave the meeting?')) {
    leave()
  }
}
</script>

<style scoped>
.controls-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 2rem;
  background: #2a2a2a;
  border-top: 1px solid #3a3a3a;
  gap: 1rem;
}

.controls-left,
.controls-right {
  display: flex;
  gap: 0.5rem;
}

.controls-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.meeting-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #888;
  font-size: 0.875rem;
}

.room-id {
  font-family: monospace;
}

.host-label {
  background: #4a6cf7;
  color: white;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
}

.control-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: #3a3a3a;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  transition: all 0.2s;
}

.control-btn:hover {
  background: #4a4a4a;
  transform: scale(1.05);
}

.control-btn.active {
  background: #4a6cf7;
}

.control-btn.danger {
  background: #dc2626;
}

.control-btn.danger:hover {
  background: #b91c1c;
}

.leave-btn {
  background: #dc2626;
  width: auto;
  padding: 0 1.5rem;
  border-radius: 24px;
  gap: 0.5rem;
}

.leave-btn span {
  font-size: 1rem;
  font-weight: 500;
}

@media (max-width: 768px) {
  .controls-bar {
    padding: 0.75rem 1rem;
    flex-wrap: wrap;
  }
  
  .controls-center {
    order: -1;
    width: 100%;
    margin-bottom: 0.5rem;
  }
  
  .control-btn {
    width: 44px;
    height: 44px;
    font-size: 1rem;
  }
  
  .leave-btn {
    padding: 0 1rem;
  }
  
  .leave-btn span {
    font-size: 0.875rem;
  }
}
</style>

