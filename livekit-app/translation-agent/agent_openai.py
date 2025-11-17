"""
LiveKit Translation Agent using OpenAI
Simplified version using only OpenAI API for all translation needs
"""
import os
import asyncio
import logging
import json
from typing import Dict, Optional
from dataclasses import dataclass
from dotenv import load_dotenv

from livekit import rtc
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
)
from livekit.plugins import openai
import numpy as np

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
    target_language: str = "en"
    translation_enabled: bool = False


class OpenAITranslationAgent:
    """Translation agent using OpenAI for STT, translation, and TTS"""
    
    def __init__(self):
        self.participant_languages: Dict[str, ParticipantLanguage] = {}
        self.openai_api_key = os.getenv('OPENAI_API_KEY')
        
        if not self.openai_api_key:
            raise ValueError("OPENAI_API_KEY environment variable is required")
        
        # Initialize OpenAI STT (Whisper)
        self.stt = openai.STT(
            api_key=self.openai_api_key,
            model="whisper-1",
            language="en",  # Auto-detect if not specified
        )
        
        # Initialize OpenAI TTS
        self.tts = openai.TTS(
            api_key=self.openai_api_key,
            model="tts-1",
            voice="nova",  # Natural voice
        )
        
    async def entrypoint(self, ctx: JobContext):
        """Main entry point for the agent"""
        logger.info(f"OpenAI Translation agent started for room: {ctx.room.name}")
        
        # Connect to the room
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        
        # Monitor room events
        @ctx.room.on("participant_connected")
        def on_participant_connected(participant: rtc.RemoteParticipant):
            logger.info(f"Participant connected: {participant.identity}")
            # Initialize language preferences for new participant
            self.participant_languages[participant.identity] = ParticipantLanguage(
                participant_id=participant.identity,
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
        
        # Create audio stream for this participant
        audio_stream = rtc.AudioStream(audio_track)
        
        async for audio_frame in audio_stream:
            # Check if translation is enabled for any participant
            needs_processing = False
            for lang_pref in self.participant_languages.values():
                if lang_pref.translation_enabled:
                    needs_processing = True
                    break
            
            if not needs_processing:
                continue
            
            try:
                # Convert audio frame to format suitable for OpenAI
                audio_data = np.frombuffer(audio_frame.data, dtype=np.int16)
                
                # Process with OpenAI Whisper for transcription
                transcript = await self._transcribe_audio(audio_data)
                
                if transcript:
                    # Send transcription to all participants who need it
                    for other_participant_id, lang_pref in self.participant_languages.items():
                        if lang_pref.translation_enabled:
                            # Translate if needed
                            if lang_pref.target_language != 'en':
                                translated_text = await self._translate_text(
                                    transcript, 
                                    'en', 
                                    lang_pref.target_language
                                )
                            else:
                                translated_text = transcript
                            
                            # Send transcription via data channel
                            await self._send_transcription(
                                ctx,
                                other_participant_id,
                                participant.identity,
                                transcript,
                                translated_text
                            )
                            
                            # Generate TTS audio if languages differ
                            if lang_pref.target_language != 'en':
                                audio_output = await self._generate_speech(translated_text)
                                if audio_output:
                                    await self._publish_audio(ctx, audio_output, other_participant_id)
                
            except Exception as e:
                logger.error(f"Error processing audio: {e}")
    
    async def _transcribe_audio(self, audio_data: np.ndarray) -> Optional[str]:
        """Transcribe audio using OpenAI Whisper"""
        try:
            # Convert numpy array to bytes for OpenAI API
            audio_bytes = audio_data.tobytes()
            
            # Call OpenAI Whisper API
            # Note: This is a simplified example - you'd need to batch audio appropriately
            response = await self.stt.recognize(audio_bytes)
            
            return response.text if response else None
        except Exception as e:
            logger.error(f"Transcription error: {e}")
            return None
    
    async def _translate_text(self, text: str, source_lang: str, target_lang: str) -> str:
        """Translate text using OpenAI GPT"""
        try:
            import openai
            client = openai.AsyncOpenAI(api_key=self.openai_api_key)
            
            # Map language codes to full names for better translation
            lang_names = {
                'es': 'Spanish', 'fr': 'French', 'de': 'German',
                'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian',
                'zh': 'Chinese', 'ja': 'Japanese', 'ko': 'Korean',
                'ar': 'Arabic', 'hi': 'Hindi'
            }
            
            target_lang_name = lang_names.get(target_lang, target_lang)
            
            response = await client.chat.completions.create(
                model="gpt-4-turbo-preview",
                messages=[
                    {
                        "role": "system",
                        "content": f"You are a translator. Translate the following text to {target_lang_name}. "
                                  "Only provide the translation, no explanations."
                    },
                    {
                        "role": "user",
                        "content": text
                    }
                ],
                temperature=0.3,
                max_tokens=500
            )
            
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"Translation error: {e}")
            return text
    
    async def _generate_speech(self, text: str) -> Optional[bytes]:
        """Generate speech using OpenAI TTS"""
        try:
            audio_data = await self.tts.synthesize(text)
            return audio_data
        except Exception as e:
            logger.error(f"TTS error: {e}")
            return None
    
    async def _send_transcription(
        self,
        ctx: JobContext,
        recipient_id: str,
        speaker_id: str,
        original_text: str,
        translated_text: str
    ):
        """Send transcription via data channel"""
        try:
            data = {
                "type": "transcription",
                "participantId": recipient_id,
                "speakerId": speaker_id,
                "originalText": original_text,
                "translatedText": translated_text,
                "timestamp": int(asyncio.get_event_loop().time() * 1000)
            }
            
            encoded_data = json.dumps(data).encode('utf-8')
            await ctx.room.local_participant.publish_data(
                encoded_data,
                reliable=True,
                topic="transcription"
            )
        except Exception as e:
            logger.error(f"Error sending transcription: {e}")
    
    async def _publish_audio(self, ctx: JobContext, audio_data: bytes, target_participant: str):
        """Publish translated audio to specific participant"""
        try:
            # Convert audio to appropriate format and publish
            # This would create an audio track for the translated audio
            # Implementation depends on LiveKit's audio track publishing API
            pass  # Simplified for example
        except Exception as e:
            logger.error(f"Error publishing audio: {e}")


async def main():
    """Main entry point"""
    # Configure and run the agent worker
    agent = OpenAITranslationAgent()
    worker = WorkerOptions(
        entrypoint_fnc=agent.entrypoint,
        api_key=os.getenv('LIVEKIT_API_KEY'),
        api_secret=os.getenv('LIVEKIT_API_SECRET'),
        ws_url=os.getenv('LIVEKIT_URL'),
    )
    
    # Run the agent
    await cli.run_app(worker)


if __name__ == "__main__":
    asyncio.run(main()
