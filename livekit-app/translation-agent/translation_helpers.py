"""
Pure helpers for the LLM translation lanes (no LiveKit imports — fully unit-testable).

Covers:
- TranslationCache: LRU cache so repeated utterances skip the LLM round trip.
- stable_common_prefix: word-level local agreement (LA-2) for interim translation,
  the standard stability heuristic from simultaneous-MT literature — only display
  the prefix two consecutive candidate translations agree on, so live translated
  captions never flicker or retract.
- ends_sentence / ends_clause / ends_freeze_boundary / maybe_freeze_lane / split_tail / join_nonempty:
  sentence- and long-clause-boundary freezing of the utterance translation. Re-translating
  the whole utterance on every Deepgram is_final fixes cross-segment grammar (verb-final / SOV
  targets) but is O(n^2) on long monologues; freezing completed sentences or >10-word clauses
  bounds the re-translated tail and dispatches TTS earlier.
- resolve_livekit_display_name / _translation_covers_thought: shared between
  transcription_codeswitch_agent and transcription_only_agent so they never drift.
- build_translation_messages: prompt assembly with rolling (source -> target)
  context pairs as few-shot messages, optional source language context, plus must-preserve keyterms.
"""

from __future__ import annotations

import json
import re
from collections import OrderedDict
from typing import Any, List, Optional, Sequence, Tuple

LANG_NAMES = {
    "es": "Spanish",
    "es-DO": "Dominican Spanish (República Dominicana — use natural Dominican/Caribbean Spanish phrasing, vocabulary, and 'ustedes', never Castilian 'vosotros')",
    "es-CO": "Colombian Spanish (Colombia — use natural Colombian Spanish phrasing and 'ustedes')",
    "es-MX": "Mexican Spanish (México — use natural Mexican Spanish phrasing and 'ustedes')",
    "en": "English",
    "fr": "French",
    "fr-CA": "Canadian French",
    "de": "German",
    "de-CH": "Swiss German",
    "it": "Italian",
    "pt": "Portuguese",
    "pt-BR": "Brazilian Portuguese",
    "pt-PT": "European Portuguese",
    "zh": "Chinese",
    "zh-CN": "Mandarin Chinese",
    "zh-TW": "Traditional Chinese",
    "zh-HK": "Cantonese",
    "ja": "Japanese",
    "ko": "Korean",
    "ru": "Russian",
    "ar": "Arabic",
    "hi": "Hindi",
    "nl": "Dutch",
    "pl": "Polish",
    "tr": "Turkish",
    "vi": "Vietnamese",
    "uk": "Ukrainian",
    "tiv": "Tiv",
}

# Sentence-final punctuation across supported languages (Latin, CJK, Arabic),
# optionally followed by closing quotes/brackets.
_SENTENCE_END_RE = re.compile(
    r"[.!?。！？؟…]['\"”’»)\]]*\s*$"
)

# Clause-final punctuation (comma, semicolon, colon, em-dash, Arabic/CJK comma)
_CLAUSE_END_RE = re.compile(
    r"[,;:—–،、；：]['\"”’»)\]]*\s*$"
)

_WS_RE = re.compile(r"\s+")


def _parse_display_name_from_metadata(metadata: Any) -> str:
    if not metadata:
        return ""
    try:
        meta = json.loads(metadata) if isinstance(metadata, str) else metadata
        if isinstance(meta, dict):
            return str(meta.get("displayName") or meta.get("name") or "").strip()
    except Exception:
        return ""
    return ""


def resolve_livekit_display_name(participant: Any, identity: str = "") -> str:
    """Human label for a LiveKit participant (name / metadata), never the guest-uuid identity."""
    pid = identity or str(getattr(participant, "identity", "") or "")
    name = str(getattr(participant, "name", None) or "").strip() if participant is not None else ""
    if name and name != pid:
        return name
    from_meta = _parse_display_name_from_metadata(
        getattr(participant, "metadata", None) if participant is not None else None
    )
    if from_meta:
        return from_meta
    if re.match(r"^guest-[0-9a-f-]{36}$", pid, re.I):
        return "Guest"
    return name or pid or "Unknown"


def _translation_covers_thought(source: str, translated: str) -> bool:
    """False when the translation is only the first clause of a longer thought."""
    src_words = [w for w in (source or "").split() if w]
    tgt_words = [w for w in (translated or "").split() if w]
    if not src_words:
        return True
    if len(src_words) <= 8:
        return bool(tgt_words)
    return len(tgt_words) >= max(4, int(len(src_words) * 0.55))


