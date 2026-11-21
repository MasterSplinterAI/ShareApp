import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo } from 'react';
import { MessageSquare, ChevronUp, ChevronDown } from 'lucide-react';
import { useRoomContext } from '@livekit/components-react';
import { useMeeting } from '../context/MeetingContext';
import { v2Meetings } from '../services/apiV2';
import PanelTabs from './PanelTabs';
import { resolveSpeakerLabel } from '../lib/participantDisplayName';
import {
  DEFAULT_DOM_WINDOW,
  createTranscriptStore,
  applyTranscriptionPacket,
  getWindowedDisplaySlice,
  getAllFinalMessages,
} from '../lib/transcriptStore';

const SHARED_TEXT_DECODER = new TextDecoder();
const TIME_FORMATTER = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' });
const EMPTY_ARRAY = [];
const PARTIAL_RENDER_INTERVAL_MS = 48;

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
  if (!demoTeammates?.length || !translations) return EMPTY_ARRAY;
  const sourceNorm = sourceLanguage ? normalizeLangCode(sourceLanguage) : null;
  const rows = demoTeammates
    .map(({ name, lang }) => {
      const norm = normalizeLangCode(lang);
      const entry = Object.entries(translations).find(([k]) => normalizeLangCode(k) === norm);
      const text = entry?.[1]?.trim();
      if (!text) return null;
      if (sourceNorm && norm === sourceNorm) return null;
      return { name, lang, text };
    })
    .filter(Boolean);
  return rows.length > 0 ? rows : EMPTY_ARRAY;
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
    participant_identity: String(m.speakerLabel || m.speaker || 'unknown').slice(0, 200),
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

  const storeRef = useRef(null);
  if (!storeRef.current) {
    storeRef.current = createTranscriptStore();
  }

  const [renderLimit, setRenderLimit] = useState(DEFAULT_DOM_WINDOW);
  const renderLimitRef = useRef(renderLimit);
  renderLimitRef.current = renderLimit;

  const [viewState, setViewState] = useState({
    windowedMessages: EMPTY_ARRAY,
    hiddenCount: 0,
    hasContent: false,
    latestItem: null,
    finalCount: 0,
  });

  const [isAtBottom, setIsAtBottom] = useState(true);
  const desktopScrollRef = useRef(null);
  const mobileScrollRef = useRef(null);
  const pipScrollRef = useRef(null);
  const bottomAnchorRef = useRef(null);
  const isAtBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(0);

  const uiVisibilityRef = useRef({
    needsBubbleList: true,
    needsMobileBar: false,
  });
  const needsBubbleList = Boolean(
    translationEnabled && isPanelOpen && (usePipMode || isDesktop || mobileExpanded)
  );
  const needsMobileBar = Boolean(
    translationEnabled && isPanelOpen && !usePipMode && !isDesktop && !mobileExpanded
  );
  uiVisibilityRef.current = { needsBubbleList, needsMobileBar };

  const getScrollEl = useCallback(() => {
    if (usePipMode) return pipScrollRef.current;
    if (isDesktop) return desktopScrollRef.current;
    return mobileScrollRef.current;
  }, [usePipMode, isDesktop]);

  const sentMessageIdsRef = useRef(new Set());
  const persistingIdsRef = useRef(new Set());
  const persistFlushTimerRef = useRef(null);

  const commitStoreToView = useCallback(() => {
    const store = storeRef.current;
    const { needsBubbleList: showList, needsMobileBar: showBar } = uiVisibilityRef.current;

    if (!showList && !showBar) {
      setViewState((prev) =>
        prev.finalCount === store.finalCount
          ? prev
          : { ...prev, finalCount: store.finalCount }
      );
      return;
    }

    const slice = getWindowedDisplaySlice(store, showList ? renderLimitRef.current : 1);
    setViewState({
      windowedMessages: showList ? slice.windowedMessages : EMPTY_ARRAY,
      hiddenCount: showList ? slice.hiddenCount : 0,
      hasContent: slice.hasContent,
      latestItem: slice.latestItem,
      finalCount: store.finalCount,
    });
  }, []);

  // Recompute view slice immediately when panel visibility, layout mode, or window size changes.
  useEffect(() => {
    commitStoreToView();
  }, [needsBubbleList, needsMobileBar, renderLimit, commitStoreToView]);

  // Reset store only when switching to a different roomName.
  const prevRoomNameRef = useRef(roomName);
  useEffect(() => {
    if (prevRoomNameRef.current !== roomName) {
      prevRoomNameRef.current = roomName;
      storeRef.current = createTranscriptStore();
      sentMessageIdsRef.current.clear();
      persistingIdsRef.current.clear();
      setRenderLimit(DEFAULT_DOM_WINDOW);
      setViewState({
        windowedMessages: EMPTY_ARRAY,
        hiddenCount: 0,
        hasContent: false,
        latestItem: null,
        finalCount: 0,
      });
    }
  }, [roomName]);

  const finalCount = viewState.finalCount;

  const flushPersistedTranscript = useCallback(async () => {
    if (!meetingId || !transcriptPersistEnabled || !isHost || !room) return;
    const store = storeRef.current;
    if (store.unsentFinalIds.size === 0) return;

    const batch = [];
    for (const id of Array.from(store.unsentFinalIds)) {
      if (sentMessageIdsRef.current.has(id)) {
        store.unsentFinalIds.delete(id);
        continue;
      }
      if (persistingIdsRef.current.has(id)) continue;
      const idx = store.idToIndex.get(id);
      const m = idx != null ? store.messages[idx] : null;
      if (!m || m.isPartial) continue;
      batch.push(m);
    }
    if (!batch.length) return;

    const paired = [];
    for (let i = 0; i < batch.length; i += 1) {
      const m = batch[i];
      const line = buildTranscriptPayload(m, selectedLanguage);
      if (line.original_text && String(line.original_text).trim()) {
        paired.push({ m, line });
      } else {
        store.unsentFinalIds.delete(m.id);
      }
    }
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
        store.unsentFinalIds.delete(m.id);
        sentMessageIdsRef.current.add(m.id);
      });
    } catch (e) {
      paired.forEach(({ m }) => persistingIdsRef.current.delete(m.id));
      console.warn('Transcript persist failed:', e.response?.data || e.message);
    }
  }, [meetingId, transcriptPersistEnabled, isHost, room, selectedLanguage]);

  // Trigger persistence timer ONLY when finalized message count changes (not on partials).
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
    if (!room) return undefined;
    const debugCaptions =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('debug') === '1';

    let rafId = 0;
    let throttleTimerId = 0;
    let lastFlushAt = 0;

    const runFlush = () => {
      rafId = 0;
      lastFlushAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      commitStoreToView();
    };

    const scheduleUiFlush = (immediate = false) => {
      if (immediate) {
        if (throttleTimerId) {
          window.clearTimeout(throttleTimerId);
          throttleTimerId = 0;
        }
        if (!rafId) {
          rafId = window.requestAnimationFrame(runFlush);
        }
        return;
      }

      if (rafId || throttleTimerId) return;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsed = now - lastFlushAt;
      if (elapsed >= PARTIAL_RENDER_INTERVAL_MS) {
        rafId = window.requestAnimationFrame(runFlush);
      } else {
        throttleTimerId = window.setTimeout(() => {
          throttleTimerId = 0;
          if (!rafId) {
            rafId = window.requestAnimationFrame(runFlush);
          }
        }, PARTIAL_RENDER_INTERVAL_MS - elapsed);
      }
    };

    const handleDataReceived = (payload, participant, _kind, topic) => {
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

        const { changed, isFinalChange } = applyTranscriptionPacket(
          storeRef.current,
          message,
          { speakerId, speakerLabel }
        );
        if (!changed) return;

        const { needsBubbleList: showList, needsMobileBar: showBar } = uiVisibilityRef.current;
        if (!showList && !showBar && !isFinalChange) {
          // Panel is closed and only partial text changed — keep store warm in O(1)
          // without waking React at 20-40 Hz.
          return;
        }

        scheduleUiFlush(isFinalChange);
      } catch (error) {
        console.error('TranscriptionPanel: Error parsing data message:', error);
      }
    };

    room.on('dataReceived', handleDataReceived);
    return () => {
      room.off('dataReceived', handleDataReceived);
      if (rafId) window.cancelAnimationFrame(rafId);
      if (throttleTimerId) window.clearTimeout(throttleTimerId);
    };
  }, [room, commitStoreToView]);

  const scrollToLatest = useCallback((force = false) => {
    if (!force && !isAtBottomRef.current) return;
    const el = getScrollEl();
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    isAtBottomRef.current = true;
    if (force) {
      setIsAtBottom((prev) => (prev ? prev : true));
    }
  }, [getScrollEl]);

  // Preserve reading position when prepending older history via "Show earlier captions".
  useLayoutEffect(() => {
    if (prevScrollHeightRef.current <= 0) return;
    const el = getScrollEl();
    const prevHeight = prevScrollHeightRef.current;
    prevScrollHeightRef.current = 0;
    if (el) {
      const delta = el.scrollHeight - prevHeight;
      if (delta > 0) el.scrollTop += delta;
    }
  }, [viewState.windowedMessages, getScrollEl]);

  // Coalesce bottom-anchoring in requestAnimationFrame instead of forcing synchronous
  // layout reflows inside useLayoutEffect on every partial frame.
  useEffect(() => {
    if (!needsBubbleList || !isAtBottomRef.current) return undefined;
    const rafId = window.requestAnimationFrame(() => {
      if (isAtBottomRef.current) {
        scrollToLatest();
      }
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [viewState.windowedMessages, needsBubbleList, scrollToLatest]);

  // ResizeObserver keeps scroll anchored when panel/sheet height changes.
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

  const handleScroll = useCallback((e) => {
    const el = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    isAtBottomRef.current = atBottom;
    setIsAtBottom((prev) => (prev === atBottom ? prev : atBottom));
  }, []);

  const handleLoadOlder = useCallback(() => {
    const el = getScrollEl();
    prevScrollHeightRef.current = el ? el.scrollHeight : 0;
    setRenderLimit((prev) => prev + DEFAULT_DOM_WINDOW);
  }, [getScrollEl]);

  const jumpToLatest = useCallback(() => {
    prevScrollHeightRef.current = 0;
    if (renderLimitRef.current > DEFAULT_DOM_WINDOW) {
      setRenderLimit(DEFAULT_DOM_WINDOW);
    }
    window.requestAnimationFrame(() => {
      scrollToLatest(true);
    });
  }, [scrollToLatest]);

  const handleDownload = useCallback(() => {
    const allFinals = getAllFinalMessages(storeRef.current);
    const exportData = allFinals.map((t) => ({
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
  }, [roomName]);

  const latestCaptionText = useMemo(() => {
    const target = viewState.latestItem;
    if (isDesktop || mobileExpanded || !target) return null;
    const { dominant } = getDominantAndSecondary(
      target.originalText,
      target.translations,
      selectedLanguage,
      target.isPartial,
      target.sourceLanguage,
    );
    const line = dominant || target.originalText;
    return line ? `${target.speakerLabel || target.speaker}: ${line}` : null;
  }, [isDesktop, mobileExpanded, viewState.latestItem, selectedLanguage]);

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
          messages={viewState.windowedMessages}
          hiddenCount={viewState.hiddenCount}
          hasContent={viewState.hasContent}
          onLoadOlder={handleLoadOlder}
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
          messages={viewState.windowedMessages}
          hiddenCount={viewState.hiddenCount}
          hasContent={viewState.hasContent}
          onLoadOlder={handleLoadOlder}
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
      hasContent={viewState.hasContent}
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
        messages={viewState.windowedMessages}
        hiddenCount={viewState.hiddenCount}
        hasContent={viewState.hasContent}
        onLoadOlder={handleLoadOlder}
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
  const translationEntries = Object.entries(translations || {});
  const wantsTranslation = !!(
    selectedLanguage &&
    sourceLanguage &&
    normalizeLangCode(selectedLanguage) !== normalizeLangCode(sourceLanguage)
  );

  const matchingEntry = translationEntries.find(
    ([lang]) => normalizeLangCode(lang) === normalizeLangCode(selectedLanguage),
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
    <div className={`${compact ? 'pb-1.5' : 'pb-3'} border-b border-border/60 last:border-b-0`}>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-medium text-primary text-xs">{speaker}</span>
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
  hiddenCount = 0,
  hasContent = false,
  onLoadOlder,
  scrollRef,
  bottomAnchorRef,
  onScroll,
  selectedLanguage,
  demoTeammates = EMPTY_ARRAY,
  participantName = '',
  compact = false,
}) {
  const room = useRoomContext();

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
            onClick={onLoadOlder}
            className="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Show earlier captions ({hiddenCount} older — all included in download)
          </button>
        </div>
      )}

      {messages.map((item) => (
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
