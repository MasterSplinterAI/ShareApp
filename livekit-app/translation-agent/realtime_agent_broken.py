#!/usr/bin/env python
"""
LiveKit Translation Agent using OpenAI Realtime API
Ultra-low latency translation using OpenAI's Realtime API (GPT-4o)
UNIFIED MODE: Works perfectly for 2 languages or 20 - no modes needed!
"""
import os
import asyncio
import json
import logging
from typing import Dict, Optional
from dotenv import load_dotenv

from livekit import agents, rtc
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
    room_io,
)
from livekit.agents.voice import AgentSession, Agent
from livekit.agents import llm
from livekit.plugins.openai.realtime import RealtimeModel
from livekit.plugins import silero, openai

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=getattr(logging, os.getenv('LOG_LEVEL', 'INFO')),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Language detection removed - using simple same-language prevention instead
# If two participants have the same target language, no translation tracks are created between them
# OpenAI instructions handle edge cases (e.g., Spanish speaker speaking English)


class RealtimeTranslationAgent:
    """
    Real-time translation using OpenAI's Realtime API (GPT-4o)
    Provides ultra-low latency voice-to-voice translation
    UNIFIED MODE: One perfect mode for all scenarios
    """

    def __init__(self):
        self.openai_api_key = os.getenv('OPENAI_API_KEY')
        if not self.openai_api_key:
            raise ValueError("OPENAI_API_KEY environment variable is required")

        self.participant_languages: Dict[str, str] = {}
        self.translation_enabled: Dict[str, bool] = {}
        self.assistants: Dict[str, AgentSession] = {}  # Key is now target_language
        self.host_vad_setting: str = "medium"  # 'low', 'medium', 'high'
        self.host_participant_id: Optional[str] = None  # Track who the host is
        # REMOVED: unified_mode_active and unified_assistant_key - using new architecture

        logger.info("Realtime Translation Agent initialized with OpenAI Realtime API (UNIFIED MODE)")

    async def entrypoint(self, ctx: JobContext):
        """Main entry point for the agent"""
        logger.info(f"Realtime Translation Agent starting in room: {ctx.room.name}")
        
        # Connect to room FIRST
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        
        my_identity = ctx.room.local_participant.identity
        logger.info(f"AGENT ENTRYPOINT CALLED! Agent connected with identity: {my_identity}")
        logger.info(f"Connected to room with {len(ctx.room.remote_participants)} participants")
        
        # Handle data channel messages for language preferences AND host VAD settings
        @ctx.room.on("data_received")
        def on_data_received(data: rtc.DataPacket):
            try:
                message = json.loads(data.data.decode('utf-8'))
                participant_id = data.participant.identity
                logger.info(f"📨 Data received - Topic: '{data.topic}', From: {participant_id}, Message: {message}")
                
                message_type = message.get('type')
                
                # Handle host VAD setting changes
                if message_type == 'host_vad_setting':
                    # Accept from any participant for now (you can add host verification via room metadata)
                    new_setting = message.get('level', 'medium')
                    if new_setting in ['low', 'medium', 'high']:
                        old_setting = self.host_vad_setting
                        self.host_vad_setting = new_setting
                        self.host_participant_id = participant_id
                        logger.info(f"🎛️ Host changed VAD sensitivity: {old_setting} → {new_setting} (from {participant_id})")
                        
                        # Restart all assistants with new VAD settings
                        asyncio.create_task(self._restart_all_assistants_for_vad_change(ctx))
                    return
                
                # Handle both message formats from frontend
                # RoomControls.jsx sends: type='language_update', language, enabled
                # useTranslation.js sends: type='language_preference', target_language, translation_enabled
                if message_type == 'language_update':
                    participant_name = message.get('participantName', participant_id)
                    language = message.get('language', 'en')
                    enabled = message.get('enabled', False)
                elif message_type == 'language_preference':
                    # Handle useTranslation.js format
                    participant_name = message.get('participant_name', message.get('participantName', participant_id))
                    language = message.get('target_language', message.get('language', 'en'))
                    enabled = message.get('translation_enabled', message.get('enabled', False))
                else:
                    # Not a language preference message, skip
                    return

                logger.info(f"🌐 Language preference received: {participant_name} (ID: {participant_id}) -> {language} (enabled: {enabled})")
                
                # Check if language is actually changing (not just enabling/disabling)
                old_language = self.participant_languages.get(participant_id)
                old_enabled = self.translation_enabled.get(participant_id, False)
                language_changed = old_language and old_language != language
                
                # Log BEFORE updating
                old_languages = self._get_enabled_languages()
                logger.info(f"📊 BEFORE update - Enabled languages: {old_languages}")
                
                self.participant_languages[participant_id] = language
                self.translation_enabled[participant_id] = enabled
                
                # Log AFTER updating
                new_languages = self._get_enabled_languages()
                logger.info(f"📊 AFTER update - Enabled languages: {new_languages}")
                logger.info(f"📊 Current participants with translation: {list(self.participant_languages.keys())}")
                logger.info(f"📊 Translation enabled status: {dict(self.translation_enabled)}")
                
                async def handle_language_update():
                    # If language changed or enabled status changed
                    if language_changed or old_enabled != enabled:
                        logger.info(f"🔄 Language preference changed for {participant_id} to {language} (enabled: {enabled})")
                        await self._update_all_assistant_subscriptions(ctx)
                    
                    # If translation was enabled for a new language, create its assistant
                    if enabled and language not in self.assistants:
                        logger.info(f"🚀 New language {language} enabled, creating assistant...")
                        await self.create_realtime_assistant_for_target_language(ctx, language)
                        await self._update_all_assistant_subscriptions(ctx)  # Update all after new assistant
                    elif not enabled and language in self.assistants:
                        # If no other participants need this language, stop the assistant
                        other_listeners = [
                            pid for pid, lang in self.participant_languages.items()
                            if pid != participant_id and lang == language and self.translation_enabled.get(pid, False)
                        ]
                        if not other_listeners:
                            logger.info(f"🛑 No more listeners for {language}, stopping assistant.")
                            await self.stop_realtime_assistant_for_language(language)
                            await self._update_all_assistant_subscriptions(ctx)  # Update others after stopping
                    else:
                            logger.info(f"ℹ️ {language} still has other listeners, updating subscriptions.")
                            await self._update_all_assistant_subscriptions(ctx)
                
                asyncio.create_task(handle_language_update())

            except json.JSONDecodeError:
                logger.warning(f"Received non-JSON data: {data.data.decode('utf-8')}")
            except Exception as e:
                logger.error(f"Error processing data message: {e}", exc_info=True)

        @ctx.room.on("participant_connected")
        def on_participant_connected(participant: rtc.RemoteParticipant):
            new_participant_id = participant.identity
            logger.info(f"👤 Participant connected: {new_participant_id}")
            
            # Skip agents
            if new_participant_id.startswith('agent-'):
                return
            
            # Handle new participant connection asynchronously
            async def handle_new_participant():
                # Update all assistants' subscriptions to include/exclude new participant
                await self._update_all_assistant_subscriptions(ctx)
                
                # Ensure assistants exist for all currently enabled languages
                for lang in self._get_enabled_languages():
                    if lang not in self.assistants:
                        await self.create_realtime_assistant_for_target_language(ctx, lang)
                        await self._update_all_assistant_subscriptions(ctx)
            
            asyncio.create_task(handle_new_participant())

        @ctx.room.on("participant_disconnected")
        def on_participant_disconnected(participant: rtc.RemoteParticipant):
            participant_id = participant.identity
            
            # Skip if agent disconnection
            if participant_id.startswith('agent-'):
                return
            
            logger.info(f"Participant disconnected: {participant_id}")
            
            # Get their language before removing
            participant_lang = self.participant_languages.pop(participant_id, None)
            self.translation_enabled.pop(participant_id, None)
            
            async def handle_disconnect():
                # Update all assistant subscriptions
                await self._update_all_assistant_subscriptions(ctx)
                
                # Check if we should stop the assistant for this language
                if participant_lang and participant_lang in self.assistants:
                    # Check if any other participants need this language
                    other_listeners = [
                        pid for pid, lang in self.participant_languages.items()
                        if lang == participant_lang and self.translation_enabled.get(pid, False)
                    ]
                    if not other_listeners:
                        logger.info(f"🛑 No more listeners for {participant_lang}, stopping assistant.")
                        await self.stop_realtime_assistant_for_language(participant_lang)
                        await self._update_all_assistant_subscriptions(ctx)
            
            asyncio.create_task(handle_disconnect())

        logger.info("Realtime Translation Agent is running and listening for language preferences...")

        # Keep the agent alive
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            logger.info("Agent cancelled, cleaning up...")
        finally:
            logger.info("Agent shutting down.")
            for key in list(self.assistants.keys()):
                assistant = self.assistants.pop(key)
                await assistant.aclose()
            logger.info("Agent cleanup complete.")

    def _get_enabled_languages(self) -> set:
        """Get set of unique enabled languages"""
        enabled_languages = set()
        for pid, enabled in self.translation_enabled.items():
            if enabled:
                lang = self.participant_languages.get(pid, 'en')
                enabled_languages.add(lang)
        return enabled_languages
    
    def _is_unified_mode(self) -> bool:
        """Check if we should use unified mode (exactly 2 languages)"""
        languages = self._get_enabled_languages()
        return len(languages) == 2
    
    async def _broadcast_room_mode(self, ctx: JobContext):
        """Broadcast room mode (unified or normal) to all participants"""
        try:
            languages = list(self._get_enabled_languages())
            is_unified = len(languages) == 2
            
            message = {
                'type': 'room_mode',
                'mode': 'unified' if is_unified else 'normal',
                'language_count': len(languages),
                'languages': languages
            }
            
            message_json = json.dumps(message)
            message_bytes = message_json.encode('utf-8')
            
            # Broadcast to all participants
            await ctx.room.local_participant.publish_data(
                message_bytes,
                reliable=True,
                topic='room_mode'
            )
            
            logger.info(f"📢 Broadcasted room mode: {message['mode']} (languages: {languages})")
        except Exception as e:
            logger.error(f"Error broadcasting room mode: {e}", exc_info=True)
    
    async def _check_and_update_unified_mode(self, ctx: JobContext):
        """Check if unified mode should be active and update accordingly"""
        try:
            # DISABLED: Always use normal mode
            should_be_unified = False  # Force normal mode always
            languages = list(self._get_enabled_languages())
            logger.info(f"🔍 Unified mode DISABLED - always using normal mode. Languages={languages}")
            
            # Never activate unified mode
            if False and should_be_unified and not self.unified_mode_active:
                # Switch to unified mode
                logger.info("🔄 Switching to UNIFIED MODE (2 languages detected)")
                self.unified_mode_active = True
                
                # Stop all existing normal assistants FIRST
                logger.info("🛑 Stopping all normal assistants for unified mode...")
                # Use the helper function to stop all normal assistants
                await self.stop_realtime_assistant("", stop_all_normal=True)
                
                # Double-check: ensure no normal assistants remain
                remaining_normal = [key for key in list(self.assistants.keys()) if key != self.unified_assistant_key]
                if remaining_normal:
                    logger.warning(f"⚠️ Some normal assistants still remain after stopping: {remaining_normal}")
                    # Force stop them
                    for key in remaining_normal:
                        try:
                            if key in self.assistants:
                                assistant = self.assistants.pop(key)
                                await assistant.aclose()
                                logger.info(f"✅ Force-stopped remaining assistant: {key}")
                        except Exception as e:
                            logger.error(f"❌ Error force-stopping assistant {key}: {e}")
                
                # Small delay to ensure assistants are fully stopped and tracks are unpublished
                await asyncio.sleep(0.5)
                
                # Create unified assistant
                await self._create_unified_assistant(ctx)
                
                # Broadcast mode change
                await self._broadcast_room_mode(ctx)
                
            elif not should_be_unified and self.unified_mode_active:
                # Switch back to normal mode (could be 1 language or 3+ languages)
                language_count = len(languages)
                if language_count == 1:
                    logger.info(f"🔄 Switching to NORMAL MODE (only 1 language detected: {languages[0]}) - no translation needed")
                else:
                    logger.info(f"🔄 Switching to NORMAL MODE ({language_count} languages detected)")
                self.unified_mode_active = False
                
                # Stop unified assistant
                if self.unified_assistant_key in self.assistants:
                    try:
                        assistant = self.assistants.pop(self.unified_assistant_key)
                        await assistant.aclose()
                        logger.info("✅ Stopped unified assistant")
                    except Exception as e:
                        logger.error(f"Error stopping unified assistant: {e}")
                
                # Small delay to ensure unified assistant is fully stopped
                await asyncio.sleep(0.3)
                
                # Only recreate normal assistants if we have 2+ different languages
                # If only 1 language, no translation is needed
                if language_count >= 2:
                    # Unified mode disabled - this code path won't execute
                    logger.info("🔄 Would recreate normal assistants but unified mode is disabled")
                    # for participant_id, enabled in self.translation_enabled.items():
                    #     if enabled:
                    #         target_language = self.participant_languages.get(participant_id, 'en')
                    #         self._create_shared_assistant_for_target_language(ctx, participant_id, target_language)
                    #         self._create_assistants_from_participant_to_others(ctx, participant_id)
                else:
                    logger.info("ℹ️ Only 1 language active - no assistants needed (no translation required)")
                
                # Broadcast mode change
                await self._broadcast_room_mode(ctx)
            elif should_be_unified == self.unified_mode_active:
                # Mode matches, just broadcast current state
                await self._broadcast_room_mode(ctx)
                
        except Exception as e:
            logger.error(f"Error checking/updating unified mode: {e}", exc_info=True)
    
    async def _create_unified_assistant(self, ctx: JobContext):
        """Create a unified assistant for 2-language mode that routes translations intelligently"""
        try:
            languages = list(self._get_enabled_languages())
            if len(languages) != 2:
                logger.warning(f"Cannot create unified assistant: expected 2 languages, got {len(languages)}")
                return
            
            lang1, lang2 = sorted(languages)  # Sort for consistency
            
            # Language name mapping
            language_names = {
                'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
                'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian',
                'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
                'ar': 'Arabic', 'hi': 'Hindi'
            }
            lang1_name = language_names.get(lang1, lang1)
            lang2_name = language_names.get(lang2, lang2)
            
            # Stop existing unified assistant if any
            if self.unified_assistant_key in self.assistants:
                assistant = self.assistants.pop(self.unified_assistant_key)
                await assistant.aclose()
            
            logger.info(f"🌐 Creating UNIFIED assistant for {lang1_name} ↔ {lang2_name} mode")
            
            # Get VAD config
            vad_config = self._get_vad_config()
            
            # Create RealtimeModel
            realtime_model = RealtimeModel(
                voice="alloy",
                modalities=["text", "audio"],
                temperature=0.7,
                turn_detection=vad_config,
            )
            
            session = AgentSession(
                vad=silero.VAD.load(),
                llm=realtime_model,
                allow_interruptions=True,
            )
            
            # Unified mode instructions: SUPER SIMPLE bidirectional translation
            # Make it extremely explicit and direct
            agent = Agent(
                instructions=(
                    f"You are a translator. "
                    f"Room has 2 languages: {lang1_name} and {lang2_name}. "
                    f"Listen to everyone speaking. "
                    f"When someone speaks {lang1_name}, translate to {lang2_name} and speak it. "
                    f"When someone speaks {lang2_name}, translate to {lang1_name} and speak it. "
                    f"Always translate. Never stay silent when someone is speaking. "
                    f"Only output translations. No other words."
                ),
            )
            
            # Set up event handlers similar to normal assistant
            session.user_data = {
                "last_original": "",
                "current_translation": "",
                "sent_final": False,
                "original_parts": [],
                "source_speaker_id": "all",
                "unified_mode": True,
                "lang1": lang1,
                "lang2": lang2,
            }
            
            # Helper function to detect meta-commentary (same as normal assistant)
            def is_meta_commentary(text: str) -> bool:
                if not text:
                    return True
                text_lower = text.lower().strip()
                text_clean = text_lower.replace(".", "").replace(",", "").replace("!", "").replace("?", "").replace("'", "").strip()
                
                meta_phrases = [
                    "i understand", "i'll stay silent", "understood", "no translation needed",
                    "not translating", "thank you", "thanks", "sure", "of course",
                    "i see", "gotcha", "no need to translate", "already in", "same language"
                ]
                
                for phrase in meta_phrases:
                    phrase_clean = phrase.replace(".", "").replace(",", "").replace("!", "").replace("?", "").replace("'", "").strip()
                    if text_clean == phrase_clean or phrase in text_lower:
                        return True
                
                words = text_lower.split()
                acknowledgment_words = ["understand", "silent", "ok", "okay", "got", "thanks", "thank", "sure"]
                if len(words) <= 4 and any(word in acknowledgment_words for word in words):
                    return True
                
                return False
            
            # Event handlers for unified assistant
            @session.on("agent_speech_delta")
            def on_agent_speech_delta(event):
                delta = getattr(event, "delta", None) or (getattr(event, "text", None) or "")
                if delta and not is_meta_commentary(delta):
                    session.user_data["current_translation"] += delta
                    logger.debug(f"[UNIFIED] Translation delta: {delta[:50]}...")
            
            @session.on("agent_speech_committed")
            def on_agent_speech_committed(event):
                final = getattr(event, "text", None) or ""
                if not final or is_meta_commentary(final):
                    return
                
                original = session.user_data.get("last_original") or final
                session.user_data["sent_final"] = True
                
                logger.info(f"[UNIFIED] ✅ Translation: {original[:50]}... → {final[:50]}...")
                
                # Send transcription to all participants (they all subscribe to unified track)
                # We'll send it with a generic source since everyone hears it
                try:
                    asyncio.create_task(
                        self.send_transcription_data(ctx, "unified", "all", original, final, "unified", partial=False)
                    )
                except Exception as e:
                    logger.error(f"[UNIFIED] Error sending transcription: {e}")
            
            @session.on("user_speech_committed")
            def on_user_speech_committed(event):
                original = getattr(event, "text", None) or ""
                if original:
                    session.user_data["last_original"] = original
                    logger.info(f"[UNIFIED] 🎤 Received speech from participant: {original[:100]}...")
                else:
                    logger.warning(f"[UNIFIED] ⚠️ user_speech_committed event fired but no text received")
            
            @session.on("user_speech_started")
            def on_user_speech_started(event):
                logger.info(f"[UNIFIED] 🎤 User speech started - assistant is listening!")
            
            @session.on("user_speech_stopped")
            def on_user_speech_stopped(event):
                logger.info(f"[UNIFIED] 🎤 User speech stopped")
            
            # Output: Unified track name
            track_name = "translation-unified"
            logger.info(f"🎯 Using unified track: {track_name}")
            room_output_opts = room_io.RoomOutputOptions(
                audio_track_name=track_name
            )
            
            # Count participants for logging
            participant_count = len([p for p in ctx.room.remote_participants.values() if not p.identity.startswith('agent-')])
            logger.info(f"🎧 Found {participant_count} participants in room")
            
            # CRITICAL: Don't manually subscribe to tracks - AgentSession handles this automatically
            # When no room_input_options is specified, AgentSession listens to ALL participant audio
            # Manual subscription can interfere with AgentSession's internal audio handling
            logger.info(f"🚀 Starting unified assistant - will listen to ALL {participant_count} participants automatically")
            await session.start(
                agent,
                room=ctx.room,
                room_output_options=room_output_opts
                # No room_input_options = AgentSession automatically listens to ALL participant audio
            )
            logger.info(f"✅ Unified assistant started successfully!")
            
            self.assistants[self.unified_assistant_key] = session
            logger.info(f"✅ UNIFIED assistant started (track: {track_name})")
            
        except Exception as e:
            logger.error(f"❌ Error creating unified assistant: {e}", exc_info=True)
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")

    def _create_shared_assistant_for_target_language(self, ctx: JobContext, any_participant_id: str, target_language: str):
        """Create ONE shared translation assistant per target language.
        Creates assistants FROM other participants TO this participant's target language.
        Works perfectly for 2 languages or 20 — no duplicates, no overlap.
        
        CRITICAL: Skip creating assistants when source and target have the same language.
        Example: Two English listeners don't need translation tracks between them.
        """
        # Unified mode disabled - always create normal assistants
        # if self.unified_mode_active:
        #     logger.debug(f"⏭️ Skipping normal assistant creation (unified mode active): {any_participant_id} -> {target_language}")
        #     return
        
        logger.info(f"🎯 Creating shared assistants FROM others -> {target_language} FOR {any_participant_id}")
        
        # Get all other participants (sources to translate FROM)
        other_participants = [p for p in ctx.room.remote_participants.values() 
                            if not p.identity.startswith('agent-') and p.identity != any_participant_id]
        
        for source_participant in other_participants:
            # CRITICAL: Skip if source participant also has the same target language
            # Two English listeners don't need translation tracks between them
            source_target_lang = self.participant_languages.get(source_participant.identity)
            if source_target_lang == target_language:
                logger.info(f"⏭️ Skipping assistant FROM {source_participant.identity} -> {target_language}: both have same target language ({target_language})")
                continue
            # Check if we already have a shared assistant for this language pair
            # Track name format: translation-{target_lang}-{source_participant}
            assistant_exists = False
            for existing_key in self.assistants.keys():
                # existing_key format: "{participant_id}:{source_participant_id}"
                if existing_key.endswith(f":{source_participant.identity}"):
                    # Check if any participant with this target language already has this assistant
                    existing_participant_id = existing_key.split(':')[0]
                    existing_target_lang = self.participant_languages.get(existing_participant_id)
                    if existing_target_lang == target_language:
                        logger.info(f"♻️ Reusing existing shared assistant: {source_participant.identity} → {target_language}")
                        assistant_exists = True
                        break
            
            if not assistant_exists:
                # Create new shared assistant for this language pair
                logger.info(f"🚀 Creating shared assistant: {source_participant.identity} -> {target_language} (shared for all {target_language} listeners)")
                asyncio.create_task(
                    self.create_realtime_assistant(
                        ctx,
                        any_participant_id,
                        target_language,
                        source_participant_id=source_participant.identity,
                        use_language_based_track=True
                    )
                )

    def _create_assistants_from_participant_to_others(self, ctx: JobContext, source_participant_id: str):
        """Create assistants FROM this participant TO other participants' target languages.
        
        ARCHITECTURE CLARIFICATION:
        - User language setting = what they want to HEAR (not what they speak)
        - OpenAI auto-detects what language is actually being spoken
        - We create one assistant per (speaker, target_language) pair
        
        Example:
        - User A wants to hear English, User B wants Spanish, User C wants English
        - When User A speaks (OpenAI detects English):
          → Create assistant: A → English (for User A) → OpenAI stays silent (no translation needed)
          → Create assistant: A → Spanish (for User B) → OpenAI translates English → Spanish
          → Create assistant: A → English (for User C) → OpenAI stays silent (no translation needed)
        
        - When User B speaks Spanish (OpenAI detects Spanish):
          → Create assistant: B → English (for User A) → OpenAI translates Spanish → English
          → Create assistant: B → Spanish (for User B) → OpenAI stays silent (no translation needed)
          → Create assistant: B → English (for User C) → OpenAI translates Spanish → English
        
        OpenAI automatically:
        - Detects what language source_participant is actually speaking
        - Translates it to target_language if needed
        - Stays silent if the spoken language already matches target_language
        
        CRITICAL: Skip creating normal assistants when unified mode is active.
        """
        # Unified mode disabled - always create normal assistants
        # if self.unified_mode_active:
        #     logger.debug(f"⏭️ Skipping normal assistant creation (unified mode active): FROM {source_participant_id}")
        #     return
        
        logger.info(f"🎯 Creating assistants FROM {source_participant_id} -> others' languages")
        
        # Get all other participants who have translation enabled
        for other_participant_id, target_language in self.participant_languages.items():
            if other_participant_id == source_participant_id:
                continue
            
            if not self.translation_enabled.get(other_participant_id, False):
                continue
            
            # CRITICAL: Skip if source participant also has the same target language as the target participant
            # Two English listeners don't need translation tracks between them
            source_target_lang = self.participant_languages.get(source_participant_id)
            if source_target_lang == target_language:
                logger.info(f"⏭️ Skipping assistant FROM {source_participant_id} -> {target_language} FOR {other_participant_id}: both have same target language ({target_language})")
                continue
            
            # Check if we already have a shared assistant for this language pair
            # Track name format: translation-{target_lang}-{source_participant}
            # We need to check if ANY participant with this target_language already has an assistant FROM source_participant_id
            assistant_exists = False
            for existing_key in self.assistants.keys():
                # existing_key format: "{participant_id}:{source_participant_id}"
                if existing_key.endswith(f":{source_participant_id}"):
                    # Check if any participant with this target language already has this assistant
                    existing_participant_id = existing_key.split(':')[0]
                    existing_target_lang = self.participant_languages.get(existing_participant_id)
                    if existing_target_lang == target_language:
                        logger.info(f"♻️ Reusing existing shared assistant: {source_participant_id} → {target_language} (for {existing_participant_id}, will also serve {other_participant_id})")
                        assistant_exists = True
                        break
            
            # Also check by track name to be extra sure (defensive check)
            expected_track_name = f"translation-{target_language}-{source_participant_id}"
            if not assistant_exists:
                # Double-check by looking for the track name in existing assistants
                # This is a safety check in case the key format doesn't match
                for existing_key, existing_assistant in self.assistants.items():
                    # We can't easily check track names from here, but we can verify the key pattern
                    if existing_key.endswith(f":{source_participant_id}"):
                        existing_participant_id = existing_key.split(':')[0]
                        existing_target_lang = self.participant_languages.get(existing_participant_id)
                        if existing_target_lang == target_language:
                            logger.info(f"♻️ Found shared assistant via secondary check: {source_participant_id} → {target_language}")
                            assistant_exists = True
                            break
            
            if not assistant_exists:
                # Create new shared assistant FROM source_participant TO target_language
                # OpenAI will auto-detect source language and only translate when needed
                logger.info(f"🚀 Creating shared assistant FROM {source_participant_id} -> {target_language} (OpenAI auto-detects source language)")
                asyncio.create_task(
                    self.create_realtime_assistant(
                        ctx,
                        other_participant_id,  # The participant who wants to hear this translation
                        target_language,       # Their target language
                        source_participant_id=source_participant_id,  # Who is speaking
                        use_language_based_track=True
                    )
                )

    def _get_enabled_languages(self):
        """Get all unique target languages that have translation enabled."""
        enabled_languages = set()
        for participant_id, language in self.participant_languages.items():
            if self.translation_enabled.get(participant_id, False):
                enabled_languages.add(language)
        return enabled_languages
    
    async def _update_all_assistant_subscriptions(self, ctx: JobContext):
        """Update subscriptions for all active assistants after a participant change."""
        try:
            logger.info("🔄 Updating subscriptions for all assistants after participant change")
            
            for target_language, session in self.assistants.items():
                # Skip if not a language key (for backward compatibility)
                if ':' in target_language:
                    continue
                    
                await self._update_assistant_subscriptions(ctx, session, target_language)
            
            logger.info("✅ All assistant subscriptions updated")
        except Exception as e:
            logger.error(f"❌ Error updating all assistant subscriptions: {e}", exc_info=True)
    
    async def send_transcription_data_broadcast(self, ctx: JobContext, original_text: str, translated_text: str, target_language: str, partial: bool = False):
        """Broadcast transcription to all participants with the target language.
        
        Since one assistant serves all listeners of a language, we broadcast
        transcriptions to everyone who has that target language selected.
        """
        try:
            # Find all participants with this target language
            target_participants = [
                pid for pid, lang in self.participant_languages.items()
                if lang == target_language and self.translation_enabled.get(pid, False)
            ]
            
            if not target_participants:
                logger.debug(f"No participants with target language {target_language} to send transcription to")
                return
            
            # Send to all participants with this target language
            for participant_id in target_participants:
                try:
                    await self.send_transcription_data(ctx, "all", participant_id, original_text, translated_text, target_language, partial)
                except Exception as e:
                    logger.error(f"Error sending transcription to {participant_id}: {e}")
        except Exception as e:
            logger.error(f"Error broadcasting transcription: {e}", exc_info=True)
    
    async def _update_assistant_subscriptions(self, ctx: JobContext, session: AgentSession, target_language: str):
        """Update SFU-level subscriptions for an assistant to filter same-language participants.
        
        This ensures the assistant only receives audio from participants who DON'T have
        the same target language. Filtering happens at SFU level - assistant never processes
        same-language audio.
        """
        try:
            logger.info(f"🔧 Updating subscriptions for {target_language} assistant")
            
            # Iterate through all participants and subscribe/unsubscribe based on their target language
            for participant in ctx.room.remote_participants.values():
                # Skip agents
                if participant.identity.startswith('agent-'):
                    continue
                
                participant_target_lang = self.participant_languages.get(participant.identity)
                
                # Subscribe/unsubscribe to their audio tracks
                for publication in participant.track_publications.values():
                    if publication.kind == rtc.TrackKind.KIND_AUDIO:
                        if participant_target_lang == target_language:
                            # Same language - DON'T send audio to this assistant
                            if publication.subscribed:
                                publication.set_subscribed(False)
                                logger.debug(f"  🚫 Unsubscribed from {participant.identity} (same language: {target_language})")
                        else:
                            # Different language - DO send audio to this assistant
                            if not publication.subscribed:
                                publication.set_subscribed(True)
                                logger.debug(f"  ✅ Subscribed to {participant.identity} (different language: {participant_target_lang} -> {target_language})")
        
        except Exception as e:
            logger.error(f"❌ Error updating subscriptions: {e}", exc_info=True)
    
    async def create_realtime_assistant_for_target_language(
        self,
        ctx: JobContext,
        target_language: str
    ):
        """Create an OpenAI Realtime API assistant for a target language.
        One assistant serves ALL participants who selected this target language.
        Uses OpenAI Realtime Model for ultra-low latency translation.
        """
        try:
            assistant_key = target_language  # Simple key: just the target language
            
            # Stop existing assistant if any
            if assistant_key in self.assistants:
                assistant = self.assistants.pop(assistant_key)
                await assistant.aclose()
            
            logger.info(f"🚀 Creating assistant for target language: {target_language}")
            
            # NOTE: Same-language pairs are skipped BEFORE this function is called
            # This prevents creating unnecessary assistants and duplicate audio/text
            
            # Language name mapping
            language_names = {
                'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
                'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian',
                'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
                'ar': 'Arabic', 'hi': 'Hindi'
            }
            target_lang_name = language_names.get(target_language, target_language)
            
            # Get VAD config based on host setting
            vad_config = self._get_vad_config()
            logger.info(f"🎛️ Using VAD config: {vad_config} (host setting: {self.host_vad_setting})")
            
            # Create AgentSession with OpenAI RealtimeModel for ultra-low latency
            # RealtimeModel provides speech-to-speech translation in a single integrated model
            # This eliminates the ~300-800ms latency from STT → LLM → TTS pipeline
            # CORRECT: RealtimeModel gets modalities, voice, etc. — NO instructions
            # CRITICAL: Use ServerVadOptions for instant turn detection and streaming deltas
            # ServerVadOptions enables agent_speech_delta events (word-by-word streaming)
            # turn_detection=None causes delays because it never ends turns automatically
            realtime_model = RealtimeModel(
                voice="alloy",  # Choose voice for target language
                modalities=["text", "audio"],  # ← text FIRST ensures events fire reliably
                temperature=0.7,  # Balanced for natural translations
                turn_detection=vad_config,  # Use dynamic VAD config based on host setting
            )
            
            session = AgentSession(
                vad=silero.VAD.load(),  # Voice Activity Detection - auto-detects pauses
                llm=realtime_model,
                allow_interruptions=True,  # RealtimeModel handles interruptions beautifully
            )
            
            # CORRECT: All instructions go in Agent() - this is the ONLY supported way (Nov 2025)
            # CRITICAL: OpenAI Realtime API auto-detects the actual spoken language (regardless of UI settings)
            # This enables "magical" bilingual support - users never need to change settings when switching languages
            # The instructions below ensure OpenAI stays silent when languages match, preventing duplicate audio
            agent = Agent(
                instructions=(
                    f"You are a real-time translator. Your ONLY job is to translate speech. "
                    f"The listener has chosen {target_lang_name} as their preferred language. "
                    "CRITICAL: Automatically detect the actual spoken language from the audio stream. "
                    f"If the detected spoken language is already {target_lang_name}, you MUST produce ABSOLUTELY NOTHING — "
                    "no audio output, no text output, no sound, no words, no acknowledgments, no confirmations, no explanations, no translations. "
                    "Do NOT translate English to English. Do NOT translate Spanish to Spanish. Do NOT translate any language to itself. "
                    "Do not repeat, echo, dub, or translate the original when languages match. "
                    "Do not say 'thank you', 'not translating', 'I understand', 'I'll stay silent', 'Understood', "
                    "'no output', 'zero output', 'complete silence', 'I will remain silent', or ANY other words or phrases. "
                    "When the spoken language matches the target language, you must produce complete silence — zero output. "
                    f"ONLY output translation when the spoken language DIFFERS from {target_lang_name}. "
                    "Example: If listener wants English and speaker speaks English → produce NOTHING (no translation needed). "
                    "Example: If listener wants English and speaker speaks Spanish → translate Spanish to English. "
                    "Example: If listener wants Spanish and speaker speaks English → translate English to Spanish. "
                    "Example: If listener wants Spanish and speaker speaks Spanish → produce NOTHING (no translation needed). "
                    "Translate accurately and naturally when translation is needed. Never add acknowledgments, confirmations, explanations, or meta-commentary. "
                    "Never describe your state, actions, or decisions. Output ONLY translations when needed. "
                    "If you have nothing to translate, produce nothing — not even a single character or sound."
                ),
            )
            
            # Set up event handlers for transcriptions using RealtimeModel events
            # CORRECT PATTERN FOR NOVEMBER 2025: Use agent_speech_delta + agent_speech_committed
            # These are the ONLY events that fire reliably with RealtimeModel in LiveKit Agents ≥1.2
            session.user_data = {
                "last_original": "",
                "current_translation": "",
                "sent_final": False,
                "original_parts": [],  # Accumulate partial original transcriptions
                "source_speaker_id": "all",  # Track who actually spoke (now handles all speakers)
                "target_language": target_language  # Track the target language
            }
            
            # Helper function to detect and filter meta-commentary responses
            def is_meta_commentary(text: str) -> bool:
                """Check if text is meta-commentary that should be filtered out.
                This catches OpenAI's responses when languages match (e.g., "not translating", "thank you", etc.)
                """
                if not text:
                    return True
                text_lower = text.lower().strip()
                
                # Remove punctuation for matching
                text_clean = text_lower.replace(".", "").replace(",", "").replace("!", "").replace("?", "").replace("'", "").strip()
                
                # Common meta-commentary phrases OpenAI might generate when languages match
                meta_phrases = [
                    # Direct acknowledgments
                    "i understand", "i'll stay silent", "i'll remain silent", "understood",
                    "i'll stop", "no translation needed", "staying silent", "remaining silent",
                    "no output", "zero output", "complete silence", "producing nothing",
                    "nothing to translate", "no translation", "staying quiet", "remaining quiet",
                    "i understand now", "got it", "okay", "ok", "will stay silent", "will remain silent",
                    # New phrases the user reported
                    "not translating", "thank you", "thanks", "you're welcome", "no problem",
                    "sure", "of course", "absolutely", "certainly", "indeed",
                    # Other common acknowledgments
                    "i see", "i hear you", "gotcha", "roger", "copy", "affirmative",
                    "no need to translate", "already in", "same language", "no change needed",
                    "no translation required", "already correct", "no action needed"
                ]
                
                # Check if text matches exactly (with or without punctuation)
                for phrase in meta_phrases:
                    phrase_clean = phrase.replace(".", "").replace(",", "").replace("!", "").replace("?", "").replace("'", "").strip()
                    if text_clean == phrase_clean or text_clean.startswith(phrase_clean + " ") or text_clean.endswith(" " + phrase_clean):
                        return True
                
                # Check if text contains any meta-commentary phrase
                for phrase in meta_phrases:
                    if phrase in text_lower:
                        return True
                
                # Common acknowledgment words for filtering
                acknowledgment_words = [
                    "understand", "silent", "ok", "okay", "got", "it", "no", "output", "zero", "nothing",
                    "thanks", "thank", "sure", "yes", "yeah", "yep", "right", "correct", "exactly"
                ]
                
                # Filter very short responses that are likely acknowledgments (1-4 words)
                words = text_lower.split()
                if len(words) <= 4:
                    if any(word in acknowledgment_words for word in words):
                        return True
                
                # Filter if text is just punctuation or whitespace
                if not text_clean or len(text_clean) == 0:
                    return True
                
                # Filter if text is ONLY common acknowledgment words (even if longer)
                if len(words) <= 6:
                    if all(word in acknowledgment_words for word in words):
                        return True
                
                return False
            
            logger.info(f"[{assistant_key}] Registering event handlers for RealtimeModel (Nov 2025 pattern)")
            
            # Add comprehensive debug logging to see ALL events that fire
            import inspect
            known_events = [
                "user_input_transcribed", "user_speech_transcribed",
                "agent_speech_started", "agent_speech_delta", "agent_speech_committed",
                "agent_speech_transcribed", "conversation_item_added", "response_done"
            ]
            
            for event_name in known_events:
                try:
                    @session.on(event_name)
                    def debug_event(event, name=event_name):
                        logger.info(f"[{assistant_key}] 🎉 EVENT FIRED: {name} | {type(event).__name__}")
                        if hasattr(event, "__dict__"):
                            logger.info(f"[{assistant_key}] 🎉 Event dict keys: {list(event.__dict__.keys())[:10]}")
                except Exception as e:
                    logger.debug(f"[{assistant_key}] Could not register debug listener for {event_name}: {e}")
            
            @session.on("user_input_transcribed")
            def on_original_transcribed(event):
                """Handle when user speech is transcribed (original text) - capture ALL transcriptions"""
                # Get transcript and is_final flag
                data = event.model_dump() if hasattr(event, "model_dump") else {}
                transcript = data.get("transcript", "") or data.get("text", "")
                is_final = data.get("is_final", True)
                
                # Also try direct attribute access
                if not transcript:
                    transcript = getattr(event, "text", "") or getattr(event, "transcript", "")
                if not is_final:
                    is_final = getattr(event, "is_final", True)
                
                if transcript := transcript.strip():
                    if is_final:
                        # Final - store complete text (this is the full sentence)
                        session.user_data["last_original"] = transcript
                        session.user_data["original_parts"] = []  # Clear parts
                        # Reset sent_final flag for new speech turn - allows next translation to be sent
                        session.user_data["sent_final"] = False
                        
                        logger.info(f"[{assistant_key}] 🔵 Original (final): {transcript[:80]} - Reset sent_final for new turn")
                    else:
                        # Partial - accumulate parts to build full text
                        parts = session.user_data.get("original_parts", [])
                        if transcript not in parts:  # Avoid duplicates
                            parts.append(transcript)
                            session.user_data["original_parts"] = parts
                            # Use the longest/latest partial as best guess
                            session.user_data["last_original"] = transcript
                            logger.debug(f"[{assistant_key}] 🔵 Original (partial): {transcript[:60]}...")
                else:
                    logger.warning(f"[{assistant_key}] ⚠️ user_input_transcribed fired but transcript is empty")
            
            @session.on("agent_speech_started")
            def on_agent_started(_):
                """Reset translation accumulator on new speech start"""
                session.user_data["current_translation"] = ""
                session.user_data["sent_final"] = False  # Reset flag to allow new transcription
                logger.info(f"[{assistant_key}] 🎤 Agent speech started - reset translation accumulator and sent_final flag")
                
                # Ensure we have original text - if not, log warning
                if not session.user_data.get("last_original"):
                    logger.warning(f"[{assistant_key}] ⚠️ Agent speech started but no original text captured yet")
            
            @session.on("agent_speech_delta")
            def on_agent_delta(event):
                """Handle streaming chunks of translated text - send incrementally for lower latency"""
                
                delta = getattr(event, "delta", "")
                if delta:
                    session.user_data["current_translation"] += delta
                    logger.debug(f"[{assistant_key}] 📝 Delta: {delta[:30]}...")
                    
                    # Send incremental update immediately for low latency (~200-400ms faster)
                    original = session.user_data.get("last_original") or ""
                    accumulated = session.user_data["current_translation"]
                    
                    # Filter out meta-commentary responses
                    if is_meta_commentary(accumulated):
                        logger.debug(f"[{assistant_key}] 🚫 Filtered out meta-commentary: {accumulated[:50]}...")
                        return
                    
                    # Only send if we have meaningful text (at least 2 words or 15 chars)
                    # CRITICAL: Send incremental transcriptions for ALL languages (language-agnostic)
                    if len(accumulated.split()) >= 2 or len(accumulated) >= 15:
                        logger.info(f"[{assistant_key}] 📤 Sending incremental transcription: '{accumulated[:50]}...' (target: {target_language})")
                        try:
                            source_speaker = session.user_data.get("source_speaker_id") or participant_id
                            asyncio.create_task(
                                self.send_transcription_data(ctx, source_speaker, participant_id, original, accumulated, target_language, partial=True)
                            )
                            logger.debug(f"[{assistant_key}] ✅ Incremental transcription task created")
                        except RuntimeError as e:
                            logger.error(f"[{assistant_key}] ❌ Failed to create task for incremental transcription: {e}")
                        except Exception as e:
                            logger.error(f"[{assistant_key}] ❌ Error sending incremental transcription: {e}", exc_info=True)
            
            @session.on("agent_speech_committed")
            def on_agent_committed(event):
                """Handle when agent speech is committed (final translated text) - PRIMARY METHOD"""
                
                if session.user_data.get("sent_final"):
                    logger.debug(f"[{assistant_key}] ⚠️ agent_speech_committed fired but already sent final, skipping")
                    return
                
                # Get full text from event or accumulated translation
                final = getattr(event, "text", "") or session.user_data.get("current_translation", "")
                
                # Also try extracting from event data
                if not final and hasattr(event, "model_dump"):
                    event_data = event.model_dump()
                    final = event_data.get("text", "") or event_data.get("content", "")
                
                if not (final := str(final or "").strip()):
                    logger.debug(f"[{assistant_key}] ⚠️ agent_speech_committed fired but no text found")
                    return
                
                # Filter out meta-commentary responses (e.g., "I'll remain silent now")
                # BUT: Only filter if it's VERY short and matches meta-phrases exactly
                # Longer text should always be sent through (even if it contains meta-phrases)
                is_meta = is_meta_commentary(final)
                text_length = len(final)
                word_count = len(final.split())
                
                # Only filter if it's very short (<= 15 chars or <= 3 words) AND matches meta-commentary
                # This prevents filtering legitimate translations that happen to contain common words
                if is_meta and text_length <= 15 and word_count <= 3:
                    logger.info(f"[{assistant_key}] 🚫 Filtered out meta-commentary response: {final[:100]}... (length: {text_length}, words: {word_count})")
                    session.user_data["sent_final"] = True  # Mark as sent to prevent retries
                    return
                elif is_meta:
                    # Longer text that contains meta-phrases but is likely a real translation
                    # Log it but don't filter - let it through
                    logger.info(f"[{assistant_key}] ⚠️ Text contains meta-phrases but is long enough ({text_length} chars, {word_count} words) - sending through: {final[:100]}...")
                
                original = session.user_data.get("last_original") or final
                session.user_data["sent_final"] = True
                
                # Get source speaker from session data (who actually spoke)
                source_speaker = session.user_data.get("source_speaker_id") or participant_id
                
                logger.info(f"[{assistant_key}] ✅ Translation (final from agent_speech_committed): {final[:100]}... (full length: {len(final)}, target_language: {target_language})")
                
                # CRITICAL: Always send transcription when audio is generated
                # Even if original is missing, send what we have (better than nothing)
                if not original:
                    logger.warning(f"[{assistant_key}] ⚠️ No original text captured, using translation as original")
                    original = final
                
                # Safe: we are inside LiveKit's async context
                # CRITICAL: Send transcriptions for ALL languages (language-agnostic)
                # This ensures English → Spanish, Spanish → English, and all other combinations work
                try:
                    logger.info(f"[{assistant_key}] 📤 Sending transcription: source={source_speaker}, target={participant_id}, target_lang={target_language}, original='{original[:50]}...', translated='{final[:50]}...'")
                    asyncio.create_task(
                        self.send_transcription_data(ctx, source_speaker, participant_id, original, final, target_language, partial=False)
                    )
                    logger.info(f"[{assistant_key}] ✅ Transcription task created successfully")
                except RuntimeError as e:
                    logger.error(f"[{assistant_key}] ❌ Failed to create task for sending transcription: {e}")
                except Exception as e:
                    logger.error(f"[{assistant_key}] ❌ Error sending transcription: {e}", exc_info=True)
            
            # conversation_item_added as fallback - but prefer agent_speech_committed for full text
            # Only use this if agent_speech_committed didn't fire (shouldn't happen with server_vad)
            @session.on("conversation_item_added")
            def on_conversation_item_added(event):
                """Handle when conversation item is added - fallback for full text capture"""
                # Skip if we already sent final via agent_speech_committed
                if session.user_data.get("sent_final"):
                    logger.debug(f"[{assistant_key}] 💬 conversation_item_added fired but already sent final, skipping")
                    return
                
                logger.info(f"[{assistant_key}] 💬 conversation_item_added FIRED! Type: {type(event)}")
                
                # Extract the actual item from the event
                actual_item = getattr(event, "item", None)
                if not actual_item and hasattr(event, "model_dump"):
                    data = event.model_dump()
                    actual_item = data.get("item")
                
                if not actual_item:
                    logger.debug(f"[{assistant_key}] ⚠️ conversation_item_added fired but no item found")
                    return
                
                # Check if this is an agent message (translation)
                role = getattr(actual_item, "role", None)
                if not role and hasattr(actual_item, "model_dump"):
                    item_data = actual_item.model_dump()
                    role = item_data.get("role")
                
                if role == "assistant":
                    # Get FULL text content from the item - try multiple extraction methods
                    text = None
                    
                    # Method 1: Direct content attribute
                    if hasattr(actual_item, "content"):
                        content = actual_item.content
                        if isinstance(content, str):
                            text = content
                        elif isinstance(content, list):
                            # Content might be a list of text parts - join them all
                            text = " ".join([str(c.get("text", c) if isinstance(c, dict) else c) for c in content if c])
                    
                    # Method 2: Direct text attribute
                    if not text and hasattr(actual_item, "text"):
                        text = actual_item.text
                    
                    # Method 3: model_dump and extract
                    if not text and hasattr(actual_item, "model_dump"):
                        item_data = actual_item.model_dump()
                        text = item_data.get("content") or item_data.get("text")
                        if isinstance(text, list):
                            # Extract text from list of content items
                            text = " ".join([
                                str(item.get("text", item) if isinstance(item, dict) else item) 
                                for item in text if item
                            ])
                    
                    if text := str(text or "").strip():
                        # Filter out meta-commentary responses
                        if is_meta_commentary(text):
                            logger.info(f"[{assistant_key}] 🚫 Filtered out meta-commentary from conversation_item: {text[:100]}...")
                            session.user_data["sent_final"] = True  # Mark as sent to prevent retries
                            return
                        
                        logger.info(f"[{assistant_key}] 💬 Found FULL translation from conversation_item_added: {text[:100]}... (length: {len(text)})")
                        original = session.user_data.get("last_original") or text
                        session.user_data["last_original"] = None
                        session.user_data["sent_final"] = True  # Mark as sent to prevent duplicates
                        
                        logger.info(f"[{assistant_key}] ✅ Translation (from conversation_item) → {participant_id}: '{original[:50]}...' → '{text[:50]}...' (full length: {len(text)})")
                        try:
                            source_speaker = session.user_data.get("source_speaker_id") or participant_id
                            asyncio.create_task(
                                self.send_transcription_data(ctx, source_speaker, participant_id, original, text, target_language, partial=False)
                            )
                        except RuntimeError as e:
                            logger.error(f"[{assistant_key}] ❌ Failed to create task: {e}")
            
            # We don't need to find specific participants anymore
            # The assistant will handle ALL participants and filter at SFU level
            
            # Configure room input/output options
            # Input: We'll start with all participants, then filter at SFU level
            room_input_opts = None  # Listen to all initially
            
            # Output: Create simplified track name for this language
            # Track name format: translation-{target_language}
            # Example: translation-es (Spanish translation)
                # All Spanish listeners will subscribe to this same track
            track_name = f"translation-{target_language}"
            logger.info(f"🎯 Using simplified track: {track_name}")
            room_output_opts = room_io.RoomOutputOptions(
                audio_track_name=track_name  # Unique track name to identify this translation
            )
            
            # Start the session with the agent
            # Don't specify input participants - we'll filter at SFU level after starting
            try:
                    await session.start(
                        agent, 
                        room=ctx.room, 
                    room_input_options=room_input_opts,  # None - listen to all initially
                        room_output_options=room_output_opts
                    )
            except Exception as e:
                logger.error(f"Error starting AgentSession: {e}", exc_info=True)
                raise
            
            self.assistants[assistant_key] = session
            
            # After starting, configure SFU-level subscriptions to filter same-language participants
            await self._update_assistant_subscriptions(ctx, session, target_language)
            
            logger.info(f"✅ Assistant for {target_language} started (track: {track_name})")
            logger.info(f"📋 Active assistants: {list(self.assistants.keys())}")
            
        except Exception as e:
            logger.error(f"❌ Error creating Realtime assistant for {participant_id}: {e}", exc_info=True)
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")

    async def stop_realtime_assistant_for_language(self, target_language: str):
        """Stop the assistant for a specific target language.
        """
        try:
            if target_language in self.assistants:
                assistant = self.assistants.pop(target_language)
                await assistant.aclose()
                logger.info(f"✅ Stopped assistant for {target_language}")
                logger.info(f"🛑 Stopping assistants for participant {participant_id}: {keys_to_remove}")
            
            for key in keys_to_remove:
                try:
                    if key in self.assistants:
                        assistant = self.assistants.pop(key)
                        await assistant.aclose()
                        logger.info(f"✅ Stopped Realtime assistant {key}")
                    else:
                        logger.warning(f"⚠️ Assistant {key} not found in assistants dict")
                except Exception as e:
                    logger.error(f"❌ Error stopping assistant {key}: {e}", exc_info=True)
            
            if not stop_all_normal:
                # Note: We don't stop assistants where participant_id is the speaker (e.g., "Other:Kenny")
                # because those are shared assistants for other listeners and should remain active
                logger.debug(f"Kept assistants where {participant_id} is the speaker (shared for other listeners)")
        except Exception as e:
            logger.error(f"Error stopping Realtime assistant for {participant_id}: {e}", exc_info=True)

    async def send_transcription_data(self, ctx: JobContext, source_speaker_id: str, target_participant_id: str, original_text: str, translated_text: str, language: str, partial: bool = False):
        """Send transcription via data channel to ALL participants (broadcast)
        
        ARCHITECTURE:
        - User language setting = what they want to HEAR (not what they speak)
        - OpenAI auto-detects what language is actually being spoken
        - When OpenAI translates (spoken language ≠ target language), we send transcriptions
        - When OpenAI stays silent (spoken language = target language), we don't send transcriptions
        
        This allows everyone to see both original and translated text, helping speakers
        verify if AI missed anything and enabling better cross-language communication.
        
        Args:
            source_speaker_id: The participant who actually spoke (source speaker)
            target_participant_id: The participant who receives this translation (target recipient)
            original_text: Original text in source language (what was actually spoken)
            translated_text: Translated text in target language (what the listener wants to hear)
            language: Target language code (e.g., 'es', 'fr', 'en') - what the listener wants to hear
            partial: If True, this is an incremental/streaming update (will be followed by final=False)
                    Frontend can show this as "typing..." or update live text
        """
        try:
            message = json.dumps({
                "type": "transcription",
                "text": translated_text,  # Translated text (target language)
                "originalText": original_text,  # Original text (source language) - ALWAYS included
                "language": language,  # Target language
                "participant_id": source_speaker_id,  # Who actually spoke (source speaker)
                "target_participant": target_participant_id,  # Who this translation is for (target recipient)
                "partial": partial,  # Indicates if this is a streaming update
                "final": not partial,  # Indicates if this is the final version
                "timestamp": asyncio.get_event_loop().time()
            })
            
            if partial:
                logger.debug(f"📤 Broadcasting incremental transcription: {source_speaker_id} -> {language} for {target_participant_id}: {translated_text[:50]}...")
            else:
                logger.info(f"📤 Broadcasting final transcription: {source_speaker_id} -> {language} for {target_participant_id}: original='{original_text[:50]}...', translated='{translated_text[:50]}...'")
            
            # Broadcast to ALL participants so everyone can see both original and translated text
            # This helps speakers verify accuracy and enables better cross-language communication
            try:
                await ctx.room.local_participant.publish_data(
                    message.encode('utf-8'),
                    reliable=True,
                    # Remove destination_identities to broadcast to all participants
                    topic="transcription"
                )
                if not partial:
                    logger.info(f"✅ Successfully broadcast transcription: {source_speaker_id} -> {language} for {target_participant_id}: original='{original_text[:50]}...', translated='{translated_text[:50]}...'")
            except Exception as e:
                logger.error(f"❌ Failed to broadcast transcription: {source_speaker_id} -> {language} for {target_participant_id}: {e}", exc_info=True)
                raise  # Re-raise to be caught by caller
        except Exception as e:
            logger.error(f"❌ Failed to send transcription: {e}", exc_info=True)

    def _get_vad_config(self):
        """Get VAD configuration based on host setting"""
        base_config = {
            "type": "server_vad",
            "prefix_padding_ms": 300,
        }
        
        if self.host_vad_setting == "low":
            # Low sensitivity: more forgiving, ignores small noises
            return {
                **base_config,
                "threshold": 0.75,  # Higher threshold = less sensitive
                "silence_duration_ms": 1000,  # Longer silence before ending turn
            }
        elif self.host_vad_setting == "high":
            # High sensitivity: very responsive, fast interruptions
            return {
                **base_config,
                "threshold": 0.4,  # Lower threshold = more sensitive
                "silence_duration_ms": 400,  # Shorter silence before ending turn
            }
        else:
            # Medium sensitivity: balanced (default)
            return {
                **base_config,
                "threshold": 0.5,  # Balanced threshold
                "silence_duration_ms": 500,  # Balanced silence duration
            }

    async def _close_session_after_transcription(self, session, transcription_task, assistant_key: str):
        """Close session after transcription has been sent (with timeout)"""
        try:
            # Wait for transcription to complete, but with a timeout
            await asyncio.wait_for(transcription_task, timeout=2.0)
            logger.info(f"[{assistant_key}] ✅ Transcription sent successfully, closing session")
        except asyncio.TimeoutError:
            logger.warning(f"[{assistant_key}] ⚠️ Transcription task timed out, closing session anyway")
        except Exception as e:
            logger.error(f"[{assistant_key}] ❌ Error waiting for transcription: {e}")
        finally:
            # Always close the session
            try:
                await session.aclose()
                logger.info(f"[{assistant_key}] ✅ Session closed after transcription")
            except Exception as e:
                logger.error(f"[{assistant_key}] ❌ Error closing session: {e}")

    async def _restart_all_assistants_for_vad_change(self, ctx: JobContext):
        """Restart all assistants when VAD setting changes to apply new sensitivity"""
        try:
            logger.info(f"🔄 Restarting all assistants with new VAD setting: {self.host_vad_setting}")
            
            # Stop all existing assistants
            for language in list(self.assistants.keys()):
                assistant = self.assistants.pop(language)
                await assistant.aclose()
                logger.info(f"✅ Stopped assistant for {language}")
            
            # Small delay to let audio drain
            await asyncio.sleep(0.5)
            
            # Recreate assistants for each enabled language
            for language in self._get_enabled_languages():
                logger.info(f"🔄 Recreating assistant for {language} with VAD: {self.host_vad_setting}")
                await self.create_realtime_assistant_for_target_language(ctx, language)
            
            # Update all subscriptions
            await self._update_all_assistant_subscriptions(ctx)
            
            logger.info(f"✅ All assistants restarted with VAD setting: {self.host_vad_setting}")
        except Exception as e:
            logger.error(f"Error restarting assistants for VAD change: {e}", exc_info=True)


