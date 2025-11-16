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
        self.participant_languages = {}  # Map participant_id -> language_code (what language they want to hear)
        self.audio_buffers = {}  # Map participant_id -> audio buffer
        self.realtime_clients = {}  # Map (speaker_id, listener_id) -> OpenAIRealtimeClient
        self.backend_url = os.getenv('BACKEND_URL', 'http://localhost:3000')
        self.event_loop = None  # Store event loop reference
        
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
    
    async def get_or_create_realtime_client(self, speaker_id, listener_id):
        """Get or create OpenAI Realtime client for translating speaker_id's audio to listener_id's language"""
        client_key = (speaker_id, listener_id)
        if client_key in self.realtime_clients:
            return self.realtime_clients[client_key]
        
        # Get target language for the listener (what language they want to hear)
        target_language = self.participant_languages.get(listener_id, 'en')
        
        # Create new Realtime client
        client = OpenAIRealtimeClient(
            api_key=config.OPENAI_API_KEY,
            target_language=target_language
        )
        
        # Set up callbacks
        def on_transcription(text):
            print(f"[Speaker: {speaker_id} -> Listener: {listener_id}] Transcription: {text}")
            # Store transcription for the listener (they see the translated text)
            asyncio.create_task(self._store_transcription(listener_id, text, speaker_id))
        
        def on_audio(audio_data):
            # Inject translated audio back into Daily.co call for the listener
            self._inject_translated_audio(listener_id, audio_data)
        
        client.on_transcription = on_transcription
        client.on_audio = on_audio
        
        # Connect
        connected = await client.connect()
        if connected:
            self.realtime_clients[client_key] = client
            return client
        else:
            return None
    
    async def process_audio_with_openai(self, speaker_id, audio_data, source_language='auto'):
        """Process audio through OpenAI Realtime API for translation
        Translates speaker_id's audio to each listener's preferred language
        Also handles case where speaker is alone - they still get transcriptions"""
        try:
            # Get all participants and their language preferences
            participants = self.call_client.participants() if self.call_client else {}
            
            # Get speaker's own language preference (for when they're alone)
            speaker_target_language = self.participant_languages.get(speaker_id, 'en')
            
            # Check if speaker is alone (only bot and speaker)
            is_alone = len(participants) <= 2  # 'local' (bot) + speaker
            
            # If speaker is alone, still process for transcription/translation
            if is_alone:
                # Create a client for speaker->speaker (self-transcription/translation)
                listener_id = speaker_id
                target_language = speaker_target_language
                
                # Get or create Realtime client for this speaker->speaker pair
                client = await self.get_or_create_realtime_client(speaker_id, listener_id)
                if client:
                    # Ensure audio_data is numpy array
                    if not isinstance(audio_data, np.ndarray):
                        audio_data = np.array(audio_data, dtype=np.float32)
                    
                    # Send audio to OpenAI Realtime API
                    await client.send_audio(audio_data.copy())
                    print(f"Processing audio for solo speaker {speaker_id} -> {target_language}")
                else:
                    print(f"Failed to create Realtime client for solo speaker {speaker_id}")
            
            # Process audio for each listener (translate speaker's audio to listener's language)
            for listener_id, listener_data in participants.items():
                if listener_id == 'local' or listener_id == speaker_id:
                    # Skip bot itself and the speaker (already handled above if alone)
                    continue
                
                # Get target language for this listener
                target_language = self.participant_languages.get(listener_id, 'en')
                
                # Skip if no translation needed (listener wants same language as source)
                if target_language == source_language:
                    continue
                
                # Get or create Realtime client for this speaker->listener pair
                client = await self.get_or_create_realtime_client(speaker_id, listener_id)
                if not client:
                    print(f"Failed to create Realtime client for {speaker_id} -> {listener_id}")
                    continue
                
                # Ensure audio_data is numpy array
                if not isinstance(audio_data, np.ndarray):
                    audio_data = np.array(audio_data, dtype=np.float32)
                
                # Send audio to OpenAI Realtime API for this listener
                await client.send_audio(audio_data.copy())  # Copy to avoid issues with multiple listeners
            
        except Exception as e:
            print(f"Error processing audio with OpenAI: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    async def _store_transcription(self, listener_id, text, speaker_id=None):
        """Store transcription in backend for frontend display
        Stores translated text for the listener (what they see/hear)"""
        try:
            async with aiohttp.ClientSession() as session:
                url = f"{self.backend_url}/api/translation/transcription"
                data = {
                    "meetingId": self.meeting_id,
                    "participantId": listener_id,  # Store for the listener
                    "text": text,
                    "speakerId": speaker_id,  # Who said it originally
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
                    audio_source.write_frames(audio_bytes)
                    
                    print(f"Added custom audio track {track_name} for {participant_id}")
                    print(f"Injected translated audio for {participant_id} (track: {track_name})")
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
                    def audio_renderer(*args, **kwargs):
                        """Called when audio frame is received from participant
                        Daily.co SDK callback signature may vary - handle all cases"""
                        try:
                            # Daily.co SDK may pass arguments in different orders
                            # Try to find the audio data (should be numpy array or bytes)
                            audio_data = None
                            
                            # Check all arguments for audio data
                            for arg in args:
                                if arg is None:
                                    continue
                                # Check if it's numpy array, bytes, or numeric array
                                if isinstance(arg, np.ndarray):
                                    audio_data = arg
                                    break
                                elif isinstance(arg, (bytes, bytearray)):
                                    # Convert bytes to numpy array
                                    audio_data = np.frombuffer(arg, dtype=np.int16).astype(np.float32) / 32767.0
                                    break
                                elif isinstance(arg, (list, tuple)) and len(arg) > 0:
                                    # Try to convert list/tuple to numpy array
                                    try:
                                        audio_data = np.array(arg, dtype=np.float32)
                                        break
                                    except (ValueError, TypeError):
                                        continue
                                # Skip strings (likely participant IDs)
                                elif isinstance(arg, str):
                                    continue
                            
                            if audio_data is None:
                                # No valid audio data found
                                return
                            
                            # Validate audio data is numeric
                            if not isinstance(audio_data, np.ndarray):
                                return
                            
                            # Process audio for translation (async wrapper)
                            # Use event loop if available, otherwise create task
                            try:
                                if self.event_loop and self.event_loop.is_running():
                                    self.event_loop.call_soon_threadsafe(
                                        lambda: asyncio.create_task(self.process_audio_with_openai(
                                            pid,
                                            audio_data,
                                            source_language='auto'
                                        ))
                                    )
                                else:
                                    # Fallback: try to get current loop
                                    loop = asyncio.get_event_loop()
                                    loop.create_task(self.process_audio_with_openai(
                                        pid,
                                        audio_data,
                                        source_language='auto'
                                    ))
                            except Exception as loop_error:
                                print(f"Error scheduling audio processing task for {pid}: {loop_error}")
                        except Exception as e:
                            print(f"Error in audio renderer for {pid}: {e}")
                            import traceback
                            traceback.print_exc()
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
            
            # Store event loop reference for use in callbacks
            self.event_loop = asyncio.get_event_loop()
            
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
                # Use stored event loop reference
                try:
                    if self.event_loop and self.event_loop.is_running():
                        # Schedule the coroutine to run
                        self.event_loop.call_soon_threadsafe(
                            lambda: asyncio.create_task(self._delayed_audio_setup())
                        )
                    else:
                        # If no loop, create a new one (shouldn't happen)
                        print("Warning: No event loop available, creating new one")
                        new_loop = asyncio.new_event_loop()
                        asyncio.set_event_loop(new_loop)
                        new_loop.run_until_complete(self._delayed_audio_setup())
                except Exception as e:
                    print(f"Error creating audio setup task: {e}")
                    import traceback
                    traceback.print_exc()
            
            # Join with completion callback
            self.call_client.join(
                self.room_url,
                meeting_token=self.token,
                completion=join_completion
            )
            
            # Wait a moment for join to complete
            await asyncio.sleep(2)
            
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
            for client_key, client in self.realtime_clients.items():
                try:
                    await client.close()
                except Exception as e:
                    print(f"Error closing Realtime client for {client_key}: {e}")
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
    print("=" * 60)
    print("Translation Agent Starting...")
    print("=" * 60)
    
    meeting_id = os.getenv('MEETING_ID')
    room_url = os.getenv('DAILY_ROOM_URL')
    token = os.getenv('DAILY_TOKEN')
    openai_key = os.getenv('OPENAI_API_KEY')
    
    print(f"MEETING_ID: {meeting_id}")
    print(f"DAILY_ROOM_URL: {room_url}")
    print(f"DAILY_TOKEN: {'***' + token[-10:] if token else 'NOT SET'}")
    print(f"OPENAI_API_KEY: {'***' + openai_key[-10:] if openai_key else 'NOT SET'}")
    
    if not meeting_id or not room_url or not token:
        print("ERROR: MEETING_ID, DAILY_ROOM_URL, and DAILY_TOKEN must be set")
        print("Set these in your .env file or as environment variables")
        return
    
    if not openai_key:
        print("ERROR: OPENAI_API_KEY must be set")
        return
    
    agent = TranslationAgent(room_url, token, meeting_id)
    
    try:
        print("\nAttempting to join meeting...")
        success = await agent.join_meeting()
        if success:
            print("\n" + "=" * 60)
            print("Translation agent is running!")
            print("=" * 60)
            # Keep running until interrupted
            await asyncio.Event().wait()
        else:
            print("ERROR: Failed to join meeting")
    except KeyboardInterrupt:
        print("\nStopping translation agent...")
        await agent.leave_meeting()
    except Exception as e:
        print(f"\nERROR in main: {e}")
        import traceback
        traceback.print_exc()
        await agent.leave_meeting()

if __name__ == '__main__':
    asyncio.run(main())
