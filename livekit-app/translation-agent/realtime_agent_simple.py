#!/usr/bin/env python3
"""
SIMPLIFIED Translation Agent - ONE assistant per target language
Fixes the duplicate audio stream issue when multiple users have the same target language
"""

import os
import json
import asyncio
import logging
import sys
from typing import Dict, Optional, Set
from livekit import agents, rtc
from livekit.agents import JobContext, WorkerOptions, cli
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
    ONE assistant per target language architecture:
    - English listeners share ONE Spanish→English assistant
    - Spanish listeners share ONE English→Spanish assistant
    - No duplicate audio streams!
    """

    def __init__(self):
        self.openai_api_key = os.getenv('OPENAI_API_KEY')
        if not self.openai_api_key:
            raise ValueError("OPENAI_API_KEY environment variable is required")

        # User preferences
        self.participant_languages: Dict[str, str] = {}  # participant_id -> language they want to HEAR
        self.translation_enabled: Dict[str, bool] = {}   # participant_id -> enabled/disabled
        
        # KEY CHANGE: assistants keyed by target_language only (not speaker:listener)
        self.assistants: Dict[str, AgentSession] = {}  # target_language -> AgentSession
        
        self.host_vad_setting: str = "medium"
        self.host_participant_id: Optional[str] = None

        logger.info("✅ Simple Translation Agent initialized (ONE assistant per language)")

    async def entrypoint(self, ctx: JobContext):
        """Main entry point for the agent"""
        logger.info(f"📋 Room: {ctx.room.name}")
        logger.info("✅ Simple Translation Agent initialized")
        logger.info(f"👥 Participants in room: {len(ctx.room.remote_participants)}")

        # Set up event handlers
        @ctx.room.on("data_received")
        def on_data_received(data: rtc.DataPacket):
            """Handle language preference updates"""
            if data.topic == "" or data.topic == "language_update":
                try:
                    message = json.loads(data.data.decode('utf-8'))
                    if message.get('type') == 'language_update':
                        participant_id = data.participant.identity
                        language = message.get('language', 'en')
                        enabled = message.get('enabled', False)
                        
                        logger.info(f"📨 Language update: {participant_id} -> {language} (enabled: {enabled})")
                        
                        # Update preferences
                        old_enabled = self.translation_enabled.get(participant_id, False)
                        self.participant_languages[participant_id] = language
                        self.translation_enabled[participant_id] = enabled
                        
                        # Update assistants based on new configuration
                        asyncio.create_task(self._update_assistants_for_all_languages(ctx))
                        
                except Exception as e:
                    logger.error(f"Error processing language update: {e}")

        @ctx.room.on("participant_connected")
        def on_participant_connected(participant: rtc.RemoteParticipant):
            """Handle new participant joining"""
            if not participant.identity.startswith('agent-'):
                logger.info(f"👤 Participant connected: {participant.identity}")
                # Update assistants when someone joins
                asyncio.create_task(self._update_assistants_for_all_languages(ctx))

        @ctx.room.on("participant_disconnected")
        def on_participant_disconnected(participant: rtc.RemoteParticipant):
            """Handle participant leaving"""
            participant_id = participant.identity
            logger.info(f"👋 Participant disconnected: {participant_id}")
            
            # Clean up their preferences
            self.participant_languages.pop(participant_id, None)
            self.translation_enabled.pop(participant_id, None)
            
            # Update assistants
            asyncio.create_task(self._update_assistants_for_all_languages(ctx))

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
        Core logic: Create/update ONE assistant per target language.
        This is the key to preventing duplicate audio streams.
        """
        # Get all active target languages (languages users want to HEAR)
        active_languages = set()
        for participant_id, language in self.participant_languages.items():
            if self.translation_enabled.get(participant_id, False):
                active_languages.add(language)
        
        logger.info(f"📊 Active target languages: {active_languages}")
        
        # Create assistants for new languages
        for language in active_languages:
            if language not in self.assistants:
                logger.info(f"🚀 Creating assistant for {language}")
                await self._create_assistant_for_language(ctx, language)
        
        # Stop assistants for languages no longer needed
        for language in list(self.assistants.keys()):
            if language not in active_languages:
                logger.info(f"🛑 Stopping assistant for {language} (no longer needed)")
                assistant = self.assistants.pop(language)
                await assistant.aclose()

    async def _create_assistant_for_language(self, ctx: JobContext, target_language: str):
        """
        Create ONE assistant for a target language.
        This assistant will:
        1. Listen to ALL participants
        2. Auto-detect their spoken language
        3. Translate to target_language if different
        4. Stay silent if same language
        5. Publish ONE track: translation-{target_language}
        """
        try:
            # Language name mapping for instructions
            language_names = {
                'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
                'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian',
                'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese'
            }
            target_lang_name = language_names.get(target_language, target_language)
            
            # Create the realtime model
            realtime_model = RealtimeModel(
                voice="alloy",
                modalities=["text", "audio"],
                temperature=0.7,
                turn_detection={
                    "type": "server_vad",
                    "threshold": 0.5,
                    "silence_duration": 0.2,
                    "prefix_padding": 0.3
                }
            )
            
            # Create session
            session = AgentSession(
                vad=silero.VAD.load(),
                llm=realtime_model,
                allow_interruptions=True
            )
            
            # Simple, clear instructions
            agent = Agent(
                instructions=(
                    f"You are a translator. Target language: {target_lang_name}. "
                    f"Listen and detect what language is being spoken. "
                    f"If someone speaks {target_lang_name}, stay completely silent. "
                    f"If someone speaks a different language, translate it to {target_lang_name}. "
                    f"Never say 'no translation needed' or any meta-commentary. "
                    f"Only output actual translations, nothing else."
                )
            )
            
            # Track name for this language
            track_name = f"translation-{target_language}"
            
            # Start the session
            room_output_opts = {
                "audio_track_opts": rtc.AudioTrackPublishOptions(
                    name=track_name,
                    stream=track_name
                )
            }
            
            await session.start(agent, room=ctx.room, room_output_options=room_output_opts)
            
            # Store the assistant
            self.assistants[target_language] = session
            
            logger.info(f"✅ Assistant for {target_language} created with track: {track_name}")
            
            # Count listeners
            listeners = [
                pid for pid, lang in self.participant_languages.items()
                if lang == target_language and self.translation_enabled.get(pid, False)
            ]
            logger.info(f"   Serving {len(listeners)} {target_lang_name} listeners: {listeners}")
            
        except Exception as e:
            logger.error(f"Error creating assistant for {target_language}: {e}")


async def main(ctx: JobContext):
    logger.info("AGENT ENTRYPOINT CALLED!")
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
