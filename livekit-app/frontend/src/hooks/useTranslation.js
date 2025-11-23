import { useState, useEffect, useCallback } from 'react';
import { useRoomContext, useLocalParticipant } from '@livekit/components-react';
import { DataPacket_Kind, RoomEvent } from 'livekit-client';
import toast from 'react-hot-toast';

/**
 * Custom hook for managing translation preferences and state
 */
export function useTranslation() {
  const room = useRoomContext();
  const localParticipant = useLocalParticipant();
  
  const [isEnabled, setIsEnabled] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [transcriptions, setTranscriptions] = useState([]);
  const [isAgentConnected, setIsAgentConnected] = useState(false);
  const [translationActivity, setTranslationActivity] = useState(new Map()); // Map of "speaker-targetLang" -> isActive

  // Check if translation agent is in the room
  useEffect(() => {
    if (!room) return;

    const checkAgent = () => {
      // Check if room.participants exists before accessing it
      if (!room.participants) {
        setIsAgentConnected(false);
        return;
      }
      
      const participants = Array.from(room.participants.values());
      const agent = participants.find(p => 
        p.identity.includes('translation-bot') || 
        p.metadata?.role === 'agent'
      );
      setIsAgentConnected(!!agent);
    };

    // Check on mount and participant changes
    checkAgent();
    room.on(RoomEvent.ParticipantConnected, checkAgent);
    room.on(RoomEvent.ParticipantDisconnected, checkAgent);

    return () => {
      room.off(RoomEvent.ParticipantConnected, checkAgent);
      room.off(RoomEvent.ParticipantDisconnected, checkAgent);
    };
  }, [room]);

  // Listen for transcription data
  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (payload, participant) => {
      try {
        const decoder = new TextDecoder();
        const message = JSON.parse(decoder.decode(payload));

        // Handle transcription messages
        if (message.type === 'transcription' && message.participantId === localParticipant.sid) {
          setTranscriptions(prev => [...prev, {
            id: Date.now(),
            speaker: message.speakerName || 'Unknown',
            speakerId: message.speakerId,
            text: message.originalText,
            translated: message.translatedText,
            timestamp: message.timestamp || Date.now(),
            language: message.language
          }]);
        }
      } catch (error) {
        console.error('Error parsing data message:', error);
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);

    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room, localParticipant]);

  // Listen for translation activity events
  useEffect(() => {
    if (!room) return;

    const handleData = (payload, participant, kind, topic) => {
      if (topic !== 'translation_activity') return;
      
      try {
        const decoder = new TextDecoder();
        const data = JSON.parse(decoder.decode(payload));
        
        if (data.type === 'translation_activity') {
          const key = `${data.source_speaker_id}-${data.target_language}`;
          setTranslationActivity(prev => {
            const next = new Map(prev);
            next.set(key, data.is_active);
            
            // Auto-clear after 3 seconds if still active (in case stop event is missed)
            if (data.is_active) {
              setTimeout(() => {
                setTranslationActivity(current => {
                  const updated = new Map(current);
                  if (updated.get(key) === true) {
                    updated.set(key, false);
                    return updated;
                  }
                  return current;
                });
              }, 3000);
            }
            
            return next;
          });
        }
      } catch (error) {
        console.error('Error parsing translation_activity:', error);
      }
    };

    room.on(RoomEvent.DataReceived, handleData);
    
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room]);

  // Helper to check if translation is active for current user's target language
  // OR if ANY translation is active (for showing indicators to all users)
  const isTranslationActive = useCallback(() => {
    if (!isEnabled || !localParticipant) {
      // Even if translation is disabled for this user, check if ANY translation is active
      // This allows showing indicators to all users when translation is happening
      for (const [key, isActive] of translationActivity.entries()) {
        if (isActive) {
          return true;
        }
      }
      return false;
    }
    
    // Check if any translation activity exists for our target language
    for (const [key, isActive] of translationActivity.entries()) {
      if (isActive && key.endsWith(`-${targetLanguage}`)) {
        return true;
      }
    }
    
    // Also check if ANY translation is active (for showing indicators to all users)
    for (const [key, isActive] of translationActivity.entries()) {
      if (isActive) {
        return true;
      }
    }
    return false;
  }, [translationActivity, targetLanguage, isEnabled, localParticipant]);

  // Send language preference update to agent
  const updateLanguagePreference = useCallback(async (enabled, language) => {
    if (!room || !localParticipant) return;

    try {
      const data = {
        type: 'language_preference',
        participant_id: localParticipant.sid,
        participant_name: localParticipant.identity,
        target_language: language,
        translation_enabled: enabled
      };

      const encoder = new TextEncoder();
      const encodedData = encoder.encode(JSON.stringify(data));

      // Send via data channel to all participants (agent will receive it)
      await localParticipant.publishData(
        encodedData,
        DataPacket_Kind.RELIABLE,
        { topic: 'language_preference' }
      );

      // Update local state
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

  // Toggle translation
  const toggleTranslation = useCallback(() => {
    updateLanguagePreference(!isEnabled, targetLanguage);
  }, [isEnabled, targetLanguage, updateLanguagePreference]);

  // Change target language
  const changeLanguage = useCallback((newLanguage) => {
    if (isEnabled) {
      updateLanguagePreference(true, newLanguage);
    } else {
      setTargetLanguage(newLanguage);
    }
  }, [isEnabled, updateLanguagePreference]);

  // Clear transcriptions
  const clearTranscriptions = useCallback(() => {
    setTranscriptions([]);
  }, []);

  return {
    // State
    isEnabled,
    targetLanguage,
    transcriptions,
    isAgentConnected,
    isTranslationActive,
    translationActivity,
    
    // Actions
    toggleTranslation,
    changeLanguage,
    clearTranscriptions,
    updateLanguagePreference,
  };
}
