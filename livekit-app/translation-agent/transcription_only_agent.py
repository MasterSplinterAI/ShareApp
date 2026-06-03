#!/usr/bin/env python3
"""
Transcription-Only Translation Agent - STT → LLM → Publish (no TTS)

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
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set, Tuple

import aiohttp

from cost_reporter import CostReporter
# List-of-chunk-finals for commits; stitch_committed_and_open for live interims only
# (Deepgram/xAI often send cumulative interims — naive concat duplicates prior chunks).
from transcript_assembler import stitch_committed_and_open

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

# xAI is imported separately so a missing plugin doesn't disable Deepgram/OpenAI
try:
    from livekit.plugins import xai as xai_plugin
    XAI_AVAILABLE = True
except ImportError:
    XAI_AVAILABLE = False
    xai_plugin = None

try:
    from livekit.plugins import noise_cancellation
    NOISE_CANCELLATION_AVAILABLE = True
except ImportError:
    NOISE_CANCELLATION_AVAILABLE = False
    noise_cancellation = None

# xAI STT supported languages (BCP-47 primary subtags, as of April 2026).
# Anything outside this set falls back to Deepgram/OpenAI even when STT_PROVIDER=xai.
# Notably MISSING: zh (Chinese), he (Hebrew), tiv — keep these on Deepgram.
XAI_SUPPORTED_LANGS = {
    "ar", "cs", "da", "nl", "en", "fil", "fr", "de", "hi", "id",
    "it", "ja", "ko", "mk", "ms", "fa", "pl", "pt", "ro", "ru",
    "es", "sv", "th", "tr", "vi",
}


def _stt_force_deepgram_langs() -> set:
    """Languages where xAI quality is unreliable — force Deepgram. Override via STT_DEEPGRAM_LANGS."""
    raw = (os.getenv("STT_DEEPGRAM_LANGS") or "es").strip()
    return {part.strip().lower() for part in raw.split(",") if part.strip()}

# Official xAI STT endpoints (https://docs.x.ai/developers/model-capabilities/audio/speech-to-text)
XAI_STT_WS_URL = "wss://api.x.ai/v1/stt"
XAI_STT_REST_URL = "https://api.x.ai/v1/stt"

_xai_stt_probe_ok: Optional[bool] = None


def _xai_api_key() -> str:
    return (os.getenv("XAI_API_KEY") or "").strip()


def _xai_stt_endpointing_ms() -> int:
    """Silence (ms) before xAI emits speech_final. Higher = brief pauses stay in one utterance."""
    raw = os.getenv("XAI_STT_ENDPOINTING_MS", "1800").strip()
    try:
        ms = int(raw)
    except ValueError:
        ms = 1800
    return max(0, min(ms, 5000))


def _xai_stt_ws_params(language: str) -> Dict[str, str]:
    """Query params for xAI streaming STT WebSocket (matches livekit-plugins-xai)."""
    return {
        "encoding": "pcm",
        "sample_rate": "16000",
        "interim_results": "true",
        "diarize": "false",
        "language": language,
        "endpointing": str(_xai_stt_endpointing_ms()),
    }


async def probe_xai_stt_connection(*, language: str = "en") -> Tuple[bool, str]:
    """Verify XAI_API_KEY against wss://api.x.ai/v1/stt before selecting Grok STT."""
    global _xai_stt_probe_ok
    if _xai_stt_probe_ok is True:
        return True, "ok"

    api_key = _xai_api_key()
    if not api_key:
        return False, "XAI_API_KEY is missing or empty"

    params = _xai_stt_ws_params(language)
    try:
        timeout = aiohttp.ClientTimeout(total=10, sock_connect=8)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.ws_connect(
                XAI_STT_WS_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                params=params,
            ) as ws:
                msg = await ws.receive(timeout=8)
                if msg.type != aiohttp.WSMsgType.TEXT:
                    return (
                        False,
                        f"unexpected xAI STT handshake message type: {msg.type}",
                    )
                payload = json.loads(msg.data)
                if payload.get("type") != "transcript.created":
                    return (
                        False,
                        f"unexpected xAI STT first event: {payload.get('type')!r}",
                    )
    except aiohttp.WSServerHandshakeError as e:
        status = getattr(e, "status", None) or getattr(e, "code", None)
        if status in (400, 401):
            hint = (
                "Regenerate the key at https://console.x.ai and run "
                "lk agent update-secrets --secrets \"XAI_API_KEY=<new-key>\""
            )
            _xai_stt_probe_ok = False
            return (
                False,
                f"xAI STT rejected API key (HTTP {status} on {XAI_STT_WS_URL}). {hint}",
            )
        return False, f"xAI STT WebSocket handshake failed: {e}"
    except Exception as e:
        return False, f"xAI STT probe failed: {e}"

    _xai_stt_probe_ok = True
    return True, "ok"


def _caption_finalize_delay_sec() -> float:
    """Wait after utterance end before posting caption block to history (resume window)."""
    raw = os.getenv("CAPTION_UTTERANCE_END_DELAY_SEC", "1.5").strip()
    try:
        return max(0.5, min(float(raw), 10.0))
    except ValueError:
        return 1.5


