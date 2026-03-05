#!/usr/bin/env python3
"""
Pipeline Translation Agent - STT → LLM → TTS
Uses LiveKit Inference for unified billing (no separate API keys needed)

When deployed to LiveKit Cloud, the providers (deepgram/nova-3, openai/gpt-4o-mini, openai/tts-1)
are automatically routed through LiveKit Inference, eliminating the need for DEEPGRAM_API_KEY
and OPENAI_API_KEY environment variables.

Better control over coughs, pauses, interruptions, and queuing
"""

import os
import json
import asyncio
import logging
from typing import Dict

from livekit import agents, rtc
from livekit.agents import JobContext, JobProcess, WorkerOptions, cli, room_io, AutoSubscribe
from livekit.agents.voice import AgentSession, Agent
from livekit.plugins import silero

# Import plugins for direct usage (local development with API keys)
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
    force=True  # Force reconfiguration
)
logger = logging.getLogger(__name__)
logger.info("=" * 60)
logger.info("🔧 PIPELINE TRANSLATION AGENT MODULE LOADED")
logger.info("=" * 60)

# Note: Using WorkerOptions pattern instead of AgentServer to avoid DuplexClosed errors
# This matches the working realtime_agent_simple.py pattern

class TranslatorAgent(Agent):
    """Custom Agent class for translation (following LiveKit recipe pattern)"""
    def __init__(self, target_lang: str, target_lang_name: str):
        instructions = f"""You are a translator. You translate the user's speech into {target_lang_name} ({target_lang}).

Every message you receive, translate it directly into {target_lang_name}.
Do not respond with anything else but the translation.
Do not add explanations, greetings, or meta-commentary.
Output only the translation."""
        super().__init__(instructions=instructions)
        self.target_lang = target_lang
        self.target_lang_name = target_lang_name
    # IMPORTANT:
    # Do NOT trigger generate_reply() on enter.
    # We only generate after a user utterance is committed (user_speech_committed),
    # otherwise we can get duplicate/empty TTS generations.

