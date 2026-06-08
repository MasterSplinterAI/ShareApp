from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Sequence, Tuple


@dataclass(frozen=True)
class TranscriptWord:
    text: str
    start_time: float
    end_time: float


def words_from_text(text: str, *, start: float = 0.0, step: float = 0.2) -> List[TranscriptWord]:
    """Test/helper utility for building deterministic timed words."""
    words: List[TranscriptWord] = []
    t = start
    for word in text.split():
        words.append(TranscriptWord(word, t, t + step))
        t += step
    return words


def _as_float(value: object, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _word_text(word: object) -> str:
    # LiveKit TimedString is a str subclass — text is the string itself.
    if isinstance(word, str):
        return word.strip()
    text = getattr(word, "text", None) or getattr(word, "word", None)
    if text is not None:
        return str(text).strip()
    return ""


def _word_start(word: object) -> float:
    return _as_float(getattr(word, "start_time", None) or getattr(word, "start", None), 0.0)


def _word_end(word: object) -> float:
    end = _as_float(getattr(word, "end_time", None) or getattr(word, "end", None), 0.0)
    start = _word_start(word)
    return end if end > start else start + 0.01


def normalize_timed_words(words: Iterable[object], fallback_text: str = "") -> List[TranscriptWord]:
    out: List[TranscriptWord] = []
    for word in words or []:
        text = _word_text(word)
        if not text:
            continue
        start = _word_start(word)
        end = _word_end(word)
        out.append(TranscriptWord(text, start, end))
    if out:
        return sorted(out, key=lambda w: (w.start_time, w.end_time))
    return words_from_text(fallback_text, start=0.0, step=0.01) if fallback_text else []


def _join_words(words: Sequence[TranscriptWord]) -> str:
    return " ".join(word.text for word in words if word.text).strip()


def segment_delta_string(prev: str, new: str, raw: str = "") -> str:
    """String fallback for per-chunk translation delta."""
    prev, new, raw = prev.strip(), new.strip(), raw.strip()
    if not raw or new == prev:
        return ""
    if not prev:
        return raw or new
    if new.startswith(prev):
        suffix = new[len(prev):].strip()
        return suffix or raw

    prev_words = prev.split()
    new_words = new.split()
    common = 0
    for i in range(min(len(prev_words), len(new_words))):
        if prev_words[i] == new_words[i]:
            common = i + 1
        else:
            break
    if common > 0:
        suffix = " ".join(new_words[common:]).strip()
        if suffix:
            return suffix

    for k in range(min(len(prev_words), len(new_words)), 0, -1):
        if prev_words[-k:] == new_words[:k]:
            suffix = " ".join(new_words[k:]).strip()
            return suffix or raw
    if raw in prev:
        return ""
    return raw


def segment_delta_from_words(
    before: Sequence[TranscriptWord],
    after: Sequence[TranscriptWord],
    *,
    raw_chunk: str = "",
    tolerance: float = 0.15,
) -> str:
    """New spoken text since the last commit, using word timestamps."""
    if not after:
        return ""
    if not before:
        return raw_chunk.strip() or _join_words(after)

    prev_text = _join_words(before)
    next_text = _join_words(after)
    cutoff = max(word.end_time for word in before)
    tail_words = [word for word in after if word.start_time >= cutoff - tolerance]
    delta = _join_words(tail_words)
    if delta:
        return delta
    return segment_delta_string(prev_text, next_text, raw_chunk)


def stitch_committed_and_open(committed: str, open_text: str) -> str:
    """Stitch committed chunk finals with a cumulative open interim chunk."""
    committed = committed.strip()
    open_text = open_text.strip()
    if not committed:
        return open_text
    if not open_text:
        return committed
    if open_text.startswith(committed):
        return open_text

    committed_words = committed.split()
    open_words = open_text.split()
    if not committed_words or not open_words:
        return f"{committed} {open_text}".strip()

    if committed_words == open_words[: len(committed_words)]:
        return open_text

    common_prefix = 0
    for i in range(min(len(committed_words), len(open_words))):
        if committed_words[i] == open_words[i]:
            common_prefix = i + 1
        else:
            break
    # Chunk interims often restate from a shared anchor and revise the tail.
    if common_prefix >= 3 and len(open_words) >= len(committed_words):
        return open_text

    best_overlap = 0
    max_k = min(len(committed_words), len(open_words))
    for k in range(max_k, 0, -1):
        if committed_words[-k:] == open_words[:k]:
            best_overlap = k
            break
    if best_overlap:
        return " ".join(committed_words + open_words[best_overlap:]).strip()

    return f"{committed} {open_text}".strip()


class TimedTranscriptAssembler:
    """Assemble STT chunks by word timestamps instead of string overlap heuristics."""

    def __init__(self, *, overlap_tolerance: float = 0.15) -> None:
        self._words: List[TranscriptWord] = []
        self._overlap_tolerance = overlap_tolerance

    def clear(self) -> None:
        self._words.clear()

    @property
    def words(self) -> Tuple[TranscriptWord, ...]:
        return tuple(self._words)

    def text(self) -> str:
        return _join_words(self._words)

    def _merge_incoming(self, incoming: Sequence[TranscriptWord]) -> None:
        if not incoming:
            return

        start = incoming[0].start_time
        end = incoming[-1].end_time
        kept = [
            word
            for word in self._words
            if word.end_time <= start + self._overlap_tolerance
            or word.start_time >= end - self._overlap_tolerance
        ]
        self._words = sorted([*kept, *incoming], key=lambda word: (word.start_time, word.end_time))

    def commit(self, words: Iterable[object], fallback_text: str = "") -> str:
        incoming = normalize_timed_words(words, fallback_text)
        if not incoming:
            return self.text()
        self._merge_incoming(incoming)
        return self.text()

    def commit_with_delta(
        self, words: Iterable[object], fallback_text: str = ""
    ) -> Tuple[str, str]:
        before_text = self.text()
        incoming = normalize_timed_words(words, fallback_text)
        if not incoming:
            return self.text(), ""
        self._merge_incoming(incoming)
        after_text = self.text()
        delta = segment_delta_string(before_text, after_text, fallback_text)
        return after_text, delta

    def live_text(self, open_words: Iterable[object], fallback_text: str = "") -> str:
        incoming = normalize_timed_words(open_words, fallback_text)
        if not incoming:
            return self.text()

        start = incoming[0].start_time
        end = incoming[-1].end_time
        words = [
            word
            for word in self._words
            if word.end_time <= start + self._overlap_tolerance
            or word.start_time >= end - self._overlap_tolerance
        ]
        words.extend(incoming)
        return _join_words(sorted(words, key=lambda word: (word.start_time, word.end_time)))
