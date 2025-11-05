<template>
  <div id="app" class="app-container">
    <HomeScreen v-if="!isInMeeting" @join="handleJoin" @host="handleHost" />
    <MeetingScreen v-else />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useAppState } from './composables/useAppState.js'
import { useSocket } from './composables/useSocket.js'
import { useMedia } from './composables/useMedia.js'
import HomeScreen from './components/HomeScreen.vue'
import MeetingScreen from './components/MeetingScreen.vue'
import { generateRoomId, setRoomInUrl } from '../utils/url.js'

const { appState, isInMeeting } = useAppState()
const { joinRoom } = useSocket()
const { initMedia } = useMedia()

const handleJoin = async (data) => {
  try {
    // Initialize media first
    await initMedia()
    
    // Join room
    joinRoom(data.roomId, data.userName, data.accessCode)
  } catch (error) {
    console.error('Failed to join:', error)
    alert('Failed to join meeting: ' + error.message)
  }
}

const handleHost = async (data) => {
  try {
    // Generate room ID
    const roomId = generateRoomId()
    setRoomInUrl(roomId)
    
    // Initialize media
    await initMedia()
    
    // Join as host
    joinRoom(
      roomId,
      data.userName,
      null, // accessCode
      data.hostCode, // roomHostCode
      data.participantCode // roomAccessCode
    )
  } catch (error) {
    console.error('Failed to host:', error)
    alert('Failed to host meeting: ' + error.message)
  }
}
</script>

<style scoped>
.app-container {
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: #1a1a1a;
}
</style>

