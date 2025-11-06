'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function Home() {
  const router = useRouter();
  const [joinRoomId, setJoinRoomId] = useState('');
  const [joinPin, setJoinPin] = useState('');
  const [showJoinForm, setShowJoinForm] = useState(false);

  const handleHostMeeting = () => {
    router.push('/host');
  };

  const handleJoinMeeting = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinRoomId && joinPin) {
      // Normalize room ID to uppercase
      const normalizedRoomId = joinRoomId.trim().toUpperCase();
      const normalizedPin = joinPin.trim();
      router.push(`/room/${normalizedRoomId}?pin=${normalizedPin}`);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
            Conference App
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Host or join a meeting with screen sharing
          </p>
        </div>

        {!showJoinForm ? (
          <div className="space-y-4">
            <button
              onClick={handleHostMeeting}
              className="w-full flex justify-center py-4 px-6 border border-transparent rounded-lg shadow-sm text-lg font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
            >
              Host a Meeting
            </button>
            <button
              onClick={() => setShowJoinForm(true)}
              className="w-full flex justify-center py-4 px-6 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm text-lg font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
            >
              Join a Meeting
            </button>
          </div>
        ) : (
          <form onSubmit={handleJoinMeeting} className="space-y-4">
            <div>
              <label htmlFor="roomId" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Room ID
              </label>
              <input
                type="text"
                id="roomId"
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-800 dark:text-white"
                placeholder="Enter room ID"
                required
              />
            </div>
            <div>
              <label htmlFor="pin" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                PIN
              </label>
              <input
                type="text"
                id="pin"
                value={joinPin}
                onChange={(e) => setJoinPin(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-800 dark:text-white"
                placeholder="Enter PIN"
                maxLength={6}
                required
              />
            </div>
            <div className="flex space-x-4">
              <button
                type="button"
                onClick={() => {
                  setShowJoinForm(false);
                  setJoinRoomId('');
                  setJoinPin('');
                }}
                className="flex-1 py-3 px-4 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                className="flex-1 py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
              >
                Join
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
