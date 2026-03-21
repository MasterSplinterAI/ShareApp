#!/usr/bin/env python3
"""
Transcription-Only Translation Agent - STT → LLM → Publish (no TTS)

No spoken translation - transcriptions only. Nothing is lost on interruptions.
Uses same architecture as pipeline agent: one assistant per (speaker, target_language) pair.
Publishes partial (live) and final (original + translated) to data channel.
"""

import os
import json
import asyncio
import logging
import sys
import time
from typing import Dict

from livekit import agents, rtc
from livekit.agents import JobContext, WorkerOptions, cli, room_io, AutoSubscribe
from livekit.agents.voice import AgentSession, Agent
from livekit.plugins import silero

try:
    from livekit.plugins import deepgram, openai
    PLUGINS_AVAILABLE = True
except ImportError:
    PLUGINS_AVAILABLE = False
    deepgram = None
    openai = None

try:
    from livekit.plugins import noise_cancellation
    NOISE_CANCELLATION_AVAILABLE = True
except ImportError:
    NOISE_CANCELLATION_AVAILABLE = False
    noise_cancellation = None

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
    "it": "Italian", "pt": "Portuguese", "zh": "Chinese", "ja": "Japanese",
    "ko": "Korean", "ru": "Russian", "ar": "Arabic", "hi": "Hindi",
    "tiv": "Tiv",
}


