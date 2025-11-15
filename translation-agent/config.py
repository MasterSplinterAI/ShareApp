"""
Configuration for translation agent
"""
import os
from dotenv import load_dotenv

load_dotenv()

# OpenAI Configuration
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
OPENAI_MODEL = os.getenv('OPENAI_MODEL', 'gpt-realtime-2025-08-28')
OPENAI_VOICE = os.getenv('OPENAI_VOICE', 'alloy')

# VideoSDK Configuration
VIDEOSDK_AUTH_TOKEN = os.getenv('VIDEOSDK_AUTH_TOKEN')

# Translation Configuration
TRANSLATION_ENABLED = os.getenv('TRANSLATION_ENABLED', 'true').lower() == 'true'
DEFAULT_SOURCE_LANGUAGE = os.getenv('DEFAULT_SOURCE_LANGUAGE', 'auto')
DEFAULT_TARGET_LANGUAGE = os.getenv('DEFAULT_TARGET_LANGUAGE', 'en')

# Audio Processing
AUDIO_SAMPLE_RATE = 16000  # OpenAI requires 16kHz
AUDIO_CHANNELS = 1  # Mono

# Agent Configuration
AGENT_NAME = os.getenv('AGENT_NAME', 'Translation Agent')

