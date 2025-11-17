#!/usr/bin/env python
"""
LiveKit Translation Agent with OpenAI
Proper implementation using LiveKit Agents SDK and OpenAI APIs
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
)
from livekit.plugins import openai, silero

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=getattr(logging, os.getenv('LOG_LEVEL', 'INFO')),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class OpenAITranslationAgent:
    """Translation agent using OpenAI for STT, Translation, and TTS"""
    
    def __init__(self):
        self.openai_api_key = os.getenv('OPENAI_API_KEY')
        if not self.openai_api_key:
            raise ValueError("OPENAI_API_KEY environment variable is required")
        
        # Track participant language preferences and translation pipelines
        self.participant_languages: Dict[str, str] = {}
        self.translation_enabled: Dict[str, bool] = {}
        self.translation_pipelines: Dict[str, Dict] = {}  # Store pipelines per participant
        
        # Initialize OpenAI services
        self.stt = openai.STT(
            api_key=self.openai_api_key,
            model="whisper-1",
            language=None,  # Auto-detect
        )
        
        self.llm = openai.LLM(
            api_key=self.openai_api_key,
            model="gpt-4o-mini",  # Faster and cheaper for translation
        )
        
        logger.info("OpenAI Translation Agent initialized")
    
    def get_translation_prompt(self, target_language: str) -> list:
        """Get the translation prompt for GPT"""
        language_names = {
            'en': 'English',
            'es': 'Spanish',
            'fr': 'French',
            'de': 'German',
            'it': 'Italian',
            'pt': 'Portuguese',
            'ru': 'Russian',
            'ja': 'Japanese',
            'ko': 'Korean',
            'zh': 'Chinese',
            'ar': 'Arabic',
            'hi': 'Hindi',
        }
        
        target_name = language_names.get(target_language, target_language)
        
        return [
            llm.ChatMessage(
                role="system",
                content=f"""You are a real-time conference translator. Your ONLY job is to:
1. Translate the spoken text accurately to {target_name}
2. Output ONLY the translation - no explanations or commentary
3. Preserve the speaker's tone and emotion
4. Be concise and natural

