import { useState, useEffect } from 'react';
import { translationService } from '../services/api';

/**
 * Component to display real-time translation transcriptions
 * Shows transcriptions from the translation agent
 */
const TranslationDisplay = ({ meetingId, participantId, enabled }) => {
  const [transcriptions, setTranscriptions] = useState([]);
  const [isOpen, setIsOpen] = useState(true); // Open by default to show transcriptions

  useEffect(() => {
    if (!enabled || !meetingId || !participantId) return;

    // Poll for transcriptions from backend
    // TODO: Replace with WebSocket or Server-Sent Events for true real-time updates
    // Reduced to 200ms for near real-time feel (was 1000ms)
    const interval = setInterval(async () => {
      try {
        const data = await translationService.getTranscriptions(meetingId, participantId);
        if (data && data.transcriptions) {
          setTranscriptions(data.transcriptions);
        }
      } catch (error) {
        // Silently fail - transcriptions may not be available yet
        console.debug('Error fetching transcriptions:', error);
      }
    }, 200); // Poll every 200ms for near real-time updates

    return () => clearInterval(interval);
  }, [enabled, meetingId, participantId]);

  if (!enabled) return null;

  return (
    <div className="absolute bottom-20 left-4 right-4 z-30">
      <div className="bg-black/80 backdrop-blur-sm rounded-lg p-4 max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-white text-sm font-semibold">Live Translation</h3>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="text-white/70 hover:text-white transition-colors"
          >
            <svg 
              className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
        
        {isOpen && (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {transcriptions.length === 0 ? (
              <p className="text-white/60 text-sm italic">
                Waiting for translation... Speak to see transcriptions.
              </p>
            ) : (
              <div className="text-white text-sm">
                {/* Combine all transcriptions into a single readable text */}
                <span>{transcriptions.map(t => t.text).join('')}</span>
                {transcriptions.length > 0 && (
                  <span className="text-white/50 text-xs ml-2">
                    ({transcriptions.length} segments)
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TranslationDisplay;

