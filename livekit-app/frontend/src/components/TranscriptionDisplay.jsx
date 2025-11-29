import { useState, useEffect, useRef } from 'react';
import { MessageSquare, X, Minimize2, Maximize2 } from 'lucide-react';
import { useRoomContext } from '@livekit/components-react';
import { useTranslation } from '../hooks/useTranslation';

function TranscriptionDisplay({ participantId, isVisible = true }) {
  const room = useRoomContext();
  const { isTranslationActive } = useTranslation();
  const [transcriptions, setTranscriptions] = useState([]);
  const [liveCaptions, setLiveCaptions] = useState({}); // Live streaming captions per speaker
  const [isMinimized, setIsMinimized] = useState(false);
  const [showTranscriptions, setShowTranscriptions] = useState(isVisible);
  const scrollRef = useRef(null);
  const transcriptionIdRef = useRef(0);
  
  // Listen to LiveKit data channel for transcriptions
  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (payload, participant, kind, topic) => {
      try {
        if (topic !== 'transcription') return;
        
        const decoder = new TextDecoder();
        const message = JSON.parse(decoder.decode(payload));
        
        console.log('TranscriptionDisplay: Received data message:', message, 'participant:', participant?.identity);
        
        // Handle transcription messages
        if (message.type === 'transcription') {
          const speakerId = message.participant_id || participant?.identity || 'Unknown';
          const now = Date.now();
          const messageTimestamp = message.timestamp ? (message.timestamp * 1000) : now;
          
          if (message.partial) {
            // Partial/streaming update - update live caption in place
            setLiveCaptions(prev => ({
              ...prev,
              [speakerId]: {
                text: message.text || '',
                originalText: message.originalText || message.text || '',
                language: message.language || 'en',
                timestamp: messageTimestamp
              }
            }));
            console.log('TranscriptionDisplay: Updating live caption:', message.text);
          } else {
            // Final transcription - move to permanent chat history
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
                speaker: speakerId,
                text: message.text || '', // Translated text (target language)
                originalText: message.originalText || message.text || '', // Original text (source language)
                language: message.language || 'en',
                timestamp: messageTimestamp,
                hasTranslation: message.originalText && message.text && message.originalText !== message.text // True if actually translated
              };
              
              console.log('TranscriptionDisplay: Adding final transcription:', transcription);
              return [...prev, transcription];
            });
            
            // Clear live caption after a short delay
            setTimeout(() => {
              setLiveCaptions(prev => {
                const next = { ...prev };
                delete next[speakerId];
                return next;
              });
            }, 2000);
          }
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
  
  // Auto-scroll to bottom when new transcriptions or live captions arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcriptions, liveCaptions]);
  
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
      data-no-translate="true"
      className={`notranslate fixed bottom-20 right-2 sm:right-4 bg-gray-900 border border-gray-700 rounded-lg shadow-xl transition-all z-40 ${
        isMinimized ? 'w-56 sm:w-64' : 'w-[calc(100vw-1rem)] sm:w-[28rem] max-w-[28rem]'
      }`}
    >
      {/* Header */}
      <div className="bg-gray-800 px-3 sm:px-4 py-2.5 sm:py-3 rounded-t-lg flex items-center justify-between">
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
          className="max-h-[60vh] sm:max-h-96 overflow-y-auto p-3 sm:p-4 space-y-2 sm:space-y-3"
        >
          {/* Live streaming captions (grows word-by-word) */}
          {Object.entries(liveCaptions).map(([speakerId, caption]) => (
            <div key={`live-${speakerId}`} className="space-y-1 opacity-75">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-blue-400">
                  {speakerId}
                </span>
                <span className="text-xs text-gray-500">
                  Live...
                </span>
              </div>
              <p className="text-xs sm:text-sm text-gray-300 break-words whitespace-normal leading-relaxed">
                {caption.text}
                <span className="inline-block w-2 h-4 bg-blue-400 ml-1 animate-pulse">|</span>
              </p>
            </div>
          ))}
          
          {/* Permanent chat bubbles */}
          {transcriptions.length === 0 && Object.keys(liveCaptions).length === 0 ? (
            <p className="text-gray-500 text-xs sm:text-sm text-center py-8">
              Waiting for speech...
            </p>
          ) : (
            transcriptions.map((item) => (
              <div key={item.id} className="space-y-2 border-b border-gray-700/50 pb-2 sm:pb-3 last:border-b-0">
                {/* Speaker and timestamp */}
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium text-blue-400">
                    {item.speaker}
                  </span>
                  <span className="text-xs text-gray-500">
                    {new Date(item.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                
                {/* Original text (source language) - Always show */}
                {item.originalText && (
                  <div className="space-y-1">
                    <span className="text-xs text-gray-500 uppercase tracking-wide">Original</span>
                    <p className="text-xs sm:text-sm text-gray-300 break-words whitespace-normal bg-gray-800/50 rounded px-2 py-1.5 leading-relaxed">
                      {item.originalText}
                    </p>
                  </div>
                )}
                
                {/* Translated text (target language) - Show if different from original */}
                {item.hasTranslation && item.text && (
                  <div className="space-y-1">
                    <span className="text-xs text-gray-500 uppercase tracking-wide">Translated ({item.language})</span>
                    <p className="text-xs sm:text-sm text-green-300 break-words whitespace-normal bg-green-900/20 rounded px-2 py-1.5 border-l-2 border-green-500 pl-2 leading-relaxed">
                      {item.text}
                    </p>
                  </div>
                )}
                
                {/* If no translation (same language), just show the text */}
                {!item.hasTranslation && item.text && (
                  <p className="text-xs sm:text-sm text-gray-300 break-words whitespace-normal leading-relaxed">
                    {item.text}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      )}
      
      {/* Status */}
      <div className="px-3 sm:px-4 py-2 bg-gray-800/50 rounded-b-lg border-t border-gray-700/50">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${
            isTranslationActive ? 'bg-green-400 animate-pulse' : 'bg-gray-500'
          }`}></div>
          <span className="text-xs text-gray-400">
            {isTranslationActive ? 'Translating...' : 'Translation ready'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default TranscriptionDisplay;
