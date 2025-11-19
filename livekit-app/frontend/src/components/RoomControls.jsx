import { useEffect, useState } from 'react';
import { useRoomContext, useLocalParticipant } from '@livekit/components-react';
import { DataPacket_Kind } from 'livekit-client';
import { Settings } from 'lucide-react';

function RoomControls({ selectedLanguage, translationEnabled, participantName, isHost = false }) {
  const room = useRoomContext();
  const localParticipant = useLocalParticipant();
  const [vadSensitivity, setVadSensitivity] = useState('medium'); // 'low', 'medium', 'high'
  const [showVadControls, setShowVadControls] = useState(false);

  // Send language preference updates when they change
  // IMPORTANT: Always send updates (including when disabled) so backend can stop assistants
  useEffect(() => {
    if (!room || !localParticipant?.localParticipant) return;

    // Check if room is connected before sending data
    if (room.state !== 'connected') {
      console.log('Room not connected, skipping language preference send. State:', room.state);
      return;
    }

    const sendLanguagePreference = async () => {
      try {
        // Double-check connection state before sending
        if (room.state !== 'connected') {
          console.log('Room disconnected during send, aborting');
          return;
        }

        const data = {
          type: 'language_update', // Match what agent expects
          participantName: participantName,
          language: selectedLanguage, // Match what agent expects
          enabled: translationEnabled // Match what agent expects - CRITICAL: Send false when disabled!
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
        // Suppress "PC manager is closed" errors - they're harmless during disconnect
        if (error.message?.includes('PC manager is closed') || 
            error.message?.includes('closed peer connection')) {
          console.log('Room closing, skipping data send');
          return;
        }
        console.error('Error sending language preference:', error);
      }
    };

    // ALWAYS send preference updates - including when disabled (enabled: false)
    // This ensures backend stops assistants when translation is turned off
    sendLanguagePreference();
  }, [room, localParticipant, selectedLanguage, translationEnabled, participantName]);

  // Send VAD setting when host changes it
  const sendVadSetting = async (level) => {
    if (!isHost || !room || !localParticipant?.localParticipant) return;
    
    if (room.state !== 'connected') {
      console.log('Room not connected, skipping VAD setting send');
      return;
    }

    try {
      const data = {
        type: 'host_vad_setting',
        level: level, // 'low', 'medium', 'high'
      };

      const encoder = new TextEncoder();
      const encodedData = encoder.encode(JSON.stringify(data));

      await localParticipant.localParticipant.publishData(
        encodedData,
        DataPacket_Kind.RELIABLE,
        { topic: 'host-control' }
      );

      console.log('Sent VAD setting:', data);
      setVadSensitivity(level);
    } catch (error) {
      console.error('Error sending VAD setting:', error);
    }
  };

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

  // Expose VAD functions via window for MeetingRoom to access
  // This is a simple way to share functions between components
  useEffect(() => {
    if (isHost) {
      window.__roomControls = {
        vadSensitivity,
        setVadSensitivity,
        sendVadSetting,
      };
    }
    return () => {
      delete window.__roomControls;
    };
  }, [isHost, vadSensitivity, sendVadSetting]);

  return null; // This component doesn't render anything, just handles data
}

export default RoomControls;
