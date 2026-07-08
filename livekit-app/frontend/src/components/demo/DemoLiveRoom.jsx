import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
} from '@livekit/components-react';
import { ArrowRight, Headphones, Phone } from 'lucide-react';
import toast from 'react-hot-toast';
import { MeetingProvider, useMeeting } from '../../context/MeetingContext';
import TranscriptionPanel from '../TranscriptionPanel';
import RoomControls from '../RoomControls';
import { DemoRoomStage } from './DemoRoomStage';
import { useDemoOrchestrator } from '../../hooks/useDemoOrchestrator';
import { useDemoMicGate } from '../../hooks/useDemoMicGate';
import { demoLabService } from '../../services/demoLab';
import { Button } from '../ui/button';
import { ROOM_PUBLISH_DEFAULTS } from '../../lib/roomPublishDefaults';

function DemoLiveRoomInner({
  demoSessionId,
  userIdentity,
  userDisplayName,
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
  const displayName = userDisplayName || userIdentity || 'You';

  useDemoMicGate(turnPhase, { cooldownMs: ttsEnabled ? 1400 : 900 });

  const { turnsRemaining } = useDemoOrchestrator({
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
          p.id === 'you' || p.name === 'You'
            ? { ...p, name: displayName, speakLang }
            : p
        )
      : [
          { id: 'you', name: displayName, speakLang, gradient: 'from-primary/30 to-slate-300' },
          ...agents.map((a) => ({
            id: a.id,
            name: a.name,
            speakLang: a.speakLang || a.nativeLang,
            gradient: a.gradient,
          })),
        ];

  const turnHint =
    turnPhase === 'your_turn'
      ? `Your turn — speak now, ${displayName}`
      : turnPhase === 'agent_speaking'
        ? 'Teammate responding… (mic paused)'
        : undefined;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border/60 px-3 py-2 text-center text-xs text-muted-foreground">
            {turnsRemaining != null ? `${turnsRemaining} turns left` : `${maxTurns} max`} · Deepgram
            STT · LLM teammates
            {turnPhase === 'your_turn' && (
              <span className="ml-2 font-medium text-emerald-600">· Mic live</span>
            )}
            {turnPhase !== 'your_turn' && turnPhase !== 'complete' && (
              <span className="ml-2 text-amber-600">· Mic paused</span>
            )}
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
            {turnHint ||
              'Wait for your teammate to finish — your mic turns on automatically when it is your turn.'}
          </p>
          {ttsEnabled && (
            <p className="flex items-center justify-center gap-1.5 px-4 pb-2 text-center text-xs text-amber-700/90">
              <Headphones className="h-3.5 w-3.5" />
              Use headphones for agent voice to avoid echo.
            </p>
          )}
        </div>
        <TranscriptionPanel />
      </div>

      <RoomControls
        selectedLanguage={selectedLanguage}
        spokenLanguage={speakLang}
        translationEnabled={translationEnabled}
        voiceTranslationEnabled={voiceTranslationEnabled}
        participantName={displayName}
      />

      <div className="flex shrink-0 items-center justify-center gap-3 border-b border-border/60 bg-card/80 px-4 py-3">
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
  userDisplayName,
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
        audio={false}
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
          userDisplayName={userDisplayName}
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
