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

function isAudioPublication(publication) {
  return publication?.kind === Track.Kind.Audio || publication?.kind === 'audio';
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

function setTrackAudible(track, audible) {
  if (!track || typeof track.setVolume !== 'function') return;
  track.setVolume(audible ? 1 : 0);
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

/**
 * Each listener must only hear tts-{theirLanguage}. The agent publishes one track
 * per language for everyone with voice on; LiveKit auto-subscribes, so without
 * hard unsubscribe+mute both participants hear every translator track (especially
 * after language switches).
 */
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
        if (!isAgentParticipant(participant)) continue;

        for (const publication of participant.trackPublications.values()) {
          if (!isAudioPublication(publication) && !isTtsPublication(publication)) continue;
          if (!isTtsPublication(publication)) continue;

          const publicationName = getPublicationName(publication);
          const shouldHear =
            activeVoicePlayback && publicationName === targetTrackName;

          try {
            // Always drive subscription explicitly (don't trust auto-subscribe).
            if (publication.isSubscribed !== shouldHear) {
              publication.setSubscribed(shouldHear);
            }
          } catch (error) {
            console.warn('Failed to update TTS subscription', error);
          }

          // Belt-and-suspenders: mute non-target tracks even if still subscribed
          // (race after language switch, or setSubscribed lag).
          setTrackAudible(publication.track, shouldHear);
        }
      }
    };

    reconcileSubscriptions();

    room.on(RoomEvent.ParticipantConnected, reconcileSubscriptions);
    room.on(RoomEvent.ParticipantDisconnected, reconcileSubscriptions);
    room.on(RoomEvent.TrackPublished, reconcileSubscriptions);
    room.on(RoomEvent.TrackUnpublished, reconcileSubscriptions);
    room.on(RoomEvent.TrackSubscribed, reconcileSubscriptions);
    room.on(RoomEvent.TrackUnsubscribed, reconcileSubscriptions);

    // Language switches can leave a brief window where the old track is still
    // playing; re-reconcile shortly after target changes.
    const retryId = window.setTimeout(reconcileSubscriptions, 250);
    const retryId2 = window.setTimeout(reconcileSubscriptions, 1000);

    return () => {
      window.clearTimeout(retryId);
      window.clearTimeout(retryId2);
      room.off(RoomEvent.ParticipantConnected, reconcileSubscriptions);
      room.off(RoomEvent.ParticipantDisconnected, reconcileSubscriptions);
      room.off(RoomEvent.TrackPublished, reconcileSubscriptions);
      room.off(RoomEvent.TrackUnpublished, reconcileSubscriptions);
      room.off(RoomEvent.TrackSubscribed, reconcileSubscriptions);
      room.off(RoomEvent.TrackUnsubscribed, reconcileSubscriptions);
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
