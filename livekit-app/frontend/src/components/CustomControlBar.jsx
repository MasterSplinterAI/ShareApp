import { useState, useEffect, useRef } from 'react';
import { useLocalParticipant, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Mic, MicOff, Video, VideoOff, Monitor, Share2, PhoneOff, ChevronDown } from 'lucide-react';
import LanguageSelector from './LanguageSelector';
import { VADSensitivityControls } from './MeetingRoom';

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

  // Sync state with tracks
  useEffect(() => {
    if (micTrack?.track) {
      setIsMicEnabled(!micTrack.track.isMuted);
    } else if (localParticipant) {
      const micPub = localParticipant.getTrackPublication(Track.Source.Microphone);
      setIsMicEnabled(micPub ? !micPub.isMuted : true);
    }
  }, [micTrack?.track?.isMuted, localParticipant]);

  useEffect(() => {
    if (cameraTrack?.track) {
      setIsCameraEnabled(cameraTrack.track.isEnabled);
    } else if (localParticipant) {
      const camPub = localParticipant.getTrackPublication(Track.Source.Camera);
      setIsCameraEnabled(camPub ? camPub.isSubscribed && camPub.track?.isEnabled : true);
    }
  }, [cameraTrack?.track?.isEnabled, localParticipant]);

  useEffect(() => {
    setIsScreenSharing(!!screenShareTrack?.track);
  }, [screenShareTrack]);

  const toggleMic = async (e) => {
    e?.stopPropagation();
    if (!localParticipant) {
      console.error('Local participant not available');
      return;
    }
    try {
      const enabled = !isMicEnabled;
      await localParticipant.setMicrophoneEnabled(enabled);
      setIsMicEnabled(enabled);
    } catch (error) {
      console.error('Error toggling microphone:', error);
    }
  };

  const toggleCamera = async (e) => {
    e?.stopPropagation();
    if (!localParticipant) {
      console.error('Local participant not available');
      return;
    }
    try {
      const enabled = !isCameraEnabled;
      await localParticipant.setCameraEnabled(enabled);
      setIsCameraEnabled(enabled);
    } catch (error) {
      console.error('Error toggling camera:', error);
    }
  };

  const toggleScreenShare = async (e) => {
    e?.stopPropagation();
    if (!localParticipant) {
      console.error('Local participant not available');
      return;
    }
    try {
      if (isScreenSharing) {
        await localParticipant.setScreenShareEnabled(false);
        setIsScreenSharing(false);
      } else {
        await localParticipant.setScreenShareEnabled(true);
        setIsScreenSharing(true);
      }
    } catch (error) {
      console.error('Error toggling screen share:', error);
      // User might have cancelled the screen share dialog
      if (error.name !== 'NotAllowedError' && error.name !== 'AbortError') {
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
        
        // Get current device IDs from tracks
        // useTracks returns track references, not publications
        if (micTrack?.track) {
          try {
            const mediaStreamTrack = micTrack.track.mediaStreamTrack;
            if (mediaStreamTrack) {
              const settings = mediaStreamTrack.getSettings();
              if (settings.deviceId) setSelectedMicId(settings.deviceId);
            }
          } catch (e) {
            // Track might not have mediaStreamTrack yet
          }
        }
        if (cameraTrack?.track) {
          try {
            const mediaStreamTrack = cameraTrack.track.mediaStreamTrack;
            if (mediaStreamTrack) {
              const settings = mediaStreamTrack.getSettings();
              if (settings.deviceId) setSelectedCameraId(settings.deviceId);
            }
          } catch (e) {
            // Track might not have mediaStreamTrack yet
          }
        }
      } catch (error) {
        // Silently fail - device enumeration might not be available
      }
    };
    
    getDevices();
    const handleDeviceChange = () => getDevices();
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  }, [micTrack?.track, cameraTrack?.track]);

  const handleMicDeviceChange = async (deviceId) => {
    if (!localParticipant) {
      console.error('Local participant not available');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId } });
      const audioTrack = stream.getAudioTracks()[0];
      await localParticipant.setMicrophoneEnabled(false);
      await localParticipant.setMicrophoneEnabled(true, audioTrack);
      setSelectedMicId(deviceId);
      setShowMicMenu(false);
    } catch (error) {
      console.error('Error changing microphone:', error);
    }
  };

  const handleCameraDeviceChange = async (deviceId) => {
    if (!localParticipant) {
      console.error('Local participant not available');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId } });
      const videoTrack = stream.getVideoTracks()[0];
      await localParticipant.setCameraEnabled(false);
      await localParticipant.setCameraEnabled(true, videoTrack);
      setSelectedCameraId(deviceId);
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

  // Close menus on orientation change to prevent UI issues
  useEffect(() => {
    const handleOrientationChange = () => {
      setShowMicMenu(false);
      setShowCameraMenu(false);
    };

    window.addEventListener('orientationchange', handleOrientationChange);
    return () => {
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, []);

  return (
    <div className="w-full bg-gray-900/95 backdrop-blur-sm border-t border-gray-700 px-4 py-3 flex-shrink-0">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
        {/* Left side - Standard controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Microphone Toggle */}
          <div className="flex items-center gap-1">
            <button
              onClick={toggleMic}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                isMicEnabled
                  ? 'bg-white/10 hover:bg-white/15 text-white'
                  : 'bg-red-500/20 hover:bg-red-500/30 text-red-400'
              }`}
              aria-label={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
            >
              {isMicEnabled ? (
                <Mic className="w-5 h-5" />
              ) : (
                <MicOff className="w-5 h-5" />
              )}
              <span className="text-sm font-medium hidden sm:inline">Microphone</span>
            </button>
            
            {/* Device Selector Toggle */}
            {micDevices.length > 1 && (
              <div className="relative" ref={micMenuRef}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMicMenu(!showMicMenu);
                  }}
                  className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/10 hover:bg-white/15 text-white transition-all"
                  aria-label="Select microphone device"
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${showMicMenu ? 'rotate-180' : ''}`} />
                </button>
                
                {/* Device Selection Dropdown */}
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
                          {selectedMicId === device.deviceId && (
                            <span className="text-green-400 text-xs">✓</span>
                          )}
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
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                isCameraEnabled
                  ? 'bg-white/10 hover:bg-white/15 text-white'
                  : 'bg-red-500/20 hover:bg-red-500/30 text-red-400'
              }`}
              aria-label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
            >
              {isCameraEnabled ? (
                <Video className="w-5 h-5" />
              ) : (
                <VideoOff className="w-5 h-5" />
              )}
              <span className="text-sm font-medium hidden sm:inline">Camera</span>
            </button>
            
            {/* Device Selector Toggle */}
            {cameraDevices.length > 1 && (
              <div className="relative" ref={cameraMenuRef}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowCameraMenu(!showCameraMenu);
                  }}
                  className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/10 hover:bg-white/15 text-white transition-all"
                  aria-label="Select camera device"
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${showCameraMenu ? 'rotate-180' : ''}`} />
                </button>
                
                {/* Device Selection Dropdown */}
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
                          {selectedCameraId === device.deviceId && (
                            <span className="text-green-400 text-xs">✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Screen Share */}
          <button
            onClick={toggleScreenShare}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
              isScreenSharing
                ? 'bg-blue-500/30 hover:bg-blue-500/40 text-blue-300'
                : 'bg-white/10 hover:bg-white/15 text-white'
            }`}
            aria-label="Share screen"
          >
            <Monitor className="w-5 h-5" />
            <span className="text-sm font-medium hidden sm:inline">Share screen</span>
          </button>

        </div>

        {/* Right side - Custom controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Language Selector */}
          <LanguageSelector
            value={selectedLanguage}
            onChange={setSelectedLanguage}
            onTranslationToggle={() => setTranslationEnabled(!translationEnabled)}
            translationEnabled={translationEnabled}
          />
          
          {/* VAD Sensitivity Controls - Host Only */}
          {isHost && (
            <div className="relative">
              <VADSensitivityControls />
            </div>
          )}
          
          {/* Share Button - Host Only */}
          {isHost && (
            <button
              onClick={onShareClick}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white transition-all"
              aria-label="Share meeting"
            >
              <Share2 className="w-5 h-5" />
              <span className="text-sm font-medium hidden sm:inline">Share</span>
            </button>
          )}

          {/* Leave Button */}
          <button
            onClick={onDisconnect}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-all"
            aria-label="Leave meeting"
          >
            <PhoneOff className="w-5 h-5" />
            <span className="text-sm font-medium hidden sm:inline">Leave</span>
          </button>
        </div>
      </div>
    </div>
  );
}
