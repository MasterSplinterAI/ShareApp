"""
Translation Pipeline for LiveKit Agent
Handles STT -> Translation -> TTS pipeline with multiple provider support
"""
import os
import asyncio
import logging
from typing import Optional, Dict, Any
from abc import ABC, abstractmethod

from google.cloud import translate_v2 as translate
from deepgram import DeepgramClient, PrerecordedOptions, LiveOptions
import elevenlabs

logger = logging.getLogger(__name__)


class TranslationProvider(ABC):
    """Abstract base class for translation providers"""
    
    @abstractmethod
    async def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        """Translate text from source to target language"""
        pass


class GoogleTranslateProvider(TranslationProvider):
    """Google Cloud Translation provider"""
    
    def __init__(self):
        # Initialize the Google Translate client
        # Requires GOOGLE_APPLICATION_CREDENTIALS env var
        self.client = translate.Client()
    
    async def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        """Translate using Google Cloud Translation API"""
        try:
            # Skip if source and target are the same
            if source_lang == target_lang:
                return text
            
            # Translate the text
            result = self.client.translate(
                text,
                source_language=source_lang if source_lang != 'auto' else None,
                target_language=target_lang
            )
            
            return result['translatedText']
        except Exception as e:
            logger.error(f"Google translation error: {e}")
            return text  # Return original on error


class OpenAITranslateProvider(TranslationProvider):
    """OpenAI-based translation provider (fallback)"""
    
    def __init__(self, api_key: str):
        import openai
        self.client = openai.AsyncOpenAI(api_key=api_key)
    
    async def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        """Translate using OpenAI GPT"""
        try:
            if source_lang == target_lang:
                return text
            
            response = await self.client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {
                        "role": "system",
                        "content": f"Translate the following text from {source_lang} to {target_lang}. "
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
            logger.error(f"OpenAI translation error: {e}")
            return text


class TranslationPipeline:
    """
    Complete translation pipeline handling:
    Audio -> STT -> Translation -> TTS -> Audio
    """
    
    def __init__(self):
        # Initialize providers based on available credentials
        self.translation_provider = self._init_translation_provider()
        self.deepgram_client = None
        self.elevenlabs_client = None
        
        # Initialize STT
        if os.getenv('DEEPGRAM_API_KEY'):
            self.deepgram_client = DeepgramClient(os.getenv('DEEPGRAM_API_KEY'))
        
        # Initialize TTS
        if os.getenv('ELEVENLABS_API_KEY'):
            elevenlabs.set_api_key(os.getenv('ELEVENLABS_API_KEY'))
    
    def _init_translation_provider(self) -> Optional[TranslationProvider]:
        """Initialize the best available translation provider"""
        # Try Google Translate first
        if os.getenv('GOOGLE_APPLICATION_CREDENTIALS'):
            try:
                return GoogleTranslateProvider()
            except Exception as e:
                logger.warning(f"Failed to initialize Google Translate: {e}")
        
        # Fall back to OpenAI
        if os.getenv('OPENAI_API_KEY'):
            return OpenAITranslateProvider(os.getenv('OPENAI_API_KEY'))
        
        logger.error("No translation provider available!")
        return None
    
    async def transcribe_audio(
        self, 
        audio_data: bytes, 
        sample_rate: int = 16000,
        language: str = "en"
    ) -> Optional[str]:
        """Transcribe audio to text using Deepgram"""
        if not self.deepgram_client:
            logger.error("Deepgram client not initialized")
            return None
        
        try:
            options = PrerecordedOptions(
                model="nova-2",
                language=language,
                smart_format=True,
            )
            
            # Transcribe the audio
            response = await self.deepgram_client.transcription.prerecorded.v1(
                {"buffer": audio_data, "mimetype": "audio/wav"},
                options
            )
            
            # Extract transcript
            transcript = response.results.channels[0].alternatives[0].transcript
            return transcript.strip() if transcript else None
            
        except Exception as e:
            logger.error(f"Transcription error: {e}")
            return None
    
    async def translate_text(
        self,
        text: str,
        source_lang: str = "auto",
        target_lang: str = "en"
    ) -> str:
        """Translate text to target language"""
        if not self.translation_provider:
            return text
        
        return await self.translation_provider.translate(text, source_lang, target_lang)
    
    async def synthesize_speech(
        self,
        text: str,
        voice: str = "rachel",
        language_code: Optional[str] = None
    ) -> Optional[bytes]:
        """Convert text to speech using ElevenLabs"""
        if not os.getenv('ELEVENLABS_API_KEY'):
            logger.error("ElevenLabs API key not set")
            return None
        
        try:
            # Select appropriate voice based on language if needed
            voice_id = self._get_voice_for_language(language_code) or voice
            
            # Generate audio
            audio = elevenlabs.generate(
                text=text,
                voice=voice_id,
                model="eleven_monolingual_v1"
            )
            
            # Convert generator to bytes
            audio_bytes = b''.join(audio)
            return audio_bytes
            
        except Exception as e:
            logger.error(f"TTS synthesis error: {e}")
            return None
    
    def _get_voice_for_language(self, language_code: Optional[str]) -> Optional[str]:
        """Select appropriate voice based on target language"""
        # Map language codes to ElevenLabs voice IDs
        voice_map = {
            "es": "arnold",   # Spanish voice
            "fr": "domi",     # French voice
            "de": "marcus",   # German voice
            "it": "giovanni", # Italian voice
            # Add more mappings as needed
        }
        
        return voice_map.get(language_code) if language_code else None
    
    async def process_audio_chunk(
        self,
        audio_data: bytes,
        source_lang: str = "auto",
        target_lang: str = "en",
        sample_rate: int = 16000
    ) -> Optional[Dict[str, Any]]:
        """
        Process a complete audio chunk through the pipeline
        Returns dict with transcript, translation, and audio
        """
        result = {
            "transcript": None,
            "translation": None,
            "audio": None
        }
        
        # Step 1: Transcribe
        transcript = await self.transcribe_audio(audio_data, sample_rate, source_lang)
        if not transcript:
            return result
        
        result["transcript"] = transcript
        logger.info(f"Transcribed: {transcript}")
        
        # Step 2: Translate (skip if same language)
        if source_lang != target_lang:
            translation = await self.translate_text(transcript, source_lang, target_lang)
            result["translation"] = translation
            logger.info(f"Translated: {translation}")
        else:
            result["translation"] = transcript
        
        # Step 3: Synthesize speech
        audio_output = await self.synthesize_speech(
            result["translation"],
            language_code=target_lang
        )
        result["audio"] = audio_output
        
        return result


# Utility function to create pipeline
def create_translation_pipeline() -> TranslationPipeline:
    """Create and return a configured translation pipeline"""
    return TranslationPipeline()
