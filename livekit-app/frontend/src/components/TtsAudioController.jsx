import { useEffect, useRef } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, Track } from 'livekit-client';
import { normalizeMeetingLanguageCode } from '../lib/languages';

const DUCKED_VOLUME = 0.2;
const RESTORE_DURATION_MS = 180;
const RESTORE_STEPS = 6;
const TTS_EVENT_TOPICS = new Set(['transcription', 'tts', 'tts_events', 'voice_translation']);

function isAgentParticipant(participant) {
  const identity = (participant?.identity || '').toLowerCase();
  return (
    identity.startsWith('agent-') ||
    identity.includes('translation') ||
    identity.includes('-agent') ||
    identity.includes('agent_') ||
    participant?.metadata?.role === 'agent'
  );
}

function getPublicationName(publication) {
  return (publication?.trackName || publication?.name || publication?.track?.name || '').toLowerCase();
}

function isTtsPublication(publication) {
  return getPublicationName(publication).startsWith('tts-');
}

function getTrackVolume(track) {
  if (typeof track?.getVolume === 'function') {
    const current = track.getVolume();
    if (typeof current === 'number' && Number.isFinite(current)) {
      return current;
    }
  }
  return 1;
}

function findSpeakerParticipant(room, speakerId) {
  if (!room || !speakerId) return null;

  const byIdentity = room.remoteParticipants.get(speakerId);
  if (byIdentity) return byIdentity;

  for (const participant of room.remoteParticipants.values()) {
    if (
      participant?.identity === speakerId ||
      participant?.sid === speakerId ||
      participant?.name === speakerId
    ) {
      return participant;
    }
  }

  return null;
}

function getSpeakerMicTrack(participant) {
  if (!participant) return null;

  const micPublication = participant.getTrackPublication?.(Track.Source.Microphone);
  if (micPublication?.track) return micPublication.track;

  for (const publication of participant.trackPublications.values()) {
    if (publication?.source === Track.Source.Microphone && publication?.track) {
      return publication.track;
    }
  }

  return null;
}

