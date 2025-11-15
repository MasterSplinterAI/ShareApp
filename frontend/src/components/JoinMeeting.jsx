import { useState } from 'react';
import { parseMeetingUrl } from '../utils/urlParser';
import { meetingService } from '../services/api';

const JoinMeeting = ({ isOpen, onClose, onJoin }) => {
  const [meetingInput, setMeetingInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let meetingId = meetingInput.trim();

      // Parse URL if provided
      if (meetingInput.includes('http') || meetingInput.includes('/join/') || meetingInput.includes('/host/')) {
        const parsed = parseMeetingUrl(meetingInput);
        if (parsed && parsed.meetingId) {
          meetingId = parsed.meetingId;
        } else {
          throw new Error('Invalid meeting link');
        }
      }

      if (!meetingId) {
        throw new Error('Please enter a meeting ID or link');
      }

      // Validate meeting exists
      const validation = await meetingService.validateMeeting(meetingId);
      
      if (!validation.valid || !validation.exists) {
        throw new Error('Meeting not found. Please check the meeting ID or link.');
      }

      onJoin(meetingId);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to join meeting');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <h2 className="text-2xl font-bold mb-4 text-gray-800">Join Meeting</h2>
        
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="meetingId" className="block text-sm font-medium text-gray-700 mb-2">
              Meeting Link or ID
            </label>
            <input
              type="text"
              id="meetingId"
              value={meetingInput}
              onChange={(e) => {
                setMeetingInput(e.target.value);
                setError('');
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter meeting link or ID"
              autoFocus
            />
            {error && (
              <p className="mt-1 text-sm text-red-600">{error}</p>
            )}
            <p className="mt-2 text-xs text-gray-500">
              You can paste a meeting link or enter the meeting ID directly
            </p>
          </div>
          
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? 'Joining...' : 'Join'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default JoinMeeting;

