#!/usr/bin/env python3
"""
SIMPLIFIED Translation Agent - ONE assistant per target language
Fixes the duplicate audio stream issue when multiple users have the same target language

LiveKit SDK Versions:
- livekit-agents>=0.6.0
- livekit-plugins-openai>=0.6.0
- Uses OpenAI Realtime API (GPT-4o) via LiveKit's RealtimeModel

Architecture:
- ONE assistant per target language (e.g., one for English, one for Spanish)
- All listeners of the same language share the same audio track
- Transcriptions broadcast to ALL participants (everyone sees original + all translations)
- Uses turn_detection (server_vad) for reliable transcription event firing
"""

import os
import json
import asyncio
import logging
import sys
import time
from typing import Dict, Optional, Set
from livekit import agents, rtc
from livekit.agents import JobContext, WorkerOptions, cli, room_io, AutoSubscribe
from livekit.agents.voice import AgentSession, Agent
from livekit.agents import llm
from livekit.plugins.openai.realtime import RealtimeModel
from livekit.plugins import silero, openai

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)


class SimpleTranslationAgent:
    """
    ONE assistant per (speaker, target_language) pair architecture:
    - Creates assistants FROM each speaker TO each target language
    - Skips same-language pairs (no English→English, no Spanish→Spanish, etc.)
    - Uses RoomInputOptions to listen to ONE speaker per assistant
    - No manual subscription management needed!
    """

    def __init__(self):
        self.openai_api_key = os.getenv('OPENAI_API_KEY')
        if not self.openai_api_key:
            raise ValueError("OPENAI_API_KEY environment variable is required")

        # User preferences
        self.participant_languages: Dict[str, str] = {}  # participant_id -> language they want to HEAR
        self.translation_enabled: Dict[str, bool] = {}   # participant_id -> enabled/disabled
        
        # KEY CHANGE: assistants keyed by "{speaker_id}:{target_language}" (like working agent)
        self.assistants: Dict[str, AgentSession] = {}  # "{speaker_id}:{target_language}" -> AgentSession
        
        self.host_vad_setting: str = "medium"
        self.host_participant_id: Optional[str] = None

        logger.info("✅ Simple Translation Agent initialized (ONE assistant per speaker-target pair)")
        logger.info("📦 LiveKit SDK: livekit-agents>=0.6.0, livekit-plugins-openai>=0.6.0")
    
    def _get_vad_config(self):
        """Get VAD configuration for RealtimeModel turn_detection.
        
        CRITICAL: turn_detection is REQUIRED for transcription events to fire reliably.
        Without it, agent_speech_committed and user_input_transcribed events may not fire.
        
        Returns:
            dict: VAD configuration for server_vad mode
        """
        base_config = {
            "type": "server_vad",
            "prefix_padding_ms": 300,  # Capture audio before speech starts
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

    async def entrypoint(self, ctx: JobContext):
        """Main entry point for the agent"""
        # Connect to the room first - AUDIO_ONLY for translation
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        
        logger.info(f"📋 Room: {ctx.room.name}")
        logger.info("✅ Simple Translation Agent initialized")
        logger.info(f"👥 Participants in room: {len(ctx.room.remote_participants)}")

        # Set up event handlers
        @ctx.room.on("data_received")
        def on_data_received(data: rtc.DataPacket):
            """Handle language preference updates AND host VAD settings"""
            try:
                logger.info(f"📨 DATA RECEIVED - Topic: '{data.topic}', From: {data.participant.identity if data.participant else 'unknown'}, Raw data: {data.data[:100] if len(data.data) > 0 else 'empty'}")
                message = json.loads(data.data.decode('utf-8'))
                participant_id = data.participant.identity
                message_type = message.get('type')
                logger.info(f"📨 Parsed message type: {message_type}, Full message: {message}")
                
                # Handle host VAD setting changes
                if message_type == 'host_vad_setting':
                    new_setting = message.get('level', 'medium')
                    if new_setting in ['low', 'medium', 'high']:
                        old_setting = self.host_vad_setting
                        self.host_vad_setting = new_setting
                        self.host_participant_id = participant_id
                        logger.info(f"🎛️ Host changed VAD sensitivity: {old_setting} → {new_setting} (from {participant_id})")
                        
                        # Restart all assistants with new VAD settings
                        asyncio.create_task(self._restart_all_assistants_for_vad_change(ctx))
                    return
                
                # Handle language preference updates
                # Handle both message formats from frontend:
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
                    logger.debug(f"📨 Ignoring message type: {message_type}")
                    return
                
                # CRITICAL: Always use LiveKit's participant.identity for tracking
                # This ensures we can look up preferences when checking subscriptions
                # The participant_name from the message is just for display/logging
                participant_id = data.participant.identity  # LiveKit identity (UUID or similar)
                participant_display_name = participant_name or participant_id  # For logging only
                
                # Get old language for comparison
                old_language = self.participant_languages.get(participant_id)
                old_enabled = self.translation_enabled.get(participant_id, False)
                
                logger.info(f"🌐 Language preference received: {participant_display_name} (LiveKit ID: {participant_id}) -> {language} (enabled: {enabled})")
                logger.info(f"   Old: {old_language} (enabled: {old_enabled})")
                logger.info(f"   New: {language} (enabled: {enabled})")
                
                # Update preferences using LiveKit identity (CRITICAL for lookups)
                self.participant_languages[participant_id] = language
                self.translation_enabled[participant_id] = enabled
                
                # Update assistants when language preference changes
                # This will create/remove assistants per (speaker, target_language) pairs
                async def update_all():
                    await self._update_assistants_for_all_languages(ctx)
                
                if enabled:
                    asyncio.create_task(update_all())
                else:
                    # Translation disabled - stop all assistants where this participant is the speaker
                    # Stop assistants with key format "{participant_id}:{target_language}"
                    keys_to_remove = [key for key in self.assistants.keys() if key.startswith(f"{participant_id}:")]
                    for key in keys_to_remove:
                        logger.info(f"🛑 Stopping assistant {key} (translation disabled for {participant_id})")
                        assistant = self.assistants.pop(key)
                        async def close_assistant():
                            try:
                                await assistant.aclose()
                            except Exception as e:
                                logger.error(f"Error closing assistant {key}: {e}")
                        asyncio.create_task(close_assistant())
                        
            except Exception as e:
                logger.error(f"Error processing data message: {e}", exc_info=True)

        @ctx.room.on("participant_connected")
        def on_participant_connected(participant: rtc.RemoteParticipant):
            """Handle new participant joining"""
            if not participant.identity.startswith('agent-'):
                logger.info(f"👤 Participant connected: {participant.identity}")
                # Update assistants when someone joins
                # Subscriptions will be updated when their language preference is received
                async def update_all():
                    await self._update_assistants_for_all_languages(ctx)
                asyncio.create_task(update_all())
        
        @ctx.room.on("track_published")
        def on_track_published(publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
            """Handle track being published - update subscriptions when audio tracks appear"""
            if participant.identity.startswith('agent-'):
                return
            
            if publication.kind == rtc.TrackKind.KIND_AUDIO:
                logger.info(f"🎤 Audio track published by {participant.identity} (track_name: {publication.name})")
                # Update assistants when audio tracks are published
                # This will create assistants FROM this speaker TO others' languages
                async def update_all():
                    await self._update_assistants_for_all_languages(ctx)
                asyncio.create_task(update_all())

        @ctx.room.on("participant_disconnected")
        def on_participant_disconnected(participant: rtc.RemoteParticipant):
            """Handle participant leaving"""
            participant_id = participant.identity
            logger.info(f"👋 Participant disconnected: {participant_id}")
            
            # Clean up their preferences
            self.participant_languages.pop(participant_id, None)
            self.translation_enabled.pop(participant_id, None)
            
            # Update assistants when someone disconnects
            async def update_all():
                await self._update_assistants_for_all_languages(ctx)
            asyncio.create_task(update_all())

        logger.info("✅ Translation Agent is running and listening for language preferences...")

        # Keep the agent alive
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            logger.info("Agent cancelled, cleaning up...")
        finally:
            # Clean up all assistants
            for language, assistant in list(self.assistants.items()):
                await assistant.aclose()
                logger.info(f"Closed assistant for {language}")
            logger.info("Agent cleanup complete.")

    async def _update_assistants_for_all_languages(self, ctx: JobContext):
        """
        Core logic: Create/update assistants per (speaker, target_language) pair.
        CRITICAL: Skip creating assistants where speaker_language == target_language.
        This prevents unnecessary assistants and OpenAI commentary.
        """
        logger.info(f"📊 Updating assistants for all speaker-target pairs")
        logger.info(f"   Current assistants: {list(self.assistants.keys())}")
        
        # Get all speakers (participants who have audio tracks)
        speakers = []
        for participant in ctx.room.remote_participants.values():
            if participant.identity.startswith('agent-'):
                continue
            # Check if they have an audio track published
            has_audio = any(pub.kind == rtc.TrackKind.KIND_AUDIO for pub in participant.track_publications.values())
            if has_audio:
                speakers.append(participant.identity)
        
        # Get all target languages (languages users want to HEAR)
        target_languages = {}
        for participant_id, language in self.participant_languages.items():
            if self.translation_enabled.get(participant_id, False):
                if language not in target_languages:
                    target_languages[language] = []
                target_languages[language].append(participant_id)
        
        logger.info(f"   Speakers: {speakers}")
        logger.info(f"   Target languages: {list(target_languages.keys())}")
        
        # Create assistants FROM each speaker TO each target language
        # BUT skip if speaker's language == target_language (no same-language pairs)
        expected_assistants = set()
        for speaker_id in speakers:
            speaker_language = self.participant_languages.get(speaker_id)
            if not speaker_language:
                logger.debug(f"  ⏭️ Skipping {speaker_id} - no language preference set")
                continue
            
            for target_language, listeners in target_languages.items():
                # CRITICAL: Skip same-language pairs (no English→English, etc.)
                if speaker_language == target_language:
                    logger.debug(f"  ⏭️ Skipping {speaker_id} → {target_language}: same language ({speaker_language})")
                    continue
                
                assistant_key = f"{speaker_id}:{target_language}"
                expected_assistants.add(assistant_key)
                
                if assistant_key not in self.assistants:
                    logger.info(f"🚀 Creating NEW assistant: {speaker_id} → {target_language} (for listeners: {listeners})")
                    await self._create_assistant_for_pair(ctx, speaker_id, target_language)
                else:
                    logger.debug(f"  ✅ Assistant {assistant_key} already exists")
        
        # Stop assistants that are no longer needed
        for assistant_key in list(self.assistants.keys()):
            if assistant_key not in expected_assistants:
                logger.info(f"🛑 Stopping assistant {assistant_key} (no longer needed)")
                assistant = self.assistants.pop(assistant_key)
                await assistant.aclose()
        
        logger.info(f"   Final assistants: {list(self.assistants.keys())}")

    async def _create_assistant_for_pair(self, ctx: JobContext, speaker_id: str, target_language: str):
        """
        Create ONE assistant FROM a specific speaker TO a target language.
        This assistant will:
        1. Listen to ONLY the specified speaker (using RoomInputOptions)
        2. Auto-detect what language they're speaking
        3. Translate to target_language if different
        4. Stay silent if same language (but we skip creating these assistants)
        5. Publish track: translation-{target_language}-{speaker_id}
        6. Send transcriptions via data channel
        
        CRITICAL: This assistant only listens to ONE speaker, avoiding manual subscription management.
        """
        try:
            # Language name mapping for instructions
            language_names = {
                'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
                'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian',
                'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
                'ar': 'Arabic', 'hi': 'Hindi', 'tiv': 'Tiv'
            }
            target_lang_name = language_names.get(target_language, target_language)
            
            # CRITICAL: Get VAD config for turn_detection
            # turn_detection is REQUIRED for transcription events to fire reliably
            # Without it, agent_speech_committed and user_input_transcribed events may not fire
            vad_config = self._get_vad_config()
            logger.info(f"[{target_language}] 🎛️ Using VAD config: {vad_config} (host setting: {self.host_vad_setting})")
            
            # Create the realtime model with turn_detection
            # CRITICAL: text FIRST in modalities ensures events fire reliably
            # turn_detection enables server_vad which fires transcription events properly
            realtime_model = RealtimeModel(
                voice="alloy",
                modalities=["text", "audio"],  # text FIRST ensures events fire reliably
                temperature=0.7,
                turn_detection=vad_config,  # REQUIRED for transcription events to fire
            )
            
            # Create session
            session = AgentSession(
                vad=silero.VAD.load(),
                llm=realtime_model,
                allow_interruptions=True
            )
            
            # Initialize session user_data for transcription tracking
            session.user_data = {
                "last_original": "",
                "current_translation": "",
                "sent_final": False,
                "target_language": target_language,
                "target_lang_name": target_lang_name,
                "source_speaker_id": speaker_id  # Track who actually spoke (this assistant listens to this speaker)
            }
            
            # Helper function to detect meta-commentary
            def is_meta_commentary(text: str) -> bool:
                """Detect if text is meta-commentary that should be filtered.
                
                CRITICAL: Only checks for meta-phrases, NOT length.
                Length filtering is handled separately in event handlers to allow
                legitimate short translations to pass through.
                """
                if not text:
                    return True
                text_lower = text.lower().strip()
                meta_phrases = [
                    "no translation needed",
                    "i'll remain silent",
                    "i'll stay silent",
                    "staying silent",
                    "no translation",
                    "same language",
                    "ready to translate",
                    "i'm ready",
                    "ready to translate when",
                    "when you speak",
                    "speak in another language",
                    "i'm listening",
                    "waiting for",
                    "translation service",
                    "translator here",
                    "i can translate",
                    "already translated",
                    "it's already",
                    "this is already",
                    "no need to translate",
                    "translation not needed",
                    "i will remain",
                    "i will stay",
                    "i'll keep silent",
                    "keeping silent",
                    "[silence]"  # OpenAI sometimes sends this
                ]
                # Only check for meta-phrases, NOT length
                # Length filtering is handled separately in event handlers
                return any(phrase in text_lower for phrase in meta_phrases)
            
            # Set up transcription event handlers - using the same pattern as realtime_agent_realtime.py
            @session.on("user_input_transcribed")
            def on_original_transcribed(event):
                """Handle when user speech is transcribed (original text) - capture ALL transcriptions"""
                # Get transcript and is_final flag (matching original agent pattern)
                data = event.model_dump() if hasattr(event, "model_dump") else {}
                transcript = data.get("transcript", "") or data.get("text", "")
                is_final = data.get("is_final", True)
                
                # Also try direct attribute access
                if not transcript:
                    transcript = getattr(event, "text", "") or getattr(event, "transcript", "")
                if not is_final:
                    is_final = getattr(event, "is_final", True)
                
                # This assistant listens to speaker_id (set in session.user_data)
                source_speaker_id = speaker_id
                
                if transcript := transcript.strip():
                    if is_final:
                        # Final - store complete text
                        session.user_data["last_original"] = transcript
                        session.user_data["source_speaker_id"] = speaker_id
                        session.user_data["sent_final"] = False  # CRITICAL: Reset flag for new speech turn
                        session.user_data["current_translation"] = ""  # Reset translation accumulator
                        logger.info(f"[{target_language}] 🔵 Original (final) from {speaker_id}: {transcript[:80]}")
                    else:
                        # Partial - use as best guess
                        session.user_data["last_original"] = transcript
                        session.user_data["source_speaker_id"] = speaker_id
                        logger.debug(f"[{target_language}] 🔵 Original (partial) from {speaker_id}: {transcript[:60]}...")
                else:
                    logger.warning(f"[{target_language}] ⚠️ user_input_transcribed fired but transcript is empty")
            
            # Fallback handler for user_speech_committed (in case user_input_transcribed doesn't fire)
            @session.on("user_speech_committed")
            def on_user_speech_committed(event):
                """Capture original speech text (fallback)"""
                original = getattr(event, "text", None) or ""
                if original:
                    # Send translation activity START when we detect user speech
                    # This ensures the UI shows the indicator even if agent_speech_started doesn't fire
                    if not session.user_data.get("translation_active_sent", False):
                        asyncio.create_task(
                            self._send_translation_activity(ctx, speaker_id, target_language, is_active=True)
                        )
                        session.user_data["translation_active_sent"] = True
                        logger.info(f"[{target_language}] 🟢 Translation activity STARTED (from user_speech_committed)")
                    
                    session.user_data["last_original"] = original
                    session.user_data["source_speaker_id"] = speaker_id  # This assistant listens to this speaker
                    session.user_data["sent_final"] = False
                    logger.info(f"[{target_language}] 🎤 ✅ AUDIO RECEIVED! Original speech from {speaker_id}: {original[:100]}...")
                else:
                    logger.warning(f"[{target_language}] ⚠️ user_speech_committed event received but no text found")
            
            # Add handler to detect when audio starts flowing
            @session.on("user_speech_started")
            def on_user_speech_started(event):
                """Detect when user starts speaking"""
                logger.info(f"[{target_language}] 🎙️ User speech started - audio is flowing!")
            
            @session.on("agent_speech_started")
            def on_agent_speech_started(_):
                """Reset translation accumulator on new speech start"""
                session.user_data["current_translation"] = ""
                session.user_data["sent_final"] = False  # CRITICAL: Reset flag so we can send transcriptions for this turn
                logger.info(f"[{target_language}] 🎤 Agent speech started - reset sent_final flag")
                # Notify that translation is active (for UI indicators)
                # Also reset the flag so we can send activity again for next turn
                session.user_data["translation_active_sent"] = False
                asyncio.create_task(
                    self._send_translation_activity(ctx, speaker_id, target_language, is_active=True)
                )
                session.user_data["translation_active_sent"] = True
            
            @session.on("agent_speech_delta")
            def on_agent_speech_delta(event):
                """Handle streaming chunks of translated text"""
                delta = getattr(event, "delta", None) or (getattr(event, "text", None) or "")
                if delta and not is_meta_commentary(delta):
                    session.user_data["current_translation"] += delta
                    accumulated = session.user_data["current_translation"]
                    
                    # Send incremental transcription if meaningful (at least 2 words or 15 chars)
                    if len(accumulated.split()) >= 2 or len(accumulated) >= 15:
                        original = session.user_data.get("last_original", "")
                        source_speaker = session.user_data.get("source_speaker_id", "speaker")
                        if original:
                            try:
                                asyncio.create_task(
                                    self._send_transcription_data(
                                        ctx, original, accumulated, target_language, partial=True, source_speaker_id=source_speaker
                                    )
                                )
                            except Exception as e:
                                logger.error(f"[{target_language}] Error sending incremental transcription: {e}")
            
            @session.on("agent_speech_committed")
            def on_agent_speech_committed(event):
                """Handle final translated text - PRIMARY METHOD for transcriptions"""
                # Check if we already sent final transcription for this turn
                if session.user_data.get("sent_final"):
                    logger.debug(f"[{target_language}] ⏭️ Skipping agent_speech_committed (already sent final for this turn)")
                    return
                
                # Get full text from event or accumulated translation (more robust extraction)
                final = getattr(event, "text", "") or session.user_data.get("current_translation", "")
                
                # Also try extracting from event data (matching working version pattern)
                if not final and hasattr(event, "model_dump"):
                    event_data = event.model_dump()
                    final = event_data.get("text", "") or event_data.get("content", "")
                
                if not (final := str(final or "").strip()):
                    logger.debug(f"[{target_language}] ⏭️ Skipping agent_speech_committed (no final text)")
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
                    logger.info(f"[{target_language}] 🚫 Filtered out meta-commentary response: {final[:100]}... (length: {text_length}, words: {word_count})")
                    session.user_data["sent_final"] = True  # Mark as sent to prevent retries
                    return
                elif is_meta:
                    # Longer text that contains meta-phrases but is likely a real translation
                    # Log it but don't filter - let it through
                    logger.info(f"[{target_language}] ⚠️ Text contains meta-phrases but is long enough ({text_length} chars, {word_count} words) - sending through: {final[:100]}...")
                
                # Mark as sent BEFORE sending (to prevent duplicates)
                session.user_data["sent_final"] = True
                original = session.user_data.get("last_original", "") or final
                source_speaker = session.user_data.get("source_speaker_id", "speaker")
                
                logger.info(f"[{target_language}] ✅ Translation (final from agent_speech_committed): {final[:100]}... (full length: {len(final)}, target_language: {target_language})")
                
                # CRITICAL: Always send transcription when audio is generated
                # Even if original is missing, send what we have (better than nothing)
                if not original:
                    logger.warning(f"[{target_language}] ⚠️ No original text captured, using translation as original")
                    original = final
                
                # Send final transcription
                try:
                    logger.info(f"[{target_language}] 📤 Sending transcription: source={source_speaker}, target_lang={target_language}, original='{original[:50]}...', translated='{final[:50]}...'")
                    asyncio.create_task(
                        self._send_transcription_data(
                            ctx, original, final, target_language, partial=False, source_speaker_id=source_speaker
                        )
                    )
                    logger.info(f"[{target_language}] ✅ Transcription task created successfully")
                except RuntimeError as e:
                    logger.error(f"[{target_language}] ❌ Failed to create task for sending transcription: {e}")
                except Exception as e:
                    logger.error(f"[{target_language}] ❌ Error sending final transcription: {e}", exc_info=True)
                    # Reset flag on error so we can retry
                    session.user_data["sent_final"] = False
                
                # Notify that translation stopped (for UI indicators)
                asyncio.create_task(
                    self._send_translation_activity(ctx, speaker_id, target_language, is_active=False)
                )
                # Reset flag so we can send activity again for next turn
                session.user_data["translation_active_sent"] = False
            
            # conversation_item_added as fallback - but prefer agent_speech_committed for full text
            # Only use this if agent_speech_committed didn't fire (shouldn't happen with server_vad)
            @session.on("conversation_item_added")
            def on_conversation_item_added(event):
                """Handle when conversation item is added - fallback for full text capture"""
                # Skip if we already sent final via agent_speech_committed
                if session.user_data.get("sent_final"):
                    logger.debug(f"[{target_language}] 💬 conversation_item_added fired but already sent final, skipping")
                    return
                
                logger.info(f"[{target_language}] 💬 conversation_item_added FIRED!")
                
                # Extract the actual item from the event
                actual_item = getattr(event, "item", None)
                if not actual_item and hasattr(event, "model_dump"):
                    data = event.model_dump()
                    actual_item = data.get("item")
                
                if not actual_item:
                    logger.debug(f"[{target_language}] ⚠️ conversation_item_added fired but no item found")
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
                        # Filter out meta-commentary responses - use same logic as agent_speech_committed
                        # Only filter if it's VERY short AND matches meta-commentary (same as agent_speech_committed)
                        is_meta = is_meta_commentary(text)
                        text_length = len(text)
                        word_count = len(text.split())
                        
                        # Only filter if it's very short (<= 15 chars or <= 3 words) AND matches meta-commentary
                        # This prevents filtering legitimate translations that happen to be short
                        if is_meta and text_length <= 15 and word_count <= 3:
                            logger.info(f"[{target_language}] 🚫 Filtered out meta-commentary from conversation_item: {text[:100]}... (length: {text_length}, words: {word_count})")
                            session.user_data["sent_final"] = True  # Mark as sent to prevent retries
                            return
                        elif is_meta:
                            # Longer text that contains meta-phrases but is likely a real translation
                            # Log it but don't filter - let it through
                            logger.info(f"[{target_language}] ⚠️ Text contains meta-phrases but is long enough ({text_length} chars, {word_count} words) - sending through: {text[:100]}...")
                        
                        logger.info(f"[{target_language}] 💬 Found FULL translation from conversation_item_added: {text[:100]}... (length: {len(text)})")
                        original = session.user_data.get("last_original") or text
                        session.user_data["sent_final"] = True  # Mark as sent to prevent duplicates
                        
                        logger.info(f"[{target_language}] ✅ Translation (from conversation_item) → {target_language}: '{original[:50]}...' → '{text[:50]}...' (full length: {len(text)})")
                        try:
                            source_speaker = session.user_data.get("source_speaker_id", "speaker")
                            asyncio.create_task(
                                self._send_transcription_data(
                                    ctx, original, text, target_language, partial=False, source_speaker_id=source_speaker
                                )
                            )
                            # Notify that translation stopped (for UI indicators)
                            asyncio.create_task(
                                self._send_translation_activity(ctx, source_speaker, target_language, is_active=False)
                            )
                            # Reset flag so we can send activity again for next turn
                            session.user_data["translation_active_sent"] = False
                        except RuntimeError as e:
                            logger.error(f"[{target_language}] ❌ Failed to create task: {e}")
                        except Exception as e:
                            logger.error(f"[{target_language}] ❌ Error sending transcription from conversation_item: {e}", exc_info=True)
            
            # Simple, clear instructions - VERY STRICT about staying silent
            agent = Agent(
                instructions=(
                    f"You are a silent translator. Your target language is {target_lang_name}. "
                    f"CRITICAL RULES:\n"
                    f"1. If someone speaks {target_lang_name}, you MUST stay completely silent. Do not speak at all. Do not say anything.\n"
                    f"2. If someone speaks a different language, translate ONLY that speech to {target_lang_name}.\n"
                    f"3. NEVER say phrases like 'I'm ready to translate', 'no translation needed', or any other meta-commentary.\n"
                    f"4. NEVER announce your presence or explain what you're doing.\n"
                    f"5. ONLY output actual translated speech. Nothing else. Complete silence when the spoken language matches {target_lang_name}."
                )
            )
            
            # Track name: translation-{target_language}-{speaker_id}
            # This allows multiple speakers to translate to the same target language
            # Frontend will subscribe to translation-{target_language} tracks (can match multiple)
            track_name = f"translation-{target_language}-{speaker_id}"
            
            # CRITICAL: Use RoomInputOptions to listen to ONLY this specific speaker
            # This avoids manual subscription management entirely (like the working agent)
            room_input_options = room_io.RoomInputOptions(participant_identity=speaker_id)
            
            # Output: Publish to track with speaker-specific name
            room_output_options = room_io.RoomOutputOptions(
                audio_track_name=track_name
            )
            
            logger.info(f"🎯 Creating assistant: {speaker_id} → {target_language}")
            logger.info(f"   Listening to: {speaker_id} only (via RoomInputOptions)")
            logger.info(f"   Track name: {track_name}")
            
            # Start the session - listens to ONLY speaker_id via RoomInputOptions
            await session.start(
                agent,
                room=ctx.room,
                room_input_options=room_input_options,
                room_output_options=room_output_options
            )
            
            # Store the assistant with key "{speaker_id}:{target_language}"
            assistant_key = f"{speaker_id}:{target_language}"
            self.assistants[assistant_key] = session
            
            logger.info(f"✅ Assistant {assistant_key} created successfully")
            
            # Count listeners for this target language
            listeners = [
                pid for pid, lang in self.participant_languages.items()
                if lang == target_language and self.translation_enabled.get(pid, False)
            ]
            logger.info(f"   Serving {len(listeners)} {target_lang_name} listeners: {listeners}")
            
        except Exception as e:
            logger.error(f"Error creating assistant for {target_language}: {e}", exc_info=True)

    async def _send_transcription_data(self, ctx: JobContext, original_text: str, translated_text: str, target_language: str, partial: bool = False, source_speaker_id: str = None):
        """Send transcription via data channel to ALL participants (broadcast)
        
        ARCHITECTURE:
        - User language setting = what they want to HEAR (not what they speak)
        - OpenAI auto-detects what language is actually being spoken
        - When OpenAI translates (spoken language ≠ target language), we send transcriptions
        - When OpenAI stays silent (spoken language = target language), we don't send transcriptions
        
        This allows everyone to see both original and translated text, helping speakers
        verify if AI missed anything and enabling better cross-language communication.
        
        Transcriptions are broadcast to ALL participants so everyone sees:
        - Original language text
        - Translated language text (for each target language)
        - Multiple translations if there are multiple target languages
        
        Args:
            original_text: Original text in source language (what was actually spoken)
            translated_text: Translated text in target language (what the listener wants to hear)
            target_language: Target language code (e.g., 'es', 'fr', 'en') - what the listener wants to hear
            partial: If True, this is an incremental/streaming update (will be followed by final=False)
                    Frontend can show this as "typing..." or update live text
            source_speaker_id: The participant who actually spoke (source speaker)
        """
        # Broadcast to ALL participants (matching realtime_agent_realtime.py pattern)
        # Everyone sees all transcriptions (original + all translations)
        message = json.dumps({
            "type": "transcription",
            "text": translated_text,  # Translated text (target language)
            "originalText": original_text,  # Original text (source language) - ALWAYS included
            "language": target_language,  # Target language
            "participant_id": source_speaker_id or "unknown",  # Who actually spoke (source speaker)
            "target_participant": "all",  # Broadcast to all (everyone sees this transcription)
            "partial": partial,  # Indicates if this is a streaming update
            "final": not partial,  # Indicates if this is the final version
            "timestamp": asyncio.get_event_loop().time()  # Use same timestamp method as original
        })
        
        # Broadcast to ALL participants so everyone can see both original and translated text
        # This helps speakers verify accuracy and enables better cross-language communication
        try:
            await ctx.room.local_participant.publish_data(
                message.encode('utf-8'),
                reliable=True,  # CRITICAL: Use reliable=True like original agent
                # No destination_identities = broadcast to all participants
                topic="transcription"
            )
            if not partial:
                logger.info(f"[{target_language}] ✅ Successfully broadcast transcription: {source_speaker_id or 'unknown'} -> {target_language}: original='{original_text[:50]}...', translated='{translated_text[:50]}...'")
        except Exception as e:
            logger.error(f"[{target_language}] ❌ Failed to broadcast transcription: {source_speaker_id or 'unknown'} -> {target_language}: {e}", exc_info=True)
            raise  # Re-raise to be caught by caller
    
    async def _send_translation_activity(self, ctx: JobContext, source_speaker_id: str, target_language: str, is_active: bool):
        """Send translation activity status to all participants for UI indicators
        
        This allows the frontend to show visual indicators (like "Translating...") even when
        users don't subscribe to the translation audio tracks. This is especially useful for
        same-language speakers who want to know when their speech is being translated.
        
        Args:
            source_speaker_id: The participant who is speaking (source)
            target_language: Target language code (e.g., 'es', 'fr', 'en')
            is_active: True when translation starts, False when it stops
        """
        try:
            message = json.dumps({
                "type": "translation_activity",
                "source_speaker_id": source_speaker_id or "unknown",
                "target_language": target_language,
                "is_active": is_active,
                "timestamp": asyncio.get_event_loop().time()
            })
            
            await ctx.room.local_participant.publish_data(
                message.encode('utf-8'),
                reliable=True,
                topic="translation_activity"
            )
            logger.debug(f"[{target_language}] 📡 Sent translation_activity: {source_speaker_id} -> {target_language}, active={is_active}")
        except Exception as e:
            logger.error(f"[{target_language}] ❌ Failed to send translation_activity: {e}")

    async def _update_assistant_subscriptions(self, ctx: JobContext, session: AgentSession, target_language: str):
        """Update SFU-level subscriptions for an assistant to filter same-language speakers.
        
        CRITICAL: We need to unsubscribe the agent's local participant from same-language speakers.
        This prevents the assistant from receiving audio from participants who speak the same language
        as the target language, which would cause feedback loops.
        
        Architecture:
        - English assistant should ONLY listen to non-English speakers (Spanish, French, etc.)
        - Spanish assistant should ONLY listen to non-Spanish speakers (English, French, etc.)
        - We assume: what they want to HEAR = what they SPEAK
        """
        try:
            logger.info(f"🔧 Updating subscriptions for {target_language} assistant")
            
            # Get list of participants this assistant should listen to
            participants_to_listen = []
            participants_to_ignore = []
            
            for participant in ctx.room.remote_participants.values():
                # Skip agents
                if participant.identity.startswith('agent-'):
                    continue
                
                participant_target_lang = self.participant_languages.get(participant.identity)
                
                # CRITICAL: Only process participants who have set their language preference
                # Ignore participants who haven't set a preference yet (participant_target_lang is None)
                if participant_target_lang is None:
                    logger.debug(f"  ⏭️ Skipping {participant.identity} - no language preference set yet")
                    continue
                
                if participant_target_lang == target_language:
                    # Same language - assistant should NOT listen to this participant
                    # (They speak the same language, so no translation needed)
                    participants_to_ignore.append(participant.identity)
                else:
                    # Different language - assistant SHOULD listen to this participant
                    # (They speak a different language, so translation is needed)
                    participants_to_listen.append(participant.identity)
            
            logger.info(f"  📋 {target_language} assistant should listen to: {participants_to_listen}")
            logger.info(f"  🚫 {target_language} assistant should ignore: {participants_to_ignore}")
            
            # CRITICAL: Filter subscriptions at the SFU level
            # We need to unsubscribe from same-language speakers to prevent feedback
            # However, this might interfere with AgentSession's audio handling
            # TODO: Consider using RoomInputOptions if LiveKit adds support for multiple participants
            
            logger.info(f"  🔍 Checking {len(ctx.room.remote_participants)} participants for audio tracks...")
            audio_tracks_found = 0
            
            for participant in ctx.room.remote_participants.values():
                if participant.identity.startswith('agent-'):
                    continue
                    
                participant_target_lang = self.participant_languages.get(participant.identity)
                logger.info(f"  👤 Participant {participant.identity}: target_lang={participant_target_lang}, has {len(participant.track_publications)} track publications")
                
                # CRITICAL: Only process participants who have set their language preference
                # Skip participants without preferences to avoid incorrect filtering
                if participant_target_lang is None:
                    logger.debug(f"  ⏭️ Skipping {participant.identity} - no language preference set yet")
                    continue
                
                # Find audio tracks from this participant
                for publication in participant.track_publications.values():
                    if publication.kind == rtc.TrackKind.KIND_AUDIO:
                        audio_tracks_found += 1
                        logger.info(f"    🎤 Found audio track: {publication.name}, subscribed={publication.subscribed}, participant={participant.identity}, target_lang={participant_target_lang}")
                        
                        if participant_target_lang == target_language:
                            # Same language - UNSUBSCRIBE to prevent assistant from hearing it
                            # This prevents feedback: English speakers shouldn't hear English assistant's output
                            if publication.subscribed:
                                try:
                                    publication.set_subscribed(False)
                                    logger.info(f"  🚫 Unsubscribed {target_language} assistant from {participant.identity} (same language: {participant_target_lang})")
                                except Exception as e:
                                    logger.warning(f"  ⚠️ Could not unsubscribe from {participant.identity}: {e}")
                        else:
                            # Different language - ENSURE SUBSCRIBED so assistant can hear it
                            # This allows translation: Spanish assistant needs to hear English speakers
                            if not publication.subscribed:
                                try:
                                    publication.set_subscribed(True)
                                    logger.info(f"  ✅ Subscribed {target_language} assistant to {participant.identity} (different language: {participant_target_lang})")
                                except Exception as e:
                                    logger.warning(f"  ⚠️ Could not subscribe to {participant.identity}: {e}")
            
            logger.info(f"  📊 Found {audio_tracks_found} audio tracks total")
        
        except Exception as e:
            logger.error(f"❌ Error updating subscriptions: {e}", exc_info=True)

    async def _restart_assistant_for_language(self, ctx: JobContext, target_language: str):
        """Restart all assistants for a specific target language (used when language changes)"""
        try:
            # Find all assistants for this target language (key format: "{speaker_id}:{target_language}")
            keys_to_restart = [key for key in self.assistants.keys() if key.endswith(f":{target_language}")]
            logger.info(f"🔄 Restarting {len(keys_to_restart)} assistants for target language {target_language}")
            
            for key in keys_to_restart:
                speaker_id = key.split(":")[0]
                logger.info(f"  Restarting assistant: {speaker_id} → {target_language}")
                old_assistant = self.assistants.pop(key)
                await old_assistant.aclose()
                await self._create_assistant_for_pair(ctx, speaker_id, target_language)
        except Exception as e:
            logger.error(f"Error restarting assistants for {target_language}: {e}", exc_info=True)
    
    async def _restart_all_assistants_for_vad_change(self, ctx: JobContext):
        """Restart all assistants when VAD setting changes to apply new sensitivity"""
        try:
            logger.info(f"🔄 Restarting all assistants with new VAD setting: {self.host_vad_setting}")
            
            # Store current state
            current_participants = dict(self.participant_languages)
            current_enabled = dict(self.translation_enabled)
            
            # Stop all existing assistants
            for key in list(self.assistants.keys()):
                assistant = self.assistants.pop(key)
                await assistant.aclose()
            
            # Small delay to let audio drain
            await asyncio.sleep(0.5)
            
            # Recreate assistants using the new pattern: assistants per (speaker, target_language) pair
            # Get all speakers and recreate assistants FROM each speaker TO each target language
            await self._update_assistants_for_all_languages(ctx)
            
            logger.info(f"✅ All assistants restarted with VAD setting: {self.host_vad_setting}")
        except Exception as e:
            logger.error(f"Error restarting assistants for VAD change: {e}", exc_info=True)


async def main(ctx: JobContext):
    logger.info("=" * 60)
    logger.info("🚀 AGENT ENTRYPOINT CALLED!")
    logger.info(f"📋 Room: {ctx.room.name if ctx.room else 'NO ROOM'}")
    logger.info(f"📋 Job Context Type: {type(ctx)}")
    logger.info("=" * 60)
    agent = SimpleTranslationAgent()
    await agent.entrypoint(ctx)


if __name__ == "__main__":
    # Load from .env file
    from dotenv import load_dotenv
    load_dotenv()
    
    agent_name = os.getenv('AGENT_NAME', 'translation-bot-dev')
    livekit_url = os.getenv('LIVEKIT_URL', 'wss://production-uiycx4ku.livekit.cloud')
    
    logger.info(f"Starting Simple Translation Agent: '{agent_name}'")
    logger.info(f"Environment: {'PRODUCTION' if os.getenv('NODE_ENV') == 'production' else 'DEVELOPMENT'}")
    logger.info(f"LiveKit URL: {livekit_url}")
    
    worker_opts = WorkerOptions(
        entrypoint_fnc=main,
        api_key=os.getenv('LIVEKIT_API_KEY'),
        api_secret=os.getenv('LIVEKIT_API_SECRET'),
        ws_url=livekit_url,
        agent_name=agent_name,
    )
    
    cli.run_app(worker_opts)
