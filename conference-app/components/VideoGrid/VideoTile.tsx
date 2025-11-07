'use client';

import { useEffect, useRef, useState } from 'react';
import { Participant } from '@/lib/store/conference';

interface VideoTileProps {
  participant: Participant;
  stream: MediaStream;
  isLocal: boolean;
  isScreenShare: boolean;
  isFocused: boolean;
}

export default function VideoTile({
  participant,
  stream,
  isLocal,
  isScreenShare,
  isFocused,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [isPiPActive, setIsPiPActive] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!videoRef.current || !stream) return;

    videoRef.current.srcObject = stream;
    
    // Check if stream has video
    const videoTracks = stream.getVideoTracks();
    setHasVideo(videoTracks.length > 0 && videoTracks[0].enabled);

    // Listen for track changes
    const handleTrackChange = () => {
      const tracks = stream.getVideoTracks();
      setHasVideo(tracks.length > 0 && tracks[0].enabled);
    };

    stream.addEventListener('addtrack', handleTrackChange);
    stream.addEventListener('removetrack', handleTrackChange);

    return () => {
      stream.removeEventListener('addtrack', handleTrackChange);
      stream.removeEventListener('removetrack', handleTrackChange);
    };
  }, [stream]);

  // Update video state when participant media state changes
  useEffect(() => {
    if (!isScreenShare && participant.videoEnabled !== undefined) {
      setHasVideo(participant.videoEnabled);
    }
  }, [participant.videoEnabled, isScreenShare]);

  // Handle Picture-in-Picture
  const togglePiP = async () => {
    if (!videoRef.current) return;

    try {
      if (document.pictureInPictureElement === videoRef.current) {
        await document.exitPictureInPicture();
        setIsPiPActive(false);
      } else if (document.pictureInPictureEnabled) {
        await videoRef.current.requestPictureInPicture();
        setIsPiPActive(true);
      }
    } catch (error) {
      console.error('PiP error:', error);
    }
  };

  // Handle Fullscreen
  const toggleFullscreen = async () => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    const container = video.parentElement;

    // Check if already fullscreen
    const isCurrentlyFullscreen = !!(
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement
    );

    try {
      if (isCurrentlyFullscreen) {
        // Exit fullscreen
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        } else if ((document as any).mozCancelFullScreen) {
          await (document as any).mozCancelFullScreen();
        } else if ((document as any).msExitFullscreen) {
          await (document as any).msExitFullscreen();
        }
        setIsFullscreen(false);
      } else {
        // Enter fullscreen
        // For iOS/mobile, use webkitEnterFullscreen on the video element itself
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) && !(window as any).MSStream;
        const isMobile = window.innerWidth <= 768 || /Mobi|Android/i.test(navigator.userAgent);

        if (isIOS && (video as any).webkitEnterFullscreen) {
          // iOS Safari - use native video fullscreen
          (video as any).webkitEnterFullscreen();
          setIsFullscreen(true);
        } else if (isMobile && container) {
          // Mobile Android - try container fullscreen first
          if (container.requestFullscreen) {
            await container.requestFullscreen();
            setIsFullscreen(true);
          } else if ((container as any).webkitRequestFullscreen) {
            await (container as any).webkitRequestFullscreen();
            setIsFullscreen(true);
          } else if ((container as any).mozRequestFullScreen) {
            await (container as any).mozRequestFullScreen();
            setIsFullscreen(true);
          } else {
            // Fallback: make video take full viewport
            container.style.position = 'fixed';
            container.style.top = '0';
            container.style.left = '0';
            container.style.width = '100vw';
            container.style.height = '100vh';
            container.style.zIndex = '9999';
            container.style.backgroundColor = '#000';
            setIsFullscreen(true);
          }
        } else {
          // Desktop - use standard fullscreen
          if (container?.requestFullscreen) {
            await container.requestFullscreen();
            setIsFullscreen(true);
          } else if ((container as any)?.webkitRequestFullscreen) {
            await (container as any).webkitRequestFullscreen();
            setIsFullscreen(true);
          } else if ((container as any)?.mozRequestFullScreen) {
            await (container as any).mozRequestFullScreen();
            setIsFullscreen(true);
          } else if ((container as any)?.msRequestFullscreen) {
            await (container as any).msRequestFullscreen();
            setIsFullscreen(true);
          }
        }
      }
    } catch (error) {
      console.error('Fullscreen error:', error);
      // If all else fails, use CSS fallback
      if (!isCurrentlyFullscreen && container) {
        container.style.position = 'fixed';
        container.style.top = '0';
        container.style.left = '0';
        container.style.width = '100vw';
        container.style.height = '100vh';
        container.style.zIndex = '9999';
        container.style.backgroundColor = '#000';
        setIsFullscreen(true);
      }
    }
  };

  // Handle fullscreen events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  // Handle PiP events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnterPiP = () => setIsPiPActive(true);
    const handleLeavePiP = () => setIsPiPActive(false);

    video.addEventListener('enterpictureinpicture', handleEnterPiP);
    video.addEventListener('leavepictureinpicture', handleLeavePiP);

    return () => {
      video.removeEventListener('enterpictureinpicture', handleEnterPiP);
      video.removeEventListener('leavepictureinpicture', handleLeavePiP);
    };
  }, []);

  const getConnectionIcon = () => {
    switch (participant.connectionState) {
      case 'connecting':
        return (
          <svg className="animate-spin h-5 w-5 text-yellow-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        );
      case 'connected':
        return null;
      case 'failed':
      case 'disconnected':
        return (
          <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className={`
        relative bg-gray-800 rounded-lg overflow-hidden
        ${isFocused ? 'col-span-full row-span-full' : ''}
        ${isScreenShare ? 'bg-gray-700' : ''}
      `}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={`
          w-full h-full object-cover
          ${!hasVideo ? 'hidden' : ''}
          ${isLocal ? 'transform scale-x-[-1]' : ''}
        `}
      />

      {/* Placeholder when no video */}
      {!hasVideo && !isScreenShare && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
          <div className="w-24 h-24 bg-gray-700 rounded-full flex items-center justify-center">
            <svg className="w-12 h-12 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
      )}

      {/* Screen share placeholder */}
      {!hasVideo && isScreenShare && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-700">
          <svg className="w-16 h-16 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
      )}

      {/* Info overlay */}
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {/* Name/ID */}
            <span className="text-white text-sm font-medium truncate">
              {isLocal ? 'You' : participant.id}
              {isScreenShare && ' (Screen)'}
            </span>

            {/* Audio indicator */}
            {!participant.audioEnabled && !isScreenShare && (
              <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            )}
          </div>

          {/* Connection status */}
          {getConnectionIcon()}
        </div>
      </div>

      {/* Control buttons */}
      {hasVideo && (
        <div className="absolute top-2 right-2 flex gap-2">
          {/* Fullscreen button (especially important for screen shares on mobile) */}
          {!isLocal && (
            <button
              onClick={toggleFullscreen}
              className={`
                p-2 rounded-lg
                ${isFullscreen ? 'bg-blue-600' : 'bg-black/50 hover:bg-black/70'}
                text-white transition-colors
              `}
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              )}
            </button>
          )}
          
          {/* PiP button (for non-local videos on supported browsers) */}
          {!isLocal && document.pictureInPictureEnabled && (
            <button
              onClick={togglePiP}
              className={`
                p-2 rounded-lg
                ${isPiPActive ? 'bg-blue-600' : 'bg-black/50 hover:bg-black/70'}
                text-white transition-colors
              `}
              title={isPiPActive ? 'Exit Picture-in-Picture' : 'Picture-in-Picture'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Pin/Focus indicator */}
      {isFocused && (
        <div className="absolute top-2 left-2 p-1 bg-blue-600 rounded">
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
            <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
          </svg>
        </div>
      )}
    </div>
  );
}
