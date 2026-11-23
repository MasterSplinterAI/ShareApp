import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { RoomEvent } from 'livekit-client';
import toast from 'react-hot-toast';
import { v2Meetings } from '../services/apiV2';

const EMPTY_STATE = Object.freeze({
  isRecording: false,
  isUploading: false,
  startedAt: null,
  elapsedSeconds: 0,
  recordingBy: null,
  canRecord: false,
  toggleRecording: null,
  stopAndUploadRecording: null,
});

const roomStoreMap = new WeakMap();

function getRoomStore(room) {
  if (!room) return null;
  let entry = roomStoreMap.get(room);
  if (!entry) {
    entry = {
      state: { ...EMPTY_STATE },
      listeners: new Set(),
    };
    roomStoreMap.set(room, entry);
  }
  return entry;
}

function updateRoomStore(room, patch) {
  const entry = getRoomStore(room);
  if (!entry) return;
  entry.state = { ...entry.state, ...patch };
  entry.listeners.forEach((fn) => fn());
}

export function useRoomRecordingState(room) {
  return useSyncExternalStore(
    useCallback(
      (onStoreChange) => {
        const entry = getRoomStore(room);
        if (!entry) return () => {};
        entry.listeners.add(onStoreChange);
        return () => entry.listeners.delete(onStoreChange);
      },
      [room]
    ),
    () => getRoomStore(room)?.state || EMPTY_STATE,
    () => EMPTY_STATE
  );
}

export function formatRecordingClock(totalSeconds) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function isAgentParticipant(participant) {
  if (!participant) return false;
  if (participant.isAgent) return true;
  return /^agent[-_]/i.test(String(participant.identity || ''));
}

function pickSupportedRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) || '';
}

