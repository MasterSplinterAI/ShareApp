#!/usr/bin/env python
"""
LiveKit Translation Agent with OpenAI
Proper implementation using LiveKit Agents SDK and OpenAI APIs
"""
import os
import asyncio
import json
import logging
import numpy as np
from typing import Dict, Optional
from dotenv import load_dotenv

from livekit import agents, rtc
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
    llm,
)
# VoiceAssistant API - AgentSession is the correct class
from livekit.agents.voice import AgentSession, Agent
VOICEASSISTANT_AVAILABLE = True

from livekit.plugins import openai, silero

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=getattr(logging, os.getenv('LOG_LEVEL', 'INFO')),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class TranslationAgent:
    """Translation agent using OpenAI for real-time translation"""
    
    def __init__(self):
        self.openai_api_key = os.getenv('OPENAI_API_KEY')
        if not self.openai_api_key:
            raise ValueError("OPENAI_API_KEY environment variable is required")
        
        # Feature flag: Use VoiceAssistant (AgentSession) - default: True for better performance
        # Set USE_VOICEASSISTANT=false to use manual implementation
        self.use_voiceassistant = os.getenv('USE_VOICEASSISTANT', 'true').lower() == 'true'
        logger.info(f"Translation Agent mode: {'VoiceAssistant (AgentSession)' if self.use_voiceassistant else 'Manual'} (set USE_VOICEASSISTANT=false to switch)")
        
        # Track participant language preferences and audio processing
        self.participant_languages: Dict[str, str] = {}
        self.translation_enabled: Dict[str, bool] = {}
        
        # VoiceAssistant mode: Store AgentSession per participant
        self.assistants: Dict[str, AgentSession] = {}
        
        # Manual mode: Track audio processing (kept for fallback)
        self.audio_processors: Dict[str, asyncio.Task] = {}  # Track active audio processing tasks
        self.audio_buffers: Dict[str, list] = {}  # Buffer audio frames for batching
        self.audio_tracks: Dict[str, rtc.LocalAudioTrack] = {}  # Track published audio tracks per participant
        self.audio_sources: Dict[str, rtc.AudioSource] = {}  # Track audio sources per participant
        
        # Initialize OpenAI services
        self.stt = openai.STT(
            api_key=self.openai_api_key,
            model="whisper-1",
            language=None,  # Auto-detect
        )
        
        # OpenAI TTS voices: "alloy" (male), "echo" (male), "fable" (male), 
        # "onyx" (male), "nova" (female), "shimmer" (female)
        # Default: "alloy" (male voice) - change to "nova" or "shimmer" for female
        self.tts = openai.TTS(
            api_key=self.openai_api_key,
            model="tts-1-hd",
            voice="alloy",  # Changed from "nova" to "alloy" (male voice)
        )
        
        logger.info("Translation Agent initialized with OpenAI services")
    
    async def entrypoint(self, ctx: JobContext):
        """Main entry point for the agent"""
        logger.info(f"Translation Agent starting in room: {ctx.room.name}")
        # Room SID is a coroutine, await it
        try:
            room_sid = await ctx.room.sid() if hasattr(ctx.room, 'sid') else 'N/A'
            logger.info(f"Room SID: {room_sid}")
        except Exception as e:
            logger.debug(f"Could not get room SID: {e}")
        
        # Connect to room
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        
        my_identity = ctx.room.local_participant.identity
        logger.info(f"AGENT ENTRYPOINT CALLED! Agent connected with identity: {my_identity}")
        
        # Check for other agents in the room BEFORE processing
        # Wait and check multiple times to ensure all agents have connected
        # Increased wait time and checks to handle race conditions
        for check_attempt in range(8):  # Check up to 8 times (was 5)
            await asyncio.sleep(0.5)  # Wait 500ms between checks (was 300ms)
            
            # Get ALL participants (including local and remote) to catch all agents
            # Room object has remote_participants dict and local_participant object
            all_agent_identities = []
            
            # Add local participant (self)
            if ctx.room.local_participant and ctx.room.local_participant.identity.startswith('agent-'):
                all_agent_identities.append(ctx.room.local_participant.identity)
            
            # Add remote participants that are agents
            for participant in ctx.room.remote_participants.values():
                if participant.identity.startswith('agent-'):
                    all_agent_identities.append(participant.identity)
            
            # Ensure self is included (even if not starting with 'agent-')
            if my_identity not in all_agent_identities:
                all_agent_identities.append(my_identity)
            
            # Sort to get deterministic ordering
            all_agent_identities.sort()
            
            logger.info(f"Agent check #{check_attempt + 1}: Found {len(all_agent_identities)} agent(s) in room: {all_agent_identities}")
            
            # Only the lexicographically first agent should stay
            # TEMPORARILY DISABLED: Allow production agent to stay even if cloud agent exists
            # TODO: Remove cloud agent or fix duplicate detection logic
            if False and len(all_agent_identities) > 1 and my_identity != all_agent_identities[0]:
                logger.info(f"⚠️ DUPLICATE DETECTED: Another agent ({all_agent_identities[0]}) is lexicographically first. Exiting to avoid duplicates.")
                logger.info(f"   All agents: {all_agent_identities}")
                logger.info(f"   My identity: {my_identity}")
                logger.info(f"   Primary agent: {all_agent_identities[0]}")
                return  # Exit immediately - don't process anything
            elif len(all_agent_identities) > 1:
                logger.warning(f"⚠️ MULTIPLE AGENTS DETECTED: {all_agent_identities}. Continuing anyway (duplicate detection disabled).")
        
        # Final check after all attempts
        final_agent_identities = []
        if ctx.room.local_participant and ctx.room.local_participant.identity.startswith('agent-'):
            final_agent_identities.append(ctx.room.local_participant.identity)
        for participant in ctx.room.remote_participants.values():
            if participant.identity.startswith('agent-'):
                final_agent_identities.append(participant.identity)
        if my_identity not in final_agent_identities:
            final_agent_identities.append(my_identity)
        final_agent_identities.sort()
        
        # TEMPORARILY DISABLED: Allow production agent to stay
        if False and len(final_agent_identities) > 1 and my_identity != final_agent_identities[0]:
            logger.info(f"⚠️ FINAL CHECK: Another agent ({final_agent_identities[0]}) detected. Exiting.")
            return
        elif len(final_agent_identities) > 1:
            logger.warning(f"⚠️ FINAL CHECK: Multiple agents detected: {final_agent_identities}. Continuing anyway.")
        
        logger.info(f"✅ I am the primary agent ({my_identity}). Proceeding with translation.")
        
        # Log other agents (excluding self)
        other_agents = [
            p.identity for p in ctx.room.remote_participants.values()
            if p.identity.startswith('agent-') and p.identity != my_identity
        ]
        if other_agents:
            logger.warning(f"⚠️ WARNING: Other agents detected but I'm primary: {other_agents}")
        else:
            logger.info("✅ No other agents detected - I'm the only one")
        
        logger.info(f"Connected to room with {len(ctx.room.remote_participants)} participants")
        
        # Log existing participants and check their tracks
        if len(ctx.room.remote_participants) > 0:
            logger.info(f"=== EXISTING PARTICIPANTS DETECTED ===")
            for participant in ctx.room.remote_participants.values():
                logger.info(f"Participant: {participant.identity} (SID: {participant.sid})")
                logger.info(f"  Track publications: {len(participant.track_publications)}")
                for pub in participant.track_publications.values():
                    logger.info(f"    Track: {pub.kind}, subscribed: {pub.subscribed}, has track: {pub.track is not None}")
                    if pub.kind == rtc.TrackKind.KIND_AUDIO and pub.track:
                        logger.info(f"    === Found existing audio track for {participant.identity} ===")
        
        # Send a test data message to verify data channels work
        try:
            test_message = json.dumps({"type": "agent_ready", "message": "Translation agent is ready"})
            await ctx.room.local_participant.publish_data(
                test_message.encode('utf-8'),
                reliable=True,
                topic="agent_status"
            )
            logger.info("=== Sent test data message ===")
        except Exception as e:
            logger.error(f"Failed to send test data message: {e}")
        
        # Set up data message handler for language preferences
        @ctx.room.on("data_received")
        def on_data_received(data: rtc.DataPacket):
            """Handle data messages for language preferences"""
            try:
                # Log the raw data
                logger.info(f"=== DATA RECEIVED ===")
                logger.info(f"Topic: '{data.topic}', From: {data.participant.identity if data.participant else 'System'}")
                logger.info(f"Data length: {len(data.data)}, First 100 bytes: {data.data[:100] if len(data.data) > 0 else 'empty'}")
                
                # Handle language preference messages (topic might be empty or 'language_preference')
                if data.topic == "language_preference" or data.topic == "" or not data.topic:
                    try:
                        message = json.loads(data.data.decode('utf-8'))
                        participant_id = data.participant.identity if data.participant else message.get('participantName', 'unknown')
                        
                        logger.info(f"Language preference message received: {message}")
                        logger.info(f"Message type: {message.get('type')}, Language: {message.get('language')}, Enabled: {message.get('enabled')}")
                        
                        # Process if it's a language_update message
                        if message.get('type') == 'language_update':
                            language = message.get('language', 'en')
                            enabled = message.get('enabled', False)
                            participant_name = message.get('participantName', participant_id)
                            
                            logger.info(f"Language update from {participant_name}: {language} (enabled: {enabled})")
                            
                            self.participant_languages[participant_id] = language
                            self.translation_enabled[participant_id] = enabled
                            
                            # Send confirmation back
                            asyncio.create_task(
                                self.send_confirmation(ctx, participant_id, language, enabled)
                            )
                            
                            # If translation is enabled, start processing
                            if enabled:
                                logger.info(f"Translation activated for {participant_name} -> {language}")
                                logger.info(f"Participant ID: {participant_id}, Participant name: {participant_name}")
                                
                                if self.use_voiceassistant:
                                    # Use VoiceAssistant (better performance, automatic pause detection)
                                    # Create VoiceAssistant for EACH OTHER participant in the room
                                    # This participant wants to hear others translated
                                    for other_participant in ctx.room.remote_participants.values():
                                        if other_participant.identity.startswith('agent-'):
                                            continue  # Skip agents
                                        if other_participant.identity != participant_id:
                                            logger.info(f"Creating VoiceAssistant to translate {other_participant.identity} -> {language} for {participant_id}")
                                            asyncio.create_task(
                                                self.create_voiceassistant_for_participant(
                                                    ctx, 
                                                    participant_id, 
                                                    language,
                                                    source_participant_id=other_participant.identity
                                                )
                                            )
                                else:
                                    # Use manual implementation (current approach)
                                    logger.info(f"Remote participants in room: {list(ctx.room.remote_participants.keys())}")
                                    
                                    # Start processing audio from all other participants in the room
                                    for other_participant in ctx.room.remote_participants.values():
                                        logger.info(f"Checking participant: {other_participant.identity} (comparing with {participant_id})")
                                        
                                        # CRITICAL: Skip agents - don't translate agent audio
                                        if other_participant.identity.startswith('agent-'):
                                            logger.info(f"Skipping agent {other_participant.identity} - agents don't translate each other")
                                            continue
                                        
                                        if other_participant.identity != participant_id:
                                            logger.info(f"Found other participant: {other_participant.identity}, checking for audio tracks...")
                                            # Find audio track for this participant
                                            audio_track_found = False
                                            for publication in other_participant.track_publications.values():
                                                logger.info(f"  Track: {publication.kind}, subscribed: {publication.subscribed}, has track: {publication.track is not None}")
                                                if publication.kind == rtc.TrackKind.KIND_AUDIO:
                                                    if publication.track:
                                                        logger.info(f"Found subscribed audio track for {other_participant.identity}, starting processing")
                                                        audio_track_found = True
                                                        asyncio.create_task(
                                                            self.process_speaker_audio(ctx, publication.track, other_participant.identity)
                                                        )
                                                        break
                                                    elif publication.subscribed:
                                                        # Track is subscribed but not available yet - wait for it
                                                        logger.info(f"Audio track subscribed but not available yet for {other_participant.identity}")
                                            if not audio_track_found:
                                                logger.info(f"No audio track found yet for {other_participant.identity} - will process when track is available")
                                        else:
                                            logger.info(f"Skipping self ({other_participant.identity})")
                            else:
                                # Stop audio processing
                                logger.info(f"Translation disabled for {participant_name}")
                                if self.use_voiceassistant:
                                    asyncio.create_task(self.stop_voiceassistant_for_participant(participant_id))
                                else:
                                    self.stop_audio_processing(participant_id)
                    except json.JSONDecodeError as e:
                        logger.error(f"Failed to parse language preference message: {e}")
                    except Exception as e:
                        logger.error(f"Error processing language preference: {e}", exc_info=True)
            except Exception as e:
                logger.error(f"Error processing data message: {e}", exc_info=True)
        
        # Handle participant events
        @ctx.room.on("participant_connected")
        def on_participant_connected(participant: rtc.RemoteParticipant):
            logger.info(f"=== PARTICIPANT CONNECTED: {participant.identity} (SID: {participant.sid}) ===")
            logger.info(f"Total participants now: {len(ctx.room.remote_participants)}")
            
            # If other participants already have translation enabled, create VoiceAssistants for this new participant
            if self.use_voiceassistant:
                new_participant_id = participant.identity
                if new_participant_id.startswith('agent-'):
                    return  # Skip agents
                
                # Check if any existing participants want translation
                for existing_participant_id, target_language in self.participant_languages.items():
                    if existing_participant_id == new_participant_id:
                        continue  # Skip self
                    if self.translation_enabled.get(existing_participant_id, False):
                        # This existing participant wants translation - create VoiceAssistant for new participant
                        logger.info(f"Creating VoiceAssistant: {new_participant_id} -> {target_language} for {existing_participant_id}")
                        asyncio.create_task(
                            self.create_voiceassistant_for_participant(
                                ctx,
                                existing_participant_id,
                                target_language,
                                source_participant_id=new_participant_id
                            )
                        )
        
        @ctx.room.on("participant_disconnected")
        def on_participant_disconnected(participant: rtc.RemoteParticipant):
            participant_id = participant.identity
            logger.info(f"Participant disconnected: {participant_id}")
            # Clean up participant data
            self.participant_languages.pop(participant_id, None)
            self.translation_enabled.pop(participant_id, None)
            
            # Clean up based on mode
            if self.use_voiceassistant:
                # Stop VoiceAssistant
                asyncio.create_task(self.stop_voiceassistant_for_participant(participant_id))
            else:
                # Stop manual audio processing
                self.stop_audio_processing(participant_id)
                # Clean up audio tracks
                if participant_id in self.audio_tracks:
                    track = self.audio_tracks.pop(participant_id)
                    asyncio.create_task(ctx.room.local_participant.unpublish_track(track))
                    logger.info(f"Unpublished audio track for {participant_id}")
                self.audio_sources.pop(participant_id, None)
        
        # Handle track events
        @ctx.room.on("track_published")
        def on_track_published(publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
            logger.info(f"Track published by {participant.identity}: {publication.kind}")
        
        @ctx.room.on("track_subscribed")
        def on_track_subscribed(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
            logger.info(f"=== TRACK SUBSCRIBED: {participant.identity} - {track.kind} ===")
            logger.info(f"Track SID: {track.sid}, Publication SID: {publication.sid if publication else 'N/A'}")
            
            # If it's an audio track, start processing for ALL participants who need translation
            # We translate what THIS participant says to the languages requested by OTHERS
            if track.kind == rtc.TrackKind.KIND_AUDIO:
                speaker_id = participant.identity
                
                # CRITICAL: Skip processing audio from other agents to prevent feedback loops
                if speaker_id.startswith('agent-'):
                    logger.info(f"Skipping audio from agent {speaker_id} - agents don't translate each other")
                    return
                
                logger.info(f"Audio track subscribed from {speaker_id}")
                
                # Store the track for this speaker so we can process it when translation is enabled
                # Check if any participant needs translation of this speaker's audio
                needs_translation = any(
                    self.translation_enabled.get(pid) and pid != speaker_id
                    for pid in self.translation_enabled.keys()
                )
                
                logger.info(f"Translation needed for {speaker_id}? {needs_translation}")
                logger.info(f"Translation enabled participants: {list(self.translation_enabled.keys())}")
                
                if needs_translation:
                    logger.info(f"Starting audio processing for {speaker_id} (will translate for others)")
                    # Process this speaker's audio and translate for all who need it
                    asyncio.create_task(
                        self.process_speaker_audio(ctx, track, speaker_id)
                    )
                else:
                    logger.info(f"No translation needed yet for {speaker_id}, but track is ready")
        
        logger.info("Translation Agent is running and listening for language preferences...")
        
        # Set up room disconnect handler
        room_disconnected = asyncio.Event()
        
        @ctx.room.on("disconnected")
        def on_room_disconnected():
            logger.info("Room disconnected event received")
            room_disconnected.set()
        
        # Wait for room to disconnect or be closed
        try:
            # Wait for disconnect event or check connection state periodically
            while ctx.room.connection_state == rtc.ConnectionState.CONN_CONNECTED:
                try:
                    # Wait for disconnect event with timeout
                    await asyncio.wait_for(room_disconnected.wait(), timeout=1.0)
                    break  # Room disconnected
                except asyncio.TimeoutError:
                    # Check connection state - exit if disconnected
                    if ctx.room.connection_state != rtc.ConnectionState.CONN_CONNECTED:
                        break
                    continue  # Check again
        except asyncio.CancelledError:
            logger.info("Agent task cancelled")
        except Exception as e:
            logger.error(f"Error in main loop: {e}", exc_info=True)
        finally:
                # Cleanup: Cancel all audio processing tasks
                logger.info("Cleaning up agent resources...")
                
                # Clean up based on mode
                if self.use_voiceassistant:
                    # Stop all VoiceAssistants
                    for participant_id in list(self.assistants.keys()):
                        await self.stop_voiceassistant_for_participant(participant_id)
                else:
                    # Cancel all manual processing tasks
                    for participant_id, task in list(self.audio_processors.items()):
                        if task and not task.done():
                            task.cancel()
                            try:
                                await task
                            except asyncio.CancelledError:
                                pass
                    
                    # Clear manual mode data structures
                    self.audio_processors.clear()
                    self.audio_buffers.clear()
                
                # Clear all data structures
                self.participant_languages.clear()
                self.translation_enabled.clear()
                
                logger.info("Agent shutdown complete - exiting entrypoint")
                # Explicitly return to ensure agent exits
                return
    
    async def send_confirmation(self, ctx: JobContext, participant_id: str, language: str, enabled: bool):
        """Send confirmation back to participant"""
        message = json.dumps({
            "type": "language_confirmed",
            "language": language,
            "enabled": enabled,
            "participant_id": participant_id
        })
        
        try:
            await ctx.room.local_participant.publish_data(
                message.encode('utf-8'),
                reliable=True,
                topic="language_confirmation"
            )
            logger.info(f"Sent confirmation to {participant_id}")
        except Exception as e:
            logger.error(f"Failed to send confirmation: {e}")
    
    async def start_audio_processing(self, ctx: JobContext, participant_id: str, target_language: str):
        """Start audio processing for a participant"""
        # Find the participant's audio track
        participant = None
        for p in ctx.room.remote_participants.values():
            if p.identity == participant_id:
                participant = p
                break
        
        if not participant:
            logger.warning(f"Participant {participant_id} not found for audio processing")
            return
        
        # Find audio track
        audio_track = None
        for publication in participant.track_publications.values():
            if publication.kind == rtc.TrackKind.KIND_AUDIO and publication.track:
                audio_track = publication.track
                break
        
        if audio_track:
            logger.info(f"Starting audio processing for {participant_id} -> {target_language}")
            await self.process_audio_track(ctx, audio_track, participant_id, target_language)
        else:
            logger.info(f"No audio track found for {participant_id}, will process when track is available")
    
    def stop_audio_processing(self, participant_id: str):
        """Stop audio processing for a participant"""
        if participant_id in self.audio_processors:
            task = self.audio_processors[participant_id]
            if task and not task.done():
                task.cancel()
            self.audio_processors.pop(participant_id, None)
            logger.info(f"Stopped audio processing for {participant_id}")
        
        # Clear audio buffer
        self.audio_buffers.pop(participant_id, None)
    
    async def process_speaker_audio(
        self, 
        ctx: JobContext, 
        track: rtc.Track, 
        speaker_id: str
    ):
        """Process audio from a speaker and translate for all participants who need it"""
        logger.info(f"Processing audio from speaker: {speaker_id}")
        
        if speaker_id in self.audio_processors:
            logger.info(f"Audio processing already running for {speaker_id}")
            return
        
        # Mark as processing
        processing_task = asyncio.current_task()
        self.audio_processors[speaker_id] = processing_task
        
        # Initialize audio buffer
        self.audio_buffers[speaker_id] = []
        buffer_duration = 3.0  # Buffer 3 seconds of audio before processing
        
        try:
            # Create audio stream from track
            logger.info(f"Creating audio stream for track: {track.kind}, sid: {track.sid}")
            logger.info(f"Track type: {type(track)}, Track attributes: {dir(track)[:10]}")
            
            # Use agents.audio.AudioStream (preferred method for agents framework)
            try:
                from livekit import agents
                audio_stream = agents.audio.AudioStream(track)
                logger.info(f"Audio stream created successfully using agents.audio.AudioStream")
            except Exception as stream_error:
                logger.error(f"Failed to create agents.audio.AudioStream: {stream_error}", exc_info=True)
                # Try fallback method
                try:
                    audio_stream = rtc.AudioStream(track)
                    logger.info(f"Audio stream created successfully using rtc.AudioStream (fallback)")
                except Exception as alt_error:
                    logger.error(f"Failed to create rtc.AudioStream: {alt_error}", exc_info=True)
                    raise
            
            logger.info(f"Audio stream created, starting to receive frames from {speaker_id}")
            frame_count = 0
            last_process_time = asyncio.get_event_loop().time()
            
            logger.info(f"Entering audio frame loop for {speaker_id}")
            
            # Start a background task to process buffers periodically
            async def process_buffer_periodically():
                while speaker_id in self.audio_processors:
                    try:
                        await asyncio.sleep(buffer_duration)
                        if speaker_id in self.audio_buffers and len(self.audio_buffers[speaker_id]) > 0:
                            # Swap buffer to avoid race conditions - copy current buffer and clear it
                            buffer_to_process = list(self.audio_buffers[speaker_id])  # Make a copy
                            self.audio_buffers[speaker_id] = []  # Clear buffer for new frames (new frames go here)
                            buffer_size = len(buffer_to_process)
                            logger.info(f"Processing audio buffer for {speaker_id}: {buffer_size} frames (periodic check)")
                            # Process the buffered audio and translate for all who need it
                            # Pass buffer directly to avoid race conditions
                            # Don't await - let it run independently so it can complete even if task is cancelled
                            asyncio.create_task(self.process_and_translate_audio(ctx, speaker_id, audio_frames=buffer_to_process))
                    except asyncio.CancelledError:
                        logger.info(f"Buffer processor cancelled for {speaker_id}")
                        break
                    except Exception as e:
                        logger.error(f"Error in buffer processor for {speaker_id}: {e}", exc_info=True)
            
            # Start the periodic processing task
            buffer_processor_task = asyncio.create_task(process_buffer_periodically())
            
            try:
                async for audio_frame in audio_stream:
                    logger.debug(f"Received audio frame #{frame_count + 1} from {speaker_id}")
                    # Check if anyone still needs translation
                    needs_translation = any(
                        self.translation_enabled.get(pid) and pid != speaker_id
                        for pid in self.translation_enabled.keys()
                    )
                    
                    if not needs_translation:
                        logger.info(f"Translation no longer needed for {speaker_id}, stopping audio processing")
                        break
                    
                    # Add frame to buffer
                    if speaker_id not in self.audio_buffers:
                        self.audio_buffers[speaker_id] = []
                    
                    self.audio_buffers[speaker_id].append(audio_frame)
                    frame_count += 1
                    
                    # Log every 100 frames to show we're receiving audio
                    if frame_count % 100 == 0:
                        logger.info(f"Received {frame_count} audio frames from {speaker_id}, buffer size: {len(self.audio_buffers[speaker_id])}")
            finally:
                # Cancel the buffer processor task
                buffer_processor_task.cancel()
                try:
                    await buffer_processor_task
                except asyncio.CancelledError:
                    pass
                
        except asyncio.CancelledError:
            logger.info(f"Audio processing cancelled for {speaker_id}")
        except Exception as e:
            logger.error(f"Error processing audio track: {e}", exc_info=True)
        finally:
            # Clean up
            self.audio_processors.pop(speaker_id, None)
            self.audio_buffers.pop(speaker_id, None)
            logger.info(f"Stopped audio processing for {speaker_id}")
    
    async def process_and_translate_audio(
        self,
        ctx: JobContext,
        speaker_id: str,
        audio_frames: Optional[list] = None
    ):
        """Process audio from speaker and translate for all participants who need it"""
        # Use provided buffer or get from self.audio_buffers
        if audio_frames is None:
            if speaker_id not in self.audio_buffers or len(self.audio_buffers[speaker_id]) == 0:
                logger.debug(f"No audio buffer for {speaker_id}")
                return
            audio_frames = self.audio_buffers[speaker_id]
        
        if len(audio_frames) == 0:
            logger.debug(f"Empty audio frames for {speaker_id}")
            return
        
        logger.info(f"=== PROCESSING AUDIO: {speaker_id}, {len(audio_frames)} frames ===")
        
        try:
            # Combine audio frames into single buffer
            frame_data = []
            for i, frame_event in enumerate(audio_frames[:5]):  # Log first 5 frames
                frame_type = type(frame_event).__name__
                
                # Check if this is an AudioFrameEvent wrapper
                if hasattr(frame_event, 'frame'):
                    actual_frame = frame_event.frame
                    logger.info(f"Frame {i}: AudioFrameEvent detected, extracting .frame")
                else:
                    actual_frame = frame_event
                
                # Extract audio data from the actual frame
                if hasattr(actual_frame, 'data'):
                    frame_bytes = actual_frame.data if isinstance(actual_frame.data, bytes) else bytes(actual_frame.data)
                    frame_data.append(frame_bytes)
                    logger.info(f"Frame {i}: using frame.data, size: {len(frame_bytes)} bytes")
                elif hasattr(actual_frame, 'samples'):
                    if hasattr(actual_frame.samples, 'tobytes'):
                        frame_bytes = actual_frame.samples.tobytes()
                    elif isinstance(actual_frame.samples, np.ndarray):
                        frame_bytes = actual_frame.samples.tobytes()
                    else:
                        frame_bytes = bytes(actual_frame.samples)
                    frame_data.append(frame_bytes)
                    logger.info(f"Frame {i}: using frame.samples, size: {len(frame_bytes)} bytes")
                elif hasattr(actual_frame, 'audio_data'):
                    frame_bytes = actual_frame.audio_data if isinstance(actual_frame.audio_data, bytes) else bytes(actual_frame.audio_data)
                    frame_data.append(frame_bytes)
                    logger.info(f"Frame {i}: using frame.audio_data, size: {len(frame_bytes)} bytes")
                else:
                    logger.warning(f"Frame {i}: no known audio attribute, type: {type(actual_frame).__name__}, attrs: {[a for a in dir(actual_frame) if not a.startswith('_')][:15]}")
                    # Try to convert frame to bytes directly
                    try:
                        if isinstance(actual_frame, np.ndarray):
                            frame_bytes = actual_frame.tobytes()
                            frame_data.append(frame_bytes)
                            logger.info(f"Frame {i}: converted numpy array, size: {len(frame_bytes)} bytes")
                    except:
                        pass
            
            # Process remaining frames without logging
            for i, frame_event in enumerate(audio_frames[5:], start=5):
                # Extract actual frame from AudioFrameEvent if needed
                if hasattr(frame_event, 'frame'):
                    actual_frame = frame_event.frame
                else:
                    actual_frame = frame_event
                
                if hasattr(actual_frame, 'data'):
                    frame_bytes = actual_frame.data if isinstance(actual_frame.data, bytes) else bytes(actual_frame.data)
                    frame_data.append(frame_bytes)
                elif hasattr(actual_frame, 'samples'):
                    if hasattr(actual_frame.samples, 'tobytes'):
                        frame_bytes = actual_frame.samples.tobytes()
                    elif isinstance(actual_frame.samples, np.ndarray):
                        frame_bytes = actual_frame.samples.tobytes()
                    else:
                        frame_bytes = bytes(actual_frame.samples)
                    frame_data.append(frame_bytes)
                elif hasattr(actual_frame, 'audio_data'):
                    frame_bytes = actual_frame.audio_data if isinstance(actual_frame.audio_data, bytes) else bytes(actual_frame.audio_data)
                    frame_data.append(frame_bytes)
            
            combined_audio = b''.join(frame_data)
            logger.info(f"Combined audio: {len(combined_audio)} bytes from {len(frame_data)} frames")
            
            if len(combined_audio) < 1000:
                logger.debug(f"Audio too short: {len(combined_audio)} bytes (need 1000+)")
                return
            
            logger.info(f"=== Processing audio from {speaker_id} ({len(combined_audio)} bytes) ===")
            
            # Step 1: Speech-to-Text using OpenAI Whisper
            # Extract actual AudioFrame objects from AudioFrameEvent wrappers
            try:
                audio_frames_for_stt = []
                logger.info(f"Extracting frames for STT from {len(audio_frames)} audio_frames")
                for i, frame_event in enumerate(audio_frames[:10]):  # Log first 10
                    if hasattr(frame_event, 'frame'):
                        audio_frames_for_stt.append(frame_event.frame)
                        logger.debug(f"Frame {i}: extracted .frame")
                    else:
                        audio_frames_for_stt.append(frame_event)
                        logger.debug(f"Frame {i}: using frame_event directly")
                
                # Process remaining frames
                for i, frame_event in enumerate(audio_frames[10:], start=10):
                    if hasattr(frame_event, 'frame'):
                        audio_frames_for_stt.append(frame_event.frame)
                    else:
                        audio_frames_for_stt.append(frame_event)
                
                logger.info(f"Extracted {len(audio_frames_for_stt)} frames for STT (from {len(audio_frames)} input frames)")
            except Exception as e:
                logger.error(f"Error extracting frames for STT: {e}", exc_info=True)
                return
            
            logger.info(f"Calling transcribe_audio with {len(audio_frames_for_stt)} frames")
            transcript = await self.transcribe_audio(audio_frames_for_stt)
            logger.info(f"Transcription result: {transcript} (type: {type(transcript)})")
            
            if not transcript or len(transcript.strip()) == 0:
                logger.warning(f"No transcript detected from {speaker_id} - transcript was: {transcript}")
                return
            
            # Filter out short/meaningless transcriptions (likely noise)
            transcript_clean = transcript.strip()
            
            # Skip single words that are common noise transcriptions
            noise_words = {'you', 'tu', 'tú', 'to', 'too', 'two', 'the', 'a', 'an', 'uh', 'um', 'ah', 'eh', 'oh'}
            words = transcript_clean.lower().split()
            
            # Skip if it's just noise words or too short
            if len(transcript_clean) < 3:
                logger.debug(f"Skipping very short transcript: '{transcript_clean}'")
                return
            
            if len(words) == 1 and words[0] in noise_words:
                logger.debug(f"Skipping noise word transcript: '{transcript_clean}'")
                return
            
            logger.info(f"Transcribed from {speaker_id}: {transcript_clean}")
            
            # Step 2: Translate for each participant who needs it
            for participant_id, target_language in self.participant_languages.items():
                if self.translation_enabled.get(participant_id) and participant_id != speaker_id:
                    # Translate to this participant's target language
                    translated_text = await self.translate_text(transcript_clean, target_language)
                    logger.info(f"Translated for {participant_id} ({target_language}): {translated_text}")
                    
                    # Send transcription via data channel
                    await self.send_transcription(ctx, participant_id, transcript_clean, translated_text, target_language)
                    
                    # Generate and publish translated audio (TTS)
                    logger.info(f"Calling publish_translated_audio for {participant_id}: '{translated_text[:50]}...'")
                    await self.publish_translated_audio(ctx, participant_id, translated_text, target_language)
                    logger.info(f"Completed publish_translated_audio for {participant_id}")
                    
        except Exception as e:
            logger.error(f"Error processing and translating audio: {e}", exc_info=True)
    
    async def process_audio_buffer(
        self, 
        ctx: JobContext, 
        participant_id: str,
        target_language: str
    ):
        """Process buffered audio: STT -> Translation -> TTS -> Send"""
        if participant_id not in self.audio_buffers or len(self.audio_buffers[participant_id]) == 0:
            return
        
        try:
            # Combine audio frames into single buffer
            audio_frames = self.audio_buffers[participant_id]
            # Extract audio data from frames
            frame_data = []
            for frame in audio_frames:
                if hasattr(frame, 'data'):
                    frame_data.append(frame.data)
                elif hasattr(frame, 'samples'):
                    # Convert samples to bytes
                    frame_data.append(frame.samples.tobytes())
            
            combined_audio = b''.join(frame_data)
            
            if len(combined_audio) < 1000:  # Skip if too short
                return
            
            logger.info(f"Processing audio buffer for {participant_id} ({len(combined_audio)} bytes)")
            
            # Step 1: Speech-to-Text using OpenAI Whisper
            transcript = await self.transcribe_audio(combined_audio)
            
            if not transcript or len(transcript.strip()) == 0:
                logger.debug(f"No transcript detected for {participant_id}")
                return
            
            logger.info(f"Transcribed for {participant_id}: {transcript}")
            
            # Step 2: Translate using GPT-4
            translated_text = await self.translate_text(transcript, target_language)
            logger.info(f"Translated for {participant_id}: {translated_text}")
            
            # Step 3: Send transcription via data channel
            await self.send_transcription(ctx, participant_id, transcript, translated_text, target_language)
            
            # Step 4: Generate and publish translated audio (TTS)
            await self.publish_translated_audio(ctx, participant_id, translated_text, target_language)
            
        except Exception as e:
            logger.error(f"Error processing audio buffer: {e}", exc_info=True)
    
    async def transcribe_audio(self, audio_frames: list) -> Optional[str]:
        """Transcribe audio using OpenAI Whisper"""
        try:
            logger.info(f"transcribe_audio called with {len(audio_frames)} frames")
            # OpenAI STT plugin expects a list of AudioFrame objects
            # The recognize method can handle AudioFrame objects directly
            logger.info(f"Calling stt.recognize...")
            try:
                result = await self.stt.recognize(audio_frames)
                logger.info(f"STT result received: {result}, type: {type(result)}")
                logger.info(f"STT result attributes: {dir(result)[:20] if result else 'None'}")
                
                # Try different ways to get the text
                if result:
                    # Check if it's a SpeechEvent (from livekit.agents.stt.stt)
                    if hasattr(result, 'alternatives') and result.alternatives:
                        # SpeechEvent has alternatives list with SpeechData objects
                        text = result.alternatives[0].text
                        logger.info(f"Got transcription text from SpeechEvent.alternatives[0].text: {text}")
                        return text
                    elif hasattr(result, 'text'):
                        text = result.text
                        logger.info(f"Got transcription text via .text: {text}")
                        return text
                    elif hasattr(result, 'transcript'):
                        text = result.transcript
                        logger.info(f"Got transcription text via .transcript: {text}")
                        return text
                    elif isinstance(result, str):
                        logger.info(f"STT result is string: {result}")
                        return result
                    else:
                        logger.warning(f"STT result missing text attribute: {result}")
                        return None
                else:
                    logger.warning(f"STT result is None")
                    return None
            except asyncio.CancelledError:
                logger.warning(f"STT request was cancelled")
                raise  # Re-raise to allow caller to handle
        except asyncio.CancelledError:
            logger.warning(f"Transcription cancelled")
            return None
        except Exception as e:
            logger.error(f"Transcription error: {e}", exc_info=True)
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return None
    
    async def translate_text(self, text: str, target_language: str) -> str:
        """Translate text using OpenAI GPT"""
        try:
            import openai
            client = openai.AsyncOpenAI(api_key=self.openai_api_key)
            
            language_names = {
                'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
                'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian',
                'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
                'ar': 'Arabic', 'hi': 'Hindi'
            }
            
            target_name = language_names.get(target_language, target_language)
            
            response = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": f"You are a translator. Translate the following text to {target_name}. Output ONLY the translation, no explanations."
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
            logger.error(f"Translation error: {e}", exc_info=True)
            return text
    
    async def send_transcription(
        self,
        ctx: JobContext,
        participant_id: str,
        original_text: str,
        translated_text: str,
        language: str
    ):
        """Send transcription via data channel"""
        try:
            message = json.dumps({
                "type": "transcription",
                "text": translated_text,
                "originalText": original_text,
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
            logger.info(f"Sent transcription to {participant_id}")
        except Exception as e:
            logger.error(f"Failed to send transcription: {e}")
    
    async def publish_translated_audio(
        self,
        ctx: JobContext,
        participant_id: str,
        text: str,
        language: str
    ):
        """Generate TTS and publish translated audio using LiveKit SDK API"""
        try:
            logger.info(f"=== publish_translated_audio called for {participant_id}: '{text[:50]}...' ===")
            
            # Generate speech using OpenAI TTS - returns ChunkedStream (not awaitable)
            logger.info(f"Calling TTS.synthesize for text: '{text[:50]}...'")
            chunked_stream = self.tts.synthesize(text)  # No await - returns ChunkedStream directly
            
            if not chunked_stream:
                logger.warning(f"No audio stream generated for {participant_id}")
                return
            
            logger.info(f"TTS ChunkedStream received for {participant_id}")
            
            # Collect all audio frames from the stream
            # ChunkedStream.collect() returns a single AudioFrame with all audio data
            logger.info(f"Collecting audio frames from stream...")
            audio_frame = await chunked_stream.collect()  # collect() is awaitable
            
            if not audio_frame:
                logger.warning(f"No audio frame collected for {participant_id}")
                return
            
            logger.info(f"Generated TTS audio frame for {participant_id}: {audio_frame.sample_rate}Hz, {audio_frame.num_channels}ch, samples: {audio_frame.samples_per_channel}")
            
            # Get or create audio source for this participant
            if participant_id not in self.audio_sources:
                logger.info(f"Creating new audio source for {participant_id}")
                source = rtc.AudioSource(audio_frame.sample_rate, audio_frame.num_channels)
                self.audio_sources[participant_id] = source
                
                # Create audio track from source
                track_name = f"translation-{participant_id}"
                logger.info(f"Creating LocalAudioTrack: {track_name}")
                track = rtc.LocalAudioTrack.create_audio_track(
                    name=track_name,
                    source=source
                )
                self.audio_tracks[participant_id] = track
                
                # Publish track to room (this publishes to ALL participants - LiveKit will route it)
                logger.info(f"Publishing audio track '{track_name}' to room...")
                await ctx.room.local_participant.publish_track(track)
                logger.info(f"✅ Published audio track '{track_name}' successfully")
            else:
                logger.info(f"Reusing existing audio source for {participant_id}")
            
            source = self.audio_sources[participant_id]
            
            # Push audio frame to source
            logger.info(f"Pushing audio frame to source (samples: {audio_frame.samples_per_channel})...")
            await source.capture_frame(audio_frame)
            logger.info(f"✅ Published translated audio for {participant_id}: '{text[:50]}...'")
                
        except Exception as e:
            logger.error(f"❌ Error generating/publishing translated audio: {e}", exc_info=True)
    
    async def create_voiceassistant_for_participant(
        self,
        ctx: JobContext,
        participant_id: str,
        target_language: str,
        source_participant_id: str = None
    ):
        """Create an AgentSession (VoiceAssistant) for a participant
        
        Args:
            participant_id: The participant who wants translation
            target_language: Target language for translation
            source_participant_id: The participant whose audio to translate (if None, translates all)
        """
        try:
            # Create unique key for this translation pair
            assistant_key = f"{participant_id}:{source_participant_id or 'all'}"
            
            # Stop existing assistant if any
            if assistant_key in self.assistants:
                session = self.assistants.pop(assistant_key)
                await session.aclose()
            
            logger.info(f"Creating VoiceAssistant: translating {source_participant_id or 'all'} -> {target_language} for {participant_id}")
            
            # Language name mapping
            language_names = {
                'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
                'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian',
                'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
                'ar': 'Arabic', 'hi': 'Hindi'
            }
            target_lang_name = language_names.get(target_language, target_language)
            
            # Create translation context
            translation_ctx = llm.ChatContext().append(
                role="system",
                text=(
                    f"You are a real-time translator. Translate all speech to {target_lang_name}. "
                    f"Output ONLY the translation, no explanations. Maintain the original tone and style."
                )
            )
            
            # Create AgentSession (VoiceAssistant) with OpenAI services
            session = AgentSession(
                vad=silero.VAD.load(),  # Voice Activity Detection - auto-detects pauses
                stt=openai.STT(
                    api_key=self.openai_api_key,
                    model="whisper-1",
                    language=None  # Auto-detect source language
                ),
                llm=openai.LLM(
                    api_key=self.openai_api_key,
                    model="gpt-4o-mini"  # Faster and cheaper for translation
                ),
                tts=openai.TTS(
                    api_key=self.openai_api_key,
                    model="tts-1-hd",
                    voice="alloy"  # Use same voice as manual mode
                ),
                allow_interruptions=True,  # Pause when user speaks
            )
            
            # Create Agent with translation instructions
            agent = Agent(
                instructions=translation_ctx.messages[-1].content,  # Use the system message
                chat_ctx=translation_ctx,
            )
            
            # Set up event handlers for transcriptions
            from livekit.agents.voice.events import UserInputTranscribedEvent, SpeechCreatedEvent
            
            @session.on("user_input_transcribed")
            def on_user_speech(event: UserInputTranscribedEvent):
                """Handle when user speech is transcribed"""
                text = event.transcript
                logger.info(f"[{participant_id}] Original speech: {text[:100]}...")
                # Send original transcription via data channel
                asyncio.create_task(
                    self.send_transcription_data(ctx, participant_id, text, text, target_language)
                )
            
            @session.on("speech_created")
            def on_agent_speech(event: SpeechCreatedEvent):
                """Handle when translation is spoken"""
                # Get the speech text from the event
                if hasattr(event, 'text') and event.text:
                    translated_text = event.text
                    logger.info(f"[{participant_id}] Translated ({target_language}): {translated_text[:100]}...")
                    # Send translated transcription via data channel
                    asyncio.create_task(
                        self.send_transcription_data(ctx, participant_id, translated_text, translated_text, target_language)
                    )
            
            # Find the source participant if specified
            source_participant = None
            if source_participant_id:
                for p in ctx.room.remote_participants.values():
                    if p.identity == source_participant_id:
                        source_participant = p
                        break
                if not source_participant:
                    logger.warning(f"Source participant {source_participant_id} not found, listening to all")
            
            # Start the session with the agent
            # If source_participant is specified, AgentSession will listen to that participant's audio
            if source_participant:
                session.start(agent, room=ctx.room, participant=source_participant)
            else:
                session.start(agent, room=ctx.room)
            
            # Store session with unique key
            self.assistants[assistant_key] = session
            
            logger.info(f"✅ AgentSession (VoiceAssistant) started: {source_participant_id or 'all'} -> {target_language} for {participant_id}")
            
        except Exception as e:
            logger.error(f"Error creating VoiceAssistant for {participant_id}: {e}", exc_info=True)
    
    async def stop_voiceassistant_for_participant(self, participant_id: str):
        """Stop all AgentSessions for a participant"""
        try:
            # Find all assistants for this participant
            keys_to_remove = [key for key in self.assistants.keys() if key.startswith(f"{participant_id}:")]
            for key in keys_to_remove:
                session = self.assistants.pop(key)
                await session.aclose()
                logger.info(f"Stopped AgentSession {key}")
        except Exception as e:
            logger.error(f"Error stopping AgentSession for {participant_id}: {e}", exc_info=True)
    
    async def send_transcription_data(
        self,
        ctx: JobContext,
        participant_id: str,
        original_text: str,
        translated_text: str,
        language: str
    ):
        """Send transcription via data channel (used by VoiceAssistant)"""
        try:
            message = json.dumps({
                "type": "transcription",
                "text": translated_text,
                "originalText": original_text,
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
            logger.debug(f"Sent transcription to {participant_id}")
        except Exception as e:
            logger.error(f"Failed to send transcription: {e}")


async def main(ctx: JobContext):
    """Main entry point"""
    logger.info("=" * 50)
    logger.info("AGENT ENTRYPOINT CALLED!")
    logger.info(f"Room: {ctx.room.name}")
    logger.info("=" * 50)
    agent = TranslationAgent()
    await agent.entrypoint(ctx)


if __name__ == "__main__":
    # Use named agent "translation-bot" to prevent duplicate dispatches
    # Set AGENT_NAME=translation-bot in .env, or default to "translation-bot"
    agent_name = os.getenv('AGENT_NAME', 'translation-bot')  # Default to named agent
    logger.info(f"Starting agent with name: '{agent_name}'")
    logger.info(f"LiveKit URL: {os.getenv('LIVEKIT_URL', 'wss://jayme-rhmomj8r.livekit.cloud')}")
    
    # Build WorkerOptions
    worker_opts = {
        'entrypoint_fnc': main,
        'api_key': os.getenv('LIVEKIT_API_KEY'),
        'api_secret': os.getenv('LIVEKIT_API_SECRET'),
        'ws_url': os.getenv('LIVEKIT_URL', 'wss://jayme-rhmomj8r.livekit.cloud'),
        'agent_name': agent_name,  # Always set agent_name to use named agent
    }
    
    # Run the agent
    cli.run_app(WorkerOptions(**worker_opts))
