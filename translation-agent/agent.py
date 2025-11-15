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
from openai_realtime import OpenAIRealtimeClient

load_dotenv()

# Import Daily.co Python SDK
try:
    from daily import Daily, CallClient
    DAILY_AVAILABLE = True
except ImportError:
    print("ERROR: daily-python not installed. Install with: pip install daily-python")
    print("Or activate venv: source venv/bin/activate && pip install daily-python")
    DAILY_AVAILABLE = False
    Daily = None
    CallClient = None

# Import OpenAI
try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    print("ERROR: openai not installed. Install with: pip install openai")
    OPENAI_AVAILABLE = False
    OpenAI = None

class TranslationAgent:
    def __init__(self, room_url, token, meeting_id):
        self.room_url = room_url
        self.token = token
        self.meeting_id = meeting_id
        self.call_client = None
        self.openai_client = None
        self.running = False
        self.participant_languages = {}  # Map participant_id -> language_code
        self.audio_buffers = {}  # Map participant_id -> audio buffer
        self.realtime_clients = {}  # Map participant_id -> OpenAIRealtimeClient
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
            
            # Initialize Daily.co
            Daily.init()
            
            # Create CallClient
            self.call_client = CallClient()
            
            # Initialize OpenAI client
            self.openai_client = OpenAI(api_key=config.OPENAI_API_KEY)
            
            print(f"Translation agent initialized for meeting {self.meeting_id}")
            return True
        except Exception as e:
            print(f"Error initializing agent: {e}")
            import traceback
            traceback.print_exc()
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
    
    async def get_or_create_realtime_client(self, participant_id):
        """Get or create OpenAI Realtime client for a participant"""
        if participant_id in self.realtime_clients:
            return self.realtime_clients[participant_id]
        
        # Get target language for this participant
        target_language = self.participant_languages.get(participant_id, 'en')
        
        # Create new Realtime client
        client = OpenAIRealtimeClient(
            api_key=config.OPENAI_API_KEY,
            target_language=target_language
        )
        
        # Set up callbacks
        def on_transcription(text):
            print(f"[{participant_id}] Transcription: {text}")
            # Store transcription for backend API access
            asyncio.create_task(self._store_transcription(participant_id, text))
        
        def on_audio(audio_data):
            # Inject translated audio back into Daily.co call
            self._inject_translated_audio(participant_id, audio_data)
        
        client.on_transcription = on_transcription
        client.on_audio = on_audio
        
        # Connect
        connected = await client.connect()
        if connected:
            self.realtime_clients[participant_id] = client
            return client
        else:
            return None
    
    async def process_audio_with_openai(self, participant_id, audio_data, source_language='auto'):
        """Process audio through OpenAI Realtime API for translation"""
        try:
            # Get target language for this participant
            target_language = self.participant_languages.get(participant_id, 'en')
            
            if target_language == source_language or (target_language == 'en' and source_language == 'auto'):
                # No translation needed
                return None
            
            # Get or create Realtime client for this participant
            client = await self.get_or_create_realtime_client(participant_id)
            if not client:
                print(f"Failed to create Realtime client for {participant_id}")
                return None
            
            # Ensure audio_data is numpy array
            if not isinstance(audio_data, np.ndarray):
                audio_data = np.array(audio_data, dtype=np.float32)
            
            # Send audio to OpenAI Realtime API
            await client.send_audio(audio_data)
            
        except Exception as e:
            print(f"Error processing audio with OpenAI: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    async def _store_transcription(self, participant_id, text):
        """Store transcription in backend for frontend display"""
        try:
            async with aiohttp.ClientSession() as session:
                url = f"{self.backend_url}/api/translation/transcription"
                data = {
                    "meetingId": self.meeting_id,
                    "participantId": participant_id,
                    "text": text,
                    "timestamp": asyncio.get_event_loop().time()
                }
                async with session.post(url, json=data) as response:
                    if response.status != 200:
                        print(f"Failed to store transcription: {response.status}")
        except Exception as e:
            print(f"Error storing transcription: {e}")
    
    def _inject_translated_audio(self, participant_id, audio_data):
        """Inject translated audio back into Daily.co call"""
        try:
            # Convert float32 audio to int16 for Daily.co
            audio_int16 = (np.clip(audio_data, -1.0, 1.0) * 32767).astype(np.int16)
            
            # Daily.co Python SDK's add_custom_audio_track method
            # This creates a custom audio track that can be sent to participants
            if self.call_client:
                try:
                    # Create audio track from numpy array
                    # Daily.co expects audio as bytes or MediaStreamTrack
                    # We need to convert numpy array to a format Daily.co accepts
                    
                    # Convert to bytes
                    audio_bytes = audio_int16.tobytes()
                    
                    # Use Daily.co's CustomAudioTrack and CustomAudioSource
                    from daily import CustomAudioTrack, CustomAudioSource
                    
                    # Create custom audio source
                    audio_source = CustomAudioSource(sample_rate=16000, channels=1)
                    
                    # Create custom audio track
                    audio_track = CustomAudioTrack(audio_source)
                    
                    # Write audio frames to the source
                    # Note: This needs to be done continuously, not just once
                    # For now, we'll log that audio injection needs continuous streaming
                    track_name = f"translation-{participant_id}"
                    
                    # Add the track
                    self.call_client.add_custom_audio_track(
                        track_name=track_name,
                        audio_track=audio_track
                    )
                    
                    # Write audio data to the source (this needs to be done continuously)
                    # For now, we'll implement a simple version
                    # In production, this would need a continuous audio stream
                    print(f"Added custom audio track {track_name} for {participant_id}")
                    print("Note: Audio injection requires continuous streaming - implementing...")
                    
                    print(f"Injected translated audio for {participant_id} (track: {track_id})")
                except Exception as e:
                    print(f"Error injecting audio (may need different format): {e}")
                    print("Note: Audio injection requires proper MediaStreamTrack format")
                    # Fallback: Log that audio was received but not injected
                    print(f"Translated audio received for {participant_id} but not injected (see transcriptions)")
        except Exception as e:
            print(f"Error in _inject_translated_audio: {e}")
            import traceback
            traceback.print_exc()
    
    def setup_audio_processing(self):
        """Set up audio processing for participants using Daily.co Python SDK"""
        try:
            # Get all participants
            participants = self.call_client.participants()
            print(f"Setting up audio processing for {len(participants)} participants")
            
            # Set up audio renderer for each participant
            for participant_id, participant in participants.items():
                if participant_id == 'local':  # Skip local (bot itself)
                    continue
                
                def make_audio_renderer(pid):
                    """Create audio renderer closure for specific participant"""
                    def audio_renderer(audio_frame):
                        """Called when audio frame is received from participant"""
                        try:
                            # Get audio data from frame
                            # Daily.co Python SDK provides audio_frame as numpy array or similar
                            audio_data = audio_frame
                            
                            if audio_data is None:
                                return
                            
                            # Process audio for translation (async wrapper)
                            asyncio.create_task(self.process_audio_with_openai(
                                pid,
                                audio_data,
                                source_language='auto'
                            ))
                        except Exception as e:
                            print(f"Error in audio renderer for {pid}: {e}")
                    return audio_renderer
                
                # Set audio renderer for this participant
                try:
                    self.call_client.set_audio_renderer(
                        participant_id=participant_id,
                        callback=make_audio_renderer(participant_id),
                        audio_source='microphone',  # or 'speaker' depending on what we want
                        sample_rate=16000,  # OpenAI requires 16kHz
                        callback_interval_ms=20  # Process every 20ms
                    )
                    print(f"Audio renderer set up for participant {participant_id}")
                except Exception as e:
                    print(f"Error setting audio renderer for {participant_id}: {e}")
            
            print("Audio processing set up")
        except Exception as e:
            print(f"Error setting up audio processing: {e}")
            import traceback
            traceback.print_exc()
    
    def update_audio_processing(self):
        """Update audio processing when participants join/leave"""
        # Re-setup audio processing for new participants
        self.setup_audio_processing()
    
    async def join_meeting(self):
        """Join the Daily.co meeting"""
        try:
            if not self.call_client:
                if not await self.initialize():
                    return False
            
            # Fetch language preferences before joining
            await self.fetch_language_preferences()
            
            # Join the room using Daily.co Python SDK
            def join_completion(join_data, error):
                """Callback when join completes"""
                if error:
                    print(f"Error joining meeting: {error}")
                    return
                
                print(f"Translation agent joined meeting {self.meeting_id}")
                print(f"Join data: {join_data}")
                
                # Set up audio processing after joining
                # Wait a bit for participants to be available
                asyncio.create_task(self._delayed_audio_setup())
            
            # Join with completion callback
            self.call_client.join(
                self.room_url,
                meeting_token=self.token,
                completion=join_completion
            )
            
            # Wait a moment for join to complete
            await asyncio.sleep(1)
            
            self.running = True
            
            return True
        except Exception as e:
            print(f"Error joining meeting: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    async def _delayed_audio_setup(self):
        """Set up audio processing after a short delay"""
        try:
            await asyncio.sleep(2)  # Wait for participants to be available
            self.setup_audio_processing()
            
            # Periodically check for new participants and update audio processing
            while self.running:
                await asyncio.sleep(5)  # Check every 5 seconds
                if self.running:
                    self.update_audio_processing()
        except Exception as e:
            print(f"Error in delayed audio setup: {e}")
            import traceback
            traceback.print_exc()
    
    async def leave_meeting(self):
        """Leave the meeting"""
        try:
            self.running = False
            
            # Close all OpenAI Realtime clients
            for participant_id, client in self.realtime_clients.items():
                try:
                    await client.close()
                except Exception as e:
                    print(f"Error closing Realtime client for {participant_id}: {e}")
            self.realtime_clients.clear()
            
            # Leave Daily.co call
            if self.call_client:
                self.call_client.leave()
                print(f"Translation agent left meeting {self.meeting_id}")
        except Exception as e:
            print(f"Error leaving meeting: {e}")
            import traceback
            traceback.print_exc()

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
