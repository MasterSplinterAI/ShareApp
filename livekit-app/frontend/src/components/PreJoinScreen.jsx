import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Track } from 'livekit-client';
import {
  Mic, MicOff, Video, VideoOff, Globe, AlertCircle, Users,
} from 'lucide-react';
import { normalizeMeetingLanguageCode, readStoredMeetingLanguage } from '../lib/languages';
import { MeetingLanguagePicker } from './MeetingLanguagePicker';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import MeetingBrandHeader from './MeetingBrandHeader';
import VideoEffectsPicker from './VideoEffectsPicker';
import { brandingStyleVars, brandButtonClassName } from '../lib/meetingBranding';
import { useTranslation } from '../lib/i18n/I18nProvider';
import { isUiLocale, resolveUiLocale } from '../lib/i18n/uiLanguages';
import {
  applyVideoEffect,
  loadSavedEffectId,
  saveEffectId,
  useVideoEffectsSupport,
} from '../lib/videoEffects';

/** Live input-level meter driven by the preview audio track. */
function MicLevelMeter({ audioTrack }) {
  const barsRef = useRef(null);

  useEffect(() => {
    const mediaStreamTrack = audioTrack?.mediaStreamTrack;
    if (!mediaStreamTrack) return undefined;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return undefined;
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf;

    const tick = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) sum += data[i];
      const level = Math.min(1, sum / data.length / 80);
      const bars = barsRef.current?.children;
      if (bars) {
        const active = Math.round(level * bars.length);
        for (let i = 0; i < bars.length; i += 1) {
          bars[i].style.opacity = i < active ? '1' : '0.25';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      ctx.close().catch(() => {});
    };
  }, [audioTrack]);

  return (
    <div ref={barsRef} className="flex h-4 items-end gap-0.5" aria-hidden="true">
      {Array.from({ length: 10 }).map((_, i) => (
        <span
          key={i}
          className="w-1 rounded-full bg-emerald-500 transition-opacity duration-75"
          style={{ height: `${30 + i * 7}%`, opacity: 0.25 }}
        />
      ))}
    </div>
  );
}

