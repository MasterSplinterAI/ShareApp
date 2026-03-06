import { useState, useEffect, useRef } from 'react';
import { MessageSquare, X, Minimize2, Maximize2 } from 'lucide-react';
import { useRoomContext } from '@livekit/components-react';
import { useTranslation } from '../hooks/useTranslation';

/**
 * TranscriptionDisplay - Chronological timeline with speaker labels.
 * Shows original + ALL translations (everyone sees all languages in the room).
 * iOS-dictation style: stream partials, update block on final.
 */
function TranscriptionDisplay({ participantId, selectedLanguage = 'en', isVisible = true }) {
  const room = useRoomContext();
  const { isTranslationActive } = useTranslation();
  const [transcriptions, setTranscriptions] = useState([]);
  const [liveCaptions, setLiveCaptions] = useState({});
  const [isMinimized, setIsMinimized] = useState(false);
  const [showTranscriptions, setShowTranscriptions] = useState(isVisible);
  const scrollRef = useRef(null);
  const transcriptionIdRef = useRef(0);

  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (payload, participant, kind, topic) => {
      try {
        // LiveKit passes (payload: Uint8Array, participant?, kind?, topic?)
        const raw = payload instanceof Uint8Array ? payload : (payload?.data ?? payload);
        if (!raw) return;
        const decoder = new TextDecoder();
        const message = JSON.parse(decoder.decode(raw));

        if (message.type !== 'transcription') return;
        if (topic != null && topic !== 'transcription') return;

        const speakerId = message.participant_id || participant?.identity || 'Unknown';
        const messageTimestamp = message.timestamp ? (message.timestamp * 1000) : Date.now();
        const targetLang = message.language || 'en';
        const originalText = message.originalText || message.text || '';
        const text = message.text || '';
        const transcriptionId = message.transcriptionId;

        if (message.partial) {
          if (import.meta.env.DEV) {
            console.log('📝 Partial received:', { speakerId, targetLang, text: text?.slice(0, 40), transcriptionId });
          }
          setLiveCaptions(prev => {
            const existing = prev[speakerId] || { originalText: '', translations: {}, timestamp: messageTimestamp, transcriptionId: null };
            const isTranslationPartial = originalText && text && originalText !== text;
            return {
              ...prev,
              [speakerId]: {
                originalText: isTranslationPartial ? originalText : (text || existing.originalText),
                translations: isTranslationPartial
                  ? { ...existing.translations, [targetLang]: text }
                  : existing.translations,
                timestamp: messageTimestamp,
                transcriptionId: transcriptionId ?? existing.transcriptionId
              }
            };
          });
        } else {
          setTranscriptions(prev => {
            const existingIdx = prev.findIndex(t =>
              t.speaker === speakerId &&
              t.originalText === originalText &&
              Math.abs(t.timestamp - messageTimestamp) < 3000
            );

            if (existingIdx >= 0) {
              const existing = prev[existingIdx];
              const newTranslations = { ...existing.translations };
              if (originalText && text && originalText !== text) {
                newTranslations[targetLang] = text;
              }
              const next = [...prev];
              next[existingIdx] = { ...existing, translations: newTranslations };
              return next;
            }

            transcriptionIdRef.current += 1;
            const translations = {};
            if (originalText && text && originalText !== text) {
              translations[targetLang] = text;
            }
            return [...prev, {
              id: transcriptionIdRef.current,
              speaker: speakerId,
              originalText,
              translations,
              timestamp: messageTimestamp
            }];
          });

          // Only clear live caption when this final's transcriptionId matches (avoid clearing a new partial)
          const finalTranscriptionId = transcriptionId;
          setTimeout(() => {
            setLiveCaptions(prev => {
              const current = prev[speakerId];
              if (!current || (finalTranscriptionId && current.transcriptionId !== finalTranscriptionId)) {
                return prev; // Don't clear - either gone or a new utterance started
              }
              const next = { ...prev };
              delete next[speakerId];
              return next;
            });
          }, 500);
        }
      } catch (error) {
        console.error('TranscriptionDisplay: Error parsing data message:', error);
      }
    };

    room.on('dataReceived', handleDataReceived);
    return () => room.off('dataReceived', handleDataReceived);
  }, [room]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcriptions, liveCaptions]);

  const getLanguageLabel = (code) => {
    const labels = { es: 'Spanish', fr: 'French', de: 'German', en: 'English', it: 'Italian', pt: 'Portuguese', ru: 'Russian', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic', hi: 'Hindi', tiv: 'Tiv', 'es-CO': 'Colombian Spanish' };
    return labels[code] || code;
  };

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
      <div className="bg-gray-800 px-3 sm:px-4 py-2.5 sm:py-3 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-medium text-white">Live Transcriptions</h3>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setIsMinimized(!isMinimized)} className="text-gray-400 hover:text-white transition-colors">
            {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
          </button>
          <button onClick={() => setShowTranscriptions(false)} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <div ref={scrollRef} className="max-h-[60vh] sm:max-h-96 overflow-y-auto p-3 sm:p-4 space-y-2 sm:space-y-3">
          {Object.entries(liveCaptions).map(([speakerId, caption]) => {
            const hasTranslations = Object.keys(caption.translations || {}).length > 0;
            return (
              <div key={`live-${speakerId}`} className="space-y-1 opacity-75">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium text-blue-400">{speakerId}</span>
                  <span className="text-xs text-gray-500">Live...</span>
                </div>
                <div className="space-y-1">
                  {caption.originalText && (
                    <p className="text-xs text-gray-500 break-words">{caption.originalText}</p>
                  )}
                  {hasTranslations && (
                    <div className="space-y-1">
                      {Object.entries(caption.translations).map(([lang, txt]) => (
                        <p key={lang} className="text-xs sm:text-sm text-green-300 break-words whitespace-normal leading-relaxed">
                          <span className="text-gray-500 text-xs mr-1">[{getLanguageLabel(lang)}]</span>
                          {txt}
                          <span className="inline-block w-2 h-4 bg-green-400 ml-1 animate-pulse">|</span>
                        </p>
                      ))}
                    </div>
                  )}
                  {!hasTranslations && caption.originalText && (
                    <p className="text-xs sm:text-sm text-gray-300 break-words whitespace-normal leading-relaxed">
                      {caption.originalText}
                      <span className="inline-block w-2 h-4 bg-blue-400 ml-1 animate-pulse">|</span>
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {transcriptions.length === 0 && Object.keys(liveCaptions).length === 0 ? (
            <p className="text-gray-500 text-xs sm:text-sm text-center py-8">Waiting for speech...</p>
          ) : (
            transcriptions.map((item) => (
              <div key={item.id} className="space-y-2 border-b border-gray-700/50 pb-2 sm:pb-3 last:border-b-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium text-blue-400">{item.speaker}</span>
                  <span className="text-xs text-gray-500">{new Date(item.timestamp).toLocaleTimeString()}</span>
                </div>

                {item.originalText && (
                  <div className="space-y-1">
                    <span className="text-xs text-gray-500 uppercase tracking-wide">Original</span>
                    <p className="text-xs sm:text-sm text-gray-300 break-words whitespace-normal bg-gray-800/50 rounded px-2 py-1.5 leading-relaxed">
                      {item.originalText}
                    </p>
                  </div>
                )}

                {item.translations && Object.keys(item.translations).length > 0 && (
                  <div className="space-y-2">
                    {Object.entries(item.translations).map(([lang, txt]) => (
                      <div key={lang} className="space-y-1">
                        <span className="text-xs text-gray-500 uppercase tracking-wide">
                          {getLanguageLabel(lang)}
                        </span>
                        <p className="text-xs sm:text-sm text-green-300 break-words whitespace-normal bg-green-900/20 rounded px-2 py-1.5 border-l-2 border-green-500 pl-2 leading-relaxed">
                          {txt}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      <div className="px-3 sm:px-4 py-2 bg-gray-800/50 rounded-b-lg border-t border-gray-700/50">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${isTranslationActive ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
          <span className="text-xs text-gray-400">
            {isTranslationActive ? 'Translating...' : 'Translation ready'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default TranscriptionDisplay;
