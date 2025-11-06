// Vue Composable for Media Management
import { appState } from './useAppState.js'
import { initializeMedia, toggleCamera, toggleMicrophone, startScreenSharing, stopScreenSharing } from '../../services/media.js'
import { startAudioLevelMonitoring, stopAudioLevelMonitoring } from '../../utils/audioLevel.js'

export function useMedia() {
  const initMedia = async (constraints = null, allowViewOnly = true) => {
    try {
      const stream = await initializeMedia(constraints, allowViewOnly)
      appState.localStream = stream
      
      // Start audio level monitoring for local stream
      if (stream && stream.getAudioTracks().length > 0) {
        startAudioLevelMonitoring('local', stream)
      }
      
      return stream
    } catch (error) {
      console.error('Failed to initialize media:', error)
      throw error
    }
  }

  const toggleCam = async () => {
    try {
      await toggleCamera()
      // Force Vue reactivity - window.appState.localStream reference might not change,
      // but tracks within it do, so we need to trigger reactivity manually
      if (window.appState && window.appState.localStream) {
        // CRITICAL: Force reactivity by creating a new stream reference or updating nested state
        // Vue won't detect changes to MediaStream tracks automatically
        const videoTracks = window.appState.localStream.getVideoTracks()
        const hasVideo = videoTracks.length > 0 && videoTracks.some(t => t && t.enabled)
        
        // Update appState - if it's the same stream object, we still need to trigger reactivity
        const currentStream = appState.localStream
        appState.localStream = window.appState.localStream
        
        // Force reactivity: if same object, temporarily set to null then back
        if (currentStream === window.appState.localStream) {
          appState.localStream = null
          // Use nextTick to ensure Vue processes the null assignment
          import('vue').then(({ nextTick }) => {
            nextTick(() => {
              appState.localStream = window.appState.localStream
              appState.isCameraOn = window.appState.isCameraOn || false
              console.log(`Camera toggled (forced reactivity): ${videoTracks.length} video tracks, enabled: ${hasVideo}`)
            })
          })
        } else {
          appState.isCameraOn = window.appState.isCameraOn || false
          console.log(`Camera toggled: ${videoTracks.length} video tracks, enabled: ${hasVideo}`)
        }
      }
    } catch (error) {
      console.error('Failed to toggle camera:', error)
    }
  }

  const toggleMic = async () => {
    try {
      await toggleMicrophone()
    } catch (error) {
      console.error('Failed to toggle microphone:', error)
    }
  }

  const startScreenShare = async () => {
    try {
      await startScreenSharing()
    } catch (error) {
      console.error('Failed to start screen sharing:', error)
    }
  }

  const stopScreenShare = async () => {
    try {
      await stopScreenSharing()
    } catch (error) {
      console.error('Failed to stop screen sharing:', error)
    }
  }

  return {
    initMedia,
    toggleCam,
    toggleMic,
    startScreenShare,
    stopScreenShare,
  }
}

