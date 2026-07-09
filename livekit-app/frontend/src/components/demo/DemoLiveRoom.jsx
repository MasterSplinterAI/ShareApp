import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  usePreviewTracks,
} from '@livekit/components-react';
import { ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { MeetingProvider, useMeeting } from '../../context/MeetingContext';
import TranscriptionPanel from '../TranscriptionPanel';
import RoomControls from '../RoomControls';
import CustomControlBar from '../CustomControlBar';
import TtsAudioController from '../TtsAudioController';
import PreJoinScreen from '../PreJoinScreen';
import PublishPreviewTracks from '../PublishPreviewTracks';
import { DemoRoomStage } from './DemoRoomStage';
import { useDemoPhase } from '../../hooks/useDemoPhase';
import { demoLabService } from '../../services/demoLab';
import { Button } from '../ui/button';
import { ROOM_PUBLISH_DEFAULTS } from '../../lib/roomPublishDefaults';
import { useRoomControlLabels } from '../../hooks/useRoomControlLabels';

const LANGUAGE_LABELS = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  ja: 'Japanese',
};

function langLabel(code) {
  return LANGUAGE_LABELS[code?.split('-')[0]] || code || 'English';
}

function DemoLiveRoomInner({
  demoSessionId,
  userDisplayName,
  speakLang,
  agents,
  participants,
  scenarioTitle,
  maxTurns,
  prejoinChoices,
  onLeave,
}) {
  const {
    selectedLanguage,
    setSelectedLanguage,
    translationEnabled,
    setTranslationEnabled,
    voiceTranslationEnabled,
    setVoiceTranslationEnabled,
  } = useMeeting();
  const { turnPhase, activeSpeaker } = useDemoPhase();
  const displayName = userDisplayName || 'Guest';
  const intentionalLeaveRef = useRef(false);
  const t = useRoomControlLabels(selectedLanguage);

  const roomParticipants =
    participants?.length > 0
      ? participants.map((p) =>
          p.id === 'you' || p.name === 'You' || p.name === displayName
            ? { ...p, id: 'you', name: displayName, speakLang, isLocal: true }
            : p
        )
      : [
          {
            id: 'you',
            name: displayName,
            speakLang,
            isLocal: true,
            gradient: 'from-primary/30 to-slate-300',
          },
          ...agents.map((a) => ({
            id: a.id,
            name: a.name,
            speakLang: a.speakLang || a.nativeLang,
            gradient: a.gradient,
          })),
        ];

  const micLive = turnPhase === 'your_turn' || turnPhase === 'you_speaking';

  const handleNavigateAfterLeave = useCallback(() => {
    onLeave();
  }, [onLeave]);

  return (
    <div className="meeting-surface meeting-room-root relative flex h-[100dvh] flex-col overflow-hidden bg-background">
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
            {maxTurns} turns max · Deepgram STT
            {micLive ? (
              <span className="ml-2 font-medium text-emerald-600">· Mic live</span>
            ) : turnPhase === 'complete' ? (
              <span className="ml-2 font-medium text-primary">· Demo complete</span>
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

      <CustomControlBar
        selectedLanguage={selectedLanguage}
        setSelectedLanguage={setSelectedLanguage}
        translationEnabled={translationEnabled}
        setTranslationEnabled={setTranslationEnabled}
        voiceTranslationEnabled={voiceTranslationEnabled}
        setVoiceTranslationEnabled={setVoiceTranslationEnabled}
        isHost={false}
        onShareClick={() => toast('Guest links and invites are available on full Lalia meetings.')}
        intentionalLeaveRef={intentionalLeaveRef}
        onNavigateAfterLeave={handleNavigateAfterLeave}
        initialVideoEffectId={prejoinChoices?.videoEffectId ?? null}
      />

      {turnPhase === 'complete' && (
        <div className="flex shrink-0 items-center justify-center gap-3 border-t border-border/60 bg-card/90 px-4 py-3">
          <Button asChild onClick={() => demoLabService.track(demoSessionId, 'signup_click')}>
            <Link to="/v2/signup">
              Start free <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
          <Button variant="outline" onClick={onLeave}>
            Try again
          </Button>
        </div>
      )}

      <RoomAudioRenderer />
      <StartAudio label={t('startAudio')} />
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

  const [prejoinChoices, setPrejoinChoices] = useState(null);
  const [joinedReadLang, setJoinedReadLang] = useState(readLang);
  const [joinedName, setJoinedName] = useState(userDisplayName || identity || 'Guest');
  const [previewMedia, setPreviewMedia] = useState({
    audioEnabled: true,
    videoEnabled: true,
    audioDeviceId: '',
    videoDeviceId: '',
  });
  const [frozenPreviewTrackOptions, setFrozenPreviewTrackOptions] = useState(null);

  const previewTrackOptions = useMemo(() => {
    if (frozenPreviewTrackOptions) return frozenPreviewTrackOptions;
    return {
      audio: previewMedia.audioEnabled
        ? { deviceId: previewMedia.audioDeviceId || undefined }
        : false,
      video: previewMedia.videoEnabled
        ? { deviceId: previewMedia.videoDeviceId || undefined }
        : false,
    };
  }, [frozenPreviewTrackOptions, previewMedia]);

  const onPreviewMediaError = useCallback((err) => {
    console.warn('[DemoLiveRoom] PreJoin media error:', err);
    toast.error('Could not access camera or microphone. Check browser permissions.');
  }, []);

  const previewTracks = usePreviewTracks(previewTrackOptions, onPreviewMediaError);

  const handlePreviewMediaChange = useCallback((partial) => {
    setPreviewMedia((prev) => ({ ...prev, ...partial }));
  }, []);

  const handlePrejoinJoin = useCallback(
    (choices) => {
      setFrozenPreviewTrackOptions({
        audio: choices.audioEnabled ? { deviceId: choices.audioDeviceId || undefined } : false,
        video: choices.videoEnabled ? { deviceId: choices.videoDeviceId || undefined } : false,
      });
      setJoinedName(choices.name || userDisplayName || 'Guest');
      setJoinedReadLang(readLang);
      setPrejoinChoices(choices);
    },
    [readLang, userDisplayName]
  );

  const handleError = useCallback((err) => {
    console.error('[DemoLiveRoom]', err);
    toast.error('Could not connect to demo room. Check mic permissions and try again.');
  }, []);

  if (!prejoinChoices) {
    return (
      <PreJoinScreen
        roomName={`Demo · ${scenarioTitle || 'Translation lab'}`}
        defaultName={userDisplayName || identity || 'Guest'}
        defaultLanguage={readLang}
        participantCount={(agents?.length || 0) + 1}
        meetingTitle={scenarioTitle}
        previewTracks={previewTracks}
        media={previewMedia}
        onMediaChange={handlePreviewMediaChange}
        onJoin={handlePrejoinJoin}
        showNameField={false}
        showLanguagePicker={false}
        joinButtonLabel="Join demo room"
        headerSubtitle={`You speak ${langLabel(speakLang)} · captions in ${langLabel(readLang)}`}
      />
    );
  }

  return (
    <MeetingProvider
      initialState={{
        selectedLanguage: joinedReadLang,
        translationEnabled: true,
        voiceTranslationEnabled: ttsEnabled !== false,
        participantName: joinedName,
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
        audio={false}
        connect
        onError={handleError}
        options={{
          adaptiveStream: true,
          dynacast: true,
          audioCaptureDefaults: prejoinChoices.audioDeviceId
            ? { deviceId: prejoinChoices.audioDeviceId }
            : undefined,
          videoCaptureDefaults: prejoinChoices.videoDeviceId
            ? { deviceId: prejoinChoices.videoDeviceId }
            : undefined,
          publishDefaults: ROOM_PUBLISH_DEFAULTS,
        }}
        className="h-[100dvh]"
      >
        <PublishPreviewTracks
          tracks={previewTracks}
          videoEnabled={prejoinChoices.videoEnabled ?? false}
          audioEnabled={prejoinChoices.audioEnabled ?? true}
          publishOptions={ROOM_PUBLISH_DEFAULTS}
        />
        <DemoLiveRoomInner
          demoSessionId={demoSessionId}
          userDisplayName={joinedName}
          speakLang={speakLang}
          agents={agents}
          participants={participants}
          scenarioTitle={scenarioTitle}
          maxTurns={maxTurns}
          prejoinChoices={prejoinChoices}
          onLeave={onLeave}
        />
      </LiveKitRoom>
    </MeetingProvider>
  );
}
