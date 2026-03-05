# Pipeline vs Realtime Translation Agent Comparison

## Overview

We have two translation agent implementations:

1. **Realtime Agent** (`realtime_agent_simple.py`) - Uses OpenAI Realtime API
2. **Pipeline Agent** (`pipeline_translation_agent.py`) - Uses STT → LLM → TTS pipeline

## Key Differences

### Realtime Agent (Current Production)

**Architecture:**
- Uses `RealtimeModel` from `livekit.plugins.openai.realtime`
- Single unified model handles STT, translation, and TTS
- Built-in translation capabilities (auto-detects and translates)

**Pros:**
- ✅ Simpler code (one model handles everything)
- ✅ Better translation quality (designed for translation)
- ✅ Lower latency (single model, optimized pipeline)
- ✅ Automatic language detection
- ✅ Works well with interruptions and turn-taking

**Cons:**
- ❌ Requires OpenAI Realtime API access (may have waitlist)
- ❌ Less control over individual components
- ❌ More expensive per minute (~$0.06/min)

**Code Pattern:**
```python
realtime_model = RealtimeModel(
    model="gpt-realtime",
    voice="alloy",
    modalities=["text", "audio"],
    turn_detection=vad_config,
)
session = AgentSession(llm=realtime_model, ...)
```

### Pipeline Agent (New Approach)

**Architecture:**
- Uses separate providers: `deepgram/nova-3` (STT) → `openai/gpt-4o-mini` (LLM) → `openai/tts-1` (TTS)
- Traditional pipeline approach with explicit LLM instructions
- More granular control over each component

**Pros:**
- ✅ More flexible (can swap providers)
- ✅ Better cost control (can use cheaper providers)
- ✅ Works with LiveKit Inference (unified billing)
- ✅ Can use API keys locally for development

**Cons:**
- ❌ More complex code (manages 3 separate services)
- ❌ LLM needs explicit translation instructions (may not translate as well)
- ❌ Higher latency (3 separate API calls)
- ❌ More potential failure points

**Code Pattern:**
```python
session = AgentSession(
    stt="deepgram/nova-3",
    llm="openai/gpt-4o-mini",
    tts="openai/tts-1:alloy",
    ...
)
agent = Agent(instructions="Translate to Spanish...")
session.start(agent, ...)
```

## LiveKit Inference Integration

### Cloud Deployment (LiveKit Cloud)
When deployed to LiveKit Cloud:
- Providers automatically route through LiveKit Inference
- **No API keys needed** - unified billing through LiveKit
- Lower latency (co-located services)
- Unified concurrency management

### Local Development
When running locally:
- Providers use API keys from environment variables
- Set `DEEPGRAM_API_KEY` and `OPENAI_API_KEY` in `.env`
- Same provider strings work (`deepgram/nova-3`, `openai/gpt-4o-mini`, etc.)
- API keys are automatically detected and used

**Example `.env` for local development:**
```bash
# LiveKit
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret
LIVEKIT_URL=wss://your-project.livekit.cloud

# API Keys for local development
DEEPGRAM_API_KEY=your_deepgram_key
OPENAI_API_KEY=your_openai_key

# Agent config
AGENT_NAME=dev-traditional-pipeline
```

## Translation Quality Comparison

### Realtime Agent
- Uses OpenAI Realtime API which is **designed for translation**
- Automatically detects source language
- Produces natural, fluent translations
- Handles context and idioms well

### Pipeline Agent
- Uses GPT-4o-mini with explicit instructions
- Relies on prompt engineering for translation quality
- May need more tuning to match Realtime quality
- Current issue: LLM may not be translating (returning original text)

## Current Issues with Pipeline Agent

1. **No Translation Happening**
   - LLM returns original text instead of translated text
   - Need to improve instructions or use different approach

2. **No Audio Playback**
   - Translation tracks exist but aren't subscribed
   - Frontend needs to enable translation and select target language

3. **Duplicate Transcriptions**
   - Same text appearing multiple times
   - Need better deduplication logic

## Recommendations

### For Production
- **Use Realtime Agent** - Better translation quality, simpler code
- Already working and tested
- More expensive but better user experience

### For Development
- **Use Pipeline Agent locally** with API keys
- Test with `DEEPGRAM_API_KEY` and `OPENAI_API_KEY` set
- Can iterate faster without cloud deployment

### For Cost Optimization
- **Use Pipeline Agent** with cheaper providers
- Can mix providers (e.g., Deepgram STT + cheaper LLM)
- More control over costs

## Next Steps

1. **Fix Pipeline Agent Translation**
   - Improve LLM instructions
   - Consider using a translation-specific model
   - Test with different prompt strategies

2. **Enable Local Development**
   - Document API key setup
   - Create local development guide
   - Test with API keys

3. **Compare Performance**
   - Measure latency differences
   - Compare translation quality
   - Test with real conversations

## References

- [LiveKit Inference Blog Post](https://blog.livekit.io/introducing-livekit-inference/)
- [LiveKit Agents Documentation](https://docs.livekit.io/agents/)
- [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime)



