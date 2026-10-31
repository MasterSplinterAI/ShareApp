"""Helpers for Deepgram code-switch source-language routing."""

from __future__ import annotations

import re
from typing import Any, Iterable

_NON_LANGUAGE_CODES = frozenset({"multi", "auto", "und", "unknown"})

_CYRILLIC_LANGS = ("ru", "uk", "bg", "sr", "be", "mk", "kk")
_NON_LATIN_LANGS = frozenset(
    {*_CYRILLIC_LANGS, "ja", "zh", "ko", "ar", "he", "el", "hi", "th"}
)

_RE_CYRILLIC = re.compile(r"[\u0400-\u04FF]")
_RE_HIRAGANA_KATAKANA = re.compile(r"[\u3040-\u30FF]")
_RE_HANGUL = re.compile(r"[\uAC00-\uD7AF\u1100-\u11FF]")
_RE_CJK = re.compile(r"[\u4E00-\u9FFF]")
_RE_ARABIC = re.compile(r"[\u0600-\u06FF]")
_RE_HEBREW = re.compile(r"[\u0590-\u05FF]")
_RE_GREEK = re.compile(r"[\u0370-\u03FF]")
_RE_DEVANAGARI = re.compile(r"[\u0900-\u097F]")
_RE_THAI = re.compile(r"[\u0E00-\u0E7F]")
_RE_LATIN_WORD = re.compile(r"\b[a-zA-Z]{2,}\b")
_RE_NON_LATIN_CHAR = re.compile(
    r"[\u0370-\u06FF\u0900-\u097F\u0E00-\u0E7F\u1100-\u11FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]"
)


def normalize_language_code(lang: str | None) -> str:
    if not lang:
        return ""
    return str(lang).split("-")[0].lower()


def speech_data_detected_language(speech_data: Any) -> str:
    """Extract Deepgram/LiveKit detected language code from SpeechData.

    When Deepgram runs with `language="multi"`, `livekit-plugins-deepgram`
    initializes `SpeechData.language = "multi"` and only overwrites it when
    `alt["languages"]` is populated. Filter out `"multi"` and similar sentinel
    values so only real ISO language codes count as detections.
    """
    lang = getattr(speech_data, "language", None)
    if lang is None:
        return ""
    if hasattr(lang, "language"):
        code = normalize_language_code(str(lang.language))
    else:
        code = normalize_language_code(str(lang))
    if code in _NON_LANGUAGE_CODES:
        return ""
    return code


def infer_script_language(
    text: str | None,
    configured_lang: str = "en",
    room_langs: Iterable[str] = (),
) -> str:
    """Infer spoken language from the Unicode script of the trailing words in `text`.

    In mid-utterance code-switching (e.g. a speaker starts in English and switches
    to Russian within the same turn), Deepgram's utterance-level `languages[0]`
    stays `'en'` because the turn began in English, and on interim events Deepgram
    sends `'multi'`. Inspecting the trailing words catches script switches (Latin ↔
    Cyrillic/CJK/Arabic/etc.) immediately on the first interim or final chunk.
    """
    cleaned = (text or "").strip()
    if not cleaned:
        return ""

    words = cleaned.split()
    tail = " ".join(words[-6:]) if len(words) > 6 else cleaned

    candidates = [normalize_language_code(configured_lang)] + [
        normalize_language_code(c) for c in (room_langs or ())
    ]
    candidates = [c for c in candidates if c]

    if len(_RE_CYRILLIC.findall(tail)) >= 2:
        for c in candidates:
            if c in _CYRILLIC_LANGS:
                return c
        return "ru"

    if len(_RE_HIRAGANA_KATAKANA.findall(tail)) >= 1:
        return "ja"

    if len(_RE_HANGUL.findall(tail)) >= 1:
        return "ko"

    if len(_RE_CJK.findall(tail)) >= 1:
        if "ja" in candidates and "zh" not in candidates:
            return "ja"
        return "zh"

    if len(_RE_ARABIC.findall(tail)) >= 2:
        return "ar"

    if len(_RE_HEBREW.findall(tail)) >= 2:
        return "he"

    if len(_RE_GREEK.findall(tail)) >= 2:
        return "el"

    if len(_RE_DEVANAGARI.findall(tail)) >= 2:
        return "hi"

    if len(_RE_THAI.findall(tail)) >= 2:
        return "th"

    # If the trailing words are purely Latin (and none are non-Latin), while the
    # speaker's profile or current room includes a non-Latin language, resolve to
    # the Latin room language (defaulting to 'en').
    if not _RE_NON_LATIN_CHAR.search(tail):
        latin_words = _RE_LATIN_WORD.findall(tail)
        if len(latin_words) >= 2:
            for c in candidates:
                if c and c not in _NON_LATIN_LANGS:
                    return c
            return "en"

    return ""