export function useRoomAudioRecorder({ room, meetingId, isHost = false }) {
  const audioCtxRef = useRef(null);
  const destRef = useRef(null);
  const keepaliveOscRef = useRef(null);
  const sourcesRef = useRef(new Map());
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(null);
  const timerRef = useRef(null);
  const isRecordingRef = useRef(false);
  const stopPromiseRef = useRef(null);

  const publishRecordingState = useCallback(
    async (recording, startedAt = null) => {
      if (!room?.localParticipant) return;
      try {
        const payload = JSON.stringify({
          type: 'room_recording_state',
          recording: Boolean(recording),
          startedAt: startedAt || undefined,
          by: room.localParticipant.name || 'Host',
        });
        await room.localParticipant.publishData(new TextEncoder().encode(payload), {
          reliable: true,
        });
      } catch {
        /* non-fatal if room already disconnecting */
      }
    },
    [room]
  );

  const syncAudioTracks = useCallback(() => {
    const ctx = audioCtxRef.current;
    const dest = destRef.current;
    if (!ctx || !dest || !room) return;

    const desiredTracks = new Map();

    const collectParticipantTracks = (participant) => {
      if (!participant || isAgentParticipant(participant)) return;
      const pubs = participant.audioTrackPublications
        ? Array.from(participant.audioTrackPublications.values())
        : [];
      for (const pub of pubs) {
        const mst = pub?.track?.mediaStreamTrack;
        if (mst && mst.readyState !== 'ended') {
          desiredTracks.set(mst.id, mst);
        }
      }
    };

    if (room.localParticipant) collectParticipantTracks(room.localParticipant);
    if (room.remoteParticipants) {
      for (const remote of room.remoteParticipants.values()) {
        collectParticipantTracks(remote);
      }
    }

    for (const [trackId, bound] of Array.from(sourcesRef.current.entries())) {
      if (!desiredTracks.has(trackId)) {
        try {
          bound.source.disconnect();
        } catch {
          /* ignore */
        }
        sourcesRef.current.delete(trackId);
      }
    }

    for (const [trackId, mst] of desiredTracks.entries()) {
      if (sourcesRef.current.has(trackId)) continue;
      try {
        const source = ctx.createMediaStreamSource(new MediaStream([mst]));
        source.connect(dest);
        sourcesRef.current.set(trackId, { source, mst });
      } catch {
        /* ignore ended/unsupported tracks */
      }
    }
  }, [room]);

  const cleanupGraph = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    for (const bound of sourcesRef.current.values()) {
      try {
        bound.source.disconnect();
      } catch {
        /* ignore */
      }
    }
    sourcesRef.current.clear();

    if (keepaliveOscRef.current) {
      try {
        keepaliveOscRef.current.stop();
        keepaliveOscRef.current.disconnect();
      } catch {
        /* ignore */
      }
      keepaliveOscRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {
        /* ignore */
      }
      audioCtxRef.current = null;
    }
    destRef.current = null;
    recorderRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    if (!room || !meetingId || !isHost || isRecordingRef.current) return;
    if (typeof MediaRecorder === 'undefined') {
      toast.error('Audio recording is not supported in this browser');
      return;
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        toast.error('Web Audio API is not supported in this browser');
        return;
      }
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') await ctx.resume();
      const dest = ctx.createMediaStreamDestination();

      const osc = ctx.createOscillator();
      const silenceGain = ctx.createGain();
      silenceGain.gain.value = 0;
      osc.connect(silenceGain);
      silenceGain.connect(dest);
      osc.start();

      audioCtxRef.current = ctx;
      destRef.current = dest;
      keepaliveOscRef.current = osc;
      chunksRef.current = [];

      syncAudioTracks();

      const mimeType = pickSupportedRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(dest.stream, { mimeType })
        : new MediaRecorder(dest.stream);

      recorder.ondataavailable = (evt) => {
        if (evt?.data && evt.data.size > 0) {
          chunksRef.current.push(evt.data);
        }
      };

      const startedAt = Date.now();
      startedAtRef.current = startedAt;
      isRecordingRef.current = true;
      recorderRef.current = recorder;

      recorder.start(1000);
      timerRef.current = setInterval(() => {
        if (!startedAtRef.current) return;
        updateRoomStore(room, {
          elapsedSeconds: Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000)),
        });
      }, 1000);

      updateRoomStore(room, {
        isRecording: true,
        startedAt,
        elapsedSeconds: 0,
        recordingBy: room.localParticipant?.name || 'Host',
      });

      await publishRecordingState(true, startedAt);
      toast.success('Recording started — MP3 & AI cleanup will save when stopped');
    } catch (err) {
      cleanupGraph();
      isRecordingRef.current = false;
      updateRoomStore(room, { isRecording: false, startedAt: null, elapsedSeconds: 0 });
      toast.error(err?.message || 'Failed to start room recording');
    }
  }, [room, meetingId, isHost, syncAudioTracks, publishRecordingState, cleanupGraph]);

  const stopAndUploadRecording = useCallback(async () => {
    if (stopPromiseRef.current) return stopPromiseRef.current;
    if (!isRecordingRef.current || !recorderRef.current) {
      return { ok: true, skipped: true };
    }

    const work = (async () => {
      const recorder = recorderRef.current;
      const elapsedSec = startedAtRef.current
        ? Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000))
        : null;

      isRecordingRef.current = false;
      updateRoomStore(room, {
        isRecording: false,
        isUploading: true,
        recordingBy: null,
      });
      await publishRecordingState(false, null);

      const finalBlob = await new Promise((resolve) => {
        const done = () => {
          const mime = recorder.mimeType || 'audio/webm';
          resolve(new Blob(chunksRef.current, { type: mime }));
        };
        if (recorder.state === 'inactive') {
          done();
          return;
        }
        recorder.addEventListener('stop', done, { once: true });
        try {
          recorder.stop();
        } catch {
          done();
        }
      });

      cleanupGraph();
      chunksRef.current = [];
      startedAtRef.current = null;

      if (!finalBlob || finalBlob.size < 256 || !meetingId) {
        updateRoomStore(room, { isUploading: false, elapsedSeconds: 0, startedAt: null });
        return { ok: true, skipped: true };
      }

      try {
        const res = await v2Meetings.uploadRecording(meetingId, finalBlob, {
          durationSeconds: elapsedSec,
          autoRefine: true,
        });
        const refined = res?.transcriptRefinement;
        if (refined?.ok && (refined.updatedCount > 0 || refined.insertedCount > 0)) {
          const count = refined.updatedCount || refined.insertedCount;
          toast.success(
            refined.mode === 'cleaned'
              ? `MP3 saved & ${count} transcript line${count === 1 ? '' : 's'} cleaned up`
              : `MP3 saved & ${count} transcript line${count === 1 ? '' : 's'} transcribed`
          );
        } else {
          toast.success('Call recording saved as MP3 to meeting notes');
        }
        return res;
      } catch (err) {
        toast.error(err?.response?.data?.error || 'Failed to upload call recording');
        return { ok: false, error: err?.message };
      } finally {
        updateRoomStore(room, { isUploading: false, elapsedSeconds: 0, startedAt: null });
      }
    })();

    stopPromiseRef.current = work;
    try {
      return await work;
    } finally {
      stopPromiseRef.current = null;
    }
  }, [room, meetingId, publishRecordingState, cleanupGraph]);

  const toggleRecording = useCallback(() => {
    if (isRecordingRef.current) {
      return stopAndUploadRecording();
    }
    return startRecording();
  }, [startRecording, stopAndUploadRecording]);

  useEffect(() => {
    if (!room) return undefined;
    updateRoomStore(room, {
      canRecord: Boolean(isHost && meetingId),
      toggleRecording,
      stopAndUploadRecording,
    });
    return () => {
      updateRoomStore(room, {
        canRecord: false,
        toggleRecording: null,
        stopAndUploadRecording: null,
      });
    };
  }, [room, isHost, meetingId, toggleRecording, stopAndUploadRecording]);

  useEffect(() => {
    if (!room) return undefined;

    const handleTrackChange = () => {
      if (isRecordingRef.current) {
        syncAudioTracks();
      }
    };

    const handleParticipantConnected = () => {
      if (isRecordingRef.current && isHost) {
        publishRecordingState(true, startedAtRef.current);
      }
    };

    const handleData = (payload) => {
      try {
        const decoded = JSON.parse(new TextDecoder().decode(payload));
        if (decoded?.type !== 'room_recording_state') return;
        updateRoomStore(room, {
          isRecording: Boolean(decoded.recording),
          startedAt: decoded.recording ? decoded.startedAt || Date.now() : null,
          recordingBy: decoded.recording ? decoded.by || 'Host' : null,
        });
      } catch {
        /* ignore unrelated data packets */
      }
    };

    room.on(RoomEvent.TrackSubscribed, handleTrackChange);
    room.on(RoomEvent.TrackUnsubscribed, handleTrackChange);
    room.on(RoomEvent.LocalTrackPublished, handleTrackChange);
    room.on(RoomEvent.LocalTrackUnpublished, handleTrackChange);
    room.on(RoomEvent.TrackMuted, handleTrackChange);
    room.on(RoomEvent.TrackUnmuted, handleTrackChange);
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.DataReceived, handleData);

    return () => {
      room.off(RoomEvent.TrackSubscribed, handleTrackChange);
      room.off(RoomEvent.TrackUnsubscribed, handleTrackChange);
      room.off(RoomEvent.LocalTrackPublished, handleTrackChange);
      room.off(RoomEvent.LocalTrackUnpublished, handleTrackChange);
      room.off(RoomEvent.TrackMuted, handleTrackChange);
      room.off(RoomEvent.TrackUnmuted, handleTrackChange);
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room, isHost, syncAudioTracks, publishRecordingState]);

  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!isRecordingRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      cleanupGraph();
    };
  }, [cleanupGraph]);

  return useRoomRecordingState(room);
}
