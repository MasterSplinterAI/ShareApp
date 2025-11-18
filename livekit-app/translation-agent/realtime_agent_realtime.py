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
        self.assistants: Dict[str, AgentSession] = {}

        logger.info("Realtime Translation Agent initialized with OpenAI Realtime API (UNIFIED MODE)")

    async def entrypoint(self, ctx: JobContext):
        """Main entry point for the agent"""
        logger.info(f"Realtime Translation Agent starting in room: {ctx.room.name}")
        
        # Connect to room FIRST
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        
        my_identity = ctx.room.local_participant.identity
        logger.info(f"AGENT ENTRYPOINT CALLED! Agent connected with identity: {my_identity}")
        logger.info(f"Connected to room with {len(ctx.room.remote_participants)} participants")

        # Handle data channel messages for language preferences
        @ctx.room.on("data_received")
        def on_data_received(data: rtc.DataPacket):
            try:
                message = json.loads(data.data.decode('utf-8'))
                participant_id = data.participant.identity
                logger.info(f"📨 Data received - Topic: '{data.topic}', From: {participant_id}, Message: {message}")
                
                # Handle both message formats from frontend
                # RoomControls.jsx sends: type='language_update', language, enabled
                # useTranslation.js sends: type='language_preference', target_language, translation_enabled
                message_type = message.get('type')
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
                language_changed = old_language and old_language != language
                
                self.participant_languages[participant_id] = language
                self.translation_enabled[participant_id] = enabled
                
                logger.info(f"📊 Current participants with translation: {list(self.participant_languages.keys())}")
                logger.info(f"📊 Translation enabled status: {dict(self.translation_enabled)}")
                
                if enabled:
                    # Skip same-language translations to prevent echo/doubles
                    if language == 'en':
                        logger.info(f"⏭️ Skipping translation for {participant_id} - target language is English (same-language skip)")
                        return
                    
                    # If language changed, stop ALL existing assistants first, then create new ones
                    if language_changed:
                        logger.info(f"🔄 Language changed from {old_language} to {language} for {participant_id} - stopping old assistants first")
                        async def stop_and_recreate():
                            await self.stop_realtime_assistant(participant_id)
                            await asyncio.sleep(0.2)
                            self._create_shared_assistant_for_target_language(ctx, participant_id, language)
                        asyncio.create_task(stop_and_recreate())
                    else:
                        # Language didn't change, just create assistants normally
                        self._create_shared_assistant_for_target_language(ctx, participant_id, language)
                else:
                    # Translation disabled - stop all assistants for this participant
                    logger.info(f"🛑 Translation disabled for {participant_id}, stopping all assistants")
                    asyncio.create_task(self.stop_realtime_assistant(participant_id))
                    # Also clear the enabled flag to prevent any new assistants from being created
                    self.translation_enabled[participant_id] = False

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
            
            # Create assistants for new participant: translate existing participants → new participant's language
            new_participant_lang = self.participant_languages.get(new_participant_id, 'en')
            
            # Collect unique target languages from existing participants who have translation enabled
            target_languages_needed = {}
            for existing_participant_id, target_language in self.participant_languages.items():
                if existing_participant_id == new_participant_id:
                    continue
                if self.translation_enabled.get(existing_participant_id, False):
                    if target_language not in target_languages_needed:
                        target_languages_needed[target_language] = existing_participant_id
            
            # Create ONE shared assistant per target language
            for target_language, owner_participant_id in target_languages_needed.items():
                # Check if assistant already exists for this language pair
                assistant_exists = False
                for existing_key in self.assistants.keys():
                    if existing_key.endswith(f":{new_participant_id}"):
                        existing_participant_id = existing_key.split(':')[0]
                        existing_target_lang = self.participant_languages.get(existing_participant_id)
                        if existing_target_lang == target_language:
                            logger.info(f"♻️ Reusing existing assistant for language pair {new_participant_lang} → {target_language}")
                            assistant_exists = True
                            break
                
                if not assistant_exists:
                    logger.info(f"🚀 New participant joined - Creating shared assistant: {new_participant_id} -> {target_language}")
                    asyncio.create_task(
                        self.create_realtime_assistant(
                            ctx,
                            owner_participant_id,
                            target_language,
                            source_participant_id=new_participant_id,
                            use_language_based_track=True
                        )
                    )
            
            # Also create assistants for the new participant if they have translation enabled
            if new_participant_id in self.participant_languages and self.translation_enabled.get(new_participant_id, False):
                target_language = self.participant_languages[new_participant_id]
                
                if target_language == 'en':
                    logger.info(f"⏭️ Skipping translation for {new_participant_id} - target language is English")
                    return
                
                self._create_shared_assistant_for_target_language(ctx, new_participant_id, target_language)

        @ctx.room.on("participant_disconnected")
        def on_participant_disconnected(participant: rtc.RemoteParticipant):
            participant_id = participant.identity
            logger.info(f"Participant disconnected: {participant_id}")
            
            self.participant_languages.pop(participant_id, None)
            self.translation_enabled.pop(participant_id, None)
            
            asyncio.create_task(self.stop_realtime_assistant(participant_id))

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

    def _create_shared_assistant_for_target_language(self, ctx: JobContext, any_participant_id: str, target_language: str):
        """Create ONE shared translation assistant per target language.
        Works perfectly for 2 languages or 20 — no duplicates, no overlap.
        """
        logger.info(f"🎯 Creating shared assistants for {any_participant_id} -> {target_language}")
        
        # Get all other participants (sources to translate FROM)
        other_participants = [p for p in ctx.room.remote_participants.values() 
                            if not p.identity.startswith('agent-') and p.identity != any_participant_id]
        
        for source_participant in other_participants:
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

    async def create_realtime_assistant(
        self,
        ctx: JobContext,
        participant_id: str,
        target_language: str,
        source_participant_id: str = None,
        use_language_based_track: bool = True  # Always True now - unified mode
    ):
        """Create an OpenAI Realtime API assistant for translation using AgentSession
        Uses OpenAI Realtime Model for ultra-low latency translation
        """
        try:
            assistant_key = f"{participant_id}:{source_participant_id or 'all'}"
            
            # Stop existing assistant if any
            if assistant_key in self.assistants:
                assistant = self.assistants.pop(assistant_key)
                await assistant.aclose()
            
            logger.info(f"Creating Realtime API assistant: {source_participant_id or 'all'} -> {target_language} for {participant_id}")
            
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
                turn_detection={  # ← CRITICAL: Enables instant turn ending and streaming deltas (dict format)
                    "type": "server_vad",
                    "threshold": 0.5,  # 0.1 = very sensitive, 0.9 = less sensitive (0.5 is sweet spot)
                    "prefix_padding_ms": 300,  # Include a little audio before speech starts
                    "silence_duration_ms": 500,  # 500ms silence = end of turn (feels natural, like ChatGPT Voice)
                },
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
                    "Automatically detect the actual spoken language from the audio stream. "
                    f"If the detected spoken language is already {target_lang_name}, stay completely silent — "
                    "output no audio and no text. Do not repeat, echo, or dub the original. "
                    f"Only output translation when the spoken language differs from {target_lang_name}. "
                    "Translate accurately and naturally. Never add acknowledgments, confirmations, explanations, or meta-commentary. "
                    "Never say things like 'I understand', 'I'll stay silent', 'Understood', 'no output', 'zero output', "
                    "or any similar phrases. When languages match, produce absolutely nothing — not even a single word. "
                    "Do not output any text that describes your state or actions. Output ONLY translations when needed."
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
                "source_speaker_id": source_participant_id or "all",  # Track who actually spoke
                "target_participant_id": participant_id,  # Track who receives this translation
            }
            
            # Helper function to detect and filter meta-commentary responses
            def is_meta_commentary(text: str) -> bool:
                """Check if text is meta-commentary that should be filtered out"""
                if not text:
                    return True
                text_lower = text.lower().strip()
                
                # Remove punctuation for matching
                text_clean = text_lower.replace(".", "").replace(",", "").replace("!", "").replace("?", "").strip()
                
                # Common meta-commentary phrases OpenAI might generate
                meta_phrases = [
                    "i understand", "i'll stay silent", "i'll remain silent", "understood",
                    "i'll stop", "no translation needed", "staying silent", "remaining silent",
                    "no output", "zero output", "complete silence", "producing nothing",
                    "nothing to translate", "no translation", "staying quiet", "remaining quiet",
                    "i understand now", "got it", "okay", "ok", "will stay silent", "will remain silent"
                ]
                
                # Check if text matches exactly (with or without punctuation)
                for phrase in meta_phrases:
                    phrase_clean = phrase.replace(".", "").replace(",", "").replace("!", "").replace("?", "").strip()
                    if text_clean == phrase_clean or text_clean.startswith(phrase_clean + " ") or text_clean == phrase_clean:
                        return True
                
                # Check if text contains any meta-commentary phrase
                for phrase in meta_phrases:
                    if phrase in text_lower:
                        return True
                
                # Filter very short responses that are likely acknowledgments (1-4 words)
                words = text_lower.split()
                if len(words) <= 4:
                    acknowledgment_words = ["understand", "silent", "ok", "okay", "got", "it", "no", "output", "zero", "nothing"]
                    if any(word in acknowledgment_words for word in words):
                        return True
                
                # Filter if text is just punctuation or whitespace
                if not text_clean or len(text_clean) == 0:
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
            
            @session.on("agent_speech_started")
            def on_agent_started(_):
                """Reset translation accumulator on new speech start"""
                session.user_data["current_translation"] = ""
                session.user_data["sent_final"] = False  # Reset flag to allow new transcription
                logger.info(f"[{assistant_key}] 🎤 Agent speech started - reset translation accumulator and sent_final flag")
            
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
                    if len(accumulated.split()) >= 2 or len(accumulated) >= 15:
                        logger.debug(f"[{assistant_key}] 📤 Sending incremental transcription: {accumulated[:50]}...")
                        try:
                            source_speaker = session.user_data.get("source_speaker_id") or participant_id
                            asyncio.create_task(
                                self.send_transcription_data(ctx, source_speaker, participant_id, original, accumulated, target_language, partial=True)
                            )
                        except RuntimeError as e:
                            logger.debug(f"[{assistant_key}] Failed to send incremental: {e}")
            
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
                if is_meta_commentary(final):
                    logger.info(f"[{assistant_key}] 🚫 Filtered out meta-commentary response: {final[:100]}...")
                    session.user_data["sent_final"] = True  # Mark as sent to prevent retries
                    return
                
                original = session.user_data.get("last_original") or final
                session.user_data["sent_final"] = True
                
                # Get source speaker from session data (who actually spoke)
                source_speaker = session.user_data.get("source_speaker_id") or participant_id
                
                logger.info(f"[{assistant_key}] ✅ Translation (final from agent_speech_committed): {final[:100]}... (full length: {len(final)})")
                
                # Safe: we are inside LiveKit's async context
                try:
                    asyncio.create_task(
                        self.send_transcription_data(ctx, source_speaker, participant_id, original, final, target_language, partial=False)
                    )
                except RuntimeError as e:
                    logger.error(f"[{assistant_key}] ❌ Failed to create task for sending transcription: {e}")
            
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
            
            # Find source participant if specified (who to listen to)
            source_participant = None
            if source_participant_id:
                for p in ctx.room.remote_participants.values():
                    if p.identity == source_participant_id:
                        source_participant = p
                        break
            
            # Find target participant (who should receive the translation)
            target_participant = None
            for p in ctx.room.remote_participants.values():
                if p.identity == participant_id:
                    target_participant = p
                    break
            
            # Configure room input/output options for proper routing
            # Input: listen to source_participant's audio
            room_input_opts = None
            if source_participant_id:
                room_input_opts = room_io.RoomInputOptions(participant_identity=source_participant_id)
            
            # Output: Create unique track name for this translation pair
            # ALWAYS use language-based track names (shared across listeners)
            # Track name format: translation-{target_language}-{source_participant}
            # Example: translation-es-EnglishSpeaker (Spanish translation from English speaker)
            # All Spanish listeners will subscribe to this same track
            track_name = f"translation-{target_language}-{source_participant_id or 'all'}"
            logger.info(f"🎯 Using shared language-based track: {track_name}")
            room_output_opts = room_io.RoomOutputOptions(
                audio_track_name=track_name  # Unique track name to identify this translation
            )
            
            # Start the session with the agent
            # AgentSession.start() supports both room_input_options and room_output_options
            try:
                if room_input_opts:
                    await session.start(
                        agent, 
                        room=ctx.room, 
                        room_input_options=room_input_opts,
                        room_output_options=room_output_opts
                    )
                else:
                    await session.start(
                        agent, 
                        room=ctx.room,
                        room_output_options=room_output_opts
                    )
            except Exception as e:
                logger.error(f"Error starting AgentSession: {e}", exc_info=True)
                raise
            
            self.assistants[assistant_key] = session
            
            logger.info(f"✅ Realtime API assistant started: {source_participant_id or 'all'} -> {target_language} for {participant_id} (track: {track_name})")
            logger.info(f"📋 Active assistants: {list(self.assistants.keys())}")
            
        except Exception as e:
            logger.error(f"❌ Error creating Realtime assistant for {participant_id}: {e}", exc_info=True)
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")

    async def stop_realtime_assistant(self, participant_id: str):
        """Stop all Realtime assistants for a participant"""
        try:
            keys_to_remove = [key for key in self.assistants.keys() if key.startswith(f"{participant_id}:")]
            for key in keys_to_remove:
                assistant = self.assistants.pop(key)
                await assistant.aclose()
                logger.info(f"Stopped Realtime assistant {key}")
        except Exception as e:
            logger.error(f"Error stopping Realtime assistant for {participant_id}: {e}", exc_info=True)

    async def send_transcription_data(self, ctx: JobContext, source_speaker_id: str, target_participant_id: str, original_text: str, translated_text: str, language: str, partial: bool = False):
        """Send transcription via data channel to ALL participants (broadcast)
        
        This allows everyone to see both original and translated text, helping speakers
        verify if AI missed anything and enabling better cross-language communication.
        
        Args:
            source_speaker_id: The participant who actually spoke (source speaker)
            target_participant_id: The participant who receives this translation (target recipient)
            original_text: Original text in source language
            translated_text: Translated text in target language
            language: Target language code (e.g., 'es', 'fr')
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
                logger.info(f"📤 Broadcasting final transcription: {source_speaker_id} -> {language} for {target_participant_id}: {translated_text[:50]}...")
            
            # Broadcast to ALL participants so everyone can see both original and translated text
            # This helps speakers verify accuracy and enables better cross-language communication
            await ctx.room.local_participant.publish_data(
                message.encode('utf-8'),
                reliable=True,
                # Remove destination_identities to broadcast to all participants
                topic="transcription"
            )
            if not partial:
                logger.info(f"✅ Broadcast transcription to all: speaker={source_speaker_id}, original='{original_text[:50]}...', translated='{translated_text[:50]}...'")
        except Exception as e:
            logger.error(f"❌ Failed to send transcription: {e}", exc_info=True)


async def main(ctx: JobContext):
    logger.info("=" * 50)
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