export default function TtsAudioController({
  selectedLanguage,
  translationEnabled,
  voiceTranslationEnabled,
}) {
  const room = useRoomContext();
  const duckedTracksRef = useRef(new Map());
  const activeVoicePlayback = Boolean(translationEnabled && voiceTranslationEnabled);
  const normalizedLanguage = normalizeMeetingLanguageCode(selectedLanguage || 'en').toLowerCase();
  const targetTrackName = `tts-${normalizedLanguage}`;

  useEffect(() => {
    return () => {
      for (const entry of duckedTracksRef.current.values()) {
        if (entry?.restoreTimerIds) {
          entry.restoreTimerIds.forEach((id) => window.clearTimeout(id));
        }
        if (entry?.track && typeof entry.track.setVolume === 'function') {
          entry.track.setVolume(entry.originalVolume ?? 1);
        }
      }
      duckedTracksRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (activeVoicePlayback) return;

    for (const entry of duckedTracksRef.current.values()) {
      if (entry?.restoreTimerIds) {
        entry.restoreTimerIds.forEach((id) => window.clearTimeout(id));
      }
      if (entry?.track && typeof entry.track.setVolume === 'function') {
        entry.track.setVolume(entry.originalVolume ?? 1);
      }
    }
    duckedTracksRef.current.clear();
  }, [activeVoicePlayback]);

  useEffect(() => {
    if (!room) return;

    const reconcileSubscriptions = () => {
      for (const participant of room.remoteParticipants.values()) {
        const agentParticipant = isAgentParticipant(participant);

        for (const publication of participant.trackPublications.values()) {
          if (!isTtsPublication(publication)) continue;

          const publicationName = getPublicationName(publication);
          const shouldSubscribe =
            activeVoicePlayback &&
            agentParticipant &&
            publicationName === targetTrackName;

          if (publication.isSubscribed === shouldSubscribe) continue;

          try {
            publication.setSubscribed(shouldSubscribe);
          } catch (error) {
            console.warn('Failed to update TTS subscription', error);
          }
        }
      }
    };

    reconcileSubscriptions();

    room.on(RoomEvent.ParticipantConnected, reconcileSubscriptions);
    room.on(RoomEvent.ParticipantDisconnected, reconcileSubscriptions);
    room.on(RoomEvent.TrackPublished, reconcileSubscriptions);
    room.on(RoomEvent.TrackUnpublished, reconcileSubscriptions);

    return () => {
      room.off(RoomEvent.ParticipantConnected, reconcileSubscriptions);
      room.off(RoomEvent.ParticipantDisconnected, reconcileSubscriptions);
      room.off(RoomEvent.TrackPublished, reconcileSubscriptions);
      room.off(RoomEvent.TrackUnpublished, reconcileSubscriptions);
    };
  }, [room, activeVoicePlayback, targetTrackName]);

  useEffect(() => {
    if (!room) return;

    const duckSpeakerTrack = (speakerId) => {
      const speaker = findSpeakerParticipant(room, speakerId);
      const micTrack = getSpeakerMicTrack(speaker);
      if (!micTrack || typeof micTrack.setVolume !== 'function') return;

      const key = speaker?.identity || speakerId;
      const existing = duckedTracksRef.current.get(key);
      if (existing?.restoreTimerIds) {
        existing.restoreTimerIds.forEach((id) => window.clearTimeout(id));
      }

      if (existing?.track === micTrack) {
        micTrack.setVolume(DUCKED_VOLUME);
        duckedTracksRef.current.set(key, {
          ...existing,
          restoreTimerIds: [],
        });
        return;
      }

      duckedTracksRef.current.set(key, {
        track: micTrack,
        originalVolume: getTrackVolume(micTrack),
        restoreTimerIds: [],
      });
      micTrack.setVolume(DUCKED_VOLUME);
    };

    const restoreSpeakerTrack = (speakerId) => {
      const speaker = findSpeakerParticipant(room, speakerId);
      const key = speaker?.identity || speakerId;
      const ducked = duckedTracksRef.current.get(key);
      if (!ducked?.track || typeof ducked.track.setVolume !== 'function') return;

      if (ducked.restoreTimerIds) {
        ducked.restoreTimerIds.forEach((id) => window.clearTimeout(id));
      }

      const currentVolume = getTrackVolume(ducked.track);
      const targetVolume = ducked.originalVolume ?? 1;
      const stepMs = Math.round(RESTORE_DURATION_MS / RESTORE_STEPS);
      const delta = (targetVolume - currentVolume) / RESTORE_STEPS;
      const timerIds = [];

      for (let index = 1; index <= RESTORE_STEPS; index += 1) {
        const timerId = window.setTimeout(() => {
          ducked.track.setVolume(currentVolume + delta * index);
          if (index === RESTORE_STEPS) {
            duckedTracksRef.current.delete(key);
          }
        }, stepMs * index);
        timerIds.push(timerId);
      }

      duckedTracksRef.current.set(key, {
        ...ducked,
        restoreTimerIds: timerIds,
      });
    };

    const handleDataReceived = (payload, participant, kind, topic) => {
      if (!activeVoicePlayback) return;
      if (topic && !TTS_EVENT_TOPICS.has(topic)) return;
      if (participant && !isAgentParticipant(participant)) return;

      try {
        const raw = payload instanceof Uint8Array ? payload : payload?.data ?? payload;
        if (!raw) return;

        const message = JSON.parse(new TextDecoder().decode(raw));
        const eventType = message?.type;
        if (eventType !== 'tts_start' && eventType !== 'tts_end') return;

        const eventLanguage = message?.language
          ? normalizeMeetingLanguageCode(message.language).toLowerCase()
          : null;
        if (eventLanguage && eventLanguage !== normalizedLanguage) return;

        const speakerId =
          message?.speaker_id ||
          message?.speakerId ||
          message?.participant_identity ||
          message?.participantIdentity;

        if (!speakerId) return;

        if (eventType === 'tts_start') {
          duckSpeakerTrack(speakerId);
        } else {
          restoreSpeakerTrack(speakerId);
        }
      } catch {
        // Ignore non-JSON packets.
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);
    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room, activeVoicePlayback, normalizedLanguage]);

  return null;
}
