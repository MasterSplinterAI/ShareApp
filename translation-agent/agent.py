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
        self.custom_audio_sources = {}  # Map participant_id -> CustomAudioSource (for audio injection)
        self.custom_audio_tracks = {}  # Map participant_id -> CustomAudioTrack (for audio injection)
        
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
        # Get speaker's language (what language they speak)
        speaker_language = self.participant_languages.get(speaker_id, 'en')
        
        # Create new Realtime client
        client = OpenAIRealtimeClient(
            api_key=config.OPENAI_API_KEY,
            target_language=target_language
        )
        
        # Set up callbacks
        def on_transcription(text):
            print(f"[Speaker: {speaker_id} -> Listener: {listener_id}] Transcription: {text}", flush=True)
            # Store transcription for the listener (they see the translated text)
            # Schedule the async task properly using the event loop
            if self.event_loop and self.event_loop.is_running():
                self.event_loop.call_soon_threadsafe(
                    lambda: asyncio.create_task(self._store_transcription(listener_id, text, speaker_id))
                )
            else:
                # Fallback: try to get current loop
                try:
                    loop = asyncio.get_event_loop()
                    loop.create_task(self._store_transcription(listener_id, text, speaker_id))
                except Exception as e:
                    print(f"Error scheduling transcription storage task: {e}", flush=True)
        
        def on_audio(audio_data):
            # Inject translated audio back into Daily.co call for the listener
            # Only inject if translation is actually needed (source != target)
            # Skip audio injection when languages match - we only want transcriptions
            if target_language == speaker_language:
                # Languages match - skip audio injection, we only want transcriptions
                print(f"Skipping audio injection for {listener_id}: languages match ({target_language}), transcription only", flush=True)
                return
            
            # Languages differ - inject translated audio
            print(f"Injecting translated audio for listener {listener_id} (speaker: {speaker_id}, {speaker_language} -> {target_language})", flush=True)
            self._inject_translated_audio(listener_id, audio_data)
        
        client.on_transcription = on_transcription
        client.on_audio = on_audio
        
        # Connect
        print(f"Connecting OpenAI Realtime client for {speaker_id} -> {listener_id} (target: {target_language})...", flush=True)
        connected = await client.connect()
        if connected:
            print(f"OpenAI Realtime client connected for {speaker_id} -> {listener_id}", flush=True)
            self.realtime_clients[client_key] = client
            return client
        else:
            print(f"Failed to connect OpenAI Realtime client for {speaker_id} -> {listener_id}", flush=True)
            return None
    
    async def process_audio_with_openai(self, speaker_id, audio_data, source_language='auto'):
        """Process audio through OpenAI Realtime API for translation
        Translates speaker_id's audio to each listener's preferred language
        Smart skipping: Don't translate if source language matches listener's target language
        Also handles case where speaker is alone - they still get transcriptions"""
        try:
            print(f"process_audio_with_openai called for speaker {speaker_id}", flush=True)
            # Get all participants and their language preferences
            participants = self.call_client.participants() if self.call_client else {}
            print(f"Found {len(participants)} participants: {list(participants.keys())}", flush=True)
            
            # Get speaker's own language preference (what language they speak/want to hear)
            speaker_target_language = self.participant_languages.get(speaker_id, 'en')
            print(f"Speaker {speaker_id} speaks/wants: {speaker_target_language}", flush=True)
            
            # Check if speaker is alone (only bot and speaker)
            is_alone = len(participants) <= 2  # 'local' (bot) + speaker
            print(f"Speaker is alone: {is_alone}", flush=True)
            
            # If speaker is alone, only process if they want transcription (not translation)
            if is_alone:
                listener_id = speaker_id
                target_language = speaker_target_language
                
                # For solo speaker: Only transcribe, don't translate if source == target
                # Since we don't know the source language yet, we'll let OpenAI handle it
                # But we'll configure it to NOT translate if already in target language
                print(f"Processing solo speaker {speaker_id} -> {listener_id} (target: {target_language})", flush=True)
                client = await self.get_or_create_realtime_client(speaker_id, listener_id)
                if client:
                    print(f"Realtime client obtained for solo speaker {speaker_id}", flush=True)
                    # Ensure audio_data is numpy array
                    if not isinstance(audio_data, np.ndarray):
                        audio_data = np.array(audio_data, dtype=np.float32)
                    
                    # Send audio to OpenAI Realtime API
                    # OpenAI will transcribe and only translate if needed
                    await client.send_audio(audio_data.copy())
                    print(f"Sent audio to OpenAI for solo speaker {speaker_id} -> {target_language}, shape={audio_data.shape}", flush=True)
                else:
                    print(f"Failed to create Realtime client for solo speaker {speaker_id}", flush=True)
            
            # Process audio for each listener (translate speaker's audio to listener's language)
            # IMPORTANT: Always process for transcription, even if languages match
            # We'll skip audio injection if languages match, but still get transcriptions
            for listener_id, listener_data in participants.items():
                if listener_id == 'local' or listener_id == speaker_id:
                    # Skip bot itself and the speaker (already handled above if alone)
                    continue
                
                # Get target language for this listener (what language they want to hear)
                target_language = self.participant_languages.get(listener_id, 'en')
                
                # Always process for transcription - even when languages match
                # When languages match, we still want transcriptions but don't need translation
                # Use speaker->listener mapping so transcriptions are stored for the listener
                print(f"Processing audio for {speaker_id} -> {listener_id} (target: {target_language}, speaker: {speaker_target_language})", flush=True)
                
                # Get or create Realtime client for this speaker->listener pair
                # The client will handle transcription and translation based on target language
                client = await self.get_or_create_realtime_client(speaker_id, listener_id)
                if not client:
                    print(f"Failed to create Realtime client for {speaker_id} -> {listener_id}", flush=True)
                    continue
                
                # Ensure audio_data is numpy array
                if not isinstance(audio_data, np.ndarray):
                    audio_data = np.array(audio_data, dtype=np.float32)
                
                # Send audio to OpenAI Realtime API
                # This will generate transcriptions (and translations if languages differ)
                await client.send_audio(audio_data.copy())  # Copy to avoid issues with multiple listeners
                if target_language == speaker_target_language:
                    print(f"Processing transcription only: {speaker_id} ({speaker_target_language}) -> {listener_id} (same language, transcription only)", flush=True)
                else:
                    print(f"Processing translation: {speaker_id} ({speaker_target_language}) -> {listener_id} ({target_language})", flush=True)
            
        except Exception as e:
            print(f"Error processing audio with OpenAI: {e}", flush=True)
            import traceback
            traceback.print_exc()
            return None
    
    async def _store_transcription(self, listener_id, text, speaker_id=None):
        """Store transcription in backend for frontend display
        Stores translated text for the listener (what they see/hear)"""
        try:
            import time
            print(f"Storing transcription for listener {listener_id}: '{text}' (speaker: {speaker_id})", flush=True)
            async with aiohttp.ClientSession() as session:
                url = f"{self.backend_url}/api/translation/transcription"
                data = {
                    "meetingId": self.meeting_id,
                    "participantId": listener_id,  # Store for the listener
                    "text": text,
                    "speakerId": speaker_id,  # Who said it originally
                    "timestamp": time.time()  # Use seconds since epoch
                }
                print(f"POST {url} with data: meetingId={data['meetingId']}, participantId={data['participantId']}, text='{data['text'][:50]}...'", flush=True)
                async with session.post(url, json=data) as response:
                    response_text = await response.text()
                    if response.status == 200:
                        print(f"Successfully stored transcription for {listener_id}", flush=True)
                    else:
                        print(f"Failed to store transcription: {response.status} - {response_text}", flush=True)
        except Exception as e:
            print(f"Error storing transcription: {e}", flush=True)
            import traceback
            traceback.print_exc()
    
    def _inject_translated_audio(self, participant_id, audio_data):
        """Inject translated audio back into Daily.co call
        This is called continuously as audio chunks arrive from OpenAI"""
        try:
            # Convert float32 audio to int16 for Daily.co
            audio_int16 = (np.clip(audio_data, -1.0, 1.0) * 32767).astype(np.int16)
            
            # Get or create custom audio source for this participant
            if participant_id not in self.custom_audio_sources:
                try:
                    from daily import CustomAudioTrack, CustomAudioSource
                    
                    # Create custom audio source (this is a continuous stream)
                    audio_source = CustomAudioSource(sample_rate=16000, channels=1)
                    self.custom_audio_sources[participant_id] = audio_source
                    
                    # Create custom audio track
                    audio_track = CustomAudioTrack(audio_source)
                    self.custom_audio_tracks[participant_id] = audio_track
                    
                    # Add the track to the call
                    track_name = f"translation-{participant_id}"
                    print(f"Attempting to add custom audio track {track_name} for {participant_id}...", flush=True)
                    
                    # Try to add the track
                    result = self.call_client.add_custom_audio_track(
                        track_name=track_name,
                        audio_track=audio_track
                    )
                    print(f"Created custom audio track {track_name} for {participant_id} (result: {result})", flush=True)
                except Exception as track_error:
                    print(f"Error creating custom audio track for {participant_id}: {track_error}", flush=True)
                    import traceback
                    traceback.print_exc()
                    # Don't return - try to write anyway in case source was created
                    if participant_id not in self.custom_audio_sources:
                        return
            
            # Get the audio source for this participant
            if participant_id not in self.custom_audio_sources:
                print(f"Warning: No audio source found for {participant_id}, skipping audio injection", flush=True)
                return
                
            audio_source = self.custom_audio_sources[participant_id]
            
            # Write audio frames continuously (this is called for each audio chunk)
            audio_bytes = audio_int16.tobytes()
            try:
                audio_source.write_frames(audio_bytes)
                # Log occasionally (not every frame to avoid spam)
                import random
                if random.random() < 0.05:  # Log 5% of the time for debugging
                    print(f"Injecting audio chunk for {participant_id}: {len(audio_bytes)} bytes", flush=True)
            except Exception as write_error:
                print(f"Error writing audio frames for {participant_id}: {write_error}", flush=True)
                import traceback
                traceback.print_exc()
                
        except Exception as e:
            print(f"Error injecting audio for {participant_id}: {e}", flush=True)
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
                            
                            # Debug: log what we're receiving
                            if len(args) > 0:
                                print(f"Audio renderer called for {pid} with {len(args)} args, types: {[type(a).__name__ for a in args[:3]]}", flush=True)
                            
                            # Check all arguments for audio data
                            for arg in args:
                                if arg is None:
                                    continue
                                
                                # Check if it's Daily.co AudioData object
                                arg_type_name = type(arg).__name__
                                if 'AudioData' in arg_type_name:
                                    # First, log all attributes to understand the structure
                                    attrs = [a for a in dir(arg) if not a.startswith('_')]
                                    print(f"Found AudioData object for {pid}: type={arg_type_name}, attrs={attrs[:15]}", flush=True)
                                    
                                    # Try to extract audio samples from AudioData object
                                    try:
                                        # Daily.co AudioData has .audio_frames attribute!
                                        if hasattr(arg, 'audio_frames'):
                                            audio_frames = arg.audio_frames
                                            if isinstance(audio_frames, bytes):
                                                # Convert bytes to numpy array based on bits_per_sample
                                                bits_per_sample = getattr(arg, 'bits_per_sample', 16)
                                                if bits_per_sample == 16:
                                                    audio_data = np.frombuffer(audio_frames, dtype=np.int16).astype(np.float32) / 32767.0
                                                elif bits_per_sample == 32:
                                                    audio_data = np.frombuffer(audio_frames, dtype=np.int32).astype(np.float32) / 2147483647.0
                                                else:
                                                    audio_data = np.frombuffer(audio_frames, dtype=np.int16).astype(np.float32) / 32767.0
                                                print(f"Extracted audio from .audio_frames (bytes): shape={audio_data.shape}, bits_per_sample={bits_per_sample}", flush=True)
                                            elif isinstance(audio_frames, (list, tuple, np.ndarray)):
                                                audio_data = np.array(audio_frames, dtype=np.float32)
                                                print(f"Extracted audio from .audio_frames (array): shape={audio_data.shape}", flush=True)
                                            else:
                                                print(f".audio_frames exists but is type {type(audio_frames)}, trying next...", flush=True)
                                                continue
                                        elif hasattr(arg, 'samples'):
                                            samples = arg.samples
                                            if isinstance(samples, (list, tuple, np.ndarray)):
                                                audio_data = np.array(samples, dtype=np.float32)
                                            elif isinstance(samples, bytes):
                                                audio_data = np.frombuffer(samples, dtype=np.int16).astype(np.float32) / 32767.0
                                            else:
                                                audio_data = np.array(samples, dtype=np.float32)
                                            print(f"Extracted audio from .samples: shape={audio_data.shape}", flush=True)
                                        elif hasattr(arg, 'data'):
                                            data = arg.data
                                            if isinstance(data, bytes):
                                                audio_data = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32767.0
                                                print(f"Extracted audio from .data (bytes): shape={audio_data.shape}", flush=True)
                                            elif isinstance(data, (list, tuple, np.ndarray)):
                                                audio_data = np.array(data, dtype=np.float32)
                                                print(f"Extracted audio from .data (array): shape={audio_data.shape}", flush=True)
                                            else:
                                                print(f".data exists but is type {type(data)}, trying next...", flush=True)
                                                continue
                                        elif hasattr(arg, 'buffer'):
                                            buffer_data = arg.buffer
                                            if isinstance(buffer_data, bytes):
                                                audio_data = np.frombuffer(buffer_data, dtype=np.int16).astype(np.float32) / 32767.0
                                                print(f"Extracted audio from .buffer: shape={audio_data.shape}", flush=True)
                                            else:
                                                print(f".buffer exists but is type {type(buffer_data)}, trying next...", flush=True)
                                                continue
                                        elif hasattr(arg, 'audio'):
                                            audio_bytes = arg.audio
                                            if isinstance(audio_bytes, bytes):
                                                audio_data = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32767.0
                                                print(f"Extracted audio from .audio: shape={audio_data.shape}", flush=True)
                                            else:
                                                print(f".audio exists but is type {type(audio_bytes)}, trying next...", flush=True)
                                                continue
                                        elif hasattr(arg, '__array__'):
                                            # If AudioData supports numpy array interface
                                            audio_data = np.asarray(arg, dtype=np.float32)
                                            print(f"Extracted audio via __array__: shape={audio_data.shape}", flush=True)
                                        else:
                                            # Last resort: try to iterate or convert
                                            print(f"AudioData has no known audio attributes. Available attrs: {attrs[:20]}", flush=True)
                                            # Try to get the actual audio data - maybe it's indexable?
                                            try:
                                                if hasattr(arg, '__getitem__'):
                                                    # Try to access as array-like
                                                    audio_data = np.array([arg[i] for i in range(min(100, len(arg)))], dtype=np.float32)
                                                    print(f"Extracted audio via __getitem__: shape={audio_data.shape}", flush=True)
                                                else:
                                                    print(f"Cannot extract audio from AudioData - no known method", flush=True)
                                                    continue
                                            except Exception as e2:
                                                print(f"Failed to extract via __getitem__: {e2}", flush=True)
                                                continue
                                        
                                        # Validate we got valid audio data
                                        if audio_data is not None and isinstance(audio_data, np.ndarray) and len(audio_data) > 0:
                                            print(f"Successfully extracted audio for {pid}: shape={audio_data.shape}, dtype={audio_data.dtype}, min={audio_data.min():.4f}, max={audio_data.max():.4f}", flush=True)
                                            break
                                        else:
                                            print(f"Extracted audio_data is invalid: {type(audio_data)}, {audio_data}", flush=True)
                                            continue
                                    except Exception as e:
                                        print(f"Error extracting audio from AudioData object: {e}", flush=True)
                                        import traceback
                                        traceback.print_exc()
                                        continue
                                
                                # Check if it's numpy array, bytes, or numeric array
                                elif isinstance(arg, np.ndarray):
                                    audio_data = arg
                                    print(f"Found numpy array audio data for {pid}: shape={audio_data.shape}, dtype={audio_data.dtype}", flush=True)
                                    break
                                elif isinstance(arg, (bytes, bytearray)):
                                    # Convert bytes to numpy array
                                    audio_data = np.frombuffer(arg, dtype=np.int16).astype(np.float32) / 32767.0
                                    print(f"Found bytes audio data for {pid}: len={len(arg)}", flush=True)
                                    break
                                elif isinstance(arg, (list, tuple)) and len(arg) > 0:
                                    # Try to convert list/tuple to numpy array
                                    try:
                                        audio_data = np.array(arg, dtype=np.float32)
                                        print(f"Found list/tuple audio data for {pid}: len={len(arg)}", flush=True)
                                        break
                                    except (ValueError, TypeError):
                                        continue
                                # Skip strings (likely participant IDs)
                                elif isinstance(arg, str):
                                    continue
                            
                            if audio_data is None:
                                # No valid audio data found
                                print(f"No audio data found in args for {pid}", flush=True)
                                return
                            
                            # Validate audio data is numeric
                            if not isinstance(audio_data, np.ndarray):
                                print(f"Audio data is not numpy array for {pid}: {type(audio_data)}", flush=True)
                                return
                            
                            print(f"Processing audio frame for {pid}: shape={audio_data.shape}, dtype={audio_data.dtype}, min={audio_data.min():.4f}, max={audio_data.max():.4f}", flush=True)
                            
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
                                print(f"Error scheduling audio processing task for {pid}: {loop_error}", flush=True)
                                import traceback
                                traceback.print_exc()
                        except Exception as e:
                            print(f"Error in audio renderer for {pid}: {e}", flush=True)
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
                    print(f"Audio renderer set up for participant {participant_id}", flush=True)
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
                
                print(f"Translation agent joined meeting {self.meeting_id}", flush=True)
                print(f"Join data: {join_data}", flush=True)
                
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
    import sys
    # Force stdout/stderr to be unbuffered for real-time logging
    sys.stdout.reconfigure(line_buffering=True) if hasattr(sys.stdout, 'reconfigure') else None
    sys.stderr.reconfigure(line_buffering=True) if hasattr(sys.stderr, 'reconfigure') else None
    
    print("=" * 60, flush=True)
    print("Translation Agent Starting...", flush=True)
    print("=" * 60, flush=True)
    
    meeting_id = os.getenv('MEETING_ID')
    room_url = os.getenv('DAILY_ROOM_URL')
    token = os.getenv('DAILY_TOKEN')
    openai_key = os.getenv('OPENAI_API_KEY')
    
    print(f"MEETING_ID: {meeting_id}", flush=True)
    print(f"DAILY_ROOM_URL: {room_url}", flush=True)
    print(f"DAILY_TOKEN: {'***' + token[-10:] if token else 'NOT SET'}", flush=True)
    print(f"OPENAI_API_KEY: {'***' + openai_key[-10:] if openai_key else 'NOT SET'}", flush=True)
    
    if not meeting_id or not room_url or not token:
        print("ERROR: MEETING_ID, DAILY_ROOM_URL, and DAILY_TOKEN must be set", flush=True)
        print("Set these in your .env file or as environment variables", flush=True)
        sys.exit(1)
    
    if not openai_key:
        print("ERROR: OPENAI_API_KEY must be set", flush=True)
        sys.exit(1)
    
    agent = TranslationAgent(room_url, token, meeting_id)
    
    try:
        print("\nAttempting to join meeting...", flush=True)
        success = await agent.join_meeting()
        if success:
            print("\n" + "=" * 60, flush=True)
            print("Translation agent is running!", flush=True)
            print("=" * 60, flush=True)
            print("Waiting for audio...", flush=True)
            # Keep running until interrupted
            await asyncio.Event().wait()
        else:
            print("ERROR: Failed to join meeting", flush=True)
            sys.exit(1)
    except KeyboardInterrupt:
        print("\nStopping translation agent...", flush=True)
        await agent.leave_meeting()
    except Exception as e:
        print(f"\nERROR in main: {e}", flush=True)
        import traceback
        traceback.print_exc()
        await agent.leave_meeting()
        sys.exit(1)

if __name__ == '__main__':
    asyncio.run(main())
