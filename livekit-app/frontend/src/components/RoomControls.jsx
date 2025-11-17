import { useEffect } from 'react';
import { useRoomContext, useLocalParticipant } from '@livekit/components-react';
import { DataPacket_Kind } from 'livekit-client';

function RoomControls({ selectedLanguage, translationEnabled, participantName }) {
  const room = useRoomContext();
  const localParticipant = useLocalParticipant();

  // Send language preference updates when they change
  useEffect(() => {
    if (!room || !localParticipant?.localParticipant) return;

    const sendLanguagePreference = async () => {
      try {
        const data = {
          type: 'language_update', // Match what agent expects
          participantName: participantName,
          language: selectedLanguage, // Match what agent expects
          enabled: translationEnabled // Match what agent expects
        };

        const encoder = new TextEncoder();
        const encodedData = encoder.encode(JSON.stringify(data));

        // Send via data channel
        await localParticipant.localParticipant.publishData(
          encodedData,
          DataPacket_Kind.RELIABLE,
          { topic: 'language_preference' }
        );

        console.log('Sent language preference:', data);
      } catch (error) {
        console.error('Error sending language preference:', error);
      }
    };

    // Send preference when translation is enabled or language changes
    if (translationEnabled) {
      sendLanguagePreference();
    }
  }, [room, localParticipant, selectedLanguage, translationEnabled, participantName]);

  // Listen for transcriptions and other data
  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (payload, participant) => {
      try {
        const decoder = new TextDecoder();
        const message = JSON.parse(decoder.decode(payload));

        if (message.type === 'transcription') {
          console.log('Received transcription:', message);
          // Handle transcription display here or dispatch to parent
        }
      } catch (error) {
        console.error('Error parsing data message:', error);
      }
    };

    room.on('dataReceived', handleDataReceived);

    return () => {
      room.off('dataReceived', handleDataReceived);
    };
  }, [room]);

  return null; // This component doesn't render anything, just handles data
}

export default RoomControls;
