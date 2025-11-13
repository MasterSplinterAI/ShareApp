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
      await trackManager.disableCamera();
      
      // Remove camera track from all peer connections
      const peers = Array.from(connectionManager.getAllConnections());
      for (const { peerId } of peers) {
        await connectionManager.removeTrack(peerId, 'camera');
      }
    } else {
      const cameraTrack = await trackManager.enableCamera();
      
      // Add camera track to all existing peer connections
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
    connectionManager.closeAllConnections();
    await roomService.leaveRoom();
  });

  logger.info('Commands', 'All commands registered');
}

