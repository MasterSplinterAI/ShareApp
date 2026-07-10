import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  usePreviewTracks,
} from '@livekit/components-react';
import { ArrowRight, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { MeetingProvider, useMeeting } from '../../context/MeetingContext';
import TranscriptionPanel from '../TranscriptionPanel';
import RoomControls from '../RoomControls';
import CustomControlBar from '../CustomControlBar';
import TtsAudioController from '../TtsAudioController';
import PreJoinScreen from '../PreJoinScreen';
import PublishPreviewTracks from '../PublishPreviewTracks';
import DemoEnsureMedia from './DemoEnsureMedia';
import { DemoMeetingStage } from './DemoMeetingStage';
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
  scenarioTitle,
  maxTurns,
  prejoinChoices,
  onLeave,
  intentionalLeaveRef,
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
  const t = useRoomControlLabels(selectedLanguage);

  const micLive = turnPhase === 'your_turn' || turnPhase === 'you_speaking';

  return (
    <div className="meeting-surface meeting-room-root relative flex h-[100dvh] flex-col overflow-hidden bg-background">
      <TtsAudioController
        selectedLanguage={selectedLanguage}
        translationEnabled={translationEnabled}
        voiceTranslationEnabled={voiceTranslationEnabled}
      />
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

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <DemoMeetingStage
              agents={agents}
              activeSpeaker={activeSpeaker}
              turnPhase={turnPhase}
              scenarioTitle={scenarioTitle}
            />
          </div>
          <TranscriptionPanel />
        </div>
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
        onNavigateAfterLeave={onLeave}
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

/**
 * Prejoin first (mic/camera preview), then create LiveKit room — same order as production meetings.
 */
export function DemoJoinFlow({ config, maxTurns, onLeave }) {
  const {
    scenarioId,
    speakLang,
    readLang,
    participantLangs,
    participantName,
    ttsEnabled,
    scenarioTitle,
  } = config;

  const [prejoinChoices, setPrejoinChoices] = useState(null);
  const [liveRoom, setLiveRoom] = useState(null);
  const [roomError, setRoomError] = useState(null);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [previewMedia, setPreviewMedia] = useState({
    audioEnabled: true,
    videoEnabled: true,
    audioDeviceId: '',
    videoDeviceId: '',
  });

  const previewTrackOptions = useMemo(
    () => ({
      audio: previewMedia.audioEnabled
        ? { deviceId: previewMedia.audioDeviceId || undefined }
        : false,
      video: previewMedia.videoEnabled
        ? { deviceId: previewMedia.videoDeviceId || undefined }
        : false,
    }),
    [previewMedia]
  );

  const onPreviewMediaError = useCallback((err) => {
    console.warn('[DemoJoinFlow] PreJoin media error:', err);
    toast.error('Could not access camera or microphone. Check browser permissions.');
  }, []);

  const previewTracks = usePreviewTracks(previewTrackOptions, onPreviewMediaError);

  const handlePreviewMediaChange = useCallback((partial) => {
    setPreviewMedia((prev) => ({ ...prev, ...partial }));
  }, []);

  const handlePrejoinJoin = useCallback((choices) => {
    setPrejoinChoices(choices);
  }, []);

  const roomCreateStartedRef = useRef(false);

  useEffect(() => {
    if (!prejoinChoices || liveRoom || roomCreateStartedRef.current) return;

    roomCreateStartedRef.current = true;
    let cancelled = false;
    setCreatingRoom(true);
    setRoomError(null);

    demoLabService
      .createRoom({
        scenarioId,
        speakLang,
        readLang,
        participantLangs,
        participantName: participantName?.trim() || 'Guest',
      })
      .then((data) => {
        if (cancelled) return;
        setLiveRoom(data);
        demoLabService.track(data.demoSessionId, 'live_room_start', { scenarioId });
      })
      .catch((e) => {
        if (cancelled) return;
        roomCreateStartedRef.current = false;
        const message = e.response?.data?.error || e.response?.data?.message || 'Could not start demo room';
        setRoomError(message);
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setCreatingRoom(false);
      });

    return () => {
      cancelled = true;
    };
  }, [prejoinChoices, liveRoom, scenarioId, speakLang, readLang, participantLangs, participantName]);

  const handleError = useCallback((err) => {
    console.error('[DemoJoinFlow]', err);
    toast.error('Could not connect to demo room. Check mic permissions and try again.');
  }, []);

  const intentionalLeaveRef = useRef(false);

  const handleDisconnected = useCallback(() => {
    // Always return to the demo landing after leave (or unexpected disconnect).
    onLeave?.();
  }, [onLeave]);

  if (!prejoinChoices) {
    return (
      <PreJoinScreen
        roomName={`Demo · ${scenarioTitle || 'Translation lab'}`}
        defaultName={participantName?.trim() || 'Guest'}
        defaultLanguage={readLang}
        participantCount={2}
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

  if (creatingRoom || !liveRoom) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            {roomError || 'Connecting to demo room…'}
          </p>
          {roomError && (
            <Button variant="outline" className="mt-4" onClick={onLeave}>
              Back
            </Button>
          )}
        </div>
      </div>
    );
  }

  const livekitUrl =
    liveRoom.url || import.meta.env.VITE_LIVEKIT_URL || 'wss://production-uiycx4ku.livekit.cloud';
  const displayName = liveRoom.displayName || participantName?.trim() || 'Guest';
  const wantsVideo = prejoinChoices.videoEnabled ?? false;
  const wantsAudio = prejoinChoices.audioEnabled ?? true;

  return (
    <MeetingProvider
      initialState={{
        selectedLanguage: readLang,
        translationEnabled: true,
        voiceTranslationEnabled: ttsEnabled !== false,
        participantName: displayName,
        demoTeammates: (liveRoom.agents || []).map((a) => ({
          name: a.name,
          lang: a.speakLang || a.nativeLang,
        })),
      }}
    >
      <LiveKitRoom
        token={liveRoom.token}
        serverUrl={livekitUrl}
        video={false}
        audio={false}
        connect
        onError={handleError}
        onDisconnected={handleDisconnected}
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
          videoEnabled={wantsVideo}
          audioEnabled={wantsAudio}
          publishOptions={ROOM_PUBLISH_DEFAULTS}
        />
        <DemoEnsureMedia
          audioEnabled={wantsAudio}
          videoEnabled={wantsVideo}
          audioDeviceId={prejoinChoices.audioDeviceId}
          videoDeviceId={prejoinChoices.videoDeviceId}
        />
        <DemoLiveRoomInner
          demoSessionId={liveRoom.demoSessionId}
          userDisplayName={displayName}
          speakLang={speakLang}
          agents={liveRoom.agents}
          scenarioTitle={liveRoom.scenario?.title || scenarioTitle}
          maxTurns={liveRoom.maxTurns || maxTurns}
          prejoinChoices={prejoinChoices}
          onLeave={onLeave}
          intentionalLeaveRef={intentionalLeaveRef}
        />
      </LiveKitRoom>
    </MeetingProvider>
  );
}

/** @deprecated Use DemoJoinFlow — kept as alias for imports */
export function DemoLiveRoom(props) {
  return <DemoJoinFlow {...props} />;
}
