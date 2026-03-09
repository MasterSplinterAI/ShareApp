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
  const usePipMode = isFullScreen && isPanelOpen;

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

        if (import.meta.env.DEV) {
          console.log('📝 Transcription received:', { speaker: message.participant_id, partial: message.partial, orig: message.originalText?.slice(0, 40), text: message.text?.slice(0, 40) });
        }

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

  // Floating PIP mode when in full screen or during screen share
  if (usePipMode) {
    return (
      <div
        className="fixed bottom-20 right-4 w-96 max-h-80 bg-gray-900/90 backdrop-blur-md border border-gray-700 rounded-lg shadow-2xl z-[9999] flex flex-col"
        data-no-translate="true"
      >
        <PanelHeader onClose={togglePanel} compact />
        <PanelContent
          transcriptions={transcriptions}
          liveCaptions={liveCaptions}
          scrollRef={scrollRef}
          onScroll={handleScroll}
          selectedLanguage={selectedLanguage}
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
          selectedLanguage={selectedLanguage}
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
          selectedLanguage={selectedLanguage}
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

function getDominantAndSecondary(originalText, translations, selectedLanguage) {
  const translationEntries = Object.entries(translations || {});
  const hasTranslation = translationEntries.length > 0;

  if (!hasTranslation) {
    return { dominant: originalText, secondary: null, dominantLang: null, secondaryLang: null };
  }

  const matchingEntry = translationEntries.find(([lang]) => lang === selectedLanguage);

  if (matchingEntry) {
    return {
      dominant: matchingEntry[1],
      secondary: originalText,
      dominantLang: matchingEntry[0],
      secondaryLang: null,
    };
  }

  const firstEntry = translationEntries[0];
  return {
    dominant: originalText,
    secondary: firstEntry[1],
    dominantLang: null,
    secondaryLang: firstEntry[0],
  };
}

function TranscriptionBubble({ speaker, dominant, secondary, dominantLang, secondaryLang, timestamp, isLive = false, compact = false }) {
  return (
    <div className={`${compact ? 'pb-1.5' : 'pb-3'} ${!isLive ? 'border-b border-gray-700/50 last:border-b-0' : ''}`}>
      <div className="flex items-baseline gap-2 mb-1">
        <span className={`font-medium text-blue-400 ${compact ? 'text-xs' : 'text-xs'}`}>{speaker}</span>
        {isLive && <span className="text-xs text-gray-500">speaking...</span>}
        {!isLive && timestamp && (
          <span className="text-xs text-gray-500">
            {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {dominant && (
        <p className={`text-gray-100 break-words leading-relaxed bg-gray-800/50 rounded px-2.5 py-1.5 ${compact ? 'text-xs' : 'text-sm'} ${isLive ? 'opacity-80' : ''}`}>
          {dominant}
          {isLive && (
            <span className="inline-block w-1.5 h-4 bg-blue-400 ml-1 animate-pulse rounded-sm align-middle" />
          )}
        </p>
      )}

      {secondary && (
        <p className={`text-gray-400 break-words leading-relaxed mt-1 pl-2.5 ${compact ? 'text-[10px]' : 'text-xs'} ${isLive ? 'opacity-60' : 'opacity-70'}`}>
          {secondaryLang && (
            <span className="text-gray-500 mr-1">[{getLanguageLabel(secondaryLang)}]</span>
          )}
          {secondary}
          {isLive && (
            <span className="inline-block w-1 h-3 bg-gray-500 ml-1 animate-pulse rounded-sm align-middle" />
          )}
        </p>
      )}
    </div>
  );
}

function PanelContent({ transcriptions, liveCaptions, scrollRef, onScroll, selectedLanguage, compact = false }) {
  const hasContent = transcriptions.length > 0 || Object.keys(liveCaptions).length > 0;

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className={`flex-1 overflow-y-auto ${compact ? 'p-2 space-y-1.5' : 'p-4 space-y-3'}`}
    >
      {!hasContent && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <MessageSquare className="w-8 h-8 mb-3 opacity-50" />
          <p className={`text-center ${compact ? 'text-xs' : 'text-sm'}`}>Waiting for speech...</p>
        </div>
      )}

      {transcriptions.map((item) => {
        const { dominant, secondary, dominantLang, secondaryLang } = getDominantAndSecondary(
          item.originalText, item.translations, selectedLanguage
        );
        return (
          <TranscriptionBubble
            key={item.id}
            speaker={item.speaker}
            dominant={dominant}
            secondary={secondary}
            dominantLang={dominantLang}
            secondaryLang={secondaryLang}
            timestamp={item.timestamp}
            compact={compact}
          />
        );
      })}

      {Object.entries(liveCaptions).map(([speakerId, caption]) => {
        const { dominant, secondary, dominantLang, secondaryLang } = getDominantAndSecondary(
          caption.originalText, caption.translations, selectedLanguage
        );
        return (
          <TranscriptionBubble
            key={`live-${speakerId}`}
            speaker={speakerId}
            dominant={dominant}
            secondary={secondary}
            dominantLang={dominantLang}
            secondaryLang={secondaryLang}
            isLive
            compact={compact}
          />
        );
      })}
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
