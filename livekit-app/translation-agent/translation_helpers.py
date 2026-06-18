"""
Pure helpers for the LLM translation lanes (no LiveKit imports — fully unit-testable).

Covers:
- TranslationCache: LRU cache so repeated utterances skip the LLM round trip.
- stable_common_prefix: word-level local agreement (LA-2) for interim translation,
  the standard stability heuristic from simultaneous-MT literature — only display
  the prefix two consecutive candidate translations agree on, so live translated
  captions never flicker or retract.
- ends_sentence / split_tail / join_nonempty: sentence-boundary freezing of the
  utterance translation. Re-translating the whole utterance on every Deepgram
  is_final fixes cross-segment grammar (verb-final / SOV targets) but is O(n^2)
  on long monologues; freezing completed sentences bounds the re-translated tail.
- build_translation_messages: prompt assembly with rolling (source -> target)
  context pairs as few-shot messages plus must-preserve keyterms.
"""

from __future__ import annotations

import re
from collections import OrderedDict
from typing import List, Optional, Sequence, Tuple

# Sentence-final punctuation across supported languages (Latin, CJK, Arabic),
# optionally followed by closing quotes/brackets.
_SENTENCE_END_RE = re.compile(
    r"[.!?。！？؟…]['\"”’»)\]]*\s*$"
)

_WS_RE = re.compile(r"\s+")


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


def split_tail(committed_text: str, frozen_src: str) -> str:
    """Portion of the committed utterance not yet frozen.

    If Deepgram revised earlier text so the frozen prefix no longer matches,
    fall back to the full committed text (correctness over cost).
    """
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


def build_translation_messages(
    *,
    target_lang_name: str,
    source_text: str,
    context_pairs: Sequence[Tuple[str, str]],
    keyterms: Sequence[str],
    partial: bool = False,
) -> List[Tuple[str, str]]:
    """Assemble (role, content) messages for one translation call.

    Rolling context pairs are injected as few-shot user/assistant turns — this both
    demonstrates the expected output format (translation only, no commentary) and
    keeps pronouns / register / terminology consistent across utterances.
    """
    sys_lines = [
        f"You are a professional simultaneous interpreter translating live captions to {target_lang_name}.",
        "Translate the user's text. Output ONLY the translation — no explanations, no quotes, no preamble.",
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
    messages.append(("user", source_text))
    return messages
