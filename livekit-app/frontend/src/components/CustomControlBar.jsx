import { useState, useEffect, useRef } from 'react';
import { useLocalParticipant, useRoomContext, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Mic, MicOff, Video, VideoOff, Monitor, Share2, PhoneOff, ChevronDown, MessageCircle, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import CaptionControls from './CaptionControls';
import MeetingPanelMenu from './MeetingPanelMenu';
import VideoEffectsPicker from './VideoEffectsPicker';
import { useMeeting } from '../context/MeetingContext';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { useRoomControlLabels } from '../hooks/useRoomControlLabels';
import {
  applyVideoEffect,
  isMobileViewport,
  loadSavedEffectId,
  saveEffectId,
  useVideoEffectsAvailable,
} from '../lib/videoEffects';

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
  intentionalLeaveRef,
  onNavigateAfterLeave,
  initialVideoEffectId = null,
}) {
  const room = useRoomContext();
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

  // --- Background effects (blur / virtual background) ---
  const effectsAvailable = useVideoEffectsAvailable();
  const [videoEffectId, setVideoEffectId] = useState(() => {
    if (isMobileViewport()) return 'none';
    return initialVideoEffectId ?? loadSavedEffectId();
  });

  // Apply to every camera track instance: LiveKit creates a NEW LocalVideoTrack on
  // camera re-enable and device switches, so this re-runs whenever the instance or
  // the chosen effect changes (covers initial join via the prejoin choice too).
  const camTrackInstance = cameraTrack?.publication?.track ?? cameraTrack?.track;
  useEffect(() => {
    if (!effectsAvailable || !camTrackInstance) return;
    applyVideoEffect(camTrackInstance, videoEffectId).catch((err) => {
      console.warn('Video effect failed:', err);
      toast.error('Could not apply background effect');
    });
  }, [camTrackInstance, videoEffectId, effectsAvailable]);

  useEffect(() => {
    if (effectsAvailable || !camTrackInstance) return;
    applyVideoEffect(camTrackInstance, 'none').catch((err) => {
      console.warn('Video effect clear failed:', err);
    });
  }, [camTrackInstance, effectsAvailable]);

  const handleEffectSelect = (id) => {
    setVideoEffectId(id);
    saveEffectId(id);
  };

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
    };
    window.addEventListener('orientationchange', handleOrientationChange);
    return () => window.removeEventListener('orientationchange', handleOrientationChange);
  }, []);

  const publishCaptionConfig = async (mode) => {
    if (!localParticipant) return;
    const languages = [];
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
    await publishCaptionConfig(mode);
    toast(mode === 'off' ? 'Captions disabled' : 'Caption mode updated');
  };

  const barBtn = (compact) =>
    cn(
      'rounded-full transition-transform duration-150 hover:-translate-y-0.5',
      compact ? 'h-11 w-11 shrink-0 px-0' : 'h-11 gap-2 px-5'
    );

  const t = useRoomControlLabels(selectedLanguage);

  return (
    <div className={`relative z-50 w-full border-t meeting-control-strip border-border ${isCompact ? 'px-2 py-1.5' : 'px-4 py-3'} flex-shrink-0`} data-no-translate="true">
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
              aria-pressed={!isMicEnabled}
              title={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
            >
              {isMicEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
              {!isCompact && <span className="text-sm font-medium">{t('microphone')}</span>}
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

          {/* Camera Toggle + settings/background menu */}
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
              aria-pressed={!isCameraEnabled}
              title={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
            >
              {isCameraEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
              {!isCompact && <span className="text-sm font-medium">{t('camera')}</span>}
            </Button>

            <div className="relative" ref={cameraMenuRef}>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className={cn('shrink-0 rounded-full', isCompact ? 'h-8 w-8' : 'h-9 w-9')}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowCameraMenu(!showCameraMenu);
                }}
                aria-label="Camera settings"
                aria-expanded={showCameraMenu}
              >
                <ChevronDown className={`${isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4'} transition-transform ${showCameraMenu ? 'rotate-180' : ''}`} />
              </Button>

              {showCameraMenu && (
                <div className="absolute bottom-full left-0 z-[9999] mb-2 w-72 rounded-lg border border-border bg-popover shadow-xl">
                    <div className="border-b border-border p-2">
                      <button
                        type="button"
                        onClick={toggleCamera}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                      >
                        {isCameraEnabled ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
                        <span>{isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}</span>
                      </button>
                    </div>

                    {cameraDevices.length > 1 && (
                      <div className="border-b border-border p-2">
                        <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Camera
                        </p>
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
                    )}

                    {effectsAvailable && (
                      <div className="p-3">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">Background</p>
                        <VideoEffectsPicker
                          activeEffectId={videoEffectId}
                          onSelect={handleEffectSelect}
                          disabled={!isCameraEnabled}
                          compact
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
          </div>

          {/* Screen Share - hidden in compact mode */}
          {!isCompact && (
            <Button
              type="button"
              variant={isScreenSharing ? 'success' : 'secondary'}
              onClick={toggleScreenShare}
              className={cn(
                barBtn(false),
                isScreenSharing && 'ring-2 ring-primary/40',
                !isScreenSharing && 'text-foreground'
              )}
              aria-label={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
              aria-pressed={isScreenSharing}
              title={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
            >
              <Monitor className="h-5 w-5" />
              <span className="text-sm font-medium">{isScreenSharing ? t('stopSharing') : t('shareScreen')}</span>
            </Button>
          )}
        </div>

        {/* Right side - Captions / panels, share, leave */}
        <div className={`flex items-center ${isCompact ? 'gap-1' : 'gap-2'}`}>
          {isCompact ? (
            <MeetingPanelMenu
              value={selectedLanguage}
              onChange={setSelectedLanguage}
              onTranslationToggle={() => {
                const next = !translationEnabled;
                setTranslationEnabled(next);
                if (next) {
                  openSidePanel('captions');
                  toast.success('Captions enabled');
                } else {
                  closeSidePanel();
                  toast('Captions disabled');
                }
              }}
              translationEnabled={translationEnabled}
              isHost={isHost}
              captionMode={captionMode}
              onCaptionModeChange={handleCaptionModeChange}
              barBtnClass={barBtn(isCompact)}
            />
          ) : (
            <>
              <CaptionControls
                value={selectedLanguage}
                onChange={setSelectedLanguage}
                onTranslationToggle={() => {
                  const next = !translationEnabled;
                  setTranslationEnabled(next);
                  if (next) {
                    openSidePanel('captions');
                    toast.success('Captions enabled');
                  } else {
                    closeSidePanel();
                    toast('Captions disabled');
                  }
                }}
                translationEnabled={translationEnabled}
                isHost={isHost}
                captionMode={captionMode}
                onCaptionModeChange={handleCaptionModeChange}
                barBtnClass={barBtn(false)}
              />

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
                className={cn(barBtn(false), 'relative')}
                aria-label={sidePanelOpen && sidePanelTab === 'chat' ? 'Close chat' : 'Open chat'}
                aria-pressed={sidePanelOpen && sidePanelTab === 'chat'}
                title="Chat"
              >
                <MessageCircle className="h-5 w-5" />
                <span className="text-sm font-medium">{t('chat')}</span>
                {!(sidePanelOpen && sidePanelTab === 'chat') && unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </Button>

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
                  className={barBtn(false)}
                  aria-label={sidePanelOpen && sidePanelTab === 'participants' ? 'Close participants' : 'Open participants'}
                  aria-pressed={sidePanelOpen && sidePanelTab === 'participants'}
                  title="Participants"
                >
                  <Users className="h-5 w-5" />
                  <span className="text-sm font-medium">{t('people')}</span>
                </Button>
              )}
            </>
          )}

          {/* Share Link - Host Only */}
          {isHost && (
            <Button type="button" variant="secondary" onClick={onShareClick} className={barBtn(isCompact)} aria-label="Share meeting" title="Share meeting">
              <Share2 className="h-5 w-5" />
              {!isCompact && <span className="text-sm font-medium">{t('share')}</span>}
            </Button>
          )}

          {/* Leave Button */}
          <Button
            type="button"
            variant="destructive"
            onClick={async () => {
              if (intentionalLeaveRef) intentionalLeaveRef.current = true;
              try {
                await room?.disconnect(true);
              } catch {
                onNavigateAfterLeave?.();
              }
            }}
            className={barBtn(isCompact)}
            aria-label="Leave meeting"
            title="Leave meeting"
          >
            <PhoneOff className="h-5 w-5" />
            {!isCompact && <span className="text-sm font-medium">{t('leave')}</span>}
          </Button>
        </div>
      </div>
    </div>
  );
}