function DeviceSelect({ kind, devices, activeDeviceId, onChange, disabled, microphoneLabel, cameraLabel }) {
  const label = kind === 'audioinput' ? microphoneLabel : cameraLabel;
  if (!devices.length) return null;
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <select
        value={activeDeviceId || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={label}
        className="h-9 w-full cursor-pointer truncate rounded-md border border-input bg-background px-2.5 text-sm transition-colors hover:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
      >
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Jitsi-style prejoin lobby: camera/mic preview, device pickers, join-muted toggles,
 * display name and caption language — collected BEFORE the room connects so the
 * captions pipeline receives the language exactly as the existing flow expects.
 */
function PreJoinScreen({
  roomName,
  defaultName = '',
  defaultLanguage = 'en',
  participantCount = null,
  meetingTitle = null,
  branding = null,
  previewTracks,
  media,
  onMediaChange,
  onJoin,
}) {
  const { t, setLocale } = useTranslation();
  const [name, setName] = useState(defaultName);
  const [selectedLanguage, setSelectedLanguage] = useState(() =>
    normalizeMeetingLanguageCode(defaultLanguage || readStoredMeetingLanguage())
  );

  const syncUiLocaleToMeetingLanguage = useCallback((code) => {
    const uiLocale = resolveUiLocale(normalizeMeetingLanguageCode(code));
    if (isUiLocale(uiLocale)) {
      setLocale(uiLocale);
    }
  }, [setLocale]);

  useEffect(() => {
    syncUiLocaleToMeetingLanguage(selectedLanguage);
  }, [selectedLanguage, syncUiLocaleToMeetingLanguage]);

  const handleLanguageChange = useCallback((code) => {
    const next = normalizeMeetingLanguageCode(code);
    setSelectedLanguage(next);
    syncUiLocaleToMeetingLanguage(next);
  }, [syncUiLocaleToMeetingLanguage]);
  const { audioEnabled, videoEnabled, audioDeviceId, videoDeviceId } = media;
  const setAudioEnabled = useCallback(
    (value) => {
      onMediaChange(typeof value === 'function' ? { audioEnabled: value(audioEnabled) } : { audioEnabled: value });
    },
    [onMediaChange, audioEnabled]
  );
  const setVideoEnabled = useCallback(
    (value) => {
      onMediaChange(typeof value === 'function' ? { videoEnabled: value(videoEnabled) } : { videoEnabled: value });
    },
    [onMediaChange, videoEnabled]
  );
  const setAudioDeviceId = useCallback(
    (deviceId) => onMediaChange({ audioDeviceId: deviceId }),
    [onMediaChange]
  );
  const setVideoDeviceId = useCallback(
    (deviceId) => onMediaChange({ videoDeviceId: deviceId }),
    [onMediaChange]
  );
  const [devices, setDevices] = useState({ audioinput: [], videoinput: [] });
  const [mediaError, setMediaError] = useState(null);
  const effectsSupported = useVideoEffectsSupport();
  const [effectId, setEffectId] = useState(() => loadSavedEffectId());

  const tracks = previewTracks;

  const videoTrack = useMemo(
    () => tracks?.find((t) => t.kind === Track.Kind.Video),
    [tracks]
  );
  const audioTrack = useMemo(
    () => tracks?.find((t) => t.kind === Track.Kind.Audio),
    [tracks]
  );

  // Clear stale permission errors once a track is live
  useEffect(() => {
    if (tracks?.length) setMediaError(null);
  }, [tracks]);

  const videoElRef = useRef(null);
  useEffect(() => {
    const el = videoElRef.current;
    if (el && videoTrack) {
      videoTrack.attach(el);
      return () => {
        videoTrack.detach(el);
      };
    }
    return undefined;
  }, [videoTrack]);

  // Blur / virtual background on the live preview. usePreviewTracks re-acquires
  // the track on device changes, so re-apply on every track instance.
  useEffect(() => {
    if (!videoTrack || !effectsSupported) return;
    applyVideoEffect(videoTrack, effectId).catch((err) => {
      console.warn('Preview video effect failed:', err);
    });
  }, [videoTrack, effectId, effectsSupported]);

  const handleEffectSelect = useCallback((id) => {
    setEffectId(id);
    saveEffectId(id);
  }, []);

  // Device lists (labels populate after permission is granted)
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setDevices({
          audioinput: all.filter((d) => d.kind === 'audioinput'),
          videoinput: all.filter((d) => d.kind === 'videoinput'),
        });
      } catch {
        /* enumeration unsupported — pickers just stay hidden */
      }
    };
    refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
    };
  }, [tracks]);

  const initial = (name.trim()[0] || '?').toUpperCase();

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onJoin({
      name: name.trim(),
      language: selectedLanguage,
      audioEnabled,
      videoEnabled,
      audioDeviceId,
      videoDeviceId,
      videoEffectId: effectId,
    });
  };

  return (
    <div
      className="flex min-h-[100dvh] items-center justify-center bg-muted/40 px-4 py-6"
      style={brandingStyleVars(branding)}
    >
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-border/70 bg-card shadow-lg">
        <div className="border-b border-border/60 px-4 py-4 text-center sm:px-6 sm:py-5">
          <MeetingBrandHeader branding={branding} meetingTitle={meetingTitle} />
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{t('prejoin.readyTitle')}</h1>
          <p className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-sm text-muted-foreground">
            <span className="truncate">{roomName}</span>
            {participantCount !== null && participantCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                <Users className="h-3 w-3" />
                {t('prejoin.inMeeting', { count: participantCount })}
              </span>
            )}
          </p>
        </div>

        <div className="grid gap-6 p-4 sm:p-6 md:grid-cols-[1.3fr_1fr]">
          {/* Preview */}
          <div className="space-y-3">
            <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-zinc-900">
              {videoEnabled && videoTrack ? (
                <video
                  ref={videoElRef}
                  className="h-full w-full -scale-x-100 object-cover"
                  muted
                  playsInline
                  autoPlay
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/90 text-3xl font-semibold text-primary-foreground">
                    {initial}
                  </div>
                </div>
              )}

              {/* Mic/cam toggles over the preview, Jitsi-style */}
              <div className="absolute bottom-3 left-0 right-0 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setAudioEnabled((v) => !v)}
                  aria-label={audioEnabled ? t('prejoin.muteMic') : t('prejoin.unmuteMic')}
                  aria-pressed={!audioEnabled}
                  title={audioEnabled ? t('prejoin.muteMic') : t('prejoin.unmuteMic')}
                  className={`flex h-11 w-11 items-center justify-center rounded-full shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 ${
                    audioEnabled
                      ? 'bg-white/90 text-zinc-900 hover:bg-white'
                      : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  }`}
                >
                  {audioEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                </button>
                <button
                  type="button"
                  onClick={() => setVideoEnabled((v) => !v)}
                  aria-label={videoEnabled ? t('prejoin.turnOffCamera') : t('prejoin.turnOnCamera')}
                  aria-pressed={!videoEnabled}
                  title={videoEnabled ? t('prejoin.turnOffCamera') : t('prejoin.turnOnCamera')}
                  className={`flex h-11 w-11 items-center justify-center rounded-full shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 ${
                    videoEnabled
                      ? 'bg-white/90 text-zinc-900 hover:bg-white'
                      : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  }`}
                >
                  {videoEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
                </button>
              </div>

              {audioEnabled && audioTrack && (
                <div className="absolute left-3 top-3 rounded-md bg-black/40 px-2 py-1 backdrop-blur-sm">
                  <MicLevelMeter audioTrack={audioTrack} />
                </div>
              )}
            </div>

            {mediaError && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {t('prejoin.mediaError', {
                    reason: mediaError.name || t('prejoin.permissionDenied'),
                  })}
                </span>
              </p>
            )}

            {effectsSupported && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">{t('prejoin.background')}</Label>
                <VideoEffectsPicker
                  activeEffectId={effectId}
                  onSelect={handleEffectSelect}
                  disabled={!videoEnabled || !videoTrack}
                />
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <DeviceSelect
                kind="audioinput"
                devices={devices.audioinput}
                activeDeviceId={audioDeviceId || audioTrack?.mediaStreamTrack?.getSettings?.()?.deviceId}
                onChange={setAudioDeviceId}
                disabled={!audioEnabled}
                microphoneLabel={t('prejoin.microphone')}
                cameraLabel={t('prejoin.camera')}
              />
              <DeviceSelect
                kind="videoinput"
                devices={devices.videoinput}
                activeDeviceId={videoDeviceId || videoTrack?.mediaStreamTrack?.getSettings?.()?.deviceId}
                onChange={setVideoDeviceId}
                disabled={!videoEnabled}
                microphoneLabel={t('prejoin.microphone')}
                cameraLabel={t('prejoin.camera')}
              />
            </div>
          </div>

          {/* Join form */}
          <form onSubmit={handleSubmit} className="flex flex-col justify-center space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pj-name">{t('prejoin.displayName')}</Label>
              <Input
                id="pj-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('prejoin.namePlaceholder')}
                autoFocus={!defaultName}
                required
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Globe className="h-3.5 w-3.5" />
                {t('prejoin.myLanguage')}
              </Label>
              <MeetingLanguagePicker
                value={selectedLanguage}
                onChange={handleLanguageChange}
                align="start"
              />
              <p className="text-xs text-muted-foreground">
                {t('prejoin.languageHint')}
              </p>
            </div>

            <Button
              type="submit"
              size="lg"
              className={branding ? brandButtonClassName('w-full border-0') : 'w-full'}
              disabled={!name.trim()}
            >
              {t('prejoin.joinMeeting')}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default PreJoinScreen;
