import { useEffect, useCallback } from 'react';
import { useRoomContext, useLocalParticipant } from '@livekit/components-react';
import { DataPacket_Kind, RoomEvent } from 'livekit-client';

function RoomControls({ selectedLanguage, translationEnabled, participantName, isHost = false }) {
  const room = useRoomContext();
  const localParticipant = useLocalParticipant();

  const sendLanguagePreference = useCallback(async () => {
    if (!room || !localParticipant?.localParticipant) return;
    if (room.state !== 'connected') return;

    try {
      const data = {
        type: 'language_update',
        participantName: participantName,
        language: selectedLanguage,
        enabled: translationEnabled,
      };

      const encoder = new TextEncoder();
      const encodedData = encoder.encode(JSON.stringify(data));

      await localParticipant.localParticipant.publishData(
        encodedData,
        DataPacket_Kind.RELIABLE,
        { topic: 'language_preference' }
      );
    } catch (error) {
      if (error.message?.includes('PC manager is closed') ||
          error.message?.includes('closed peer connection')) {
        return;
      }
      console.error('Error sending language preference:', error);
    }
  }, [room, localParticipant, selectedLanguage, translationEnabled, participantName]);

  // Send when language/prefs change
  useEffect(() => {
    sendLanguagePreference();
  }, [sendLanguagePreference]);

  // Delayed resend after connect — beats race where agent runs update_assistants before our language packet is applied
  useEffect(() => {
    if (!room || room.state !== 'connected') return;
    const id = setTimeout(() => {
      sendLanguagePreference();
    }, 800);
    return () => clearTimeout(id);
  }, [room?.state, sendLanguagePreference]);

  // Resend when agent joins (agent may join after us, so it needs our language)
  useEffect(() => {
    if (!room) return;

    const handleParticipantConnected = (participant) => {
      const identity = participant?.identity || '';
      const isAgent = identity.startsWith('agent-') || identity.includes('translation-bot');
      if (isAgent) {
        sendLanguagePreference();
      }
    };

    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    return () => room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
  }, [room, sendLanguagePreference]);

  return null;
}

export default RoomControls;