def resolve_detected_language(
    speech_data: Any,
    text: str = "",
    configured_lang: str = "en",
    room_langs: Iterable[str] = (),
) -> str:
    """Combine Deepgram's language tag with Unicode script detection on `text`.

    - Non-Latin script evidence (e.g. Cyrillic characters in `text`) always wins over
      a conflicting Latin tag (`'en'`) from Deepgram's `languages[0]`.
    - When Deepgram's tag is `'multi'` / empty (all interim events), script inference
      provides immediate language detection.
    """
    dg_lang = speech_data_detected_language(speech_data)
    script_lang = infer_script_language(text, configured_lang, room_langs)

    if script_lang in _NON_LATIN_LANGS:
        # Never let Deepgram mis-tag Cyrillic/CJK/Arabic text as 'en'
        return script_lang

    if dg_lang:
        # If Deepgram says a non-Latin language (e.g. 'ru') but the trailing words are
        # purely Latin ('How are you guys?'), prefer the trailing script language.
        if dg_lang in _NON_LATIN_LANGS and script_lang and script_lang not in _NON_LATIN_LANGS:
            return script_lang
        return dg_lang

    return script_lang


def text_has_mixed_scripts(text: str | None) -> bool:
    """True when a single utterance mixes Latin words and non-Latin script (e.g. English + Russian)."""
    if not text:
        return False
    has_latin = len(_RE_LATIN_WORD.findall(text)) >= 2
    has_non_latin = len(_RE_NON_LATIN_CHAR.findall(text)) >= 3
    return has_latin and has_non_latin


def effective_source_language(
    configured_lang: str,
    detected_lang: str,
    current_effective: str,
    *,
    min_detected_len: int = 2,
) -> str:
    """Choose caption/translation source language for one utterance.

    Uses detected STT language when it differs from the participant profile
    (code-switch). Snaps back to configured language when detection matches
    profile or is empty/unreliable — avoids spurious flips on noise.
    """
    configured = normalize_language_code(configured_lang or "en") or "en"
    detected = normalize_language_code(detected_lang)
    current = normalize_language_code(current_effective) or configured

    if not detected or len(detected) < min_detected_len or detected in _NON_LANGUAGE_CODES:
        return current

    if detected != configured:
        return detected

    return configured


def next_source_flip(
    current_effective: str,
    detected_lang: str,
    pending_lang: str,
    pending_count: int,
    *,
    is_final: bool = True,
    word_count: int = 0,
    required: int = 2,
) -> tuple[str, str, int, bool]:
    """Decide whether the effective source language should flip.

    - Any `is_final=True` detection from Deepgram flips immediately (`required=1`)
      so single-sentence code-switches are never dropped.
    - An `is_final=False` (interim) detection with `word_count >= 3` (or non-Latin
      script with `word_count >= 2`) also flips immediately so live STT + live
      translation appear in real time while the speaker is still talking.
    - Very short 1–2 word interims require `required` (default 2) consecutive
      agreeing detections to avoid flipping on a 1-word filler or cough.
    """
    current = normalize_language_code(current_effective) or "en"
    detected = normalize_language_code(detected_lang)
    pending = normalize_language_code(pending_lang)

    if not detected or len(detected) < 2 or detected in _NON_LANGUAGE_CODES:
        return current, pending, pending_count, False
    if detected == current:
        return current, "", 0, False

    min_words_for_instant_interim = 2 if detected in _NON_LATIN_LANGS else 3
    if is_final or word_count >= min_words_for_instant_interim:
        return detected, "", 0, True

    count = pending_count + 1 if detected == pending else 1
    if count >= max(1, required):
        return detected, "", 0, True
    return current, detected, count, False


def lane_is_same_language(
    effective_source: str,
    target_lang: str,
    *,
    turn_is_multilingual: bool = False,
) -> bool:
    """True when listener target matches the effective spoken source language.

    When `turn_is_multilingual` is True (the speaker has code-switched mid-turn,
    e.g. spoke English then Russian in the same bubble), NO lane is treated as
    same-language so every listener receives a clean, single-language translation
    of the mixed utterance in their chosen language.
    """
    if turn_is_multilingual:
        return False
    src = normalize_language_code(effective_source)
    tgt = normalize_language_code(target_lang)
    if not src or not tgt:
        return False
    return src == tgt
