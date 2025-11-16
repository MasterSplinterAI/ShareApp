# Multi-Participant Translation Architecture

## Overview

The translation system is designed to handle multiple participants (3-4+) with per-participant language preferences.

## How It Works

### 1. **Per-Participant Language Selection**
- Each participant selects their preferred language (what they want to hear)
- Stored in backend: `languagePreferences` Map
- Key: `${meetingId}:${participantId}`, Value: `languageCode`

### 2. **Smart Translation Logic**

**Scenario: 3 Participants**
- **Participant A**: Speaks English, wants English
- **Participant B**: Speaks Spanish, wants Spanish  
- **Participant C**: Speaks English, wants Spanish

**When Participant A speaks:**
- ✅ **For Participant A**: Skip translation (speaks English, wants English)
- ✅ **For Participant B**: Skip translation (speaks Spanish, wants Spanish - no need to translate English)
- ✅ **For Participant C**: Translate English → Spanish (wants Spanish, speaker speaks English)

**When Participant B speaks:**
- ✅ **For Participant A**: Translate Spanish → English (wants English, speaker speaks Spanish)
- ✅ **For Participant B**: Skip translation (speaks Spanish, wants Spanish)
- ✅ **For Participant C**: Translate Spanish → Spanish (already Spanish, but still translate for consistency)

### 3. **Translation Client Management**

Each `(speaker_id, listener_id)` pair gets its own OpenAI Realtime client:
- Key: `(speaker_id, listener_id)`
- Value: `OpenAIRealtimeClient` instance
- Cached to avoid recreating connections

### 4. **Audio Processing Flow**

```
1. Speaker speaks → Daily.co captures audio
2. Audio renderer callback receives audio frames
3. For each listener:
   a. Check if listener wants same language as speaker
   b. If yes → Skip (no translation needed)
   c. If no → Get/create Realtime client for (speaker, listener)
   d. Send audio to OpenAI Realtime API
   e. Receive translated transcription + audio
   f. Store transcription in backend
   g. Inject translated audio back into Daily.co call
```

### 5. **Audio Injection**

- Translated audio is injected using Daily.co's `CustomAudioTrack` and `CustomAudioSource`
- Each listener gets their own audio track: `translation-{participant_id}`
- Audio is continuously streamed to the listener

## Optimizations

### Language Matching
- **Skip translation** if `speaker_language == listener_target_language`
- Prevents unnecessary API calls and audio processing
- Reduces latency and costs

### Client Reuse
- Realtime clients are cached per `(speaker, listener)` pair
- Avoids creating new WebSocket connections for each audio frame
- Improves performance

### Solo Participant Handling
- When only one participant + bot: Still process for transcription
- Useful for testing and solo sessions

## OpenAI Configuration

The OpenAI Realtime API is configured with:
- **Instructions**: "Translate all speech to {target_language}. If input is already in {target_language}, just transcribe without translating."
- **Modalities**: Both text (transcription) and audio (translated speech)
- **Voice**: "alloy" (can be customized)
- **Sample Rate**: 16kHz (required by OpenAI)

## Performance Considerations

### Scaling to 4+ Participants
- Each `(speaker, listener)` pair = 1 OpenAI Realtime client
- 4 participants = up to 12 clients (4×3, excluding self)
- Each client maintains a WebSocket connection
- Memory: ~1-2MB per client
- API costs: Pay per second of audio processed

### Optimization Strategies
1. **Language matching**: Skip unnecessary translations
2. **Client caching**: Reuse existing connections
3. **Batch processing**: Process multiple listeners in parallel
4. **Connection pooling**: Limit concurrent connections if needed

## Testing Multi-Participant Scenarios

1. **Create meeting** with 3-4 participants
2. **Set different languages** for each participant
3. **Have each participant speak** in their native language
4. **Verify**:
   - Transcriptions appear correctly
   - Translated audio plays for listeners
   - No translation when source == target
   - Performance is acceptable

## Future Improvements

1. **WebSocket for transcriptions**: Replace polling with real-time updates
2. **Language auto-detection**: Detect speaker's language automatically
3. **Connection pooling**: Limit concurrent OpenAI connections
4. **Audio buffering**: Buffer audio for smoother playback
5. **Fallback handling**: Handle API errors gracefully

