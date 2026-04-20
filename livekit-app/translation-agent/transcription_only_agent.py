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
from typing import Any, Dict, List, Optional, Set

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
class TargetLaneState:
    target_lang: str
    is_same_language: bool
    llm_instance: Optional[Any]
    target_lang_name: str
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
        # activation_threshold: lower = more sensitive to quiet speech (fewer first-word clips),
        # higher = fewer false positives from background noise. 0.4 is a good middle ground.
        return {
            "activation_threshold": float(os.getenv("VAD_ACTIVATION_THRESHOLD", "0.4")),
            "min_speech_duration": 0.15,
            "min_silence_duration": 0.9,
            "prefix_padding_duration": 0.8,
        }

    async def entrypoint(self, ctx: JobContext):
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        logger.info(f"📋 Room: {ctx.room.name} - Transcription-only agent (no TTS)")

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
            await self._shutdown_all_assistants(ctx)

    async def update_assistants(self, ctx: JobContext):
        speakers = [
            p.identity for p in ctx.room.remote_participants.values()
            if any(pub.kind == rtc.TrackKind.KIND_AUDIO for pub in p.track_publications.values())
            and not p.identity.startswith("agent-")
        ]
        targets = {
            lang for pid, lang in self.participant_languages.items()
            if self.translation_enabled.get(pid, False)
        }

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

    def _create_stt_instance(self, speaker_id: str, speaker_lang: str) -> Optional[Any]:
        """Single shared STT for one speaker (one instance per speaker pipeline)."""
        L = f"[{speaker_id}]"
        if not speaker_lang:
            logger.error(f"{L} _create_stt_instance: missing speaker_lang")
            return None
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

        def _try_xai():
            if stt_provider != "xai":
                return None
            if not XAI_AVAILABLE or xai_plugin is None:
                logger.warning(f"{L} STT_PROVIDER=xai but livekit-plugins-xai not installed — falling back")
                return None
            if not os.getenv("XAI_API_KEY"):
                logger.warning(f"{L} STT_PROVIDER=xai but XAI_API_KEY not set — falling back")
                return None
            if normalized_lang not in XAI_SUPPORTED_LANGS:
                logger.info(f"{L} xAI does not support lang={stt_lang!r} — falling back to Deepgram")
                return None
            try:
                xai_endpointing = int(os.getenv("XAI_STT_ENDPOINTING_MS", "1000"))
                inst = xai_plugin.STT(
                    language=normalized_lang,
                    enable_interim_results=True,
                    endpointing=xai_endpointing,
                )
                logger.info(f"{L} STT: xAI grok-stt lang={normalized_lang} endpointing={xai_endpointing}ms (shared)")
                return inst
            except Exception as e:
                logger.warning(f"{L} xAI STT init failed ({e}) — falling back")
                return None

        def _try_deepgram():
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
            return inst

        def _try_openai():
            if not (PLUGINS_AVAILABLE and openai and (is_cloud or os.getenv("OPENAI_API_KEY"))):
                return None
            inst = openai.STT(model="gpt-4o-transcribe", language=stt_lang)
            logger.info(f"{L} STT: OpenAI gpt-4o-transcribe (shared, no interim)")
            return inst

        provider_order = {
            "xai": [_try_xai, _try_deepgram, _try_openai],
            "deepgram": [_try_deepgram, _try_openai],
            "openai": [_try_openai, _try_deepgram],
        }.get(stt_provider, [_try_deepgram, _try_openai])

        for attempt in provider_order:
            stt_instance = attempt()
            if stt_instance is not None:
                break

        if stt_instance is None:
            logger.error(f"{L} No STT provider available (STT_PROVIDER={stt_provider})")
        return stt_instance

    def _create_llm_for_target(self, speaker_id: str, target_lang: str) -> Optional[Any]:
        L = f"[{speaker_id}→{target_lang}]"
        is_cloud = os.getenv("LIVEKIT_CLOUD", "").lower() == "true"
        llm_provider = os.getenv("LLM_PROVIDER", "openai").strip().lower()

        def _try_xai_llm():
            if llm_provider != "xai":
                return None
            if not XAI_AVAILABLE or xai_plugin is None:
                logger.warning(f"{L} LLM_PROVIDER=xai but livekit-plugins-xai not installed — falling back")
                return None
            if not os.getenv("XAI_API_KEY"):
                logger.warning(f"{L} LLM_PROVIDER=xai but XAI_API_KEY not set — falling back")
                return None
            try:
                model = os.getenv("XAI_LLM_MODEL", "grok-4-1-fast-non-reasoning")
                inst = xai_plugin.responses.LLM(model=model)
                logger.info(f"{L} LLM: xAI {model}")
                return inst
            except Exception as e:
                logger.warning(f"{L} xAI LLM init failed ({e}) — falling back")
                return None

        def _try_openai_llm():
            if not (PLUGINS_AVAILABLE and openai and (is_cloud or os.getenv("OPENAI_API_KEY"))):
                return None
            inst = openai.LLM()
            logger.info(f"{L} LLM: OpenAI (default gpt-4o-mini)")
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
        return llm_instance
    async def _run_speaker_pipeline(self, job_ctx: JobContext, run_ctx: SpeakerRunContext) -> None:
        """One STT + VAD per speaker; fan out FINAL segments to per-target LLM lanes."""
        from livekit.agents.llm import ChatContext
        from livekit.agents.stt import SpeechEventType
        from collections import deque

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
                if not is_same:
                    llm = self._create_llm_for_target(speaker_id, tgt)
                    if llm is None:
                        logger.error(f"{L}→{tgt} No LLM — skipping translation lane")
                        continue
                lanes[tgt] = TargetLaneState(
                    target_lang=tgt,
                    is_same_language=is_same,
                    llm_instance=llm,
                    target_lang_name=LANG_NAMES.get(tgt, tgt),
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

        speaker_lang = self.participant_languages.get(speaker_id)
        if not speaker_lang:
            logger.error(f"{L} No speaker language — abort pipeline")
            return

        stt_instance = self._create_stt_instance(speaker_id, speaker_lang)
        if stt_instance is None:
            return
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
        turn_original_parts: List[str] = []
        seg_counter = [0]
        speech_active = [False]
        turn_start_time = [0.0]

        async def translate_segment(
            lane: TargetLaneState, tgt_lang: str, original: str, seg_idx: int
        ) -> None:
            llm = lane.llm_instance
            if llm is None:
                return
            try:
                chat_ctx = ChatContext()
                chat_ctx.add_message(
                    role="system",
                    content=(
                        f"Translate the following text to {lane.target_lang_name}. "
                        "Output ONLY the translation, nothing else."
                    ),
                )
                chat_ctx.add_message(role="user", content=original)
                accumulated = ""
                stream = llm.chat(chat_ctx=chat_ctx)
                async for chunk in stream:
                    delta = chunk.delta.content if chunk.delta and chunk.delta.content else ""
                    if not delta:
                        continue
                    accumulated += delta
                    while len(lane.turn_translated_parts) <= seg_idx:
                        lane.turn_translated_parts.append("")
                    lane.turn_translated_parts[seg_idx] = accumulated
                    full_original = " ".join(turn_original_parts)
                    full_translated = " ".join(p for p in lane.turn_translated_parts if p)
                    await publish_lane(
                        {
                            "type": "transcription",
                            "originalText": full_original,
                            "text": full_translated,
                            "language": tgt_lang,
                            "participant_id": speaker_id,
                            "partial": True,
                            "final": False,
                            "timestamp": asyncio.get_event_loop().time(),
                            "transcriptionId": turn_id[0],
                        },
                        tgt_lang,
                        is_same_language_lane=lane.is_same_language,
                    )
                await stream.aclose()
                while len(lane.turn_translated_parts) <= seg_idx:
                    lane.turn_translated_parts.append("")
                lane.turn_translated_parts[seg_idx] = accumulated.strip()
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

            full_original = " ".join(turn_original_parts)
            tid = turn_id[0]
            if not full_original.strip():
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
                        "participant_id": speaker_id,
                        "partial": False,
                        "final": True,
                        "timestamp": asyncio.get_event_loop().time(),
                        "hasTranslation": has_translation,
                        "transcriptionId": tid,
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

        PRE_SPEECH_BUFFER_FRAMES = 50
        pre_speech_buffer = deque(maxlen=PRE_SPEECH_BUFFER_FRAMES)
        finalization_task: List[Optional[asyncio.Task]] = [None]

        async def feed_audio() -> None:
            async for ev in audio_stream:
                vad_stream.push_frame(ev.frame)
                if speech_active[0]:
                    stt_stream.push_frame(ev.frame)
                else:
                    pre_speech_buffer.append(ev.frame)

        async def schedule_finalization() -> None:
            try:
                await asyncio.sleep(1.5)
                if speech_active[0] or not turn_id[0]:
                    return
                stt_stream.flush()
                await asyncio.sleep(0.5)
                if speech_active[0] or not turn_id[0]:
                    return
                await finalize_turn()
            except asyncio.CancelledError:
                logger.debug(f"{L} ↩️ Finalization cancelled (speech resumed)")
                raise

        async def process_vad() -> None:
            from livekit.agents.vad import VADEventType

            async for vad_event in vad_stream:
                if vad_event.type == VADEventType.START_OF_SPEECH:
                    pending = finalization_task[0]
                    if pending and not pending.done():
                        pending.cancel()
                        try:
                            await pending
                        except (asyncio.CancelledError, Exception):
                            pass
                    finalization_task[0] = None
                    speech_active[0] = True
                    for frame in pre_speech_buffer:
                        stt_stream.push_frame(frame)
                    pre_speech_buffer.clear()
                    if not turn_id[0]:
                        await start_new_turn()
                    logger.debug(f"{L} 🎙️ Speech started")
                elif vad_event.type == VADEventType.END_OF_SPEECH:
                    speech_active[0] = False
                    logger.debug(f"{L} 🔇 Speech ended")
                    pending = finalization_task[0]
                    if pending and not pending.done():
                        pending.cancel()
                    finalization_task[0] = asyncio.create_task(schedule_finalization())

        async def process_stt() -> None:
            async for stt_event in stt_stream:
                alt = stt_event.alternatives
                if not alt:
                    continue
                text = alt[0].text.strip()
                if not text:
                    continue
                ev_type = stt_event.type

                if ev_type == SpeechEventType.INTERIM_TRANSCRIPT:
                    if not turn_id[0]:
                        await start_new_turn()
                    await reconcile_lanes()
                    full_so_far = " ".join(turn_original_parts)
                    display_text = (full_so_far + " " + text).strip() if full_so_far else text
                    for tgt, lane in lanes.items():
                        ft = " ".join(p for p in lane.turn_translated_parts if p)
                        await publish_lane(
                            {
                                "type": "transcription",
                                "originalText": display_text,
                                "text": ft if ft else display_text,
                                "language": tgt,
                                "participant_id": speaker_id,
                                "partial": True,
                                "final": False,
                                "timestamp": asyncio.get_event_loop().time(),
                                "transcriptionId": turn_id[0],
                            },
                            tgt,
                            is_same_language_lane=lane.is_same_language,
                        )

                elif ev_type == SpeechEventType.FINAL_TRANSCRIPT:
                    if not turn_id[0]:
                        await start_new_turn()
                    await reconcile_lanes()
                    seg_idx = len(turn_original_parts)
                    turn_original_parts.append(text)
                    logger.info(f"{L} 📝 Segment {seg_idx}: '{text[:60]}...'")
                    full_original = " ".join(turn_original_parts)

                    for tgt, lane in lanes.items():
                        if lane.is_same_language:
                            while len(lane.turn_translated_parts) <= seg_idx:
                                lane.turn_translated_parts.append("")
                            lane.turn_translated_parts[seg_idx] = text
                        full_t = " ".join(p for p in lane.turn_translated_parts if p)
                        await publish_lane(
                            {
                                "type": "transcription",
                                "originalText": full_original,
                                "text": full_t if full_t else full_original,
                                "language": tgt,
                                "participant_id": speaker_id,
                                "partial": True,
                                "final": False,
                                "timestamp": asyncio.get_event_loop().time(),
                                "transcriptionId": turn_id[0],
                            },
                            tgt,
                            is_same_language_lane=lane.is_same_language,
                        )
                        if not lane.is_same_language:
                            task = asyncio.create_task(
                                translate_segment(lane, tgt, text, seg_idx)
                            )
                            lane.pending_translate_tasks.append(task)

        try:
            await asyncio.gather(feed_audio(), process_vad(), process_stt())
        except asyncio.CancelledError:
            logger.info(f"{L} Speaker pipeline cancelled")
        except Exception as e:
            logger.error(f"{L} Pipeline error: {e}", exc_info=True)
        finally:
            if turn_id[0]:
                await finalize_turn()
            await stt_stream.aclose()
            await vad_stream.aclose()
            await audio_stream.aclose()
async def main(ctx: JobContext):
    agent = TranscriptionOnlyAgent()
    await agent.entrypoint(ctx)


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    agent_name = os.getenv('AGENT_NAME', 'translation-cloud-prod')
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
