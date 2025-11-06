'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useConferenceStore } from '@/lib/store/conference';
import VideoGrid from '@/components/VideoGrid';
import Controls from '@/components/Controls';

export default function RoomPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const roomId = params.roomId as string;
  const pin = searchParams.get('pin');
  const isHost = searchParams.get('host') === 'true';
  
  const [isValidating, setIsValidating] = useState(true);
  const [error, setError] = useState('');
  const [roomInfo, setRoomInfo] = useState<any>(null);

  const {
    participants,
    localParticipant,
    isConnecting,
    isConnected,
    error: connectionError,
    initialize,
    disconnect,
  } = useConferenceStore();

  useEffect(() => {
    validateRoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, pin]);

  useEffect(() => {
    // Initialize conference after room validation
    if (roomInfo && !isConnected && !isConnecting) {
      initialize(roomId, pin!, roomInfo.isHost);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomInfo, isConnected, isConnecting]);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateRoom = async () => {
    if (!pin) {
      setError('PIN is required');
      setIsValidating(false);
      return;
    }

    try {
      const response = await fetch(`/api/rooms/${roomId}/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pin }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Invalid room or PIN');
      }

      const data = await response.json();
      setRoomInfo(data);
      setIsValidating(false);
    } catch (err: any) {
      setError(err.message);
      setIsValidating(false);
    }
  };

  const handleLeave = () => {
    disconnect();
    router.push('/');
  };

  if (isValidating) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-12 w-12 text-blue-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600 dark:text-gray-400">Validating room access...</p>
        </div>
      </div>
    );
  }

  if (error || connectionError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md text-center">
          <div className="text-red-600 dark:text-red-400 mb-4">
            <svg className="h-12 w-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            {error ? 'Access Denied' : 'Connection Error'}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">{error || connectionError}</p>
          <button
            onClick={() => router.push('/')}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (isConnecting) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-12 w-12 text-blue-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600 dark:text-gray-400">Connecting to conference...</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-900">
      <div className="h-screen flex flex-col">
        {/* Header */}
        <div className="bg-gray-800 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h1 className="text-white font-semibold">Room: {roomId}</h1>
            {roomInfo?.isHost && (
              <span className="px-2 py-1 bg-blue-600 text-white text-xs rounded">HOST</span>
            )}
          </div>
          <div className="text-gray-400 text-sm">
            {participants.size + 1} participant(s)
          </div>
        </div>

        {/* Video Grid */}
        <div className="flex-1 min-h-0">
          <VideoGrid 
            localParticipant={localParticipant} 
            participants={participants} 
          />
        </div>

        {/* Controls */}
        <Controls onLeave={handleLeave} />

        {/* Room Info (for hosts) */}
        {roomInfo?.isHost && (
          <div className="bg-gray-700 px-4 py-3 border-t border-gray-600">
            <div className="text-center text-sm">
              <p className="text-gray-300">
                Share this room: <span className="font-mono text-white">{roomId}</span>
              </p>
              <p className="text-gray-400">
                Participant PIN: <span className="font-mono text-white">{roomInfo.participantPin}</span>
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
