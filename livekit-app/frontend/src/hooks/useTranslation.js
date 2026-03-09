import { useState, useEffect, useCallback } from 'react';
import { useRoomContext, useLocalParticipant } from '@livekit/components-react';
import { DataPacket_Kind, RoomEvent } from 'livekit-client';
import toast from 'react-hot-toast';

export function useTranslation() {
  const room = useRoomContext();
  const localParticipant = useLocalParticipant();

  const [isEnabled, setIsEnabled] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [transcriptions, setTranscriptions] = useState([]);
  const [isAgentConnected, setIsAgentConnected] = useState(false);

  // Check if translation agent is in the room
  useEffect(() => {
    if (!room) return;

    const checkAgent = () => {
      if (!room.participants) {
        setIsAgentConnected(false);
        return;
      }

      const participants = Array.from(room.participants.values());
      const agent = participants.find(p =>
        p.identity.includes('translation-bot') ||
        p.identity.startsWith('agent-') ||
        p.metadata?.role === 'agent'
      );
      setIsAgentConnected(!!agent);
    };

    checkAgent();
    room.on(RoomEvent.ParticipantConnected, checkAgent);
    room.on(RoomEvent.ParticipantDisconnected, checkAgent);

    return () => {
      room.off(RoomEvent.ParticipantConnected, checkAgent);
      room.off(RoomEvent.ParticipantDisconnected, checkAgent);
    };
  }, [room]);

  // Send language preference update to agent
  const updateLanguagePreference = useCallback(async (enabled, language) => {
    if (!room || !localParticipant) return;

    try {
      const data = {
        type: 'language_preference',
        participant_id: localParticipant.sid,
        participant_name: localParticipant.identity,
        target_language: language,
        translation_enabled: enabled,
      };

      const encoder = new TextEncoder();
      const encodedData = encoder.encode(JSON.stringify(data));

      await localParticipant.publishData(
        encodedData,
        DataPacket_Kind.RELIABLE,
        { topic: 'language_preference' }
      );

      setIsEnabled(enabled);
      setTargetLanguage(language);

      if (enabled) {
        toast.success(`Translation enabled: ${language.toUpperCase()}`);
      } else {
        toast('Translation disabled');
      }
    } catch (error) {
      console.error('Error updating language preference:', error);
      toast.error('Failed to update translation settings');
    }
  }, [room, localParticipant]);

  const toggleTranslation = useCallback(() => {
    updateLanguagePreference(!isEnabled, targetLanguage);
  }, [isEnabled, targetLanguage, updateLanguagePreference]);

  const changeLanguage = useCallback((newLanguage) => {
    if (isEnabled) {
      updateLanguagePreference(true, newLanguage);
    } else {
      setTargetLanguage(newLanguage);
    }
  }, [isEnabled, updateLanguagePreference]);

  const clearTranscriptions = useCallback(() => {
    setTranscriptions([]);
  }, []);

  return {
    isEnabled,
    targetLanguage,
    transcriptions,
    isAgentConnected,

    toggleTranslation,
    changeLanguage,
    clearTranscriptions,
    updateLanguagePreference,
  };
}
