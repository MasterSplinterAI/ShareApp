import { useState, useEffect, useRef } from 'react';
import { MessageSquare, X, Minimize2, Maximize2 } from 'lucide-react';
import { useRoomContext } from '@livekit/components-react';

function TranscriptionDisplay({ participantId, isVisible = true }) {
  const room = useRoomContext();
  const [transcriptions, setTranscriptions] = useState([]);
  const [isMinimized, setIsMinimized] = useState(false);
  const [showTranscriptions, setShowTranscriptions] = useState(isVisible);
  const scrollRef = useRef(null);
  const transcriptionIdRef = useRef(0);
  
  // Listen to LiveKit data channel for transcriptions
  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (payload, participant) => {
      try {
        const decoder = new TextDecoder();
        const message = JSON.parse(decoder.decode(payload));
        
        console.log('TranscriptionDisplay: Received data message:', message, 'participant:', participant?.identity);
        
        // Handle transcription messages
        if (message.type === 'transcription') {
          // Deduplicate: Check if we already have this exact transcription recently (within 2 seconds)
          const now = Date.now();
          const messageTimestamp = message.timestamp ? (message.timestamp * 1000) : now; // Convert seconds to ms if needed
          
          setTranscriptions(prev => {
            // Check for duplicates (same text, same originalText, within 2 seconds)
            const isDuplicate = prev.some(t => 
              t.text === message.text && 
              t.originalText === message.originalText &&
              Math.abs(t.timestamp - messageTimestamp) < 2000
            );
            
            if (isDuplicate) {
              console.log('TranscriptionDisplay: Skipping duplicate transcription:', message.text);
              return prev;
            }
            
            transcriptionIdRef.current += 1;
            const transcription = {
              id: transcriptionIdRef.current,
              speaker: participant?.identity || message.participant_id || 'Unknown',
              text: message.text || '', // Translated text (what user wants to see)
              originalText: message.originalText || message.text || '',
              language: message.language || 'en',
              timestamp: messageTimestamp,
              translated: message.originalText && message.text !== message.originalText ? message.originalText : undefined // Show original as reference
            };
            
            console.log('TranscriptionDisplay: Adding transcription:', transcription);
            return [...prev, transcription];
          });
        }
      } catch (error) {
        console.error('TranscriptionDisplay: Error parsing data message:', error, 'payload:', payload);
      }
    };

    room.on('dataReceived', handleDataReceived);

    return () => {
      room.off('dataReceived', handleDataReceived);
    };
  }, [room]);
  
  // Auto-scroll to bottom when new transcriptions arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcriptions]);
  
  if (!showTranscriptions) {
    return (
      <button
        onClick={() => setShowTranscriptions(true)}
        className="fixed bottom-20 right-4 bg-gray-800 hover:bg-gray-700 text-white p-3 rounded-lg shadow-lg transition-all z-40"
        title="Show transcriptions"
      >
        <MessageSquare className="w-5 h-5" />
      </button>
    );
  }
  
  return (
    <div 
      className={`fixed bottom-20 right-4 bg-gray-900 border border-gray-700 rounded-lg shadow-xl transition-all z-40 ${
        isMinimized ? 'w-64' : 'w-96'
      }`}
    >
      {/* Header */}
      <div className="bg-gray-800 px-4 py-3 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-medium text-white">Live Transcriptions</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="text-gray-400 hover:text-white transition-colors"
          >
            {isMinimized ? (
              <Maximize2 className="w-4 h-4" />
            ) : (
              <Minimize2 className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={() => setShowTranscriptions(false)}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      {/* Transcriptions */}
      {!isMinimized && (
        <div 
          ref={scrollRef}
          className="max-h-80 overflow-y-auto p-4 space-y-3"
        >
          {transcriptions.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">
              Waiting for speech...
            </p>
          ) : (
            transcriptions.map((item) => (
              <div key={item.id} className="space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium text-blue-400">
                    {item.speaker}
                  </span>
                  <span className="text-xs text-gray-500">
                    {new Date(item.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-sm text-gray-300">
                  {item.text}
                </p>
                {item.translated && (
                  <p className="text-sm text-gray-400 italic pl-4 border-l-2 border-gray-700">
                    {item.translated}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      )}
      
      {/* Status */}
      <div className="px-4 py-2 bg-gray-800 rounded-b-lg">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
          <span className="text-xs text-gray-400">Translation active</span>
        </div>
      </div>
    </div>
  );
}

export default TranscriptionDisplay;
