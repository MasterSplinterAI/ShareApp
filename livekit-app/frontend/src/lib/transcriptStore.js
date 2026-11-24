import { preferSpeakerLabel } from './participantDisplayName.js';

export const DEFAULT_DOM_WINDOW = 80;

function normalizeLangCode(code) {
  return typeof code === 'string' ? code.split('-')[0].toLowerCase() : code;
}

function normalizeCaptionWord(word) {
  return word.replace(/^[\s.,!?;:"'-]+|[\s.,!?;:"'-]+$/g, '').toLowerCase();
}

export function wordPrefixMatch(shorter, longer) {
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

let _lastSanitizeIn = '';
let _lastSanitizeOut = '';

function wordsMatchAt(words, i, n) {
  for (let k = 0; k < n; k += 1) {
    if (words[i + k] !== words[i + n + k]) return false;
  }
  return true;
}

export function sanitizeCaptionText(text) {
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

function applyGladiaPartialText(previous, incoming) {
  const p = (previous || '').trim();
  const n = sanitizeCaptionText((incoming || '').trim());
  if (!n) return p;
  if (!p) return n;
  if (n === p) return p;
  if (n.startsWith(p) || wordPrefixMatch(p, n)) return n;
  if (p.startsWith(n) || wordPrefixMatch(n, p)) return p;
  return n;
}

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
  if (common < 2) return n;
  return sanitizeCaptionText(stitchCommittedAndOpen(p, n));
}

/** Agent sends cumulative live lines — prefer prefix extensions, reject mid-string repeats. */
export function pickLiveCaptionText(previous, incoming) {
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
  if (next.includes(prev) && !next.startsWith(prev)) return prev;
  if (prev.includes(next) && !prev.startsWith(next)) return prev;
  return sanitizeCaptionText(mergeSttOverlap(prev, next));
}

function shallowEqualTranslations(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i += 1) {
    const k = ak[i];
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function addTurnIndex(turnMap, turnId, index) {
  if (turnId == null) return;
  let bucket = turnMap.get(turnId);
  if (!bucket) {
    bucket = [index];
    turnMap.set(turnId, bucket);
  } else if (!bucket.includes(index)) {
    bucket.push(index);
  }
}

function removeTurnIndex(turnMap, turnId, index) {
  if (turnId == null) return;
  const bucket = turnMap.get(turnId);
  if (!bucket) return;
  const pos = bucket.indexOf(index);
  if (pos >= 0) bucket.splice(pos, 1);
  if (bucket.length === 0) turnMap.delete(turnId);
}

/**
 * O(1) per-packet transcript store.
 * Keeps individual message objects immutable (so React.memo on rows works with ===)
 * while mutating the backing container/indexes in place instead of cloning full call
 * history arrays at 20-40 Hz.
 */
export function createTranscriptStore() {
  return {
    messages: [],
    turnMap: new Map(),
    openPartialIndices: new Set(),
    unsentFinalIds: new Set(),
    idToIndex: new Map(),
    finalCount: 0,
    msgCounter: 0,
    version: 0,
  };
}

function pushStoreMessage(store, msg) {
  const idx = store.messages.length;
  store.messages.push(msg);
  store.idToIndex.set(msg.id, idx);
  addTurnIndex(store.turnMap, msg.transcriptionId, idx);
  if (msg.isPartial) {
    store.openPartialIndices.add(idx);
  } else {
    store.finalCount += 1;
    store.unsentFinalIds.add(msg.id);
  }
  store.version += 1;
  return true;
}

function replaceStoreMessage(store, idx, nextMsg) {
  const prevMsg = store.messages[idx];
  // Partial packets carry a fresh wall-clock timestamp at 10-30 Hz even when
  // text/translations are identical; skip no-op replacements so React doesn't re-render.
  if (
    prevMsg.isPartial === nextMsg.isPartial &&
    prevMsg.originalText === nextMsg.originalText &&
    prevMsg.speakerLabel === nextMsg.speakerLabel &&
    prevMsg.sourceLanguage === nextMsg.sourceLanguage &&
    prevMsg.transcriptionId === nextMsg.transcriptionId &&
    shallowEqualTranslations(prevMsg.translations, nextMsg.translations)
  ) {
    return false;
  }

  store.messages[idx] = nextMsg;
  if (prevMsg.transcriptionId !== nextMsg.transcriptionId) {
    removeTurnIndex(store.turnMap, prevMsg.transcriptionId, idx);
    addTurnIndex(store.turnMap, nextMsg.transcriptionId, idx);
  }

  if (prevMsg.isPartial && !nextMsg.isPartial) {
    store.openPartialIndices.delete(idx);
    store.finalCount += 1;
    store.unsentFinalIds.add(nextMsg.id);
  } else if (!prevMsg.isPartial && nextMsg.isPartial) {
    store.openPartialIndices.add(idx);
    store.finalCount = Math.max(0, store.finalCount - 1);
    store.unsentFinalIds.delete(nextMsg.id);
  }

  store.version += 1;
  return true;
}

function hasOtherSpeakerAfter(messages, idx, speakerId) {
  for (let j = messages.length - 1; j > idx; j -= 1) {
    if (messages[j].speaker !== speakerId) return true;
  }
  return false;
}

/**
 * Apply one decoded transcription packet to the store.
 * Returns { changed: boolean, isFinalChange: boolean }.
 */
export function applyTranscriptionPacket(store, message, { speakerId, speakerLabel, now = Date.now() }) {
  const messageTimestamp = message.timestamp ? message.timestamp * 1000 : now;
  const targetLang = message.language || 'en';
  const sourceLanguage = message.sourceLanguage || null;
  const originalText = message.originalText || message.text || '';
  const text = message.text || '';
  const transcriptionId = message.transcriptionId ?? null;
  const sttProvider = message.sttProvider || null;

  const isTranslation = !!(
    sourceLanguage &&
    targetLang &&
    normalizeLangCode(sourceLanguage) !== normalizeLangCode(targetLang) &&
    originalText &&
    text &&
    originalText !== text
  );

  const buildNew = (isPartial) => {
    store.msgCounter += 1;
    const rawOriginal = isTranslation ? originalText : (originalText || text);
    return {
      id: `m${store.msgCounter}`,
      speaker: speakerId,
      speakerLabel,
      originalText: sanitizeCaptionText(rawOriginal) || rawOriginal,
      translations: isTranslation && text.trim() ? { [targetLang]: text.trim() } : {},
      sourceLanguage,
      timestamp: messageTimestamp,
      transcriptionId,
      isPartial,
    };
  };

  const buildPartialMerged = (existing, isPartial) => {
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

    let nextTranslations = existing.translations;
    if (isTranslation && text && text.trim()) {
      const trimmed = text.trim();
      if (existing.translations?.[targetLang] !== trimmed) {
        nextTranslations = {
          ...existing.translations,
          [targetLang]: trimmed,
        };
      }
    }

    return {
      ...existing,
      speakerLabel: preferSpeakerLabel(speakerLabel, existing.speakerLabel),
      originalText: mergedOriginal,
      translations: nextTranslations,
      sourceLanguage: sourceLanguage || existing.sourceLanguage,
      timestamp: messageTimestamp,
      transcriptionId: transcriptionId ?? existing.transcriptionId,
      isPartial,
    };
  };

  const prevFinalCount = store.finalCount;

  if (message.partial) {
    let idx = -1;

    // 1. O(1) lookup by transcriptionId on an open partial
    if (transcriptionId != null) {
      const bucket = store.turnMap.get(transcriptionId);
      if (bucket) {
        for (let b = 0; b < bucket.length; b += 1) {
          const candidate = bucket[b];
          if (store.messages[candidate]?.isPartial) {
            idx = candidate;
            break;
          }
        }
      }
    }

    // 2. O(1) reverse tail walk: match un-id'd partial for speakerId only if no other
    // speaker has spoken since (walking backwards and stopping on speaker !== speakerId).
    if (idx < 0) {
      for (let i = store.messages.length - 1; i >= 0; i -= 1) {
        const m = store.messages[i];
        if (m.speaker !== speakerId) break;
        if (m.isPartial && (transcriptionId == null || m.transcriptionId == null)) {
          idx = i;
        }
      }
    }

    // 3. O(1) reopen prematurely finalized bubble with same transcriptionId if no other
    // speaker has spoken since.
    if (idx < 0 && transcriptionId != null) {
      const bucket = store.turnMap.get(transcriptionId);
      if (bucket) {
        for (let b = 0; b < bucket.length; b += 1) {
          const candidate = bucket[b];
          const m = store.messages[candidate];
          if (
            m &&
            !m.isPartial &&
            m.speaker === speakerId &&
            !hasOtherSpeakerAfter(store.messages, candidate, speakerId)
          ) {
            idx = candidate;
            break;
          }
        }
      }
    }

    if (idx >= 0) {
      const changed = replaceStoreMessage(
        store,
        idx,
        buildPartialMerged(store.messages[idx], true),
      );
      return { changed, isFinalChange: store.finalCount !== prevFinalCount };
    }

    // Starting a brand-new partial bubble: auto-finalize any orphaned older partial
    // from the same speaker using openPartialIndices (O(active_speakers) instead of O(N)).
    for (const openIdx of Array.from(store.openPartialIndices)) {
      const openMsg = store.messages[openIdx];
      if (openMsg && openMsg.isPartial && openMsg.speaker === speakerId) {
        replaceStoreMessage(store, openIdx, { ...openMsg, isPartial: false });
      }
    }

    pushStoreMessage(store, buildNew(true));
    return { changed: true, isFinalChange: store.finalCount !== prevFinalCount };
  }

  // Finalized packet (!message.partial)
  let idx = -1;
  if (transcriptionId != null) {
    const bucket = store.turnMap.get(transcriptionId);
    if (bucket) {
      for (let b = 0; b < bucket.length; b += 1) {
        const candidate = bucket[b];
        if (store.messages[candidate]?.isPartial) {
          idx = candidate;
          break;
        }
      }
    }
  }

  if (idx < 0 && store.openPartialIndices.size > 0) {
    let earliest = -1;
    for (const openIdx of store.openPartialIndices) {
      const m = store.messages[openIdx];
      if (
        m &&
        m.isPartial &&
        m.speaker === speakerId &&
        (transcriptionId == null || m.transcriptionId == null) &&
        (earliest < 0 || openIdx < earliest)
      ) {
        earliest = openIdx;
      }
    }
    idx = earliest;
  }

  const commitExisting = (existing, index) => {
    let newTranslations = existing.translations;
    if (isTranslation && text) {
      if (existing.translations?.[targetLang] !== text) {
        newTranslations = { ...existing.translations, [targetLang]: text };
      }
    }
    const nextMsg = {
      ...existing,
      speakerLabel: preferSpeakerLabel(speakerLabel, existing.speakerLabel),
      originalText: pickLiveCaptionText(
        existing.originalText,
        isTranslation
          ? (originalText || existing.originalText)
          : (text || originalText || existing.originalText),
      ),
      translations: newTranslations,
      sourceLanguage: sourceLanguage || existing.sourceLanguage,
      timestamp: messageTimestamp,
      transcriptionId: transcriptionId ?? existing.transcriptionId,
      isPartial: false,
    };
    const changed = replaceStoreMessage(store, index, nextMsg);
    return { changed, isFinalChange: store.finalCount !== prevFinalCount || changed };
  };

  if (idx >= 0) {
    return commitExisting(store.messages[idx], idx);
  }

  // Split-final continuation within 8s if no other speaker interjected.
  for (let i = store.messages.length - 1; i >= 0; i -= 1) {
    const existing = store.messages[i];
    if (existing.isPartial) continue;
    if (existing.speaker !== speakerId) break;
    if (Math.abs(existing.timestamp - messageTimestamp) > 8000) break;
    const prevText = existing.originalText || '';
    const nextText = originalText || text || '';
    const continues =
      nextText.startsWith(prevText) ||
      prevText.startsWith(nextText) ||
      wordPrefixMatch(prevText, nextText) ||
      wordPrefixMatch(nextText, prevText);
    if (continues && (prevText.length > 12 || nextText.length > 12)) {
      return commitExisting(existing, i);
    }
    break;
  }

  // Late-arriving translation for an already-finalized bubble.
  let finalIdx = -1;
  if (transcriptionId != null) {
    const bucket = store.turnMap.get(transcriptionId);
    if (bucket) {
      for (let b = 0; b < bucket.length; b += 1) {
        const candidate = bucket[b];
        if (store.messages[candidate] && !store.messages[candidate].isPartial) {
          finalIdx = candidate;
          break;
        }
      }
    }
  }

  if (finalIdx < 0) {
    // Bounded reverse walk: timestamps are monotonic within a few seconds, so stop
    // once messages are older than 30s (still matches <5000ms window identically).
    for (let i = store.messages.length - 1; i >= 0; i -= 1) {
      const m = store.messages[i];
      if (messageTimestamp - m.timestamp > 30000) break;
      if (
        !m.isPartial &&
        m.speaker === speakerId &&
        m.originalText === originalText &&
        Math.abs(m.timestamp - messageTimestamp) < 5000
      ) {
        finalIdx = i;
        break;
      }
    }
  }

  if (finalIdx >= 0) {
    const existing = store.messages[finalIdx];
    let newTranslations = existing.translations;
    if (isTranslation && text && existing.translations?.[targetLang] !== text) {
      newTranslations = { ...existing.translations, [targetLang]: text };
    }
    const nextMsg = {
      ...existing,
      translations: newTranslations,
      sourceLanguage: sourceLanguage || existing.sourceLanguage,
    };
    const changed = replaceStoreMessage(store, finalIdx, nextMsg);
    return { changed, isFinalChange: changed };
  }

  pushStoreMessage(store, buildNew(false));
  return { changed: true, isFinalChange: true };
}

/**
 * Returns the tail window of displayable messages in O(limit) time — never scans or
 * filters the full call history regardless of how long the meeting lasts.
 */
export function getWindowedDisplaySlice(store, limit = DEFAULT_DOM_WINDOW) {
  const totalLen = store.messages.length;
  if (totalLen === 0) {
    return {
      windowedMessages: [],
      hiddenCount: 0,
      hasContent: false,
      latestItem: null,
    };
  }

  let activeTurnIds = null;
  let suppressedCount = 0;

  if (store.openPartialIndices.size > 0) {
    for (const openIdx of store.openPartialIndices) {
      const m = store.messages[openIdx];
      if (m?.isPartial && m.transcriptionId != null) {
        if (!activeTurnIds) activeTurnIds = new Set();
        if (!activeTurnIds.has(m.transcriptionId)) {
          activeTurnIds.add(m.transcriptionId);
          const bucket = store.turnMap.get(m.transcriptionId);
          if (bucket) {
            for (let b = 0; b < bucket.length; b += 1) {
              if (!store.messages[bucket[b]]?.isPartial) {
                suppressedCount += 1;
              }
            }
          }
        }
      }
    }
  }

  const safeLimit = Math.max(1, limit);
  const rev = [];
  for (let i = totalLen - 1; i >= 0 && rev.length < safeLimit; i -= 1) {
    const m = store.messages[i];
    if (
      activeTurnIds &&
      !m.isPartial &&
      m.transcriptionId != null &&
      activeTurnIds.has(m.transcriptionId)
    ) {
      continue;
    }
    rev.push(m);
  }
  rev.reverse();

  const totalVisible = Math.max(rev.length, totalLen - suppressedCount);
  const hiddenCount = Math.max(0, totalVisible - rev.length);

  // Latest item for collapsed mobile caption bar: prefer latest open partial, else tail.
  let latestItem = null;
  if (store.openPartialIndices.size > 0) {
    let maxIdx = -1;
    for (const openIdx of store.openPartialIndices) {
      if (openIdx > maxIdx && store.messages[openIdx]?.isPartial) {
        maxIdx = openIdx;
      }
    }
    if (maxIdx >= 0) latestItem = store.messages[maxIdx];
  }
  if (!latestItem) {
    latestItem = rev.length > 0 ? rev[rev.length - 1] : store.messages[totalLen - 1];
  }

  return {
    windowedMessages: rev,
    hiddenCount,
    hasContent: totalVisible > 0,
    latestItem,
  };
}

export function getAllFinalMessages(store) {
  return store.messages.filter((m) => !m.isPartial);
}