class PipelineTranslationAgent:
    def __init__(self):
        self.participant_languages: Dict[str, str] = {}
        self.translation_enabled: Dict[str, bool] = {}

        self.assistants: Dict[str, agents.voice.AgentSession] = {}

        self.host_vad_sensitivity = "normal"
        self.host_voice_base = "alloy"
        # Protect against cough/noise interrupting TTS:
        # - While TTS is playing, ignore short/noisy user turns
        # - After TTS ends, keep a short cooldown where very short turns are ignored
        # Reduced cooldown for faster response while still filtering noise
        self.tts_playback_cooldown_s = 1.5  # Faster response (was 2.5)

    def _vad_threshold(self) -> float:
        mapping = {
            "quiet": 0.6,
            "normal": 0.7,
            "noisy": 0.8,
            "ultra_noisy": 0.85,
        }
        return mapping.get(self.host_vad_sensitivity, 0.75)

    def _vad_params(self) -> dict:
        """Silero VAD tuning presets to reduce fragmentation and cough-triggered turns."""
        # These are intentionally conservative: they trade a bit of latency for stability.
        # CRITICAL: min_silence_duration controls when VAD commits a turn - longer = waits for complete utterances.
        if self.host_vad_sensitivity == "quiet":
            return {
                "activation_threshold": 0.6,
                "min_speech_duration": 0.7,   # Reduced for faster response (was 0.9)
                "min_silence_duration": 1.3,   # Reduced for faster turn commits (was 3.0)
                "prefix_padding_duration": 0.3,  # Reduced (was 0.4)
            }
        if self.host_vad_sensitivity == "noisy":
            return {
                "activation_threshold": 0.8,
                "min_speech_duration": 1.0,   # Reduced (was 1.2)
                "min_silence_duration": 1.6,   # Reduced for faster turn commits (was 3.2)
                "prefix_padding_duration": 0.4,  # Reduced (was 0.5)
            }
        if self.host_vad_sensitivity == "ultra_noisy":
            return {
                "activation_threshold": 0.85,
                "min_speech_duration": 1.2,   # Reduced (was 1.4)
                "min_silence_duration": 1.8,   # Reduced for faster turn commits (was 3.5)
                "prefix_padding_duration": 0.4,  # Reduced (was 0.5)
            }
        # normal
        return {
            "activation_threshold": 0.7,
            "min_speech_duration": 1.0,
            "min_silence_duration": 3.5,  # EVEN MORE INCREASED: wait much longer before committing turn (was 2.5)
            # This prevents VAD from committing multiple turns during natural pauses in continuous speech
            # Even with accumulation, we want fewer commits to reduce fragmentation
            "prefix_padding_duration": 0.5,
        }

    async def entrypoint(self, ctx: JobContext):
        """Main entrypoint (using WorkerOptions pattern like realtime_agent_simple.py)"""
        # Connect to room first
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        
        logger.info(f"✅ Connected to room: {ctx.room.name}")
        logger.info(f"Pipeline Translation Agent active in room {ctx.room.name}")
        logger.info(f"👥 Initial participants: {[p.identity for p in ctx.room.remote_participants.values()]}")
        logger.info(f"🎤 Participants with audio: {[p.identity for p in ctx.room.remote_participants.values() if any(pub.kind == rtc.TrackKind.KIND_AUDIO for pub in p.track_publications.values())]}")

        async def handle_data(data: rtc.DataPacket):
            try:
                logger.info(f"📨 DATA RECEIVED - Topic: '{data.topic}', From: {data.participant.identity if data.participant else 'unknown'}")
                logger.info(f"📨 Raw data (first 200 chars): {data.data[:200] if len(data.data) > 0 else 'empty'}")
                msg = json.loads(data.data.decode("utf-8"))

                # CRITICAL: Always use LiveKit's participant.identity for tracking (not participantName from message)
                # This ensures we can look up preferences when checking subscriptions
                participant_id = data.participant.identity  # LiveKit identity (UUID or similar)
                msg_type = msg.get("type")
                logger.info(f"📨 Parsed message type: {msg_type}, Full message: {msg}")

                # Handle host VAD setting changes
                if msg_type == "host_vad_setting":
                    new_setting = msg.get("level", "normal")
                    if new_setting in ["quiet", "normal", "noisy", "ultra_noisy"]:
                        old_setting = self.host_vad_sensitivity
                        self.host_vad_sensitivity = new_setting
                        logger.info(f"🎛️ Host changed VAD sensitivity: {old_setting} → {new_setting} (from {participant_id})")
                        await self.restart_all_assistants(ctx)
                    return

                # Handle language preference updates
                # Handle both message formats from frontend:
                # RoomControls.jsx sends: type='language_update', language, enabled, participantName
                # useTranslation.js sends: type='language_preference', target_language, translation_enabled
                if msg_type == "language_update":
                    participant_name = msg.get("participantName", participant_id)  # For logging only
                    lang = msg.get("language", "en")
                    enabled = msg.get("enabled", False)
                elif msg_type == "language_preference":
                    # Handle useTranslation.js format
                    participant_name = msg.get("participant_name", msg.get("participantName", participant_id))
                    lang = msg.get("target_language") or msg.get("language", "en")
                    enabled = msg.get("translation_enabled") if "translation_enabled" in msg else msg.get("enabled", False)
                else:
                    # Not a language preference message, skip
                    logger.debug(f"📨 Ignoring message type: {msg_type}")
                    return

                # Get old language for comparison
                old_language = self.participant_languages.get(participant_id)
                old_enabled = self.translation_enabled.get(participant_id, False)
                
                logger.info(f"🌐 Language preference received: {participant_name} (LiveKit ID: {participant_id}) -> {lang} (enabled: {enabled})")
                logger.info(f"   Old: {old_language} (enabled: {old_enabled})")
                logger.info(f"   New: {lang} (enabled: {enabled})")

                # Update preferences using LiveKit identity (CRITICAL for lookups)
                self.participant_languages[participant_id] = lang
                self.translation_enabled[participant_id] = bool(enabled)

                # Update assistants when language preference changes
                if enabled:
                    await self.update_assistants(ctx)
                else:
                    # Translation disabled - stop all assistants where this participant is the speaker
                    # Stop assistants with key format "{participant_id}:{target_language}"
                    keys_to_remove = [key for key in self.assistants.keys() if key.startswith(f"{participant_id}:")]
                    for key in keys_to_remove:
                        logger.info(f"🛑 Stopping assistant {key} (translation disabled for {participant_id})")
                        session = self.assistants.pop(key)
                        await session.aclose()
                    # Also update to clean up any remaining assistants
                    await self.update_assistants(ctx)

            except Exception as e:
                logger.error(f"Data error: {e}", exc_info=True)

        async def handle_connected(participant: rtc.RemoteParticipant):
            logger.info(f"👤 Participant connected: {participant.identity}")
            logger.info(f"   Audio tracks: {[pub.name for pub in participant.track_publications.values() if pub.kind == rtc.TrackKind.KIND_AUDIO]}")
            await self.update_assistants(ctx)

        async def handle_track_published(pub: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
            logger.info(f"🎵 Track published: {pub.name} (kind: {pub.kind}) by {participant.identity}")
            if pub.kind == rtc.TrackKind.KIND_AUDIO:
                logger.info(f"   🔊 Audio track published, updating assistants...")
                await self.update_assistants(ctx)

        async def handle_disconnected(participant: rtc.RemoteParticipant):
            pid = participant.identity
            self.participant_languages.pop(pid, None)
            self.translation_enabled.pop(pid, None)
            await self.update_assistants(ctx)

        # Register event handlers using direct registration (SDK 1.3+ compatible)
        def on_data(data: rtc.DataPacket):
            asyncio.create_task(handle_data(data))

        def on_connected(participant: rtc.RemoteParticipant):
            asyncio.create_task(handle_connected(participant))

        def on_track_published(pub: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
            asyncio.create_task(handle_track_published(pub, participant))

        def on_disconnected(participant: rtc.RemoteParticipant):
            asyncio.create_task(handle_disconnected(participant))

        ctx.room.on("data_received", on_data)
        ctx.room.on("participant_connected", on_connected)
        ctx.room.on("track_published", on_track_published)
        ctx.room.on("participant_disconnected", on_disconnected)
        
        logger.info(f"✅ Event handlers registered, waiting for events...")
        
        # Wait indefinitely (like LiveKit recipe - session handles everything)
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            logger.info(f"⚠️ Event wait cancelled (room likely closed)")
            raise

    def _normalize_language_code(self, lang: str) -> str:
        """Normalize language code to handle regional variants (e.g., es-CO -> es)"""
        if not lang:
            return "en"
        # Split on hyphen and take first part (e.g., "es-CO" -> "es")
        return lang.split("-")[0].lower()

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

        logger.info(f"📊 Updating assistants for all speaker-target pairs")
        logger.info(f"   Speakers: {speakers}")
        logger.info(f"   Target languages: {list(targets)}")
        logger.info(f"   Current assistants: {list(self.assistants.keys())}")

        expected = set()
        for speaker in speakers:
            # IMPORTANT (match realtime_agent_simple.py behavior):
            # `participant_languages[pid]` represents the language that participant speaks AND wants to hear.
            speaker_lang = self.participant_languages.get(speaker)
            if not speaker_lang:
                logger.debug(f"  ⏭️ Skipping {speaker} - no language preference set")
                continue
            
            for target in targets:
                # Skip same-language pairs (no es→es, en→en, etc.), including regional variants.
                normalized_speaker = self._normalize_language_code(speaker_lang)
                normalized_target = self._normalize_language_code(target)
                if normalized_speaker == normalized_target:
                    logger.debug(
                        f"  ⏭️ Skipping {speaker} → {target}: same language ({speaker_lang} == {target}, normalized: {normalized_speaker})"
                    )
                    continue
                
                key = f"{speaker}:{target}"
                expected.add(key)
                if key not in self.assistants:
                    logger.info(f"🆕 Creating new assistant: {speaker} ({speaker_lang}) → {target}")
                    await self.create_assistant(ctx, speaker, target)

        for key in list(self.assistants.keys()):
            if key not in expected:
                logger.info(f"🛑 Stopping assistant {key} (no longer needed)")
                session = self.assistants.pop(key)
                await session.aclose()
        
        logger.info(f"   Final assistants: {list(self.assistants.keys())}")

    async def create_assistant(self, ctx: JobContext, speaker_id: str, target_lang: str):
        voice_map = {
            "en": "alloy",
            "es": "nova",
            "fr": "shimmer",
            "de": "echo",
        }
        voice_id = voice_map.get(target_lang, "alloy")

        # Use string providers for LiveKit Inference compatibility
        # When deployed to cloud, these automatically route through LiveKit Inference
        # When running locally, they use API keys from environment variables if available
        # Reference: https://docs.livekit.io/recipes/pipeline_translator/
        
        # Detect if running locally (for API key usage)
        is_local = not os.getenv('LIVEKIT_CLOUD', '').lower() == 'true'
        
        # Speaker language is the language they speak (and usually want to hear).
        speaker_lang = self.participant_languages.get(speaker_id, "en")
        
        # Map language codes to full names for better LLM understanding
        lang_names = {
            "es": "Spanish", "en": "English", "fr": "French", "de": "German",
            "es-CO": "Spanish", "es-MX": "Spanish", "es-ES": "Spanish"
        }
        target_lang_name = lang_names.get(target_lang, target_lang)
        
        # Use OpenAI plugins directly when API key is available (more reliable than string providers)
        # String provider "openai/whisper-1" fails with LiveKit Inference connection errors
        # Since API key is set and working, use plugins directly
        if is_local and PLUGINS_AVAILABLE and openai and os.getenv('OPENAI_API_KEY'):
            logger.info(f"[{target_lang}] 🏠 Using OpenAI plugins directly (API key available)")
            logger.info(f"[{target_lang}]   OPENAI_API_KEY: ✅ Set")
            
            # Map language codes for OpenAI STT
            openai_lang_map = {
                "en": "en",
                "en-US": "en",
                "es": "es",
                "es-ES": "es",
                "es-CO": "es",
                "fr": "fr",
                "de": "de",
            }
            whisper_language = openai_lang_map.get(speaker_lang, "en")
            
            # Use OpenAI STT plugin directly - API key is set and working
            stt_provider = openai.STT(
                model="whisper-1",
                language=whisper_language,
            )
            llm_provider = openai.LLM()
            tts_provider = openai.TTS(voice=voice_id)
        else:
            # Fallback to string providers (if no API key or plugins not available)
            logger.info(f"[{target_lang}] ☁️ Using string providers (fallback)")
            logger.info(f"[{target_lang}]   OPENAI_API_KEY: {'✅ Set' if os.getenv('OPENAI_API_KEY') else '❌ Not set'}")
            stt_provider = "openai/whisper-1"
            llm_provider = "openai/gpt-4o-mini"
            tts_provider = f"openai/tts-1:{voice_id}"
        
        # Get VAD from prewarmed cache or create new one
        vad_instance = None
        vad_params = self._vad_params()
        if hasattr(ctx, 'proc') and hasattr(ctx.proc, 'userdata') and ctx.proc.userdata.get("vad"):
            # NOTE: prewarmed VAD is a shared instance with default settings.
            # For stability (cough/fragment control) we prefer per-session VAD tuned with our parameters.
            logger.info(f"[{target_lang}] ℹ️ Prewarmed VAD available, but creating tuned VAD for stability: {vad_params}")
        else:
            logger.info(f"[{target_lang}] ℹ️ Creating tuned VAD (no prewarm available): {vad_params}")
        vad_instance = silero.VAD.load(
            activation_threshold=vad_params["activation_threshold"],
            min_speech_duration=vad_params["min_speech_duration"],
            min_silence_duration=vad_params["min_silence_duration"],
            prefix_padding_duration=vad_params["prefix_padding_duration"],
        )
        
        # Create AgentSession (like LiveKit recipe)
        # Configured for fluid translation with proper queuing and interruption handling
        session = AgentSession(
            # VAD-BASED TURN DETECTION: VAD detects when speech actually ends (more reliable than STT endpointing).
            # VAD commits turns based on actual speech patterns, not just silence duration.
            # This is more responsive and reliable than waiting for STT endpointing_ms delays.
            turn_detection="vad",
            stt=stt_provider,
            llm=llm_provider,
            tts=tts_provider,
            vad=vad_instance,
            allow_interruptions=True,
            # If we decide a user interruption is not "real" (e.g., cough/noise), don't discard the TTS audio.
            # This makes translations sound continuous even when background audio is present.
            discard_audio_if_uninterruptible=False,
            # Protect against cough/noise interrupting TTS:
            # - require longer, consecutive speech before an interruption is considered real
            # - require a minimum word count (coughs/noise => 0 words)
            # Reduced thresholds for faster response while still filtering noise
            min_interruption_duration=2.0,  # Faster response (was 2.5)
            min_interruption_words=5,        # Slightly lower for responsiveness (was 6)
            false_interruption_timeout=4.0,  # Faster recovery (was 5.0)
            resume_false_interruption=True,
            # Let the SDK handle endpointing; we trigger generation only on committed user turns.
            preemptive_generation=False,
            # Tune SDK endpointing delays for faster, more responsive turns
            # Reduced delays for better responsiveness while maintaining quality
            min_endpointing_delay=0.5,  # Faster response (was 1.0)
            max_endpointing_delay=3.0,   # Still reasonable max (was 5.0)
        )
        logger.info(
            f"[{target_lang}] 🎛️ AgentSession configured: turn_detection=vad "
            f"(VAD commits turns → translate → TTS, automatic queuing) "
            f"STT={stt_provider} LLM={llm_provider} TTS={tts_provider} "
            f"(string providers - same pattern as Deepgram) "
            f"allow_interruptions=True min_interruption_duration=2.0 min_interruption_words=5 "
            f"min_endpointing_delay=0.5s max_endpointing_delay=3.0s "
            f"cooldown={self.tts_playback_cooldown_s}s"
        )
        
        # CRITICAL: Initialize session.user_data (it's not a built-in attribute!)
        # This must be done right after creating the session, before registering handlers
        session.user_data = {
            "source_speaker_id": speaker_id,
            "pending_transcription_id": None,
            "pending_original": None,
            "current_partial": "",  # Accumulate partials for live caption
            "tts_playing": False,
            "tts_last_finished_at": 0.0,
        }

        # Register event handlers AFTER session is created but BEFORE starting
        # Use decorator pattern like working agent for better event handling
        @session.on("user_input_transcribed")
        def on_transcribed(evt):
            """Handle STT transcription.

            Best practice:
            - publish INTERIM (partial) transcripts for live captions
            - on FINAL (endpointed) transcript, trigger translation/TTS exactly once
            - publish a single FINAL message containing original + translation when the assistant text is available
            """
            transcript = (
                getattr(evt, "text", "")
                or getattr(evt, "transcript", "")
                or getattr(evt, "transcription", "")
                or ""
            ).strip()
            if not transcript:
                return

            # Determine "partial" vs "final" FIRST (needed for TTS playing check below)
            # OpenAI Whisper may emit interim results; treat non-final as partial for live caption lane.
            is_final = getattr(evt, "is_final", None)
            if is_final is None and hasattr(evt, "model_dump"):
                try:
                    is_final = bool(evt.model_dump().get("is_final"))
                except Exception:
                    is_final = None
            if is_final is None:
                is_final = False

            # QUEUE SYSTEM: AgentSession automatically queues when TTS is playing.
            # We just need to ensure we capture all STT finals (even during TTS) and let the SDK queue them.
            # Don't block - let AgentSession handle queuing naturally for smooth, professional operation.
            tts_playing = session.user_data.get("tts_playing", False)
            if tts_playing:
                # During TTS: Still capture STT finals (they'll be queued by AgentSession automatically)
                # Publish partials for live captions so users see what's being said
                if not is_final:
                    async def publish_partial_during_tts():
                        message = json.dumps({
                            "type": "transcription",
                            "originalText": transcript,
                            "text": transcript,
                            "language": target_lang,
                            "participant_id": speaker_id,
                            "target_participant": "all",
                            "partial": True,
                            "final": False,
                            "timestamp": asyncio.get_event_loop().time(),
                        })
                        await ctx.room.local_participant.publish_data(
                            message.encode("utf-8"),
                            topic="transcription",
                            reliable=False,
                        )
                    asyncio.create_task(publish_partial_during_tts())
                # For finals during TTS: Let AgentSession queue them automatically
                # We'll still accumulate them here so we have the complete text when translation arrives
                if is_final:
                    logger.info(
                        f"[{target_lang}] 📥 STT final during TTS (will be queued by SDK): '{transcript[:60]}...'"
                    )
                # Continue processing - don't return early, let the SDK handle queuing
            # After playback ends, ignore very short turns for a short cooldown window (coughs, throat clears).
            last_finished = float(session.user_data.get("tts_last_finished_at") or 0.0)
            if last_finished:
                elapsed = asyncio.get_event_loop().time() - last_finished
                if elapsed < self.tts_playback_cooldown_s:
                    words = len(transcript.split())
                    if words < 3 and len(transcript) < 20:
                        logger.info(
                            f"[{target_lang}] 🚫 Ignoring short post-TTS utterance during cooldown "
                            f"({elapsed:.2f}s/{self.tts_playback_cooldown_s}s): '{transcript[:60]}'"
                        )
                        return
            
            # Publish partials here (live captions).
            # CRITICAL: Use a stable transcription ID so frontend updates the SAME live caption,
            # not creating new blocks for each partial. Accumulate partials into one live caption.
            if not is_final:
                # Get or create a stable ID for this ongoing utterance
                if not session.user_data.get("pending_transcription_id"):
                    now = asyncio.get_event_loop().time()
                    session.user_data["pending_transcription_id"] = f"{speaker_id}-{target_lang}-{int(now * 1000)}"
                
                # Accumulate partials - always use the latest/longest transcript for live caption
                # This prevents creating multiple transcription blocks during continuous speech
                session.user_data["current_partial"] = transcript
                
                async def publish_partial():
                    # Use the accumulated partial (latest transcript) for live caption
                    partial_text = session.user_data.get("current_partial", transcript)
                    message = json.dumps({
                        "type": "transcription",
                        "originalText": partial_text,
                        "text": partial_text,
                        "language": target_lang,
                        "participant_id": speaker_id,
                        "target_participant": "all",
                        "partial": True,
                        "final": False,
                        "timestamp": asyncio.get_event_loop().time(),
                        "transcriptionId": session.user_data.get("pending_transcription_id"),  # Stable ID for same caption
                    })
                    await ctx.room.local_participant.publish_data(
                        message.encode("utf-8"),
                        topic="transcription",
                        reliable=False,
                    )
                asyncio.create_task(publish_partial())
                return

            # FINAL transcript: With turn_detection="vad", VAD commits turns, but STT finals still arrive.
            # STT finals provide transcript updates, but VAD controls when translation is triggered.
            # We accumulate STT finals - conversation_item_added (role="user") is the authoritative source.
            if len(transcript.split()) < 3:
                logger.debug(f"[{target_lang}] ⏭️ Ignoring very short final utterance: '{transcript}'")
                return

            now = asyncio.get_event_loop().time()
            # Use one stable id per utterance
            if not session.user_data.get("pending_transcription_id"):
                session.user_data["pending_transcription_id"] = f"{speaker_id}-{target_lang}-{int(now * 1000)}"

            # Accumulate STT finals - they may arrive multiple times during continuous speech
            existing = session.user_data.get("pending_original") or ""
            if not existing:
                # First STT final
                session.user_data["pending_original"] = transcript
                logger.info(
                    f"[{target_lang}] 📝 STT final (first): '{transcript[:80]}...'"
                )
            elif transcript.startswith(existing):
                # New final extends existing - use the longer one
                if len(transcript) > len(existing):
                    session.user_data["pending_original"] = transcript
                    logger.debug(
                        f"[{target_lang}] 📝 STT final extended: '{transcript[:80]}...'"
                    )
            elif existing.endswith(transcript):
                # New final is already at the end - no change needed
                logger.debug(f"[{target_lang}] 📝 STT final already included: '{transcript[:60]}...'")
            else:
                # Different text - append if not already present
                if transcript not in existing:
                    session.user_data["pending_original"] = (existing + " " + transcript).strip()
                    logger.info(
                        f"[{target_lang}] 📝 STT final accumulated: '{session.user_data['pending_original'][:100]}...'"
                    )
        
        logger.info(f"[{target_lang}] ✅ Registered user_input_transcribed handler")

        @session.on("speech_created")
        def on_speech_created(evt):
            # Useful for debugging: confirms we actually started a generation (and thus should get audio)
            try:
                logger.info(
                    f"[{target_lang}] 🗣️ speech_created source={evt.source} user_initiated={evt.user_initiated} id={evt.speech_handle.id}"
                )
            except Exception:
                logger.info(f"[{target_lang}] 🗣️ speech_created")

        # Track when playback is happening so cough/noise can't create a new turn or interrupt mid-TTS.
        @session.on("playback_finished")
        def on_playback_finished(_evt):
            session.user_data["tts_playing"] = False
            session.user_data["tts_last_finished_at"] = asyncio.get_event_loop().time()
            logger.info(f"[{target_lang}] 🔊 playback_finished; entering cooldown={self.tts_playback_cooldown_s}s")
            # AgentSession automatically processes queued items after TTS finishes - no manual queue processing needed

        @session.on("agent_false_interruption")
        def on_agent_false_interruption(_evt):
            # Helpful signal when cough/noise was detected but filtered as a false interruption.
            logger.info(f"[{target_lang}] 🛡️ agent_false_interruption (noise/cough filtered)")

        @session.on("conversation_item_added")
        def on_conversation_item_added(evt):
            """Capture the assistant's translated text and publish one FINAL transcription entry."""
            item = getattr(evt, "item", None)
            if item is None:
                return

            role = getattr(item, "role", None)
            # Capture the SDK-committed user message (this is the real "whole utterance").
            # CRITICAL: With turn_detection="vad", VAD commits turns based on actual speech patterns.
            # This is the AUTHORITATIVE source for the full user utterance - VAD detects when speech actually ends.
            if role == "user":
                try:
                    content = getattr(item, "content", []) or []
                    parts = []
                    for c in content:
                        if isinstance(c, str) and c.strip():
                            parts.append(c.strip())
                        else:
                            t = getattr(c, "transcript", None)
                            if isinstance(t, str) and t.strip():
                                parts.append(t.strip())
                    full_user = " ".join(parts).strip()
                    if full_user:
                        # AUTHORITATIVE: conversation_item_added with role="user" contains the complete utterance
                        # as committed by the SDK. This is the full, complete text we should translate.
                        # Overwrite any accumulated STT finals with this authoritative version.
                        session.user_data["pending_original"] = full_user
                        # Ensure we have a transcription ID for this turn
                        if not session.user_data.get("pending_transcription_id"):
                            now = asyncio.get_event_loop().time()
                            session.user_data["pending_transcription_id"] = f"{speaker_id}-{target_lang}-{int(now * 1000)}"
                        logger.info(
                            f"[{target_lang}] ✅ User turn committed (AUTHORITATIVE): '{full_user[:100]}...' "
                            f"(id={session.user_data.get('pending_transcription_id')})"
                        )
                except Exception as e:
                    logger.error(f"[{target_lang}] ❌ Failed to extract user message: {e}", exc_info=True)
                return

            if role != "assistant":
                return

            # Mark TTS as playing when we see assistant content; playback_finished will clear it.
            # This gives us a reliable gate even if we don't get a separate "speech_started" event.
            session.user_data["tts_playing"] = True
            
            original = session.user_data.get("pending_original")
            transcription_id = session.user_data.get("pending_transcription_id")
            if not original or not transcription_id:
                # No pending utterance; ignore assistant messages not tied to a committed turn
                logger.warning(
                    f"[{target_lang}] ⚠️ Assistant message received but no pending_original "
                    f"(original={bool(original)}, id={transcription_id})"
                )
                return
            
            logger.info(
                f"[{target_lang}] 💬 Assistant message received for turn id={transcription_id}, "
                f"original='{original[:100]}...'"
            )

            # Extract assistant text from content
            translated_parts: list[str] = []
            try:
                content = getattr(item, "content", []) or []
                for c in content:
                    if isinstance(c, str):
                        if c.strip():
                            translated_parts.append(c.strip())
                    else:
                        # e.g. AudioContent(transcript=...)
                        t = getattr(c, "transcript", None)
                        if isinstance(t, str) and t.strip():
                            translated_parts.append(t.strip())
            except Exception as e:
                logger.error(f"[{target_lang}] ❌ Failed to parse assistant content: {e}", exc_info=True)

            new_translation = " ".join(translated_parts).strip()
            if not new_translation:
                logger.warning(f"[{target_lang}] ⚠️ Assistant message had no text content; skipping publish")
                return
            
            # SIMPLE: With turn_detection="vad", VAD commits the turn, so we get one translation per turn.
            # Translate the complete utterance as committed by VAD.
            translated = new_translation
            has_translation = original.strip().lower() != translated.strip().lower()

            async def publish_final():
                # Guard against duplicate publishes (we've observed duplicate conversation_item_added delivery).
                published = session.user_data.get("published_transcription_ids")
                if published is None:
                    published = set()
                    session.user_data["published_transcription_ids"] = published
                if transcription_id in published:
                    logger.info(f"[{target_lang}] ⏭️ Skipping duplicate FINAL publish for id={transcription_id}")
                    return
                published.add(transcription_id)

                message_data = {
                    "type": "transcription",
                    "text": translated,
                    "originalText": original,
                    "language": target_lang,
                    "participant_id": speaker_id,
                    "target_participant": "all",
                    "partial": False,
                    "final": True,
                    "timestamp": asyncio.get_event_loop().time(),
                    "hasTranslation": has_translation,
                    "transcriptionId": transcription_id,
                }
                
                await ctx.room.local_participant.publish_data(
                    json.dumps(message_data).encode("utf-8"),
                    topic="transcription",
                    reliable=True,
                )
                logger.info(
                    f"[{target_lang}] ✅ Published FINAL transcription id={transcription_id}: "
                    f"original='{original[:80]}...' → translated='{translated[:80]}...'"
                )

                # Clear pending turn AFTER publishing (don't clear before!)
                session.user_data["pending_transcription_id"] = None
                session.user_data["pending_original"] = None
                session.user_data["current_partial"] = ""  # Clear accumulated partials
            
            asyncio.create_task(publish_final())
        
        @session.on("error")
        def on_session_error(evt):
            # Surface STT/LLM/TTS errors in logs (helps diagnose "no audio")
            try:
                logger.error(f"[{target_lang}] ❌ session error: {evt.error} (source={evt.source})")
            except Exception:
                logger.error(f"[{target_lang}] ❌ session error")
        
        logger.info(f"[{target_lang}] ✅ Registered translation handlers (speech_created, conversation_item_added, error)")

        track_name = f"translation-{target_lang}-{speaker_id}"

        room_input_opts = room_io.RoomInputOptions(
            participant_identity=speaker_id,
        )
        if NOISE_CANCELLATION_AVAILABLE and noise_cancellation:
            room_input_opts = room_io.RoomInputOptions(
                participant_identity=speaker_id,
                noise_cancellation=noise_cancellation.BVC(),
            )
        
        # Start session with agent (following LiveKit's official pattern)
        # Reference: https://docs.livekit.io/recipes/pipeline_translator/
        try:
            logger.info(f"[{target_lang}] 🚀 Starting session for {speaker_id} → {target_lang}")
            logger.info(f"[{target_lang}]   Room: {ctx.room.name}")
            logger.info(f"[{target_lang}]   Speaker participant exists: {speaker_id in [p.identity for p in ctx.room.remote_participants.values()]}")
            logger.info(f"[{target_lang}]   Speaker has audio: {any(pub.kind == rtc.TrackKind.KIND_AUDIO for p in ctx.room.remote_participants.values() if p.identity == speaker_id for pub in p.track_publications.values())}")
            
            # Create custom TranslatorAgent instance (like LiveKit recipe)
            translator_agent = TranslatorAgent(target_lang=target_lang, target_lang_name=target_lang_name)
            
            # Start session with agent (like LiveKit recipe)
            await session.start(
                agent=translator_agent,
                room=ctx.room,
                room_input_options=room_input_opts,
                room_output_options=room_io.RoomOutputOptions(audio_track_name=track_name),
            )
            
            logger.info(f"[{target_lang}] ✅ Session started successfully")
            logger.info(f"[{target_lang}]   Session state: {session.state if hasattr(session, 'state') else 'unknown'}")
        except Exception as e:
            logger.error(f"[{target_lang}] ❌ Failed to start session: {e}", exc_info=True)
            import traceback
            logger.error(f"[{target_lang}] ❌ Traceback: {traceback.format_exc()}")
            raise

        self.assistants[f"{speaker_id}:{target_lang}"] = session
        logger.info(f"✅ Pipeline assistant created: {speaker_id} → {target_lang}")
        logger.info(f"📊 Current assistants: {list(self.assistants.keys())}")

    async def restart_all_assistants(self, ctx: JobContext):
        for session in self.assistants.values():
            await session.aclose()
        self.assistants.clear()
        await self.update_assistants(ctx)


# Main entrypoint function (using WorkerOptions pattern)
async def main(ctx: JobContext):
    """Main entrypoint - called for each room connection"""
    agent = PipelineTranslationAgent()
    await agent.entrypoint(ctx)


if __name__ == "__main__":
    import sys
    from dotenv import load_dotenv
    
    load_dotenv()

    print("=" * 60, file=sys.stderr)
    print("🚀 PIPELINE AGENT STARTUP - __main__ BLOCK EXECUTED", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    
    logger.info("=" * 60)
    logger.info("🚀 PIPELINE AGENT STARTUP - LOGGER INITIALIZED")
    logger.info(f"Command line args: {sys.argv}")
    logger.info(f"Python version: {sys.version}")
    logger.info("Using WorkerOptions pattern (like realtime_agent_simple.py)")
    
    # Use translation-bot-dev to match backend expectations
    agent_name = os.getenv('AGENT_NAME', 'translation-bot-dev')
    # Override if multiple AGENT_NAME entries exist in .env (use the last one, or force to translation-bot-dev)
    if 'dev-traditional-pipeline' in agent_name or not agent_name:
        agent_name = 'translation-bot-dev'
    livekit_url = os.getenv('LIVEKIT_URL', 'wss://production-uiycx4ku.livekit.cloud')
    
    logger.info(f"Starting Pipeline Translation Agent: '{agent_name}'")
    logger.info(f"Environment: {'PRODUCTION' if os.getenv('NODE_ENV') == 'production' else 'DEVELOPMENT'}")
    logger.info(f"LiveKit URL: {livekit_url}")
    
    worker_opts = WorkerOptions(
        entrypoint_fnc=main,
        api_key=os.getenv('LIVEKIT_API_KEY'),
        api_secret=os.getenv('LIVEKIT_API_SECRET'),
        ws_url=livekit_url,
        agent_name=agent_name,
    )
    
    # Run using WorkerOptions pattern (avoids DuplexClosed errors)
    if len(sys.argv) == 1 or (len(sys.argv) > 1 and sys.argv[1] in ['dev', 'start']):
        cli.run_app(worker_opts)
    else:
        logger.error(f"Unknown command: {sys.argv[1]}")
        logger.info("Usage: python pipeline_translation_agent.py [dev|start]")
        sys.exit(1)
