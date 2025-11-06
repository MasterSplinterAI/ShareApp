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
          
          // Handle local participant stream removal
          if (userId === 'local' && localParticipant) {
            if (localParticipant.screenStream?.id === streamId) {
              set({ 
                localParticipant: { 
                  ...localParticipant, 
                  screenStream: undefined 
                } 
              });
            }
          } else {
            // Handle remote participant stream removal
            const participant = participants.get(userId);
            if (participant) {
              if (participant.screenStream?.id === streamId) {
                participant.screenStream = undefined;
              } else {
                participant.stream = undefined;
              }
              set({ participants: new Map(participants) });
            }
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

      set({
        connectionManager: manager,
        isConnecting: false,
        isConnected: true,
      });
    } catch (error: any) {
      set({
        isConnecting: false,
        isConnected: false,
        error: error.message || 'Failed to connect',
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

    // Update local participant
    const { localParticipant } = get();
    if (localParticipant) {
      localParticipant.audioEnabled = newState;
      set({ localParticipant: { ...localParticipant } });
    }
  },

  // Toggle video
  toggleVideo: () => {
    const { connectionManager, isVideoEnabled } = get();
    if (!connectionManager) return;

    const newState = !isVideoEnabled;
    connectionManager.setVideoEnabled(newState);
    set({ isVideoEnabled: newState });

    // Update local participant
    const { localParticipant } = get();
    if (localParticipant) {
      localParticipant.videoEnabled = newState;
      set({ localParticipant: { ...localParticipant } });
    }
  },

  // Toggle screen share
  toggleScreenShare: async () => {
    const { connectionManager, isScreenSharing } = get();
    if (!connectionManager) return;

    try {
      if (isScreenSharing) {
        connectionManager.stopScreenShare();
        set({ isScreenSharing: false });
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
    const { participants } = get();
    
    if (id === 'local') {
      // Handle local participant
      const localParticipant = get().localParticipant || {
        id: 'local',
        audioEnabled: true,
        videoEnabled: true,
        connectionState: 'connected' as RTCPeerConnectionState,
      };
      
      if (isScreenShare) {
        localParticipant.screenStream = stream;
      } else {
        localParticipant.stream = stream;
      }
      
      set({ localParticipant });
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
    const { participants } = get();
    participants.delete(id);
    set({ participants: new Map(participants) });
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
