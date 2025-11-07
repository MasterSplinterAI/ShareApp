'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getApiUrl } from '@/lib/utils/api';

interface RoomData {
  roomId: string;
  hostPin: string;
  participantPin: string;
}

export default function HostPage() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const handleCreateRoom = async () => {
    setIsCreating(true);
    setError('');

    try {
      const response = await fetch(getApiUrl('/api/rooms'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to create room');
      }

      const data = await response.json();
      setRoomData(data);
      
      // Store host PIN in sessionStorage for auto-authentication
      sessionStorage.setItem(`hostPin_${data.roomId}`, data.hostPin);
      setIsCreating(false);
    } catch (err) {
      setError('Failed to create room. Please try again.');
      setIsCreating(false);
    }
  };

  const copyToClipboard = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const getParticipantLink = () => {
    if (!roomData) return '';
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    return `${baseUrl}/meet/room/${roomData.roomId}?pin=${roomData.participantPin}`;
  };

  const handleJoinRoom = () => {
    if (roomData) {
      router.push(`/room/${roomData.roomId}?pin=${roomData.hostPin}&host=true`);
    }
  };

  // Show room details modal if room was created
  if (roomData) {
    const participantLink = getParticipantLink();
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <div className="max-w-md w-full">
          <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md space-y-6">
            <div className="text-center">
              <div className="mb-4">
                <svg className="h-16 w-16 text-green-500 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                Room Created Successfully!
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Save these details to access your room later
              </p>
            </div>

            <div className="space-y-4">
              {/* Room ID */}
              <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
                  Room ID
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-lg text-gray-900 dark:text-white bg-white dark:bg-gray-800 px-3 py-2 rounded border">
                    {roomData.roomId}
                  </code>
                  <button
                    onClick={() => copyToClipboard(roomData.roomId, 'roomId')}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm"
                  >
                    {copied === 'roomId' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Host PIN */}
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border-2 border-blue-200 dark:border-blue-800">
                <label className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1 block">
                  Host PIN (Save this!)
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-lg text-blue-900 dark:text-blue-100 bg-white dark:bg-gray-800 px-3 py-2 rounded border border-blue-200 dark:border-blue-700">
                    {roomData.hostPin}
                  </code>
                  <button
                    onClick={() => copyToClipboard(roomData.hostPin, 'hostPin')}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm"
                  >
                    {copied === 'hostPin' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
                  Use this PIN to rejoin as host
                </p>
              </div>

              {/* Participant Link */}
              <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <label className="text-sm font-medium text-green-900 dark:text-green-100 mb-1 block">
                  Share Link (for participants)
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-xs text-green-900 dark:text-green-100 bg-white dark:bg-gray-800 px-3 py-2 rounded border border-green-200 dark:border-green-700 break-all">
                    {participantLink}
                  </code>
                  <button
                    onClick={() => copyToClipboard(participantLink, 'link')}
                    className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors text-sm whitespace-nowrap"
                  >
                    {copied === 'link' ? 'Copied!' : 'Copy Link'}
                  </button>
                </div>
                <p className="text-xs text-green-700 dark:text-green-300 mt-2">
                  Participant PIN: <span className="font-mono font-semibold">{roomData.participantPin}</span>
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleJoinRoom}
                className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Join Room
              </button>
              <button
                onClick={() => router.push('/')}
                className="px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Home
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Host a Meeting
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Create a new meeting room with secure PIN access
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md space-y-6">
          <div className="text-center space-y-4">
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <h3 className="text-lg font-medium text-blue-900 dark:text-blue-100 mb-2">
                How it works
              </h3>
              <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1 text-left">
                <li>• You&apos;ll get a unique Room ID</li>
                <li>• A Host PIN for admin controls</li>
                <li>• A Participant PIN for guests</li>
                <li>• Room stays active for 24 hours</li>
              </ul>
            </div>

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
              </div>
            )}

            <button
              onClick={handleCreateRoom}
              disabled={isCreating}
              className="w-full py-3 px-4 border border-transparent rounded-lg shadow-sm text-lg font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isCreating ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Creating Room...
                </span>
              ) : (
                'Create Room'
              )}
            </button>

            <button
              onClick={() => router.push('/')}
              className="w-full py-3 px-4 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
