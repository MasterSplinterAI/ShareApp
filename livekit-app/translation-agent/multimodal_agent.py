#!/usr/bin/env python
"""
LiveKit Multimodal Agent with OpenAI Realtime API (GPT-4o)
Full implementation for real-time translation using OpenAI's latest capabilities
"""
import os
import asyncio
import logging
import json
from typing import Optional, Annotated
from dotenv import load_dotenv

from livekit import agents, rtc
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
    llm,
    multimodal,
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


class TranslationSession:
    """Manages a translation session for participants"""
    
    def __init__(self, room: rtc.Room):
        self.room = room
        self.participant_languages = {}
        self.translation_enabled = {}
        self.sessions = {}
    
    async def update_language_preference(self, participant_id: str, language: str, enabled: bool):
        """Update language preference for a participant"""
        self.participant_languages[participant_id] = language
        self.translation_enabled[participant_id] = enabled
        logger.info(f"Updated language for {participant_id}: {language} (enabled: {enabled})")


async def entrypoint(ctx: JobContext):
    """Main entry point for the multimodal agent"""
    logger.info(f"Multimodal Translation Agent starting in room: {ctx.room.name}")
    
    # Connect to room
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    
    # Create translation session manager
    session = TranslationSession(ctx.room)
    
    # Get participant that triggered this job (if any)
    participant = ctx.initial_participant
    
    # Configure the multimodal model
    model = openai.realtime.RealtimeModel(
        instructions=(
            "You are a real-time translator assistant. Your primary job is to: "
            "1. Listen to speech in any language "
            "2. Translate it to the participant's preferred language "
            "3. Speak the translation naturally and clearly "
            "4. Maintain the original tone and emotion "
            "5. Be concise and accurate "
            "Do not add explanations or commentary unless asked."
        ),
        voice="nova",  # Can be: alloy, echo, nova
        temperature=0.3,  # Lower temperature for more accurate translations
        turn_detection=openai.realtime.ServerVadOptions(
            threshold=0.5,
            prefix_padding_ms=300,
            silence_duration_ms=500,
        ),
        modalities=["text", "audio"],  # Support both text and audio
    )
    
    # Create multimodal assistant
    assistant = multimodal.MultimodalAgent(model=model)
    
    # Register function for language updates
    @assistant.ai_callable()
    async def set_translation_language(
        language: Annotated[
            str,
            llm.TypeInfo(
                description="The target language for translation (e.g., 'Spanish', 'French', 'Chinese')"
            ),
        ],
    ):
        """Set the target language for translation"""
        if participant:
            await session.update_language_preference(
                participant.identity,
                language,
                True
            )
            return f"Translation language set to {language}"
        return "No participant to set language for"
    
    @assistant.ai_callable()
    async def get_current_language() -> str:
        """Get the current target language"""
        if participant and participant.identity in session.participant_languages:
            return session.participant_languages[participant.identity]
        return "English (default)"
    
    # Handle data channel messages
    @ctx.room.on("data_received")
    def on_data_received(data: rtc.DataPacket):
        """Handle language preference updates from frontend"""
        try:
            if data.topic == "language_preference":
                pref_data = json.loads(data.data.decode('utf-8'))
                participant_id = pref_data.get('participant_id')
                target_lang = pref_data.get('target_language', 'en')
                enabled = pref_data.get('translation_enabled', False)
                
                # Map language codes to full names
                language_map = {
                    'en': 'English',
                    'es': 'Spanish',
                    'fr': 'French',
                    'de': 'German',
                    'it': 'Italian',
                    'pt': 'Portuguese',
                    'zh': 'Chinese',
                    'ja': 'Japanese',
                    'ko': 'Korean',
                    'ar': 'Arabic',
                    'hi': 'Hindi',
                    'ru': 'Russian'
                }
                
                target_language = language_map.get(target_lang, target_lang)
                
                # Update session
                asyncio.create_task(
                    session.update_language_preference(
                        participant_id,
                        target_language,
                        enabled
                    )
                )
                
                # Update model instructions for this participant's language
                if enabled:
                    new_instructions = (
                        f"You are a real-time translator. "
                        f"Translate everything you hear to {target_language}. "
                        f"Speak the translation naturally in {target_language}. "
                        f"Do not add any explanations, just translate."
                    )
                    model.instructions = new_instructions
                    logger.info(f"Updated translation target to {target_language}")
                    
        except Exception as e:
            logger.error(f"Error processing data packet: {e}")
    
    # Handle participant events
    @ctx.room.on("participant_connected")
    def on_participant_connected(p: rtc.RemoteParticipant):
        logger.info(f"Participant connected: {p.identity}")
        # Send a greeting when someone joins
        if assistant._started:
            asyncio.create_task(
                assistant.say(
                    f"Welcome! I'm your translation assistant. "
                    f"Enable translation and select your language to begin.",
                    allow_interruptions=True
                )
            )
    
    @ctx.room.on("participant_disconnected")
    def on_participant_disconnected(p: rtc.RemoteParticipant):
        logger.info(f"Participant disconnected: {p.identity}")
        # Clean up language preferences
        session.participant_languages.pop(p.identity, None)
        session.translation_enabled.pop(p.identity, None)
    
    # Start the assistant
    assistant.start(ctx.room, participant)
    
    # Initial greeting
    await assistant.say(
        "Translation assistant ready. Enable translation in your settings to begin.",
        allow_interruptions=True
    )
    
    logger.info("Multimodal Translation Agent is running...")


def main():
    """Main entry point"""
    print("=" * 60)
    print("LiveKit Multimodal Translation Agent")
    print("Using OpenAI Realtime API (GPT-4o)")
    print("=" * 60)
    print(f"LiveKit URL: {os.getenv('LIVEKIT_URL', 'NOT SET')}")
    print(f"LiveKit API Key: {'SET' if os.getenv('LIVEKIT_API_KEY') else 'NOT SET'}")
    print(f"OpenAI API Key: {'SET' if os.getenv('OPENAI_API_KEY') else 'NOT SET'}")
    print("=" * 60)
    print("")
    print("Features:")
    print("- OpenAI Realtime API (GPT-4o) for ultra-low latency")
    print("- Native multilingual understanding")
    print("- Natural voice synthesis")
    print("- Real-time translation")
    print("")
    print("Starting agent...")
    print("Use Ctrl+C to stop")
    print("")
    
    # Configure worker
    worker_opts = WorkerOptions(
        entrypoint_fnc=entrypoint,
        api_key=os.getenv('LIVEKIT_API_KEY'),
        api_secret=os.getenv('LIVEKIT_API_SECRET'),
        ws_url=os.getenv('LIVEKIT_URL'),
    )
    
    try:
        asyncio.run(cli.run_app(worker_opts))
    except KeyboardInterrupt:
        print("\nAgent stopped")
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
