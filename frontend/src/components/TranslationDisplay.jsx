import { useState, useEffect } from 'react';
import { translationService } from '../services/api';

/**
 * Component to display real-time translation transcriptions
 * Shows transcriptions from the translation agent
 */
const TranslationDisplay = ({ meetingId, participantId, enabled }) => {
  const [transcriptions, setTranscriptions] = useState([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!enabled || !meetingId || !participantId) return;

    // Poll for transcriptions from backend
    // In production, this would use WebSocket or Server-Sent Events
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
    }, 1000); // Poll every second

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
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {transcriptions.length === 0 ? (
              <p className="text-white/60 text-sm italic">
                Waiting for translation... Speak to see transcriptions.
              </p>
            ) : (
              transcriptions.map((transcription, index) => (
                <div key={index} className="text-white text-sm">
                  <span className="text-white/70 text-xs">
                    {transcription.speaker}: 
                  </span>
                  <span className="ml-2">{transcription.text}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TranslationDisplay;

