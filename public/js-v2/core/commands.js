// Command handlers registration
import { commandDispatcher } from './CommandDispatcher.js';
import { logger } from './Logger.js';
import { trackManager } from '../webrtc/TrackManager.js';
import { connectionManager } from '../webrtc/ConnectionManager.js';
import { roomService } from '../services/RoomService.js';
import { signalingClient } from '../webrtc/SignalingClient.js';

/**
 * Register all commands
 */
export function registerCommands() {
  // Toggle camera
  commandDispatcher.register('toggleCamera', async () => {
    const isCameraOn = trackManager.hasActiveCamera();
    
    if (isCameraOn) {
      // Camera is on - disable it
      // Like the original code: just disable the track, don't remove it from connections
      await trackManager.disableCamera();
      
      // The track is still in the connection, just disabled
      // Peers will detect track.enabled = false and show placeholder
      // No need to remove/replace tracks - they stay in the connection
    } else {
      // Camera is off - enable it
      // Let enableCamera() handle both cases: re-enabling existing track or creating new one
      const cameraTrack = await trackManager.enableCamera();
      
      // Add track to peer connections
      // If track was re-enabled, replaceTrack will update it; if new, addTrack will add it
      if (cameraTrack) {
        const peers = Array.from(connectionManager.getAllConnections());
        for (const { peerId } of peers) {
          await connectionManager.addTrack(peerId, cameraTrack, 'camera');
        }
      }
    }
  });

  // Toggle microphone
  commandDispatcher.register('toggleMicrophone', async () => {
    const isMicOn = trackManager.hasActiveMicrophone();
    
    if (isMicOn) {
      await trackManager.disableMicrophone();
      
      // Remove audio track from all peer connections
      const peers = Array.from(connectionManager.getAllConnections());
      for (const { peerId } of peers) {
        await connectionManager.removeTrack(peerId, 'audio');
      }
    } else {
      const audioTrack = await trackManager.enableMicrophone();
      
      // Add audio track to all existing peer connections
      if (audioTrack) {
        const peers = Array.from(connectionManager.getAllConnections());
        for (const { peerId } of peers) {
          await connectionManager.addTrack(peerId, audioTrack, 'audio');
        }
      }
    }
  });

  // Start screen share
  commandDispatcher.register('startScreenShare', async () => {
    await trackManager.startScreenShare();
    
    // Add screen track to all peer connections
    const screenTrack = trackManager.getScreenTrack();
    if (screenTrack) {
      const peers = Array.from(connectionManager.getAllConnections());
      for (const { peerId } of peers) {
        await connectionManager.addTrack(peerId, screenTrack, 'screen');
      }
    }
  });

  // Stop screen share
  commandDispatcher.register('stopScreenShare', async () => {
    await trackManager.stopScreenShare();
    
    // Remove screen track from all peer connections
    const peers = Array.from(connectionManager.getAllConnections());
    for (const { peerId } of peers) {
      await connectionManager.removeTrack(peerId, 'screen');
    }
  });

  // Create room
  commandDispatcher.register('createRoom', async (payload) => {
    const { userName, options } = payload;
    return await roomService.createRoom(userName, options);
  });

  // Join room
  commandDispatcher.register('joinRoom', async (payload) => {
    const { roomId, userName, accessCode } = payload;
    return await roomService.joinRoom(roomId, userName, accessCode);
  });

  // Leave room
  commandDispatcher.register('leaveRoom', async () => {
    try {
      // Stop all tracks
      const { trackManager } = await import('../webrtc/TrackManager.js');
      if (trackManager.cameraTrack) {
        await trackManager.stopCamera();
      }
      if (trackManager.screenTrack) {
        await trackManager.stopScreenShare();
      }
      if (trackManager.audioTrack) {
        await trackManager.stopMicrophone();
      }
      
      // Close all connections
      connectionManager.closeAllConnections();
      
      // Leave room
      await roomService.leaveRoom();
      
      // Clear video grid
      const { videoGrid } = await import('../ui/VideoGrid.js');
      videoGrid.clear();
      
      // Clear local video
      const localVideo = document.getElementById('localVideo');
      if (localVideo) {
        localVideo.srcObject = null;
      }
      
      // Switch back to home page
      const homeDiv = document.getElementById('home');
      const meetingDiv = document.getElementById('meeting');
      if (homeDiv && meetingDiv) {
        homeDiv.classList.remove('hidden');
        meetingDiv.classList.add('hidden');
      }
      
      // Clear URL parameters
      const url = new URL(window.location);
      url.searchParams.delete('room');
      url.searchParams.delete('pin');
      window.history.replaceState({}, '', url);
      
      logger.info('Commands', 'Left room and returned to home');
    } catch (error) {
      logger.error('Commands', 'Error leaving room', { error });
      throw error;
    }
  });

  logger.info('Commands', 'All commands registered');
}

