// Zustand store for conference state management

import { create } from 'zustand';
import { ConnectionManager } from '../webrtc/connection-manager';

export interface Participant {
  id: string;
  stream?: MediaStream;
  screenStream?: MediaStream;
  audioEnabled: boolean;
  videoEnabled: boolean;
  connectionState: RTCPeerConnectionState;
}

interface ConferenceState {
  // Room info
  roomId: string | null;
  isHost: boolean;
  
  // Participants
  participants: Map<string, Participant>;
  localParticipant: Participant | null;
  
  // Media states
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  
  // Connection
  connectionManager: ConnectionManager | null;
  isConnecting: boolean;
  isConnected: boolean;
  error: string | null;
  
  // Actions
  initialize: (roomId: string, pin: string, isHost: boolean) => Promise<void>;
  toggleAudio: () => void;
  toggleVideo: () => void;
  toggleScreenShare: () => Promise<void>;
  switchCamera: () => Promise<void>;
  disconnect: () => void;
  
  // Internal actions
  addParticipant: (id: string, stream?: MediaStream, isScreenShare?: boolean) => void;
  removeParticipant: (id: string) => void;
  updateParticipantMedia: (id: string, audio: boolean, video: boolean) => void;
  updateParticipantConnection: (id: string, state: RTCPeerConnectionState) => void;
}

