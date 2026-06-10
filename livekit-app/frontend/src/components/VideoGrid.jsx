import { useState, useEffect, useRef, useCallback } from 'react';
import { useTracks, useParticipants, useLocalParticipant, VideoTrack, ParticipantContext } from '@livekit/components-react';
import { Track, RoomEvent, VideoQuality, ConnectionQuality } from 'livekit-client';
import { Maximize, Minimize, User, MicOff, VideoOff } from 'lucide-react';
import { useRoomContext } from '@livekit/components-react';
import { useMeeting } from '../context/MeetingContext';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

function VideoGrid() {
  const participants = useParticipants();
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const { isFullScreen, setIsFullScreen, meetingId } = useMeeting();
  const fullScreenRef = useRef(null);
  const isMobile = useIsMobile();
  const [activeSpeakerIdentity, setActiveSpeakerIdentity] = useState(null);

  const tracks = useTracks(
    [Track.Source.Camera, Track.Source.ScreenShare, Track.Source.Microphone],
    { onlySubscribed: false }
  );

  const humanParticipants = participants.filter(p => {
    const identity = p.identity || '';
    return !identity.startsWith('agent-') &&
           !identity.includes('translation-bot') &&
           p.metadata?.role !== 'agent';
  });

  const screenShareTracks = tracks.filter(t => t.source === Track.Source.ScreenShare);
  const activeScreenShare = screenShareTracks.length > 0 ? screenShareTracks[0] : null;

  // Track active speaker for mobile prominence layout
  useEffect(() => {
    if (!room) return;
    const handleSpeakers = (speakers) => {
      const human = speakers.find(s =>
        !s.identity?.startsWith('agent-') && !s.identity?.includes('translation-bot')
      );
      if (human) setActiveSpeakerIdentity(human.identity);
    };
    room.on(RoomEvent.ActiveSpeakersChanged, handleSpeakers);
    return () => room.off(RoomEvent.ActiveSpeakersChanged, handleSpeakers);
  }, [room]);

  const toggleFullScreen = useCallback(async () => {
    if (!fullScreenRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await fullScreenRef.current.requestFullscreen();
        setIsFullScreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullScreen(false);
      }
    } catch (err) {
      console.error('Fullscreen error:', err);
    }
  }, [setIsFullScreen]);

  useEffect(() => {
    const handleFullScreenChange = () => {
      setIsFullScreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullScreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullScreenChange);
  }, [setIsFullScreen]);

  const getGridClass = (count) => {
    if (count <= 1) return 'grid-cols-1';
    if (count <= 2) return 'grid-cols-1 sm:grid-cols-2';
    if (count <= 4) return 'grid-cols-2';
    if (count <= 6) return 'grid-cols-2 sm:grid-cols-3';
    return 'grid-cols-3 sm:grid-cols-4';
  };

  // Screen share layout
  if (activeScreenShare) {
    return (
      <div ref={fullScreenRef} className="flex h-full w-full flex-col meeting-video-matte">
        <div className="flex-1 min-h-0 relative">
          <VideoTrackRenderer
            track={activeScreenShare}
            className="w-full h-full object-contain bg-black"
          />
          <ScreenShareQualityChip trackRef={activeScreenShare} meetingId={meetingId} />
          <button
            onClick={toggleFullScreen}
            className="absolute top-3 right-3 p-2 bg-black/60 hover:bg-black/80 text-white rounded-lg transition-all z-10"
            title={isFullScreen ? 'Exit full screen' : 'Full screen'}
          >
            {isFullScreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </button>
        </div>
        {!isFullScreen && (
          <div className="h-20 sm:h-36 flex gap-1.5 sm:gap-2 p-1.5 sm:p-2 overflow-x-auto meeting-filmstrip border-t border-border">
            {humanParticipants.map(participant => (
              <ParticipantTile
                key={participant.identity}
                participant={participant}
                tracks={tracks}
                compact
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Mobile: active speaker layout for 3+ participants
  if (isMobile && humanParticipants.length >= 3) {
    const speaker = humanParticipants.find(p => p.identity === activeSpeakerIdentity)
      || humanParticipants.find(p => p.identity !== localParticipant?.identity)
      || humanParticipants[0];
    const others = humanParticipants.filter(p => p.identity !== speaker.identity);

    return (
      <div ref={fullScreenRef} className="flex h-full w-full flex-col gap-1.5 meeting-video-matte p-1.5">
        <div className="flex-1 min-h-0">
          <ParticipantTile
            participant={speaker}
            tracks={tracks}
          />
        </div>
        <div className="h-20 flex gap-1.5 overflow-x-auto flex-shrink-0">
          {others.map(participant => (
            <ParticipantTile
              key={participant.identity}
              participant={participant}
              tracks={tracks}
              compact
            />
          ))}
        </div>
      </div>
    );
  }

  // Normal grid layout
  return (
    <div ref={fullScreenRef} className="h-full w-full overflow-hidden meeting-video-matte p-1.5 sm:p-3">
      <div className={`grid ${getGridClass(humanParticipants.length)} gap-1.5 sm:gap-3 h-full auto-rows-fr`}>
        {humanParticipants.map(participant => (
          <ParticipantTile
            key={participant.identity}
            participant={participant}
            tracks={tracks}
          />
        ))}
      </div>
    </div>
  );
}

function ParticipantTile({ participant, tracks, compact = false }) {
  const { localParticipant, cameraTrack: localCameraPub, microphoneTrack: localMicPub, isCameraEnabled: localCameraEnabled } = useLocalParticipant();
  const isLocal = participant.identity === localParticipant?.identity;

  // For local participant: use useLocalParticipant's cameraTrack directly (useTracks can lag)
  // For remote: find in tracks from useTracks
  const cameraTrackRef = isLocal && localCameraPub
    ? { participant: localParticipant, publication: localCameraPub, source: Track.Source.Camera }
    : tracks.find(
        t => t.participant?.identity === participant.identity && t.source === Track.Source.Camera
      );

  const micPub = participant.getTrackPublication?.(Track.Source.Microphone) ?? (isLocal ? localMicPub : tracks.find(t => t.participant?.identity === participant.identity && t.source === Track.Source.Microphone)?.publication);
  const camPub = cameraTrackRef?.publication ?? participant.getTrackPublication?.(Track.Source.Camera);

  const hasVideo = !!(cameraTrackRef?.publication?.track);
  const isMicMuted = micPub?.isMuted ?? true;
  // Camera: local uses isCameraEnabled; remote uses hasVideo (no track = off)
  const isCameraOff = isLocal ? !localCameraEnabled : !hasVideo;
  const isSpeaking = participant.isSpeaking;

  const displayName = participant.name || participant.identity || 'Unknown';

  return (
    <div
      className={`relative min-h-0 overflow-hidden rounded-lg border meeting-participant-tile ${
        compact ? 'w-24 sm:w-44 flex-shrink-0 aspect-video' : 'w-full h-full'
      } ${isSpeaking ? 'ring-2 ring-emerald-500' : ''}`}
    >
      {hasVideo ? (
        <ParticipantContext.Provider value={participant}>
          <VideoTrack
            trackRef={cameraTrackRef}
            muted={isLocal}
            playsInline
            className={`w-full h-full min-h-0 object-cover ${isLocal ? '-scale-x-100' : ''}`}
          />
        </ParticipantContext.Provider>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-muted">
          <div
            className={`flex items-center justify-center rounded-full bg-muted-foreground/15 ${
            compact ? 'w-10 h-10' : 'w-14 h-14 sm:w-20 sm:h-20'
          }`}>
            <User className={`text-muted-foreground ${compact ? 'h-5 w-5' : 'h-7 w-7 sm:h-10 sm:w-10'}`} />
          </div>
        </div>
      )}

      {/* Name label */}
      <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent ${compact ? 'px-1.5 py-1' : 'px-3 py-2'}`}>
        <span className={`text-white font-medium truncate block ${compact ? 'text-[10px]' : 'text-xs sm:text-sm'}`} data-no-translate="true">
          {displayName}
          {isLocal && ' (You)'}
        </span>
      </div>

      {/* Mic/camera status indicators -- hidden on compact to save space */}
      {!compact && (
        <div className="absolute top-1.5 sm:top-2 left-1.5 sm:left-2 flex items-center gap-1">
          {isMicMuted && (
            <span className="p-0.5 sm:p-1 rounded bg-red-500/80" title="Microphone off">
              <MicOff className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-white" />
            </span>
          )}
          {isCameraOff && (
            <span className="p-0.5 sm:p-1 rounded bg-red-500/80" title="Camera off">
              <VideoOff className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-white" />
            </span>
          )}
        </div>
      )}

      {/* Top-right: speaking indicator + connection quality */}
      <div className={`absolute flex items-center gap-1 ${compact ? 'top-1 right-1' : 'top-1.5 sm:top-2 right-1.5 sm:right-2'}`}>
        {isSpeaking && (
          <div className={`bg-green-400 rounded-full animate-pulse ${compact ? 'w-2 h-2' : 'w-3 h-3'}`} />
        )}
        {!compact && (
          <ConnectionQualityBadge
            participant={participant}
            cameraPub={camPub}
            isLocal={isLocal}
          />
        )}
      </div>
    </div>
  );
}

const QUALITY_META = {
  [ConnectionQuality.Excellent]: { bars: 3, color: 'bg-emerald-400', label: 'Excellent' },
  [ConnectionQuality.Good]: { bars: 2, color: 'bg-amber-400', label: 'Good' },
  [ConnectionQuality.Poor]: { bars: 1, color: 'bg-red-500', label: 'Poor' },
  [ConnectionQuality.Lost]: { bars: 0, color: 'bg-red-500', label: 'Lost' },
};

/**
 * Jitsi-style per-tile signal bars. Hover (or tap) shows live resolution,
 * FPS, and bitrate from WebRTC sender/receiver stats.
 */
function ConnectionQualityBadge({ participant, cameraPub, isLocal }) {
  const [quality, setQuality] = useState(participant.connectionQuality);
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState(null);
  const prevBytesRef = useRef(null);

  useEffect(() => {
    const onChange = (q) => setQuality(q);
    participant.on('connectionQualityChanged', onChange);
    setQuality(participant.connectionQuality);
    return () => {
      participant.off('connectionQualityChanged', onChange);
    };
  }, [participant]);

  // Poll WebRTC stats only while the tooltip is open
  useEffect(() => {
    if (!open) {
      prevBytesRef.current = null;
      return undefined;
    }
    let cancelled = false;

    const poll = async () => {
      try {
        const track = cameraPub?.track;
        if (!track) {
          if (!cancelled) setStats(null);
          return;
        }
        let raw = null;
        if (isLocal && typeof track.getSenderStats === 'function') {
          const layers = (await track.getSenderStats()) || [];
          // Highest simulcast layer for resolution/FPS; total bytes across layers
          const best = layers.reduce(
            (a, b) => (!a || (b.frameHeight || 0) > (a.frameHeight || 0) ? b : a),
            null
          );
          if (best) {
            raw = {
              fps: best.framesPerSecond,
              w: best.frameWidth,
              h: best.frameHeight,
              bytes: layers.reduce((sum, l) => sum + (l.bytesSent || 0), 0),
            };
          }
        } else if (typeof track.getReceiverStats === 'function') {
          const r = await track.getReceiverStats();
          if (r) {
            raw = {
              fps: r.framesPerSecond,
              w: r.frameWidth,
              h: r.frameHeight,
              bytes: r.bytesReceived || 0,
            };
          }
        }
        if (cancelled) return;
        if (!raw) {
          setStats(null);
          return;
        }
        const now = performance.now();
        let kbps = null;
        const prev = prevBytesRef.current;
        if (prev && raw.bytes >= prev.bytes) {
          const dt = (now - prev.t) / 1000;
          if (dt > 0.3) kbps = Math.round(((raw.bytes - prev.bytes) * 8) / dt / 1000);
        }
        prevBytesRef.current = { bytes: raw.bytes, t: now };
        setStats({
          fps: raw.fps ? Math.round(raw.fps) : null,
          w: raw.w,
          h: raw.h,
          kbps,
        });
      } catch {
        /* stats not available on this browser/track — tooltip shows quality only */
      }
    };

    poll();
    const id = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open, cameraPub, isLocal]);

  const meta = QUALITY_META[quality] || { bars: 3, color: 'bg-white/50', label: 'Unknown' };

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Connection: ${meta.label}`}
        className="flex h-5 items-end gap-[2px] rounded bg-black/40 px-1 py-0.5"
      >
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={`w-[3px] rounded-sm ${i <= meta.bars ? meta.color : 'bg-white/30'}`}
            style={{ height: `${i * 4 + 2}px` }}
          />
        ))}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 whitespace-nowrap rounded-md bg-black/85 px-2.5 py-1.5 text-[10px] leading-4 text-white shadow-lg">
          <div className="font-semibold">Connection: {meta.label}</div>
          <div>Resolution: {stats?.w && stats?.h ? `${stats.w}×${stats.h}` : '—'}</div>
          <div>FPS: {stats?.fps ?? '—'}</div>
          <div>
            Bitrate: {stats?.kbps != null ? `${stats.kbps} kbps` : '—'}
            {stats?.kbps != null ? (isLocal ? ' ↑' : ' ↓') : ''}
          </div>
        </div>
      )}
    </div>
  );
}

function ScreenShareQualityChip({ trackRef, meetingId }) {
  const [label, setLabel] = useState(null);
  const prevQualityRef = useRef(null);

  useEffect(() => {
    const pub = trackRef?.publication;
    if (!pub) return;

    const update = () => {
      // videoQuality: VideoQuality.HIGH=2 (1080p), MEDIUM=1 (720p), LOW=0 (360p), OFF=-1
      const q = pub.videoQuality ?? -1;
      const layerLabel = q === VideoQuality.HIGH ? '1080p' : q === VideoQuality.MEDIUM ? '720p' : q === VideoQuality.LOW ? '360p' : null;
      setLabel(layerLabel);

      // Detect 1080p → 720p downgrade
      if (prevQualityRef.current === VideoQuality.HIGH && q === VideoQuality.MEDIUM) {
        fetch('/api/quality-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            meeting_id: meetingId || 'unknown',
            participant_identity: trackRef.participant?.identity || null,
            from_layer: '1080p',
            to_layer: '720p',
          }),
        }).catch(() => {});
      }
      prevQualityRef.current = q;
    };

    update();
    const id = setInterval(update, 2000);
    return () => clearInterval(id);
  }, [trackRef?.publication, meetingId]);

  if (!label) return null;
  return (
    <div className="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">
      {label}
    </div>
  );
}

function VideoTrackRenderer({ track, className = '' }) {
  const videoRef = useRef(null);
  const mediaTrack = track?.publication?.track;

  useEffect(() => {
    if (!videoRef.current || !mediaTrack) return;

    mediaTrack.attach(videoRef.current);

    return () => {
      mediaTrack.detach(videoRef.current);
    };
  }, [mediaTrack]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      className={className}
    />
  );
}

export default VideoGrid;
