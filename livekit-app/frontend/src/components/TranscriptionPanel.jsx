import { useState, useEffect, useRef } from 'react';
import { MessageSquare, X, ChevronDown, GripVertical } from 'lucide-react';
import { useRoomContext } from '@livekit/components-react';
import { useMeeting } from '../context/MeetingContext';

const LANGUAGE_LABELS = {
  en: 'English', es: 'Spanish', 'es-CO': 'Colombian Spanish',
  fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese',
  ru: 'Russian', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
  ar: 'Arabic', hi: 'Hindi', tiv: 'Tiv',
};

function getLanguageLabel(code) {
  return LANGUAGE_LABELS[code] || code;
}

function TranscriptionPanel() {
  const room = useRoomContext();
  const { isPanelOpen, togglePanel, isFullScreen, selectedLanguage, translationEnabled } = useMeeting();
  const [transcriptions, setTranscriptions] = useState([]);
  const [liveCaptions, setLiveCaptions] = useState({});
  const [isAtBottom, setIsAtBottom] = useState(true);
  const scrollRef = useRef(null);
  const transcriptionIdRef = useRef(0);

  // Listen for transcription data
  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (payload, participant, kind, topic) => {
      try {
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
          setLiveCaptions(prev => {
            const existing = prev[speakerId] || { originalText: '', translations: {}, timestamp: messageTimestamp, transcriptionId: null };
            const isTranslation = originalText && text && originalText !== text;
            return {
              ...prev,
              [speakerId]: {
                originalText: isTranslation ? originalText : (text || existing.originalText),
                translations: isTranslation
                  ? { ...existing.translations, [targetLang]: text }
                  : existing.translations,
                timestamp: messageTimestamp,
                transcriptionId: transcriptionId ?? existing.transcriptionId,
              }
            };
          });
        } else {
          // Final transcription
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
              timestamp: messageTimestamp,
              isFinal: true,
            }];
          });

          // Clear live caption after final
          const finalTranscriptionId = transcriptionId;
          setTimeout(() => {
            setLiveCaptions(prev => {
              const current = prev[speakerId];
              if (!current || (finalTranscriptionId && current.transcriptionId !== finalTranscriptionId)) {
                return prev;
              }
              const next = { ...prev };
              delete next[speakerId];
              return next;
            });
          }, 500);
        }
      } catch (error) {
        console.error('TranscriptionPanel: Error parsing data message:', error);
      }
    };

    room.on('dataReceived', handleDataReceived);
    return () => room.off('dataReceived', handleDataReceived);
  }, [room]);

  // Auto-scroll when at bottom
  useEffect(() => {
    if (isAtBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcriptions, liveCaptions, isAtBottom]);

  // Track scroll position
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setIsAtBottom(scrollHeight - scrollTop - clientHeight < 40);
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setIsAtBottom(true);
    }
  };

  // If translation is not enabled, don't show the panel at all
  if (!translationEnabled) return null;

  // Floating PIP mode when in full screen
  if (isFullScreen && isPanelOpen) {
    return (
      <div
        className="fixed bottom-4 right-4 w-80 max-h-64 bg-gray-900/90 backdrop-blur-md border border-gray-700 rounded-lg shadow-2xl z-[9999] flex flex-col"
        data-no-translate="true"
      >
        <PanelHeader onClose={togglePanel} compact />
        <PanelContent
          transcriptions={transcriptions}
          liveCaptions={liveCaptions}
          scrollRef={scrollRef}
          onScroll={handleScroll}
          compact
        />
        {!isAtBottom && (
          <JumpToLatest onClick={scrollToBottom} />
        )}
      </div>
    );
  }

  // Normal side panel (not full screen)
  if (!isPanelOpen) return null;

  return (
    <>
      {/* Desktop: right side panel */}
      <div
        className="hidden sm:flex flex-col w-[350px] lg:w-[400px] bg-gray-900 border-l border-gray-700 h-full flex-shrink-0"
        data-no-translate="true"
      >
        <PanelHeader onClose={togglePanel} />
        <PanelContent
          transcriptions={transcriptions}
          liveCaptions={liveCaptions}
          scrollRef={scrollRef}
          onScroll={handleScroll}
        />
        {!isAtBottom && (
          <JumpToLatest onClick={scrollToBottom} />
        )}
      </div>

      {/* Mobile: bottom sheet */}
      <div
        className="sm:hidden fixed bottom-16 left-0 right-0 bg-gray-900 border-t border-gray-700 rounded-t-xl z-40 flex flex-col"
        style={{ maxHeight: '50vh' }}
        data-no-translate="true"
      >
        <PanelHeader onClose={togglePanel} />
        <PanelContent
          transcriptions={transcriptions}
          liveCaptions={liveCaptions}
          scrollRef={scrollRef}
          onScroll={handleScroll}
        />
        {!isAtBottom && (
          <JumpToLatest onClick={scrollToBottom} />
        )}
      </div>
    </>
  );
}