Rules:
- Output ONLY the translation
- Never add "The speaker said" or similar phrases
- Never explain what you're doing
- Maintain professional conference interpreting standards"""
            )
        ]
    
    async def entrypoint(self, ctx: JobContext):
        """Main entry point for the agent"""
        logger.info(f"OpenAI Translation Agent starting in room: {ctx.room.name}")
        
        # Connect to room (audio only for translation)
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        
        logger.info(f"Connected to room with {len(ctx.room.remote_participants)} participants")
        
        # Set up data message handler for language preferences
        @ctx.room.on("data_received")
        def on_data_received(data: rtc.DataPacket):
            """Handle data messages for language preferences"""
            try:
                logger.info(f"Data received - Topic: '{data.topic}', From: {data.participant.identity if data.participant else 'System'}")
                
                if data.topic == "language_preference":
                    try:
                        message = json.loads(data.data.decode('utf-8'))
                        participant_id = data.participant.identity if data.participant else message.get('participantName', 'unknown')
                        
                        logger.info(f"Language preference message: {message}")
                        
                        if message.get('type') == 'language_update':
                            language = message.get('language', 'en')
                            enabled = message.get('enabled', False)
                            participant_name = message.get('participantName', participant_id)
                            
                            logger.info(f"Language update from {participant_name}: {language} (enabled: {enabled})")
                            
                            self.participant_languages[participant_id] = language
                            self.translation_enabled[participant_id] = enabled
                            
                            # Send confirmation
                            asyncio.create_task(
                                self.send_confirmation(ctx, participant_id, language, enabled)
                            )
                            
                            # Start/stop translation pipeline
                            if enabled:
                                logger.info(f"Starting translation pipeline for {participant_name} -> {language}")
                                asyncio.create_task(
                                    self.start_translation_pipeline(ctx, participant_id, language)
                                )
                            else:
                                logger.info(f"Stopping translation pipeline for {participant_name}")
                                self.stop_translation_pipeline(participant_id)
                                
                    except Exception as e:
                        logger.error(f"Error processing language preference: {e}", exc_info=True)
            except Exception as e:
                logger.error(f"Error processing data message: {e}", exc_info=True)
        
        # Handle participant events
        @ctx.room.on("participant_connected")
        def on_participant_connected(participant: rtc.RemoteParticipant):
            logger.info(f"Participant connected: {participant.identity}")
        
        @ctx.room.on("participant_disconnected")
        def on_participant_disconnected(participant: rtc.RemoteParticipant):
            logger.info(f"Participant disconnected: {participant.identity}")
            participant_id = participant.identity
            self.participant_languages.pop(participant_id, None)
            self.translation_enabled.pop(participant_id, None)
            self.stop_translation_pipeline(participant_id)
        
        # Handle track subscriptions
        @ctx.room.on("track_subscribed")
        def on_track_subscribed(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
            logger.info(f"Subscribed to {track.kind} track from {participant.identity}")
            
            if track.kind == rtc.TrackKind.KIND_AUDIO:
                # Check if translation is enabled for this participant
                if self.translation_enabled.get(participant.identity):
                    target_language = self.participant_languages.get(participant.identity, 'en')
                    logger.info(f"Audio track subscribed for {participant.identity}, translation enabled -> {target_language}")
                    asyncio.create_task(
                        self.process_audio_track(ctx, track, participant.identity, target_language)
                    )
        
        logger.info("Translation Agent is running and listening for language preferences...")
        
        # Keep running until room disconnects
        while ctx.room.connection_state == rtc.ConnectionState.CONN_CONNECTED:
            await asyncio.sleep(1)
        
        logger.info("Room disconnected, shutting down agent")
    
    async def start_translation_pipeline(self, ctx: JobContext, participant_id: str, target_language: str):
        """Start translation pipeline for a participant"""
        # Find the participant's audio track
        participant = None
        for p in ctx.room.remote_participants.values():
            if p.identity == participant_id:
                participant = p
                break
        
        if not participant:
            logger.warning(f"Participant {participant_id} not found")
            return
        
        # Find audio track
        audio_track = None
        for publication in participant.track_publications.values():
            if publication.kind == rtc.TrackKind.KIND_AUDIO and publication.track:
                audio_track = publication.track
                break
        
        if audio_track:
            logger.info(f"Starting translation pipeline for {participant_id} -> {target_language}")
            await self.process_audio_track(ctx, audio_track, participant_id, target_language)
    
    async def process_audio_track(
        self, 
        ctx: JobContext, 
        track: rtc.Track, 
        participant_id: str,
        target_language: str
    ):
        """Process audio track: STT -> Translation -> TTS -> Publish"""
        logger.info(f"Processing audio track for {participant_id} -> {target_language}")
        
        if participant_id in self.translation_pipelines:
            logger.info(f"Translation pipeline already running for {participant_id}")
            return
        
        # Mark pipeline as active
        self.translation_pipelines[participant_id] = {
            'active': True,
            'target_language': target_language
        }
        
        try:
            # Create audio stream source
            audio_stream = agents.audio.AudioStream(track)
            
            # Process audio frames
            async for frame in audio_stream:
                if not self.translation_enabled.get(participant_id):
                    break
                
                # Here we would:
                # 1. Accumulate audio frames
                # 2. When we have enough (or detect silence), send to Whisper
                # 3. Get transcription
                # 4. Translate with GPT-4
                # 5. Convert to speech with TTS
                # 6. Publish translated audio
                
                # For now, log that we're receiving audio
                logger.debug(f"Received audio frame from {participant_id}")
                
        except Exception as e:
            logger.error(f"Error processing audio track: {e}", exc_info=True)
        finally:
            # Clean up
            self.translation_pipelines.pop(participant_id, None)
            logger.info(f"Stopped translation pipeline for {participant_id}")
    
    def stop_translation_pipeline(self, participant_id: str):
        """Stop translation pipeline for a participant"""
        if participant_id in self.translation_pipelines:
            self.translation_pipelines[participant_id]['active'] = False
            logger.info(f"Marked translation pipeline for {participant_id} as inactive")
    
    async def send_confirmation(self, ctx: JobContext, participant_id: str, language: str, enabled: bool):
        """Send confirmation back to participant"""
        message = json.dumps({
            "type": "language_confirmed",
            "language": language,
            "enabled": enabled,
            "participant_id": participant_id
        })
        
        try:
            await ctx.room.local_participant.publish_data(
                message.encode('utf-8'),
                reliable=True,
                topic="language_confirmation"
            )
            logger.info(f"Sent confirmation to {participant_id}")
        except Exception as e:
            logger.error(f"Failed to send confirmation: {e}")


async def main(ctx: JobContext):
    """Main entry point"""
    agent = OpenAITranslationAgent()
    await agent.entrypoint(ctx)


if __name__ == "__main__":
    # Run the agent
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=main,
            api_key=os.getenv('LIVEKIT_API_KEY'),
            api_secret=os.getenv('LIVEKIT_API_SECRET'),
            ws_url=os.getenv('LIVEKIT_URL', 'wss://jayme-rhmomj8r.livekit.cloud'),
        )
    )