class TranslationCache:
    """LRU cache keyed on (source_lang, target_lang, normalized text).

    max_size=0 disables caching entirely.
    """

    def __init__(self, max_size: int = 512):
        self.max_size = max(0, int(max_size))
        self._data: "OrderedDict[Tuple[str, str, str], str]" = OrderedDict()

    @staticmethod
    def _key(source_lang: str, target_lang: str, text: str) -> Optional[Tuple[str, str, str]]:
        norm = _WS_RE.sub(" ", text).strip().lower()
        if not norm:
            return None
        return (source_lang, target_lang, norm)

    def get(self, source_lang: str, target_lang: str, text: str) -> Optional[str]:
        if self.max_size == 0:
            return None
        key = self._key(source_lang, target_lang, text)
        if key is None:
            return None
        value = self._data.get(key)
        if value is not None:
            self._data.move_to_end(key)
        return value

    def put(self, source_lang: str, target_lang: str, text: str, translation: str) -> None:
        if self.max_size == 0:
            return
        key = self._key(source_lang, target_lang, text)
        if key is None or not translation.strip():
            return
        self._data[key] = translation
        self._data.move_to_end(key)
        while len(self._data) > self.max_size:
            self._data.popitem(last=False)


def stable_common_prefix(previous: str, current: str) -> str:
    """Word-level longest common prefix of two candidate translations (local agreement)."""
    prev_words = previous.split()
    curr_words = current.split()
    agreed: List[str] = []
    for a, b in zip(prev_words, curr_words):
        if a != b:
            break
        agreed.append(a)
    return " ".join(agreed)


def ends_sentence(text: str) -> bool:
    """True when text ends with sentence-final punctuation (safe point to freeze)."""
    return bool(_SENTENCE_END_RE.search(text.strip())) if text.strip() else False


def ends_clause(text: str) -> bool:
    """True when text ends with a clause separator (comma, semicolon, colon, dash)."""
    return bool(_CLAUSE_END_RE.search(text.strip())) if text.strip() else False


def ends_freeze_boundary(text: str, *, min_clause_words: int = 11) -> bool:
    """True when text ends a sentence OR ends a clause with >10 words."""
    stripped = (text or "").strip()
    if not stripped:
        return False
    if ends_sentence(stripped):
        return True
    if ends_clause(stripped) and len(stripped.split()) >= min_clause_words:
        return True
    return False


def maybe_freeze_lane(
    lane: Any,
    tail_src: str,
    committed_snapshot: str,
    translation: str,
    *,
    min_clause_words: int = 11,
) -> str:
    """Fold a sentence-complete (or >10-word clause-complete) tail into the frozen prefix.

    Returns the newly frozen translation chunk (or "" if not frozen) so the caller
    can immediately enqueue it to TTS.
    """
    clean_trans = (translation or "").strip()
    if not clean_trans or not ends_freeze_boundary(tail_src, min_clause_words=min_clause_words):
        return ""
    lane.frozen_tgt = join_nonempty(getattr(lane, "frozen_tgt", ""), clean_trans)
    lane.frozen_src = committed_snapshot
    lane.tail_translation = ""
    lane.interim_candidate = ""
    lane.interim_stable = ""
    lane.last_interim_src = ""
    return clean_trans


def stt_idle_timeout_ms(live_text: str, base_idle_ms: int = 3500) -> int:
    """Adaptive STT idle window before closing the current bubble into a new thought.

    - When the current text ends with sentence punctuation (. ? ! etc.), close
      slightly sooner (80% of base_idle_ms, e.g. 2800ms for a 3500ms base) so
      completed thoughts separate cleanly into a new bubble when the speaker
      starts talking again after a real pause.
    - When paused mid-sentence (no terminal punctuation yet), hold for the full
      base_idle_ms (3500ms) so a brief breath doesn't chop a clause in half.
    """
    base = max(400, int(base_idle_ms))
    if ends_sentence(live_text or ""):
        return max(400, int(round(base * 0.8)))
    return base


def should_break_turn(
    committed_text: str,
    age_sec: float,
    *,
    max_age_sec: float = 45.0,
    max_words: int = 110,
) -> bool:
    """True when an open caption bubble should close at a sentence boundary.

    Without this, a long monologue stays one ever-growing bubble (and TTS
    stays silent) until the speaker pauses for the full idle window. Breaks
    happen only at sentence-final punctuation so bubbles never split
    mid-sentence; the idle timer still closes sub-threshold thoughts.
    """
    text = (committed_text or "").strip()
    if not text or not ends_sentence(text):
        return False
    return age_sec >= max_age_sec or len(text.split()) >= max_words


def tts_remainder(already_enqueued: str, full_text: str = "") -> str:
    """Text still to speak: full_text minus the prefix already sent to TTS.

    Supports both `tts_remainder(spoken_prefix, full_text)` and
    `tts_remainder(full_text, spoken_prefix)` when one argument is a strict
    prefix of the other.
    """
    full = (full_text or "").strip()
    spoken = (already_enqueued or "").strip()
    if not full and spoken:
        return spoken
    if not full:
        return ""
    if not spoken:
        return full
    if full == spoken:
        return ""
    if full.startswith(spoken):
        return full[len(spoken):].strip()
    if spoken.startswith(full):
        return spoken[len(full):].strip()
    return full


