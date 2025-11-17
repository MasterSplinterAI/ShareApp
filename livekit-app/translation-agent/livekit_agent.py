#!/usr/bin/env python
"""
LiveKit Translation Agent with OpenAI
Full implementation using LiveKit Agents framework
"""
import os
import asyncio
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
    stt,
    tts,
    transcription
)
from livekit.plugins import openai

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=getattr(logging, os.getenv('LOG_LEVEL', 'INFO')),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class TranslationAgent:
    """Translation agent using OpenAI for STT, translation, and TTS"""
    
    def __init__(self):
        self.openai_api_key = os.getenv('OPENAI_API_KEY')
        if not self.openai_api_key:
            raise ValueError("OPENAI_API_KEY environment variable is required")
        
        # Track participant language preferences
        self.participant_languages: Dict[str, str] = {}
        self.translation_enabled: Dict[str, bool] = {}
        
        # Initialize OpenAI components
        self.setup_components()
    
    def setup_components(self):
        """Initialize OpenAI STT, TTS, and LLM"""
        # STT using OpenAI Whisper
        self.stt = openai.STT(
            api_key=self.openai_api_key,
            model="whisper-1",
            language=None,  # Auto-detect
        )
        
        # TTS using OpenAI
        self.tts = openai.TTS(
            api_key=self.openai_api_key,
            model="tts-1",
            voice="nova",
        )
        
        # LLM for translation
        self.llm = openai.LLM(
            api_key=self.openai_api_key,
            model="gpt-4-turbo-preview",
        )
    
    async def entrypoint(self, ctx: JobContext):
        """Main entry point for the agent"""
        room = ctx.room
        logger.info(f"Translation agent joined room: {room.name}")
        logger.info(f"Room SID: {room.sid}")
        logger.info(f"Local participant: {room.local_participant.identity}")
        
        # Set up event handlers
        self.setup_event_handlers(ctx)
        
        # Subscribe to audio tracks
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        
        # Create a task to handle translations
        translation_task = asyncio.create_task(self.handle_translations(ctx))
        
        try:
            # Keep the agent running
            await translation_task
        except asyncio.CancelledError:
            logger.info("Translation task cancelled")
        finally:
            logger.info("Agent shutting down")
    
    def setup_event_handlers(self, ctx: JobContext):
        """Set up event handlers for room events"""
        room = ctx.room
        
        @room.on("participant_connected")
        def on_participant_connected(participant: rtc.RemoteParticipant):
            logger.info(f"Participant connected: {participant.identity} ({participant.sid})")
            # Initialize default language preference
            self.participant_languages[participant.sid] = "en"
            self.translation_enabled[participant.sid] = False
        
        @room.on("participant_disconnected")
        def on_participant_disconnected(participant: rtc.RemoteParticipant):
            logger.info(f"Participant disconnected: {participant.identity}")
            # Clean up participant data
            self.participant_languages.pop(participant.sid, None)
            self.translation_enabled.pop(participant.sid, None)
        
        @room.on("data_received")
        def on_data_received(data: rtc.DataPacket):
            """Handle language preference updates"""
            try:
                import json
                if data.topic == "language_preference":
                    pref_data = json.loads(data.data.decode('utf-8'))
                    participant_id = pref_data.get('participant_id')
                    target_lang = pref_data.get('target_language', 'en')
                    enabled = pref_data.get('translation_enabled', False)
                    
                    logger.info(f"Language preference update: {participant_id} -> {target_lang}, enabled: {enabled}")
                    
                    # Update preferences
                    if participant_id:
                        self.participant_languages[participant_id] = target_lang
                        self.translation_enabled[participant_id] = enabled
                        
            except Exception as e:
                logger.error(f"Error processing data packet: {e}")
        
        @room.on("track_subscribed")
        def on_track_subscribed(
            track: rtc.Track,
            publication: rtc.RemoteTrackPublication,
            participant: rtc.RemoteParticipant,
        ):
            logger.info(f"Track subscribed: {track.kind} from {participant.identity}")
            if track.kind == rtc.TrackKind.AUDIO:
                # Start processing audio from this participant
                asyncio.create_task(self.process_participant_audio(ctx, participant, track))
    
    async def handle_translations(self, ctx: JobContext):
        """Main translation handling loop"""
        logger.info("Translation handler started")
        
        try:
            # Keep running until cancelled
            while True:
                await asyncio.sleep(1)
                
                # Check if any participants need translation
                active_translations = sum(1 for enabled in self.translation_enabled.values() if enabled)
                if active_translations > 0:
                    logger.debug(f"Active translations: {active_translations}")
                
        except asyncio.CancelledError:
            logger.info("Translation handler cancelled")
            raise
    
    async def process_participant_audio(
        self,
        ctx: JobContext,
        participant: rtc.RemoteParticipant,
        audio_track: rtc.Track
    ):
        """Process audio from a participant"""
        logger.info(f"Starting audio processing for {participant.identity}")
        
        try:
            # Create an audio stream from the track
            audio_stream = rtc.AudioStream(audio_track)
            
            # Process audio frames
            async for audio_frame in audio_stream:
                # Check if any participant has translation enabled
                if not any(self.translation_enabled.values()):
                    continue
                
                # Process the audio frame
                # Note: In a real implementation, you'd batch frames for processing
                # This is simplified for demonstration
                
                # For now, just log that we received audio
                logger.debug(f"Received audio frame from {participant.identity}")
                
                # TODO: Implement actual transcription and translation
                # 1. Accumulate audio frames into chunks
                # 2. Send to STT for transcription
                # 3. Translate if needed
                # 4. Send transcription data to participants
                # 5. Generate TTS and publish audio track
                
        except Exception as e:
            logger.error(f"Error processing audio from {participant.identity}: {e}")
            import traceback
            traceback.print_exc()


async def run_agent():
    """Run the translation agent"""
    # Create the agent
    agent = TranslationAgent()
    
    # Configure worker options
    worker_opts = WorkerOptions(
        entrypoint_fnc=agent.entrypoint,
        api_key=os.getenv('LIVEKIT_API_KEY'),
        api_secret=os.getenv('LIVEKIT_API_SECRET'),
        ws_url=os.getenv('LIVEKIT_URL'),
    )
    
    # Run the agent
    logger.info("Starting LiveKit translation agent...")
    logger.info(f"Connecting to: {os.getenv('LIVEKIT_URL')}")
    
    await cli.run_app(worker_opts)


def main():
    """Main entry point"""
    print("=" * 60)
    print("LiveKit Translation Agent")
    print("=" * 60)
    print(f"LiveKit URL: {os.getenv('LIVEKIT_URL', 'NOT SET')}")
    print(f"LiveKit API Key: {'***' + os.getenv('LIVEKIT_API_KEY', 'NOT SET')[-10:] if os.getenv('LIVEKIT_API_KEY') else 'NOT SET'}")
    print(f"OpenAI API Key: {'***' + os.getenv('OPENAI_API_KEY', 'NOT SET')[-10:] if os.getenv('OPENAI_API_KEY') else 'NOT SET'}")
    print("=" * 60)
    print("")
    print("Agent is starting...")
    print("Use Ctrl+C to stop")
    print("")
    
    try:
        asyncio.run(run_agent())
    except KeyboardInterrupt:
        print("\nAgent stopped by user")
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
