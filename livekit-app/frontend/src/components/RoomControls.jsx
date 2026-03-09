import { useEffect } from 'react';
import { useRoomContext, useLocalParticipant } from '@livekit/components-react';
import { DataPacket_Kind } from 'livekit-client';

function RoomControls({ selectedLanguage, translationEnabled, participantName, isHost = false }) {
  const room = useRoomContext();
  const localParticipant = useLocalParticipant();

  // Send language preference updates when they change
  useEffect(() => {
    if (!room || !localParticipant?.localParticipant) return;
    if (room.state !== 'connected') return;

    const sendLanguagePreference = async () => {
      try {
        if (room.state !== 'connected') return;

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
    };

    sendLanguagePreference();
  }, [room, localParticipant, selectedLanguage, translationEnabled, participantName]);

  return null;
}

export default RoomControls;
