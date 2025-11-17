"""
LiveKit Translation Agent
Provides real-time audio translation for conference participants
"""
import os
import asyncio
import logging
from typing import Dict, Optional
from dataclasses import dataclass
from dotenv import load_dotenv

from livekit import rtc
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
    llm,
)
from livekit.agents.voice_assistant import VoiceAssistant
from livekit.plugins import deepgram, google, elevenlabs, openai

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=getattr(logging, os.getenv('LOG_LEVEL', 'INFO')),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@dataclass
class ParticipantLanguage:
    """Track language preferences for each participant"""
    participant_id: str
    source_language: str = "en"
    target_language: str = "en"
    translation_enabled: bool = False


class TranslationAgent:
    """Main translation agent that manages translation pipelines for participants"""
    
    def __init__(self):
        self.participant_languages: Dict[str, ParticipantLanguage] = {}
        self.translation_assistants: Dict[str, VoiceAssistant] = {}
        
        # Initialize STT provider (Deepgram)
        self.stt = deepgram.STT(
            api_key=os.getenv('DEEPGRAM_API_KEY'),
            model="nova-2",
            language="en",  # Will be updated per participant
        )
        
        # Initialize TTS provider (ElevenLabs)
        self.tts = elevenlabs.TTS(
            api_key=os.getenv('ELEVENLABS_API_KEY'),
            voice="rachel",  # Natural sounding voice
        )
        
        # Initialize translation LLM (using Google Translate via custom implementation)
        # For now, we'll use OpenAI as a translation service
        self.llm = openai.LLM(
            api_key=os.getenv('OPENAI_API_KEY'),
            model="gpt-4-turbo-preview",
        )
        
    async def entrypoint(self, ctx: JobContext):
        """Main entry point for the agent"""
        logger.info(f"Translation agent started for room: {ctx.room.name}")
        
        # Set up initial configuration
        initial_ctx = llm.ChatContext().append(
            role="system",
            text=(
                "You are a real-time translator. Your ONLY job is to translate the input text "
                "to the target language. Do not add any commentary or explanation. "
                "Just provide the direct translation. Keep the tone and style of the original."
            ),
        )
        
        # Connect to the room
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        
        # Monitor room events
        @ctx.room.on("participant_connected")
        def on_participant_connected(participant: rtc.RemoteParticipant):
            logger.info(f"Participant connected: {participant.identity}")
            # Initialize language preferences for new participant
            self.participant_languages[participant.identity] = ParticipantLanguage(
                participant_id=participant.identity,
                source_language="en",
                target_language="en",
                translation_enabled=False
            )
        
        @ctx.room.on("track_subscribed")
        def on_track_subscribed(
            track: rtc.Track,
            publication: rtc.RemoteTrackPublication,
            participant: rtc.RemoteParticipant,
        ):
            if track.kind == rtc.TrackKind.AUDIO:
                logger.info(f"Subscribed to audio from {participant.identity}")
                # Start processing audio for this participant if translation is enabled
                asyncio.create_task(
                    self._process_participant_audio(ctx, participant, track)
                )
        
        @ctx.room.on("data_received")
        def on_data_received(data: rtc.DataPacket):
            """Handle language preference updates from participants"""
            try:
                if data.topic == "language_preference":
                    import json
                    pref_data = json.loads(data.data.decode('utf-8'))
                    participant_id = pref_data.get('participant_id')
                    target_lang = pref_data.get('target_language', 'en')
                    enabled = pref_data.get('translation_enabled', False)
                    
                    if participant_id in self.participant_languages:
                        self.participant_languages[participant_id].target_language = target_lang
                        self.participant_languages[participant_id].translation_enabled = enabled
                        logger.info(
                            f"Updated language preference for {participant_id}: "
                            f"target={target_lang}, enabled={enabled}"
                        )
            except Exception as e:
                logger.error(f"Error processing data packet: {e}")
        
        # Keep the agent running
        logger.info("Translation agent is ready and listening...")
        
    async def _process_participant_audio(
        self, 
        ctx: JobContext, 
        participant: rtc.RemoteParticipant,
        audio_track: rtc.Track
    ):
        """Process audio from a participant and provide translations"""
        participant_id = participant.identity
        
        # Wait for translation to be enabled
        while participant_id not in self.participant_languages or \
              not self.participant_languages[participant_id].translation_enabled:
            await asyncio.sleep(1)
            if participant_id not in self.participant_languages:
                return  # Participant disconnected
        
        lang_pref = self.participant_languages[participant_id]
        logger.info(
            f"Starting translation for {participant_id}: "
            f"{lang_pref.source_language} -> {lang_pref.target_language}"
        )
        
        # Create a voice assistant for this participant's translation
        assistant = VoiceAssistant(
            vad=self.stt.vad,  # Voice activity detection
            stt=self.stt,
            llm=self.llm,
            tts=self.tts,
            chat_ctx=llm.ChatContext().append(
                role="system",
                text=(
                    f"You are translating from {lang_pref.source_language} "
                    f"to {lang_pref.target_language}. "
                    "Only provide the direct translation without any additional text."
                ),
            ),
        )
        
        # Start the assistant
        assistant.start(ctx.room)
        
        # Store assistant reference
        self.translation_assistants[participant_id] = assistant
        
        # The assistant will automatically process audio and publish translated audio
        # to the room on a separate track that other participants can subscribe to
        
        # Monitor for participant disconnect
        while participant_id in self.participant_languages:
            await asyncio.sleep(1)
        
        # Cleanup when participant leaves
        if participant_id in self.translation_assistants:
            await self.translation_assistants[participant_id].stop()
            del self.translation_assistants[participant_id]


async def main():
    """Main entry point"""
    # Configure and run the agent worker
    worker = WorkerOptions(
        entrypoint_fnc=TranslationAgent().entrypoint,
        api_key=os.getenv('LIVEKIT_API_KEY'),
        api_secret=os.getenv('LIVEKIT_API_SECRET'),
        ws_url=os.getenv('LIVEKIT_URL'),
    )
    
    # Run the agent
    await cli.run_app(worker)


if __name__ == "__main__":
    # Run the agent
    asyncio.run(main())
