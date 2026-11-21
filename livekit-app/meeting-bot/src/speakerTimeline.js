'use strict';

/**
 * Fuses UI active-speaker observations (from Google Meet / MS Teams DOM) with
 * Deepgram diarized utterance windows [startMs, endMs] to attribute speech to
 * real participant names whenever visible, falling back to "Speaker N".
 */
class SpeakerTimeline {
  constructor({ botDisplayName = 'Lalia Notetaker', maxEvents = 20000 } = {}) {
    this.botNameNorm = String(botDisplayName || '').trim().toLowerCase();
    this.maxEvents = maxEvents;
    this.events = []; // [{ atMs, name }]
    this.diarizedMap = new Map(); // diarizedSpeakerIndex -> dominant human name (when confident)
  }

  recordActiveSpeakers(names, atMs = Date.now()) {
    if (!Array.isArray(names) || names.length === 0) return;
    for (const raw of names) {
      const cleaned = String(raw || '').trim();
      if (!cleaned) continue;
      if (cleaned.toLowerCase() === this.botNameNorm) continue;
      if (/^(you|muted|unmuted|pin|more options)$/i.test(cleaned)) continue;

      const last = this.events[this.events.length - 1];
      if (last && last.name === cleaned && Math.abs(atMs - last.atMs) < 200) {
        continue;
      }
      this.events.push({ atMs, name: cleaned });
    }
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
  }

  /**
   * Resolve speaker name for an utterance spanning [utteranceStartMs, utteranceEndMs].
   * @param {object} params
   * @param {number} params.startMs - Wall-clock start timestamp in ms
   * @param {number} params.endMs - Wall-clock end timestamp in ms
   * @param {number|null} params.diarizeSpeaker - Deepgram speaker integer (0, 1, 2...)
   */
  resolveSpeaker({ startMs, endMs, diarizeSpeaker = null }) {
    const windowStart = startMs - 600;
    const windowEnd = Math.max(startMs + 400, endMs + 400);
    const counts = new Map();

    // Binary search or reverse walk from end since utterances arrive near real-time
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const ev = this.events[i];
      if (ev.atMs < windowStart) break;
      if (ev.atMs <= windowEnd) {
        counts.set(ev.name, (counts.get(ev.name) || 0) + 1);
      }
    }

    let bestName = null;
    let bestCount = 0;
    for (const [name, count] of counts.entries()) {
      if (count > bestCount) {
        bestCount = count;
        bestName = name;
      }
    }

    if (bestName) {
      // Only bind diarizeSpeaker -> name when a single speaker dominated the window
      if (diarizeSpeaker != null && counts.size === 1 && bestCount >= 2) {
        this.diarizedMap.set(diarizeSpeaker, bestName);
      }
      return bestName;
    }

    if (diarizeSpeaker != null && this.diarizedMap.has(diarizeSpeaker)) {
      return this.diarizedMap.get(diarizeSpeaker);
    }

    if (diarizeSpeaker != null && Number.isFinite(Number(diarizeSpeaker))) {
      return `Speaker ${Number(diarizeSpeaker) + 1}`;
    }

    return 'Participant';
  }
}

module.exports = { SpeakerTimeline };