function PanelHeader({ onClose, compact = false }) {
  return (
    <div className={`flex items-center justify-between ${compact ? 'px-3 py-2' : 'px-4 py-3'} bg-gray-800 border-b border-gray-700 flex-shrink-0 ${compact ? '' : 'rounded-t-xl sm:rounded-none'}`}>
      <div className="flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-blue-400" />
        <h3 className={`font-medium text-white ${compact ? 'text-xs' : 'text-sm'}`}>
          Live Transcriptions
        </h3>
      </div>
      <button
        onClick={onClose}
        className="text-gray-400 hover:text-white transition-colors p-1"
        aria-label="Close transcription panel"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function PanelContent({ transcriptions, liveCaptions, scrollRef, onScroll, compact = false }) {
  const hasContent = transcriptions.length > 0 || Object.keys(liveCaptions).length > 0;

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className={`flex-1 overflow-y-auto ${compact ? 'p-2 space-y-1.5' : 'p-4 space-y-3'}`}
    >
      {/* Live captions */}
      {Object.entries(liveCaptions).map(([speakerId, caption]) => {
        const hasTranslations = Object.keys(caption.translations || {}).length > 0;
        return (
          <div key={`live-${speakerId}`} className="space-y-1 opacity-75">
            <div className="flex items-baseline gap-2">
              <span className={`font-medium text-blue-400 ${compact ? 'text-xs' : 'text-xs'}`}>{speakerId}</span>
              <span className="text-xs text-gray-500">speaking...</span>
            </div>
            {caption.originalText && (
              <p className={`text-gray-300 break-words leading-relaxed ${compact ? 'text-xs' : 'text-sm'}`}>
                {caption.originalText}
                {!hasTranslations && (
                  <span className="inline-block w-1.5 h-4 bg-blue-400 ml-1 animate-pulse rounded-sm" />
                )}
              </p>
            )}
            {hasTranslations && (
              <div className="space-y-1">
                {Object.entries(caption.translations).map(([lang, txt]) => (
                  <p key={lang} className={`text-green-300 break-words leading-relaxed ${compact ? 'text-xs' : 'text-sm'}`}>
                    <span className="text-gray-500 text-xs mr-1">[{getLanguageLabel(lang)}]</span>
                    {txt}
                    <span className="inline-block w-1.5 h-4 bg-green-400 ml-1 animate-pulse rounded-sm" />
                  </p>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Final transcriptions */}
      {!hasContent ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <MessageSquare className="w-8 h-8 mb-3 opacity-50" />
          <p className={`text-center ${compact ? 'text-xs' : 'text-sm'}`}>Waiting for speech...</p>
        </div>
      ) : (
        transcriptions.map((item) => (
          <div key={item.id} className={`space-y-1.5 border-b border-gray-700/50 last:border-b-0 ${compact ? 'pb-1.5' : 'pb-3'}`}>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-blue-400">{item.speaker}</span>
              <span className="text-xs text-gray-500">
                {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {item.originalText && (
              <p className={`text-gray-300 break-words leading-relaxed bg-gray-800/50 rounded px-2 py-1.5 ${compact ? 'text-xs' : 'text-sm'}`}>
                {item.originalText}
              </p>
            )}

            {item.translations && Object.keys(item.translations).length > 0 && (
              <div className="space-y-1">
                {Object.entries(item.translations).map(([lang, txt]) => (
                  <div key={lang}>
                    <span className="text-xs text-gray-500 uppercase tracking-wide">
                      {getLanguageLabel(lang)}
                    </span>
                    <p className={`text-green-300 break-words leading-relaxed bg-green-900/20 rounded px-2 py-1.5 border-l-2 border-green-500 ${compact ? 'text-xs' : 'text-sm'}`}>
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
  );
}

function JumpToLatest({ onClick }) {
  return (
    <div className="flex justify-center py-1 border-t border-gray-700/50">
      <button
        onClick={onClick}
        className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors px-3 py-1"
      >
        <ChevronDown className="w-3 h-3" />
        Jump to latest
      </button>
    </div>
  );
}

export default TranscriptionPanel;
