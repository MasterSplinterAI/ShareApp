#!/usr/bin/env python3
"""
Transcription-only translation agent (STT → LLM captions) with optional TTS lanes.

No spoken translation - transcriptions only. Nothing is lost on interruptions.
One shared STT+VAD pipeline per speaking participant; each target language is a translation lane.
Publishes partial (live) and final (original + translated) to the data channel (destination-filtered when possible).
"""

import os
import json
import asyncio
import logging
import sys
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Deque, Dict, List, Optional, Set, Tuple

from cost_reporter import CostReporter
from caption_targeting import compute_caption_targets
from deepgram_caption_buffer import DeepgramCaptionBuffer
from tts_lane import TtsLane, resolve_tts_provider
from codeswitch_source_language import (
    effective_source_language,
    lane_is_same_language,
    speech_data_detected_language,
)
from residual_guard import is_residual_repeat
from demo_orchestrator import DemoRoomOrchestrator
from translation_helpers import (
    TranslationCache,
    build_translation_messages,
    context_pairs_for_translation_call,
    ends_sentence,
    join_nonempty,
    llm_completion_token_cap,
    split_tail,
    stable_common_prefix,
)

from livekit import rtc
from livekit.agents import JobContext, WorkerOptions, cli, AutoSubscribe
from livekit.plugins import silero

try:
    from livekit.plugins import deepgram, openai
    PLUGINS_AVAILABLE = True
except ImportError:
    PLUGINS_AVAILABLE = False
    deepgram = None
    openai = None

try:
    from livekit.plugins import gladia
    GLADIA_AVAILABLE = True
except ImportError:
    GLADIA_AVAILABLE = False
    gladia = None

try:
    from livekit.plugins import noise_cancellation
    NOISE_CANCELLATION_AVAILABLE = True
except ImportError:
    NOISE_CANCELLATION_AVAILABLE = False
    noise_cancellation = None

def _deepgram_endpointing_ms() -> int:
    """Silence (ms) before Deepgram emits END_OF_SPEECH."""
    raw = os.getenv("DEEPGRAM_ENDPOINTING_MS", "800").strip()
    try:
        ms = int(raw)
    except ValueError:
        ms = 800
    return max(25, min(ms, 5000))


def _gladia_endpointing_sec() -> float:
    raw = os.getenv("GLADIA_ENDPOINTING_SEC", "").strip()
    if raw:
        try:
            return max(0.05, min(float(raw), 5.0))
        except ValueError:
            pass
    return max(0.05, min(_deepgram_endpointing_ms() / 1000.0, 5.0))


def _gladia_max_no_endpoint_sec() -> Optional[float]:
    """Force a Gladia final after N seconds of continuous speech (no silence).

    Long monologues otherwise produce no finals — and with native translation,
    no translations — until the speaker pauses.
    """
    raw = os.getenv("GLADIA_MAX_NO_ENDPOINT_SEC", "").strip()
    if not raw:
        return None
    try:
        return max(1.0, min(float(raw), 60.0))
    except ValueError:
        return None


def _gladia_translation_grace_sec() -> float:
    """Max wait for the remaining target languages' translations before committing."""
    raw = os.getenv("GLADIA_TRANSLATION_GRACE_SEC", "1.0").strip()
    try:
        return max(0.1, min(float(raw), 3.0))
    except ValueError:
        return 1.0


def _stt_stream_supports_flush(provider: str) -> bool:
    """Gladia STT treats flush() as stop_recording — never call it on live Gladia streams."""
    return provider != "gladia"


def _deepgram_stt_idle_ms() -> int:
    """
    Finalize the live bubble after this long with no *changed* transcript from Deepgram.
    Does not depend on room silence — background noise won't block finalize.
    """
    raw = os.getenv("DEEPGRAM_STT_IDLE_MS", "1500").strip()
    try:
        ms = int(raw)
    except ValueError:
        ms = 1500
    return max(400, min(ms, 5000))


def _llm_model() -> str:
    """Translation model — pinned so plugin upgrades can't silently change it."""
    return os.getenv("LLM_MODEL", "gpt-4.1-mini").strip() or "gpt-4.1-mini"


def _llm_temperature() -> float:
    raw = os.getenv("LLM_TEMPERATURE", "0.0").strip()
    try:
        return max(0.0, min(float(raw), 2.0))
    except ValueError:
        return 0.0


def _llm_timeout_sec() -> float:
    """Per-attempt budget for one translation call (connect + full stream)."""
    raw = os.getenv("LLM_TIMEOUT_SEC", "6.0").strip()
    try:
        return max(1.0, min(float(raw), 30.0))
    except ValueError:
        return 6.0


def _interim_translation_enabled() -> bool:
    """Live local-agreement translation of interim transcripts (cross-language lanes)."""
    return os.getenv("INTERIM_TRANSLATION_ENABLED", "true").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def _interim_translation_min_interval_ms() -> int:
    raw = os.getenv("INTERIM_TRANSLATION_MIN_INTERVAL_MS", "600").strip()
    try:
        ms = int(raw)
    except ValueError:
        ms = 600
    return max(150, min(ms, 5000))


def _translation_context_pairs() -> int:
    """Rolling (source → target) pairs carried across turns for consistency."""
    raw = os.getenv("TRANSLATION_CONTEXT_PAIRS", "3").strip()
    try:
        return max(0, min(int(raw), 10))
    except ValueError:
        return 3


def _translation_cache_size() -> int:
    raw = os.getenv("TRANSLATION_CACHE_SIZE", "512").strip()
    try:
        return max(0, min(int(raw), 10000))
    except ValueError:
        return 512


def _csv_env(name: str) -> List[str]:
    raw = os.getenv(name, "").strip()
    if not raw:
        return []
    return [t.strip() for t in raw.split(",") if t.strip()]


def _translation_keyterms() -> List[str]:
    """Terms the LLM must keep verbatim (brand names, product terms)."""
    return _csv_env("TRANSLATION_KEYTERMS")


DEFAULT_DEEPGRAM_KEYTERMS = [
    "Cassiterite", "Rutile", "Ilmenite", "Bauxite", "Chalcopyrite", "Galena",
    "Sphalerite", "Pentlandite", "Magnetite", "Hematite", "Chromite", "Molybdenite",
    "Scheelite", "Wolframite", "Coltan", "Monazite", "Sperrylite", "Cooperite",
    "Laurite", "Braggite", "Kimberlite", "Zircon", "Xenotime", "Tin ore",
    "Copper", "Aluminum", "Zinc", "Lead", "Nickel", "Cobalt", "Molybdenum",
    "Tungsten", "Lithium", "Gold", "Silver", "Platinum", "Palladium", "Rhodium",
    "Iridium", "Ruthenium", "Osmium", "PGM", "Platinum Group Metals", "Rare earth",
    "LME", "London Metal Exchange", "Backwardation", "Contango", "Spot price",
    "Futures", "Arbitrage", "Assay", "Concentrate", "Cathode", "Anode", "Bullion",
    "Ingot", "Dore", "Refining", "Smelting", "Warehousing", "Hedging", "Liquidity",
    "Volatility", "Leverage", "Margin", "Settlement", "Collateral", "Escrow",
    "KYC", "AML", "Compliance", "Derivatives", "SaaS", "API", "Fintech", "BaaS",
    "FaaS",
]


def _deepgram_keyterms() -> List[str]:
    """Nova-3 keyterm prompting (improves STT accuracy on domain terms)."""
    configured = _csv_env("DEEPGRAM_KEYTERMS")
    return configured or list(DEFAULT_DEEPGRAM_KEYTERMS)


def _speech_times(speech_data: Any) -> Tuple[float, float]:
    start = getattr(speech_data, "start_time", None) or 0.0
    end = getattr(speech_data, "end_time", None) or 0.0
    try:
        return float(start), float(end)
    except (TypeError, ValueError):
        return 0.0, 0.0


def _gladia_translation_enabled() -> bool:
    return os.getenv("GLADIA_TRANSLATION_ENABLED", "true").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def _tts_enabled() -> bool:
    return os.getenv("TTS_ENABLED", "false").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def _tts_max_lanes() -> int:
    raw = os.getenv("TTS_MAX_LANES", "4").strip()
    try:
        return max(1, min(int(raw), 16))
    except ValueError:
        return 4


def _tts_stale_sec() -> float:
    raw = os.getenv("TTS_STALE_SEC", "8.0").strip()
    try:
        return max(1.0, min(float(raw), 20.0))
    except ValueError:
        return 8.0


def _gladia_cross_lang_targets(speaker_lang: str, targets: Set[str]) -> List[str]:
    """Distinct listener languages that differ from the speaker (Gladia translation targets)."""
    sl = (speaker_lang or "en").split("-")[0].lower()
    out: Set[str] = set()
    for t in targets:
        if t.split("-")[0].lower() != sl:
            out.add(t.split("-")[0].lower())
    return sorted(out)


def _speech_data_language_code(speech_data: Any) -> str:
    lang = getattr(speech_data, "language", None)
    if lang is None:
        return ""
    if hasattr(lang, "language"):
        return str(lang.language).split("-")[0].lower()
    return str(lang).split("-")[0].lower()


def _gladia_source_text(speech_data: Any, fallback: str) -> str:
    source_texts = getattr(speech_data, "source_texts", None) or []
    for src in source_texts:
        if src and str(src).strip():
            return str(src).strip()
    return fallback.strip()


def _is_gladia_translation_final(speech_data: Any) -> bool:
    source_texts = getattr(speech_data, "source_texts", None) or []
    return any(src and str(src).strip() for src in source_texts)


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    force=True
)
logger = logging.getLogger(__name__)
logger.info("=" * 60)
logger.info("📝 TRANSCRIPTION CODESWITCH AGENT MODULE LOADED (detected source language)")
logger.info("=" * 60)


LANG_NAMES = {
    "es": "Spanish", "en": "English", "fr": "French", "de": "German",
    "it": "Italian", "pt": "Portuguese",
    "zh": "Chinese", "zh-CN": "Mandarin Chinese", "zh-TW": "Traditional Chinese",
    "ja": "Japanese",
    "ko": "Korean", "ru": "Russian", "ar": "Arabic", "hi": "Hindi",
    "tiv": "Tiv",
}

VALID_CAPTION_MODES = ("off", "transcription_only", "transcription_translation")

# Process-wide Silero VAD cache (see _load_shared_vad).
_VAD_MODEL_CACHE: Dict[tuple, Any] = {}


def is_likely_agent_identity(identity: str) -> bool:
    """Aligned with frontend RoomControls — cloud agents may not use agent-* prefix."""
    if not identity:
        return False
    s = identity.lower()
    return (
        s.startswith("agent-")
        or "translation" in s
        or "-agent" in s
        or "agent_" in s
    )


class SpeakerRunContext:
    """Mutable target-language set for one speaker pipeline (listener-only changes update this)."""

    def __init__(self, speaker_id: str):
        self.speaker_id = speaker_id
        self._lock = asyncio.Lock()
        self._targets: Set[str] = set()

    async def set_targets(self, targets: Set[str]) -> None:
        async with self._lock:
            self._targets = targets.copy()

    async def get_targets(self) -> Set[str]:
        async with self._lock:
            return self._targets.copy()


@dataclass
class SpeakerCaptionSession:
    """Hooks so another speaker's pipeline can commit this speaker's in-progress bubble."""

    speaker_id: str
    finalize_now: Callable[[], Awaitable[None]]
    has_open_turn: Callable[[], bool]


