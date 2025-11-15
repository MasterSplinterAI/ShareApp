import { useState, useEffect } from 'react';
import { translationService, tokenService } from '../services/api';

const TranslationControls = ({ meetingId, onTranslationEnabled }) => {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!meetingId) return;
    
    let isMounted = true;
    
    // Check translation status on mount
    const checkStatus = async () => {
      try {
        const status = await translationService.getTranslationStatus(meetingId);
        if (isMounted) {
          setEnabled(status.active);
          if (onTranslationEnabled) {
            onTranslationEnabled(status.active);
          }
        }
      } catch (err) {
        // Silently fail - translation status check is optional
        if (isMounted) {
          console.error('Failed to check translation status:', err);
        }
      }
    };
    
    checkStatus();
    
    return () => {
      isMounted = false;
    };
  }, [meetingId]);

  const handleToggle = async () => {
    setLoading(true);
    setError(null);

    try {
      if (enabled) {
        // Stop translation
        await translationService.stopTranslation(meetingId);
        setEnabled(false);
        if (onTranslationEnabled) {
          onTranslationEnabled(false);
        }
      } else {
        // Start translation - get token for the translation agent
        // Use meetingId as roomName (they're the same in Daily.co)
        const token = await tokenService.getToken(meetingId, 'Translation Agent', false);
        await translationService.startTranslation(meetingId, token);
        setEnabled(true);
        if (onTranslationEnabled) {
          onTranslationEnabled(true);
        }
      }
    } catch (err) {
      console.error('Translation toggle error:', err);
      setError(err.response?.data?.error || err.response?.data?.details || 'Failed to toggle translation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Translation</span>
          <div className={`w-3 h-3 rounded-full ${enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
        </div>
        <button
          onClick={handleToggle}
          disabled={loading}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            enabled
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {loading ? '...' : enabled ? 'Disable' : 'Enable'}
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-600 mt-2">{error}</p>
      )}
    </div>
  );
};

export default TranslationControls;

