import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useRoomContext,
} from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import { ArrowRight, Loader2, Phone } from 'lucide-react';
import toast from 'react-hot-toast';
import { MeetingProvider, useMeeting } from '../../context/MeetingContext';
import TranscriptionPanel from '../TranscriptionPanel';
import RoomControls from '../RoomControls';
import { DemoRoomStage } from './DemoRoomStage';
import { useDemoOrchestrator } from '../../hooks/useDemoOrchestrator';
import { demoLabService } from '../../services/demoLab';
import { Button } from '../ui/button';
import { ROOM_PUBLISH_DEFAULTS } from '../../lib/roomPublishDefaults';

function DemoMicEnable() {
  const room = useRoomContext();
  useEffect(() => {
    if (!room || room.state !== ConnectionState.Connected) return;
    room.localParticipant.setMicrophoneEnabled(true).catch(() => {});
  }, [room, room?.state]);
  return null;
}

function DemoLiveRoomInner({
  demoSessionId,
  userIdentity,
  readLang,
  speakLang,
  agents,
  participants,
  scenarioTitle,
  ttsEnabled,
  maxTurns,
  onLeave,
}) {
  const { selectedLanguage, translationEnabled, voiceTranslationEnabled } = useMeeting();
  const [turnPhase, setTurnPhase] = useState('opening');
  const [activeSpeaker, setActiveSpeaker] = useState(null);
  const [complete, setComplete] = useState(false);

  const agentNames = agents.map((a) => a.name);

  const { turnsRemaining, busy } = useDemoOrchestrator({
    demoSessionId,
    userIdentity,
    readLang: selectedLanguage || readLang,
    agentNames,
    agents,
    ttsEnabled: ttsEnabled && voiceTranslationEnabled,
    onActiveSpeaker: setActiveSpeaker,
    onTurnPhase: setTurnPhase,
    onComplete: setComplete,
  });

  const roomParticipants =
    participants?.length > 0
      ? participants.map((p) =>
          p.id === 'you' || p.name === 'You' ? { ...p, name: 'You', speakLang: speakLang } : p
        )
      : [
          { id: 'you', name: 'You', speakLang, gradient: 'from-primary/30 to-slate-300' },
          ...agents.map((a) => ({
            id: a.id,
            name: a.name,
            speakLang: a.speakLang || a.nativeLang,
            gradient: a.gradient,
          })),
        ];

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      <DemoMicEnable />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border/60 px-3 py-2 text-center text-xs text-muted-foreground">
            {turnsRemaining != null ? `${turnsRemaining} turns left` : `${maxTurns} max`} · Real
            Deepgram STT · LLM teammates
          </div>
          <div className="shrink-0 p-3">
            <DemoRoomStage
              participants={roomParticipants}
              activeSpeaker={activeSpeaker}
              turnPhase={turnPhase}
              scenarioTitle={scenarioTitle}
              micSupported={false}
              showMicButton={false}
            />
          </div>
          <p className="px-4 pb-2 text-center text-xs text-muted-foreground">
            Speak naturally — your mic uses the same STT pipeline as real meetings. Teammates reply
            via AI in their languages; captions translate for you.
          </p>
        </div>
        <TranscriptionPanel />
      </div>

      <RoomControls
        selectedLanguage={selectedLanguage}
        spokenLanguage={speakLang}
        translationEnabled={translationEnabled}
        voiceTranslationEnabled={voiceTranslationEnabled}
        participantName={userIdentity}
      />

      <div className="flex shrink-0 items-center justify-center gap-3 border-t border-border/60 bg-card/80 px-4 py-3">
        {complete ? (
          <>
            <Button asChild onClick={() => demoLabService.track(demoSessionId, 'signup_click')}>
              <Link to="/v2/signup">
                Start free <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" onClick={onLeave}>
              Try again
            </Button>
          </>
        ) : (
          <Button variant="destructive" size="sm" className="gap-2" onClick={onLeave}>
            <Phone className="h-4 w-4 rotate-[135deg]" />
            Leave demo
          </Button>
        )}
      </div>
    </div>
  );
}

export function DemoLiveRoom({
  token,
  url,
  demoSessionId,
  identity,
  readLang,
  speakLang,
  agents,
  participants,
  scenarioTitle,
  ttsEnabled,
  maxTurns,
  onLeave,
}) {
  const livekitUrl =
    url || import.meta.env.VITE_LIVEKIT_URL || 'wss://production-uiycx4ku.livekit.cloud';

  const handleError = useCallback((err) => {
    console.error('[DemoLiveRoom]', err);
    toast.error('Could not connect to demo room. Check mic permissions and try again.');
  }, []);

  if (!token) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <MeetingProvider
      initialState={{
        selectedLanguage: readLang,
        translationEnabled: true,
        voiceTranslationEnabled: ttsEnabled,
      }}
    >
      <LiveKitRoom
        token={token}
        serverUrl={livekitUrl}
        video={false}
        audio
        connect
        onError={handleError}
        options={{
          adaptiveStream: true,
          dynacast: true,
          publishDefaults: ROOM_PUBLISH_DEFAULTS,
        }}
        className="h-[100dvh]"
      >
        <StartAudio label="Enable audio" />
        <RoomAudioRenderer />
        <DemoLiveRoomInner
          demoSessionId={demoSessionId}
          userIdentity={identity}
          readLang={readLang}
          speakLang={speakLang}
          agents={agents}
          participants={participants}
          scenarioTitle={scenarioTitle}
          ttsEnabled={ttsEnabled}
          maxTurns={maxTurns}
          onLeave={onLeave}
        />
      </LiveKitRoom>
    </MeetingProvider>
  );
}
