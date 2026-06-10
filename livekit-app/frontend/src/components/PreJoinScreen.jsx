import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { usePreviewTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import {
  Mic, MicOff, Video, VideoOff, Globe, ChevronDown, Check, AlertCircle, Users,
} from 'lucide-react';
import { getMeetingLanguages, normalizeMeetingLanguageCode } from '../lib/languages';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

const MEETING_LANGUAGES = getMeetingLanguages();

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

function DeviceSelect({ kind, devices, activeDeviceId, onChange, disabled }) {
  const label = kind === 'audioinput' ? 'Microphone' : 'Camera';
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
  onJoin,
}) {
  const [name, setName] = useState(defaultName);
  const [selectedLanguage, setSelectedLanguage] = useState(() =>
    normalizeMeetingLanguageCode(defaultLanguage)
  );
  const [langOpen, setLangOpen] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioDeviceId, setAudioDeviceId] = useState('');
  const [videoDeviceId, setVideoDeviceId] = useState('');
  const [devices, setDevices] = useState({ audioinput: [], videoinput: [] });
  const [mediaError, setMediaError] = useState(null);

  const trackOptions = useMemo(
    () => ({
      audio: audioEnabled ? { deviceId: audioDeviceId || undefined } : false,
      video: videoEnabled ? { deviceId: videoDeviceId || undefined } : false,
    }),
    [audioEnabled, videoEnabled, audioDeviceId, videoDeviceId]
  );

  // Identity MUST be stable: usePreviewTracks re-runs (destroying and re-acquiring
  // the mic/camera) whenever this callback changes, which made the browser's
  // permission indicator flash on every render.
  const onMediaError = useCallback((err) => {
    console.warn('PreJoin media error:', err);
    setMediaError(err);
  }, []);

  const tracks = usePreviewTracks(trackOptions, onMediaError);

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

  const selectedLang =
    MEETING_LANGUAGES.find((l) => l.code === selectedLanguage) || MEETING_LANGUAGES[0];
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
    });
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/40 px-4 py-6" data-no-translate="true">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-border/70 bg-card shadow-lg">
        <div className="border-b border-border/60 px-4 py-4 text-center sm:px-6 sm:py-5">
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Ready to join?</h1>
          <p className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-sm text-muted-foreground">
            <span className="truncate">{roomName}</span>
            {participantCount !== null && participantCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                <Users className="h-3 w-3" />
                {participantCount} in meeting
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
                  aria-label={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
                  aria-pressed={!audioEnabled}
                  title={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
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
                  aria-label={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
                  aria-pressed={!videoEnabled}
                  title={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
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
                  Camera or microphone unavailable ({mediaError.name || 'permission denied'}). You
                  can still join — live captions need a working microphone.
                </span>
              </p>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <DeviceSelect
                kind="audioinput"
                devices={devices.audioinput}
                activeDeviceId={audioDeviceId || audioTrack?.mediaStreamTrack?.getSettings?.()?.deviceId}
                onChange={setAudioDeviceId}
                disabled={!audioEnabled}
              />
              <DeviceSelect
                kind="videoinput"
                devices={devices.videoinput}
                activeDeviceId={videoDeviceId || videoTrack?.mediaStreamTrack?.getSettings?.()?.deviceId}
                onChange={setVideoDeviceId}
                disabled={!videoEnabled}
              />
            </div>
          </div>

          {/* Join form */}
          <form onSubmit={handleSubmit} className="flex flex-col justify-center space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pj-name">Display name</Label>
              <Input
                id="pj-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoFocus={!defaultName}
                required
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Globe className="h-3.5 w-3.5" />
                My language (speak &amp; hear)
              </Label>
              <Popover open={langOpen} onOpenChange={setLangOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="w-full justify-between font-normal">
                    <span className="flex items-center gap-2">
                      <span>{selectedLang.flag}</span>
                      <span>{selectedLang.name}</span>
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <div className="max-h-[min(16rem,45dvh)] overflow-y-auto py-1">
                    {MEETING_LANGUAGES.map((language) => (
                      <button
                        key={language.code}
                        type="button"
                        onClick={() => {
                          setSelectedLanguage(language.code);
                          setLangOpen(false);
                        }}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                      >
                        <span className="flex items-center gap-2">
                          <span>{language.flag}</span>
                          <span>{language.name}</span>
                        </span>
                        {language.code === selectedLanguage && <Check className="h-4 w-4 text-primary" />}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">
                Captions and translations will appear in this language.
              </p>
            </div>

            <Button type="submit" size="lg" className="w-full" disabled={!name.trim()}>
              Join meeting
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default PreJoinScreen;