def should_handoff_turn(
    *,
    other_has_open_turn: bool,
    other_vad_active: bool,
    other_idle_sec: float,
    interjector_is_final: bool,
    interjector_word_count: int,
    interjector_vad_active: bool = True,
    min_pause_sec: float = 0.85,
) -> bool:
    """True when Speaker B's speech should finalize Speaker A's paused turn (A -> B -> A)."""
    if not other_has_open_turn:
        return False
    if other_vad_active or other_idle_sec < min_pause_sec:
        return False
    if not interjector_is_final and not interjector_vad_active:
        return False
    if interjector_is_final and interjector_word_count >= 3:
        return True
    if interjector_vad_active and interjector_word_count >= 4:
        return True
    if interjector_is_final and interjector_word_count >= 2 and other_idle_sec >= 1.5:
        return True
    return False


def should_mark_interjection(
    *,
    other_has_open_turn: bool,
    interjector_is_final: bool,
    interjector_word_count: int,
    interjector_vad_active: bool = True,
) -> bool:
    """True when Speaker B spoke a substantial turn during Speaker A's active turn."""
    if not other_has_open_turn:
        return False
    if not interjector_is_final and not interjector_vad_active:
        return False
    if interjector_is_final and interjector_word_count >= 5:
        return True
    if interjector_vad_active and interjector_word_count >= 6:
        return True
    return False


def split_tail(committed_text: str, frozen_src: str) -> str:
    """Portion of the committed utterance not yet frozen."""
    if not frozen_src:
        return committed_text
    if committed_text.startswith(frozen_src):
        return committed_text[len(frozen_src):].strip()
    return committed_text


def join_nonempty(*parts: str) -> str:
    return " ".join(p.strip() for p in parts if p and p.strip())


def context_pairs_for_translation_call(
    context_pairs: Sequence[Tuple[str, str]],
    *,
    partial: bool,
) -> List[Tuple[str, str]]:
    """Few-shot examples are useful for finals, but wasteful for interim calls."""
    if partial:
        return []
    return list(context_pairs)


def llm_completion_token_cap(source_text: str) -> int:
    """Length-proportional output cap for translation completions."""
    word_cap = 16 + 4 * len(source_text.split())
    char_cap = 8 + len(source_text) // 2
    return min(768, max(64, word_cap, char_cap))


def resolve_language_name(lang: Optional[str]) -> str:
    if not lang:
        return ""
    cleaned = str(lang).strip()
    if not cleaned or cleaned.lower() == "multi":
        return ""
    if cleaned in LANG_NAMES:
        return LANG_NAMES[cleaned]
    base = cleaned.split("-")[0].lower()
    return LANG_NAMES.get(base, cleaned)


def build_translation_messages(
    *,
    target_lang_name: str,
    source_text: str,
    context_pairs: Sequence[Tuple[str, str]],
    keyterms: Sequence[str],
    partial: bool = False,
    source_lang: Optional[str] = None,
) -> List[Tuple[str, str]]:
    """Assemble (role, content) messages for one translation call.

    Rolling context pairs are injected as few-shot user/assistant turns — this both
    demonstrates the expected output format (translation only, no commentary) and
    keeps pronouns / register / terminology consistent across utterances.
    When `source_lang` is provided, `SOURCE_LANGUAGE: <name>` is included so short
    or ambiguous words translate accurately without echoing source words.
    """
    source_lang_name = resolve_language_name(source_lang)
    if source_lang_name:
        intro = (
            f"You are a professional simultaneous interpreter translating live captions "
            f"from {source_lang_name} to {target_lang_name}."
        )
    else:
        intro = f"You are a professional simultaneous interpreter translating live captions to {target_lang_name}."

    sys_lines = [
        intro,
        "Translate the user's text into the target language. Output ONLY the translation — no explanations, no quotes, no preamble, and never echo the SOURCE_LANGUAGE header.",
        "Preserve the speaker's tone and register. Keep names, numbers, and acronyms accurate.",
    ]
    if partial:
        sys_lines.append(
            "The text is a partial, incomplete utterance still being spoken. "
            "Translate only what is given; do not complete or guess the rest of the sentence."
        )
    terms = [t.strip() for t in keyterms if t and t.strip()]
    if terms:
        sys_lines.append(
            "Keep these terms exactly as written (do not translate them): " + ", ".join(terms) + "."
        )

    messages: List[Tuple[str, str]] = [("system", " ".join(sys_lines))]
    for src, tgt in context_pairs:
        src = (src or "").strip()
        tgt = (tgt or "").strip()
        if src and tgt:
            messages.append(("user", src))
            messages.append(("assistant", tgt))

    user_content = (
        f"SOURCE_LANGUAGE: {source_lang_name}\n{source_text}"
        if source_lang_name
        else source_text
    )
    messages.append(("user", user_content))
    return messages
