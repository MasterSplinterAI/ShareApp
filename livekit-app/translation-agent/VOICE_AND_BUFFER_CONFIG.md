# Voice Selection & Buffer Configuration

## Voice Selection

### Current Configuration
The voice is specified in `realtime_agent.py` line 57-61:

```python
self.tts = openai.TTS(
    api_key=self.openai_api_key,
    model="tts-1-hd",
    voice="alloy",  # Change this to any OpenAI voice
)
```

### Available OpenAI TTS Voices

OpenAI provides **6 voices** for TTS:

| Voice | Gender | Description |
|-------|--------|-------------|
| **alloy** | Male | Balanced, clear male voice |
| **echo** | Male | Deep, resonant male voice |
| **fable** | Male | Warm, expressive male voice |
| **onyx** | Male | Strong, authoritative male voice |
| **nova** | Female | Natural, conversational female voice |
| **shimmer** | Female | Soft, gentle female voice |

**Current setting:** `"alloy"` (male voice)

**To change:** Simply update the `voice` parameter:
```python
voice="nova"      # Female voice (was default)
voice="alloy"     # Male voice (current)
voice="shimmer"   # Female voice
voice="echo"      # Male voice
```

### Per-Participant Voice Selection (Future Enhancement)

Currently, all participants get the same voice. To allow per-participant voice selection:

```python
# Store voice preference per participant
self.participant_voices: Dict[str, str] = {}

# When creating TTS for a participant:
voice = self.participant_voices.get(participant_id, "alloy")
tts = openai.TTS(api_key=self.openai_api_key, model="tts-1-hd", voice=voice)
```

## Buffer Configuration

### Current Implementation: 3-Second Fixed Buffer

**Location:** `realtime_agent.py` line 437-440

```python
buffer_duration = 3.0  # Buffer 3 seconds of audio before processing

async def process_buffer_periodically():
    while speaker_id in self.audio_processors:
        await asyncio.sleep(buffer_duration)  # Wait 3 seconds
        # Process buffered audio
```

**How it works:**
1. Collects audio frames for 3 seconds
2. Processes the entire buffer (STT → Translation → TTS)
3. Sends translation
4. Repeats

**Pros:**
- Simple and predictable
- Works reliably
- Good for longer sentences

**Cons:**
- Fixed delay (always 3 seconds minimum)
- May wait too long for short phrases
- May cut off longer sentences
- Not optimal for real-time conversation

### Better Options

#### Option 1: Use LiveKit's VoiceAssistant (Recommended)

LiveKit's `VoiceAssistant` class handles this automatically with:
- **VAD (Voice Activity Detection)** - Detects when speech starts/stops
- **Turn detection** - Knows when to process vs. wait
- **Interruption handling** - Pauses when user speaks
- **Lower latency** - Processes in real-time, not fixed buffers

```python
from livekit.agents import VoiceAssistant
from livekit.plugins import silero, openai

assistant = VoiceAssistant(
    vad=silero.VAD.load(),  # Auto-detects speech pauses
    stt=openai.STT(...),
    llm=openai.LLM(...),
    tts=openai.TTS(...),
    allow_interruptions=True,
    interrupt_speech_duration=0.5,  # Pause after 0.5s of user speech
)
```

**Benefits:**
- ✅ Automatic pause detection
- ✅ Lower latency (no fixed 3-second wait)
- ✅ Natural conversation flow
- ✅ Handles interruptions automatically

#### Option 2: Use OpenAI Realtime API

OpenAI's Realtime API provides:
- **Server-side VAD** - Detects speech boundaries automatically
- **Turn detection** - Built-in pause detection
- **Ultra-low latency** - Processes audio in real-time
- **Native multilingual** - Better language detection

```python
from livekit.plugins.openai import realtime

model = realtime.RealtimeModel(
    turn_detection=realtime.ServerVadOptions(
        threshold=0.5,
        prefix_padding_ms=300,
        silence_duration_ms=500,  # Auto-detect pauses
    ),
)
```

**Benefits:**
- ✅ Automatic pause detection
- ✅ Lower latency
- ✅ Better language detection
- ✅ More natural flow

#### Option 3: Improve Current Buffer with VAD

Add VAD to current implementation:

```python
from livekit.plugins import silero

vad = silero.VAD.load()

async def process_buffer_periodically():
    silence_count = 0
    while speaker_id in self.audio_processors:
        await asyncio.sleep(0.1)  # Check every 100ms
        
        if speaker_id in self.audio_buffers and len(self.audio_buffers[speaker_id]) > 0:
            # Check last frame for voice activity
            last_frame = self.audio_buffers[speaker_id][-1]
            has_voice = vad(last_frame)
            
            if has_voice:
                silence_count = 0
            else:
                silence_count += 1
                # If silence for 500ms, process buffer
                if silence_count >= 5:  # 5 * 100ms = 500ms
                    # Process buffer
                    buffer_to_process = list(self.audio_buffers[speaker_id])
                    self.audio_buffers[speaker_id] = []
                    await self.process_and_translate_audio(...)
                    silence_count = 0
```

**Benefits:**
- ✅ Keeps current architecture
- ✅ Reduces latency (processes on pause, not fixed 3s)
- ✅ More natural flow

## Recommendations

### For MVP (Current):
- ✅ **Voice:** `"alloy"` (male) or `"nova"` (female) - both sound natural
- ✅ **Buffer:** 3-second fixed buffer works, but not optimal

### For Production:
- 💡 **Voice:** Allow user selection or use `"alloy"` as default
- 💡 **Buffer:** Migrate to `VoiceAssistant` for:
  - Automatic pause detection
  - Lower latency
  - Better user experience
  - Natural conversation flow

## Quick Changes

### Change Voice (Immediate):
Edit `realtime_agent.py` line 60:
```python
voice="alloy"   # Male (current)
voice="nova"    # Female
voice="shimmer" # Female (softer)
```

### Reduce Buffer Duration (Quick Fix):
Edit `realtime_agent.py` line 437:
```python
buffer_duration = 1.5  # Reduce from 3.0 to 1.5 seconds
```

**Note:** Lower buffer = faster response but may cut off longer sentences.

### Best Solution (Recommended):
Migrate to `VoiceAssistant` class for automatic pause detection and lower latency.

