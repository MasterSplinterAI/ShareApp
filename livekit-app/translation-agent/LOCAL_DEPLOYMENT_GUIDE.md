# Local Deployment Guide - Turn Detector Upgrade

This guide walks you through deploying the upgraded agent with contextual turn detector support locally for testing.

## Prerequisites

- Python 3.11+ with virtual environment
- LiveKit credentials (API key, secret, URL)
- OpenAI API key (for Realtime API)
- Deepgram API key (optional - for turn detector, or use LiveKit Inference routing)

## Step 1: Install Dependencies

```bash
cd livekit-app/translation-agent
source venv/bin/activate  # or: python -m venv venv && source venv/bin/activate

# Install base requirements
pip install -r requirements.txt

# Or install turn detector dependencies manually:
pip install "livekit-plugins-turn-detector>=0.1.0"
pip install "livekit-plugins-deepgram>=0.6.0"
```

## Step 2: Download Turn Detector Model Weights

**Option A: Use setup script (recommended)**
```bash
./setup_turn_detector.sh
```

**Option B: Manual download**
```bash
python -m livekit.plugins.turn_detector.multilingual download
```

**Note:** Model weights are ~500MB and will be cached locally after first download.

## Step 3: Configure Environment Variables

Create or update `.env` file in `livekit-app/translation-agent/`:

```bash
# LiveKit Configuration (required)
LIVEKIT_URL=wss://production-uiycx4ku.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret

# Agent Configuration
AGENT_NAME=translation-bot-dev

# OpenAI (required for Realtime API)
OPENAI_API_KEY=your_openai_key

# Deepgram (optional - for turn detector)
# If not set, agent will use LiveKit Inference routing (requires cloud deployment)
DEEPGRAM_API_KEY=your_deepgram_key
```

## Step 4: Verify Setup

Test that all plugins are available:

```bash
python -c "
from livekit.plugins.turn_detector.multilingual import MultilingualModel
from livekit.plugins import deepgram
print('✅ Turn detector: Available')
print('✅ Deepgram: Available')
"
```

If you see errors, install missing packages:
```bash
pip install "livekit-plugins-turn-detector>=0.1.0"
pip install "livekit-plugins-deepgram>=0.6.0"
```

## Step 5: Start Agent Locally

**Option A: Using startup script**
```bash
cd livekit-app
./start_local.sh
```

**Option B: Manual start**
```bash
cd livekit-app/translation-agent
source venv/bin/activate
export AGENT_NAME=translation-bot-dev
python realtime_agent_simple.py dev
```

## Step 6: Verify Agent Connection

1. **Check agent logs** - You should see:
   ```
   ✅ Contextual Turn Detector enabled (semantic understanding)
   - Deepgram STT: API key available (or LiveKit Inference routing)
   ```

2. **Check backend logs** - Backend should dispatch to `translation-bot-dev`:
   ```
   ✅ Agent "translation-bot-dev" dispatched to room <room-name>
   ```

3. **Test in browser:**
   - Create a room via frontend
   - Join with multiple participants
   - Speak and verify translations work
   - Check that natural pauses don't trigger false interruptions

## Troubleshooting

### Turn Detector Not Enabled

**Symptom:** Logs show "Turn detector: ❌ Disabled"

**Solutions:**
1. Check if plugins are installed:
   ```bash
   pip list | grep turn-detector
   pip list | grep deepgram
   ```

2. Check if model weights are downloaded:
   ```bash
   python -m livekit.plugins.turn_detector.multilingual download
   ```

3. Check Deepgram API key (or use LiveKit Inference):
   - If `DEEPGRAM_API_KEY` not set and not on LiveKit Cloud, turn detector will be disabled
   - This is OK - agent will use fallback (server_vad + Silero)

### Import Errors

**Symptom:** `ImportError: cannot import name 'MultilingualModel'`

**Solution:**
```bash
pip install --upgrade "livekit-plugins-turn-detector>=0.1.0"
```

### Model Download Fails

**Symptom:** `Error downloading model weights`

**Solutions:**
1. Check internet connection
2. Try manual download:
   ```bash
   python -m livekit.plugins.turn_detector.multilingual download
   ```
3. Check disk space (model is ~500MB)
4. Agent will still work with fallback if download fails

### Deepgram Connection Issues

**Symptom:** `Failed to initialize turn detector: Deepgram connection error`

**Solutions:**
1. Verify `DEEPGRAM_API_KEY` is correct
2. If on LiveKit Cloud, ensure LiveKit Inference is enabled
3. Check network connectivity
4. Agent will fallback to server_vad if Deepgram unavailable

## Expected Behavior

### With Turn Detector Enabled:
- ✅ Fewer false interruptions during natural pauses
- ✅ Better handling of filler words ("um...", "uh...")
- ✅ Smoother conversations with thoughtful speakers
- ✅ Logs show: "Contextual Turn Detector: ✅ ENABLED"

### With Turn Detector Disabled (Fallback):
- ✅ Still works with server_vad + Silero VAD
- ✅ Still blocks coughs and short noises effectively
- ✅ Logs show: "Contextual Turn Detector: ❌ Disabled (using fallback)"

## Testing Checklist

- [ ] Agent starts without errors
- [ ] Turn detector model weights downloaded
- [ ] Logs show turn detector status (enabled or fallback)
- [ ] Backend dispatches agent successfully
- [ ] Frontend can create rooms
- [ ] Translations work correctly
- [ ] Natural pauses don't trigger false interruptions
- [ ] Coughs/noise still filtered effectively

## Next Steps

After local testing:
1. Verify all features work as expected
2. Test with multiple speakers and languages
3. Monitor logs for any issues
4. Deploy to cloud when ready (see `UPDATE_CLOUD_AGENT.md`)

## Notes

- **Backward Compatibility:** Agent works fine without turn detector (uses fallback)
- **Performance:** Turn detector adds ~50-100ms latency but improves naturalness significantly
- **Cost:** Deepgram STT adds cost, but LiveKit Inference can route it (unified billing on cloud)
- **Model Size:** Turn detector model weights are ~500MB (downloaded once, cached locally)