@dataclass
class TargetLaneState:
    target_lang: str
    is_same_language: bool
    llm_instance: Optional[Any]
    target_lang_name: str
    llm_provider: str = "openai"
    # Same-language lanes mirror STT segments here (multi-slot). Foreign lanes
    # derive their text from frozen_tgt/tail_translation via display_translation().
    turn_translated_parts: List[str] = field(default_factory=list)
    pending_translate_tasks: List[asyncio.Task] = field(default_factory=list)
    # --- whole-utterance translation state (foreign lanes) ---
    # The utterance translation is re-derived from the full unfrozen source tail on
    # every is_final (fixes cross-segment grammar for verb-final/SOV targets), and
    # sentence-complete prefixes are frozen so long monologues don't re-translate
    # the whole utterance forever.
    frozen_src: str = ""  # sentence-complete source prefix already translated
    frozen_tgt: str = ""  # its committed translation
    tail_translation: str = ""  # streaming translation of the unfrozen tail
    current_task: Optional[asyncio.Task] = None  # in-flight FINAL tail translation
    # --- interim local agreement (live translation while speaking) ---
    interim_task: Optional[asyncio.Task] = None
    interim_candidate: str = ""  # last candidate translation of the interim tail
    interim_stable: str = ""  # word-prefix two consecutive candidates agree on
    last_interim_at: float = 0.0
    last_interim_src: str = ""
    # --- rolling cross-turn context for pronoun/terminology consistency ---
    context_pairs: Deque[Tuple[str, str]] = field(default_factory=lambda: deque(maxlen=3))

    def display_translation(self) -> str:
        """Current best translation for this lane: frozen prefix + live tail.

        While a FINAL re-translation is streaming, its text starts shorter than the
        interim local-agreement text already on screen — show whichever covers more
        so captions never visibly shrink.
        """
        tail = (
            self.tail_translation
            if len(self.tail_translation) >= len(self.interim_stable)
            else self.interim_stable
        )
        return join_nonempty(self.frozen_tgt, tail)

    def reset_turn(self) -> None:
        self.frozen_src = ""
        self.frozen_tgt = ""
        self.tail_translation = ""
        self.interim_candidate = ""
        self.interim_stable = ""
        self.last_interim_src = ""

    def cancel_inflight(self) -> None:
        for t in (self.current_task, self.interim_task):
            if t and not t.done():
                t.cancel()


