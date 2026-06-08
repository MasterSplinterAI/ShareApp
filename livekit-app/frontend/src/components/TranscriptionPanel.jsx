import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { MessageSquare, ChevronUp, ChevronDown } from 'lucide-react';
import { useRoomContext } from '@livekit/components-react';
import { useMeeting } from '../context/MeetingContext';
import { v2Meetings } from '../services/apiV2';
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

function mergeSttOverlap(base, addition) {
  const bw = base.split(/\s+/).filter(Boolean);
  const nw = addition.split(/\s+/).filter(Boolean);
  if (!bw.length) return addition.trim();
  if (!nw.length) return base.trim();
  let overlap = 0;
  for (let k = Math.min(bw.length, nw.length); k > 0; k -= 1) {
    if (bw.slice(-k).join(' ') === nw.slice(0, k).join(' ')) {
      overlap = k;
      break;
    }
  }
  if (overlap > 0) {
    return [...bw, ...nw.slice(overlap)].join(' ');
  }
  return `${base} ${addition}`.trim();
}

/** Stitch committed chunk finals with a cumulative open interim (mirrors agent transcript_assembler). */
function stitchCommittedAndOpen(committed, openText) {
  const c = (committed || '').trim();
  const o = (openText || '').trim();
  if (!c) return o;
  if (!o) return c;
  if (o.startsWith(c)) return o;

  const cw = c.split(/\s+/).filter(Boolean);
  const ow = o.split(/\s+/).filter(Boolean);
  if (!cw.length || !ow.length) return `${c} ${o}`.trim();

  if (cw.join(' ') === ow.slice(0, cw.length).join(' ')) return o;

  let common = 0;
  for (let i = 0; i < Math.min(cw.length, ow.length); i += 1) {
    if (cw[i] === ow[i]) common = i + 1;
    else break;
  }
  if (common >= 3 && ow.length >= cw.length) return o;

  let best = 0;
  const maxK = Math.min(cw.length, ow.length);
  for (let k = maxK; k > 0; k -= 1) {
    if (cw.slice(-k).join(' ') === ow.slice(0, k).join(' ')) {
      best = k;
      break;
    }
  }
  if (best > 0) return [...cw, ...ow.slice(best)].join(' ').trim();
  return `${c} ${o}`.trim();
}

function applyGladiaPartialText(previous, incoming) {
  const p = (previous || '').trim();
  const n = sanitizeCaptionText((incoming || '').trim());
  if (!n) return p;
  if (!p) return n;
  if (n === p) return p;
  if (n.startsWith(p) || wordPrefixMatch(p, n)) return n;
  if (p.startsWith(n) || wordPrefixMatch(n, p)) return p;
  // Gladia partials can revise earlier words (not strict prefix extensions) — take latest line.
  return n;
}

/**
 * Live partials for one turn: agent sends a full cumulative hypothesis each packet.
 * Do not concat when Deepgram revises earlier words (pickLiveCaptionText → mergeSttOverlap).
 */
function applyLivePartialText(previous, incoming) {
  const p = (previous || '').trim();
  const n = sanitizeCaptionText((incoming || '').trim());
  if (!n) return p;
  if (!p) return n;
  if (n === p) return p;
  if (n.startsWith(p) || wordPrefixMatch(p, n)) return n;
  if (p.startsWith(n) || wordPrefixMatch(n, p)) return p;
  const common = commonWordPrefixLen(p, n);
  if (common >= 2 && n.length >= p.length * 0.75) return n;
  if (common >= 2 && p.length > n.length) return p;
  // Non-prefix revision (common with Gladia partial model swaps) — prefer latest hypothesis.
  if (common < 2) return n;
  return sanitizeCaptionText(stitchCommittedAndOpen(p, n));
}