class TranscriptionOnlyAgent:
    def __init__(self):
        self.participant_languages: Dict[str, str] = {}  # Single language = both speak & hear
        self.translation_enabled: Dict[str, bool] = {}
        self.assistants: Dict[str, agents.voice.AgentSession] = {}
        self.host_vad_sensitivity = "normal"

    def _normalize_language_code(self, lang: str) -> str:
        if not lang:
            return "en"
        return lang.split("-")[0].lower()

    def _vad_params(self) -> dict:
        return {
            "activation_threshold": 0.5,
            "min_speech_duration": 0.15,
            "min_silence_duration": 0.9,
            "prefix_padding_duration": 0.8,
        }

    async def entrypoint(self, ctx: JobContext):
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        logger.info(f"📋 Room: {ctx.room.name} - Transcription-only agent (no TTS)")

        async def handle_data(data: rtc.DataPacket):
            try:
                msg = json.loads(data.data.decode("utf-8"))
                participant_id = data.participant.identity if data.participant else msg.get("participantName", "unknown")
                msg_type = msg.get("type")

                if msg_type == "language_update":
                    lang = msg.get("language", "en")
                    enabled = msg.get("enabled", False)
                elif msg_type == "language_preference":
                    lang = msg.get("target_language") or msg.get("language", "en")
                    enabled = msg.get("translation_enabled", msg.get("enabled", False))
                else:
                    logger.debug(f"Data received (ignored): type={msg_type}, from={participant_id}")
                    return

                # Single language = both speak and hear
                self.participant_languages[participant_id] = lang
                self.translation_enabled[participant_id] = bool(enabled)

                logger.info(f"📥 Language update: {participant_id} → {lang}, enabled={enabled}")

                if enabled:
                    await self.update_assistants(ctx)
                else:
                    keys_to_remove = [k for k in self.assistants if k.startswith(f"{participant_id}:")]
                    for key in keys_to_remove:
                        task_or_session = self.assistants.pop(key)
                        if isinstance(task_or_session, asyncio.Task):
                            task_or_session.cancel()
                        elif hasattr(task_or_session, 'aclose'):
                            await task_or_session.aclose()
                    await self.update_assistants(ctx)
            except Exception as e:
                logger.error(f"Data error: {e}", exc_info=True)

        def on_data(data: rtc.DataPacket):
            asyncio.create_task(handle_data(data))

        async def on_connected(participant: rtc.RemoteParticipant):
            await self.update_assistants(ctx)

        async def on_track_published(pub: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
            if pub.kind == rtc.TrackKind.KIND_AUDIO:
                await self.update_assistants(ctx)

        async def on_disconnected(participant: rtc.RemoteParticipant):
            pid = participant.identity
            self.participant_languages.pop(pid, None)
            self.translation_enabled.pop(pid, None)
            await self.update_assistants(ctx)

        ctx.room.on("data_received", on_data)
        ctx.room.on("participant_connected", lambda p: asyncio.create_task(on_connected(p)))
        ctx.room.on("track_published", lambda pub, p: asyncio.create_task(on_track_published(pub, p)))
        ctx.room.on("participant_disconnected", lambda p: asyncio.create_task(on_disconnected(p)))

        await asyncio.Event().wait()

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

        logger.info(f"📊 update_assistants: speakers={speakers}, targets={targets}, participant_langs={dict(self.participant_languages)}, enabled={dict(self.translation_enabled)}")

        expected = set()

        # Pass 1: Cross-language assistants (translation)
        for speaker in speakers:
            speaker_lang = self.participant_languages.get(speaker, "en")
            for target in targets:
                if self._normalize_language_code(speaker_lang) != self._normalize_language_code(target):
                    key = f"{speaker}:{target}"
                    expected.add(key)
                    if key not in self.assistants:
                        await self.create_assistant(ctx, speaker, target, is_same_language=False)

        # Pass 2: Same-language assistants (caption-only) - ONLY when speaker has NO cross-language
        for speaker in speakers:
            speaker_lang = self.participant_languages.get(speaker, "en")
            has_cross_language = any(
                self._normalize_language_code(speaker_lang) != self._normalize_language_code(t)
                for t in targets
            )
            if has_cross_language:
                continue
            for target in targets:
                if self._normalize_language_code(speaker_lang) == self._normalize_language_code(target):
                    key = f"{speaker}:{target}"
                    expected.add(key)
                    if key not in self.assistants:
                        logger.info(f"📝 Creating caption-only assistant: {speaker} → {target} (mono-lingual)")
                        await self.create_assistant(ctx, speaker, target, is_same_language=True)

        for key in list(self.assistants.keys()):
            if key not in expected:
                task_or_session = self.assistants.pop(key)
                if isinstance(task_or_session, asyncio.Task):
                    task_or_session.cancel()
                elif hasattr(task_or_session, 'aclose'):
                    await task_or_session.aclose()

    async def create_assistant(self, ctx: JobContext, speaker_id: str, target_lang: str, is_same_language: bool = False):
        """Direct STT + LLM streaming pipeline (no AgentSession).

        - Cross-language (is_same_language=False): STT + LLM translation
        - Same-language (is_same_language=True): STT only, no LLM (caption-only)
        """
        speaker_lang = self.participant_languages.get(speaker_id, "en")
        target_lang_name = LANG_NAMES.get(target_lang, target_lang)

        is_cloud = os.getenv('LIVEKIT_CLOUD', '').lower() == 'true'
        stt_lang = speaker_lang.split("-")[0] if speaker_lang else "en"

        # STT: Deepgram nova-3 preferred (real-time interim results)
        # Cloud: LiveKit Inference routes Deepgram automatically (no API key needed)
        # Local: needs DEEPGRAM_API_KEY, falls back to OpenAI gpt-4o-transcribe
        stt_instance = None
        if PLUGINS_AVAILABLE and deepgram and (is_cloud or os.getenv('DEEPGRAM_API_KEY')):
            stt_instance = deepgram.STT(
                model="nova-3",
                language=stt_lang,
                interim_results=True,
                punctuate=True,
                smart_format=True,
            )
            logger.info(f"[{speaker_id}→{target_lang}] STT: Deepgram nova-3 (interim_results=True)")
        elif PLUGINS_AVAILABLE and openai and (is_cloud or os.getenv('OPENAI_API_KEY')):
            stt_instance = openai.STT(model="gpt-4o-transcribe", language=stt_lang)
            logger.info(f"[{speaker_id}→{target_lang}] STT: OpenAI gpt-4o-transcribe (no interim results)")

        if stt_instance is None:
            logger.error(f"[{speaker_id}→{target_lang}] No STT provider available")
            return

        # LLM: OpenAI for translation (skip for same-language caption-only)
        llm_instance = None
        if not is_same_language:
            if PLUGINS_AVAILABLE and openai and (is_cloud or os.getenv('OPENAI_API_KEY')):
                llm_instance = openai.LLM()
            if llm_instance is None:
                logger.error(f"[{speaker_id}→{target_lang}] No LLM available")
                return

        vad_instance = silero.VAD.load(**self._vad_params())
        key = f"{speaker_id}:{target_lang}"
        seg_counter = [0]

        async def _run_pipeline():
            from livekit.agents.llm import ChatContext

            participant = None
            for p in ctx.room.remote_participants.values():
                if p.identity == speaker_id:
                    participant = p
                    break
            if not participant:
                logger.warning(f"[{key}] Participant {speaker_id} not found")
                return

            from livekit.agents.stt import SpeechEventType

            audio_stream = rtc.AudioStream.from_participant(
                participant=participant,
                track_source=rtc.TrackSource.SOURCE_MICROPHONE,
                sample_rate=16000,
                num_channels=1,
            )
            stt_stream = stt_instance.stream()
            vad_stream = vad_instance.stream()

            # Turn-level state: accumulate segments within a single speaking turn
            # so the frontend gets one bubble per turn, not per sentence fragment.
            turn_id = [None]
            turn_original_parts = []  # accumulated original text segments
            turn_translated_parts = []  # accumulated translated text segments
            turn_start_time = [0.0]
            speech_active = [False]
            pending_translate_tasks = []

            async def _publish(msg_dict, reliable=False):
                await ctx.room.local_participant.publish_data(
                    json.dumps(msg_dict).encode("utf-8"),
                    topic="transcription",
                    reliable=reliable,
                )

            async def _translate_segment(original: str, seg_idx: int):
                """Translate one segment and store result in turn_translated_parts."""
                try:
                    chat_ctx = ChatContext()
                    chat_ctx.add_message(
                        role="system",
                        content=f"Translate the following text to {target_lang_name}. Output ONLY the translation, nothing else.",
                    )
                    chat_ctx.add_message(role="user", content=original)

                    accumulated = ""
                    stream = llm_instance.chat(chat_ctx=chat_ctx)
                    async for chunk in stream:
                        delta = chunk.delta.content if chunk.delta and chunk.delta.content else ""
                        if not delta:
                            continue
                        accumulated += delta

                        # Grow the translated parts list and publish the full turn so far
                        while len(turn_translated_parts) <= seg_idx:
                            turn_translated_parts.append("")
                        turn_translated_parts[seg_idx] = accumulated

                        full_original = " ".join(turn_original_parts)
                        full_translated = " ".join(p for p in turn_translated_parts if p)

                        await _publish({
                            "type": "transcription",
                            "originalText": full_original,
                            "text": full_translated,
                            "language": target_lang,
                            "participant_id": speaker_id,
                            "partial": True,
                            "final": False,
                            "timestamp": asyncio.get_event_loop().time(),
                            "transcriptionId": turn_id[0],
                        })
                    await stream.aclose()

                    while len(turn_translated_parts) <= seg_idx:
                        turn_translated_parts.append("")
                    turn_translated_parts[seg_idx] = accumulated.strip()

                except Exception as e:
                    logger.error(f"[{key}] LLM error for segment {seg_idx}: {e}", exc_info=True)
                    while len(turn_translated_parts) <= seg_idx:
                        turn_translated_parts.append("")
                    turn_translated_parts[seg_idx] = original

            async def _finalize_turn():
                """Wait for all translations and publish the final combined message."""
                if pending_translate_tasks:
                    await asyncio.gather(*pending_translate_tasks, return_exceptions=True)
                    pending_translate_tasks.clear()

                full_original = " ".join(turn_original_parts)
                full_translated = " ".join(p for p in turn_translated_parts if p)
                tid = turn_id[0]

                if full_original.strip():
                    has_translation = full_original.strip().lower() != full_translated.strip().lower()
                    await _publish({
                        "type": "transcription",
                        "text": full_translated or full_original,
                        "originalText": full_original,
                        "language": target_lang,
                        "participant_id": speaker_id,
                        "partial": False,
                        "final": True,
                        "timestamp": asyncio.get_event_loop().time(),
                        "hasTranslation": has_translation,
                        "transcriptionId": tid,
                    }, reliable=True)
                    logger.info(f"[{key}] ✅ Turn final: '{full_original[:50]}...' → '{full_translated[:50]}...'")

                turn_original_parts.clear()
                turn_translated_parts.clear()
                turn_id[0] = None

            def _start_new_turn():
                seg_counter[0] += 1
                turn_id[0] = f"{speaker_id}-{target_lang}-turn-{seg_counter[0]}-{int(asyncio.get_event_loop().time()*1000)}"
                turn_original_parts.clear()
                turn_translated_parts.clear()
                pending_translate_tasks.clear()
                turn_start_time[0] = asyncio.get_event_loop().time()

            from collections import deque
            PRE_SPEECH_BUFFER_FRAMES = 50  # ~1.5s at 30fps — captures first words before VAD fires
            pre_speech_buffer = deque(maxlen=PRE_SPEECH_BUFFER_FRAMES)

            async def _feed_audio():
                async for ev in audio_stream:
                    vad_stream.push_frame(ev.frame)
                    if speech_active[0]:
                        stt_stream.push_frame(ev.frame)
                    else:
                        pre_speech_buffer.append(ev.frame)

            async def _process_vad():
                """Use VAD to detect turn boundaries (start/end of speech)."""
                from livekit.agents.vad import VADEventType
                async for vad_event in vad_stream:
                    if vad_event.type == VADEventType.START_OF_SPEECH:
                        speech_active[0] = True
                        # Flush buffered pre-speech frames so the first word isn't clipped
                        for frame in pre_speech_buffer:
                            stt_stream.push_frame(frame)
                        pre_speech_buffer.clear()
                        if not turn_id[0]:
                            _start_new_turn()
                        logger.debug(f"[{key}] 🎙️ Speech started")
                    elif vad_event.type == VADEventType.END_OF_SPEECH:
                        speech_active[0] = False
                        logger.debug(f"[{key}] 🔇 Speech ended")
                        # Give STT a moment to finalize, then close the turn
                        await asyncio.sleep(1.5)
                        if not speech_active[0] and turn_id[0]:
                            stt_stream.flush()
                            await asyncio.sleep(0.5)
                            await _finalize_turn()

            async def _process_stt():
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
                            _start_new_turn()
                        # Publish the full turn so far + this interim
                        full_so_far = " ".join(turn_original_parts)
                        display_text = (full_so_far + " " + text).strip() if full_so_far else text
                        full_translated = " ".join(p for p in turn_translated_parts if p)

                        await _publish({
                            "type": "transcription",
                            "originalText": display_text,
                            "text": full_translated if full_translated else display_text,
                            "language": target_lang,
                            "participant_id": speaker_id,
                            "partial": True,
                            "final": False,
                            "timestamp": asyncio.get_event_loop().time(),
                            "transcriptionId": turn_id[0],
                        })

                    elif ev_type == SpeechEventType.FINAL_TRANSCRIPT:
                        if not turn_id[0]:
                            _start_new_turn()
                        seg_idx = len(turn_original_parts)
                        turn_original_parts.append(text)
                        logger.info(f"[{key}] 📝 Segment {seg_idx}: '{text[:60]}...'")

                        # Publish updated original immediately
                        full_original = " ".join(turn_original_parts)
                        if is_same_language:
                            # Caption-only: use original as "translated" (no LLM)
                            while len(turn_translated_parts) <= seg_idx:
                                turn_translated_parts.append("")
                            turn_translated_parts[seg_idx] = text
                            full_translated = " ".join(p for p in turn_translated_parts if p)
                        else:
                            full_translated = " ".join(p for p in turn_translated_parts if p)

                        await _publish({
                            "type": "transcription",
                            "originalText": full_original,
                            "text": full_translated if full_translated else full_original,
                            "language": target_lang,
                            "participant_id": speaker_id,
                            "partial": True,
                            "final": False,
                            "timestamp": asyncio.get_event_loop().time(),
                            "transcriptionId": turn_id[0],
                        })

                        if not is_same_language:
                            task = asyncio.create_task(_translate_segment(text, seg_idx))
                            pending_translate_tasks.append(task)

            try:
                await asyncio.gather(_feed_audio(), _process_vad(), _process_stt())
            except asyncio.CancelledError:
                logger.info(f"[{key}] Pipeline cancelled")
            except Exception as e:
                logger.error(f"[{key}] Pipeline error: {e}", exc_info=True)
            finally:
                if turn_id[0]:
                    await _finalize_turn()
                await stt_stream.aclose()
                await vad_stream.aclose()
                await audio_stream.aclose()

        task = asyncio.create_task(_run_pipeline())
        self.assistants[key] = task
        logger.info(f"✅ Direct STT pipeline: {speaker_id} → {target_lang}")


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
