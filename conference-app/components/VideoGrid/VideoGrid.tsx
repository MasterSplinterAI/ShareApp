'use client';

import { useEffect, useRef } from 'react';
import { Participant } from '@/lib/store/conference';
import VideoTile from './VideoTile';

interface VideoGridProps {
  localParticipant: Participant | null;
  participants: Map<string, Participant>;
}

export default function VideoGrid({ localParticipant, participants }: VideoGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);

  // Calculate grid layout based on participant count
  const getGridLayout = () => {
    const totalParticipants = participants.size + (localParticipant ? 1 : 0);
    const hasScreenShare = localParticipant?.screenStream || 
      Array.from(participants.values()).some(p => p.screenStream);

    if (hasScreenShare) {
      // Screen share layout: large screen share + smaller video tiles
      return 'screen-share';
    }

    // Regular grid layouts
    if (totalParticipants <= 1) return 'single';
    if (totalParticipants <= 2) return 'duo';
    if (totalParticipants <= 4) return 'quad';
    if (totalParticipants <= 6) return 'six';
    if (totalParticipants <= 9) return 'nine';
    return 'many';
  };

  const layout = getGridLayout();

  // Get all video streams including screen shares
  const getAllStreams = () => {
    const streams: Array<{
      participant: Participant;
      isLocal: boolean;
      isScreenShare: boolean;
      stream: MediaStream;
    }> = [];

    // Add local participant streams
    if (localParticipant) {
      if (localParticipant.stream) {
        streams.push({
          participant: localParticipant,
          isLocal: true,
          isScreenShare: false,
          stream: localParticipant.stream,
        });
      }
      if (localParticipant.screenStream) {
        streams.push({
          participant: localParticipant,
          isLocal: true,
          isScreenShare: true,
          stream: localParticipant.screenStream,
        });
      }
    }

    // Add remote participant streams
    participants.forEach((participant) => {
      if (participant.stream) {
        streams.push({
          participant,
          isLocal: false,
          isScreenShare: false,
          stream: participant.stream,
        });
      }
      if (participant.screenStream) {
        streams.push({
          participant,
          isLocal: false,
          isScreenShare: true,
          stream: participant.screenStream,
        });
      }
    });

    return streams;
  };

  const allStreams = getAllStreams();
  const screenShares = allStreams.filter(s => s.isScreenShare);
  const videoStreams = allStreams.filter(s => !s.isScreenShare);

  return (
    <div ref={gridRef} className="h-full w-full bg-gray-900 p-2">
      {layout === 'screen-share' && screenShares.length > 0 ? (
        // Screen share layout
        <div className="h-full flex flex-col lg:flex-row gap-2">
          {/* Main screen share area */}
          <div className="flex-1 min-h-0">
            <div className="h-full grid gap-2">
              {screenShares.map((stream) => (
                <VideoTile
                  key={`${stream.participant.id}-screen`}
                  participant={stream.participant}
                  stream={stream.stream}
                  isLocal={stream.isLocal}
                  isScreenShare={true}
                  isFocused={true}
                />
              ))}
            </div>
          </div>
          
          {/* Side panel with video tiles */}
          {videoStreams.length > 0 && (
            <div className="h-32 lg:h-full lg:w-64 xl:w-80 overflow-y-auto">
              <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
                {videoStreams.map((stream) => (
                  <VideoTile
                    key={stream.participant.id}
                    participant={stream.participant}
                    stream={stream.stream}
                    isLocal={stream.isLocal}
                    isScreenShare={false}
                    isFocused={false}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        // Regular grid layout
        <div
          className={`
            h-full grid gap-2
            ${layout === 'single' ? 'grid-cols-1' : ''}
            ${layout === 'duo' ? 'grid-cols-1 md:grid-cols-2' : ''}
            ${layout === 'quad' ? 'grid-cols-2' : ''}
            ${layout === 'six' ? 'grid-cols-2 md:grid-cols-3' : ''}
            ${layout === 'nine' ? 'grid-cols-3' : ''}
            ${layout === 'many' ? 'grid-cols-3 md:grid-cols-4' : ''}
          `}
        >
          {videoStreams.map((stream) => (
            <VideoTile
              key={stream.participant.id}
              participant={stream.participant}
              stream={stream.stream}
              isLocal={stream.isLocal}
              isScreenShare={false}
              isFocused={layout === 'single'}
            />
          ))}
        </div>
      )}
    </div>
  );
}
