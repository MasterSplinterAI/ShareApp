import { useState, useEffect, useRef, useMemo } from 'react';
import { MessageSquare, ChevronUp, ChevronDown } from 'lucide-react';
import { useRoomContext } from '@livekit/components-react';
import { useMeeting } from '../context/MeetingContext';
import PanelTabs from './PanelTabs';

const LANGUAGE_LABELS = {
  en: 'English', es: 'Spanish', 'es-CO': 'Colombian Spanish',
  fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese',
  ru: 'Russian', zh: 'Chinese', 'zh-CN': 'Mandarin Chinese', 'zh-TW': 'Chinese (Traditional)',
  ja: 'Japanese', ko: 'Korean',
  ar: 'Arabic', hi: 'Hindi', tiv: 'Tiv',
};

function getLanguageLabel(code) {
  return LANGUAGE_LABELS[code] || code;
}

function TranscriptionPanel() {
  const room = useRoomContext();
  const { isPanelOpen, togglePanel, isFullScreen, selectedLanguage, translationEnabled, roomName } = useMeeting();
  const usePipMode = isFullScreen && isPanelOpen;
  const [mobileExpanded, setMobileExpanded] = useState(false);

  // Unified flow: one bubble per speaker turn. Partials update in place;
  // the same bubble firms up when the final arrives. No separate live section.
  const [messages, setMessages] = useState([]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const scrollRef = useRef(null);
  const msgCounterRef = useRef(0);

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
        const sourceLanguage = message.sourceLanguage || null;
        const originalText = message.originalText || message.text || '';
        const text = message.text || '';
        const transcriptionId = message.transcriptionId;
        // Only treat the packet as a translation when the agent explicitly says so
        // (source language differs from target language). Text differences driven by
        // STT interim/commit timing on same-language lanes are NOT translations.
        const normalizeLang = (l) => (typeof l === 'string' ? l.split('-')[0].toLowerCase() : l);
        const isTranslation = !!(
          sourceLanguage &&
          targetLang &&
          normalizeLang(sourceLanguage) !== normalizeLang(targetLang) &&
          originalText &&
          text &&
          originalText !== text
        );

        const buildNew = (isPartial) => {
          msgCounterRef.current += 1;
          return {
            id: `m${msgCounterRef.current}`,
            speaker: speakerId,
            originalText: isTranslation ? originalText : text,
            translations: isTranslation ? { [targetLang]: text } : {},
            sourceLanguage,
            timestamp: messageTimestamp,
            transcriptionId: transcriptionId ?? null,
            isPartial,
          };
        };

        if (message.partial) {
          setMessages((prev) => {
            // Same bubble while this speaker's turn is still in progress.
            const idx = prev.findIndex(
              (m) => m.speaker === speakerId && m.isPartial,
            );
            if (idx >= 0) {
              const existing = prev[idx];
              const next = [...prev];
              next[idx] = {
                ...existing,
                originalText: isTranslation
                  ? existing.originalText || originalText
                  : text || existing.originalText,
                translations: isTranslation
                  ? { ...existing.translations, [targetLang]: text }
                  : existing.translations,
                sourceLanguage: existing.sourceLanguage || sourceLanguage,
                timestamp: messageTimestamp,
                transcriptionId: transcriptionId ?? existing.transcriptionId,
              };
              return next;
            }
            return [...prev, buildNew(true)];
          });
        } else {
          setMessages((prev) => {
            // Prefer to finalize the speaker's in-progress bubble in place.
            let idx = -1;
            if (transcriptionId != null) {
              idx = prev.findIndex(
                (m) => m.isPartial && m.transcriptionId === transcriptionId,
              );
            }
            if (idx < 0) {
              idx = prev.findIndex(
                (m) => m.speaker === speakerId && m.isPartial,
              );
            }

            if (idx >= 0) {
              const existing = prev[idx];
              const newTranslations = { ...existing.translations };
              if (isTranslation) newTranslations[targetLang] = text;
              const next = [...prev];
              next[idx] = {
                ...existing,
                originalText: isTranslation
                  ? originalText || existing.originalText
                  : text || existing.originalText,
                translations: newTranslations,
                sourceLanguage: existing.sourceLanguage || sourceLanguage,
                timestamp: messageTimestamp,
                transcriptionId: transcriptionId ?? existing.transcriptionId,
                isPartial: false,
              };
              return next;
            }

            // Late-arriving translation for an already-finalized bubble.
            const finalIdx = prev.findIndex(
              (m) =>
                !m.isPartial &&
                m.speaker === speakerId &&
                m.originalText === originalText &&
                Math.abs(m.timestamp - messageTimestamp) < 3000,
            );
            if (finalIdx >= 0) {
              const existing = prev[finalIdx];
              const newTranslations = { ...existing.translations };
              if (isTranslation) newTranslations[targetLang] = text;
              const next = [...prev];
              next[finalIdx] = {
                ...existing,
                translations: newTranslations,
                sourceLanguage: existing.sourceLanguage || sourceLanguage,
              };
              return next;
            }

            return [...prev, buildNew(false)];
          });
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
  }, [messages, isAtBottom]);

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

  const finalMessages = useMemo(() => messages.filter((m) => !m.isPartial), [messages]);

  const handleDownload = () => {
    const exportData = finalMessages.map((t) => ({
      timestamp: new Date(t.timestamp).toISOString(),
      speaker: t.speaker,
      originalText: t.originalText,
      translations: t.translations || {},
      roomName: roomName || 'unknown',
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const filename = `ShareApp-Transcript-${dateStr}-${timeStr}.json`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const latestCaptionText = useMemo(() => {
    if (messages.length === 0) return null;
    const last = messages[messages.length - 1];
    const { dominant } = getDominantAndSecondary(last.originalText, last.translations, selectedLanguage);
    return dominant ? `${last.speaker}: ${dominant}` : null;
  }, [messages, selectedLanguage]);

  // If captions are not enabled, don't show the panel at all
  if (!translationEnabled) return null;

  // Floating PIP mode when in full screen or during screen share
  if (usePipMode) {
    return (
      <div
        className="fixed bottom-20 right-4 w-96 max-h-80 bg-gray-900/90 backdrop-blur-md border border-gray-700 rounded-lg shadow-2xl z-[9999] flex flex-col"
        data-no-translate="true"
      >
        <PanelTabs onDownload={handleDownload} canDownload={finalMessages.length > 0} compact />
        <PanelContent
          messages={messages}
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
        <PanelTabs onDownload={handleDownload} canDownload={finalMessages.length > 0} />
        <PanelContent
          messages={messages}
          scrollRef={scrollRef}
          onScroll={handleScroll}
          selectedLanguage={selectedLanguage}
        />
        {!isAtBottom && (
          <JumpToLatest onClick={scrollToBottom} />
        )}
      </div>

      {/* Mobile: collapsed caption bar or expanded bottom sheet */}
      {!mobileExpanded ? (
        <MobileCaptionBar
          text={latestCaptionText}
          onExpand={() => setMobileExpanded(true)}
          hasContent={messages.length > 0}
        />
      ) : (
        <div
          className="sm:hidden fixed bottom-12 left-0 right-0 bg-gray-900 border-t border-gray-700 rounded-t-xl z-40 flex flex-col"
          style={{ maxHeight: '45vh' }}
          data-no-translate="true"
        >
          <PanelTabs onDownload={handleDownload} canDownload={finalMessages.length > 0} compact />
          <PanelContent
            messages={messages}
            scrollRef={scrollRef}
            onScroll={handleScroll}
            selectedLanguage={selectedLanguage}
            compact
          />
          {!isAtBottom && (
            <JumpToLatest onClick={scrollToBottom} />
          )}
        </div>
      )}
    </>
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

function TranscriptionBubble({
  speaker,
  dominant,
  secondary,
  dominantLang,
  secondaryLang,
  sourceLanguage,
  selectedLanguage,
  timestamp,
  isPartial = false,
  compact = false,
}) {
  // If we're showing the speaker's original while the reader's selected language
  // has no translation yet, hint that a translation is still pending.
  const normalize = (l) => (typeof l === 'string' ? l.split('-')[0].toLowerCase() : l);
  const isPendingTranslation =
    isPartial &&
    !dominantLang &&
    selectedLanguage &&
    sourceLanguage &&
    normalize(sourceLanguage) !== normalize(selectedLanguage);

  return (
    <div className={`${compact ? 'pb-1.5' : 'pb-3'} border-b border-gray-700/50 last:border-b-0`}>
      <div className="flex items-baseline gap-2 mb-1">
        <span className={`font-medium text-blue-400 ${compact ? 'text-xs' : 'text-xs'}`}>{speaker}</span>
        {isPartial ? (
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-500">
            <span className="inline-block w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
            {isPendingTranslation ? 'translating' : 'live'}
          </span>
        ) : (
          timestamp && (
            <span className="text-xs text-gray-500">
              {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )
        )}
      </div>

      {dominant && (
        <p
          className={`break-words leading-relaxed bg-gray-800/50 rounded px-2.5 py-1.5 ${compact ? 'text-xs' : 'text-sm'} text-gray-100 ${
            isPendingTranslation ? 'italic text-gray-400' : ''
          }`}
        >
          {isPendingTranslation && sourceLanguage && (
            <span className="text-gray-500 not-italic mr-1">[{getLanguageLabel(sourceLanguage)}]</span>
          )}
          {dominant}
          {isPartial && (
            <span className="inline-block w-1.5 h-4 bg-blue-400 ml-1 animate-pulse rounded-sm align-middle" />
          )}
        </p>
      )}

      {secondary && (
        <p className={`text-gray-400 break-words leading-relaxed mt-1 pl-2.5 ${compact ? 'text-[10px]' : 'text-xs'} opacity-70`}>
          {secondaryLang && (
            <span className="text-gray-500 mr-1">[{getLanguageLabel(secondaryLang)}]</span>
          )}
          {secondary}
        </p>
      )}
    </div>
  );
}

function PanelContent({ messages, scrollRef, onScroll, selectedLanguage, compact = false }) {
  const hasContent = messages.length > 0;

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

      {messages.map((item) => {
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
            sourceLanguage={item.sourceLanguage}
            selectedLanguage={selectedLanguage}
            timestamp={item.timestamp}
            isPartial={item.isPartial}
            compact={compact}
          />
        );
      })}
    </div>
  );
}

function MobileCaptionBar({ text, onExpand, hasContent }) {
  return (
    <div
      className="sm:hidden fixed bottom-12 left-0 right-0 z-40"
      data-no-translate="true"
    >
      <button
        onClick={onExpand}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-800/95 backdrop-blur-sm border-t border-gray-700 text-left"
      >
        <MessageSquare className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
        {text ? (
          <span className="text-xs text-gray-200 truncate flex-1">{text}</span>
        ) : (
          <span className="text-xs text-gray-500 truncate flex-1">
            {hasContent ? 'Tap to view captions' : 'Waiting for speech...'}
          </span>
        )}
        <ChevronUp className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
      </button>
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
