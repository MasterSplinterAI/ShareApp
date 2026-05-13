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
    const labels = {
      es: 'Spanish', fr: 'French', de: 'German', en: 'English', it: 'Italian', pt: 'Portuguese', ru: 'Russian',
      zh: 'Chinese', 'zh-CN': 'Mandarin Chinese', 'zh-TW': 'Chinese (Traditional)',
      ja: 'Japanese', ko: 'Korean', ar: 'Arabic', hi: 'Hindi', tiv: 'Tiv', 'es-CO': 'Colombian Spanish',
    };
    return labels[code] || code;
  };

  if (!showTranscriptions) {
    return (
      <button
        onClick={() => setShowTranscriptions(true)}
        className="fixed bottom-20 right-4 z-40 rounded-lg border border-border bg-card p-3 text-foreground shadow-lg transition-all hover:bg-muted"
        title="Show transcriptions"
      >
        <MessageSquare className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div
      data-no-translate="true"
      className={`notranslate fixed bottom-20 right-2 z-40 rounded-lg border border-border bg-card text-card-foreground shadow-xl transition-all sm:right-4 ${
        isMinimized ? 'w-56 sm:w-64' : 'w-[calc(100vw-1rem)] sm:w-[28rem] max-w-[28rem]'
      }`}
    >
      <div className="flex items-center justify-between rounded-t-lg bg-muted/50 px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium text-foreground">Live Transcriptions</h3>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setIsMinimized(!isMinimized)} className="text-muted-foreground transition-colors hover:text-foreground">
            {isMinimized ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
          </button>
          <button type="button" onClick={() => setShowTranscriptions(false)} className="text-muted-foreground transition-colors hover:text-foreground">
            <X className="h-4 w-4" />
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
                  <span className="text-xs font-medium text-primary">{speakerId}</span>
                  <span className="text-xs text-muted-foreground">Live...</span>
                </div>
                <div className="space-y-1">
                  {caption.originalText && (
                    <p className="break-words text-xs text-muted-foreground">{caption.originalText}</p>
                  )}
                  {hasTranslations && (
                    <div className="space-y-1">
                      {Object.entries(caption.translations).map(([lang, txt]) => (
                        <p
                          key={lang}
                          className="whitespace-normal break-words text-xs leading-relaxed text-emerald-900 sm:text-sm dark:text-emerald-200"
                        >
                          <span className="mr-1 text-xs text-muted-foreground">[{getLanguageLabel(lang)}]</span>
                          {txt}
                          <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-emerald-500">|</span>
                        </p>
                      ))}
                    </div>
                  )}
                  {!hasTranslations && caption.originalText && (
                    <p className="whitespace-normal break-words text-xs leading-relaxed text-foreground sm:text-sm">
                      {caption.originalText}
                      <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-primary">|</span>
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {transcriptions.length === 0 && Object.keys(liveCaptions).length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground sm:text-sm">Waiting for speech...</p>
          ) : (
            transcriptions.map((item) => (
              <div key={item.id} className="space-y-2 border-b border-border/60 pb-2 last:border-b-0 sm:pb-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium text-primary">{item.speaker}</span>
                  <span className="text-xs text-muted-foreground">{new Date(item.timestamp).toLocaleTimeString()}</span>
                </div>

                {item.originalText && (
                  <div className="space-y-1">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Original</span>
                    <p className="rounded bg-muted/50 px-2 py-1.5 text-xs leading-relaxed text-foreground break-words whitespace-normal sm:text-sm">
                      {item.originalText}
                    </p>
                  </div>
                )}

                {item.translations && Object.keys(item.translations).length > 0 && (
                  <div className="space-y-2">
                    {Object.entries(item.translations).map(([lang, txt]) => (
                      <div key={lang} className="space-y-1">
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">
                          {getLanguageLabel(lang)}
                        </span>
                        <p className="rounded border-l-2 border-emerald-500 bg-emerald-50 py-1.5 pl-2 text-xs leading-relaxed text-emerald-950 break-words whitespace-normal sm:text-sm dark:bg-emerald-950/30 dark:text-emerald-100">
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

      <div className="rounded-b-lg border-t border-border bg-muted/30 px-3 py-2 sm:px-4">
        <div className="flex items-center gap-2">
          <div className={`h-1.5 w-1.5 rounded-full ${isTranslationActive ? 'animate-pulse bg-emerald-500' : 'bg-muted-foreground/50'}`} />
          <span className="text-xs text-muted-foreground">
            {isTranslationActive ? 'Translating...' : 'Translation ready'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default TranscriptionDisplay;
