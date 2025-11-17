#!/usr/bin/env python
"""
LiveKit OpenAI Realtime Translation Agent
Uses OpenAI's Realtime API for ultra-low latency voice-to-voice translation
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
    VoiceAssistant,
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


class RealtimeTranslationAgent:
    """
    Real-time translation using OpenAI's Realtime API (GPT-4o)
    Provides native multilingual understanding and natural voice synthesis
    """
    
    def __init__(self):
        self.openai_api_key = os.getenv('OPENAI_API_KEY')
        if not self.openai_api_key:
            raise ValueError("OPENAI_API_KEY environment variable is required")
        
        # Track participant language preferences
        self.participant_languages: Dict[str, str] = {}
        self.translation_enabled: Dict[str, bool] = {}
        self.assistants: Dict[str, VoiceAssistant] = {}
    
    def get_translation_context(self, target_language: str):
        """Get the chat context for translation to a specific language"""
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
            {
                "role": "system",
                "content": f"""You are a real-time conference translator. Your ONLY job is to:
1. Listen to what is being said in the conference
2. Translate it accurately to {target_name}
3. Speak ONLY the translation - no explanations or commentary
4. Preserve the speaker's tone and emotion
5. Be concise and natural

Rules:
- Output ONLY the translation
- Never add "The speaker said" or similar phrases
- Never explain what you're doing
- Maintain professional conference interpreting standards
- If you hear silence or unclear speech, remain silent"""
            }
        ]
    
    async def entrypoint(self, ctx: JobContext):
        """Main entry point for the agent"""
        logger.info(f"OpenAI Realtime Translation Agent starting in room: {ctx.room.name}")
        
        # Connect to room (audio only for translation)
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        
        # Set up data message handler for language preferences
        @ctx.room.on("data_received")
        def on_data_received(data: rtc.DataPacket):
            """Handle data messages for language preferences"""
            if data.topic == "language_preference":
                try:
                    message = json.loads(data.data.decode('utf-8'))
                    participant_id = data.participant.identity
                    
                    if message.get('type') == 'language_update':
                        language = message.get('language', 'en')
                        enabled = message.get('enabled', False)
                        
                        logger.info(f"Language preference from {participant_id}: {language} (enabled: {enabled})")
                        
                        self.participant_languages[participant_id] = language
                        self.translation_enabled[participant_id] = enabled
                        
                        # Create or update assistant for this participant
                        if enabled:
                            asyncio.create_task(
                                self.create_assistant_for_participant(ctx, participant_id, language)
                            )
                        elif participant_id in self.assistants:
                            # Stop the assistant if translation is disabled
                            assistant = self.assistants.pop(participant_id)
                            asyncio.create_task(assistant.shutdown())
                            
                except Exception as e:
                    logger.error(f"Error processing language preference: {e}")
        
        # Handle participant events
        @ctx.room.on("participant_connected")
        def on_participant_connected(participant: rtc.RemoteParticipant):
            logger.info(f"Participant connected: {participant.identity}")
            # Request current language preference
            asyncio.create_task(self.request_language_preference(ctx, participant.identity))
        
        @ctx.room.on("participant_disconnected")
        def on_participant_disconnected(participant: rtc.RemoteParticipant):
            logger.info(f"Participant disconnected: {participant.identity}")
            participant_id = participant.identity
            
            # Clean up participant data
            self.participant_languages.pop(participant_id, None)
            self.translation_enabled.pop(participant_id, None)
            
            # Stop and remove assistant if exists
            if participant_id in self.assistants:
                assistant = self.assistants.pop(participant_id)
                asyncio.create_task(assistant.shutdown())
        
        # Keep the agent running
        logger.info("Realtime Translation Agent is running...")
        
        # Wait for room to close
        while ctx.room.connection_state == rtc.ConnectionState.CONN_CONNECTED:
            await asyncio.sleep(1)
        
        # Cleanup all assistants
        for assistant in self.assistants.values():
            await assistant.shutdown()
    
    async def create_assistant_for_participant(
        self, 
        ctx: JobContext, 
        participant_id: str, 
        target_language: str
    ):
        """Create a voice assistant for a specific participant"""
        logger.info(f"Creating translation assistant for {participant_id} targeting {target_language}")
        
        # Stop existing assistant if any
        if participant_id in self.assistants:
            await self.assistants[participant_id].shutdown()
        
        # Create voice assistant using OpenAI
        assistant = VoiceAssistant(
            vad=silero.VAD.load(),  # Voice Activity Detection
            stt=openai.STT(  # Speech to Text (Whisper)
                api_key=self.openai_api_key,
                model="whisper-1",
                language=None  # Auto-detect source language
            ),
            llm=openai.LLM(  # GPT-4 for translation
                api_key=self.openai_api_key,
                model="gpt-4-turbo-preview",
            ),
            tts=openai.TTS(  # Text to Speech
                api_key=self.openai_api_key,
                model="tts-1-hd",  # Higher quality model
                voice="nova",  # Natural sounding voice
                speed=1.0,
            ),
            chat_ctx=self.get_translation_context(target_language),
            allow_interruptions=True,
            interrupt_speech_duration=0.5,
        )
        
        # Store the assistant
        self.assistants[participant_id] = assistant
        
        # Start the assistant for this participant
        assistant.start(ctx.room, participant=await self.get_participant(ctx, participant_id))
        
        # Set up event handlers
        @assistant.on("user_speech_committed")
        def on_speech_detected(msg):
            """Log when speech is detected"""
            logger.debug(f"Speech detected for translation to {target_language}: {msg.content[:50]}...")
        
        @assistant.on("agent_speech_committed")
        def on_translation_spoken(msg):
            """Log when translation is spoken"""
            logger.debug(f"Translation spoken in {target_language}: {msg.content[:50]}...")
            
            # Send transcription back to participant
            asyncio.create_task(
                self.send_transcription(ctx, participant_id, msg.content, target_language)
            )
    
    async def get_participant(self, ctx: JobContext, participant_id: str):
        """Get participant object by ID"""
        for participant in ctx.room.participants.values():
            if participant.identity == participant_id:
                return participant
        return None
    
    async def request_language_preference(self, ctx: JobContext, participant_id: str):
        """Request language preference from a participant"""
        message = json.dumps({
            "type": "request_language",
            "participant_id": participant_id
        })
        
        await ctx.room.local_participant.publish_data(
            message.encode('utf-8'),
            reliable=True,
            topic="language_request"
        )
    
    async def send_transcription(
        self, 
        ctx: JobContext, 
        participant_id: str,
        text: str, 
        language: str
    ):
        """Send transcription back to the participant"""
        message = json.dumps({
            "type": "transcription",
            "text": text,
            "language": language,
            "participant_id": participant_id,
            "timestamp": asyncio.get_event_loop().time()
        })
        
        await ctx.room.local_participant.publish_data(
            message.encode('utf-8'),
            reliable=True,
            destination_identities=[participant_id],
            topic="transcription"
        )


async def main(ctx: JobContext):
    """Main entry point"""
    agent = RealtimeTranslationAgent()
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