export const useConferenceStore = create<ConferenceState>((set, get) => ({
  // Initial state
  roomId: null,
  isHost: false,
  participants: new Map(),
  localParticipant: null,
  isAudioEnabled: true,
  isVideoEnabled: true,
  isScreenSharing: false,
  connectionManager: null,
  isConnecting: false,
  isConnected: false,
  error: null,

  // Initialize conference
  initialize: async (roomId: string, pin: string, isHost: boolean) => {
    const { connectionManager } = get();
    
    if (connectionManager) {
      console.warn('Conference already initialized');
      return;
    }

    console.log('Initializing conference for room:', roomId, 'isHost:', isHost);
    set({ isConnecting: true, error: null, roomId, isHost });

    try {
      const manager = new ConnectionManager({
        onStreamAdded: (stream, userId, isScreenShare) => {
          get().addParticipant(userId, stream, isScreenShare);
        },
        onStreamRemoved: (streamId, userId) => {
          const { participants, localParticipant } = get();
          
          console.log(`[Store] onStreamRemoved: streamId=${streamId}, userId=${userId}`);
          
          // Handle local participant stream removal
          if (userId === 'local' && localParticipant) {
            if (localParticipant.screenStream?.id === streamId) {
              console.log(`[Store] Removing local screen share stream: ${streamId}`);
              set({ 
                localParticipant: { 
                  ...localParticipant, 
                  screenStream: undefined 
                } 
              });
              // Also update the store's screen sharing state
              set({ isScreenSharing: false });
            } else if (localParticipant.stream?.id === streamId) {
              console.log(`[Store] WARNING: Attempted to remove local video stream, preserving it`);
              // Don't remove the local video stream - it should always be present
            }
          } else {
            // Handle remote participant stream removal
            const participant = participants.get(userId);
            if (participant) {
              if (participant.screenStream?.id === streamId) {
                console.log(`[Store] Removing remote screen share for ${userId}`);
                participant.screenStream = undefined;
              } else if (participant.stream?.id === streamId) {
                console.log(`[Store] Removing remote video stream for ${userId}`);
                participant.stream = undefined;
              }
              set({ participants: new Map(participants) });
            }
          }
        },
        onParticipantRemoved: (userId) => {
          // When a participant leaves, remove them completely from the store
          // This is safer than trying to remove individual streams
          console.log(`[Store] Removing participant ${userId} from store`);
          const { localParticipant } = get();
          // Ensure we're not accidentally removing the local participant
          if (userId === 'local') {
            console.warn(`[Store] Attempted to remove local participant, ignoring`);
            return;
          }
          get().removeParticipant(userId);
          // Verify local participant is still intact after removal
          const { localParticipant: afterLocal } = get();
          if (!afterLocal || !afterLocal.stream) {
            console.error(`[Store] ERROR: Local participant stream was cleared!`);
          } else {
            console.log(`[Store] Local participant stream intact after removal`);
          }
        },
        onPeerStateChange: (userId, state) => {
          get().updateParticipantConnection(userId, state);
        },
        onMediaStateChange: (userId, audio, video) => {
          get().updateParticipantMedia(userId, audio, video);
        },
      });

      await manager.initialize(roomId, pin);

      console.log('ConferenceStore: Initialization successful');
      set({
        connectionManager: manager,
        isConnecting: false,
        isConnected: true,
      });
    } catch (error: any) {
      console.error('ConferenceStore: Initialization failed:', error);
      set({
        isConnecting: false,
        isConnected: false,
        error: error.message || 'Failed to connect to conference',
      });
    }
  },

  // Toggle audio
  toggleAudio: () => {
    const { connectionManager, isAudioEnabled } = get();
    if (!connectionManager) return;

    const newState = !isAudioEnabled;
    connectionManager.setAudioEnabled(newState);
    set({ isAudioEnabled: newState });

    // Update local participant - preserve stream reference
    const { localParticipant } = get();
    if (localParticipant) {
      set({ 
        localParticipant: { 
          ...localParticipant,
          audioEnabled: newState,
          stream: localParticipant.stream, // Explicitly preserve stream reference
          screenStream: localParticipant.screenStream, // Preserve screenStream too
        } 
      });
    }
  },

  // Toggle video
  toggleVideo: () => {
    const { connectionManager, isVideoEnabled } = get();
    if (!connectionManager) return;

    const newState = !isVideoEnabled;
    connectionManager.setVideoEnabled(newState);
    set({ isVideoEnabled: newState });

    // Update local participant - preserve stream reference
    const { localParticipant } = get();
    if (localParticipant) {
      set({ 
        localParticipant: { 
          ...localParticipant,
          videoEnabled: newState,
          stream: localParticipant.stream, // Explicitly preserve stream reference
          screenStream: localParticipant.screenStream, // Preserve screenStream too
        } 
      });
    }
  },

  // Toggle screen share
  toggleScreenShare: async () => {
    const { connectionManager, isScreenSharing } = get();
    if (!connectionManager) return;

    try {
      if (isScreenSharing) {
        console.log('[Store] Stopping screen share');
        connectionManager.stopScreenShare();
        // The onStreamRemoved handler will update isScreenSharing, but set it here too for immediate feedback
        set({ isScreenSharing: false });
        // Also explicitly clear the screenStream from localParticipant
        const { localParticipant } = get();
        if (localParticipant?.screenStream) {
          set({
            localParticipant: {
              ...localParticipant,
              screenStream: undefined
            }
          });
        }
      } else {
        await connectionManager.startScreenShare();
        set({ isScreenSharing: true });
      }
    } catch (error) {
      console.error('Failed to toggle screen share:', error);
    }
  },

  // Switch camera
  switchCamera: async () => {
    const { connectionManager } = get();
    if (!connectionManager) return;

    try {
      await connectionManager.switchCamera();
    } catch (error) {
      console.error('Failed to switch camera:', error);
    }
  },

  // Disconnect
  disconnect: () => {
    const { connectionManager } = get();
    if (connectionManager) {
      connectionManager.disconnect();
    }

    set({
      roomId: null,
      isHost: false,
      participants: new Map(),
      localParticipant: null,
      isAudioEnabled: true,
      isVideoEnabled: true,
      isScreenSharing: false,
      connectionManager: null,
      isConnecting: false,
      isConnected: false,
      error: null,
    });
  },

  // Add participant
  addParticipant: (id: string, stream?: MediaStream, isScreenShare: boolean = false) => {
    const { participants, localParticipant } = get();
    
    if (id === 'local') {
      // Handle local participant - preserve existing stream if updating
      const currentLocal = localParticipant || {
        id: 'local',
        audioEnabled: true,
        videoEnabled: true,
        connectionState: 'connected' as RTCPeerConnectionState,
      };
      
      // Create new object but preserve stream references
      const updatedLocal: Participant = {
        ...currentLocal,
      };
      
      if (isScreenShare) {
        updatedLocal.screenStream = stream;
      } else {
        // IMPORTANT: Only update the stream if we have a new one
        // This prevents clearing the stream on re-renders
        if (stream) {
          updatedLocal.stream = stream;
          console.log(`[Store] Setting local stream:`, stream.id, 'tracks:', stream.getTracks().length);
        } else {
          // Preserve existing stream if no new stream provided
          updatedLocal.stream = currentLocal.stream;
        }
      }
      
      set({ localParticipant: updatedLocal });
    } else {
      // Handle remote participant
      let participant = participants.get(id);
      
      if (!participant) {
        participant = {
          id,
          audioEnabled: true,
          videoEnabled: true,
          connectionState: 'connecting',
        };
      }
      
      if (isScreenShare) {
        participant.screenStream = stream;
      } else {
        participant.stream = stream;
      }
      
      participants.set(id, participant);
      set({ participants: new Map(participants) });
    }
  },

  // Remove participant
  removeParticipant: (id: string) => {
    console.log(`[Store] removeParticipant called for ${id}`);
    const { participants, localParticipant } = get();
    
    // Safety check: never remove local participant
    if (id === 'local') {
      console.warn(`[Store] Attempted to remove local participant, ignoring`);
      return;
    }
    
    // Create a completely new Map without the removed participant
    // This ensures React detects the change
    const newParticipants = new Map<string, Participant>();
    participants.forEach((participant, participantId) => {
      if (participantId !== id) {
        newParticipants.set(participantId, participant);
      }
    });
    
    console.log(`[Store] Participant ${id} removed. Remaining participants: ${newParticipants.size}`);
    console.log(`[Store] Local participant exists: ${!!localParticipant}, has stream: ${!!localParticipant?.stream}`);
    
    // CRITICAL: Only update participants Map, DO NOT touch localParticipant
    // This prevents React from re-rendering the local video tile unnecessarily
    // The localParticipant object reference stays the same, so React won't remount VideoTile
    set({ 
      participants: newParticipants
      // DO NOT include localParticipant here - let it remain unchanged
    });
    
    // Verify local participant is still intact after set
    const { localParticipant: verifyLocal } = get();
    if (!verifyLocal || !verifyLocal.stream) {
      console.error(`[Store] CRITICAL: Local participant stream was lost after removal!`);
    } else {
      console.log(`[Store] Local participant preserved: has stream=${!!verifyLocal.stream}, has screenStream=${!!verifyLocal.screenStream}`);
    }
  },

  // Update participant media state
  updateParticipantMedia: (id: string, audio: boolean, video: boolean) => {
    const { participants } = get();
    const participant = participants.get(id);
    
    if (participant) {
      participant.audioEnabled = audio;
      participant.videoEnabled = video;
      set({ participants: new Map(participants) });
    }
  },

  // Update participant connection state
  updateParticipantConnection: (id: string, state: RTCPeerConnectionState) => {
    const { participants } = get();
    const participant = participants.get(id);
    
    if (participant) {
      participant.connectionState = state;
      set({ participants: new Map(participants) });
    }
  },
}));
