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
      // Always use window.appState.localStream as source of truth
      const sourceStream = window.appState?.localStream || appState.localStream
      if (!sourceStream) {
        console.error('No local stream available, cannot toggle camera')
        return
      }
      
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
        const streamReference = window.appState.localStream
        
        // Force reactivity: temporarily set to null then back (using setTimeout instead of nextTick for immediate effect)
        appState.localStream = null
        appState.isCameraOn = false
        
        // Immediately restore on next tick
        setTimeout(() => {
          appState.localStream = streamReference
          appState.isCameraOn = window.appState.isCameraOn || false
          console.log(`Camera toggled (forced reactivity): ${videoTracks.length} video tracks, enabled: ${hasVideo}`)
        }, 0)
      }
    } catch (error) {
      console.error('Failed to toggle camera:', error)
    }
  }

  const toggleMic = async () => {
    try {
      // Always use window.appState.localStream as source of truth
      const sourceStream = window.appState?.localStream || appState.localStream
      if (!sourceStream) {
        console.error('No local stream available, cannot toggle microphone')
        return
      }
      
      await toggleMicrophone()
      
      // Update Vue appState
      if (window.appState) {
        appState.isMicOn = window.appState.isMicOn || false
      }
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