async def main(ctx: JobContext):
    logger.info("=" * 50)
    logger.info("🚀 MAIN FUNCTION CALLED - JOB DISPATCHED!")
    logger.info(f"📋 Room: {ctx.room.name if ctx.room else 'NO ROOM'}")
    logger.info(f"📋 Job Context Type: {type(ctx)}")
    logger.info("LIVEKIT REALTIME TRANSLATION AGENT STARTED")
    logger.info("Using OpenAI Realtime API (GPT-4o) - UNIFIED MODE")
    logger.info("=" * 50)
    agent = RealtimeTranslationAgent()
    await agent.entrypoint(ctx)


if __name__ == "__main__":
    # Use 'translation-bot-dev' for local development to avoid conflicts with production
    # Production should set AGENT_NAME environment variable explicitly
    agent_name = os.getenv('AGENT_NAME', 'translation-bot-dev')
    
    if not agent_name or agent_name.strip() == '':
        agent_name = 'translation-bot-dev'
    
    logger.info(f"Starting Realtime agent with name: '{agent_name}'")
    logger.info(f"Environment: {'PRODUCTION' if os.getenv('NODE_ENV') == 'production' else 'DEVELOPMENT'}")
    logger.info(f"LiveKit URL: {os.getenv('LIVEKIT_URL', 'wss://production-uiycx4ku.livekit.cloud')}")
    
    worker_opts = WorkerOptions(
        entrypoint_fnc=main,
        api_key=os.getenv('LIVEKIT_API_KEY'),
        api_secret=os.getenv('LIVEKIT_API_SECRET'),
        ws_url=os.getenv('LIVEKIT_URL', 'wss://production-uiycx4ku.livekit.cloud'),
        agent_name=agent_name,
    )
    
    cli.run_app(worker_opts)

