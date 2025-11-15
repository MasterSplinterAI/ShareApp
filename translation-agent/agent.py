"""
VideoSDK Translation Agent
Joins meetings and provides real-time bi-directional translation using OpenAI Realtime API
"""
import os
import asyncio
import numpy as np
from dotenv import load_dotenv
from videosdk import Meeting
from videosdk.plugins.openai import OpenAIRealtime, OpenAIRealtimeConfig
from videosdk.agents import RealTimePipeline
from openai.types.beta.realtime.session import TurnDetection
import config

load_dotenv()

class TranslationAgent:
    def __init__(self, meeting_id, token, source_language='auto', target_language='en'):
        self.meeting_id = meeting_id
        self.token = token
        self.source_language = source_language
        self.target_language = target_language
        self.meeting = None
        self.pipeline = None
        self.running = False
        
    async def initialize(self):
        """Initialize OpenAI Realtime model and VideoSDK meeting"""
        try:
            if not config.OPENAI_API_KEY:
                raise ValueError("OPENAI_API_KEY not set in environment")
            
            # Initialize OpenAI Realtime model
            model = OpenAIRealtime(
                model=config.OPENAI_MODEL,
                api_key=config.OPENAI_API_KEY,
                config=OpenAIRealtimeConfig(
                    voice=config.OPENAI_VOICE,
                    modalities=["text", "audio"],
                    turn_detection=TurnDetection(
                        type="server_vad",
                        threshold=0.5,
                        prefix_padding_ms=300,
                        silence_duration_ms=200,
                    ),
                    tool_choice="auto"
                )
            )
            
            # Create pipeline
            self.pipeline = RealTimePipeline(model=model)
            
            # Initialize VideoSDK meeting
            self.meeting = Meeting({
                "token": self.token,
                "meetingId": self.meeting_id,
                "participantName": config.AGENT_NAME
            })
            
            print(f"Translation agent initialized for meeting {self.meeting_id}")
            return True
        except Exception as e:
            print(f"Error initializing agent: {e}")
            return False
    
    async def join_meeting(self):
        """Join the VideoSDK meeting"""
        try:
            if not self.meeting:
                if not await self.initialize():
                    return False
            
            # Join meeting
            await self.meeting.join()
            print(f"Translation agent joined meeting {self.meeting_id}")
            
            self.running = True
            
            # Set up audio listeners
            await self.setup_audio_listeners()
            
            return True
        except Exception as e:
            print(f"Error joining meeting: {e}")
            return False
    
    async def setup_audio_listeners(self):
        """Set up listeners for participant audio streams"""
        try:
            # Listen for participant streams
            @self.meeting.on("stream-enabled")
            async def on_stream_enabled(stream):
                if stream.kind == "audio":
                    print(f"Audio stream enabled from participant {stream.participantId}")
                    await self.process_audio_stream(stream)
            
            # Listen for participant joins
            @self.meeting.on("participant-joined")
            async def on_participant_joined(participant):
                print(f"Participant {participant.id} joined")
            
            # Listen for participant leaves
            @self.meeting.on("participant-left")
            async def on_participant_left(participant):
                print(f"Participant {participant.id} left")
            
            print("Audio listeners set up")
        except Exception as e:
            print(f"Error setting up audio listeners: {e}")
    
    async def process_audio_stream(self, stream):
        """Process audio stream through OpenAI Realtime API"""
        try:
            # This is a placeholder for actual audio processing
            # In a full implementation, you would:
            # 1. Capture audio frames from the stream
            # 2. Convert to format required by OpenAI (mono, 16kHz)
            # 3. Send to OpenAI Realtime API via pipeline
            # 4. Receive translated audio/text
            # 5. Inject translated audio back into meeting
            
            print(f"Processing audio stream from {stream.participantId}")
            
            # Example: Process audio frames
            async for frame in stream.track:
                if not self.running:
                    break
                
                # Convert audio frame to numpy array
                audio_data = frame.to_ndarray()
                
                # Process through OpenAI pipeline
                # This would send to OpenAI and get translation
                # Then inject back into meeting
                
                # Placeholder: Just log for now
                # In production, implement full audio processing pipeline
                pass
                
        except Exception as e:
            print(f"Error processing audio stream: {e}")
    
    async def process_audio(self, audio_data):
        """Process audio through OpenAI Realtime API"""
        try:
            # Convert audio to format required by OpenAI
            # Process through pipeline
            # Get translated audio back
            # Inject into meeting
            
            # Placeholder implementation
            # Full implementation would:
            # 1. Convert audio_data to mono, 16kHz
            # 2. Send to pipeline.send_audio()
            # 3. Receive response from pipeline
            # 4. Extract translated audio
            # 5. Send to meeting via audio stream
            
            pass
        except Exception as e:
            print(f"Error processing audio: {e}")
    
    async def leave_meeting(self):
        """Leave the meeting"""
        try:
            self.running = False
            if self.meeting:
                await self.meeting.leave()
                print(f"Translation agent left meeting {self.meeting_id}")
        except Exception as e:
            print(f"Error leaving meeting: {e}")

async def main():
    """Main entry point for the agent"""
    meeting_id = os.getenv('MEETING_ID')
    token = os.getenv('VIDEOSDK_AUTH_TOKEN')
    
    if not meeting_id or not token:
        print("Error: MEETING_ID and VIDEOSDK_AUTH_TOKEN must be set")
        print("Set these in your .env file or as environment variables")
        return
    
    agent = TranslationAgent(meeting_id, token)
    
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
        await agent.leave_meeting()

if __name__ == '__main__':
    asyncio.run(main())