class TranscriptionOnlyAgent:
    def __init__(self):
        # One language per user: STT when they speak + translation target for what they read.
        self.participant_languages: Dict[str, str] = {}
        self.translation_enabled: Dict[str, bool] = {}
        self.voice_enabled: Dict[str, bool] = {}
        # One asyncio task per speaker: shared STT/VAD, fan-out to per-target translation lanes.
        self.speaker_pipelines: Dict[str, asyncio.Task] = {}
        self.tts_lanes: Dict[str, TtsLane] = {}
        self._speaker_ctx: Dict[str, SpeakerRunContext] = {}
        self.host_vad_sensitivity = "normal"
        self._update_debounce_task: asyncio.Task | None = None
        self._update_debounce_sec = 0.4  # Coalesce rapid language switches
        self._agent_ready_ping_task: asyncio.Task | None = None
        # Caption config set by host via data channel
        self.caption_mode: str = "transcription_translation"
        self.caption_languages: List[str] = []
        # Cost reporter — initialized in entrypoint once room name is known
        self.cost_reporter: Optional[CostReporter] = None
        self._caption_sessions: Dict[str, SpeakerCaptionSession] = {}
        self._caption_sessions_lock = asyncio.Lock()
        # Serializes update_assistants: it awaits mid-flight while mutating
        # speaker_pipelines, so concurrent invocations (debounce + disconnect +
        # translation-off) could create duplicate pipelines or cancel fresh ones.
        self._reconcile_lock = asyncio.Lock()
        # Fire-and-forget tasks (cost emits, data handlers) tracked so shutdown can
        # drain them and a flood can't leak unbounded orphans.
        self._bg_tasks: Set[asyncio.Task] = set()
        # Providers that failed fast for a speaker (e.g. Gladia 429 concurrency limit
        # — free tier allows ONE concurrent live session). The next pipeline attempt
        # skips them and falls through the provider ladder; cleared after a healthy run.
        self._stt_skip_providers: Dict[str, Set[str]] = {}
        # Repeated utterances (greetings, confirmations) skip the LLM round trip.
        self._translation_cache = TranslationCache(max_size=_translation_cache_size())
        self.demo_orchestrator: Optional[DemoRoomOrchestrator] = None

    def _spawn_bg(self, coro: Awaitable[Any]) -> asyncio.Task:
        task = asyncio.create_task(coro)
        self._bg_tasks.add(task)
        task.add_done_callback(self._bg_tasks.discard)
        return task

    def _apply_caption_config(self, cc: Any, source: str) -> bool:
        """Validate + apply caption_config; returns True when something changed."""
        if not isinstance(cc, dict):
            return False
        new_mode = cc.get("mode", self.caption_mode)
        if new_mode not in VALID_CAPTION_MODES:
            logger.warning(f"caption_config from {source}: invalid mode {new_mode!r} — ignored")
            new_mode = self.caption_mode
        raw_langs = cc.get("languages", self.caption_languages)
        new_langs = (
            [str(l) for l in raw_langs if isinstance(l, str) and l.strip()]
            if isinstance(raw_langs, list)
            else self.caption_languages
        )
        if new_mode == self.caption_mode and new_langs == self.caption_languages:
            return False
        self.caption_mode = new_mode
        self.caption_languages = new_langs
        logger.info(
            f"📋 caption_config applied from {source}: "
            f"mode={self.caption_mode!r} languages={self.caption_languages}"
        )
        return True

    async def _register_caption_session(self, session: SpeakerCaptionSession) -> None:
        async with self._caption_sessions_lock:
            self._caption_sessions[session.speaker_id] = session

    async def _unregister_caption_session(self, speaker_id: str) -> None:
        async with self._caption_sessions_lock:
            self._caption_sessions.pop(speaker_id, None)

    async def _finalize_other_speakers(self, active_speaker_id: str) -> None:
        """When someone else starts speaking, commit their open live bubble for chronology."""
        async with self._caption_sessions_lock:
            others = [
                s for sid, s in self._caption_sessions.items() if sid != active_speaker_id
            ]
        for session in others:
            try:
                if session.has_open_turn():
                    logger.info(
                        f"[{active_speaker_id}] ↪︎ committing open caption from "
                        f"{session.speaker_id!r} (another speaker started)"
                    )
                    await session.finalize_now()
            except Exception as e:
                logger.warning(
                    f"[{active_speaker_id}] failed to finalize {session.speaker_id!r}: {e}"
                )

    def _normalize_language_code(self, lang: str) -> str:
        if not lang:
            return "en"
        return lang.split("-")[0].lower()

    def _listener_identities_for_target_lang(self, target_lang: str) -> List[str]:
        """Participants who want to read captions in this language (translation on)."""
        norm_t = self._normalize_language_code(target_lang)
        out: List[str] = []
        for pid, lang in self.participant_languages.items():
            if not self.translation_enabled.get(pid, False):
                continue
            if self._normalize_language_code(lang) == norm_t:
                out.append(pid)
        return out

    def _voice_targets(self) -> Set[str]:
        """Target languages with at least one voice-enabled listener."""
        if self.caption_mode == "off":
            return set()
        return {
            lang
            for pid, lang in self.participant_languages.items()
            if lang
            and self.translation_enabled.get(pid, False)
            and self.voice_enabled.get(pid, False)
        }

    async def _emit_tts_cost(
        self,
        chars: int,
        provider: str,
        language: str,
        participant: str,
    ) -> None:
        if not self.cost_reporter or chars <= 0:
            return
        await self.cost_reporter.emit_tts(
            chars=chars,
            provider=provider,
            language=language,
            participant=participant,
        )

    async def _reconcile_tts_lanes(self, ctx: JobContext) -> None:
        if not _tts_enabled():
            if self.tts_lanes:
                logger.info("🔇 TTS_ENABLED=false — tearing down all TTS lanes")
            for lang in list(self.tts_lanes.keys()):
                lane = self.tts_lanes.pop(lang, None)
                if lane is not None:
                    await lane.aclose()
            return

        desired = sorted(self._voice_targets())
        max_lanes = _tts_max_lanes()
        if len(desired) > max_lanes:
            logger.warning(
                "TTS lane limit reached (%d): requested=%s using=%s",
                max_lanes,
                desired,
                desired[:max_lanes],
            )
            desired = desired[:max_lanes]
        desired_set = set(desired)

        for lang in list(self.tts_lanes.keys()):
            if lang in desired_set:
                continue
            lane = self.tts_lanes.pop(lang, None)
            if lane is not None:
                await lane.aclose()
                logger.info("🔈 TTS lane removed: %s", lang)

        for lang in desired:
            if lang in self.tts_lanes:
                continue
            lane = TtsLane(
                room=ctx.room,
                language=lang,
                stale_after_sec=_tts_stale_sec(),
                provider=resolve_tts_provider(lang),
                emit_cost_hook=self._emit_tts_cost,
            )
            try:
                await lane.start()
            except Exception as e:
                logger.warning("TTS lane start failed for %s: %s", lang, e)
                await lane.aclose()
                continue
            self.tts_lanes[lang] = lane
            logger.info(
                "🔈 TTS lane ready: %s track=tts-%s provider=%s",
                lang,
                lang,
                lane.provider,
            )

    async def _shutdown_all_assistants(self, ctx: JobContext) -> None:
        """Cancel every pipeline task on agent shutdown (SIGTERM / room end)."""
        keys = list(self.speaker_pipelines.keys())
        tasks: list[asyncio.Task] = []
        for k in keys:
            self._speaker_ctx.pop(k, None)
            tok = self.speaker_pipelines.pop(k, None)
            if isinstance(tok, asyncio.Task):
                tok.cancel()
                tasks.append(tok)
            elif hasattr(tok, "aclose"):
                await tok.aclose()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        tts_lanes = list(self.tts_lanes.items())
        self.tts_lanes.clear()
        for _, lane in tts_lanes:
            await lane.aclose()
        logger.info(f"🛑 Shutdown: cancelled {len(tasks)} speaker pipeline task(s)")

    async def _cancel_speaker_pipeline(self, speaker_id: str) -> None:
        """Stop the shared STT task for this speaker (language change, translation off, or leave)."""
        self._speaker_ctx.pop(speaker_id, None)
        tok = self.speaker_pipelines.pop(speaker_id, None)
        if isinstance(tok, asyncio.Task):
            tok.cancel()
            await asyncio.gather(tok, return_exceptions=True)
        elif hasattr(tok, "aclose"):
            await tok.aclose()

    def _load_shared_vad(self):
        """One Silero VAD model per process, shared across speaker pipelines.

        Loading a model per pipeline ballooned memory ("process memory usage is
        high" → worker restart mid-meeting). Streams created from a shared model
        are independent; this is the documented prewarm pattern.
        """
        params = self._vad_params()
        key = tuple(sorted(params.items()))
        model = _VAD_MODEL_CACHE.get(key)
        if model is None:
            model = silero.VAD.load(**params)
            _VAD_MODEL_CACHE[key] = model
        return model

    def _vad_params(self) -> dict:
        # activation_threshold: higher = fewer false positives from background noise.
        # min_speech_duration: ignore very short noise bursts.
        preset = (os.getenv("VAD_PRESET") or self.host_vad_sensitivity or "normal").strip().lower()
        presets = {
            "quiet": {
                "activation_threshold": 0.52,
                "min_speech_duration": 0.18,
                "min_silence_duration": 1.0,
            },
            "normal": {
                "activation_threshold": 0.58,
                "min_speech_duration": 0.22,
                "min_silence_duration": 1.1,
            },
            "noisy": {
                "activation_threshold": 0.68,
                "min_speech_duration": 0.28,
                "min_silence_duration": 1.2,
            },
            "ultra_noisy": {
                "activation_threshold": 0.78,
                "min_speech_duration": 0.35,
                "min_silence_duration": 1.3,
            },
        }
        params = dict(presets.get(preset, presets["normal"]))
        if os.getenv("VAD_ACTIVATION_THRESHOLD"):
            params["activation_threshold"] = float(os.getenv("VAD_ACTIVATION_THRESHOLD"))
        if os.getenv("VAD_MIN_SILENCE_SEC"):
            params["min_silence_duration"] = float(os.getenv("VAD_MIN_SILENCE_SEC"))
        if os.getenv("VAD_MIN_SPEECH_SEC"):
            params["min_speech_duration"] = float(os.getenv("VAD_MIN_SPEECH_SEC"))
        params["prefix_padding_duration"] = 0.8
        return params

    def _audio_stream_noise_cancellation(self):
        """BVC on inbound mic audio — suppresses background voices and room noise (LiveKit Cloud)."""
        if not NOISE_CANCELLATION_AVAILABLE or not noise_cancellation:
            return None
        if os.getenv("NOISE_CANCELLATION", "bvc").strip().lower() in ("0", "false", "off", "none"):
            return None
        try:
            return noise_cancellation.BVC()
        except Exception as e:
            logger.warning("BVC noise cancellation unavailable: %s", e)
            return None

    async def entrypoint(self, ctx: JobContext):
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        logger.info(
            f"📋 Room: {ctx.room.name} - Codeswitch captions agent "
            f"(TTS {'enabled' if _tts_enabled() else 'disabled'})"
        )

        org_id: Optional[str] = None
        # Read caption_config and org_id from room metadata (persisted by host, supports late-joining agent)
        try:
            raw_meta = getattr(ctx.room, "metadata", None) or ""
            if raw_meta:
                meta = json.loads(raw_meta)
                org_id = meta.get("org_id") or None
                self._apply_caption_config(meta.get("caption_config"), "room metadata (startup)")
                if meta.get("demo") and meta.get("demoSessionId"):
                    read_lang = meta.get("readLang") or "en"
                    agent_names = meta.get("agentNames") or []

                    async def publish_demo_caption(msg_dict: dict, reliable: bool) -> None:
                        await ctx.room.local_participant.publish_data(
                            json.dumps(msg_dict).encode("utf-8"),
                            topic="transcription",
                            reliable=reliable,
                        )

                    async def publish_demo_phase(phase: str, active_speaker: Optional[str]) -> None:
                        await ctx.room.local_participant.publish_data(
                            json.dumps(
                                {
                                    "type": "demo_phase",
                                    "phase": phase,
                                    "activeSpeaker": active_speaker,
                                }
                            ).encode("utf-8"),
                            topic="demo",
                            reliable=True,
                        )

                    self.demo_orchestrator = DemoRoomOrchestrator(
                        demo_session_id=str(meta["demoSessionId"]),
                        read_lang=str(read_lang),
                        publish_caption=publish_demo_caption,
                        get_tts_lane=lambda lang: self.tts_lanes.get(
                            str(lang).split("-")[0].lower()
                        ),
                        on_phase=publish_demo_phase,
                        agent_names=set(str(n) for n in agent_names),
                    )
                    logger.info(
                        "🎭 Demo room orchestrator active session=%s readLang=%s",
                        meta["demoSessionId"],
                        read_lang,
                    )
                    self.demo_orchestrator.schedule_opening()
        except Exception as e:
            logger.warning(f"Room metadata parse failed: {e}")

        self.cost_reporter = CostReporter(meeting_id=ctx.room.name, org_id=org_id)

        # Broadcast to existing participants so they re-send their language preferences.
        # This handles agent restarts / redeployments mid-call where participants are
        # already in the room and will never fire a fresh language_update otherwise.
        async def _broadcast_agent_ready():
            await asyncio.sleep(1.5)  # let the room settle before announcing
            try:
                await ctx.room.local_participant.publish_data(
                    json.dumps({"type": "agent_ready"}).encode("utf-8"),
                    topic="agent",
                    reliable=True,
                )
                logger.info("📢 Broadcast agent_ready — waiting for participant language sync")
            except Exception as e:
                logger.warning(f"agent_ready broadcast failed: {e}")

        asyncio.create_task(_broadcast_agent_ready())

        def _schedule_update():
            """Debounce update_assistants for language switches to avoid rapid teardown/create."""
            if self._update_debounce_task and not self._update_debounce_task.done():
                self._update_debounce_task.cancel()
            async def _run_later():
                try:
                    await asyncio.sleep(self._update_debounce_sec)
                except asyncio.CancelledError:
                    return
                await self.update_assistants(ctx)
            self._update_debounce_task = asyncio.create_task(_run_later())

        async def handle_data(data: rtc.DataPacket):
            try:
                msg = json.loads(data.data.decode("utf-8"))
                # Trust only LiveKit-bound identity (JWT). Never accept client JSON identity fields —
                # they would allow spoofing another participant's language settings.
                if not data.participant or not getattr(data.participant, "identity", None):
                    logger.warning(
                        "language message ignored: missing authenticated participant on data packet"
                    )
                    return
                participant_id = data.participant.identity
                msg_type = msg.get("type")

                if msg_type == "language_update":
                    lang = (
                        msg.get("language")
                        or msg.get("spoken_language")
                        or msg.get("spokenLanguage")
                        or "en"
                    )
                    enabled = msg.get("enabled", False)
                    voice_enabled = msg.get(
                        "voiceEnabled",
                        msg.get("voice_enabled", self.voice_enabled.get(participant_id, False)),
                    )
                elif msg_type == "language_preference":
                    lang = (
                        msg.get("target_language")
                        or msg.get("language")
                        or msg.get("spoken_language")
                        or msg.get("spokenLanguage")
                        or "en"
                    )
                    enabled = msg.get("translation_enabled", msg.get("enabled", False))
                    voice_enabled = msg.get(
                        "voiceEnabled",
                        msg.get("voice_enabled", self.voice_enabled.get(participant_id, False)),
                    )
                elif msg_type == "caption_config":
                    # Room-global control — only honored via room metadata, which the
                    # backend writes after authenticating the host (POST /v2/rooms/:name/
                    # caption-config → room_metadata_changed below). Honoring the raw data
                    # channel here would let ANY participant kill captions for the room.
                    logger.info(
                        f"📋 caption_config data packet from {participant_id} ignored "
                        "(applied via authenticated room metadata instead)"
                    )
                    return
                else:
                    logger.debug(f"Data received (ignored): type={msg_type}, from={participant_id}")
                    return

                # Detect language change BEFORE updating stored value.
                # The STT language is baked into each pipeline at creation time.
                # The same key (e.g. "alice:en") can mean "caption-only English STT"
                # OR "translate Spanish→English" — different STT, same dict key.
                # update_assistants won't remove it because the key stays in `expected`,
                # so we must explicitly tear down the speaker's old pipelines here.
                old_lang = self.participant_languages.get(participant_id)
                lang_changed = old_lang is not None and old_lang != lang

                self.participant_languages[participant_id] = lang
                self.translation_enabled[participant_id] = bool(enabled)
                self.voice_enabled[participant_id] = bool(enabled) and bool(voice_enabled)

                logger.info(
                    f"📥 Language update: {participant_id} → {lang} (was {old_lang!r}), "
                    f"enabled={enabled}, voiceEnabled={self.voice_enabled[participant_id]}"
                )

                if lang_changed:
                    await self._cancel_speaker_pipeline(participant_id)
                    logger.info(
                        f"🔄 Tore down speaker pipeline for {participant_id!r}: "
                        f"{old_lang!r} → {lang!r} (STT language changed)"
                    )

                if enabled:
                    # Debounce: rapid switches (es→en→es) coalesce into one update
                    _schedule_update()
                else:
                    await self._cancel_speaker_pipeline(participant_id)
                    await self.update_assistants(ctx)
            except Exception as e:
                logger.error(f"Data error: {e}", exc_info=True)

        def on_data(data: rtc.DataPacket):
            self._spawn_bg(handle_data(data))

        def on_room_metadata_changed(old_metadata: str, new_metadata: str):
            # Authenticated caption_config path: host POSTs to the backend, the backend
            # updates room metadata, LiveKit fans the change out to the agent here.
            try:
                meta = json.loads(new_metadata) if new_metadata else {}
            except Exception as e:
                logger.warning(f"room_metadata_changed: parse failed: {e}")
                return
            if self._apply_caption_config(meta.get("caption_config"), "room metadata"):
                _schedule_update()

        async def on_connected(participant: rtc.RemoteParticipant):
            ident = participant.identity or ""
            if not is_likely_agent_identity(ident):
                t = self._agent_ready_ping_task
                if t is not None and not t.done():
                    t.cancel()

                async def _ping_agent_ready():
                    try:
                        await asyncio.sleep(1.2)
                        await ctx.room.local_participant.publish_data(
                            json.dumps({"type": "agent_ready"}).encode("utf-8"),
                            topic="agent",
                            reliable=True,
                        )
                        logger.info(
                            "📢 agent_ready re-broadcast after human participant_connected "
                            "(rejoin / missed first broadcast)"
                        )
                    except asyncio.CancelledError:
                        return
                    except Exception as e:
                        logger.warning(f"agent_ready re-broadcast failed: {e}")

                self._agent_ready_ping_task = asyncio.create_task(_ping_agent_ready())
            _schedule_update()

        async def on_track_published(pub: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
            if pub.kind == rtc.TrackKind.KIND_AUDIO:
                _schedule_update()

        async def on_disconnected(participant: rtc.RemoteParticipant):
            pid = participant.identity
            await self._cancel_speaker_pipeline(pid)
            self.participant_languages.pop(pid, None)
            self.translation_enabled.pop(pid, None)
            self.voice_enabled.pop(pid, None)
            await self.update_assistants(ctx)

        ctx.room.on("data_received", on_data)
        ctx.room.on("room_metadata_changed", on_room_metadata_changed)
        ctx.room.on("participant_connected", lambda p: self._spawn_bg(on_connected(p)))
        ctx.room.on("track_published", lambda pub, p: self._spawn_bg(on_track_published(pub, p)))
        ctx.room.on("participant_disconnected", lambda p: self._spawn_bg(on_disconnected(p)))

        try:
            await asyncio.Event().wait()
        finally:
            t = self._agent_ready_ping_task
            if t is not None and not t.done():
                t.cancel()
                await asyncio.gather(t, return_exceptions=True)
            await self._shutdown_all_assistants(ctx)
            # Drain in-flight background work (cost emits, data handlers) briefly so
            # the last turn's telemetry isn't lost on SIGTERM.
            pending_bg = [t for t in self._bg_tasks if not t.done()]
            if pending_bg:
                _, still_pending = await asyncio.wait(pending_bg, timeout=3.0)
                for t in still_pending:
                    t.cancel()
            if self.cost_reporter:
                await self.cost_reporter.aclose()

    async def update_assistants(self, ctx: JobContext):
        # Serialized: the body awaits while mutating speaker_pipelines, and it is
        # reachable concurrently from the debounce task, disconnects, metadata
        # changes, and the translation-off fast path.
        async with self._reconcile_lock:
            await self._update_assistants_locked(ctx)

    async def _update_assistants_locked(self, ctx: JobContext):
        # caption_mode='off' → kill all pipelines and do nothing
        if self.caption_mode == "off":
            for sid in list(self.speaker_pipelines.keys()):
                await self._cancel_speaker_pipeline(sid)
            await self._reconcile_tts_lanes(ctx)
            logger.info("⏸️ caption_mode='off' — all speaker pipelines stopped")
            return

        speakers = [
            p.identity for p in ctx.room.remote_participants.values()
            if any(pub.kind == rtc.TrackKind.KIND_AUDIO for pub in p.track_publications.values())
            and not is_likely_agent_identity(p.identity)
        ]
        targets = compute_caption_targets(
            self.participant_languages,
            self.translation_enabled,
            caption_languages=self.caption_languages,
        )

        logger.info(
            f"📊 update_assistants: speakers={speakers}, targets={targets}, "
            f"participant_langs={dict(self.participant_languages)}, "
            f"enabled={dict(self.translation_enabled)}, voice={dict(self.voice_enabled)}"
        )

        expected = set()

        # Never default speaker language to "en" — late joiners would get English STT for Spanish speech.
        # Skip until we have an explicit language_update from that participant.
        def _speaker_lang(speaker_id: str):
            return self.participant_languages.get(speaker_id)

        # Codeswitch A/B: one lane per listener target so detected spoken language
        # can route translation even when profile language differs from speech.
        for speaker in speakers:
            speaker_lang = _speaker_lang(speaker)
            if speaker_lang is None:
                logger.info(f"⏳ No language yet for speaker {speaker!r} — skip STT until they send preferences")
                continue
            for target in targets:
                expected.add(f"{speaker}:{target}")

        # Map expected "speaker:target" pairs → one shared STT pipeline per speaker, N translation lanes.
        expected_speakers: Set[str] = set()
        targets_by_speaker: Dict[str, Set[str]] = {}
        for key in expected:
            if ":" not in key:
                continue
            sp, tgt = key.split(":", 1)
            expected_speakers.add(sp)
            targets_by_speaker.setdefault(sp, set()).add(tgt)

        # Drop pipelines for speakers no longer in the expected graph
        for sid in list(self.speaker_pipelines.keys()):
            if sid not in expected_speakers:
                await self._cancel_speaker_pipeline(sid)

        # Recycle dead speaker tasks (late joiner race, runtime error)
        for sid in list(self.speaker_pipelines.keys()):
            if sid not in expected_speakers:
                continue
            t = self.speaker_pipelines.get(sid)
            if isinstance(t, asyncio.Task) and t.done():
                try:
                    exc = t.exception()
                except asyncio.InvalidStateError:
                    exc = None
                if exc is not None and not isinstance(exc, asyncio.CancelledError):
                    logger.warning(f"🔁 Recycling dead speaker pipeline {sid}: {exc}")
                else:
                    logger.info(f"🔁 Recycling finished speaker pipeline {sid} (recreate)")
                self._speaker_ctx.pop(sid, None)
                self.speaker_pipelines.pop(sid, None)

        for speaker in speakers:
            speaker_lang = _speaker_lang(speaker)
            if speaker_lang is None:
                continue
            ts = targets_by_speaker.get(speaker)
            if not ts:
                continue
            task = self.speaker_pipelines.get(speaker)
            if task is None or (isinstance(task, asyncio.Task) and task.done()):
                if isinstance(task, asyncio.Task) and task.done():
                    self._speaker_ctx.pop(speaker, None)
                    self.speaker_pipelines.pop(speaker, None)
                rc = SpeakerRunContext(speaker)
                self._speaker_ctx[speaker] = rc
                await rc.set_targets(ts)
                pipeline_task = asyncio.create_task(self._run_speaker_pipeline(ctx, rc))

                def _log_pipeline_crash(t: asyncio.Task, sp: str = speaker) -> None:
                    # Setup-phase exceptions (before the pipeline's own try block) would
                    # otherwise die silently — e.g. a provider constructor raising.
                    if t.cancelled():
                        return
                    exc = t.exception()
                    if exc is not None:
                        logger.error(f"🔥 Speaker pipeline {sp!r} crashed: {exc!r}", exc_info=exc)

                pipeline_task.add_done_callback(_log_pipeline_crash)
                self.speaker_pipelines[speaker] = pipeline_task
                logger.info(f"✅ Speaker pipeline (shared STT): {speaker} targets={sorted(ts)}")
            else:
                await self._speaker_ctx[speaker].set_targets(ts)
                logger.debug(f"📎 Updated translation targets for {speaker}: {sorted(ts)}")

        await self._reconcile_tts_lanes(ctx)

    def _create_stt_instance(
        self,
        speaker_id: str,
        speaker_lang: str,
        *,
        skip_providers: Optional[Set[str]] = None,
        gladia_translation_targets: Optional[List[str]] = None,
    ):
        """Single shared STT for one speaker (one instance per speaker pipeline).

        Returns (stt_instance, provider_name) tuple; provider_name used for cost reporting.
        """
        L = f"[{speaker_id}]"
        if not speaker_lang:
            logger.error(f"{L} _create_stt_instance: missing speaker_lang")
            return None, "unknown"
        is_cloud = os.getenv("LIVEKIT_CLOUD", "").lower() == "true"
        stt_lang = speaker_lang.split("-")[0] if speaker_lang else "en"
        stt_provider = os.getenv("STT_PROVIDER", "deepgram").strip().lower()
        normalized_lang = self._normalize_language_code(stt_lang)
        stt_instance: Optional[Any] = None
        stt_provider_name = "unknown"
        excluded = skip_providers or set()

        def _try_deepgram():
            nonlocal stt_provider_name
            if "deepgram" in excluded:
                return None
            if not (PLUGINS_AVAILABLE and deepgram and (is_cloud or os.getenv("DEEPGRAM_API_KEY"))):
                return None
            endpointing_ms = _deepgram_endpointing_ms()
            stt_kwargs = dict(
                model="nova-3",
                language="multi",
                interim_results=True,
                punctuate=True,
                smart_format=True,
                endpointing_ms=endpointing_ms,
            )
            keyterms = _deepgram_keyterms()
            if keyterms:
                stt_kwargs["keyterm"] = keyterms
            try:
                inst = deepgram.STT(**stt_kwargs)
            except TypeError:
                # Older plugin compatibility: keyterms plural was supported before
                # the SDK standardized on Deepgram's nova-3 `keyterm` argument.
                if "keyterm" in stt_kwargs:
                    stt_kwargs["keyterms"] = stt_kwargs.pop("keyterm")
                    try:
                        inst = deepgram.STT(**stt_kwargs)
                    except TypeError:
                        stt_kwargs.pop("keyterms", None)
                        inst = deepgram.STT(**stt_kwargs)
                else:
                    inst = deepgram.STT(**stt_kwargs)
            logger.info(
                f"{L} STT: Deepgram nova-3 lang=multi (auto-detect) "
                f"endpointing_ms={endpointing_ms} "
                f"keyterms={len(keyterms)} (shared)"
            )
            stt_provider_name = "deepgram"
            return inst

        def _try_gladia():
            nonlocal stt_provider_name
            if "gladia" in excluded:
                return None
            if not (GLADIA_AVAILABLE and gladia and (is_cloud or os.getenv("GLADIA_API_KEY"))):
                return None
            endpointing_sec = _gladia_endpointing_sec()
            trans_targets = gladia_translation_targets or []
            use_gladia_trans = _gladia_translation_enabled() and bool(trans_targets)
            gladia_kwargs = dict(
                model="solaria-1",
                interim_results=True,
                code_switching=True,
                sample_rate=16000,
                endpointing=endpointing_sec,
                translation_enabled=use_gladia_trans,
                translation_target_languages=trans_targets if use_gladia_trans else [],
            )
            max_no_endpoint = _gladia_max_no_endpoint_sec()
            if max_no_endpoint is not None:
                gladia_kwargs["maximum_duration_without_endpointing"] = max_no_endpoint
            inst = gladia.STT(**gladia_kwargs)
            if use_gladia_trans:
                logger.info(
                    f"{L} STT: Gladia solaria-1 code_switching=True "
                    f"endpointing={endpointing_sec}s max_no_endpoint={max_no_endpoint} "
                    f"native_translation={trans_targets}"
                )
            else:
                logger.info(
                    f"{L} STT: Gladia solaria-1 code_switching=True "
                    f"endpointing={endpointing_sec}s (shared, STT-only)"
                )
            stt_provider_name = "gladia"
            return inst

        def _try_openai():
            nonlocal stt_provider_name
            if "openai" in excluded:
                return None
            if not (PLUGINS_AVAILABLE and openai and (is_cloud or os.getenv("OPENAI_API_KEY"))):
                return None
            # language must never be None: plugin >=1.5 does LanguageCode(language)
            # which crashes on None (AttributeError on .strip).
            inst = openai.STT(model="gpt-4o-transcribe", language=normalized_lang or "en")
            logger.info(
                f"{L} STT: OpenAI gpt-4o-transcribe lang={normalized_lang!r} (shared, no interim)"
            )
            stt_provider_name = "openai"
            return inst

        provider_order = {
            "deepgram": [_try_deepgram, _try_openai],
            "gladia": [_try_gladia, _try_deepgram, _try_openai],
            "openai": [_try_openai, _try_deepgram],
        }.get(stt_provider, [_try_deepgram, _try_openai])

        for attempt in provider_order:
            stt_instance = attempt()
            if stt_instance is not None:
                break

        if stt_instance is None:
            logger.error(f"{L} No STT provider available (STT_PROVIDER={stt_provider})")
        return stt_instance, stt_provider_name

    def _create_llm_for_target(self, speaker_id: str, target_lang: str):
        """Returns (llm_instance, provider_name) tuple; provider_name used for cost reporting."""
        L = f"[{speaker_id}→{target_lang}]"
        is_cloud = os.getenv("LIVEKIT_CLOUD", "").lower() == "true"
        llm_provider = os.getenv("LLM_PROVIDER", "openai").strip().lower()
        llm_provider_name = "openai"

        def _try_openai_llm():
            nonlocal llm_provider_name
            if not (PLUGINS_AVAILABLE and openai and (is_cloud or os.getenv("OPENAI_API_KEY"))):
                return None
            model = _llm_model()
            # Client-level timeout/retries guard connection failures; the per-call
            # asyncio.wait_for in translate_tail guards mid-stream hangs.
            llm_kwargs = dict(
                model=model,
                temperature=_llm_temperature(),
                timeout=_llm_timeout_sec(),
                max_retries=1,
            )
            try:
                inst = openai.LLM(**llm_kwargs)
            except TypeError:
                # Older plugin without timeout/max_retries kwargs
                inst = openai.LLM(model=model, temperature=_llm_temperature())
            logger.info(
                f"{L} LLM: OpenAI {model} temp={_llm_temperature()} "
                f"timeout={_llm_timeout_sec()}s"
            )
            llm_provider_name = "openai"
            return inst

        llm_order = [_try_openai_llm]

        llm_instance = None
        for attempt in llm_order:
            llm_instance = attempt()
            if llm_instance is not None:
                break
        if llm_instance is None:
            logger.error(f"{L} No LLM available (LLM_PROVIDER={llm_provider})")
        return llm_instance, llm_provider_name

    async def _prewarm_llm(self, llm_instance: Any, speaker_id: str, target_lang: str) -> None:
        """Open the LLM's HTTPS connection before the first real utterance.

        The first request on a cold client pays DNS + TLS + connection setup; on a
        slow path that pushes the first translation past its timeout and the opening
        utterance degrades to untranslated text (seen as a stuck 'Translating…').
        A tiny throwaway request here makes the first real call hit a warm pool.
        """
        from livekit.agents.llm import ChatContext

        L = f"[{speaker_id}→{target_lang}]"
        try:
            chat_ctx = ChatContext()
            chat_ctx.add_message(role="user", content="ping")
            t0 = time.perf_counter()
            stream = llm_instance.chat(chat_ctx=chat_ctx)
            try:
                async for _chunk in stream:
                    break  # first token proves the connection is up
            finally:
                await stream.aclose()
            logger.info(
                f"{L} LLM prewarmed in {round((time.perf_counter() - t0) * 1000)}ms"
            )
        except Exception as e:  # noqa: BLE001
            # Best-effort: a failed prewarm just means the first call is cold.
            logger.debug(f"{L} LLM prewarm failed: {e}")
    async def _run_speaker_pipeline(self, job_ctx: JobContext, run_ctx: SpeakerRunContext) -> None:
        """One STT + VAD per speaker; fan out FINAL segments to per-target LLM lanes."""
        from livekit.agents.llm import ChatContext
        from livekit.agents.stt import SpeechEventType

        speaker_id = run_ctx.speaker_id
        L = f"[{speaker_id}]"
        configured_speaker_lang = self.participant_languages.get(speaker_id) or "en"
        effective_source_lang: List[str] = [configured_speaker_lang]
        lanes: Dict[str, TargetLaneState] = {}
        use_gladia_native_translation: List[bool] = [False]
        stt_instance: Optional[Any] = None
        stt_provider_name = "unknown"

        async def compute_gladia_translation_targets() -> List[str]:
            targets = await run_ctx.get_targets()
            sl = self.participant_languages.get(speaker_id)
            return _gladia_cross_lang_targets(sl or "en", targets)

        gladia_applied_targets: List[Optional[List[str]]] = [None]

        async def sync_gladia_translation_options() -> None:
            if stt_provider_name != "gladia" or not _gladia_translation_enabled():
                use_gladia_native_translation[0] = False
                return
            if stt_instance is None or not hasattr(stt_instance, "update_options"):
                return
            trans_targets = await compute_gladia_translation_targets()
            # update_options triggers a Gladia websocket reconnect — only call it when
            # the target set actually changed, never on routine lane reconciles.
            if gladia_applied_targets[0] == trans_targets:
                return
            use_native = bool(trans_targets)
            try:
                stt_instance.update_options(
                    translation_enabled=use_native,
                    translation_target_languages=trans_targets,
                )
                gladia_applied_targets[0] = trans_targets
                use_gladia_native_translation[0] = use_native
                logger.info(f"{L} Gladia native translation targets={trans_targets}")
            except Exception as e:
                logger.warning(f"{L} Gladia update_options failed: {e}")

        async def reconcile_lanes() -> None:
            targets = await run_ctx.get_targets()
            eff = effective_source_lang[0]
            for tgt in list(lanes.keys()):
                if tgt not in targets:
                    st = lanes.pop(tgt)
                    st.cancel_inflight()
                    for t in st.pending_translate_tasks:
                        t.cancel()
                    if st.pending_translate_tasks:
                        await asyncio.gather(*st.pending_translate_tasks, return_exceptions=True)
            for tgt in targets:
                if tgt in lanes:
                    lane = lanes[tgt]
                    new_same = lane_is_same_language(eff, tgt)
                    if lane.is_same_language == new_same:
                        continue
                    lane.cancel_inflight()
                    lane.is_same_language = new_same
                    if new_same:
                        lane.llm_instance = None
                        lane.llm_provider = "openai"
                    elif use_gladia_native_translation[0]:
                        lane.llm_provider = "gladia"
                        lane.llm_instance = None
                    else:
                        llm, llm_pname = self._create_llm_for_target(speaker_id, tgt)
                        if llm is None:
                            logger.error(f"{L}→{tgt} No LLM — skipping translation lane")
                            lanes.pop(tgt, None)
                            continue
                        lane.llm_instance = llm
                        lane.llm_provider = llm_pname
                        self._spawn_bg(self._prewarm_llm(llm, speaker_id, tgt))
                    logger.info(
                        f"{L}→{tgt} lane mode updated effective={eff!r} same_language={new_same}"
                    )
                    continue
                is_same = lane_is_same_language(eff, tgt)
                llm = None
                llm_pname = "openai"
                if not is_same:
                    if use_gladia_native_translation[0]:
                        llm_pname = "gladia"
                    else:
                        llm, llm_pname = self._create_llm_for_target(speaker_id, tgt)
                        if llm is None:
                            logger.error(f"{L}→{tgt} No LLM — skipping translation lane")
                            continue
                        # Warm the connection now so the FIRST utterance translates
                        # within budget instead of paying cold-start inside the call.
                        self._spawn_bg(self._prewarm_llm(llm, speaker_id, tgt))
                lanes[tgt] = TargetLaneState(
                    target_lang=tgt,
                    is_same_language=is_same,
                    llm_instance=llm,
                    target_lang_name=LANG_NAMES.get(tgt, tgt),
                    llm_provider=llm_pname,
                    context_pairs=deque(maxlen=_translation_context_pairs()),
                )
            await sync_gladia_translation_options()

        async def publish_lane(
            msg_dict: dict,
            tgt_lang: str,
            is_same_language_lane: bool,
            reliable: bool = False,
        ) -> None:
            # Broadcast every transcription to all participants. This supports the
            # room-wide captions log (every client keeps a full transcript) and lets each
            # frontend render the dominant line in its own selected language while still
            # seeing translations underneath. is_same_language_lane is kept for future
            # targeted-delivery options but is unused on the broadcast path.
            payload = json.dumps(msg_dict).encode("utf-8")
            await job_ctx.room.local_participant.publish_data(
                payload,
                topic="transcription",
                reliable=reliable,
            )

        # Guard: if captions are disabled, don't start the pipeline
        if self.caption_mode == "off":
            logger.info(f"{L} caption_mode='off' — pipeline skipped")
            return

        speaker_lang = self.participant_languages.get(speaker_id)
        if not speaker_lang:
            logger.error(f"{L} No speaker language — abort pipeline")
            return

        initial_gladia_targets = await compute_gladia_translation_targets()
        skip = self._stt_skip_providers.get(speaker_id) or set()
        stt_instance, stt_provider_name = self._create_stt_instance(
            speaker_id,
            speaker_lang,
            skip_providers=skip,
            gladia_translation_targets=initial_gladia_targets,
        )
        gladia_applied_targets[0] = initial_gladia_targets
        use_gladia_native_translation[0] = (
            stt_provider_name == "gladia"
            and _gladia_translation_enabled()
            and bool(initial_gladia_targets)
        )
        if stt_instance is None:
            # Every provider (including fallbacks) is exhausted — reset so the next
            # attempt retries the full ladder rather than staying dead forever.
            self._stt_skip_providers.pop(speaker_id, None)
            return
        logger.info(
            f"{L} Caption pipeline STT provider={stt_provider_name!r} "
            f"gladia_native_translation={use_gladia_native_translation[0]} "
            f"skip_providers={sorted(skip) or '[]'} "
            f"(configured STT_PROVIDER={os.getenv('STT_PROVIDER', 'deepgram')!r})"
        )
        vad_instance = self._load_shared_vad()

        # Non-streaming STT (e.g. OpenAI gpt-4o-transcribe on plugins >=1.5) must be
        # wrapped: .stream() on it raises and would kill the pipeline.
        try:
            if not getattr(stt_instance.capabilities, "streaming", True):
                from livekit.agents import stt as lk_stt

                stt_instance = lk_stt.StreamAdapter(stt=stt_instance, vad=vad_instance)
                logger.info(f"{L} STT wrapped in StreamAdapter (non-streaming provider)")
        except Exception as e:
            logger.warning(f"{L} StreamAdapter wrap check failed: {e}")

        participant = None
        for _attempt in range(30):
            for p in job_ctx.room.remote_participants.values():
                if p.identity == speaker_id:
                    participant = p
                    break
            if participant:
                break
            await asyncio.sleep(0.1)
        if not participant:
            logger.warning(f"{L} Participant not found after wait")
            return

        audio_stream_kwargs = dict(
            participant=participant,
            track_source=rtc.TrackSource.SOURCE_MICROPHONE,
            sample_rate=16000,
            num_channels=1,
        )
        nc = self._audio_stream_noise_cancellation()
        if nc is not None:
            audio_stream_kwargs["noise_cancellation"] = nc
            logger.info(f"{L} BVC noise cancellation enabled on inbound audio")
        audio_stream = rtc.AudioStream.from_participant(**audio_stream_kwargs)
        stt_stream = stt_instance.stream()
        vad_stream = vad_instance.stream()

        turn_id: List[Optional[str]] = [None]
        # Canonical is_final buffer + open interim (see deepgram_caption_buffer.py).
        # All STT providers route through this buffer; finalize is driven by the
        # STT-idle timer (armed on new text and on VAD END_OF_SPEECH).
        dg_buffer = DeepgramCaptionBuffer()
        seg_counter = [0]
        vad_speech_active = [False]
        stt_speech_active = [False]
        turn_start_time = [0.0]
        # Track cumulative speech seconds per turn for STT cost reporting
        seg_speech_start: List[float] = [0.0]
        turn_stt_seconds: List[float] = [0.0]
        last_live_publish: List[str] = [""]
        # Post-finalize residual guard: Deepgram keeps streaming trailing is_final/interim
        # events for an utterance we already committed. Without this, those trailing events
        # open a brand-new turn and re-render the same words as a duplicate bubble. Main never
        # hit this because it finalized only on VAD silence (after the stream went quiet).
        last_finalized_norm: List[str] = [""]
        last_finalized_at: List[float] = [0.0]

        def _residual_guard_sec() -> float:
            return min(max(_deepgram_stt_idle_ms() / 1000.0 + 1.5, 1.5), 5.0)

        def is_residual_after_finalize(candidate: str) -> bool:
            prev = last_finalized_norm[0]
            if not prev:
                return False
            if time.time() - last_finalized_at[0] > _residual_guard_sec():
                return False
            return is_residual_repeat(candidate, prev)

        def lane_context_pairs(lane: TargetLaneState) -> List[Tuple[str, str]]:
            """Rolling cross-turn pairs, plus the frozen in-utterance pair (most recent)."""
            pairs = list(lane.context_pairs)
            if lane.frozen_src and lane.frozen_tgt:
                pairs.append((lane.frozen_src, lane.frozen_tgt))
            return pairs

        async def publish_lane_translation_partial(lane: TargetLaneState, tgt_lang: str) -> None:
            await publish_lane(
                {
                    "type": "transcription",
                    "originalText": dg_buffer.committed_text() or dg_buffer.live_text(),
                    "text": lane.display_translation(),
                    "language": tgt_lang,
                    "sourceLanguage": effective_source_lang[0],
                    "participant_id": speaker_id,
                    "partial": True,
                    "final": False,
                    "timestamp": asyncio.get_event_loop().time(),
                    "transcriptionId": turn_id[0],
                    "sttProvider": stt_provider_name,
                },
                tgt_lang,
                is_same_language_lane=lane.is_same_language,
            )

        async def run_llm_stream(
            lane: TargetLaneState,
            tgt_lang: str,
            source_text: str,
            *,
            partial: bool,
            on_delta: Optional[Callable[[str], Awaitable[None]]] = None,
        ) -> Tuple[str, Any]:
            """One LLM streaming call. Returns (text, usage). Raises on failure."""
            context_pairs = context_pairs_for_translation_call(
                lane_context_pairs(lane),
                partial=partial,
            )
            messages = build_translation_messages(
                target_lang_name=lane.target_lang_name,
                source_text=source_text,
                context_pairs=context_pairs,
                keyterms=_translation_keyterms(),
                partial=partial,
            )
            chat_ctx = ChatContext()
            for role, content in messages:
                chat_ctx.add_message(role=role, content=content)
            accumulated = ""
            last_usage = None
            t0 = time.perf_counter()
            ttft_ms: Optional[float] = None
            completion_cap = llm_completion_token_cap(source_text)
            try:
                stream = lane.llm_instance.chat(
                    chat_ctx=chat_ctx,
                    extra_kwargs={"max_completion_tokens": completion_cap},
                )
            except TypeError:
                # Older LiveKit OpenAI plugin without per-call extra_kwargs.
                stream = lane.llm_instance.chat(chat_ctx=chat_ctx)
            try:
                async for chunk in stream:
                    if getattr(chunk, "usage", None) is not None:
                        last_usage = chunk.usage
                    delta = chunk.delta.content if chunk.delta and chunk.delta.content else ""
                    if not delta:
                        continue
                    if ttft_ms is None:
                        ttft_ms = (time.perf_counter() - t0) * 1000.0
                    accumulated += delta
                    if on_delta is not None:
                        await on_delta(accumulated)
            finally:
                await stream.aclose()
            total_ms = (time.perf_counter() - t0) * 1000.0
            logger.info(
                f"{L}→{tgt_lang} 📊 translation_latency ttft_ms={ttft_ms and round(ttft_ms) or -1} "
                f"total_ms={round(total_ms)} chars={len(source_text)} partial={partial} "
                f"max_completion_tokens={completion_cap} model={_llm_model()}"
            )
            return accumulated.strip(), last_usage

        def emit_llm_cost(lane: TargetLaneState, source_text: str, output_text: str, usage: Any) -> None:
            """Fire-and-forget LLM cost event — never interrupts translation."""
            if not self.cost_reporter:
                return
            if usage and hasattr(usage, "prompt_tokens"):
                in_tok = usage.prompt_tokens or 0
                out_tok = usage.completion_tokens or 0
            else:
                # Estimate: ~4 chars/token
                in_tok = max(1, (200 + len(source_text)) // 4)
                out_tok = max(1, len(output_text) // 4)
            self._spawn_bg(self.cost_reporter.emit_llm(
                input_tokens=in_tok,
                output_tokens=out_tok,
                provider=lane.llm_provider,
                participant=speaker_id,
                model=_llm_model(),
            ))

        def maybe_freeze_lane(
            lane: TargetLaneState, tail_src: str, committed_snapshot: str, translation: str
        ) -> None:
            """Fold a sentence-complete tail into the frozen prefix (bounds re-translation cost)."""
            if not translation.strip() or not ends_sentence(tail_src):
                return
            lane.frozen_tgt = join_nonempty(lane.frozen_tgt, translation)
            lane.frozen_src = committed_snapshot
            lane.tail_translation = ""
            # Interim text covered the tail that just froze — clear it or the display
            # (frozen + interim) would duplicate the sentence.
            lane.interim_candidate = ""
            lane.interim_stable = ""
            lane.last_interim_src = ""

        async def translate_tail(
            lane: TargetLaneState, tgt_lang: str, tail_src: str, committed_snapshot: str
        ) -> None:
            """Translate the unfrozen source tail of the current utterance (FINAL path).

            Hardened: cache lookup, per-attempt timeout, one retry, latency metrics.
            Supersedes any interim local-agreement text for this lane.
            """
            if lane.llm_instance is None or not tail_src.strip():
                return
            # Final translation supersedes interim agreement work. Keep interim_stable
            # on screen while the final streams (display continuity — captions must
            # never shrink); it's cleared when the authoritative result lands.
            if lane.interim_task and not lane.interim_task.done():
                lane.interim_task.cancel()
            lane.interim_candidate = ""

            cached = self._translation_cache.get(effective_source_lang[0], tgt_lang, tail_src)
            if cached is not None:
                lane.tail_translation = cached
                lane.interim_stable = ""
                maybe_freeze_lane(lane, tail_src, committed_snapshot, cached)
                await publish_lane_translation_partial(lane, tgt_lang)
                logger.info(f"{L}→{tgt_lang} 📊 translation_latency cached=true chars={len(tail_src)}")
                return

            async def on_delta(accumulated: str) -> None:
                lane.tail_translation = accumulated
                await publish_lane_translation_partial(lane, tgt_lang)

            last_err: Optional[BaseException] = None
            for attempt in (1, 2):
                try:
                    result, usage = await asyncio.wait_for(
                        run_llm_stream(
                            lane, tgt_lang, tail_src, partial=False, on_delta=on_delta
                        ),
                        timeout=_llm_timeout_sec(),
                    )
                    if not result:
                        raise RuntimeError("empty translation result")
                    lane.tail_translation = result
                    # Authoritative final result — drop any interim local-agreement text.
                    lane.interim_stable = ""
                    self._translation_cache.put(effective_source_lang[0], tgt_lang, tail_src, result)
                    maybe_freeze_lane(lane, tail_src, committed_snapshot, result)
                    emit_llm_cost(lane, tail_src, result, usage)
                    return
                except asyncio.CancelledError:
                    raise
                except (asyncio.TimeoutError, Exception) as e:  # noqa: BLE001
                    last_err = e
                    logger.warning(
                        f"{L}→{tgt_lang} ⚠️ translation attempt {attempt}/2 failed "
                        f"({type(e).__name__}: {e})"
                    )
            # Both attempts failed — degrade to untranslated source so finalize still
            # publishes content; hasTranslation=false signals the gap downstream.
            logger.error(
                f"{L}→{tgt_lang} ❌ translation failed after retries — degrading "
                f"({type(last_err).__name__ if last_err else 'unknown'})"
            )
            # Prefer the partial translated text from interim agreement over echoing
            # untranslated source; fall back to source only when we have nothing.
            lane.tail_translation = lane.interim_stable or tail_src
            lane.interim_stable = ""

        async def run_interim_translation(
            lane: TargetLaneState, tgt_lang: str, tail_src: str
        ) -> None:
            """Simultaneous-MT local agreement (LA-2) on the live interim transcript.

            Translate the unfrozen tail; display only the word-prefix that two
            consecutive candidate translations agree on, so live translated text
            never flickers or retracts. Final (is_final) translations supersede.
            """
            try:
                cached = self._translation_cache.get(effective_source_lang[0], tgt_lang, tail_src)
                if cached is not None:
                    candidate = cached
                else:
                    candidate, usage = await asyncio.wait_for(
                        run_llm_stream(lane, tgt_lang, tail_src, partial=True),
                        timeout=_llm_timeout_sec(),
                    )
                    emit_llm_cost(lane, tail_src, candidate, usage)
                if not candidate:
                    return
                stable = stable_common_prefix(lane.interim_candidate, candidate)
                lane.interim_candidate = candidate
                # Monotonic display: never retract already-shown stable text.
                if len(stable) > len(lane.interim_stable):
                    lane.interim_stable = stable
                    await publish_lane_translation_partial(lane, tgt_lang)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                # Interim translation is best-effort — the FINAL path has retries.
                logger.debug(f"{L}→{tgt_lang} interim translation skipped: {e}")

        def schedule_interim_translations() -> None:
            """Fan out live-translation attempts; at most one in flight per lane."""
            if not _interim_translation_enabled():
                return
            if self.caption_mode == "transcription_only" or use_gladia_native_translation[0]:
                return
            live_src = dg_buffer.live_text()
            if not live_src.strip():
                return
            now = time.time()
            min_interval = _interim_translation_min_interval_ms() / 1000.0
            for tgt, lane in lanes.items():
                if lane.is_same_language or lane.llm_instance is None:
                    continue
                # A FINAL tail translation in flight supersedes interim work.
                if lane.current_task and not lane.current_task.done():
                    continue
                if lane.interim_task and not lane.interim_task.done():
                    continue
                if now - lane.last_interim_at < min_interval:
                    continue
                tail_src = split_tail(live_src, lane.frozen_src)
                # Need a couple of words before spending an LLM call; identical text
                # to the last attempt can't produce new agreement.
                if len(tail_src.split()) < 2 or tail_src == lane.last_interim_src:
                    continue
                lane.last_interim_at = now
                lane.last_interim_src = tail_src
                lane.interim_task = asyncio.create_task(
                    run_interim_translation(lane, tgt, tail_src)
                )

        finalize_lock = asyncio.Lock()

        async def finalize_turn() -> None:
            # Reentrancy guard: reachable from the STT-idle timer, the Gladia
            # translation debounce, cross-speaker finalize_now, Gladia
            # START_OF_SPEECH, and pipeline teardown — without this lock two
            # interleaved runs double-publish the same FINAL or clear the buffer
            # mid-publish.
            async with finalize_lock:
                if turn_id[0] is None:
                    return
                await _finalize_turn_locked()

        async def _finalize_turn_locked() -> None:
            await reconcile_lanes()
            finalize_t0 = time.perf_counter()

            dg_buffer.on_speech_final()
            full_original = dg_buffer.committed_text()
            tid = turn_id[0]
            if not full_original:
                turn_id[0] = None
                return

            last_finalized_norm[0] = full_original.strip().lower()
            last_finalized_at[0] = time.time()

            async def finalize_lane(tgt: str, lane: TargetLaneState) -> None:
                # Per-lane isolation: wait only on THIS lane's in-flight translations
                # (bounded), so one slow target language never delays other lanes'
                # finals. translate_tail's own timeout+retry caps task lifetime; the
                # wait_for here is a hard backstop.
                if lane.interim_task and not lane.interim_task.done():
                    lane.interim_task.cancel()
                pending = [t for t in lane.pending_translate_tasks if not t.done()]
                if pending:
                    try:
                        await asyncio.wait_for(
                            asyncio.gather(*pending, return_exceptions=True),
                            timeout=_llm_timeout_sec() * 2 + 1.0,
                        )
                    except asyncio.TimeoutError:
                        logger.warning(
                            f"{L}→{tgt} ⚠️ finalize: translation exceeded hard cap — cancelling"
                        )
                        for t in pending:
                            if not t.done():
                                t.cancel()
                if lane.is_same_language or use_gladia_native_translation[0]:
                    full_translated = " ".join(p for p in lane.turn_translated_parts if p)
                else:
                    full_translated = lane.display_translation()
                    if not (full_translated or "").strip() and lane.llm_instance is not None:
                        # Lane joined mid-turn (listener language arrived after speech
                        # started) so no translation was ever attempted — one direct
                        # call here keeps the FIRST utterance from publishing
                        # untranslated and sticking on 'Translating…' downstream.
                        cached = self._translation_cache.get(effective_source_lang[0], tgt, full_original)
                        if cached is not None:
                            full_translated = cached
                        else:
                            try:
                                result, usage = await asyncio.wait_for(
                                    run_llm_stream(lane, tgt, full_original, partial=False),
                                    timeout=_llm_timeout_sec(),
                                )
                                if result:
                                    full_translated = result
                                    self._translation_cache.put(
                                        effective_source_lang[0], tgt, full_original, result
                                    )
                                    emit_llm_cost(lane, full_original, result, usage)
                            except asyncio.CancelledError:
                                raise
                            except Exception as e:  # noqa: BLE001
                                logger.warning(
                                    f"{L}→{tgt} ⚠️ last-chance finalize translation failed: {e}"
                                )
                has_translation = full_original.strip().lower() != (full_translated or "").strip().lower()
                await publish_lane(
                    {
                        "type": "transcription",
                        "text": full_translated or full_original,
                        "originalText": full_original,
                        "language": tgt,
                        "sourceLanguage": effective_source_lang[0],
                        "participant_id": speaker_id,
                        "partial": False,
                        "final": True,
                        "timestamp": asyncio.get_event_loop().time(),
                        "hasTranslation": has_translation,
                        "transcriptionId": tid,
                        "sttProvider": stt_provider_name,
                    },
                    tgt,
                    is_same_language_lane=lane.is_same_language,
                    reliable=True,
                )
                # Rolling context for the next utterance (foreign lanes only).
                if not lane.is_same_language and has_translation and full_translated:
                    lane.context_pairs.append((full_original, full_translated))
                tts_lane = self.tts_lanes.get(tgt)
                if tts_lane is not None and not lane.is_same_language:
                    tts_text = (full_translated or full_original).strip()
                    if tts_text:
                        try:
                            await tts_lane.enqueue_final(
                                speaker_id=speaker_id,
                                text=tts_text,
                            )
                        except Exception as e:
                            logger.warning(f"{L}→{tgt} TTS enqueue failed: {e}")
                logger.info(
                    f"{L}→{tgt} ✅ Turn final ({round((time.perf_counter() - finalize_t0) * 1000)}ms): "
                    f"'{full_original[:50]}...' → '{full_translated[:50]}...'"
                )

            results = await asyncio.gather(
                *(finalize_lane(tgt, lane) for tgt, lane in lanes.items()),
                return_exceptions=True,
            )
            for r in results:
                if isinstance(r, BaseException):
                    logger.error(f"{L} finalize lane failed: {r}")

            if (
                self.demo_orchestrator
                and full_original
                and not is_likely_agent_identity(speaker_id)
            ):
                self._spawn_bg(
                    self.demo_orchestrator.on_user_final(
                        speaker_id, full_original, tid
                    )
                )

            dg_buffer.clear()
            for lane in lanes.values():
                lane.pending_translate_tasks.clear()
                lane.current_task = None
                lane.interim_task = None
                lane.turn_translated_parts.clear()
                lane.reset_turn()
            gladia_satisfied_targets.clear()
            turn_id[0] = None

            # Emit STT cost for the completed turn (fire-and-forget)
            if self.cost_reporter and turn_stt_seconds[0] > 0:
                self._spawn_bg(self.cost_reporter.emit_stt(
                    duration_seconds=turn_stt_seconds[0],
                    provider=stt_provider_name,
                    participant=speaker_id,
                    language=effective_source_lang[0],
                ))
                turn_stt_seconds[0] = 0.0

        async def start_new_turn() -> None:
            await reconcile_lanes()
            for lane in lanes.values():
                lane.cancel_inflight()
                for t in list(lane.pending_translate_tasks):
                    t.cancel()
                if lane.pending_translate_tasks:
                    await asyncio.gather(*lane.pending_translate_tasks, return_exceptions=True)
                lane.pending_translate_tasks.clear()
                lane.current_task = None
                lane.interim_task = None
                lane.turn_translated_parts.clear()
                lane.reset_turn()
            gladia_satisfied_targets.clear()
            seg_counter[0] += 1
            turn_id[0] = f"{speaker_id}-turn-{seg_counter[0]}-{int(asyncio.get_event_loop().time() * 1000)}"
            dg_buffer.clear()
            turn_start_time[0] = asyncio.get_event_loop().time()
            turn_stt_seconds[0] = 0.0
            seg_speech_start[0] = 0.0
            last_live_publish[0] = ""
            # NOTE: do NOT commit other speakers' open bubbles here. Cross-talk makes
            # both pipelines "start turns" off the same audio, and committing a Gladia
            # bubble mid-revision freezes half-revised text into the transcript
            # (observed live: the same phrase stitched 3x into one caption).

        stt_idle_task: List[Optional[asyncio.Task]] = [None]
        gladia_trans_finalize_task: List[Optional[asyncio.Task]] = [None]
        # Normalized target langs whose Gladia translation FINAL arrived this turn.
        gladia_satisfied_targets: Set[str] = set()
        last_stt_text_at: List[float] = [0.0]

        def gladia_expected_targets() -> Set[str]:
            return {
                self._normalize_language_code(t)
                for t, lane in lanes.items()
                if not lane.is_same_language
            }

        async def cancel_gladia_translation_finalize() -> None:
            pending = gladia_trans_finalize_task[0]
            if pending and not pending.done():
                pending.cancel()
                try:
                    await pending
                except (asyncio.CancelledError, Exception):
                    pass
            gladia_trans_finalize_task[0] = None

        def arm_gladia_translation_finalize() -> None:
            """Gladia emits one FINAL per translation target.

            Finalize immediately once every cross-language lane has its translation;
            otherwise wait a grace period for the remaining targets so a slow second
            language doesn't get committed empty.
            """
            if not use_gladia_native_translation[0] or not turn_id[0]:
                return
            pending = gladia_trans_finalize_task[0]
            if pending and not pending.done():
                pending.cancel()

            all_satisfied = gladia_expected_targets() <= gladia_satisfied_targets

            async def _run() -> None:
                try:
                    await asyncio.sleep(0.1 if all_satisfied else _gladia_translation_grace_sec())
                    if turn_id[0] and dg_buffer.has_content():
                        await finalize_turn()
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    logger.warning(f"{L} Gladia translation finalize failed: {e}")

            gladia_trans_finalize_task[0] = asyncio.create_task(_run())

        async def cancel_stt_idle_finalize() -> None:
            pending = stt_idle_task[0]
            if pending and not pending.done():
                pending.cancel()
                try:
                    await pending
                except (asyncio.CancelledError, Exception):
                    pass
            stt_idle_task[0] = None

        def maybe_flush_stt() -> None:
            if not _stt_stream_supports_flush(stt_provider_name):
                return
            try:
                stt_stream.flush()
            except Exception:
                pass

        def arm_stt_idle_finalize() -> None:
            """Finalize when the transcript stops changing (not when audio is silent).

            Works for every STT provider: Deepgram arms this on its END_OF_SPEECH,
            providers without speech_final (e.g. OpenAI gpt-4o-transcribe) arm it on
            VAD END_OF_SPEECH and on each new caption.

            Gladia emits one utterance per FINAL+END_OF_SPEECH — idle finalize is skipped.
            """
            if stt_provider_name == "gladia":
                return
            if not turn_id[0]:
                return
            pending = stt_idle_task[0]
            if pending and not pending.done():
                pending.cancel()
            stt_idle_task[0] = asyncio.create_task(schedule_stt_idle_finalize())

        def touch_stt_activity() -> None:
            last_stt_text_at[0] = time.time()
            if stt_provider_name != "gladia":
                arm_stt_idle_finalize()

        async def schedule_stt_idle_finalize() -> None:
            try:
                idle_sec = _deepgram_stt_idle_ms() / 1000.0
                await asyncio.sleep(idle_sec)
                if not turn_id[0] or not dg_buffer.has_content():
                    return
                if time.time() - last_stt_text_at[0] < idle_sec * 0.85:
                    return
                logger.info(
                    f"{L} ⏱️ STT idle finalize ({_deepgram_stt_idle_ms()}ms without new words)"
                )
                dg_buffer.on_speech_final()
                maybe_flush_stt()
                await asyncio.sleep(0.15)
                if turn_id[0] and dg_buffer.has_content():
                    await finalize_turn()
            except asyncio.CancelledError:
                logger.debug(f"{L} ↩️ STT idle finalize cancelled (new speech)")
                raise

        async def cancel_finalization() -> None:
            await cancel_stt_idle_finalize()
            await cancel_gladia_translation_finalize()

        def lane_live_text(lane: TargetLaneState, display_text: str) -> str:
            """Foreign-language lanes never echo source-language STT — show the
            frozen + live translation (interim local-agreement text included)."""
            if lane.is_same_language:
                return display_text
            if use_gladia_native_translation[0]:
                return " ".join(p for p in lane.turn_translated_parts if p).strip()
            return lane.display_translation()

        async def publish_live_partial(display_text: str) -> None:
            """Fire-and-forget partial publish so STT recv loop is never blocked on data channel I/O."""
            if not display_text.strip():
                return
            await asyncio.gather(*[
                publish_lane(
                    {
                        "type": "transcription",
                        "originalText": display_text,
                        "text": lane_live_text(lane, display_text),
                        "language": tgt,
                        "sourceLanguage": effective_source_lang[0],
                        "participant_id": speaker_id,
                        "partial": True,
                        "final": False,
                        "timestamp": asyncio.get_event_loop().time(),
                        "transcriptionId": turn_id[0],
                        "sttProvider": stt_provider_name,
                    },
                    tgt,
                    is_same_language_lane=lane.is_same_language,
                )
                for tgt, lane in lanes.items()
            ])

        def schedule_live_partial(display_text: str) -> None:
            normalized = display_text.strip()
            if not normalized or normalized == last_live_publish[0]:
                return
            last_live_publish[0] = normalized
            touch_stt_activity()

            async def _run() -> None:
                try:
                    await publish_live_partial(normalized)
                except Exception as e:
                    logger.warning(f"{L} live partial publish failed: {e}")

            asyncio.create_task(_run())

        async def ensure_lanes_for_caption() -> None:
            if not turn_id[0]:
                await start_new_turn()
            if not lanes:
                await reconcile_lanes()

        async def feed_audio() -> None:
            # Always stream audio to STT (including silence). Gating STT on VAD caused
            # missed interim partials after brief pauses — only utterance finals arrived.
            async for ev in audio_stream:
                vad_stream.push_frame(ev.frame)
                stt_stream.push_frame(ev.frame)

        async def finalize_now() -> None:
            await cancel_finalization()
            if not turn_id[0]:
                return
            try:
                maybe_flush_stt()
                # Let flushed STT finals land before we commit (interruption / early finalize).
                await asyncio.sleep(0.45 if _stt_stream_supports_flush(stt_provider_name) else 0.0)
            except Exception:
                pass
            if turn_id[0]:
                await finalize_turn()

        def has_open_turn() -> bool:
            if turn_id[0] is None:
                return False
            return dg_buffer.has_content()

        caption_session = SpeakerCaptionSession(
            speaker_id=speaker_id,
            finalize_now=finalize_now,
            has_open_turn=has_open_turn,
        )
        await self._register_caption_session(caption_session)

        async def note_detected_language(speech_data: Any) -> None:
            if stt_provider_name != "deepgram":
                return
            detected = speech_data_detected_language(speech_data)
            prev = effective_source_lang[0]
            effective_source_lang[0] = effective_source_language(
                configured_speaker_lang,
                detected,
                prev,
            )
            if effective_source_lang[0] == prev:
                return
            logger.info(
                f"{L} codeswitch source {prev!r} → {effective_source_lang[0]!r} "
                f"(detected={detected!r})"
            )
            await reconcile_lanes()

        async def process_vad() -> None:
            from livekit.agents.vad import VADEventType

            async for vad_event in vad_stream:
                if vad_event.type == VADEventType.START_OF_SPEECH:
                    seg_speech_start[0] = time.time()
                    await cancel_finalization()
                    vad_speech_active[0] = True
                    last_finalized_norm[0] = ""
                    if not turn_id[0]:
                        await start_new_turn()
                    logger.debug(f"{L} 🎙️ Speech started (VAD)")
                elif vad_event.type == VADEventType.END_OF_SPEECH:
                    if seg_speech_start[0] > 0:
                        turn_stt_seconds[0] += time.time() - seg_speech_start[0]
                        seg_speech_start[0] = 0.0
                    vad_speech_active[0] = False
                    logger.debug(f"{L} 🔇 Speech ended (VAD)")
                    maybe_flush_stt()
                    stt_speech_active[0] = False
                    # Drives finalize for providers that never emit STT END_OF_SPEECH
                    # (e.g. OpenAI gpt-4o-transcribe); harmless re-arm for Deepgram.
                    arm_stt_idle_finalize()

        async def process_stt() -> None:
            async for stt_event in stt_stream:
                alt = stt_event.alternatives
                ev_type = stt_event.type

                if ev_type == SpeechEventType.START_OF_SPEECH:
                    await cancel_finalization()
                    stt_speech_active[0] = True
                    last_finalized_norm[0] = ""
                    if (
                        stt_provider_name == "gladia"
                        and turn_id[0]
                        and dg_buffer.has_content()
                    ):
                        await finalize_turn()
                    if not turn_id[0]:
                        await start_new_turn()
                    logger.debug(f"{L} 🎙️ Speech started (STT)")
                    continue

                if ev_type == SpeechEventType.END_OF_SPEECH:
                    stt_speech_active[0] = False
                    if stt_provider_name == "gladia":
                        logger.debug(f"{L} 🔇 STT END_OF_SPEECH (Gladia — finalized on FINAL)")
                        continue
                    logger.debug(
                        f"{L} 🔇 STT END_OF_SPEECH — waiting "
                        f"{_deepgram_stt_idle_ms()}ms STT idle before finalize"
                    )
                    maybe_flush_stt()
                    arm_stt_idle_finalize()
                    continue

                if not alt:
                    continue
                speech_data = alt[0]
                text = speech_data.text.strip()
                if not text:
                    continue

                if ev_type == SpeechEventType.INTERIM_TRANSCRIPT:
                    if turn_id[0] is None and is_residual_after_finalize(text):
                        logger.info(f"{L} 🛑 residual interim dropped: '{text[:40]}'")
                        continue
                    await ensure_lanes_for_caption()
                    await note_detected_language(speech_data)
                    display_text = dg_buffer.on_interim(text)
                    schedule_live_partial(display_text)
                    schedule_interim_translations()

                elif ev_type == SpeechEventType.FINAL_TRANSCRIPT:
                    if turn_id[0] is None and is_residual_after_finalize(text):
                        logger.debug(
                            f"{L} 🛑 Residual final after finalize ignored: '{text[:40]}'"
                        )
                        continue
                    await ensure_lanes_for_caption()
                    await note_detected_language(speech_data)

                    if (
                        stt_provider_name == "gladia"
                        and use_gladia_native_translation[0]
                        and _is_gladia_translation_final(speech_data)
                    ):
                        original = _gladia_source_text(speech_data, text)
                        translated = text.strip()
                        target_norm = _speech_data_language_code(speech_data)
                        # Late straggler for an already-committed turn (e.g. second
                        # target language landing after finalize) — don't reopen it.
                        if turn_id[0] is None and is_residual_after_finalize(original):
                            logger.debug(
                                f"{L} 🛑 late Gladia translation ({target_norm}) after "
                                f"finalize dropped: '{translated[:40]}'"
                            )
                            continue
                        display_text, seg_idx, segment = dg_buffer.on_utterance_final(original)
                        if seg_idx < 0 and not display_text.strip():
                            continue
                        matched_lane = False
                        for tgt, lane in lanes.items():
                            if lane.is_same_language:
                                continue
                            if self._normalize_language_code(tgt) != target_norm:
                                continue
                            lane.turn_translated_parts = [translated]
                            gladia_satisfied_targets.add(target_norm)
                            matched_lane = True
                            logger.info(
                                f"{L}→{tgt} 🌐 Gladia translation final: "
                                f"'{original[:40]}...' → '{translated[:40]}...'"
                            )
                            break
                        if not matched_lane:
                            logger.warning(
                                f"{L} Gladia translation for {target_norm!r} — no matching lane"
                            )
                        schedule_live_partial(display_text or original)
                        arm_gladia_translation_finalize()
                        continue

                    if stt_provider_name == "gladia":
                        display_text, seg_idx, segment = dg_buffer.on_utterance_final(text)
                    else:
                        start_t, end_t = _speech_times(speech_data)
                        display_text, seg_idx, segment = dg_buffer.on_final_segment(
                            text, start_time=start_t, end_time=end_t
                        )
                    if seg_idx < 0:
                        if display_text.strip():
                            schedule_live_partial(display_text)
                        continue
                    logger.info(
                        f"{L} 📝 is_final seg {seg_idx}: '{segment[:60]}...'"
                    )
                    committed_snapshot = dg_buffer.committed_text()
                    for tgt, lane in lanes.items():
                        if lane.is_same_language:
                            if stt_provider_name == "gladia":
                                lane.turn_translated_parts = [segment]
                            else:
                                while len(lane.turn_translated_parts) <= seg_idx:
                                    lane.turn_translated_parts.append("")
                                lane.turn_translated_parts[seg_idx] = segment
                        if (
                            not lane.is_same_language
                            and self.caption_mode != "transcription_only"
                            and not use_gladia_native_translation[0]
                        ):
                            # Translate the full unfrozen tail of the utterance (not just
                            # this segment) so the target text reads as one sentence.
                            # A newer is_final supersedes any in-flight translation —
                            # cancel it so a slower stale result can't overwrite newer text.
                            tail_src = split_tail(committed_snapshot, lane.frozen_src)
                            if not tail_src.strip():
                                continue
                            if lane.current_task and not lane.current_task.done():
                                lane.current_task.cancel()
                            task = asyncio.create_task(
                                translate_tail(lane, tgt, tail_src, committed_snapshot)
                            )
                            lane.current_task = task
                            lane.pending_translate_tasks.append(task)
                    schedule_live_partial(display_text)
                    if stt_provider_name == "gladia" and not use_gladia_native_translation[0]:
                        await finalize_turn()
                    continue

        was_cancelled = False
        pipeline_started_at = time.time()
        # FIRST_COMPLETED: if any leg exits (e.g. the STT websocket drops and
        # process_stt returns), tear the others down instead of waiting forever
        # on feed_audio — otherwise the pipeline hangs silently with dead STT.
        legs = [
            asyncio.create_task(feed_audio(), name=f"{speaker_id}-feed-audio"),
            asyncio.create_task(process_vad(), name=f"{speaker_id}-vad"),
            asyncio.create_task(process_stt(), name=f"{speaker_id}-stt"),
        ]
        try:
            done, _pending = await asyncio.wait(legs, return_when=asyncio.FIRST_COMPLETED)
            for t in done:
                exc = t.exception() if not t.cancelled() else None
                if exc is not None:
                    raise exc
            logger.warning(f"{L} Pipeline leg ended (STT stream closed?) — exiting for restart")
        except asyncio.CancelledError:
            was_cancelled = True
            logger.info(f"{L} Speaker pipeline cancelled")
        except Exception as e:
            logger.error(f"{L} Pipeline error: {e}", exc_info=True)
        finally:
            # Unlike gather(), asyncio.wait does not propagate cancellation to the
            # legs — cancel them explicitly on every exit path.
            for t in legs:
                if not t.done():
                    t.cancel()
            await asyncio.gather(*legs, return_exceptions=True)
            await self._unregister_caption_session(speaker_id)
            if turn_id[0]:
                try:
                    await finalize_turn()
                except Exception as e:
                    logger.warning(f"{L} finalize on teardown failed: {e}")
            await stt_stream.aclose()
            await vad_stream.aclose()
            await audio_stream.aclose()
            if not was_cancelled:
                lifetime = time.time() - pipeline_started_at
                if lifetime < 20.0:
                    # Died right after start → the provider itself is rejecting us
                    # (e.g. Gladia 429: free tier = 1 concurrent live session). Retrying
                    # the same provider would fail forever — skip it next attempt so the
                    # fallback ladder (deepgram/openai) keeps captions alive.
                    self._stt_skip_providers.setdefault(speaker_id, set()).add(stt_provider_name)
                    logger.error(
                        f"{L} ⚠️ STT provider {stt_provider_name!r} failed {lifetime:.1f}s "
                        f"after start — falling back to next provider. If this is Gladia, "
                        f"check account concurrency limits (free tier allows 1 live session)."
                    )
                else:
                    # Healthy run that died later (network blip) — retry the full ladder.
                    self._stt_skip_providers.pop(speaker_id, None)
                # Self-heal: STT/VAD died mid-meeting with no participant event to
                # trigger reconciliation. Once this task is done, update_assistants
                # recycles it and recreates the pipeline.
                async def _restart_soon() -> None:
                    await asyncio.sleep(1.0)
                    await self.update_assistants(job_ctx)
                self._spawn_bg(_restart_soon())


def log_resolved_inference_config() -> None:
    """Log effective inference env once per worker (never print API key values)."""
    lc_cloud = os.getenv("LIVEKIT_CLOUD", "").lower() == "true"
    stt = os.getenv("STT_PROVIDER", "deepgram").strip().lower()
    llm = os.getenv("LLM_PROVIDER", "openai").strip().lower()

    build_ref = (
        os.getenv("AGENT_BUILD_REF")
        or os.getenv("GIT_COMMIT")
        or os.getenv("RAILWAY_GIT_COMMIT_SHA")
        or os.getenv("VERCEL_GIT_COMMIT_SHA")
        or "unset"
    )
    has_deepgram_env = bool(os.getenv("DEEPGRAM_API_KEY"))
    has_openai = bool(os.getenv("OPENAI_API_KEY"))
    has_gladia = bool(os.getenv("GLADIA_API_KEY"))

    stt_primary = {
        "deepgram": "Deepgram nova-3 canonical buffer (speech_final → finalize)",
        "gladia": (
            "Gladia solaria-1 code-switching "
            + (
                "(native translation when GLADIA_TRANSLATION_ENABLED and cross-lang listeners)"
                if _gladia_translation_enabled()
                else "(STT-only; OpenAI translation lanes)"
            )
        ),
        "openai": "OpenAI gpt-4o-transcribe (then Deepgram fallback)",
    }.get(stt, "Deepgram nova-3 (then OpenAI fallback)")

    logger.info("=" * 60)
    logger.info("RESOLVED INFERENCE CONFIG (transcription_codeswitch_agent)")
    logger.info(f"  build_ref={build_ref}")
    logger.info(
        "  LIVEKIT_CLOUD raw=%r interpreted_as_livekit_cloud_inference_defaults=%s",
        os.getenv("LIVEKIT_CLOUD", ""),
        lc_cloud,
    )
    logger.info("  STT_PROVIDER=%r primary_path=%s", stt, stt_primary)
    logger.info(
        "  GLADIA_TRANSLATION_ENABLED=%r (Gladia agent only; OpenAI lanes when false or no cross-lang targets)",
        os.getenv("GLADIA_TRANSLATION_ENABLED", "true"),
    )
    logger.info("  LLM_PROVIDER=%r (translation lanes; same-language captions skip LLM)", llm)
    logger.info(
        "  Translation LLM: %s temp=%s timeout=%ss (pinned via LLM_MODEL)",
        _llm_model(),
        _llm_temperature(),
        _llm_timeout_sec(),
    )
    logger.info(
        "  INTERIM_TRANSLATION_ENABLED=%s min_interval_ms=%d (live local-agreement translation)",
        _interim_translation_enabled(),
        _interim_translation_min_interval_ms(),
    )
    logger.info(
        "  TTS_ENABLED=%s TTS_MAX_LANES=%d TTS_STALE_SEC=%.1f",
        _tts_enabled(),
        _tts_max_lanes(),
        _tts_stale_sec(),
    )
    logger.info(
        "  TRANSLATION_CONTEXT_PAIRS=%d TRANSLATION_CACHE_SIZE=%d "
        "translation_keyterms=%d deepgram_keyterms=%d",
        _translation_context_pairs(),
        _translation_cache_size(),
        len(_translation_keyterms()),
        len(_deepgram_keyterms()),
    )
    logger.info(
        f"  DEEPGRAM_ENDPOINTING_MS={_deepgram_endpointing_ms()!r} (speech_final fast path)"
    )
    logger.info(
        f"  DEEPGRAM_STT_IDLE_MS={_deepgram_stt_idle_ms()!r} "
        "(finalize when transcript stops changing — ignores background noise)"
    )
    logger.info(f"  keys_present mask: DEEPGRAM_API_KEY={'yes' if has_deepgram_env else 'no'}, "
                f"GLADIA_API_KEY={'yes' if has_gladia else 'no'}, "
                f"OPENAI_API_KEY={'yes' if has_openai else 'no'}")
    logger.info("  (Unset keys may still use LiveKit Cloud-injected Deepgram/STT defaults when LIVEKIT_CLOUD=true.)")
    logger.info("=" * 60)


async def main(ctx: JobContext):
    agent = TranscriptionOnlyAgent()
    await agent.entrypoint(ctx)


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    log_resolved_inference_config()

    agent_name = os.getenv('AGENT_NAME', 'translation-cloud-deepgram-codeswitch')
    worker_opts = WorkerOptions(
        entrypoint_fnc=main,
        api_key=os.getenv('LIVEKIT_API_KEY'),
        api_secret=os.getenv('LIVEKIT_API_SECRET'),
        ws_url=os.getenv('LIVEKIT_URL', 'wss://production-uiycx4ku.livekit.cloud'),
        agent_name=agent_name,
    )

    if len(sys.argv) == 1 or (len(sys.argv) > 1 and sys.argv[1] in ['dev', 'start']):
        cli.run_app(worker_opts)
    else:
        logger.error(f"Unknown command: {sys.argv[1]}")
        sys.exit(1)
