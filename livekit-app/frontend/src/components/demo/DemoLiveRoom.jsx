import { useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useRoomContext,
} from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import { ArrowRight, Phone } from 'lucide-react';
import toast from 'react-hot-toast';
import { MeetingProvider, useMeeting } from '../../context/MeetingContext';
import TranscriptionPanel from '../TranscriptionPanel';
import RoomControls from '../RoomControls';
import TtsAudioController from '../TtsAudioController';
import { DemoRoomStage } from './DemoRoomStage';
import { useDemoPhase } from '../../hooks/useDemoPhase';
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
  userDisplayName,
  readLang,
  speakLang,
  agents,
  participants,
  scenarioTitle,
  maxTurns,
  onLeave,
}) {
  const { selectedLanguage, translationEnabled, voiceTranslationEnabled } = useMeeting();
  const { turnPhase, activeSpeaker } = useDemoPhase();
  const displayName = userDisplayName || userIdentity || 'Guest';

  const roomParticipants =
    participants?.length > 0
      ? participants.map((p) =>
          p.id === 'you' || p.name === 'You' || p.name === displayName
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

  const micLive = turnPhase === 'your_turn';

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      <DemoMicEnable />
      <TtsAudioController
        selectedLanguage={selectedLanguage}
        translationEnabled={translationEnabled}
        voiceTranslationEnabled={voiceTranslationEnabled}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border/60 bg-gradient-to-r from-primary/5 via-background to-emerald-500/5 px-3 py-2 text-center text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{scenarioTitle || 'Translation lab'}</span>
            <span className="mx-2 text-border">·</span>
            {maxTurns} turns max · Deepgram STT · Pipeline TTS
            {micLive ? (
              <span className="ml-2 font-medium text-emerald-600">· Mic live (VAD)</span>
            ) : turnPhase !== 'complete' ? (
              <span className="ml-2">· Waiting for your turn</span>
            ) : null}
          </div>
          <div className="shrink-0 p-3 sm:p-4">
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
            Same pipeline as production: your mic → Deepgram VAD/STT → captions. Teammates reply
            via AI with translated captions and optional voice on the <code className="text-[10px]">tts-{'{lang}'}</code> track.
          </p>
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

      <div className="flex shrink-0 items-center justify-center gap-3 border-t border-border/60 bg-card/80 px-4 py-3">
        {turnPhase === 'complete' ? (
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
        voiceTranslationEnabled: ttsEnabled !== false,
        participantName: userDisplayName || identity || 'Guest',
        demoTeammates: (agents || []).map((a) => ({
          name: a.name,
          lang: a.speakLang || a.nativeLang,
        })),
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
          userDisplayName={userDisplayName}
          readLang={readLang}
          speakLang={speakLang}
          agents={agents}
          participants={participants}
          scenarioTitle={scenarioTitle}
          maxTurns={maxTurns}
          onLeave={onLeave}
        />
      </LiveKitRoom>
    </MeetingProvider>
  );
}
