#!/usr/bin/env python
"""
Simple LiveKit Translation Agent using VoiceAssistant
Follows LiveKit's official patterns exactly
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
    llm,
    VoiceAssistant,
)
from livekit.plugins import openai, silero

load_dotenv()

logging.basicConfig(
    level=getattr(logging, os.getenv('LOG_LEVEL', 'INFO')),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class SimpleTranslationAgent:
    """Simple translation agent using LiveKit's VoiceAssistant"""
    
    def __init__(self):
        self.participant_languages: Dict[str, str] = {}  # participant_id -> target_language
        self.translation_enabled: Dict[str, bool] = {}  # participant_id -> enabled
        self.assistants: Dict[str, VoiceAssistant] = {}  # participant_id -> assistant
        
    async def entrypoint(self, ctx: JobContext):
        """Main entry point"""
        logger.info("=" * 60)
        logger.info("SIMPLE TRANSLATION AGENT STARTING")
        logger.info(f"Room: {ctx.room.name}")
        logger.info("=" * 60)
        
        # Connect to room
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        logger.info(f"Connected to room. Participants: {len(ctx.room.remote_participants)}")
        
        # Handle data messages for language preferences
        @ctx.room.on("data_received")
        def on_data_received(data: rtc.DataPacket):
            try:
                # Decode message
                message = json.loads(data.data.decode('utf-8'))
                logger.info(f"Data received: {message}")
                
                # Check if it's a language update
                if message.get('type') == 'language_update':
                    participant_name = message.get('participantName', '')
                    participant_id = data.participant.identity if data.participant else participant_name
                    language = message.get('language', 'en')
                    enabled = message.get('enabled', False)
                    
                    logger.info(f"Language update: {participant_id} -> {language}, enabled: {enabled}")
                    
                    # Store preferences
                    self.participant_languages[participant_id] = language
                    self.translation_enabled[participant_id] = enabled
                    
                    # Create/update assistant if enabled
                    if enabled:
                        asyncio.create_task(self._create_translation_assistant(ctx, participant_id, language))
                    else:
                        # Stop assistant
                        if participant_id in self.assistants:
                            asyncio.create_task(self._stop_assistant(participant_id))
                            
            except Exception as e:
                logger.error(f"Error processing data: {e}", exc_info=True)
        
        # Handle participant disconnect
        @ctx.room.on("participant_disconnected")
        def on_participant_disconnected(participant: rtc.RemoteParticipant):
            participant_id = participant.identity
            logger.info(f"Participant disconnected: {participant_id}")
            self.participant_languages.pop(participant_id, None)
            self.translation_enabled.pop(participant_id, None)
            if participant_id in self.assistants:
                asyncio.create_task(self._stop_assistant(participant_id))
        
        # Handle track subscriptions - when audio tracks are available
        @ctx.room.on("track_subscribed")
        def on_track_subscribed(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
            if track.kind == rtc.TrackKind.KIND_AUDIO:
                speaker_id = participant.identity
                logger.info(f"Audio track subscribed from: {speaker_id}")
                # Check if any participant needs translation of this speaker
                for participant_id, enabled in self.translation_enabled.items():
                    if enabled and participant_id != speaker_id:
                        logger.info(f"Translation needed: {speaker_id} -> {participant_id}")
                        # Assistant will handle this automatically
        
        logger.info("Agent ready and listening for language preferences...")
        
        # Keep running until room disconnects
        try:
            while ctx.room.connection_state == rtc.ConnectionState.CONN_CONNECTED:
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            logger.info("Agent cancelled")
        finally:
            # Cleanup
            for participant_id in list(self.assistants.keys()):
                await self._stop_assistant(participant_id)
            logger.info("Agent shutdown complete")
    
    async def _create_translation_assistant(self, ctx: JobContext, participant_id: str, target_language: str):
        """Create a VoiceAssistant for translation"""
        try:
            # Stop existing assistant if any
            if participant_id in self.assistants:
                await self._stop_assistant(participant_id)
            
            logger.info(f"Creating translation assistant for {participant_id} -> {target_language}")
            
            # Language name mapping
            lang_names = {
                'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
                'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian',
                'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
                'ar': 'Arabic', 'hi': 'Hindi'
            }
            target_lang_name = lang_names.get(target_language, target_language)
            
            # Create translation context
            translation_ctx = llm.ChatContext().append(
                role="system",
                text=(
                    f"You are a real-time translator. Translate all speech to {target_lang_name}. "
                    f"Output ONLY the translation, no explanations. Maintain the original tone."
                )
            )
            
            # Create VoiceAssistant with OpenAI
            assistant = VoiceAssistant(
                vad=silero.VAD.load(),
                stt=openai.STT(
                    api_key=os.getenv("OPENAI_API_KEY"),
                    model="whisper-1",
                    language=None  # Auto-detect
                ),
                llm=openai.LLM(
                    api_key=os.getenv("OPENAI_API_KEY"),
                    model="gpt-4o-mini"  # Faster and cheaper
                ),
                tts=openai.TTS(
                    api_key=os.getenv("OPENAI_API_KEY"),
                    model="tts-1-hd",
                    voice="nova"
                ),
                chat_ctx=translation_ctx,
                allow_interruptions=False,
            )
            
            # Set up event handlers
            @assistant.on("user_speech_committed")
            def on_speech(msg: llm.ChatMessage):
                logger.info(f"[{participant_id}] Original: {msg.content}")
            
            @assistant.on("agent_speech_committed")
            def on_translation(msg: llm.ChatMessage):
                logger.info(f"[{participant_id}] Translated ({target_language}): {msg.content}")
                # Send transcription via data channel
                asyncio.create_task(self._send_transcription(ctx, participant_id, msg.content))
            
            # Start assistant - it will listen to ALL audio in the room
            assistant.start(ctx.room)
            
            # Store assistant
            self.assistants[participant_id] = assistant
            
            logger.info(f"Translation assistant started for {participant_id}")
            
        except Exception as e:
            logger.error(f"Error creating assistant: {e}", exc_info=True)
    
    async def _send_transcription(self, ctx: JobContext, participant_id: str, translated_text: str):
        """Send transcription via data channel"""
        try:
            message = json.dumps({
                "type": "transcription",
                "text": translated_text,
                "language": self.participant_languages.get(participant_id, "en"),
                "participant_id": participant_id
            })
            await ctx.room.local_participant.publish_data(
                message.encode('utf-8'),
                reliable=True,
                destination_identities=[participant_id],
                topic="transcription"
            )
            logger.info(f"Sent transcription to {participant_id}")
        except Exception as e:
            logger.error(f"Error sending transcription: {e}")
    
    async def _stop_assistant(self, participant_id: str):
        """Stop and cleanup assistant"""
        if participant_id in self.assistants:
            try:
                assistant = self.assistants.pop(participant_id)
                await assistant.aclose()
                logger.info(f"Stopped assistant for {participant_id}")
            except Exception as e:
                logger.error(f"Error stopping assistant: {e}")


async def main(ctx: JobContext):
    """Entry point function"""
    agent = SimpleTranslationAgent()
    await agent.entrypoint(ctx)


if __name__ == "__main__":
    # Don't set agent_name to match unnamed self-hosted agent
    agent_name = os.getenv('AGENT_NAME')  # None if not set
    
    worker_opts = {
        'entrypoint_fnc': main,
        'api_key': os.getenv('LIVEKIT_API_KEY'),
        'api_secret': os.getenv('LIVEKIT_API_SECRET'),
        'ws_url': os.getenv('LIVEKIT_URL', 'wss://jayme-rhmomj8r.livekit.cloud'),
    }
    
    if agent_name:
        worker_opts['agent_name'] = agent_name
    
    logger.info("Starting Simple Translation Agent...")
    logger.info(f"LiveKit URL: {worker_opts['ws_url']}")
    
    cli.run_app(WorkerOptions(**worker_opts))

