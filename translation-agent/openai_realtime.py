"""
OpenAI Realtime API Client for Translation
Handles WebSocket connection and audio streaming to OpenAI Realtime API
"""
import asyncio
import json
import base64
import websockets
import os
from typing import Optional, Callable, Dict, Any
import numpy as np

class OpenAIRealtimeClient:
    """Client for OpenAI Realtime API WebSocket connection"""
    
    def __init__(self, api_key: str, target_language: str = 'en'):
        self.api_key = api_key
        self.target_language = target_language
        self.websocket: Optional[Any] = None  # websockets.WebSocketClientProtocol
        self.running = False
        self.audio_buffer = []
        self.on_transcription: Optional[Callable] = None
        self.on_audio: Optional[Callable] = None
        
    async def connect(self):
        """Connect to OpenAI Realtime API"""
        try:
            # Use the correct model name - check OpenAI docs for latest
            # Model options: gpt-4o-realtime-preview-2024-12-17 or gpt-4o-realtime-preview-2024-10-01
            uri = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01"
            
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "OpenAI-Beta": "realtime=v1"
            }
            
            # websockets 15.0+ uses additional_headers - convert dict to list of tuples
            header_list = list(headers.items())
            
            print(f"Attempting to connect to OpenAI Realtime API...", flush=True)
            print(f"URI: {uri}", flush=True)
            print(f"Headers: {list(headers.keys())}", flush=True)
            
            try:
                # Use asyncio.wait_for with a shorter timeout for faster failure detection
                # websockets 15.0+ uses additional_headers
                self.websocket = await asyncio.wait_for(
                    websockets.connect(
                        uri, 
                        additional_headers=header_list,
                        ping_interval=20,  # Send ping every 20 seconds
                        ping_timeout=10,   # Wait 10 seconds for pong
                        close_timeout=10   # Wait 10 seconds for close
                    ),
                    timeout=15  # Reduced to 15 seconds for faster failure
                )
                print(f"WebSocket connection established", flush=True)
            except asyncio.TimeoutError as e:
                print(f"Connection timeout after 15 seconds: {e}", flush=True)
                # Try once more with a fresh attempt
                try:
                    print(f"Retrying connection...", flush=True)
                    self.websocket = await asyncio.wait_for(
                        websockets.connect(
                            uri, 
                            additional_headers=header_list,
                            ping_interval=20,
                            ping_timeout=10,
                            close_timeout=10
                        ),
                        timeout=15
                    )
                    print(f"WebSocket connection established on retry", flush=True)
                except Exception as retry_error:
                    print(f"Retry also failed: {retry_error}", flush=True)
                    raise Exception(f"Connection timeout - OpenAI Realtime API not responding: {retry_error}")
            except Exception as e:
                print(f"Connection error: {type(e).__name__}: {e}", flush=True)
                import traceback
                traceback.print_exc()
                raise
            
            self.running = True
            
            # Send session configuration
            print(f"Sending session configuration...", flush=True)
            await self._send_config()
            
            # Start listening for responses
            asyncio.create_task(self._listen_for_responses())
            
            print("Connected to OpenAI Realtime API", flush=True)
            return True
        except Exception as e:
            print(f"Error connecting to OpenAI Realtime API: {e}", flush=True)
            import traceback
            traceback.print_exc()
            return False
    
    async def _send_config(self):
        """Send session configuration"""
        config = {
            "type": "session.update",
            "session": {
                "modalities": ["text", "audio"],
                "instructions": f"You are a real-time translation assistant. Translate all speech to {self.target_language}. Always provide BOTH transcription AND audio output. Only output the translation, no explanations. If the input is already in {self.target_language}, just transcribe it without translating but still provide audio output.",
                "voice": "alloy",
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm16",
                "input_audio_transcription": {
                    "model": "whisper-1"
                },
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": 0.5,
                    "prefix_padding_ms": 300,
                    "silence_duration_ms": 500
                },
                "temperature": 0.8,
                "max_response_output_tokens": 4096
            }
        }
        
        await self.websocket.send(json.dumps(config))
    
    async def send_audio(self, audio_data: np.ndarray):
        """Send audio data to OpenAI Realtime API"""
        if not self.running or not self.websocket:
            return
        
        try:
            # Convert numpy array to base64-encoded PCM16
            # Ensure audio is int16 format
            if audio_data.dtype != np.int16:
                # Normalize to [-1, 1] range and convert to int16
                audio_normalized = np.clip(audio_data, -1.0, 1.0)
                audio_int16 = (audio_normalized * 32767).astype(np.int16)
            else:
                audio_int16 = audio_data
            
            # Convert to bytes
            audio_bytes = audio_int16.tobytes()
            
            # Base64 encode
            audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
            
            # Send audio buffer append message
            message = {
                "type": "input_audio_buffer.append",
                "audio": audio_b64
            }
            
            await self.websocket.send(json.dumps(message))
        except Exception as e:
            print(f"Error sending audio to OpenAI: {e}")
    
    async def _listen_for_responses(self):
        """Listen for responses from OpenAI Realtime API"""
        try:
            async for message in self.websocket:
                if not self.running:
                    break
                
                try:
                    data = json.loads(message)
                    await self._handle_response(data)
                except json.JSONDecodeError as e:
                    print(f"Error parsing JSON response: {e}")
                except Exception as e:
                    print(f"Error handling response: {e}")
        except websockets.exceptions.ConnectionClosed:
            print("WebSocket connection closed")
            self.running = False
        except Exception as e:
            print(f"Error in response listener: {e}")
            self.running = False
    
    async def _handle_response(self, data: Dict[str, Any]):
        """Handle response from OpenAI Realtime API"""
        response_type = data.get("type")
        
        if response_type == "response.audio_transcript.delta":
            # Transcription delta
            delta = data.get("delta", "")
            if delta and self.on_transcription:
                self.on_transcription(delta)
        
        elif response_type == "response.audio_transcript.done":
            # Transcription complete
            transcript = data.get("transcript", "")
            print(f"Transcription complete: {transcript}")
        
        elif response_type == "response.audio.delta":
            # Audio delta - translated audio
            audio_b64 = data.get("delta", "")
            if audio_b64 and self.on_audio:
                try:
                    # Decode base64 audio
                    audio_bytes = base64.b64decode(audio_b64)
                    # Convert to numpy array (int16 PCM)
                    audio_array = np.frombuffer(audio_bytes, dtype=np.int16)
                    # Convert to float32 for Daily.co
                    audio_float = audio_array.astype(np.float32) / 32767.0
                    # Call the audio callback
                    self.on_audio(audio_float)
                    # Log occasionally
                    import random
                    if random.random() < 0.1:  # Log 10% of the time
                        print(f"Received audio delta: {len(audio_bytes)} bytes, shape={audio_float.shape}", flush=True)
                except Exception as e:
                    print(f"Error processing audio delta: {e}", flush=True)
        
        elif response_type == "response.audio.done":
            # Audio complete
            print("Audio response complete")
        
        elif response_type == "response.done":
            # Response complete
            print("Response complete")
        
        elif response_type == "error":
            # Error occurred
            error = data.get("error", {})
            print(f"OpenAI Realtime API error: {error}")
        
        elif response_type == "conversation.item.input_audio_transcription.completed":
            # Input transcription completed
            transcript = data.get("transcript", "")
            print(f"Input transcription: {transcript}")
    
    async def close(self):
        """Close the WebSocket connection"""
        self.running = False
        if self.websocket:
            await self.websocket.close()
            self.websocket = None
        print("Disconnected from OpenAI Realtime API")

