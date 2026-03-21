import { useState, useEffect, useRef } from 'react';
import { useLocalParticipant, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Mic, MicOff, Video, VideoOff, Monitor, Share2, PhoneOff, ChevronDown, MessageSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import LanguageSelector from './LanguageSelector';
import { useMeeting } from '../context/MeetingContext';

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
  const { isPanelOpen, setIsPanelOpen, togglePanel } = useMeeting();
  const isCompact = useIsCompact();

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
    };
    window.addEventListener('orientationchange', handleOrientationChange);
    return () => window.removeEventListener('orientationchange', handleOrientationChange);
  }, []);

  return (
    <div className={`w-full bg-gray-900/95 backdrop-blur-sm border-t border-gray-700 ${isCompact ? 'px-2 py-1.5' : 'px-4 py-3'} flex-shrink-0`}>
      <div className={`max-w-7xl mx-auto flex items-center justify-between ${isCompact ? 'gap-1' : 'gap-4'}`}>
        {/* Left side - Standard controls */}
        <div className={`flex items-center ${isCompact ? 'gap-1' : 'gap-2'}`}>
          {/* Microphone Toggle */}
          <div className="flex items-center gap-1">
            <button
              onClick={toggleMic}
              className={`flex items-center gap-2 ${isCompact ? 'px-2' : 'px-4'} py-2 rounded-lg transition-all ${
                isMicEnabled
                  ? 'bg-white/10 hover:bg-white/15 text-white'
                  : 'bg-red-500/20 hover:bg-red-500/30 text-red-400'
              }`}
              aria-label={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
            >
              {isMicEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              {!isCompact && <span className="text-sm font-medium">Microphone</span>}
            </button>

            {micDevices.length > 1 && !isCompact && (
              <div className="relative" ref={micMenuRef}>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowMicMenu(!showMicMenu); }}
                  className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/10 hover:bg-white/15 text-white transition-all"
                  aria-label="Select microphone device"
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${showMicMenu ? 'rotate-180' : ''}`} />
                </button>

                {showMicMenu && (
                  <div className="absolute bottom-full left-0 mb-2 w-56 bg-gray-800 rounded-lg shadow-xl border border-gray-700 z-[9999]">
                    <div className="p-2">
                      {micDevices.map((device) => (
                        <button
                          key={device.deviceId}
                          onClick={() => handleMicDeviceChange(device.deviceId)}
                          className={`w-full text-left px-3 py-2 rounded-md hover:bg-gray-700 transition-colors flex items-center justify-between ${
                            selectedMicId === device.deviceId ? 'bg-gray-700' : ''
                          }`}
                        >
                          <span className="text-sm text-white truncate">{device.label || device.deviceId}</span>
                          {selectedMicId === device.deviceId && <span className="text-green-400 text-xs">✓</span>}
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
            <button
              onClick={toggleCamera}
              className={`flex items-center gap-2 ${isCompact ? 'px-2' : 'px-4'} py-2 rounded-lg transition-all ${
                isCameraEnabled
                  ? 'bg-white/10 hover:bg-white/15 text-white'
                  : 'bg-red-500/20 hover:bg-red-500/30 text-red-400'
              }`}
              aria-label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
            >
              {isCameraEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
              {!isCompact && <span className="text-sm font-medium">Camera</span>}
            </button>

            {cameraDevices.length > 1 && !isCompact && (
              <div className="relative" ref={cameraMenuRef}>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowCameraMenu(!showCameraMenu); }}
                  className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/10 hover:bg-white/15 text-white transition-all"
                  aria-label="Select camera device"
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${showCameraMenu ? 'rotate-180' : ''}`} />
                </button>

                {showCameraMenu && (
                  <div className="absolute bottom-full left-0 mb-2 w-56 bg-gray-800 rounded-lg shadow-xl border border-gray-700 z-[9999]">
                    <div className="p-2">
                      {cameraDevices.map((device) => (
                        <button
                          key={device.deviceId}
                          onClick={() => handleCameraDeviceChange(device.deviceId)}
                          className={`w-full text-left px-3 py-2 rounded-md hover:bg-gray-700 transition-colors flex items-center justify-between ${
                            selectedCameraId === device.deviceId ? 'bg-gray-700' : ''
                          }`}
                        >
                          <span className="text-sm text-white truncate">{device.label || device.deviceId}</span>
                          {selectedCameraId === device.deviceId && <span className="text-green-400 text-xs">✓</span>}
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
            <button
              onClick={toggleScreenShare}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                isScreenSharing
                  ? 'bg-blue-500/30 hover:bg-blue-500/40 text-blue-300'
                  : 'bg-white/10 hover:bg-white/15 text-white'
              }`}
              aria-label={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
            >
              <Monitor className="w-5 h-5" />
              <span className="text-sm font-medium">{isScreenSharing ? 'Stop sharing' : 'Share screen'}</span>
            </button>
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
              setIsPanelOpen(next); // Option D: when Captions ON, auto-open panel; when OFF, close
              if (next) {
                toast.success('Captions enabled');
              } else {
                toast('Captions disabled');
              }
            }}
            translationEnabled={translationEnabled}
          />

          {/* Show captions button - only when captions on but panel closed (Option D) */}
          {translationEnabled && !isPanelOpen && (
            <button
              onClick={togglePanel}
              className={`flex items-center gap-2 ${isCompact ? 'px-2' : 'px-4'} py-2 rounded-lg transition-all bg-white/10 hover:bg-white/15 text-white`}
              aria-label="Show captions"
              title="Show captions"
            >
              <MessageSquare className="w-5 h-5" />
              {!isCompact && <span className="text-sm font-medium">Show captions</span>}
            </button>
          )}

          {/* Share Button - Host Only */}
          {isHost && (
            <button
              onClick={onShareClick}
              className={`flex items-center gap-2 ${isCompact ? 'px-2' : 'px-4'} py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white transition-all`}
              aria-label="Share meeting"
            >
              <Share2 className="w-5 h-5" />
              {!isCompact && <span className="text-sm font-medium">Share</span>}
            </button>
          )}

          {/* Leave Button */}
          <button
            onClick={onDisconnect}
            className={`flex items-center gap-2 ${isCompact ? 'px-2' : 'px-4'} py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-all`}
            aria-label="Leave meeting"
          >
            <PhoneOff className="w-5 h-5" />
            {!isCompact && <span className="text-sm font-medium">Leave</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
