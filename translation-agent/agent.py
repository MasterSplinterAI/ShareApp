"""
Daily.co Translation Agent
Joins Daily.co meetings as a bot participant and provides real-time bi-directional translation using OpenAI Realtime API
"""
import os
import asyncio
import json
import numpy as np
import aiohttp
from dotenv import load_dotenv
import config

load_dotenv()

# Try to import Daily.co Python SDK
try:
    from daily import Daily
    DAILY_AVAILABLE = True
except ImportError:
    print("WARNING: daily-python not installed. Install with: pip install daily-python")
    DAILY_AVAILABLE = False
    Daily = None

# Try to import OpenAI
try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    print("WARNING: openai not installed. Install with: pip install openai")
    OPENAI_AVAILABLE = False
    OpenAI = None

class TranslationAgent:
    def __init__(self, room_url, token, meeting_id):
        self.room_url = room_url
        self.token = token
        self.meeting_id = meeting_id
        self.daily = None
        self.openai_client = None
        self.running = False
        self.participant_languages = {}  # Map participant_id -> language_code
        self.audio_buffers = {}  # Map participant_id -> audio buffer
        self.backend_url = os.getenv('BACKEND_URL', 'http://localhost:3000')
        
    async def initialize(self):
        """Initialize Daily.co client and OpenAI client"""
        try:
            if not config.OPENAI_API_KEY:
                raise ValueError("OPENAI_API_KEY not set in environment")
            
            if not DAILY_AVAILABLE:
                raise ImportError("daily-python SDK not installed")
            
            if not OPENAI_AVAILABLE:
                raise ImportError("openai SDK not installed")
            
            # Initialize Daily.co client
            self.daily = Daily()
            
            # Initialize OpenAI client
            self.openai_client = OpenAI(api_key=config.OPENAI_API_KEY)
            
            print(f"Translation agent initialized for meeting {self.meeting_id}")
            return True
        except Exception as e:
            print(f"Error initializing agent: {e}")
            return False
    
    async def fetch_language_preferences(self):
        """Fetch language preferences from backend API"""
        try:
            async with aiohttp.ClientSession() as session:
                url = f"{self.backend_url}/api/translation/languages/{self.meeting_id}"
                async with session.get(url) as response:
                    if response.status == 200:
                        data = await response.json()
                        self.participant_languages = data.get('preferences', {})
                        print(f"Loaded language preferences: {self.participant_languages}")
                    else:
                        print(f"Failed to fetch language preferences: {response.status}")
        except Exception as e:
            print(f"Error fetching language preferences: {e}")
            # Default to English for all participants
            self.participant_languages = {}
    
    async def process_audio_with_openai(self, participant_id, audio_data, source_language='auto'):
        """Process audio through OpenAI Realtime API for translation"""
        try:
            # Get target language for this participant
            target_language = self.participant_languages.get(participant_id, 'en')
            
            if target_language == source_language or target_language == 'en' and source_language == 'auto':
                # No translation needed
                return None
            
            print(f"Processing audio from {participant_id}, translating to {target_language}")
            
            # TODO: Implement full OpenAI Realtime API integration
            # This requires:
            # 1. Creating a Realtime session with OpenAI
            # 2. Sending audio chunks via WebSocket
            # 3. Receiving translated audio/text
            # 4. Converting back to audio format Daily.co expects
            
            # For now, this is a placeholder
            # Full implementation would use OpenAI's Realtime API WebSocket connection
            
            return None  # Placeholder
        except Exception as e:
            print(f"Error processing audio with OpenAI: {e}")
            return None
    
    async def setup_audio_processing(self, call_client):
        """Set up audio processing for participants"""
        try:
            # Daily.co Python SDK event handlers
            @call_client.on("participant-joined")
            async def on_participant_joined(participant):
                participant_id = participant.get('id')
                print(f"Participant {participant_id} joined")
                
                # Fetch updated language preferences
                await self.fetch_language_preferences()
            
            @call_client.on("participant-left")
            async def on_participant_left(participant):
                participant_id = participant.get('id')
                print(f"Participant {participant_id} left")
                if participant_id in self.audio_buffers:
                    del self.audio_buffers[participant_id]
            
            @call_client.on("track-started")
            async def on_track_started(track):
                if track.get('type') == 'audio':
                    participant_id = track.get('participant_id')
                    print(f"Audio track started for participant {participant_id}")
            
            @call_client.on("track-stopped")
            async def on_track_stopped(track):
                if track.get('type') == 'audio':
                    participant_id = track.get('participant_id')
                    print(f"Audio track stopped for participant {participant_id}")
            
            # Set up frame processor for audio frames
            @call_client.frame_processor("audio")
            async def process_audio_frame(frame):
                try:
                    participant_id = frame.get('participant_id')
                    if not participant_id:
                        return
                    
                    # Get audio data from frame
                    audio_data = frame.get('audio')
                    if audio_data is None:
                        return
                    
                    # Process audio for translation
                    translated_audio = await self.process_audio_with_openai(
                        participant_id,
                        audio_data,
                        source_language='auto'
                    )
                    
                    # If we have translated audio, inject it back
                    # Daily.co's Python SDK supports sending audio tracks
                    
                except Exception as e:
                    print(f"Error processing audio frame: {e}")
            
            print("Audio processing set up")
        except Exception as e:
            print(f"Error setting up audio processing: {e}")
    
    async def join_meeting(self):
        """Join the Daily.co meeting"""
        try:
            if not self.daily:
                if not await self.initialize():
                    return False
            
            # Fetch language preferences before joining
            await self.fetch_language_preferences()
            
            # Join the room using Daily.co Python SDK
            call_client = self.daily.join(
                self.room_url,
                token=self.token,
                user_name=config.AGENT_NAME,
                audio=True,
                video=False  # Bot doesn't need video
            )
            
            print(f"Translation agent joined meeting {self.meeting_id}")
            
            # Set up audio processing
            await self.setup_audio_processing(call_client)
            
            self.running = True
            
            return True
        except Exception as e:
            print(f"Error joining meeting: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    async def leave_meeting(self):
        """Leave the meeting"""
        try:
            self.running = False
            if self.daily:
                self.daily.leave()
                print(f"Translation agent left meeting {self.meeting_id}")
        except Exception as e:
            print(f"Error leaving meeting: {e}")

async def main():
    """Main entry point for the agent"""
    meeting_id = os.getenv('MEETING_ID')
    room_url = os.getenv('DAILY_ROOM_URL')
    token = os.getenv('DAILY_TOKEN')
    
    if not meeting_id or not room_url or not token:
        print("Error: MEETING_ID, DAILY_ROOM_URL, and DAILY_TOKEN must be set")
        print("Set these in your .env file or as environment variables")
        return
    
    agent = TranslationAgent(room_url, token, meeting_id)
    
    try:
        success = await agent.join_meeting()
        if success:
            print("Translation agent is running. Press Ctrl+C to stop.")
            # Keep running until interrupted
            await asyncio.Event().wait()
        else:
            print("Failed to join meeting")
    except KeyboardInterrupt:
        print("\nStopping translation agent...")
        await agent.leave_meeting()
    except Exception as e:
        print(f"Error in main: {e}")
        import traceback
        traceback.print_exc()
        await agent.leave_meeting()

if __name__ == '__main__':
    asyncio.run(main())
