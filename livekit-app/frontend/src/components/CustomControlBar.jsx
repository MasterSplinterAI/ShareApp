import { useState, useEffect, useRef } from 'react';
import { useLocalParticipant, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Mic, MicOff, Video, VideoOff, Monitor, Share2, PhoneOff, ChevronDown, MessageCircle, Users, Subtitles } from 'lucide-react';
import toast from 'react-hot-toast';
import LanguageSelector from './LanguageSelector';
import { useMeeting } from '../context/MeetingContext';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

const CAPTION_MODES = [
  { value: 'off', label: 'Captions off' },
  { value: 'transcription_only', label: 'Transcription only' },
  { value: 'transcription_translation', label: 'Transcription + Translation' },
];

const CAPTION_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'zh-CN', name: 'Mandarin' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ru', name: 'Russian' },
  { code: 'tiv', name: 'Tiv' },
];

function useIsCompact() {
  const [isCompact, setIsCompact] = useState(false);
  useEffect(() => {
    const check = () => setIsCompact(window.innerWidth < 640 || window.innerHeight < 500);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isCompact;
}

export default function CustomControlBar({
  selectedLanguage,
  setSelectedLanguage,
  translationEnabled,
  setTranslationEnabled,
  isHost,
  onShareClick,
  onDisconnect
}) {
  const localParticipantHook = useLocalParticipant();
  const localParticipant = localParticipantHook?.localParticipant;
  const tracks = useTracks([Track.Source.Camera, Track.Source.Microphone, Track.Source.ScreenShare], { onlySubscribed: false });
  const {
    sidePanelOpen,
    sidePanelTab,
    openSidePanel,
    closeSidePanel,
    unreadCount,
    roomName,
  } = useMeeting();
  const isCompact = useIsCompact();

  const [captionMode, setCaptionMode] = useState('transcription_translation');
  const [captionLanguages, setCaptionLanguages] = useState([selectedLanguage || 'en']);
  const [showCaptionMenu, setShowCaptionMenu] = useState(false);
  const captionMenuRef = useRef(null);

  const cameraTrack = tracks.find(track => track.participant?.identity === localParticipant?.identity && track.source === Track.Source.Camera);
  const micTrack = tracks.find(track => track.participant?.identity === localParticipant?.identity && track.source === Track.Source.Microphone);
  const screenShareTrack = tracks.find(track => track.participant?.identity === localParticipant?.identity && track.source === Track.Source.ScreenShare);

  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showMicMenu, setShowMicMenu] = useState(false);
  const [showCameraMenu, setShowCameraMenu] = useState(false);
  const [micDevices, setMicDevices] = useState([]);
  const [cameraDevices, setCameraDevices] = useState([]);
  const [selectedMicId, setSelectedMicId] = useState(null);
  const [selectedCameraId, setSelectedCameraId] = useState(null);

  const micMenuRef = useRef(null);
  const cameraMenuRef = useRef(null);

  // Sync state with tracks (TrackReference uses publication.track)
  useEffect(() => {
    const track = micTrack?.publication?.track ?? micTrack?.track;
    if (track) {
      setIsMicEnabled(!track.isMuted);
    } else if (localParticipant) {
      const micPub = localParticipant.getTrackPublication(Track.Source.Microphone);
      setIsMicEnabled(micPub ? !micPub.isMuted : true);
    }
  }, [micTrack?.publication?.track?.isMuted, micTrack?.track?.isMuted, localParticipant]);

  useEffect(() => {
    const track = cameraTrack?.publication?.track ?? cameraTrack?.track;
    if (track) {
      setIsCameraEnabled(track.isEnabled);
    } else if (localParticipant) {
      const camPub = localParticipant.getTrackPublication(Track.Source.Camera);
      setIsCameraEnabled(camPub ? camPub.isSubscribed && camPub.track?.isEnabled : true);
    }
  }, [cameraTrack?.publication?.track?.isEnabled, cameraTrack?.track?.isEnabled, localParticipant]);

  useEffect(() => {
    setIsScreenSharing(!!screenShareTrack?.publication?.track);
  }, [screenShareTrack]);

  const toggleMic = async (e) => {
    e?.stopPropagation();
    if (!localParticipant) return;
    try {
      const enabled = !isMicEnabled;
      // When re-enabling after a device switch, use the selected device
      if (enabled && selectedMicId) {
        await localParticipant.setMicrophoneEnabled(true, {
          deviceId: { exact: selectedMicId },
        });
      } else {
        await localParticipant.setMicrophoneEnabled(enabled);
      }
      setIsMicEnabled(enabled);
    } catch (error) {
      console.error('Error toggling microphone:', error);
    }
  };

  const toggleCamera = async (e) => {
    e?.stopPropagation();
    if (!localParticipant) return;
    try {
      const enabled = !isCameraEnabled;
      // When re-enabling after a device switch, use the selected device
      if (enabled && selectedCameraId) {
        await localParticipant.setCameraEnabled(true, {
          deviceId: { exact: selectedCameraId },
        });
      } else {
        await localParticipant.setCameraEnabled(enabled);
      }
      setIsCameraEnabled(enabled);
    } catch (error) {
      console.error('Error toggling camera:', error);
    }
  };

  const toggleScreenShare = async (e) => {
    e?.stopPropagation();
    if (!localParticipant) return;
    try {
      await localParticipant.setScreenShareEnabled(!isScreenSharing);
      setIsScreenSharing(!isScreenSharing);
    } catch (error) {
      if (error.name !== 'NotAllowedError' && error.name !== 'AbortError') {
        console.error('Error toggling screen share:', error);
        setIsScreenSharing(false);
      }
    }
  };

  // Get media devices
  useEffect(() => {
    const getDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setMicDevices(devices.filter(d => d.kind === 'audioinput'));
        setCameraDevices(devices.filter(d => d.kind === 'videoinput'));

        const micT = micTrack?.publication?.track ?? micTrack?.track;
        if (micT) {
          try {
            const settings = micT.mediaStreamTrack?.getSettings();
            if (settings?.deviceId) setSelectedMicId(settings.deviceId);
          } catch (e) {}
        }
        const camT = cameraTrack?.publication?.track ?? cameraTrack?.track;
        if (camT) {
          try {
            const settings = camT.mediaStreamTrack?.getSettings();
            if (settings?.deviceId) setSelectedCameraId(settings.deviceId);
          } catch (e) {}
        }
      } catch (error) {}
    };

    getDevices();
    const handleDeviceChange = () => getDevices();
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  }, [micTrack?.publication?.track, micTrack?.track, cameraTrack?.publication?.track, cameraTrack?.track]);

  const handleMicDeviceChange = async (deviceId) => {
    if (!localParticipant) return;
    try {
      // Use LiveKit's API with device constraints — it handles track
      // lifecycle internally so mute/unmute stays in sync
      await localParticipant.setMicrophoneEnabled(false);
      await localParticipant.setMicrophoneEnabled(true, {
        deviceId: { exact: deviceId },
      });
      setSelectedMicId(deviceId);
      setIsMicEnabled(true);
      setShowMicMenu(false);
    } catch (error) {
      console.error('Error changing microphone:', error);
    }
  };

  const handleCameraDeviceChange = async (deviceId) => {
    if (!localParticipant) return;
    try {
      await localParticipant.setCameraEnabled(false);
      await localParticipant.setCameraEnabled(true, {
        deviceId: { exact: deviceId },
      });
      setSelectedCameraId(deviceId);
      setIsCameraEnabled(true);
      setShowCameraMenu(false);
    } catch (error) {
      console.error('Error changing camera:', error);
    }
  };

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (micMenuRef.current && !micMenuRef.current.contains(event.target)) {
        setShowMicMenu(false);
      }
      if (cameraMenuRef.current && !cameraMenuRef.current.contains(event.target)) {
        setShowCameraMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close menus on orientation change
  useEffect(() => {
    const handleOrientationChange = () => {
      setShowMicMenu(false);
      setShowCameraMenu(false);
      setShowCaptionMenu(false);
    };
    window.addEventListener('orientationchange', handleOrientationChange);
    return () => window.removeEventListener('orientationchange', handleOrientationChange);
  }, []);

  // Close caption menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (captionMenuRef.current && !captionMenuRef.current.contains(e.target)) {
        setShowCaptionMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const publishCaptionConfig = async (mode, languages) => {
    if (!localParticipant) return;
    try {
      const payload = JSON.stringify({ type: 'caption_config', mode, languages });
      await localParticipant.publishData(
        new TextEncoder().encode(payload),
        { reliable: true, topic: 'caption_config' }
      );
    } catch (err) {
      console.error('Failed to publish caption config:', err);
    }

    if (roomName) {
      const apiBase = import.meta.env.VITE_API_URL || '/api';
      fetch(`${apiBase}/v2/rooms/${encodeURIComponent(roomName)}/caption-config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('v2_token') || ''}`,
        },
        body: JSON.stringify({ mode, languages }),
      }).catch(() => {});
    }
  };

  const handleCaptionModeChange = async (mode) => {
    setCaptionMode(mode);
    await publishCaptionConfig(mode, captionLanguages);
    setShowCaptionMenu(false);
    toast(mode === 'off' ? 'Captions disabled' : 'Caption mode updated');
  };

  const toggleCaptionLanguage = async (code) => {
    const next = captionLanguages.includes(code)
      ? captionLanguages.filter(c => c !== code)
      : [...captionLanguages, code];
    const langs = next.length > 0 ? next : [code];
    setCaptionLanguages(langs);
    await publishCaptionConfig(captionMode, langs);
  };

  const barBtn = (compact) =>
    cn(
      'rounded-full transition-transform duration-150 hover:-translate-y-0.5',
      compact ? 'h-11 w-11 shrink-0 px-0' : 'h-11 gap-2 px-5'
    );

  return (
    <div className={`w-full border-t meeting-control-strip border-border ${isCompact ? 'px-2 py-1.5' : 'px-4 py-3'} flex-shrink-0`}>
      <div className={`max-w-7xl mx-auto flex items-center justify-between ${isCompact ? 'gap-1' : 'gap-4'}`}>
        {/* Left side - Standard controls */}
        <div className={`flex items-center ${isCompact ? 'gap-1' : 'gap-2'}`}>
          {/* Microphone Toggle */}
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant={isMicEnabled ? 'success' : 'secondary'}
              onClick={toggleMic}
              className={cn(
                barBtn(isCompact),
                !isMicEnabled && 'border border-destructive/40 bg-destructive/15 text-destructive hover:bg-destructive/25'
              )}
              aria-label={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
            >
              {isMicEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
              {!isCompact && <span className="text-sm font-medium">Microphone</span>}
            </Button>

            {micDevices.length > 1 && !isCompact && (
              <div className="relative" ref={micMenuRef}>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMicMenu(!showMicMenu);
                  }}
                  aria-label="Select microphone device"
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${showMicMenu ? 'rotate-180' : ''}`} />
                </Button>

                {showMicMenu && (
                  <div className="absolute bottom-full left-0 z-[9999] mb-2 w-56 rounded-lg border border-border bg-popover shadow-xl">
                    <div className="p-2">
                      {micDevices.map((device) => (
                        <button
                          key={device.deviceId}
                          type="button"
                          onClick={() => handleMicDeviceChange(device.deviceId)}
                          className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition-colors hover:bg-accent ${
                            selectedMicId === device.deviceId ? 'bg-accent' : ''
                          }`}
                        >
                          <span className="truncate text-sm text-popover-foreground">{device.label || device.deviceId}</span>
                          {selectedMicId === device.deviceId && <span className="text-xs text-primary">✓</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Camera Toggle */}
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant={isCameraEnabled ? 'success' : 'secondary'}
              onClick={toggleCamera}
              className={cn(
                barBtn(isCompact),
                !isCameraEnabled && 'border border-destructive/40 bg-destructive/15 text-destructive hover:bg-destructive/25'
              )}
              aria-label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
            >
              {isCameraEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
              {!isCompact && <span className="text-sm font-medium">Camera</span>}
            </Button>

            {cameraDevices.length > 1 && !isCompact && (
              <div className="relative" ref={cameraMenuRef}>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowCameraMenu(!showCameraMenu);
                  }}
                  aria-label="Select camera device"
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${showCameraMenu ? 'rotate-180' : ''}`} />
                </Button>

                {showCameraMenu && (
                  <div className="absolute bottom-full left-0 z-[9999] mb-2 w-56 rounded-lg border border-border bg-popover shadow-xl">
                    <div className="p-2">
                      {cameraDevices.map((device) => (
                        <button
                          key={device.deviceId}
                          type="button"
                          onClick={() => handleCameraDeviceChange(device.deviceId)}
                          className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition-colors hover:bg-accent ${
                            selectedCameraId === device.deviceId ? 'bg-accent' : ''
                          }`}
                        >
                          <span className="truncate text-sm text-popover-foreground">{device.label || device.deviceId}</span>
                          {selectedCameraId === device.deviceId && <span className="text-xs text-primary">✓</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Screen Share - hidden in compact mode */}
          {!isCompact && (
            <Button
              type="button"
              variant={isScreenSharing ? 'success' : 'secondary'}
              onClick={toggleScreenShare}
              className={cn(
                barBtn(false),
                isScreenSharing && 'ring-2 ring-emerald-500/40',
                !isScreenSharing && 'text-foreground'
              )}
              aria-label={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
            >
              <Monitor className="h-5 w-5" />
              <span className="text-sm font-medium">{isScreenSharing ? 'Stop sharing' : 'Share screen'}</span>
            </Button>
          )}

          {/* Caption Config - host only, desktop only */}
          {isHost && !isCompact && (
            <div className="relative" ref={captionMenuRef}>
              <Button
                type="button"
                variant={captionMode !== 'off' ? 'success' : 'secondary'}
                onClick={() => setShowCaptionMenu(v => !v)}
                className={cn(barBtn(false), 'gap-1.5')}
                aria-label="Caption settings"
              >
                <Subtitles className="h-5 w-5" />
                <span className="text-sm font-medium">Captions</span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showCaptionMenu ? 'rotate-180' : ''}`} />
              </Button>

              {showCaptionMenu && (
                <div className="absolute bottom-full left-0 z-[9999] mb-2 w-64 rounded-lg border border-border bg-popover shadow-xl">
                  <div className="p-2">
                    <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mode</p>
                    {CAPTION_MODES.map(m => (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => handleCaptionModeChange(m.value)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
                          captionMode === m.value && 'bg-accent'
                        )}
                      >
                        <span className="text-popover-foreground">{m.label}</span>
                        {captionMode === m.value && <span className="text-xs text-primary">✓</span>}
                      </button>
                    ))}

                    {captionMode !== 'off' && (
                      <>
                        <div className="my-1.5 border-t border-border" />
                        <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Languages</p>
                        <div className="flex flex-wrap gap-1 px-2 pb-2">
                          {CAPTION_LANGUAGES.map(lang => (
                            <button
                              key={lang.code}
                              type="button"
                              onClick={() => toggleCaptionLanguage(lang.code)}
                              className={cn(
                                'rounded-full border px-2 py-0.5 text-xs transition-colors',
                                captionLanguages.includes(lang.code)
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-border bg-transparent text-popover-foreground hover:bg-accent'
                              )}
                            >
                              {lang.name}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right side - Language, panel toggle, share, leave */}
        <div className={`flex items-center ${isCompact ? 'gap-1' : 'gap-2'}`}>
          {/* Language Selector */}
          <LanguageSelector
            value={selectedLanguage}
            onChange={setSelectedLanguage}
            onTranslationToggle={() => {
              const next = !translationEnabled;
              setTranslationEnabled(next);
              // When enabling, open panel on Captions tab; when disabling, close panel.
              if (next) {
                openSidePanel('captions');
                toast.success('Captions enabled');
              } else {
                closeSidePanel();
                toast('Captions disabled');
              }
            }}
            translationEnabled={translationEnabled}
          />

          {/* Single side-panel toggle. Opens the panel on the Chat tab (and clears unread).
              In-panel tabs let users switch between Captions and Chat. */}
          <Button
            type="button"
            variant={sidePanelOpen && sidePanelTab === 'chat' ? 'success' : 'secondary'}
            onClick={() => {
              if (sidePanelOpen && sidePanelTab === 'chat') {
                closeSidePanel();
              } else {
                openSidePanel('chat');
              }
            }}
            className={cn(barBtn(isCompact), 'relative')}
            aria-label={sidePanelOpen && sidePanelTab === 'chat' ? 'Close chat' : 'Open chat'}
            title="Chat"
          >
            <MessageCircle className="h-5 w-5" />
            {!isCompact && <span className="text-sm font-medium">Chat</span>}
            {!(sidePanelOpen && sidePanelTab === 'chat') && unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </Button>

          {/* Share Button - Host Only */}
          {isHost && (
            <Button
              type="button"
              variant={sidePanelOpen && sidePanelTab === 'participants' ? 'success' : 'secondary'}
              onClick={() => {
                if (sidePanelOpen && sidePanelTab === 'participants') {
                  closeSidePanel();
                } else {
                  openSidePanel('participants');
                }
              }}
              className={barBtn(isCompact)}
              aria-label={sidePanelOpen && sidePanelTab === 'participants' ? 'Close participants' : 'Open participants'}
              title="Participants"
            >
              <Users className="h-5 w-5" />
              {!isCompact && <span className="text-sm font-medium">People</span>}
            </Button>
          )}

          {/* Share Link - Host Only */}
          {isHost && (
            <Button type="button" variant="secondary" onClick={onShareClick} className={barBtn(isCompact)} aria-label="Share meeting">
              <Share2 className="h-5 w-5" />
              {!isCompact && <span className="text-sm font-medium">Share</span>}
            </Button>
          )}

          {/* Leave Button */}
          <Button type="button" variant="destructive" onClick={onDisconnect} className={barBtn(isCompact)} aria-label="Leave meeting">
            <PhoneOff className="h-5 w-5" />
            {!isCompact && <span className="text-sm font-medium">Leave</span>}
          </Button>
        </div>
      </div>
    </div>
  );
}
