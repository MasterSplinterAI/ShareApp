import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTracks, useParticipants, useLocalParticipant, VideoTrack, ParticipantContext } from '@livekit/components-react';
import { Track, RoomEvent, VideoQuality, ConnectionQuality } from 'livekit-client';
import { Maximize, Minimize, User, MicOff, VideoOff, ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { useRoomContext } from '@livekit/components-react';
import { useMeeting } from '../context/MeetingContext';
import { participantDisplayName } from '../lib/participantDisplayName';

const DESKTOP_PAGE_SIZE = 12;

function useViewportLayout() {
  const [layout, setLayout] = useState({ isMobile: false, isLandscape: false });
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setLayout({
        isMobile: w < 640 || (h < 500 && w < 960),
        isLandscape: w > h && h < 540,
      });
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);
  return layout;
}

function isAgentParticipant(p) {
  if (!p) return false;
  if (p.isAgent) return true;
  const identity = String(p.identity || '').toLowerCase();
  return (
    identity.startsWith('agent-') ||
    identity.startsWith('agent_') ||
    identity.includes('translation') ||
    identity.includes('-agent') ||
    p.metadata?.role === 'agent'
  );
}

function VideoGrid() {
  const participants = useParticipants();
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const { isFullScreen, setIsFullScreen, meetingId } = useMeeting();
  const fullScreenRef = useRef(null);
  const { isMobile, isLandscape } = useViewportLayout();
  const [activeSpeakerIdentity, setActiveSpeakerIdentity] = useState(null);
  const [pinnedIdentity, setPinnedIdentity] = useState(null);
  const [stageWide, setStageWide] = useState(true);
  const [pageIndex, setPageIndex] = useState(0);
  const [filmstripVisible, setFilmstripVisible] = useState(true);
  const speakerOrderRef = useRef([]);

  useEffect(() => {
    const el = fullScreenRef.current;
    if (!el) return undefined;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setStageWide(rect.width >= rect.height * 1.1);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tracks = useTracks(
    [Track.Source.Camera, Track.Source.ScreenShare, Track.Source.Microphone],
    { onlySubscribed: false }
  );

  const humanParticipants = participants.filter((p) => !isAgentParticipant(p));

  const screenShareTracks = tracks.filter(t => t.source === Track.Source.ScreenShare);
  const activeScreenShare = screenShareTracks.length > 0 ? screenShareTracks[0] : null;

  // Track active speaker for mobile prominence + large-call page 1 priority
  useEffect(() => {
    if (!room) return;
    const handleSpeakers = (speakers) => {
      const human = speakers.find((s) => !isAgentParticipant(s));
      if (human?.identity) {
        setActiveSpeakerIdentity(human.identity);
        speakerOrderRef.current = [
          human.identity,
          ...speakerOrderRef.current.filter((id) => id !== human.identity),
        ].slice(0, 50);
      }
    };
    room.on(RoomEvent.ActiveSpeakersChanged, handleSpeakers);
    return () => room.off(RoomEvent.ActiveSpeakersChanged, handleSpeakers);
  }, [room]);

  // Prioritize local participant + recent active speakers when paginating 13+ calls
  // or ordering the screen-share filmstrip.
  const orderedParticipants = useMemo(() => {
    if (humanParticipants.length <= DESKTOP_PAGE_SIZE && !activeScreenShare) {
      return humanParticipants;
    }
    const localId = localParticipant?.identity;
    const recentOrder = speakerOrderRef.current;
    return [...humanParticipants].sort((a, b) => {
      if (a.identity === pinnedIdentity) return -1;
      if (b.identity === pinnedIdentity) return 1;
      if (a.identity === activeSpeakerIdentity) return -1;
      if (b.identity === activeSpeakerIdentity) return 1;
      if (a.identity === localId) return -1;
      if (b.identity === localId) return 1;
      const ai = recentOrder.indexOf(a.identity);
      const bi = recentOrder.indexOf(b.identity);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return 0;
    });
  }, [humanParticipants, activeScreenShare, localParticipant?.identity, pinnedIdentity, activeSpeakerIdentity]);

  const totalPages = Math.max(1, Math.ceil(orderedParticipants.length / DESKTOP_PAGE_SIZE));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);

  useEffect(() => {
    if (pageIndex >= totalPages) {
      setPageIndex(Math.max(0, totalPages - 1));
    }
  }, [pageIndex, totalPages]);

  const toggleFullScreen = useCallback(async () => {
    const targetEl =
      fullScreenRef.current?.closest?.('.meeting-room-root') || fullScreenRef.current;
    if (!targetEl) return;
    try {
      if (!document.fullscreenElement) {
        await targetEl.requestFullscreen();
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
    if (count <= 1) return 'grid-cols-1 grid-rows-1';
    if (count === 2) {
      return stageWide || isLandscape ? 'grid-cols-2 grid-rows-1' : 'grid-cols-1 grid-rows-2';
    }
    if (count === 3 || count === 4) return 'grid-cols-2 grid-rows-2';
    if (count === 5) return 'grid-cols-6 grid-rows-2';
    if (count === 6) return 'grid-cols-3 grid-rows-2';
    if (count === 7 || count === 8) return 'grid-cols-6 grid-rows-3';
    if (count === 9) return 'grid-cols-3 grid-rows-3';
    return 'grid-cols-12 grid-rows-3';
  };

  const getTileSpanClass = (count, index) => {
    if (count === 3 && index === 2) return 'col-span-2';
    if (count === 5) return index < 3 ? 'col-span-2' : 'col-span-3';
    if (count === 7) return index < 6 ? 'col-span-2' : 'col-span-6';
    if (count === 8) return index < 6 ? 'col-span-2' : 'col-span-3';
    if (count === 10) return index < 8 ? 'col-span-3' : 'col-span-6';
    if (count === 11) return index < 8 ? 'col-span-3' : 'col-span-4';
    if (count >= 12) return 'col-span-3';
    return '';
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
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
            {!isFullScreen && orderedParticipants.length > 0 && (
              <button
                type="button"
                onClick={() => setFilmstripVisible((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-black/60 px-2.5 py-2 text-xs font-medium text-white transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90"
                aria-label={filmstripVisible ? 'Hide participant thumbnails' : 'Show participant thumbnails'}
                title={filmstripVisible ? 'Hide participant thumbnails' : 'Show participant thumbnails'}
              >
                {filmstripVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                <span className="hidden sm:inline">
                  {filmstripVisible ? 'Hide strip' : `Show strip (${orderedParticipants.length})`}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={toggleFullScreen}
              className="rounded-lg bg-black/60 p-2 text-white transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90"
              aria-label={isFullScreen ? 'Exit full screen' : 'Enter full screen'}
              title={isFullScreen ? 'Exit full screen' : 'Full screen'}
            >
              {isFullScreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
        {!isFullScreen && filmstripVisible && (
          <div className="h-20 sm:h-32 flex gap-1.5 sm:gap-2 p-1.5 sm:p-2 overflow-x-auto meeting-filmstrip border-t border-border">
            {orderedParticipants.map((participant) => (
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

  // Mobile: active speaker (or tapped pin) spotlight layout for 3+ participants
  if (isMobile && humanParticipants.length >= 3) {
    const speaker =
      humanParticipants.find((p) => p.identity === pinnedIdentity) ||
      humanParticipants.find((p) => p.identity === activeSpeakerIdentity) ||
      humanParticipants.find((p) => p.identity !== localParticipant?.identity) ||
      humanParticipants[0];
    const others = humanParticipants.filter((p) => p.identity !== speaker.identity);

    return (
      <div
        ref={fullScreenRef}
        className={`flex h-full w-full gap-1.5 meeting-video-matte p-1.5 ${
          isLandscape ? 'flex-row' : 'flex-col'
        }`}
      >
        <div
          className="flex-1 min-h-0 min-w-0"
          onClick={() => pinnedIdentity && setPinnedIdentity(null)}
        >
          <ParticipantTile participant={speaker} tracks={tracks} />
        </div>
        <div
          className={`flex gap-1.5 flex-shrink-0 ${
            isLandscape
              ? 'w-28 flex-col overflow-y-auto'
              : 'h-20 flex-row overflow-x-auto'
          }`}
        >
          {others.map((participant) => (
            <div
              key={participant.identity}
              onClick={() =>
                setPinnedIdentity((prev) =>
                  prev === participant.identity ? null : participant.identity
                )
              }
              className="cursor-pointer flex-shrink-0"
            >
              <ParticipantTile
                participant={participant}
                tracks={tracks}
                compact
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Normal grid layout — up to 12 tiles per page on desktop, every tile fills 100% of its grid cell
  const pagedParticipants =
    orderedParticipants.length > DESKTOP_PAGE_SIZE
      ? orderedParticipants.slice(
          safePageIndex * DESKTOP_PAGE_SIZE,
          (safePageIndex + 1) * DESKTOP_PAGE_SIZE
        )
      : orderedParticipants;
  const count = pagedParticipants.length;

  return (
    <div ref={fullScreenRef} className="group relative h-full w-full overflow-hidden meeting-video-matte p-1.5 sm:p-3">
      <button
        type="button"
        onClick={toggleFullScreen}
        className="hidden sm:inline-flex absolute top-4 right-4 z-10 rounded-lg bg-black/55 p-2 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90"
        aria-label={isFullScreen ? 'Exit full screen' : 'Enter full screen'}
        title={isFullScreen ? 'Exit full screen' : 'Full screen'}
      >
        {isFullScreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
      </button>
      <div className={`grid ${getGridClass(count)} gap-1.5 sm:gap-3 h-full w-full auto-rows-fr`}>
        {pagedParticipants.map((participant, index) => (
          <ParticipantTile
            key={participant.identity}
            participant={participant}
            tracks={tracks}
            spanClass={getTileSpanClass(count, index)}
          />
        ))}
      </div>
      {totalPages > 1 && (
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-black/70 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-md">
          <button
            type="button"
            onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
            disabled={safePageIndex === 0}
            className="rounded-full p-0.5 transition-opacity hover:bg-white/15 disabled:opacity-35"
            aria-label="Previous participants page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span>
            Page {safePageIndex + 1} of {totalPages} · {orderedParticipants.length} in call
          </span>
          <button
            type="button"
            onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePageIndex >= totalPages - 1}
            className="rounded-full p-0.5 transition-opacity hover:bg-white/15 disabled:opacity-35"
            aria-label="Next participants page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function ParticipantTile({ participant, tracks, compact = false, spanClass = '' }) {
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

  const displayName = participantDisplayName(participant);

  return (
    <div
      className={`relative min-h-0 overflow-hidden rounded-lg border meeting-participant-tile ${
        compact ? 'w-24 sm:w-44 flex-shrink-0 aspect-video' : `w-full h-full ${spanClass}`
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
      <div className={`pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent ${compact ? 'px-1.5 pb-1 pt-3' : 'px-3 pb-2 pt-6'}`}>
        <span className={`block truncate font-medium text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)] ${compact ? 'text-[10px]' : 'text-xs sm:text-sm'}`} data-no-translate="true">
          {displayName}
          {isLocal && ' (You)'}
        </span>
      </div>

      {/* Mic/camera status indicators -- hidden on compact to save space */}
      {!compact && (
        <div className="absolute left-1.5 top-1.5 flex items-center gap-1 sm:left-2 sm:top-2">
          {isMicMuted && (
            <span className="rounded-md bg-red-500/90 p-1 shadow-sm" title="Microphone off" aria-label="Microphone off">
              <MicOff className="h-3 w-3 text-white sm:h-3.5 sm:w-3.5" aria-hidden="true" />
            </span>
          )}
          {isCameraOff && (
            <span className="rounded-md bg-red-500/90 p-1 shadow-sm" title="Camera off" aria-label="Camera off">
              <VideoOff className="h-3 w-3 text-white sm:h-3.5 sm:w-3.5" aria-hidden="true" />
            </span>
          )}
        </div>
      )}

      {/* Top-right: speaking indicator + connection quality */}
      <div className={`absolute flex items-center gap-1 ${compact ? 'right-1 top-1' : 'right-1.5 top-1.5 sm:right-2 sm:top-2'}`}>
        {isSpeaking && (
          <div
            className={`animate-pulse rounded-full bg-emerald-400 shadow-[0_0_0_2px_rgb(0_0_0/0.25)] ${compact ? 'h-2 w-2' : 'h-3 w-3'}`}
            title="Speaking"
            aria-label="Speaking"
          />
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
        title={`Connection: ${meta.label}`}
        className="flex h-5 items-end gap-[2px] rounded-md bg-black/40 px-1 py-0.5 transition-colors hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
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
        if (!meetingId) return;
        let qualityEventToken = '';
        try {
          const info = JSON.parse(sessionStorage.getItem('participantInfo') || '{}');
          qualityEventToken = info.qualityEventToken || '';
        } catch {
          /* ignore */
        }
        const v2Tok = typeof localStorage !== 'undefined' ? localStorage.getItem('v2_token') : null;
        const headers = { 'Content-Type': 'application/json' };
        if (qualityEventToken) headers['X-Meeting-Quality-Token'] = qualityEventToken;
        if (v2Tok) headers.Authorization = `Bearer ${v2Tok}`;
        if (!qualityEventToken && !v2Tok) return;
        fetch('/api/quality-events', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            meeting_id: meetingId,
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
