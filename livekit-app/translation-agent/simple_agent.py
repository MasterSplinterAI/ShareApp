#!/usr/bin/env python
"""
Simple LiveKit Translation Agent
Basic implementation that connects to rooms and handles translation requests
"""
import os
import asyncio
import logging
import json
from typing import Optional
from dotenv import load_dotenv

from livekit import agents, rtc
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
)

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=getattr(logging, os.getenv('LOG_LEVEL', 'INFO')),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def entrypoint(ctx: JobContext):
    """Main entry point for the agent"""
    logger.info(f"Translation agent starting in room: {ctx.room.name}")
    logger.info(f"Room SID: {ctx.room.sid}")
    logger.info(f"Participants: {len(ctx.room.participants)}")
    
    # Connect to room with audio subscription
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    
    logger.info(f"Agent connected as: {ctx.room.local_participant.identity}")
    
    # Track participant language preferences
    participant_languages = {}
    
    # Handle participant events
    @ctx.room.on("participant_connected")
    def on_participant_connected(participant: rtc.RemoteParticipant):
        logger.info(f"Participant connected: {participant.identity} (SID: {participant.sid})")
        participant_languages[participant.sid] = {'language': 'en', 'enabled': False}
    
    @ctx.room.on("participant_disconnected")
    def on_participant_disconnected(participant: rtc.RemoteParticipant):
        logger.info(f"Participant disconnected: {participant.identity}")
        participant_languages.pop(participant.sid, None)
    
    # Handle data messages for language preferences
    @ctx.room.on("data_received")
    def on_data_received(data: rtc.DataPacket):
        """Handle language preference updates from frontend"""
        try:
            if data.topic == "language_preference":
                pref_data = json.loads(data.data.decode('utf-8'))
                participant_id = pref_data.get('participant_id')
                target_lang = pref_data.get('target_language', 'en')
                enabled = pref_data.get('translation_enabled', False)
                
                logger.info(f"Language preference update: {participant_id} -> {target_lang}, enabled: {enabled}")
                
                if participant_id:
                    participant_languages[participant_id] = {
                        'language': target_lang,
                        'enabled': enabled
                    }
                    
                    # Send acknowledgment back
                    ack_data = {
                        'type': 'translation_status',
                        'participant_id': participant_id,
                        'status': 'active' if enabled else 'inactive',
                        'language': target_lang
                    }
                    
                    asyncio.create_task(send_data_to_room(ctx, ack_data))
                    
        except Exception as e:
            logger.error(f"Error processing data packet: {e}")
    
    # Handle audio tracks
    @ctx.room.on("track_subscribed")
    def on_track_subscribed(
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ):
        if track.kind == rtc.TrackKind.AUDIO:
            logger.info(f"Subscribed to audio from {participant.identity}")
            # In a full implementation, you would process audio here
            # For now, just log that we're receiving audio
    
    logger.info("Translation agent is running and listening for events...")
    
    # Keep the agent running
    while True:
        await asyncio.sleep(10)
        active_translations = sum(1 for p in participant_languages.values() if p.get('enabled'))
        if active_translations > 0:
            logger.info(f"Active translations: {active_translations}")


async def send_data_to_room(ctx: JobContext, data: dict):
    """Send data message to all participants"""
    try:
        encoded_data = json.dumps(data).encode('utf-8')
        await ctx.room.local_participant.publish_data(
            encoded_data,
            reliable=True,
            topic="translation"
        )
        logger.debug(f"Sent data: {data}")
    except Exception as e:
        logger.error(f"Error sending data: {e}")


def main():
    """Main entry point"""
    print("=" * 60)
    print("LiveKit Simple Translation Agent")
    print("=" * 60)
    print(f"LiveKit URL: {os.getenv('LIVEKIT_URL', 'NOT SET')}")
    print(f"LiveKit API Key: {'SET' if os.getenv('LIVEKIT_API_KEY') else 'NOT SET'}")
    print(f"OpenAI API Key: {'SET' if os.getenv('OPENAI_API_KEY') else 'NOT SET'}")
    print("=" * 60)
    print("")
    print("Agent Features:")
    print("- Connects to LiveKit rooms")
    print("- Tracks participant language preferences")
    print("- Monitors audio streams")
    print("- Ready for translation implementation")
    print("")
    print("Starting agent...")
    print("")
    
    # Configure worker
    worker_opts = WorkerOptions(
        entrypoint_fnc=entrypoint,
        api_key=os.getenv('LIVEKIT_API_KEY'),
        api_secret=os.getenv('LIVEKIT_API_SECRET'),
        ws_url=os.getenv('LIVEKIT_URL'),
    )
    
    try:
        asyncio.run(cli.run_app(worker_opts))
    except KeyboardInterrupt:
        print("\nAgent stopped")
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
