// Vue Reactive State Management
import { reactive, computed, watch } from 'vue'

// Global reactive state - syncs with window.appState for WebRTC compatibility
export const appState = reactive({
  localStream: null,
  screenStream: null,
  peerConnections: {},
  roomId: null,
  isHost: false,
  pinnedParticipant: 'local',
  participants: {},
  isCameraOn: false,
  isMicOn: true,
  isScreenSharing: false,
  userName: null,
  deviceSettings: {
    selectedCamera: null,
    selectedMic: null,
    selectedSpeaker: null,
  },
  networkSettings: {
    lowBandwidthMode: false,
  },
})

// Sync Vue appState with window.appState (for WebRTC compatibility)
if (typeof window !== 'undefined') {
  // Initialize window.appState if it doesn't exist
  if (!window.appState) {
    window.appState = {}
  }
  
  // Sync Vue state to window.appState (for existing WebRTC code)
  watch(() => appState.localStream, (val) => { window.appState.localStream = val }, { deep: true })
  watch(() => appState.screenStream, (val) => { window.appState.screenStream = val }, { deep: true })
  watch(() => appState.peerConnections, (val) => { window.appState.peerConnections = val }, { deep: true })
  watch(() => appState.roomId, (val) => { window.appState.roomId = val })
  watch(() => appState.isHost, (val) => { window.appState.isHost = val })
  watch(() => appState.pinnedParticipant, (val) => { window.appState.pinnedParticipant = val })
  watch(() => appState.participants, (val) => { window.appState.participants = val }, { deep: true })
  watch(() => appState.isCameraOn, (val) => { window.appState.isCameraOn = val })
  watch(() => appState.isMicOn, (val) => { window.appState.isMicOn = val })
  watch(() => appState.isScreenSharing, (val) => { window.appState.isScreenSharing = val })
  watch(() => appState.userName, (val) => { window.appState.userName = val })
  watch(() => appState.deviceSettings, (val) => { window.appState.deviceSettings = val }, { deep: true })
  watch(() => appState.networkSettings, (val) => { window.appState.networkSettings = val }, { deep: true })
  
  // Sync window.appState to Vue appState (in case external code updates it)
  // But don't sync roomId automatically - let Vue control that
  const syncInterval = setInterval(() => {
    if (window.appState) {
      if (window.appState.localStream !== appState.localStream) appState.localStream = window.appState.localStream
      if (window.appState.screenStream !== appState.screenStream) appState.screenStream = window.appState.screenStream
      if (window.appState.peerConnections !== appState.peerConnections) appState.peerConnections = window.appState.peerConnections
      // Don't auto-sync roomId - Vue controls joining
      // if (window.appState.roomId !== appState.roomId) appState.roomId = window.appState.roomId
      if (window.appState.isHost !== appState.isHost) appState.isHost = window.appState.isHost
      if (window.appState.pinnedParticipant !== appState.pinnedParticipant) appState.pinnedParticipant = window.appState.pinnedParticipant
      if (window.appState.participants !== appState.participants) appState.participants = window.appState.participants
      if (window.appState.isCameraOn !== appState.isCameraOn) appState.isCameraOn = window.appState.isCameraOn
      if (window.appState.isMicOn !== appState.isMicOn) appState.isMicOn = window.appState.isMicOn
      if (window.appState.isScreenSharing !== appState.isScreenSharing) appState.isScreenSharing = window.appState.isScreenSharing
      if (window.appState.userName !== appState.userName) appState.userName = window.appState.userName
    }
  }, 100)
  
  // Cleanup on page unload
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      clearInterval(syncInterval)
    })
  }
}

// Computed properties
export function useAppState() {
  const isInMeeting = computed(() => appState.roomId !== null)
  const participantCount = computed(() => {
    if (!appState.participants || typeof appState.participants !== 'object') {
      return 0
    }
    return Object.keys(appState.participants).length
  })
  const hasLocalVideo = computed(() => {
    return appState.localStream && appState.localStream.getVideoTracks().length > 0
  })
  const hasLocalAudio = computed(() => {
    return appState.localStream && appState.localStream.getAudioTracks().length > 0
  })

  return {
    appState,
    isInMeeting,
    participantCount,
    hasLocalVideo,
    hasLocalAudio,
  }
}

