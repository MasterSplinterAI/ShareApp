"""Helpers for Deepgram code-switch source-language routing (experimental agent)."""

from __future__ import annotations

from typing import Any

_NON_LANGUAGE_CODES = frozenset({"multi", "auto", "und", "unknown"})


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
    - An `is_final=False` (interim) detection with `word_count >= 3` also flips
      immediately so live STT + live translation appear in real time while the
      speaker is still talking (e.g. solo testing English speech with Spanish UI).
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

    if is_final or word_count >= 3:
        return detected, "", 0, True

    count = pending_count + 1 if detected == pending else 1
    if count >= max(1, required):
        return detected, "", 0, True
    return current, detected, count, False


def lane_is_same_language(effective_source: str, target_lang: str) -> bool:
    """True when listener target matches the effective spoken source language."""
    src = normalize_language_code(effective_source)
    tgt = normalize_language_code(target_lang)
    if not src or not tgt:
        return False
    return src == tgt
