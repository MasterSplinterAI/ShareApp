import { useEffect, useCallback } from 'react';
import { useRoomContext, useLocalParticipant } from '@livekit/components-react';
import { DataPacket_Kind, RoomEvent, Track } from 'livekit-client';

function RoomControls({ selectedLanguage, translationEnabled, participantName, isHost = false }) {
  const room = useRoomContext();
  const localParticipant = useLocalParticipant();

  const sendLanguagePreference = useCallback(async () => {
    if (!room || !localParticipant?.localParticipant) return;
    if (room.state !== 'connected') return;

    const lp = localParticipant.localParticipant;

    try {
      const data = {
        type: 'language_update',
        participantName: participantName,
        participantIdentity: lp?.identity,
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

  // Agent STT starts only after language_update AND a published mic track (see transcription_only_agent).
  // Mic often publishes after "connected"; resend when local audio publishes or unmutes.
  useEffect(() => {
    if (!room) return;
    const onLocalTrackPublished = (publication) => {
      if (publication?.kind === Track.Kind.Audio) {
        sendLanguagePreference();
      }
    };
    room.on(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
    return () => room.off(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
  }, [room, sendLanguagePreference]);

  useEffect(() => {
    if (!room) return;
    const onTrackUnmuted = (publication, participant) => {
      if (participant?.isLocal && publication?.kind === Track.Kind.Audio) {
        sendLanguagePreference();
      }
    };
    room.on(RoomEvent.TrackUnmuted, onTrackUnmuted);
    return () => room.off(RoomEvent.TrackUnmuted, onTrackUnmuted);
  }, [room, sendLanguagePreference]);

  // Staggered resync: aligns with agent agent_ready (~1.5s) and slow permission / track publish.
  useEffect(() => {
    if (!room || room.state !== 'connected') return;
    const t1 = setTimeout(() => sendLanguagePreference(), 1600);
    const t2 = setTimeout(() => sendLanguagePreference(), 3200);
    const t3 = setTimeout(() => sendLanguagePreference(), 6000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [room?.state, sendLanguagePreference]);

  // Resend when agent joins (agent may join after us, so it needs our language).
  // Covers identities like: agent-*, translation-cloud-prod, translation-bot, *-agent-*
  useEffect(() => {
    if (!room) return;

    const handleParticipantConnected = (participant) => {
      const identity = (participant?.identity || '').toLowerCase();
      const isAgent = (
        identity.startsWith('agent-') ||
        identity.includes('translation') ||
        identity.includes('-agent') ||
        identity.includes('agent_')
      );
      if (isAgent) {
        sendLanguagePreference();
      }
    };

    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    return () => room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
  }, [room, sendLanguagePreference]);

  // Resend when the agent broadcasts "agent_ready" — handles redeploy/restart mid-call
  // where ParticipantConnected already fired and participants won't rejoin.
  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (payload) => {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload));
        if (msg?.type === 'agent_ready') {
          console.log('[RoomControls] agent_ready received — re-syncing language preferences');
          sendLanguagePreference();
        }
      } catch {
        // ignore non-JSON packets
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);
    return () => room.off(RoomEvent.DataReceived, handleDataReceived);
  }, [room, sendLanguagePreference]);

  return null;
}

export default RoomControls;
