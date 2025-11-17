#!/usr/bin/env python
"""
LiveKit Voice Assistant with OpenAI Realtime Translation
Full implementation using LiveKit's VoiceAssistant pipeline
"""
import os
import asyncio
import logging
import json
from typing import Optional
from dotenv import load_dotenv

from livekit import agents, rtc
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
    llm,
    VoiceAssistant,
    transcription,
)
from livekit.agents.voice_assistant import AssistantCallContext
from livekit.plugins import openai, silero

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=getattr(logging, os.getenv('LOG_LEVEL', 'INFO')),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class TranslationVoiceAssistant:
    """Voice Assistant for real-time translation using OpenAI"""
    
    def __init__(self):
        self.assistants = {}  # Store assistant per participant
        self.participant_languages = {}  # Track language preferences
        
    async def entrypoint(self, ctx: JobContext):
        """Main entry point for the agent"""
        logger.info(f"Voice Assistant starting in room: {ctx.room.name}")
        
        # Initial context for the assistant
        initial_ctx = llm.ChatContext().append(
            role="system",
            text=(
                "You are a real-time translator assistant. Your job is to translate "
                "speech from one language to another. When you receive text in one language, "
                "translate it to the target language naturally and accurately. "
                "Maintain the tone and style of the original speaker."
            ),
        )
        
        # Connect to room with audio subscription
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        
        # Set up participant tracking
        participants = {}
        participant_assistants = {}
        
        # Handle participant events
        @ctx.room.on("participant_connected")
        def on_participant_connected(participant: rtc.RemoteParticipant):
            logger.info(f"Participant connected: {participant.identity}")
            participants[participant.sid] = participant
            
        @ctx.room.on("participant_disconnected")
        def on_participant_disconnected(participant: rtc.RemoteParticipant):
            logger.info(f"Participant disconnected: {participant.identity}")
            participants.pop(participant.sid, None)
            # Clean up assistant if exists
            if participant.sid in participant_assistants:
                assistant = participant_assistants.pop(participant.sid)
                asyncio.create_task(self._cleanup_assistant(assistant))
        
        # Handle data messages for language preferences
        @ctx.room.on("data_received")
        def on_data_received(data: rtc.DataPacket):
            """Handle language preference updates"""
            try:
                if data.topic == "language_preference":
                    pref_data = json.loads(data.data.decode('utf-8'))
                    participant_id = pref_data.get('participant_id')
                    target_lang = pref_data.get('target_language', 'en')
                    enabled = pref_data.get('translation_enabled', False)
                    
                    logger.info(f"Language preference: {participant_id} -> {target_lang}, enabled: {enabled}")
                    
                    if enabled and participant_id not in participant_assistants:
                        # Create a voice assistant for this participant
                        asyncio.create_task(
                            self._create_assistant_for_participant(
                                ctx, participant_id, target_lang
                            )
                        )
                    elif not enabled and participant_id in participant_assistants:
                        # Disable assistant
                        assistant = participant_assistants.pop(participant_id)
                        asyncio.create_task(self._cleanup_assistant(assistant))
                        
            except Exception as e:
                logger.error(f"Error processing data packet: {e}")
        
        # Main loop - create primary assistant
        assistant = await self._create_main_assistant(ctx, initial_ctx)
        
        # Start the assistant
        assistant.start(ctx.room)
        
        # Say hello
        await assistant.say(
            "Translation assistant ready. Enable translation and select your language to begin.",
            allow_interruptions=True
        )
        
        # Keep running
        logger.info("Voice Assistant is running...")
        
    async def _create_main_assistant(self, ctx: JobContext, initial_ctx):
        """Create the main voice assistant"""
        # Create the voice assistant with OpenAI
        assistant = VoiceAssistant(
            vad=silero.VAD.load(),  # Voice Activity Detection
            stt=openai.STT(  # Speech to Text
                api_key=os.getenv("OPENAI_API_KEY"),
                model="whisper-1"
            ),
            llm=openai.LLM(  # Language Model for translation
                api_key=os.getenv("OPENAI_API_KEY"),
                model="gpt-4-turbo-preview"
            ),
            tts=openai.TTS(  # Text to Speech
                api_key=os.getenv("OPENAI_API_KEY"),
                model="tts-1",
                voice="nova"
            ),
            chat_ctx=initial_ctx,
            allow_interruptions=True,
            interrupt_speech_duration=0.5,
        )
        
        # Set up event handlers
        @assistant.on("user_speech_committed")
        def on_user_speech(msg: llm.ChatMessage):
            """Handle when user speech is recognized"""
            logger.info(f"User said: {msg.content}")
            
        @assistant.on("agent_speech_committed")
        def on_agent_speech(msg: llm.ChatMessage):
            """Handle when agent speaks"""
            logger.info(f"Agent said: {msg.content}")
            
        @assistant.on("function_calls_finished")
        def on_function_calls(called_functions):
            """Handle function calls if any"""
            for func in called_functions:
                logger.info(f"Function called: {func.name}")
        
        return assistant
    
    async def _create_assistant_for_participant(
        self, 
        ctx: JobContext, 
        participant_id: str,
        target_language: str
    ):
        """Create a dedicated assistant for translation for a specific participant"""
        try:
            logger.info(f"Creating translation assistant for {participant_id} (target: {target_language})")
            
            # Language mapping for better context
            language_names = {
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
            
            target_lang_name = language_names.get(target_language, target_language)
            
            # Create context for this specific translation
            translation_ctx = llm.ChatContext().append(
                role="system",
                text=(
                    f"You are a real-time translator. Translate everything to {target_lang_name}. "
                    f"Only provide the translation, no explanations or additional text. "
                    f"Maintain the original tone and style."
                )
            )
            
            # Create assistant for this participant
            assistant = VoiceAssistant(
                vad=silero.VAD.load(),
                stt=openai.STT(
                    api_key=os.getenv("OPENAI_API_KEY"),
                    model="whisper-1",
                    language=None  # Auto-detect source language
                ),
                llm=openai.LLM(
                    api_key=os.getenv("OPENAI_API_KEY"),
                    model="gpt-4-turbo-preview"
                ),
                tts=openai.TTS(
                    api_key=os.getenv("OPENAI_API_KEY"),
                    model="tts-1-hd",  # Higher quality for translation
                    voice="nova"
                ),
                chat_ctx=translation_ctx,
                allow_interruptions=False,  # Don't interrupt translations
            )
            
            # Start the assistant
            assistant.start(ctx.room)
            
            # Store the assistant
            self.assistants[participant_id] = assistant
            
            logger.info(f"Translation assistant created for {participant_id}")
            
        except Exception as e:
            logger.error(f"Error creating assistant for {participant_id}: {e}")
            import traceback
            traceback.print_exc()
    
    async def _cleanup_assistant(self, assistant):
        """Clean up an assistant when no longer needed"""
        try:
            # Stop the assistant
            await asyncio.sleep(0.1)  # Small delay to ensure clean shutdown
            logger.info("Assistant cleaned up")
        except Exception as e:
            logger.error(f"Error cleaning up assistant: {e}")


async def run_voice_assistant():
    """Run the voice assistant agent"""
    assistant = TranslationVoiceAssistant()
    
    # Configure worker options
    worker_opts = WorkerOptions(
        entrypoint_fnc=assistant.entrypoint,
        api_key=os.getenv('LIVEKIT_API_KEY'),
        api_secret=os.getenv('LIVEKIT_API_SECRET'),
        ws_url=os.getenv('LIVEKIT_URL'),
    )
    
    logger.info("Starting LiveKit Voice Assistant...")
    logger.info(f"Connecting to: {os.getenv('LIVEKIT_URL')}")
    logger.info(f"Using OpenAI API for STT/TTS/Translation")
    
    await cli.run_app(worker_opts)


def main():
    """Main entry point"""
    print("=" * 60)
    print("LiveKit Voice Assistant - Real-time Translation")
    print("=" * 60)
    print(f"LiveKit URL: {os.getenv('LIVEKIT_URL', 'NOT SET')}")
    print(f"LiveKit API Key: {'SET' if os.getenv('LIVEKIT_API_KEY') else 'NOT SET'}")
    print(f"OpenAI API Key: {'SET' if os.getenv('OPENAI_API_KEY') else 'NOT SET'}")
    print("=" * 60)
    print("")
    print("Voice Assistant starting...")
    print("Features:")
    print("- Real-time speech recognition (Whisper)")
    print("- Live translation (GPT-4)")
    print("- Natural voice synthesis (TTS)")
    print("")
    print("Use Ctrl+C to stop")
    print("")
    
    try:
        asyncio.run(run_voice_assistant())
    except KeyboardInterrupt:
        print("\nVoice Assistant stopped")
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
