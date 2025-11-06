'use client';

import { useState } from 'react';
import { useConferenceStore } from '@/lib/store/conference';

interface ControlsProps {
  onLeave: () => void;
}

export default function Controls({ onLeave }: ControlsProps) {
  const {
    isAudioEnabled,
    isVideoEnabled,
    isScreenSharing,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    switchCamera,
  } = useConferenceStore();

  const [showMoreOptions, setShowMoreOptions] = useState(false);

  // Check if device has multiple cameras (mobile)
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  
  // Check for multiple cameras on mount
  if (typeof window !== 'undefined') {
    navigator.mediaDevices?.enumerateDevices().then(devices => {
      const cameras = devices.filter(device => device.kind === 'videoinput');
      setHasMultipleCameras(cameras.length > 1);
    });
  }

  return (
    <div className="bg-gray-800 border-t border-gray-700">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-center space-x-4">
          {/* Audio toggle */}
          <button
            onClick={toggleAudio}
            className={`
              p-3 rounded-full transition-colors
              ${isAudioEnabled 
                ? 'bg-gray-700 hover:bg-gray-600 text-white' 
                : 'bg-red-600 hover:bg-red-700 text-white'
              }
            `}
            title={isAudioEnabled ? 'Mute' : 'Unmute'}
          >
            {isAudioEnabled ? (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            )}
          </button>

          {/* Video toggle */}
          <button
            onClick={toggleVideo}
            className={`
              p-3 rounded-full transition-colors
              ${isVideoEnabled 
                ? 'bg-gray-700 hover:bg-gray-600 text-white' 
                : 'bg-red-600 hover:bg-red-700 text-white'
              }
            `}
            title={isVideoEnabled ? 'Stop Video' : 'Start Video'}
          >
            {isVideoEnabled ? (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364L5.636 5.636" />
              </svg>
            )}
          </button>

          {/* Screen share toggle */}
          <button
            onClick={toggleScreenShare}
            className={`
              p-3 rounded-full transition-colors
              ${isScreenSharing 
                ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                : 'bg-gray-700 hover:bg-gray-600 text-white'
              }
            `}
            title={isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </button>

          {/* More options (mobile) */}
          <div className="relative">
            <button
              onClick={() => setShowMoreOptions(!showMoreOptions)}
              className="p-3 bg-gray-700 hover:bg-gray-600 rounded-full text-white transition-colors md:hidden"
              title="More Options"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>

            {/* Dropdown menu */}
            {showMoreOptions && (
              <div className="absolute bottom-full right-0 mb-2 w-48 bg-gray-700 rounded-lg shadow-lg overflow-hidden">
                {hasMultipleCameras && (
                  <button
                    onClick={() => {
                      switchCamera();
                      setShowMoreOptions(false);
                    }}
                    className="w-full px-4 py-3 text-left text-white hover:bg-gray-600 transition-colors flex items-center space-x-3"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Switch Camera</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Switch camera (desktop) */}
          {hasMultipleCameras && (
            <button
              onClick={switchCamera}
              className="hidden md:block p-3 bg-gray-700 hover:bg-gray-600 rounded-full text-white transition-colors"
              title="Switch Camera"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}

          {/* Spacer */}
          <div className="w-px h-8 bg-gray-600 mx-2" />

          {/* Leave button */}
          <button
            onClick={onLeave}
            className="px-6 py-3 bg-red-600 hover:bg-red-700 rounded-full text-white font-medium transition-colors flex items-center space-x-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span className="hidden sm:inline">Leave</span>
          </button>
        </div>
      </div>
    </div>
  );
}
