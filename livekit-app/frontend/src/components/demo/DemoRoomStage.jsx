import { useEffect, useRef } from 'react';
import { Mic, MicOff, Users } from 'lucide-react';
import { useLocalParticipant, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Button } from '../ui/button';

const PHASE_HINTS = {
  opening: 'Meeting starting…',
  your_turn: 'Your turn — speak now',
  you_speaking: 'Listening…',
  processing: 'Translating your line…',
  agent_speaking: 'Teammate responding…',
  complete: 'Demo complete',
};

function langLabel(code) {
  return (code || 'en').toUpperCase();
}

function LocalParticipantTile({ participant, active }) {
  const { localParticipant } = useLocalParticipant();
  const tracks = useTracks([Track.Source.Camera, Track.Source.Microphone], { onlySubscribed: false });
  const camTrack = tracks.find(
    (t) => t.participant === localParticipant && t.source === Track.Source.Camera,
  );
  const micTrack = tracks.find(
    (t) => t.participant === localParticipant && t.source === Track.Source.Microphone,
  );
  const videoRef = useRef(null);
  const initial = participant.name?.charAt(0) || '?';
  const camPublication = camTrack?.publication?.track ?? camTrack?.track;
  const micPublication = micTrack?.publication?.track ?? micTrack?.track;
  const micLive = micPublication ? !micPublication.isMuted : false;
  const camLive = Boolean(camPublication && !camPublication.isMuted);

  useEffect(() => {
    const track = camPublication;
    const el = videoRef.current;
    if (!track || !el || !camLive) return undefined;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [camPublication, camLive]);

  return (
    <div
      className={`relative aspect-video w-full min-w-[5.5rem] max-w-[10rem] shrink-0 overflow-hidden rounded-lg border shadow-sm transition-all sm:min-w-[7rem] sm:max-w-none ${
        active
          ? 'border-emerald-400 ring-2 ring-emerald-400/80 ring-offset-2 ring-offset-background'
          : 'border-border/50'
      }`}
    >
      {camLive ? (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
          muted
          playsInline
          autoPlay
        />
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-br ${participant.gradient || 'from-primary/30 to-slate-300'}`} />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
      {active && (
        <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-emerald-500/90 px-1.5 py-0.5 text-[8px] font-semibold text-white">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          Live
        </span>
      )}
      <span className="absolute left-1.5 top-1.5 rounded bg-primary/90 px-1 py-0.5 text-[8px] font-bold text-primary-foreground">
        {langLabel(participant.speakLang)}
      </span>
      {!camLive && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/20 text-lg font-semibold text-white backdrop-blur-sm sm:h-12 sm:w-12 sm:text-xl">
            {initial}
          </span>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-1.5 text-[9px] text-white sm:text-[10px]">
        <span className="block truncate font-medium drop-shadow-sm">{participant.name} (You)</span>
        <span className="flex items-center gap-1 truncate text-white/75">
          {micLive ? <Mic className="h-2.5 w-2.5" /> : <MicOff className="h-2.5 w-2.5" />}
          Mic · {langLabel(participant.speakLang)}
        </span>
      </div>
    </div>
  );
}

function DemoParticipantTile({ participant, active, muted }) {
  const initial = participant.name?.charAt(0) || '?';

  return (
    <div
      className={`relative aspect-video w-full min-w-[5.5rem] max-w-[10rem] shrink-0 overflow-hidden rounded-lg border shadow-sm transition-all sm:min-w-[7rem] sm:max-w-none ${
        active
          ? 'border-emerald-400 ring-2 ring-emerald-400/80 ring-offset-2 ring-offset-background'
          : 'border-border/50'
      } ${muted ? 'opacity-60' : ''}`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${participant.gradient || 'from-slate-200 to-slate-300'}`} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
      {active && (
        <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-emerald-500/90 px-1.5 py-0.5 text-[8px] font-semibold text-white">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          Live
        </span>
      )}
      <span className="absolute left-1.5 top-1.5 rounded bg-primary/90 px-1 py-0.5 text-[8px] font-bold text-primary-foreground">
        {langLabel(participant.speakLang)}
      </span>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/20 text-lg font-semibold text-white backdrop-blur-sm sm:h-12 sm:w-12 sm:text-xl">
          {initial}
        </span>
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-1.5 text-[9px] text-white sm:text-[10px]">
        <span className="block truncate font-medium drop-shadow-sm">{participant.name}</span>
        <span className="block truncate text-white/75">
          Translated · {langLabel(participant.speakLang)}
        </span>
      </div>
    </div>
  );
}

export function DemoRoomStage({
  participants = [],
  activeSpeaker,
  turnPhase,
  scenarioTitle,
  micSupported,
  listening,
  micDisabled,
  onMicDown,
  onMicUp,
  showMicButton = true,
}) {
  const hint = PHASE_HINTS[turnPhase] || '';

  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 sm:px-4">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/90" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/90" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/90" />
        <span className="ml-1 truncate text-[10px] font-medium text-muted-foreground sm:text-xs">
          Lalia · {scenarioTitle || 'Translation lab'}
        </span>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          <Users className="h-3 w-3" />
          {participants.length}
        </span>
      </div>

      <div className="bg-muted/20 p-3 sm:p-4">
        <div className="flex justify-center gap-2 overflow-x-auto pb-1 sm:gap-3">
          {participants.map((p) =>
            p.isLocal ? (
              <LocalParticipantTile
                key={p.id || p.name}
                participant={p}
                active={activeSpeaker === p.name}
              />
            ) : (
              <DemoParticipantTile
                key={p.id || p.name}
                participant={p}
                active={activeSpeaker === p.name}
                muted={false}
              />
            )
          )}
        </div>

        <p className="mt-3 text-center text-xs text-muted-foreground">{hint}</p>

        {showMicButton && micSupported && turnPhase !== 'complete' && turnPhase !== 'opening' && (
          <div className="mt-4 flex justify-center">
            <Button
              type="button"
              size="lg"
              variant={listening ? 'destructive' : 'default'}
              disabled={micDisabled}
              className="min-w-[12rem] gap-2"
              onPointerDown={(e) => {
                e.preventDefault();
                onMicDown?.();
              }}
              onPointerUp={onMicUp}
              onPointerLeave={onMicUp}
              onPointerCancel={onMicUp}
            >
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              {listening ? 'Release to send' : 'Hold to speak'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
