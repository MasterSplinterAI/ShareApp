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
        // Update Vue appState to trigger reactivity
        appState.localStream = window.appState.localStream
        // Also update camera state
        appState.isCameraOn = window.appState.isCameraOn || false
        
        // Force a reactive update by accessing tracks (triggers watchers)
        const videoTracks = window.appState.localStream.getVideoTracks()
        console.log(`Camera toggled: ${videoTracks.length} video tracks, enabled: ${videoTracks.some(t => t.enabled)}`)
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

