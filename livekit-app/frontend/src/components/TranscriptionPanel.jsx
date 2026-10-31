import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo } from 'react';
import { MessageSquare, ChevronUp, ChevronDown } from 'lucide-react';
import { useRoomContext } from '@livekit/components-react';
import { useMeeting } from '../context/MeetingContext';
import { v2Meetings } from '../services/apiV2';
import PanelTabs from './PanelTabs';
import { resolveSpeakerLabel, preferSpeakerLabel } from '../lib/participantDisplayName';

const SHARED_TEXT_DECODER = new TextDecoder();
const TIME_FORMATTER = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' });
const EMPTY_ARRAY = [];
const DEFAULT_DOM_WINDOW = 200;

function formatBubbleTime(ts) {
  if (!ts) return '';
  try {
    return TIME_FORMATTER.format(ts);
  } catch {
    return '';
  }
}

function useIsDesktopViewport() {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 640px)').matches : true
  );
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(min-width: 640px)');
    const onChange = (e) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return isDesktop;
}

const LANGUAGE_LABELS = {
  en: 'English', es: 'Spanish', 'es-DO': 'Dominican Spanish', 'es-CO': 'Colombian Spanish', 'es-MX': 'Mexican Spanish',
  fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese',
  ru: 'Russian', zh: 'Chinese', 'zh-CN': 'Mandarin Chinese', 'zh-TW': 'Chinese (Traditional)',
  ja: 'Japanese', ko: 'Korean',
  ar: 'Arabic', hi: 'Hindi', tiv: 'Tiv',
};

function getLanguageLabel(code) {
  return LANGUAGE_LABELS[code] || code;
}

function normalizeLangCode(code) {
  return typeof code === 'string' ? code.split('-')[0].toLowerCase() : code;
}

