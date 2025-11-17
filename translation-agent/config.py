"""
Configuration for translation agent
"""
import os
from dotenv import load_dotenv

# Load .env file but don't override existing environment variables
# This ensures env vars passed by parent process (backend) are preserved
load_dotenv(override=False)

# OpenAI Configuration
# Prefer environment variable (passed by backend) over .env file
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
OPENAI_MODEL = os.getenv('OPENAI_MODEL', 'gpt-4o-realtime-preview-2024-10-01')
OPENAI_VOICE = os.getenv('OPENAI_VOICE', 'alloy')

# Daily.co Configuration
DAILY_ROOM_URL = os.getenv('DAILY_ROOM_URL')
DAILY_TOKEN = os.getenv('DAILY_TOKEN')

# Translation Configuration
TRANSLATION_ENABLED = os.getenv('TRANSLATION_ENABLED', 'true').lower() == 'true'
DEFAULT_SOURCE_LANGUAGE = os.getenv('DEFAULT_SOURCE_LANGUAGE', 'auto')
DEFAULT_TARGET_LANGUAGE = os.getenv('DEFAULT_TARGET_LANGUAGE', 'en')

# Audio Processing
AUDIO_SAMPLE_RATE = 16000  # OpenAI requires 16kHz
AUDIO_CHANNELS = 1  # Mono

# Agent Configuration
AGENT_NAME = os.getenv('AGENT_NAME', 'Translation Agent')

