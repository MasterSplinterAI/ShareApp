# VoiceAssistant Migration Guide

## What is VoiceAssistant?

**VoiceAssistant** is a high-level class from LiveKit's Agents SDK that handles the **entire audio pipeline automatically**:

- ✅ **Voice Activity Detection (VAD)** - Detects when speech starts/stops
- ✅ **Speech-to-Text (STT)** - Converts audio to text
- ✅ **Language Model (LLM)** - Processes/translates text
- ✅ **Text-to-Speech (TTS)** - Converts text back to audio
- ✅ **Audio Publishing** - Publishes translated audio to room automatically
- ✅ **Interruption Handling** - Pauses when user speaks
- ✅ **Turn Detection** - Knows when to process vs. wait

**You just configure it and call `start()` - that's it!**

## Current Implementation vs VoiceAssistant

### Current (Manual Implementation)
```python
# You manually handle:
1. Audio buffering (3-second buffers)
2. STT calls (Whisper API)
3. Translation (GPT API)
4. TTS generation (TTS API)
5. Audio track creation/publishing
6. Frame pushing to audio source
7. Buffer management
8. Error handling for each step

# ~900 lines of code
```

### VoiceAssistant (Automatic)
```python
# VoiceAssistant handles everything:
assistant = VoiceAssistant(
    vad=silero.VAD.load(),      # Auto-detects speech pauses
    stt=openai.STT(...),        # Handles STT automatically
    llm=openai.LLM(...),        # Handles translation automatically
    tts=openai.TTS(...),        # Handles TTS automatically
    allow_interruptions=True,   # Auto-pauses on user speech
)

assistant.start(ctx.room, participant=participant)
# That's it! Everything else is automatic.

# ~200 lines of code
```

## Migration Complexity: **MODERATE** (Not Hard!)

### Why It's Not Hard:
1. ✅ **You already have the code** - `simple_translation_agent.py` shows exactly how
2. ✅ **Same dependencies** - Uses same OpenAI STT/LLM/TTS
3. ✅ **Same language preference logic** - Keep your data channel handling
4. ✅ **Simpler code** - Less to maintain

### What Needs to Change:

#### 1. Replace Manual Audio Processing
**Current:**
```python
# Manual audio processing
async def process_speaker_audio(...):
    # Buffer audio
    # Call STT
    # Translate
    # Generate TTS
    # Publish track
    # Push frames
```

**With VoiceAssistant:**
```python
# Create assistant per participant
assistant = VoiceAssistant(...)
assistant.start(ctx.room, participant=participant)
# Done! Everything automatic
```

#### 2. Keep Language Preference Handling
**No change needed** - Your `on_data_received` handler stays the same:
```python
@ctx.room.on("data_received")
def on_data_received(data: rtc.DataPacket):
    # Parse language preference
    # Create/update VoiceAssistant with new language
    # Same logic, just create VoiceAssistant instead of manual processing
```

#### 3. Remove Manual Buffer/Track Management
**Remove:**
- `self.audio_buffers`
- `self.audio_processors`
- `self.audio_tracks`
- `self.audio_sources`
- `process_speaker_audio()`
- `process_and_translate_audio()`
- `publish_translated_audio()`

**Replace with:**
- `self.assistants: Dict[str, VoiceAssistant]` - One per participant

## Migration Steps

### Step 1: Add Silero VAD Dependency
```bash
pip install livekit-plugins-silero
```

### Step 2: Update Imports
```python
from livekit.agents import VoiceAssistant
from livekit.plugins import silero, openai
```

### Step 3: Replace Audio Processing Logic

**Before (Current):**
```python
class TranslationAgent:
    def __init__(self):
        self.audio_buffers = {}
        self.audio_processors = {}
        self.audio_tracks = {}
        self.audio_sources = {}
        
    async def process_speaker_audio(...):
        # 200+ lines of manual processing
        
    async def process_and_translate_audio(...):
        # 100+ lines of STT/translation/TTS
        
    async def publish_translated_audio(...):
        # 50+ lines of track publishing
```

**After (VoiceAssistant):**
```python
class TranslationAgent:
    def __init__(self):
        self.assistants: Dict[str, VoiceAssistant] = {}
        
    async def create_assistant_for_participant(self, ctx, participant_id, target_language):
        # Stop existing assistant
        if participant_id in self.assistants:
            await self.assistants[participant_id].shutdown()
        
        # Create translation context
        translation_ctx = llm.ChatContext().append(
            role="system",
            text=f"Translate to {target_language}. Output ONLY the translation."
        )
        
        # Create VoiceAssistant
        assistant = VoiceAssistant(
            vad=silero.VAD.load(),
            stt=openai.STT(api_key=self.openai_api_key, model="whisper-1"),
            llm=openai.LLM(api_key=self.openai_api_key, model="gpt-4o-mini"),
            tts=openai.TTS(api_key=self.openai_api_key, model="tts-1-hd", voice="alloy"),
            chat_ctx=translation_ctx,
            allow_interruptions=True,
            interrupt_speech_duration=0.5,
        )
        
        # Get participant
        participant = None
        for p in ctx.room.remote_participants.values():
            if p.identity == participant_id:
                participant = p
                break
        
        # Start assistant
        assistant.start(ctx.room, participant=participant)
        self.assistants[participant_id] = assistant
```

### Step 4: Update Language Preference Handler

**Current:**
```python
if enabled:
    # Start manual audio processing
    asyncio.create_task(self.process_speaker_audio(...))
```

**After:**
```python
if enabled:
    # Create VoiceAssistant
    await self.create_assistant_for_participant(ctx, participant_id, language)
```

### Step 5: Cleanup on Participant Disconnect

**Current:**
```python
# Clean up buffers, tracks, sources
```

**After:**
```python
if participant_id in self.assistants:
    await self.assistants[participant_id].shutdown()
    del self.assistants[participant_id]
```

## Estimated Migration Time

- **Simple migration:** 2-3 hours
- **With testing:** 4-6 hours
- **Complexity:** Moderate (not hard, but requires careful refactoring)

## Benefits After Migration

1. ✅ **~70% less code** (900 lines → ~250 lines)
2. ✅ **Automatic pause detection** (no more 3-second buffers)
3. ✅ **Lower latency** (processes in real-time)
4. ✅ **Built-in interruption handling**
5. ✅ **Less maintenance** (LiveKit handles edge cases)
6. ✅ **Better error handling** (built into VoiceAssistant)

## Example: Complete Migration

See `simple_translation_agent.py` for a working example - it's already using VoiceAssistant!

## Recommendation

**For MVP:** Current implementation works fine - keep it.

**For Production:** Migrate to VoiceAssistant for:
- Better user experience (lower latency)
- Less code to maintain
- Built-in features (interruptions, VAD, etc.)

## Quick Start Migration

If you want to try it, I can help you migrate `realtime_agent.py` to use VoiceAssistant. It would involve:

1. Creating a new file `realtime_agent_voiceassistant.py`
2. Keeping your language preference logic
3. Replacing audio processing with VoiceAssistant
4. Testing side-by-side with current implementation

Would you like me to create a migrated version?

