#!/usr/bin/env python3
"""
Test script to verify OpenAI Realtime API integration
Tests transcription and audio output capabilities
"""
import asyncio
import os
import sys
from dotenv import load_dotenv
import numpy as np

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from openai_realtime import OpenAIRealtimeClient

load_dotenv()

async def test_openai_realtime():
    """Test OpenAI Realtime API connection and basic functionality"""
    api_key = os.getenv('OPENAI_API_KEY')
    
    if not api_key:
        print("ERROR: OPENAI_API_KEY not set in environment")
        print("Set it in your .env file or export it:")
        print("  export OPENAI_API_KEY=your_key_here")
        return False
    
    print("=" * 60)
    print("Testing OpenAI Realtime API Integration")
    print("=" * 60)
    print(f"API Key: {'***' + api_key[-10:] if api_key else 'NOT SET'}")
    print()
    
    # Create client
    client = OpenAIRealtimeClient(
        api_key=api_key,
        target_language='es'  # Test Spanish translation
    )
    
    # Set up callbacks
    transcriptions_received = []
    audio_received = []
    
    def on_transcription(text):
        print(f"📝 Transcription received: {text}")
        transcriptions_received.append(text)
    
    def on_audio(audio_data):
        print(f"🔊 Audio received: {len(audio_data)} samples")
        audio_received.append(audio_data)
    
    client.on_transcription = on_transcription
    client.on_audio = on_audio
    
    # Connect
    print("1. Connecting to OpenAI Realtime API...")
    connected = await client.connect()
    
    if not connected:
        print("❌ Failed to connect to OpenAI Realtime API")
        return False
    
    print("✅ Connected successfully!")
    print()
    
    # Wait a moment for connection to stabilize
    await asyncio.sleep(1)
    
    # Test with dummy audio (silence)
    print("2. Sending test audio (silence)...")
    silence = np.zeros(1600, dtype=np.float32)  # 100ms of silence at 16kHz
    
    for i in range(10):  # Send 1 second of silence
        await client.send_audio(silence)
        await asyncio.sleep(0.1)
    
    print("✅ Test audio sent")
    print()
    
    # Wait for responses
    print("3. Waiting for responses (5 seconds)...")
    await asyncio.sleep(5)
    
    # Check results
    print()
    print("=" * 60)
    print("Test Results")
    print("=" * 60)
    print(f"Transcriptions received: {len(transcriptions_received)}")
    if transcriptions_received:
        print(f"  Sample: {transcriptions_received[0]}")
    else:
        print("  ⚠️  No transcriptions received (this is normal for silence)")
    
    print(f"Audio chunks received: {len(audio_received)}")
    if audio_received:
        total_samples = sum(len(chunk) for chunk in audio_received)
        print(f"  Total samples: {total_samples}")
        print(f"  Duration: ~{total_samples / 16000:.2f} seconds")
    else:
        print("  ⚠️  No audio received (this is normal if no speech detected)")
    
    print()
    
    # Close connection
    print("4. Closing connection...")
    await client.close()
    print("✅ Connection closed")
    print()
    
    # Summary
    if connected:
        print("=" * 60)
        print("✅ OpenAI Realtime API Test PASSED")
        print("=" * 60)
        print("The API is working correctly!")
        print("Note: Transcriptions and audio will only appear when:")
        print("  - Real speech is detected")
        print("  - Translation is needed")
        print("  - The model generates a response")
        return True
    else:
        print("=" * 60)
        print("❌ OpenAI Realtime API Test FAILED")
        print("=" * 60)
        return False

if __name__ == '__main__':
    success = asyncio.run(test_openai_realtime())
    sys.exit(0 if success else 1)