def _is_stt_handshake_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return (
        "wsserverhandshakeerror" in type(exc).__name__.lower()
        or "invalid response status" in msg
        or "api.x.ai/v1/stt" in msg
    )

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    force=True
)
logger = logging.getLogger(__name__)
logger.info("=" * 60)
logger.info("📝 TRANSCRIPTION-ONLY AGENT MODULE LOADED (no TTS)")
logger.info("=" * 60)


LANG_NAMES = {
    "es": "Spanish", "en": "English", "fr": "French", "de": "German",
    "it": "Italian", "pt": "Portuguese",
    "zh": "Chinese", "zh-CN": "Mandarin Chinese", "zh-TW": "Traditional Chinese",
    "ja": "Japanese",
    "ko": "Korean", "ru": "Russian", "ar": "Arabic", "hi": "Hindi",
    "tiv": "Tiv",
}


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
    turn_translated_parts: List[str] = field(default_factory=list)
    pending_translate_tasks: List[asyncio.Task] = field(default_factory=list)


class TranscriptionOnlyAgent:
    def __init__(self):
        # One language per user: STT when they speak + translation target for what they read.
        self.participant_languages: Dict[str, str] = {}
        self.translation_enabled: Dict[str, bool] = {}
        # One asyncio task per speaker: shared STT/VAD, fan-out to per-target translation lanes.
        self.speaker_pipelines: Dict[str, asyncio.Task] = {}
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
        params["prefix_padding_duration"] = 0.8
        return params

    async def entrypoint(self, ctx: JobContext):
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        logger.info(f"📋 Room: {ctx.room.name} - Transcription-only agent (no TTS)")

        org_id: Optional[str] = None
        # Read caption_config and org_id from room metadata (persisted by host, supports late-joining agent)
        try:
            raw_meta = getattr(ctx.room, "metadata", None) or ""
            if raw_meta:
                meta = json.loads(raw_meta)
                org_id = meta.get("org_id") or None
                cc = meta.get("caption_config")
                if isinstance(cc, dict):
                    self.caption_mode = cc.get("mode", self.caption_mode)
                    langs = cc.get("languages", [])
                    self.caption_languages = list(langs) if isinstance(langs, list) else []
                    logger.info(
                        f"📋 Loaded caption_config from room metadata: "
                        f"mode={self.caption_mode!r} languages={self.caption_languages}"
                    )
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
                elif msg_type == "language_preference":
                    lang = (
                        msg.get("target_language")
                        or msg.get("language")
                        or msg.get("spoken_language")
                        or msg.get("spokenLanguage")
                        or "en"
                    )
                    enabled = msg.get("translation_enabled", msg.get("enabled", False))
                elif msg_type == "caption_config":
                    new_mode = msg.get("mode", self.caption_mode)
                    new_langs = msg.get("languages", self.caption_languages)
                    if new_mode != self.caption_mode or new_langs != self.caption_languages:
                        self.caption_mode = new_mode
                        self.caption_languages = list(new_langs) if isinstance(new_langs, list) else []
                        logger.info(
                            f"📋 caption_config updated by {participant_id}: "
                            f"mode={self.caption_mode!r} languages={self.caption_languages}"
                        )
                        _schedule_update()
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

                logger.info(f"📥 Language update: {participant_id} → {lang} (was {old_lang!r}), enabled={enabled}")

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
            asyncio.create_task(handle_data(data))

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
            await self.update_assistants(ctx)

        ctx.room.on("data_received", on_data)
        ctx.room.on("participant_connected", lambda p: asyncio.create_task(on_connected(p)))
        ctx.room.on("track_published", lambda pub, p: asyncio.create_task(on_track_published(pub, p)))
        ctx.room.on("participant_disconnected", lambda p: asyncio.create_task(on_disconnected(p)))

        try:
            await asyncio.Event().wait()
        finally:
            t = self._agent_ready_ping_task
            if t is not None and not t.done():
                t.cancel()
                await asyncio.gather(t, return_exceptions=True)
            await self._shutdown_all_assistants(ctx)

    async def update_assistants(self, ctx: JobContext):
        # caption_mode='off' → kill all pipelines and do nothing
        if self.caption_mode == "off":
            for sid in list(self.speaker_pipelines.keys()):
                await self._cancel_speaker_pipeline(sid)
            logger.info("⏸️ caption_mode='off' — all speaker pipelines stopped")
            return

        speakers = [
            p.identity for p in ctx.room.remote_participants.values()
            if any(pub.kind == rtc.TrackKind.KIND_AUDIO for pub in p.track_publications.values())
            and not is_likely_agent_identity(p.identity)
        ]
        targets = {
            lang for pid, lang in self.participant_languages.items()
            if self.translation_enabled.get(pid, False)
        }

        # caption_languages restricts which target languages are active when non-empty
        if self.caption_languages:
            allowed_norm = {self._normalize_language_code(l) for l in self.caption_languages}
            targets = {t for t in targets if self._normalize_language_code(t) in allowed_norm}

        logger.info(
            f"📊 update_assistants: speakers={speakers}, targets={targets}, "
            f"participant_langs={dict(self.participant_languages)}, enabled={dict(self.translation_enabled)}"
        )

        expected = set()

        # Never default speaker language to "en" — late joiners would get English STT for Spanish speech.
        # Skip until we have an explicit language_update from that participant.
        def _speaker_lang(speaker_id: str):
            return self.participant_languages.get(speaker_id)

        # Cross-language lanes first (STT + LLM translation).
        for speaker in speakers:
            speaker_lang = _speaker_lang(speaker)
            if speaker_lang is None:
                logger.info(f"⏳ No language yet for speaker {speaker!r} — skip STT until they send preferences")
                continue
            for target in targets:
                if self._normalize_language_code(speaker_lang) != self._normalize_language_code(target):
                    expected.add(f"{speaker}:{target}")

        # Same-language caption-only lane ONLY when speaker has no cross-language lane.
        # Rationale: cross-language lanes already publish `originalText` in the speaker's language,
        # and all packets are broadcast to every participant — so same-language listeners render the
        # original text as their dominant caption without needing a dedicated lane. When there are
        # no cross-language targets, we still need one lane to produce captions.
        for speaker in speakers:
            speaker_lang = _speaker_lang(speaker)
            if speaker_lang is None:
                continue
            has_cross_language = any(
                self._normalize_language_code(speaker_lang) != self._normalize_language_code(t)
                for t in targets
            )
            if has_cross_language:
                continue
            for target in targets:
                if self._normalize_language_code(speaker_lang) == self._normalize_language_code(target):
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
                self.speaker_pipelines[speaker] = asyncio.create_task(self._run_speaker_pipeline(ctx, rc))
                logger.info(f"✅ Speaker pipeline (shared STT): {speaker} targets={sorted(ts)}")
            else:
                await self._speaker_ctx[speaker].set_targets(ts)
                logger.debug(f"📎 Updated translation targets for {speaker}: {sorted(ts)}")

    def _create_stt_instance(
        self,
        speaker_id: str,
        speaker_lang: str,
        *,
        skip_providers: Optional[Set[str]] = None,
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
        _default_keyterms = (
            "Cassiterite,Rutile,Ilmenite,Bauxite,Chalcopyrite,Galena,Sphalerite,Pentlandite,"
            "Magnetite,Hematite,Chromite,Molybdenite,Scheelite,Wolframite,Coltan,Monazite,"
            "Sperrylite,Cooperite,Laurite,Braggite,Kimberlite,Zircon,Xenotime,"
            "Tin ore,Copper,Aluminum,Zinc,Lead,Nickel,Cobalt,Molybdenum,Tungsten,Lithium,"
            "Gold,Silver,Platinum,Palladium,Rhodium,Iridium,Ruthenium,Osmium,"
            "PGM,Platinum Group Metals,Rare earth,"
            "LME,London Metal Exchange,Backwardation,Contango,Spot price,Futures,Arbitrage,"
            "Assay,Concentrate,Cathode,Anode,Bullion,Ingot,Dore,Refining,Smelting,Warehousing,Hedging,"
            "Liquidity,Volatility,Leverage,Margin,Settlement,Collateral,Escrow,KYC,AML,Compliance,Derivatives,"
            "SaaS,API,Fintech,BaaS,FaaS"
        )
        keyterms_raw = os.getenv("DEEPGRAM_KEYTERMS", _default_keyterms)
        keyterms = [t.strip() for t in keyterms_raw.split(",") if t.strip()]
        stt_provider = os.getenv("STT_PROVIDER", "deepgram").strip().lower()
        normalized_lang = self._normalize_language_code(stt_lang)
        stt_instance: Optional[Any] = None
        stt_provider_name = "unknown"
        excluded = skip_providers or set()

        def _try_xai():
            nonlocal stt_provider_name
            if "xai" in excluded:
                return None
            if not XAI_AVAILABLE or xai_plugin is None:
                logger.warning(f"{L} STT_PROVIDER=xai but livekit-plugins-xai not installed — falling back")
                return None
            if not _xai_api_key():
                logger.warning(f"{L} STT_PROVIDER=xai but XAI_API_KEY not set — falling back")
                return None
            if normalized_lang not in XAI_SUPPORTED_LANGS:
                logger.info(f"{L} xAI does not support lang={stt_lang!r} — falling back to Deepgram")
                return None
            force_dg = _stt_force_deepgram_langs()
            if normalized_lang in force_dg:
                logger.info(
                    f"{L} STT_DEEPGRAM_LANGS={sorted(force_dg)} forces lang={normalized_lang!r} off xAI — using Deepgram"
                )
                return None
            try:
                xai_endpointing = _xai_stt_endpointing_ms()
                inst = xai_plugin.STT(
                    language=normalized_lang,
                    sample_rate=16000,
                    enable_interim_results=True,
                    endpointing=xai_endpointing,
                    api_key=_xai_api_key(),
                )
                logger.info(
                    f"{L} STT: xAI Grok via {XAI_STT_WS_URL} "
                    f"lang={normalized_lang} endpointing={xai_endpointing}ms (shared)"
                )
                stt_provider_name = "xai"
                return inst
            except Exception as e:
                logger.warning(f"{L} xAI STT init failed ({e}) — falling back")
                return None

        def _try_deepgram():
            nonlocal stt_provider_name
            if "deepgram" in excluded:
                return None
            if not (PLUGINS_AVAILABLE and deepgram and (is_cloud or os.getenv("DEEPGRAM_API_KEY"))):
                return None
            stt_kwargs = dict(
                model="nova-3",
                language=stt_lang,
                interim_results=True,
                punctuate=True,
                smart_format=True,
            )
            if keyterms and normalized_lang == "en":
                stt_kwargs["keyterm"] = keyterms
            inst = deepgram.STT(**stt_kwargs)
            kt = len(keyterms) if stt_kwargs.get("keyterm") else 0
            logger.info(f"{L} STT: Deepgram nova-3 lang={stt_lang} keyterms={kt} (shared)")
            stt_provider_name = "deepgram"
            return inst

        def _try_openai():
            nonlocal stt_provider_name
            if "openai" in excluded:
                return None
            if not (PLUGINS_AVAILABLE and openai and (is_cloud or os.getenv("OPENAI_API_KEY"))):
                return None
            inst = openai.STT(model="gpt-4o-transcribe", language=stt_lang)
            logger.info(f"{L} STT: OpenAI gpt-4o-transcribe (shared, no interim)")
            stt_provider_name = "openai"
            return inst

        provider_order = {
            "xai": [_try_xai, _try_deepgram, _try_openai],
            "deepgram": [_try_deepgram, _try_xai, _try_openai],
            "openai": [_try_openai, _try_deepgram, _try_xai],
        }.get(stt_provider, [_try_deepgram, _try_xai, _try_openai])

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

        def _try_xai_llm():
            nonlocal llm_provider_name
            if llm_provider != "xai":
                return None
            if not XAI_AVAILABLE or xai_plugin is None:
                logger.warning(f"{L} LLM_PROVIDER=xai but livekit-plugins-xai not installed — falling back")
                return None
            if not _xai_api_key():
                logger.warning(f"{L} LLM_PROVIDER=xai but XAI_API_KEY not set — falling back")
                return None
            try:
                model = os.getenv("XAI_LLM_MODEL", "grok-4.20-non-reasoning")
                inst = xai_plugin.responses.LLM(model=model)
                logger.info(f"{L} LLM: xAI {model}")
                llm_provider_name = "xai"
                return inst
            except Exception as e:
                logger.warning(f"{L} xAI LLM init failed ({e}) — falling back")
                return None

        def _try_openai_llm():
            nonlocal llm_provider_name
            if not (PLUGINS_AVAILABLE and openai and (is_cloud or os.getenv("OPENAI_API_KEY"))):
                return None
            inst = openai.LLM()
            logger.info(f"{L} LLM: OpenAI (default gpt-4o-mini)")
            llm_provider_name = "openai"
            return inst

        llm_order = {
            "xai": [_try_xai_llm, _try_openai_llm],
            "openai": [_try_openai_llm, _try_xai_llm],
        }.get(llm_provider, [_try_openai_llm])

        llm_instance = None
        for attempt in llm_order:
            llm_instance = attempt()
            if llm_instance is not None:
                break
        if llm_instance is None:
            logger.error(f"{L} No LLM available (LLM_PROVIDER={llm_provider})")
        return llm_instance, llm_provider_name
    async def _run_speaker_pipeline(self, job_ctx: JobContext, run_ctx: SpeakerRunContext) -> None:
        """One STT + VAD per speaker; fan out FINAL segments to per-target LLM lanes."""
        from livekit.agents.llm import ChatContext
        from livekit.agents.stt import SpeechEventType

        speaker_id = run_ctx.speaker_id
        L = f"[{speaker_id}]"
        lanes: Dict[str, TargetLaneState] = {}

        async def reconcile_lanes() -> None:
            targets = await run_ctx.get_targets()
            sl = self.participant_languages.get(speaker_id)
            for tgt in list(lanes.keys()):
                if tgt not in targets:
                    st = lanes.pop(tgt)
                    for t in st.pending_translate_tasks:
                        t.cancel()
                    if st.pending_translate_tasks:
                        await asyncio.gather(*st.pending_translate_tasks, return_exceptions=True)
            for tgt in targets:
                if tgt in lanes:
                    continue
                if not sl:
                    continue
                is_same = self._normalize_language_code(sl) == self._normalize_language_code(tgt)
                llm = None
                llm_pname = "openai"
                if not is_same:
                    llm, llm_pname = self._create_llm_for_target(speaker_id, tgt)
                    if llm is None:
                        logger.error(f"{L}→{tgt} No LLM — skipping translation lane")
                        continue
                lanes[tgt] = TargetLaneState(
                    target_lang=tgt,
                    is_same_language=is_same,
                    llm_instance=llm,
                    target_lang_name=LANG_NAMES.get(tgt, tgt),
                    llm_provider=llm_pname,
                )

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

        skip_stt: Set[str] = set()
        if os.getenv("STT_PROVIDER", "deepgram").strip().lower() == "xai":
            ok, reason = await probe_xai_stt_connection(
                language=self._normalize_language_code(speaker_lang.split("-")[0])
            )
            if not ok:
                logger.error(f"{L} xAI STT unavailable ({reason}) — using Deepgram/OpenAI fallback")
                skip_stt.add("xai")

        stt_instance, stt_provider_name = self._create_stt_instance(
            speaker_id,
            speaker_lang,
            skip_providers=skip_stt,
        )
        if stt_instance is None:
            return
        logger.info(
            f"{L} Caption pipeline STT provider={stt_provider_name!r} "
            f"(configured STT_PROVIDER={os.getenv('STT_PROVIDER', 'deepgram')!r})"
        )
        if os.getenv("STT_PROVIDER", "deepgram").strip().lower() == "xai" and stt_provider_name != "xai":
            logger.warning(
                f"{L} xAI STT configured but active provider is {stt_provider_name!r} — "
                "xAI console will show no STT usage; check probe/key/fallback logs"
            )
        vad_instance = silero.VAD.load(**self._vad_params())

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

        audio_stream = rtc.AudioStream.from_participant(
            participant=participant,
            track_source=rtc.TrackSource.SOURCE_MICROPHONE,
            sample_rate=16000,
            num_channels=1,
        )
        stt_stream = stt_instance.stream()
        vad_stream = vad_instance.stream()

        turn_id: List[Optional[str]] = [None]
        # Per-turn list of chunk finals (main-branch approach: simple, accurate, no merge heuristics).
        turn_original_parts: List[str] = []
        seg_counter = [0]
        vad_speech_active = [False]
        stt_speech_active = [False]
        turn_start_time = [0.0]
        # Track cumulative speech seconds per turn for STT cost reporting
        seg_speech_start: List[float] = [0.0]
        turn_stt_seconds: List[float] = [0.0]
        last_live_publish: List[str] = [""]

        async def translate_segment(
            lane: TargetLaneState, tgt_lang: str, original: str, seg_idx: int
        ) -> None:
            llm = lane.llm_instance
            if llm is None:
                return
            try:
                sys_msg = (
                    f"Translate the following text to {lane.target_lang_name}. "
                    "Output ONLY the translation, nothing else."
                )
                chat_ctx = ChatContext()
                chat_ctx.add_message(role="system", content=sys_msg)
                chat_ctx.add_message(role="user", content=original)
                accumulated = ""
                last_usage = None
                stream = llm.chat(chat_ctx=chat_ctx)
                async for chunk in stream:
                    # Capture token usage if the provider sends it (OpenAI-compatible APIs)
                    if getattr(chunk, "usage", None) is not None:
                        last_usage = chunk.usage
                    delta = chunk.delta.content if chunk.delta and chunk.delta.content else ""
                    if not delta:
                        continue
                    accumulated += delta
                    while len(lane.turn_translated_parts) <= seg_idx:
                        lane.turn_translated_parts.append("")
                    lane.turn_translated_parts[seg_idx] = accumulated
                    full_original = " ".join(turn_original_parts).strip()
                    full_translated = " ".join(p for p in lane.turn_translated_parts if p)
                    await publish_lane(
                        {
                            "type": "transcription",
                            "originalText": full_original,
                            "text": full_translated,
                            "language": tgt_lang,
                            "sourceLanguage": speaker_lang,
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
                await stream.aclose()
                while len(lane.turn_translated_parts) <= seg_idx:
                    lane.turn_translated_parts.append("")
                lane.turn_translated_parts[seg_idx] = accumulated.strip()

                # Fire-and-forget LLM cost event — never interrupts translation
                if self.cost_reporter:
                    if last_usage and hasattr(last_usage, "prompt_tokens"):
                        in_tok = last_usage.prompt_tokens or 0
                        out_tok = last_usage.completion_tokens or 0
                    else:
                        # Estimate: ~4 chars/token
                        in_tok = max(1, (len(sys_msg) + len(original)) // 4)
                        out_tok = max(1, len(accumulated) // 4)
                    model_name = (
                        os.getenv("XAI_LLM_MODEL", "grok-4.20-non-reasoning")
                        if lane.llm_provider == "xai"
                        else "gpt-4o-mini"
                    )
                    asyncio.create_task(self.cost_reporter.emit_llm(
                        input_tokens=in_tok,
                        output_tokens=out_tok,
                        provider=lane.llm_provider,
                        participant=speaker_id,
                        model=model_name,
                    ))
            except Exception as e:
                logger.error(f"{L}→{tgt_lang} LLM error seg {seg_idx}: {e}", exc_info=True)
                while len(lane.turn_translated_parts) <= seg_idx:
                    lane.turn_translated_parts.append("")
                lane.turn_translated_parts[seg_idx] = original

        async def finalize_turn() -> None:
            await reconcile_lanes()
            pending_all: List[asyncio.Task] = []
            for lane in lanes.values():
                pending_all.extend(lane.pending_translate_tasks)
            if pending_all:
                await asyncio.gather(*pending_all, return_exceptions=True)
                for lane in lanes.values():
                    lane.pending_translate_tasks.clear()

            full_original = " ".join(turn_original_parts).strip()
            tid = turn_id[0]
            if not full_original:
                turn_id[0] = None
                return

            for tgt, lane in lanes.items():
                full_translated = " ".join(p for p in lane.turn_translated_parts if p)
                has_translation = full_original.strip().lower() != (full_translated or "").strip().lower()
                await publish_lane(
                    {
                        "type": "transcription",
                        "text": full_translated or full_original,
                        "originalText": full_original,
                        "language": tgt,
                        "sourceLanguage": speaker_lang,
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
                logger.info(
                    f"{L}→{tgt} ✅ Turn final: '{full_original[:50]}...' → '{full_translated[:50]}...'"
                )

            turn_original_parts.clear()
            for lane in lanes.values():
                lane.turn_translated_parts.clear()
            turn_id[0] = None

            # Emit STT cost for the completed turn (fire-and-forget)
            if self.cost_reporter and turn_stt_seconds[0] > 0:
                asyncio.create_task(self.cost_reporter.emit_stt(
                    duration_seconds=turn_stt_seconds[0],
                    provider=stt_provider_name,
                    participant=speaker_id,
                    language=speaker_lang,
                ))
                turn_stt_seconds[0] = 0.0

        async def start_new_turn() -> None:
            await reconcile_lanes()
            for lane in lanes.values():
                for t in list(lane.pending_translate_tasks):
                    t.cancel()
                if lane.pending_translate_tasks:
                    await asyncio.gather(*lane.pending_translate_tasks, return_exceptions=True)
                lane.pending_translate_tasks.clear()
                lane.turn_translated_parts.clear()
            seg_counter[0] += 1
            turn_id[0] = f"{speaker_id}-turn-{seg_counter[0]}-{int(asyncio.get_event_loop().time() * 1000)}"
            turn_original_parts.clear()
            turn_start_time[0] = asyncio.get_event_loop().time()
            turn_stt_seconds[0] = 0.0
            seg_speech_start[0] = 0.0
            last_live_publish[0] = ""

        finalization_task: List[Optional[asyncio.Task]] = [None]

        async def cancel_finalization() -> None:
            pending = finalization_task[0]
            if pending and not pending.done():
                pending.cancel()
                try:
                    await pending
                except (asyncio.CancelledError, Exception):
                    pass
            finalization_task[0] = None

        def arm_finalization() -> None:
            pending = finalization_task[0]
            if pending and not pending.done():
                pending.cancel()
            finalization_task[0] = asyncio.create_task(schedule_finalization())

        def maybe_arm_finalization() -> None:
            """Post to history only when both VAD and STT agree speech has stopped."""
            if vad_speech_active[0] or stt_speech_active[0]:
                return
            arm_finalization()

        def speech_in_progress() -> bool:
            return vad_speech_active[0] or stt_speech_active[0]

        def lane_live_text(lane: TargetLaneState, display_text: str) -> str:
            """Foreign-language lanes never echo English STT — wait for translation."""
            full_t = " ".join(p for p in lane.turn_translated_parts if p).strip()
            if lane.is_same_language:
                return display_text
            return full_t

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
                        "sourceLanguage": speaker_lang,
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
            # Always stream audio to STT (including silence). Gating STT on VAD caused xAI to
            # miss interim partials after brief pauses — only chunk/utterance finals arrived.
            async for ev in audio_stream:
                vad_stream.push_frame(ev.frame)
                stt_stream.push_frame(ev.frame)

        async def schedule_finalization() -> None:
            try:
                await asyncio.sleep(_caption_finalize_delay_sec())
                if speech_in_progress() or not turn_id[0]:
                    return
                stt_stream.flush()
                await asyncio.sleep(0.45)
                if speech_in_progress() or not turn_id[0]:
                    return
                await finalize_turn()
            except asyncio.CancelledError:
                logger.debug(f"{L} ↩️ Finalization cancelled (speech resumed)")
                raise

        async def finalize_now() -> None:
            await cancel_finalization()
            if not turn_id[0]:
                return
            try:
                stt_stream.flush()
                # Let flushed STT finals land before we commit (interruption / early finalize).
                await asyncio.sleep(0.45)
            except Exception:
                pass
            if turn_id[0]:
                await finalize_turn()

        def has_open_turn() -> bool:
            return turn_id[0] is not None and bool(" ".join(turn_original_parts).strip())

        caption_session = SpeakerCaptionSession(
            speaker_id=speaker_id,
            finalize_now=finalize_now,
            has_open_turn=has_open_turn,
        )
        await self._register_caption_session(caption_session)

        async def process_vad() -> None:
            from livekit.agents.vad import VADEventType

            async for vad_event in vad_stream:
                if vad_event.type == VADEventType.START_OF_SPEECH:
                    seg_speech_start[0] = time.time()
                    await cancel_finalization()
                    vad_speech_active[0] = True
                    if not turn_id[0]:
                        await start_new_turn()
                    logger.debug(f"{L} 🎙️ Speech started (VAD)")
                elif vad_event.type == VADEventType.END_OF_SPEECH:
                    if seg_speech_start[0] > 0:
                        turn_stt_seconds[0] += time.time() - seg_speech_start[0]
                        seg_speech_start[0] = 0.0
                    vad_speech_active[0] = False
                    logger.debug(f"{L} 🔇 Speech ended (VAD)")
                    try:
                        stt_stream.flush()
                    except Exception:
                        pass
                    stt_speech_active[0] = False
                    maybe_arm_finalization()

        async def process_stt() -> None:
            async for stt_event in stt_stream:
                alt = stt_event.alternatives
                ev_type = stt_event.type

                if ev_type == SpeechEventType.START_OF_SPEECH:
                    await cancel_finalization()
                    stt_speech_active[0] = True
                    if not turn_id[0]:
                        await start_new_turn()
                    logger.debug(f"{L} 🎙️ Speech started (STT)")
                    continue

                if ev_type == SpeechEventType.END_OF_SPEECH:
                    # xAI ends an internal segment on brief pauses (endpointing). If VAD still
                    # hears the speaker, treat this as a breath — not end-of-turn — so live
                    # interims resume in the same bubble without waiting for finalize.
                    if vad_speech_active[0]:
                        logger.debug(f"{L} 🔇 STT segment pause (VAD still active — same turn)")
                        try:
                            stt_stream.flush()
                        except Exception:
                            pass
                        continue
                    stt_speech_active[0] = False
                    logger.debug(f"{L} 🔇 Speech ended (STT / xAI speech_final)")
                    maybe_arm_finalization()
                    continue

                if not alt:
                    continue
                speech_data = alt[0]
                text = speech_data.text.strip()
                if not text:
                    continue

                if ev_type == SpeechEventType.INTERIM_TRANSCRIPT:
                    await ensure_lanes_for_caption()
                    committed = " ".join(turn_original_parts).strip()
                    # Streaming STT (esp. Deepgram) sends cumulative open-chunk interims.
                    display_text = (
                        stitch_committed_and_open(committed, text) if committed else text
                    )
                    schedule_live_partial(display_text)

                elif ev_type == SpeechEventType.FINAL_TRANSCRIPT:
                    await ensure_lanes_for_caption()
                    full_so_far = " ".join(turn_original_parts).strip()
                    if full_so_far and text == full_so_far:
                        logger.debug(f"{L} duplicate turn final ignored")
                        continue
                    # Cumulative final for the whole turn so far — append only new tail.
                    if full_so_far and (
                        text.startswith(full_so_far + " ")
                        or (len(text) > len(full_so_far) and text.startswith(full_so_far))
                    ):
                        text = text[len(full_so_far) :].strip()
                        if not text:
                            logger.debug(f"{L} duplicate cumulative final ignored")
                            continue
                    # Safe dedup: chunk final may restate prior chunk text (xAI / endpointing).
                    if turn_original_parts:
                        last = turn_original_parts[-1]
                        if text == last:
                            logger.debug(f"{L} duplicate chunk final ignored")
                            continue
                        if text.startswith(last + " ") or text.startswith(last):
                            logger.info(
                                f"{L} 📝 Chunk final supersedes prior (cumulative): '{text[:60]}...'"
                            )
                            seg_idx = len(turn_original_parts) - 1
                            turn_original_parts[seg_idx] = text
                            full_original = " ".join(turn_original_parts)
                            for tgt, lane in lanes.items():
                                if lane.is_same_language:
                                    while len(lane.turn_translated_parts) <= seg_idx:
                                        lane.turn_translated_parts.append("")
                                    lane.turn_translated_parts[seg_idx] = text
                            schedule_live_partial(full_original)
                            continue
                    seg_idx = len(turn_original_parts)
                    turn_original_parts.append(text)
                    logger.info(f"{L} 📝 Segment {seg_idx}: '{text[:60]}...'")
                    full_original = " ".join(turn_original_parts).strip()
                    # Non-prefix chunk finals (Deepgram) can restate the whole turn — collapse.
                    if len(turn_original_parts) > 1:
                        collapsed = stitch_committed_and_open(
                            " ".join(turn_original_parts[:-1]).strip(),
                            turn_original_parts[-1],
                        )
                        if collapsed and collapsed != full_original:
                            turn_original_parts.clear()
                            turn_original_parts.append(collapsed)
                            full_original = collapsed

                    for tgt, lane in lanes.items():
                        if lane.is_same_language:
                            while len(lane.turn_translated_parts) <= seg_idx:
                                lane.turn_translated_parts.append("")
                            lane.turn_translated_parts[seg_idx] = text
                        if not lane.is_same_language and self.caption_mode != "transcription_only":
                            task = asyncio.create_task(
                                translate_segment(lane, tgt, text, seg_idx)
                            )
                            lane.pending_translate_tasks.append(task)
                    schedule_live_partial(full_original)

        try:
            await asyncio.gather(feed_audio(), process_vad(), process_stt())
        except asyncio.CancelledError:
            logger.info(f"{L} Speaker pipeline cancelled")
        except Exception as e:
            if stt_provider_name == "xai" and _is_stt_handshake_error(e):
                logger.error(
                    f"{L} xAI STT handshake failed at runtime ({e}) — retrying with Deepgram/OpenAI"
                )
                await stt_stream.aclose()
                await vad_stream.aclose()
                await audio_stream.aclose()
                fallback_inst, fallback_name = self._create_stt_instance(
                    speaker_id,
                    speaker_lang,
                    skip_providers={"xai"},
                )
                if fallback_inst is None:
                    logger.error(f"{L} No STT fallback available after xAI failure")
                    return
                participant = None
                for p in job_ctx.room.remote_participants.values():
                    if p.identity == speaker_id:
                        participant = p
                        break
                if not participant:
                    return
                audio_stream = rtc.AudioStream.from_participant(
                    participant=participant,
                    track_source=rtc.TrackSource.SOURCE_MICROPHONE,
                    sample_rate=16000,
                    num_channels=1,
                )
                stt_stream = fallback_inst.stream()
                vad_stream = vad_instance.stream()
                stt_provider_name = fallback_name
                turn_original_parts.clear()
                last_live_publish[0] = ""
                await asyncio.gather(feed_audio(), process_vad(), process_stt())
            else:
                logger.error(f"{L} Pipeline error: {e}", exc_info=True)
        finally:
            await self._unregister_caption_session(speaker_id)
            if turn_id[0]:
                await finalize_turn()
            await stt_stream.aclose()
            await vad_stream.aclose()
            await audio_stream.aclose()


def log_resolved_inference_config() -> None:
    """Log effective inference env once per worker (never print API key values)."""
    lc_cloud = os.getenv("LIVEKIT_CLOUD", "").lower() == "true"
    stt = os.getenv("STT_PROVIDER", "deepgram").strip().lower()
    llm = os.getenv("LLM_PROVIDER", "openai").strip().lower()
    xai_llm_model = os.getenv("XAI_LLM_MODEL", "grok-4.20-non-reasoning").strip()
    xai_endpoint = str(_xai_stt_endpointing_ms())

    build_ref = (
        os.getenv("AGENT_BUILD_REF")
        or os.getenv("GIT_COMMIT")
        or os.getenv("RAILWAY_GIT_COMMIT_SHA")
        or os.getenv("VERCEL_GIT_COMMIT_SHA")
        or "unset"
    )
    has_xai = bool(_xai_api_key())
    has_deepgram_env = bool(os.getenv("DEEPGRAM_API_KEY"))
    has_openai = bool(os.getenv("OPENAI_API_KEY"))

    stt_primary = {"xai": "xAI Grok STT (then Deepgram, then OpenAI transcribe fallback)", 
                   "deepgram": "Deepgram nova-3 (then OpenAI transcribe fallback)", 
                   "openai": "OpenAI gpt-4o-transcribe (then Deepgram fallback)"}.get(
        stt, "custom order"
    )

    warn = ""
    if stt == "deepgram" and has_xai:
        warn = (
            " NOTE: XAI_API_KEY is set but STT_PROVIDER is default 'deepgram' — "
            "set STT_PROVIDER=xai in LiveKit Agent env to use Grok STT."
        )

    logger.info("=" * 60)
    logger.info("RESOLVED INFERENCE CONFIG (transcription_only_agent)")
    logger.info(f"  build_ref={build_ref}")
    logger.info(
        "  LIVEKIT_CLOUD raw=%r interpreted_as_livekit_cloud_inference_defaults=%s",
        os.getenv("LIVEKIT_CLOUD", ""),
        lc_cloud,
    )
    logger.info(
        "  STT_PROVIDER=%r primary_path=%s%s",
        stt,
        stt_primary,
        warn or "",
    )
    logger.info("  LLM_PROVIDER=%r (translation lanes; same-language captions skip LLM)", llm)
    if llm == "xai":
        logger.info(f"  XAI_LLM_MODEL={xai_llm_model!r} (live translation)")
    else:
        logger.info("  Translation LLM: OpenAI SDK default (~gpt-4o-mini logged per lane)")
    logger.info(f"  XAI_STT_ENDPOINTING_MS={xai_endpoint!r} (xAI docs default=10, plugin default=100)")
    logger.info(f"  xAI STT endpoints: WS={XAI_STT_WS_URL} REST={XAI_STT_REST_URL}")
    logger.info(f"  keys_present mask: XAI_API_KEY={'yes' if has_xai else 'no'}, "
                f"DEEPGRAM_API_KEY={'yes' if has_deepgram_env else 'no'}, "
                f"OPENAI_API_KEY={'yes' if has_openai else 'no'}")
    logger.info("  (Unset keys may still use LiveKit Cloud-injected Deepgram/STT defaults when LIVEKIT_CLOUD=true.)")
    logger.info("=" * 60)


async def main(ctx: JobContext):
    if os.getenv("STT_PROVIDER", "deepgram").strip().lower() == "xai":
        ok, reason = await probe_xai_stt_connection()
        if ok:
            logger.info("✅ xAI STT probe OK (%s)", XAI_STT_WS_URL)
        else:
            logger.error("❌ xAI STT probe failed: %s", reason)
    agent = TranscriptionOnlyAgent()
    await agent.entrypoint(ctx)


def prewarm(proc) -> None:
    """Run once per worker process — validate xAI STT when configured."""
    if os.getenv("STT_PROVIDER", "deepgram").strip().lower() != "xai":
        return
    try:
        ok, reason = asyncio.run(probe_xai_stt_connection())
        proc.userdata["xai_stt_probe_ok"] = ok
        proc.userdata["xai_stt_probe_reason"] = reason
        if ok:
            logger.info("✅ Worker prewarm: xAI STT reachable at %s", XAI_STT_WS_URL)
        else:
            logger.error("❌ Worker prewarm: xAI STT probe failed: %s", reason)
    except Exception as e:
        logger.error("❌ Worker prewarm: xAI STT probe error: %s", e)


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    log_resolved_inference_config()

    agent_name = os.getenv('AGENT_NAME', 'translation-cloud-prod')
    worker_opts = WorkerOptions(
        entrypoint_fnc=main,
        prewarm_fnc=prewarm,
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