/** Demo-only: per-teammate translations when the guest speaks their language. */
function getTeammateCaptions(translations, demoTeammates, sourceLanguage) {
  if (!demoTeammates?.length || !translations) return [];
  const sourceNorm = sourceLanguage ? normalizeLangCode(sourceLanguage) : null;
  return demoTeammates
    .map(({ name, lang }) => {
      const norm = normalizeLangCode(lang);
      const entry = Object.entries(translations).find(([k]) => normalizeLangCode(k) === norm);
      const text = entry?.[1]?.trim();
      if (!text) return null;
      if (sourceNorm && norm === sourceNorm) return null;
      return { name, lang, text };
    })
    .filter(Boolean);
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

let _lastSanitizeIn = '';
let _lastSanitizeOut = '';

function wordsMatchAt(words, i, n) {
  for (let k = 0; k < n; k += 1) {
    if (words[i + k] !== words[i + n + k]) return false;
  }
  return true;
}

function sanitizeCaptionText(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';
  if (trimmed === _lastSanitizeIn) return _lastSanitizeOut;

  const allWords = trimmed.split(/\s+/).filter(Boolean);
  if (allWords.length < 6) {
    _lastSanitizeIn = trimmed;
    _lastSanitizeOut = trimmed;
    return trimmed;
  }

  // Only inspect the trailing 48 words where streaming STT stutters can occur;
  // keeps per-packet cost O(1) even on long monologues.
  const headCount = Math.max(0, allWords.length - 48);
  const head = headCount > 0 ? allWords.slice(0, headCount) : [];
  let words = headCount > 0 ? allWords.slice(headCount) : allWords;

  let changed = true;
  while (changed && words.length >= 6) {
    changed = false;
    for (let n = Math.min(16, Math.floor(words.length / 2)); n >= 3; n -= 1) {
      let i = 0;
      const out = [];
      while (i < words.length) {
        if (i + 2 * n <= words.length && wordsMatchAt(words, i, n)) {
          for (let k = 0; k < n; k += 1) out.push(words[i + k]);
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
  const result = head.length ? [...head, ...words].join(' ') : words.join(' ');
  _lastSanitizeIn = trimmed;
  _lastSanitizeOut = result;
  return result;
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
  let hasPartials = false;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].isPartial) {
      hasPartials = true;
      break;
    }
  }
  if (!hasPartials) return messages;

  const activeTurnIds = new Set();
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (m.isPartial && m.transcriptionId != null) {
      activeTurnIds.add(m.transcriptionId);
    }
  }
  if (!activeTurnIds.size) return messages;

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
    demoTeammates,
    participantName,
    mobileSheetSize,
    desktopPanelWide,
  } = useMeeting();
  const usePipMode = isFullScreen && isPanelOpen;
  const isDesktop = useIsDesktopViewport();
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
    if (isDesktop) return desktopScrollRef.current;
    return mobileScrollRef.current;
  }, [usePipMode, isDesktop]);
  const msgCounterRef = useRef(0);
  const sentMessageIdsRef = useRef(new Set());
  const persistingIdsRef = useRef(new Set());
  const persistFlushTimerRef = useRef(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const finalMessages = useMemo(() => messages.filter((m) => !m.isPartial), [messages]);
  const finalCount = finalMessages.length;

  const flushPersistedTranscript = useCallback(async () => {
    if (!meetingId || !transcriptPersistEnabled || !isHost || !room) return;
    const latest = messagesRef.current;
    const batch = latest.filter(
      (m) =>
        !m.isPartial &&
        !sentMessageIdsRef.current.has(m.id) &&
        !persistingIdsRef.current.has(m.id),
    );
    if (!batch.length) return;
    const paired = batch
      .map((m) => ({ m, line: buildTranscriptPayload(m, selectedLanguage) }))
      .filter(({ line }) => line.original_text && String(line.original_text).trim());
    if (!paired.length) return;
    paired.forEach(({ m }) => persistingIdsRef.current.add(m.id));
    const lines = paired.map(({ line }) => line);
    try {
      for (let i = 0; i < lines.length; i += 200) {
        const chunk = lines.slice(i, i + 200);
        await v2Meetings.appendTranscriptLines(meetingId, chunk);
      }
      paired.forEach(({ m }) => {
        persistingIdsRef.current.delete(m.id);
        sentMessageIdsRef.current.add(m.id);
      });
    } catch (e) {
      paired.forEach(({ m }) => persistingIdsRef.current.delete(m.id));
      console.warn('Transcript persist failed:', e.response?.data || e.message);
    }
  }, [meetingId, transcriptPersistEnabled, isHost, room, selectedLanguage]);

  // Trigger persistence timer ONLY when finalized message count changes (not on 10Hz partials!).
  useEffect(() => {
    if (!meetingId || !transcriptPersistEnabled || !isHost || !room || finalCount === 0) {
      clearTimeout(persistFlushTimerRef.current);
      return undefined;
    }
    clearTimeout(persistFlushTimerRef.current);
    persistFlushTimerRef.current = setTimeout(() => {
      flushPersistedTranscript();
    }, 2200);
    return () => {
      clearTimeout(persistFlushTimerRef.current);
    };
  }, [finalCount, meetingId, transcriptPersistEnabled, isHost, room, flushPersistedTranscript]);

  // Flush any remaining finalized lines on tab hide / unmount.
  useEffect(() => {
    if (!meetingId || !transcriptPersistEnabled || !isHost) return undefined;
    const onPageHide = () => {
      flushPersistedTranscript();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      flushPersistedTranscript();
    };
  }, [meetingId, transcriptPersistEnabled, isHost, flushPersistedTranscript]);

  useEffect(() => {
    if (!room) return;
    const debugCaptions =
      import.meta.env.DEV ||
      (typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('debug') === '1');

    const handleDataReceived = (payload, participant, kind, topic) => {
      try {
        if (topic != null && topic !== 'transcription') return;
        const raw = payload instanceof Uint8Array ? payload : (payload?.data ?? payload);
        if (!raw) return;
        const message = JSON.parse(SHARED_TEXT_DECODER.decode(raw));

        if (message.type !== 'transcription') return;

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
        const speakerLabel =
          message.participant_name ||
          resolveSpeakerLabel(speakerId, room) ||
          speakerId;
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
            speakerLabel,
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
          speakerLabel: preferSpeakerLabel(speakerLabel, existing.speakerLabel),
          originalText: mergedOriginal,
          translations: isTranslation
            ? {
                ...existing.translations,
                ...(text && text.trim()
                  ? { [targetLang]: text.trim() }
                  : {}),
              }
            : existing.translations,
          sourceLanguage: sourceLanguage || existing.sourceLanguage,
          timestamp: messageTimestamp,
          transcriptionId: transcriptionId ?? existing.transcriptionId,
          isPartial,
        };
        };

        if (message.partial) {
          setMessages((prev) => {
            // Match this turn's partial bubble. Never merge a new transcriptionId
            // into an older turn's bubble, and if another speaker's bubble has
            // appeared below this speaker's old un-id'd partial, start a new
            // bubble at the bottom so A -> B -> A stays strictly chronological.
            let idx = -1;
            if (transcriptionId != null) {
              idx = prev.findIndex(
                (m) => m.isPartial && m.transcriptionId === transcriptionId,
              );
            }
            if (idx < 0) {
              idx = prev.findIndex(
                (m, i) =>
                  m.isPartial &&
                  m.speaker === speakerId &&
                  (transcriptionId == null || m.transcriptionId == null) &&
                  !prev.slice(i + 1).some((later) => later.speaker !== speakerId),
              );
            }
            if (idx < 0 && transcriptionId != null) {
              // Same turn was prematurely finalized (e.g. out-of-order packet) — reopen it,
              // but only if no other speaker has spoken since.
              idx = prev.findIndex(
                (m, i) =>
                  !m.isPartial &&
                  m.speaker === speakerId &&
                  m.transcriptionId === transcriptionId &&
                  !prev.slice(i + 1).some((later) => later.speaker !== speakerId),
              );
            }
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = applyPartialUpdate(prev[idx], true);
              return next;
            }
            // Starting a brand-new partial bubble for this speaker: auto-finalize any
            // older orphaned partial from the same speaker so its pulse animations stop.
            const closedPrev = prev.some((m) => m.isPartial && m.speaker === speakerId)
              ? prev.map((m) =>
                  m.isPartial && m.speaker === speakerId ? { ...m, isPartial: false } : m
                )
              : prev;
            return [...closedPrev, buildNew(true)];
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
                (m) =>
                  m.speaker === speakerId &&
                  m.isPartial &&
                  (transcriptionId == null || m.transcriptionId == null),
              );
            }

            const commitExisting = (existing, index) => {
              const newTranslations = { ...existing.translations };
              if (isTranslation) newTranslations[targetLang] = text;
              const next = [...prev];
              next[index] = {
                ...existing,
                originalText: pickLiveCaptionText(
                  existing.originalText,
                  isTranslation ? (originalText || existing.originalText) : (text || originalText || existing.originalText),
                ),
                translations: newTranslations,
                sourceLanguage: sourceLanguage || existing.sourceLanguage,
                timestamp: messageTimestamp,
                transcriptionId: transcriptionId ?? existing.transcriptionId,
                isPartial: false,
              };
              return next;
            };

            if (idx >= 0) {
              return commitExisting(prev[idx], idx);
            }

            // Same thought split across two finals (shorter line, then the continuation) —
            // only if the most recent finalized bubble is also from this speaker (never jump
            // backwards over another speaker's interjection).
            for (let i = prev.length - 1; i >= 0; i -= 1) {
              const existing = prev[i];
              if (existing.isPartial) continue;
              if (existing.speaker !== speakerId) break;
              if (Math.abs(existing.timestamp - messageTimestamp) > 8000) break;
              const prevText = existing.originalText || '';
              const nextText = originalText || text || '';
              const continues = nextText.startsWith(prevText)
                || prevText.startsWith(nextText)
                || wordPrefixMatch(prevText, nextText)
                || wordPrefixMatch(nextText, prevText);
              if (continues && (prevText.length > 12 || nextText.length > 12)) {
                return commitExisting(existing, i);
              }
              break;
            }

            // Late-arriving translation for an already-finalized bubble.
            let finalIdx = -1;
            if (transcriptionId != null) {
              finalIdx = prev.findIndex(
                (m) => !m.isPartial && m.transcriptionId === transcriptionId,
              );
            }
            if (finalIdx < 0) {
              finalIdx = prev.findIndex(
                (m) =>
                  !m.isPartial &&
                  m.speaker === speakerId &&
                  m.originalText === originalText &&
                  Math.abs(m.timestamp - messageTimestamp) < 5000,
              );
            }
            if (finalIdx >= 0) {
              const existing = prev[finalIdx];
              const newTranslations = { ...existing.translations };
              if (isTranslation) newTranslations[targetLang] = text;
              const next = [...prev];
              next[finalIdx] = {
                ...existing,
                translations: newTranslations,
                sourceLanguage: sourceLanguage || existing.sourceLanguage,
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

  // ResizeObserver keeps scroll anchored when panel/sheet height changes.
  // (No MutationObserver needed: all caption updates go through React state.)
  useEffect(() => {
    const el = getScrollEl();
    if (!el) return undefined;

    let rafId = 0;
    const doScroll = () => {
      if (!isAtBottomRef.current || rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (!isAtBottomRef.current) return;
        const active = getScrollEl();
        if (active) active.scrollTop = active.scrollHeight;
      });
    };

    const ro = new ResizeObserver(doScroll);
    ro.observe(el);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [isPanelOpen, mobileExpanded, usePipMode, isDesktop, getScrollEl]);

  // Track scroll position (event target is the visible panel's scroll container).
  const handleScroll = (e) => {
    const el = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  };

  const jumpToLatest = () => scrollToLatest(true);

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
    const filename = `Lalia-Transcript-${dateStr}-${timeStr}.json`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const latestCaptionText = useMemo(() => {
    if (isDesktop || mobileExpanded || messages.length === 0) return null;
    let target = null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].isPartial) {
        target = messages[i];
        break;
      }
    }
    if (!target) target = messages[messages.length - 1];
    const { dominant } = getDominantAndSecondary(
      target.originalText,
      target.translations,
      selectedLanguage,
      target.isPartial,
      target.sourceLanguage,
    );
    // Show live translated text when available, otherwise show the live
    // original speech immediately so the mobile bar never hides words behind
    // a static "Translating…" placeholder.
    const line = dominant || target.originalText;
    return line ? `${target.speakerLabel || target.speaker}: ${line}` : null;
  }, [isDesktop, mobileExpanded, messages, selectedLanguage]);

  // If captions are not enabled, don't show the panel at all
  if (!translationEnabled) return null;

  // Floating PIP mode when in full screen or during screen share
  if (usePipMode) {
    return (
      <div
        className="fixed bottom-[calc(var(--control-bar-h,3.5rem)+0.75rem)] right-4 z-[9999] flex max-h-80 w-96 min-h-0 flex-col rounded-xl border meeting-panel-surface backdrop-blur-md"
        data-no-translate="true"
      >
        <PanelTabs onDownload={handleDownload} canDownload={finalCount > 0} compact />
        <PanelContent
          messages={visibleMessages}
          scrollRef={pipScrollRef}
          bottomAnchorRef={bottomAnchorRef}
          onScroll={handleScroll}
          selectedLanguage={selectedLanguage}
          demoTeammates={demoTeammates}
          participantName={participantName}
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

  // Mount only ONE PanelContent tree (desktop OR mobile) so React never
  // builds/diffs two duplicate copies of every caption bubble in the DOM.
  if (isDesktop) {
    return (
      <div
        className={`flex flex-col ${
          desktopPanelWide ? 'w-[440px] lg:w-[520px]' : 'w-[350px] lg:w-[400px]'
        } meeting-panel-surface border-l border h-full min-h-0 flex-shrink-0 transition-[width] duration-200`}
        data-no-translate="true"
      >
        <PanelTabs onDownload={handleDownload} canDownload={finalCount > 0} />
        <PanelContent
          messages={visibleMessages}
          scrollRef={desktopScrollRef}
          bottomAnchorRef={bottomAnchorRef}
          onScroll={handleScroll}
          selectedLanguage={selectedLanguage}
          demoTeammates={demoTeammates}
          participantName={participantName}
        />
        {!isAtBottom && (
          <JumpToLatest onClick={jumpToLatest} />
        )}
      </div>
    );
  }

  return !mobileExpanded ? (
    <MobileCaptionBar
      text={latestCaptionText}
      onExpand={() => setMobileExpanded(true)}
      hasContent={messages.length > 0}
    />
  ) : (
    <div
      className="meeting-mobile-sheet flex h-[min(40dvh,22rem)] max-h-[40dvh] w-full min-h-0 shrink-0 flex-col rounded-t-xl border meeting-panel-surface transition-[height,max-height] duration-200"
      data-meeting-mobile-sheet="captions"
      data-sheet-size={mobileSheetSize}
      data-no-translate="true"
    >
      <PanelTabs
        onDownload={handleDownload}
        canDownload={finalCount > 0}
        onMinimize={() => setMobileExpanded(false)}
      />
      <PanelContent
        messages={visibleMessages}
        scrollRef={mobileScrollRef}
        bottomAnchorRef={bottomAnchorRef}
        onScroll={handleScroll}
        selectedLanguage={selectedLanguage}
        demoTeammates={demoTeammates}
        participantName={participantName}
        compact
      />
      {!isAtBottom && (
        <JumpToLatest onClick={jumpToLatest} />
      )}
    </div>
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

const TranscriptionBubble = memo(function TranscriptionBubble({
  speaker,
  dominant,
  secondary,
  dominantLang,
  secondaryLang,
  selectedLanguage,
  timestamp,
  isPartial = false,
  pendingTranslation = false,
  compact = false,
  teammateCaptions = EMPTY_ARRAY,
}) {
  // A finalized bubble whose translation never arrived (cold LLM, dropped lane)
  // must not say "Translating…" forever — fall back to the original text.
  const [translationTimedOut, setTranslationTimedOut] = useState(false);
  useEffect(() => {
    if (!pendingTranslation || dominant || isPartial) {
      setTranslationTimedOut(false);
      return undefined;
    }
    const t = setTimeout(() => setTranslationTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, [pendingTranslation, dominant, isPartial]);

  const showTranslating = pendingTranslation && !dominant && !translationTimedOut;
  const fallbackToOriginal = pendingTranslation && !dominant && translationTimedOut;
  const displayDominant = fallbackToOriginal ? secondary : dominant;
  const displayDominantLang = fallbackToOriginal ? secondaryLang : dominantLang;
  const displaySecondary = fallbackToOriginal ? null : secondary;

  return (
    <div className={`${compact ? 'pb-1.5' : 'pb-3'} border-b border-border/60 last:border-b-0 [content-visibility:auto]`}>
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
              {formatBubbleTime(timestamp)}
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
      ) : displayDominant ? (
        <p
          className={`break-words leading-relaxed bg-muted/40 rounded px-2.5 py-1.5 ${compact ? 'text-xs' : 'text-sm'} text-foreground`}
        >
          {displayDominantLang && (
            <span className="text-muted-foreground mr-1">[{getLanguageLabel(displayDominantLang)}]</span>
          )}
          {displayDominant}
          {isPartial && (
            <span className="inline-block w-1.5 h-4 bg-primary ml-1 animate-pulse rounded-sm align-middle" />
          )}
        </p>
      ) : null}

      {displaySecondary && (
        <p className={`text-muted-foreground break-words leading-relaxed mt-1 pl-2.5 ${compact ? 'text-[10px]' : 'text-xs'} opacity-70`}>
          {secondaryLang && (
            <span className="text-muted-foreground mr-1">[{getLanguageLabel(secondaryLang)}]</span>
          )}
          {displaySecondary}
        </p>
      )}

      {teammateCaptions.map(({ name, lang, text }) => (
        <p
          key={`${name}-${lang}`}
          className={`text-muted-foreground break-words leading-relaxed mt-1 pl-2.5 ${compact ? 'text-[10px]' : 'text-xs'} opacity-70`}
        >
          <span className="font-medium text-foreground/70">{name}</span>
          {' hears '}
          <span className="text-muted-foreground">[{getLanguageLabel(lang)}]</span>
          {': '}
          {text}
        </p>
      ))}
    </div>
  );
});

const CaptionRow = memo(function CaptionRow({
  item,
  selectedLanguage,
  demoTeammates,
  participantName,
  compact,
  room,
}) {
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
  const localIdentity = room?.localParticipant?.identity;
  const showTeammateCaptions =
    demoTeammates.length > 0 &&
    (item.speaker === participantName ||
      item.speakerLabel === participantName ||
      (localIdentity && item.speaker === localIdentity));
  const teammateCaptions = showTeammateCaptions
    ? getTeammateCaptions(item.translations, demoTeammates, item.sourceLanguage)
    : EMPTY_ARRAY;
  const hideGenericSecondary = showTeammateCaptions && teammateCaptions.length > 0;

  return (
    <TranscriptionBubble
      speaker={item.speakerLabel || resolveSpeakerLabel(item.speaker, room) || item.speaker}
      dominant={dominant}
      secondary={hideGenericSecondary ? null : secondary}
      dominantLang={dominantLang}
      secondaryLang={hideGenericSecondary ? null : secondaryLang}
      selectedLanguage={selectedLanguage}
      timestamp={item.timestamp}
      isPartial={item.isPartial}
      pendingTranslation={pendingTranslation}
      compact={compact}
      teammateCaptions={teammateCaptions}
    />
  );
});

function PanelContent({
  messages,
  scrollRef,
  bottomAnchorRef,
  onScroll,
  selectedLanguage,
  demoTeammates = EMPTY_ARRAY,
  participantName = '',
  compact = false,
}) {
  const room = useRoomContext();
  const [renderLimit, setRenderLimit] = useState(DEFAULT_DOM_WINDOW);
  const hasContent = messages.length > 0;
  const hiddenCount = Math.max(0, messages.length - renderLimit);
  const windowedMessages = useMemo(
    () => (hiddenCount > 0 ? messages.slice(-renderLimit) : messages),
    [messages, hiddenCount, renderLimit]
  );

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className={`flex-1 min-h-0 overflow-y-auto ${compact ? 'p-2 space-y-1.5' : 'p-4 space-y-3'}`}
      data-no-translate="true"
    >
      {!hasContent && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <MessageSquare className="w-8 h-8 mb-3 opacity-50" />
          <p className={`text-center ${compact ? 'text-xs' : 'text-sm'}`}>Waiting for speech...</p>
        </div>
      )}

      {hiddenCount > 0 && (
        <div className="flex justify-center pb-2">
          <button
            type="button"
            onClick={() => setRenderLimit((prev) => prev + DEFAULT_DOM_WINDOW)}
            className="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Show earlier captions ({hiddenCount} older — all included in download)
          </button>
        </div>
      )}

      {windowedMessages.map((item) => (
        <CaptionRow
          key={item.id}
          item={item}
          selectedLanguage={selectedLanguage}
          demoTeammates={demoTeammates}
          participantName={participantName}
          compact={compact}
          room={room}
        />
      ))}
      <div ref={bottomAnchorRef} className="h-px w-full shrink-0" aria-hidden />
    </div>
  );
}

function MobileCaptionBar({ text, onExpand, hasContent }) {
  return (
    <div
      className="meeting-mobile-caption-bar sm:hidden w-full shrink-0"
      data-meeting-mobile-sheet="captions-bar"
      data-no-translate="true"
    >
      <button
        onClick={onExpand}
        className="flex w-full items-center gap-2 border-t border-border meeting-control-strip px-3 py-2 text-left backdrop-blur-sm"
      >
        <MessageSquare className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        {text ? (
          <span className="text-xs leading-snug text-foreground line-clamp-2 flex-1">{text}</span>
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