function normalizeCaptionWord(word) {
  return word.replace(/^[\s.,!?;:"'-]+|[\s.,!?;:"'-]+$/g, '').toLowerCase();
}

function wordPrefixMatch(shorter, longer) {
  const sw = shorter.trim().split(/\s+/).filter(Boolean);
  const lw = longer.trim().split(/\s+/).filter(Boolean);
  if (!sw.length || !lw.length || sw.length > lw.length) return false;
  for (let i = 0; i < sw.length; i += 1) {
    if (sw[i] === lw[i]) continue;
    const nw = normalizeCaptionWord(sw[i]);
    const nlw = normalizeCaptionWord(lw[i]);
    if (nw === nlw) continue;
    if (i === sw.length - 1 && (nlw.startsWith(nw) || nw.startsWith(nlw))) continue;
    return false;
  }
  return true;
}

function commonWordPrefixLen(a, b) {
  const aw = a.trim().split(/\s+/).filter(Boolean);
  const bw = b.trim().split(/\s+/).filter(Boolean);
  let n = 0;
  for (let i = 0; i < Math.min(aw.length, bw.length); i += 1) {
    if (aw[i] === bw[i]) {
      n = i + 1;
      continue;
    }
    if (normalizeCaptionWord(aw[i]) === normalizeCaptionWord(bw[i])) {
      n = i + 1;
      continue;
    }
    break;
  }
  return n;
}

function sanitizeCaptionText(text) {
  let words = (text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 6) return (text || '').trim();
  let changed = true;
  while (changed && words.length >= 6) {
    changed = false;
    for (let n = Math.min(16, Math.floor(words.length / 2)); n >= 3; n -= 1) {
      let i = 0;
      const out = [];
      while (i < words.length) {
        const a = words.slice(i, i + n).join(' ');
        const b = words.slice(i + n, i + 2 * n).join(' ');
        if (a && a === b) {
          out.push(...words.slice(i, i + n));
          i += 2 * n;
          changed = true;
        } else {
          out.push(words[i]);
          i += 1;
        }
      }
      if (changed) {
        words = out;
        break;
      }
    }
  }
  return words.join(' ');
}

/** Agent sends cumulative live lines — prefer prefix extensions, reject mid-string repeats. */
function pickLiveCaptionText(previous, incoming) {
  const prev = (previous || '').trim();
  const next = (incoming || '').trim();
  if (!next) return prev;
  if (!prev) return sanitizeCaptionText(next);
  if (next === prev) return prev;
  if (next.startsWith(prev) || wordPrefixMatch(prev, next)) {
    return sanitizeCaptionText(next);
  }
  if (prev.startsWith(next) || wordPrefixMatch(next, prev)) return prev;
  const common = commonWordPrefixLen(prev, next);
  if (common >= 3 && next.length >= prev.length) {
    return sanitizeCaptionText(next);
  }
  // Substring without prefix (e.g. "foo bar" inside "foo bar foo bar") — keep shorter line.
  if (next.includes(prev) && !next.startsWith(prev)) return prev;
  if (prev.includes(next) && !prev.startsWith(next)) return prev;
  return sanitizeCaptionText(mergeSttOverlap(prev, next));
}

/** Keep caption text monotonic without duplicating overlapping STT packets. */
function mergeCaptionText(previous, incoming) {
  return pickLiveCaptionText(previous, incoming);
}

/** Hide chunk-sized finals still part of an open live turn (common on mobile list view). */
function messagesForDisplay(messages) {
  const partials = messages.filter((m) => m.isPartial);
  if (!partials.length) return messages;

  const activeTurnIds = new Set(
    partials.map((p) => p.transcriptionId).filter((id) => id != null),
  );

  return messages.filter((m) => {
    if (m.isPartial) return true;
    if (m.transcriptionId != null && activeTurnIds.has(m.transcriptionId)) {
      return false;
    }
    return true;
  });
}

function buildTranscriptPayload(m, selectedLanguage) {
  const te = Object.entries(m.translations || {});
  let translated = null;
  if (te.length) {
    const hit = te.find(([k]) => k === selectedLanguage);
    translated = hit ? hit[1] : te[0][1];
  }
  if (translated && translated === m.originalText) translated = null;
  return {
    participant_identity: String(m.speaker || 'unknown').slice(0, 200),
    original_text: m.originalText || '',
    language: selectedLanguage || 'en',
    source_language: m.sourceLanguage || undefined,
    translated_text: translated || undefined,
    transcription_id: m.transcriptionId != null ? String(m.transcriptionId) : undefined,
    recorded_at: new Date(m.timestamp).toISOString(),
  };
}

function TranscriptionPanel() {
  const room = useRoomContext();
  const {
    isPanelOpen,
    togglePanel,
    isFullScreen,
    selectedLanguage,
    translationEnabled,
    roomName,
    meetingId,
    transcriptPersistEnabled,
    isHost,
  } = useMeeting();
  const usePipMode = isFullScreen && isPanelOpen;
  // Default to expanded on mobile: when captions open (incl. on join) show the
  // full bottom sheet, not just the compact bar. Minimizing collapses to the bar.
  const [mobileExpanded, setMobileExpanded] = useState(true);

  useEffect(() => {
    setMobileExpanded(isPanelOpen);
  }, [isPanelOpen]);

  // Unified flow: one bubble per speaker turn. Partials update in place;
  // the same bubble firms up when the final arrives. No separate live section.
  const [messages, setMessages] = useState([]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const desktopScrollRef = useRef(null);
  const mobileScrollRef = useRef(null);
  const pipScrollRef = useRef(null);
  const bottomAnchorRef = useRef(null);
  const isAtBottomRef = useRef(true);

  const getScrollEl = useCallback(() => {
    if (usePipMode) return pipScrollRef.current;
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches) {
      return desktopScrollRef.current;
    }
    return mobileScrollRef.current;
  }, [usePipMode]);
  const msgCounterRef = useRef(0);
  const sentMessageIdsRef = useRef(new Set());
  const persistFlushTimerRef = useRef(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const flushPersistedTranscript = useCallback(async () => {
    if (!meetingId || !transcriptPersistEnabled || !isHost || !room) return;
    const latest = messagesRef.current;
    const batch = latest.filter((m) => !m.isPartial && !sentMessageIdsRef.current.has(m.id));
    if (!batch.length) return;
    const paired = batch
      .map((m) => ({ m, line: buildTranscriptPayload(m, selectedLanguage) }))
      .filter(({ line }) => line.original_text && String(line.original_text).trim());
    if (!paired.length) return;
    const lines = paired.map(({ line }) => line);
    try {
      for (let i = 0; i < lines.length; i += 200) {
        const chunk = lines.slice(i, i + 200);
        await v2Meetings.appendTranscriptLines(meetingId, chunk);
      }
      paired.forEach(({ m }) => sentMessageIdsRef.current.add(m.id));
    } catch (e) {
      console.warn('Transcript persist failed:', e.response?.data || e.message);
    }
  }, [meetingId, transcriptPersistEnabled, isHost, room, selectedLanguage]);

  useEffect(() => {
    if (!meetingId || !transcriptPersistEnabled || !isHost || !room) {
      clearTimeout(persistFlushTimerRef.current);
      return undefined;
    }
    const latest = messagesRef.current;
    const pending = latest.filter((m) => !m.isPartial && !sentMessageIdsRef.current.has(m.id));
    if (!pending.length) return undefined;
    clearTimeout(persistFlushTimerRef.current);
    persistFlushTimerRef.current = setTimeout(() => {
      flushPersistedTranscript();
    }, 2200);
    return () => {
      clearTimeout(persistFlushTimerRef.current);
    };
  }, [messages, meetingId, transcriptPersistEnabled, isHost, room, flushPersistedTranscript]);

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

        const debugCaptions = import.meta.env.DEV
          || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1');
        if (debugCaptions) {
          console.log('📝 Transcription received:', {
            speaker: message.participant_id,
            partial: message.partial,
            sttProvider: message.sttProvider,
            origLen: message.originalText?.length ?? 0,
            orig: message.originalText?.slice(-80),
            textLen: message.text?.length ?? 0,
          });
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
            originalText: isTranslation ? originalText : (originalText || text),
            translations: isTranslation ? { [targetLang]: text } : {},
            sourceLanguage,
            timestamp: messageTimestamp,
            transcriptionId: transcriptionId ?? null,
            isPartial,
          };
        };

        const sttProvider = message.sttProvider || null;

        const applyPartialUpdate = (existing, isPartial) => {
          const incomingLine = originalText || text;
          const sameTurn =
            transcriptionId != null && existing.transcriptionId === transcriptionId;
          let mergedOriginal;
          if (sameTurn) {
            mergedOriginal = sttProvider === 'gladia'
              ? applyGladiaPartialText(existing.originalText, incomingLine)
              : applyLivePartialText(existing.originalText, incomingLine);
          } else {
            mergedOriginal = pickLiveCaptionText(existing.originalText, incomingLine);
          }
          return {
          ...existing,
          originalText: mergedOriginal,
          translations: isTranslation
            ? {
                ...existing.translations,
                ...(text && text.length >= (existing.translations[targetLang]?.length || 0)
                  ? { [targetLang]: mergeCaptionText(existing.translations[targetLang], text) }
                  : {}),
              }
            : existing.translations,
          sourceLanguage: existing.sourceLanguage || sourceLanguage,
          timestamp: messageTimestamp,
          transcriptionId: transcriptionId ?? existing.transcriptionId,
          isPartial,
        };
        };

        if (message.partial) {
          setMessages((prev) => {
            // Same bubble while this speaker's turn is still in progress.
            // Other speakers keep their own partials open — they finalize via their own
            // END_OF_SPEECH timer, so background noise on another mic can't truncate them.
            let idx = prev.findIndex(
              (m) =>
                m.isPartial &&
                ((transcriptionId != null && m.transcriptionId === transcriptionId) ||
                  m.speaker === speakerId),
            );
            if (idx < 0 && transcriptionId != null) {
              // Same turn was prematurely finalized (e.g. out-of-order packet) — reopen it.
              idx = prev.findIndex(
                (m) =>
                  !m.isPartial &&
                  m.speaker === speakerId &&
                  m.transcriptionId === transcriptionId,
              );
            }
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = applyPartialUpdate(prev[idx], true);
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
                originalText: pickLiveCaptionText(
                  existing.originalText,
                  isTranslation ? (originalText || existing.originalText) : (text || originalText || existing.originalText),
                ),
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

  const visibleMessages = useMemo(() => messagesForDisplay(messages), [messages]);

  const scrollToLatest = useCallback((force = false) => {
    if (!force && !isAtBottomRef.current) return;
    const el = getScrollEl();
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    isAtBottomRef.current = true;
    if (force) setIsAtBottom(true);
  }, [getScrollEl]);

  // React state updates (partials/finals) — layout effect runs before paint.
  useLayoutEffect(() => {
    if (!isAtBottomRef.current) return;
    scrollToLatest();
  }, [visibleMessages, scrollToLatest]);

  // MutationObserver catches in-place partial text growth between React renders.
  useEffect(() => {
    const el = getScrollEl();
    if (!el) return;

    const doScroll = () => {
      if (!isAtBottomRef.current) return;
      const target = getScrollEl();
      if (!target) return;
      requestAnimationFrame(() => {
        if (!isAtBottomRef.current) return;
        const active = getScrollEl();
        if (!active) return;
        active.scrollTop = active.scrollHeight;
      });
    };

    const mo = new MutationObserver(doScroll);
    mo.observe(el, { childList: true, subtree: true, characterData: true });

    const ro = new ResizeObserver(doScroll);
    ro.observe(el);

    return () => {
      mo.disconnect();
      ro.disconnect();
    };
  }, [isPanelOpen, mobileExpanded, usePipMode, getScrollEl]);

  // Track scroll position (event target is the visible panel's scroll container).
  const handleScroll = (e) => {
    const el = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  };

  const jumpToLatest = () => scrollToLatest(true);

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
    const filename = `Parley-Transcript-${dateStr}-${timeStr}.json`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const latestCaptionText = useMemo(() => {
    if (messages.length === 0) return null;
    const live = [...messages].reverse().find((m) => m.isPartial);
    const target = live || messages[messages.length - 1];
    const { dominant, pendingTranslation } = getDominantAndSecondary(
      target.originalText,
      target.translations,
      selectedLanguage,
      target.isPartial,
      target.sourceLanguage,
    );
    const line = pendingTranslation && !dominant ? 'Translating…' : dominant;
    return line ? `${target.speaker}: ${line}` : null;
  }, [messages, selectedLanguage]);

  // If captions are not enabled, don't show the panel at all
  if (!translationEnabled) return null;

  // Floating PIP mode when in full screen or during screen share
  if (usePipMode) {
    return (
      <div
        className="fixed bottom-20 right-4 w-96 max-h-80 border meeting-panel-surface backdrop-blur-md rounded-xl z-[9999] flex flex-col min-h-0"
        data-no-translate="true"
      >
        <PanelTabs onDownload={handleDownload} canDownload={finalMessages.length > 0} compact />
        <PanelContent
          messages={visibleMessages}
          scrollRef={pipScrollRef}
          bottomAnchorRef={bottomAnchorRef}
          onScroll={handleScroll}
          selectedLanguage={selectedLanguage}
          compact
        />
        {!isAtBottom && (
          <JumpToLatest onClick={jumpToLatest} />
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
        className="hidden sm:flex flex-col w-[350px] lg:w-[400px] meeting-panel-surface border-l border h-full min-h-0 flex-shrink-0"
        data-no-translate="true"
      >
        <PanelTabs onDownload={handleDownload} canDownload={finalMessages.length > 0} />
        <PanelContent
          messages={visibleMessages}
          scrollRef={desktopScrollRef}
          bottomAnchorRef={bottomAnchorRef}
          onScroll={handleScroll}
          selectedLanguage={selectedLanguage}
        />
        {!isAtBottom && (
          <JumpToLatest onClick={jumpToLatest} />
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
          className="sm:hidden fixed bottom-12 left-0 right-0 z-40 flex max-h-[45vh] w-full min-h-0 flex-shrink-0 flex-col rounded-t-xl border meeting-panel-surface"
          data-no-translate="true"
        >
          <PanelTabs
            onDownload={handleDownload}
            canDownload={finalMessages.length > 0}
            compact
            onMinimize={() => setMobileExpanded(false)}
          />
          <PanelContent
            messages={visibleMessages}
            scrollRef={mobileScrollRef}
            bottomAnchorRef={bottomAnchorRef}
            onScroll={handleScroll}
            selectedLanguage={selectedLanguage}
            compact
          />
          {!isAtBottom && (
            <JumpToLatest onClick={jumpToLatest} />
          )}
        </div>
      )}
    </>
  );
}

function getDominantAndSecondary(
  originalText,
  translations,
  selectedLanguage,
  isPartial = false,
  sourceLanguage = null,
) {
  const normalize = (l) => (typeof l === 'string' ? l.split('-')[0].toLowerCase() : l);
  const translationEntries = Object.entries(translations || {});
  const wantsTranslation = !!(
    selectedLanguage &&
    sourceLanguage &&
    normalize(selectedLanguage) !== normalize(sourceLanguage)
  );

  const matchingEntry = translationEntries.find(
    ([lang]) => normalize(lang) === normalize(selectedLanguage),
  );

  if (matchingEntry?.[1]?.trim()) {
    const translated = matchingEntry[1].trim();
    return {
      dominant: translated,
      secondary: originalText && originalText.trim() !== translated ? originalText : null,
      dominantLang: matchingEntry[0],
      secondaryLang: sourceLanguage,
      pendingTranslation: false,
    };
  }

  if (wantsTranslation) {
    return {
      dominant: null,
      secondary: originalText || null,
      dominantLang: selectedLanguage,
      secondaryLang: sourceLanguage,
      pendingTranslation: true,
    };
  }

  if (!translationEntries.length) {
    return {
      dominant: originalText,
      secondary: null,
      dominantLang: null,
      secondaryLang: null,
      pendingTranslation: false,
    };
  }

  const firstEntry = translationEntries[0];
  return {
    dominant: originalText,
    secondary: firstEntry[1],
    dominantLang: null,
    secondaryLang: firstEntry[0],
    pendingTranslation: false,
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
  pendingTranslation = false,
  compact = false,
}) {
  const showTranslating = pendingTranslation && !dominant;

  return (
    <div className={`${compact ? 'pb-1.5' : 'pb-3'} border-b border-border/60 last:border-b-0`}>
      <div className="flex items-baseline gap-2 mb-1">
        <span className={`font-medium text-primary ${compact ? 'text-xs' : 'text-xs'}`}>{speaker}</span>
        {isPartial ? (
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span className="inline-block w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
            {showTranslating ? 'translating' : 'live'}
          </span>
        ) : (
          timestamp && (
            <span className="text-xs text-muted-foreground">
              {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )
        )}
      </div>

      {showTranslating ? (
        <p
          className={`break-words leading-relaxed bg-muted/40 rounded px-2.5 py-1.5 ${compact ? 'text-xs' : 'text-sm'} text-foreground`}
        >
          {selectedLanguage && (
            <span className="text-muted-foreground mr-1">[{getLanguageLabel(selectedLanguage)}]</span>
          )}
          Translating…
          {isPartial && (
            <span className="inline-block w-1.5 h-4 bg-primary ml-1 animate-pulse rounded-sm align-middle" />
          )}
        </p>
      ) : dominant ? (
        <p
          className={`break-words leading-relaxed bg-muted/40 rounded px-2.5 py-1.5 ${compact ? 'text-xs' : 'text-sm'} text-foreground`}
        >
          {dominantLang && (
            <span className="text-muted-foreground mr-1">[{getLanguageLabel(dominantLang)}]</span>
          )}
          {dominant}
          {isPartial && (
            <span className="inline-block w-1.5 h-4 bg-primary ml-1 animate-pulse rounded-sm align-middle" />
          )}
        </p>
      ) : null}

      {secondary && (
        <p className={`text-muted-foreground break-words leading-relaxed mt-1 pl-2.5 ${compact ? 'text-[10px]' : 'text-xs'} opacity-70`}>
          {secondaryLang && (
            <span className="text-muted-foreground mr-1">[{getLanguageLabel(secondaryLang)}]</span>
          )}
          {secondary}
        </p>
      )}
    </div>
  );
}

function PanelContent({ messages, scrollRef, bottomAnchorRef, onScroll, selectedLanguage, compact = false }) {
  const hasContent = messages.length > 0;

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className={`flex-1 min-h-0 overflow-y-auto ${compact ? 'p-2 space-y-1.5' : 'p-4 space-y-3'}`}
    >
      {!hasContent && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <MessageSquare className="w-8 h-8 mb-3 opacity-50" />
          <p className={`text-center ${compact ? 'text-xs' : 'text-sm'}`}>Waiting for speech...</p>
        </div>
      )}

      {messages.map((item) => {
        const {
          dominant,
          secondary,
          dominantLang,
          secondaryLang,
          pendingTranslation,
        } = getDominantAndSecondary(
          item.originalText,
          item.translations,
          selectedLanguage,
          item.isPartial,
          item.sourceLanguage,
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
            pendingTranslation={pendingTranslation}
            compact={compact}
          />
        );
      })}
      <div ref={bottomAnchorRef} className="h-px w-full shrink-0" aria-hidden />
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
        className="w-full flex items-center gap-2 px-3 py-2 meeting-control-strip backdrop-blur-sm border-t border-border text-left"
      >
        <MessageSquare className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        {text ? (
          <span className="text-xs text-foreground truncate flex-1">{text}</span>
        ) : (
          <span className="text-xs text-muted-foreground truncate flex-1">
            {hasContent ? 'Tap to view captions' : 'Waiting for speech...'}
          </span>
        )}
        <ChevronUp className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
      </button>
    </div>
  );
}

function JumpToLatest({ onClick }) {
  return (
    <div className="flex justify-center py-1 border-t border-border/50">
      <button
        onClick={onClick}
        className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors px-3 py-1"
      >
        <ChevronDown className="w-3 h-3" />
        Jump to latest
      </button>
    </div>
  );
}

export default TranscriptionPanel;
