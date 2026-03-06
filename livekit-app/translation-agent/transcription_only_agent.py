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


class NoOpTTS:
    """TTS that yields no audio - satisfies AgentSession without publishing audio."""

    async def synthesize(self, text: str, **kwargs):
        """Empty async generator - no audio output."""
        if False:
            yield


class TranslatorAgent(Agent):
    """Agent that translates user speech to target language. Output goes to data channel, not TTS."""
    def __init__(self, target_lang: str, target_lang_name: str):
        instructions = f"""You are a translator. Translate the user's speech into {target_lang_name} ({target_lang}).
Output ONLY the translation. No explanations, greetings, or meta-commentary."""
        super().__init__(instructions=instructions)
        self.target_lang = target_lang
        self.target_lang_name = target_lang_name


class TranscriptionOnlyAgent:
    def __init__(self):
        self.participant_languages: Dict[str, str] = {}  # What each wants to HEAR (target)
        self.participant_spoken_languages: Dict[str, str] = {}  # What each SPEAKS (for assistant routing)
        self.translation_enabled: Dict[str, bool] = {}
        self.assistants: Dict[str, agents.voice.AgentSession] = {}
        self.host_vad_sensitivity = "normal"

    def _normalize_language_code(self, lang: str) -> str:
        if not lang:
            return "en"
        return lang.split("-")[0].lower()

    def _vad_params(self) -> dict:
        return {
            "activation_threshold": 0.7,
            "min_speech_duration": 0.4,   # Lower: capture start of sentence ("Is there...")
            "min_silence_duration": 2.0,  # Longer: don't cut off mid-sentence on brief pause
            "prefix_padding_duration": 0.8,  # More prefix: capture words before VAD activated
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
                    spoken = msg.get("spoken_language") or msg.get("language", "en")
                    enabled = msg.get("enabled", False)
                elif msg_type == "language_preference":
                    lang = msg.get("target_language") or msg.get("language", "en")
                    spoken = msg.get("spoken_language") or msg.get("target_language") or msg.get("language", "en")
                    enabled = msg.get("translation_enabled", msg.get("enabled", False))
                else:
                    logger.debug(f"Data received (ignored): type={msg_type}, from={participant_id}")
                    return

                self.participant_languages[participant_id] = lang  # What they want to hear
                self.participant_spoken_languages[participant_id] = spoken  # What they speak
                self.translation_enabled[participant_id] = bool(enabled)

                logger.info(f"📥 Language update: {participant_id} → hear={lang}, speak={spoken}, enabled={enabled}")

                if enabled:
                    await self.update_assistants(ctx)
                else:
                    keys_to_remove = [k for k in self.assistants if k.startswith(f"{participant_id}:")]
                    for key in keys_to_remove:
                        session = self.assistants.pop(key)
                        await session.aclose()
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
            self.participant_spoken_languages.pop(pid, None)
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
        for speaker in speakers:
            # Use spoken language (what they speak), not target (what they want to hear)
            speaker_lang = self.participant_spoken_languages.get(speaker) or self.participant_languages.get(speaker, "en")
            for target in targets:
                if self._normalize_language_code(speaker_lang) == self._normalize_language_code(target):
                    continue
                key = f"{speaker}:{target}"
                expected.add(key)
                if key not in self.assistants:
                    await self.create_assistant(ctx, speaker, target)

        for key in list(self.assistants.keys()):
            if key not in expected:
                session = self.assistants.pop(key)
                await session.aclose()

    async def create_assistant(self, ctx: JobContext, speaker_id: str, target_lang: str):
        speaker_lang = self.participant_spoken_languages.get(speaker_id) or self.participant_languages.get(speaker_id, "en")
        lang_names = {"es": "Spanish", "en": "English", "fr": "French", "de": "German"}
        target_lang_name = lang_names.get(target_lang, target_lang)

        is_local = os.getenv('LIVEKIT_CLOUD', '').lower() != 'true'
        if is_local and PLUGINS_AVAILABLE and openai and os.getenv('OPENAI_API_KEY'):
            stt_provider = openai.STT(model="gpt-4o-transcribe", language=speaker_lang.split("-")[0] if speaker_lang else "en")
            llm_provider = openai.LLM()
            logger.info(f"[{speaker_id}→{target_lang}] Using local OpenAI plugins")
        else:
            stt_provider = "openai/gpt-4o-transcribe"
            llm_provider = "openai/gpt-4o-mini"
            logger.info(f"[{speaker_id}→{target_lang}] Using LiveKit Inference: STT=gpt-4o-transcribe, LLM=gpt-4o-mini")

        vad_params = self._vad_params()
        vad_instance = silero.VAD.load(**vad_params)

        # NoOpTTS - no audio output; we publish transcriptions to data channel only
        tts_provider = NoOpTTS()

        session = AgentSession(
            turn_detection="vad",
            stt=stt_provider,
            llm=llm_provider,
            tts=tts_provider,
            vad=vad_instance,
            allow_interruptions=True,  # CRITICAL: With NoOpTTS, must allow so agent doesn't block next input
            preemptive_generation=False,
            min_endpointing_delay=0.5,
            max_endpointing_delay=3.0,
        )

        session.user_data = {
            "source_speaker_id": speaker_id,
            "pending_transcription_id": None,
            "pending_original": None,
            "current_partial": "",
            "published_transcription_ids": set(),
            "current_translation": "",  # For streaming accumulation
        }

        @session.on("user_input_transcribed")
        def on_transcribed(evt):
            transcript = (getattr(evt, "text", "") or getattr(evt, "transcript", "") or "").strip()
            if not transcript:
                logger.debug(f"[{target_lang}] user_input_transcribed: empty transcript")
                return

            is_final = getattr(evt, "is_final", None)
            if is_final is None and hasattr(evt, "model_dump"):
                is_final = bool(evt.model_dump().get("is_final", False))
            is_final = is_final or False

            if not is_final:
                # Partial - stream live caption (stable ID so frontend updates same block)
                t0 = time.perf_counter()
                trans_id = session.user_data.get("pending_transcription_id")
                if not trans_id:
                    now = asyncio.get_event_loop().time()
                    trans_id = f"{speaker_id}-{target_lang}-{int(now * 1000)}"
                    session.user_data["pending_transcription_id"] = trans_id
                session.user_data["current_partial"] = transcript

                async def pub_partial():
                    partial_text = session.user_data.get("current_partial", transcript)
                    msg = json.dumps({
                        "type": "transcription",
                        "originalText": partial_text,
                        "text": partial_text,
                        "language": target_lang,
                        "participant_id": speaker_id,
                        "partial": True,
                        "final": False,
                        "timestamp": asyncio.get_event_loop().time(),
                        "transcriptionId": trans_id,
                    })
                    await ctx.room.local_participant.publish_data(msg.encode("utf-8"), topic="transcription", reliable=False)
                asyncio.create_task(pub_partial())
                logger.debug(f"[{target_lang}] 📝 Partial from {speaker_id} (+{(time.perf_counter()-t0)*1000:.0f}ms): '{transcript[:60]}...'")
                return

            # Final - store for translation; accept single words too
            session.user_data["_t_stt_final"] = time.perf_counter()
            logger.info(f"[{target_lang}] 📝 STT final from {speaker_id}: '{transcript[:80]}...'")
            now = asyncio.get_event_loop().time()
            trans_id = f"{speaker_id}-{target_lang}-{int(now * 1000)}"
            session.user_data["pending_original"] = transcript
            session.user_data["pending_transcription_id"] = trans_id
            session.user_data["current_translation"] = ""
            # Clear partial caption after a short delay (final will replace it)
            session.user_data["current_partial"] = ""

        @session.on("agent_speech_delta")
        def on_agent_speech_delta(evt):
            """Stream LLM translation chunks (may not fire with NoOpTTS, but try)."""
            delta = getattr(evt, "delta", None) or getattr(evt, "text", "") or ""
            if not delta:
                return
            session.user_data["current_translation"] = session.user_data.get("current_translation", "") + delta
            accumulated = session.user_data["current_translation"]
            original = session.user_data.get("pending_original", "")
            if original and (len(accumulated.split()) >= 2 or len(accumulated) >= 15):
                async def pub_stream():
                    msg = json.dumps({
                        "type": "transcription",
                        "originalText": original,
                        "text": accumulated,
                        "language": target_lang,
                        "participant_id": speaker_id,
                        "partial": True,
                        "final": False,
                        "timestamp": asyncio.get_event_loop().time(),
                        "transcriptionId": session.user_data.get("pending_transcription_id"),
                    })
                    await ctx.room.local_participant.publish_data(msg.encode("utf-8"), topic="transcription", reliable=False)
                asyncio.create_task(pub_stream())
                logger.debug(f"[{target_lang}] 📤 Streaming translation: '{accumulated[:60]}...'")

        @session.on("agent_speech_committed")
        def on_agent_speech_committed(evt):
            """Final translation from LLM (may fire even with NoOpTTS when text is generated)."""
            final = getattr(evt, "text", "") or session.user_data.get("current_translation", "")
            if hasattr(evt, "model_dump"):
                d = evt.model_dump()
                final = final or d.get("text", "") or d.get("content", "")
            final = str(final or "").strip()
            if not final:
                logger.debug(f"[{target_lang}] agent_speech_committed: no text")
                return
            original = session.user_data.get("pending_original", "")
            trans_id = session.user_data.get("pending_transcription_id")
            if not original or not trans_id:
                logger.info(f"[{target_lang}] agent_speech_committed: no pending (original={bool(original)}, trans_id={bool(trans_id)})")
                return
            published = session.user_data.get("published_transcription_ids") or set()
            if trans_id in published:
                return
            session.user_data["published_transcription_ids"] = published | {trans_id}

            async def publish():
                msg_data = {
                    "type": "transcription",
                    "text": final,
                    "originalText": original,
                    "language": target_lang,
                    "participant_id": speaker_id,
                    "partial": False,
                    "final": True,
                    "timestamp": asyncio.get_event_loop().time(),
                    "hasTranslation": original.strip().lower() != final.strip().lower(),
                    "transcriptionId": trans_id,
                }
                await ctx.room.local_participant.publish_data(
                    json.dumps(msg_data).encode("utf-8"),
                    topic="transcription",
                    reliable=True,
                )
                t0 = session.user_data.get("_t_stt_final")
                elapsed = (time.perf_counter() - t0) * 1000 if t0 else 0
                logger.info(f"[{target_lang}] ✅ Published (agent_speech_committed, +{elapsed:.0f}ms): '{original[:50]}...' → '{final[:50]}...'")
                session.user_data["pending_transcription_id"] = None
                session.user_data["pending_original"] = None
                session.user_data["current_translation"] = ""

            asyncio.create_task(publish())

        @session.on("conversation_item_added")
        def on_conversation_item_added(evt):
            item = getattr(evt, "item", None)
            if item is None:
                return
            role = getattr(item, "role", None)
            if role == "user":
                logger.debug(f"[{target_lang}] conversation_item_added: user role, skipping")
                return
            if role != "assistant":
                logger.debug(f"[{target_lang}] conversation_item_added: role={role}, skipping")
                return

            original = session.user_data.get("pending_original")
            trans_id = session.user_data.get("pending_transcription_id")
            if not original or not trans_id:
                logger.info(f"[{target_lang}] conversation_item_added: no pending (original={bool(original)}, trans_id={bool(trans_id)}) - may be out of order")
                return

            published = session.user_data.get("published_transcription_ids") or set()
            if trans_id in published:
                logger.debug(f"[{target_lang}] conversation_item_added: already published {trans_id}")
                return

            translated_parts = []
            try:
                content = getattr(item, "content", []) or []
                for c in content:
                    if isinstance(c, str) and c.strip():
                        translated_parts.append(c.strip())
                    else:
                        t = getattr(c, "transcript", None)
                        if isinstance(t, str) and t.strip():
                            translated_parts.append(t.strip())
            except Exception as e:
                logger.error(f"[{target_lang}] Failed to parse assistant content: {e}")
                return

            translated = " ".join(translated_parts).strip()
            if not translated:
                logger.info(f"[{target_lang}] conversation_item_added: empty translated content, parts={translated_parts}")
                return

            has_translation = original.strip().lower() != translated.strip().lower()
            session.user_data["published_transcription_ids"] = published | {trans_id}

            async def publish():
                msg_data = {
                    "type": "transcription",
                    "text": translated,
                    "originalText": original,
                    "language": target_lang,
                    "participant_id": speaker_id,
                    "partial": False,
                    "final": True,
                    "timestamp": asyncio.get_event_loop().time(),
                    "hasTranslation": has_translation,
                    "transcriptionId": trans_id,
                }
                await ctx.room.local_participant.publish_data(
                    json.dumps(msg_data).encode("utf-8"),
                    topic="transcription",
                    reliable=True,
                )
                t0 = session.user_data.get("_t_stt_final")
                elapsed = (time.perf_counter() - t0) * 1000 if t0 else 0
                logger.info(f"[{target_lang}] ✅ Published (conversation_item_added, +{elapsed:.0f}ms): '{original[:50]}...' → '{translated[:50]}...'")
                session.user_data["pending_transcription_id"] = None
                session.user_data["pending_original"] = None

            asyncio.create_task(publish())

        room_input_opts = room_io.RoomInputOptions(participant_identity=speaker_id)
        if NOISE_CANCELLATION_AVAILABLE and noise_cancellation:
            room_input_opts = room_io.RoomInputOptions(
                participant_identity=speaker_id,
                noise_cancellation=noise_cancellation.BVC(),
            )

        # No room_output_options - transcription only, no audio track published
        translator_agent = TranslatorAgent(target_lang=target_lang, target_lang_name=target_lang_name)
        await session.start(
            agent=translator_agent,
            room=ctx.room,
            room_input_options=room_input_opts,
        )

        self.assistants[f"{speaker_id}:{target_lang}"] = session
        logger.info(f"✅ Transcription assistant: {speaker_id} → {target_lang}")


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
