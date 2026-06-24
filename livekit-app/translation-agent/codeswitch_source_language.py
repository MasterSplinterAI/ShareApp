"""Helpers for Deepgram code-switch source-language routing (experimental agent)."""

from __future__ import annotations

from typing import Any


def normalize_language_code(lang: str | None) -> str:
    if not lang:
        return ""
    return str(lang).split("-")[0].lower()


def speech_data_detected_language(speech_data: Any) -> str:
    """Extract Deepgram/LiveKit detected language code from SpeechData."""
    lang = getattr(speech_data, "language", None)
    if lang is None:
        return ""
    if hasattr(lang, "language"):
        return normalize_language_code(str(lang.language))
    return normalize_language_code(str(lang))


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

    if not detected or len(detected) < min_detected_len:
        return current

    if detected != configured:
        return detected

    return configured


def lane_is_same_language(effective_source: str, target_lang: str) -> bool:
    """True when listener target matches the effective spoken source language."""
    src = normalize_language_code(effective_source)
    tgt = normalize_language_code(target_lang)
    if not src or not tgt:
        return False
    return src == tgt
