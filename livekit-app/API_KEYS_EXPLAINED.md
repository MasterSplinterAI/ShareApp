# API Keys Explained: What You Actually Need

## Short Answer
**LiveKit does NOT provide AI/translation services.** You need:
1. **LiveKit API keys** - For video/audio infrastructure ✅ (You have these)
2. **AI service keys** - For translation features (OpenAI, Google, etc.)

## What Each Service Does

### LiveKit Cloud ($0.004/min)
- ✅ Video conferencing infrastructure
- ✅ WebRTC connections
- ✅ Room management
- ✅ Agent hosting framework
- ❌ **Does NOT include:** STT, translation, or TTS

### OpenAI API (Your existing key works!)
- ✅ Whisper: Speech-to-Text ($0.006/min)
- ✅ GPT-4: Translation ($0.002/min)
- ✅ TTS: Text-to-Speech ($0.015/min)

## Your Options

### Option 1: Full Translation (Recommended)
Use your existing OpenAI API key:
```env
OPENAI_API_KEY=sk-...your_existing_key
```
Total cost: ~$0.027/min (cheaper than your current Daily.co setup!)

### Option 2: Video Only (No Translation)
Just use LiveKit - no AI keys needed:
- Full video conferencing works
- Screen sharing works
- Chat works
- Just no translation

### Option 3: Mix and Match
You could use:
- OpenAI for some features
- Google Translate API (cheaper for translation)
- Azure Cognitive Services
- Any combination you prefer

## Why This Confusion?

LiveKit markets their "AI capabilities" but what they mean is:
- They provide the **framework** to run AI agents
- They provide **plugins** for AI services
- But you bring your own API keys

Think of it like:
- LiveKit = The highway system
- Your AI APIs = The cars driving on it

## Cost Comparison with Your Current Setup

### Current (Daily.co + OpenAI Realtime)
```
Daily.co:        $0.004/min
OpenAI Realtime: $0.060/min  ← Expensive!
Total:           $0.064/min
```

### New (LiveKit + OpenAI APIs)
```
LiveKit:         $0.004/min
OpenAI Whisper:  $0.006/min
OpenAI GPT-4:    $0.002/min
OpenAI TTS:      $0.015/min
Total:           $0.027/min  ← 58% cheaper!
```

## Quick Decision Tree

```
Do you want translation?
├─ No → Just use LiveKit (video only)
└─ Yes → Do you have OpenAI API key?
    ├─ Yes → Use it! (simplest option)
    └─ No → Get one or use alternative services
```

## Bottom Line

1. **You already have everything you need:**
   - ✅ LiveKit credentials (for video)
   - ✅ OpenAI API key (for translation)

2. **It's actually cheaper than your current setup**

3. **You can start with just video and add translation later**

## Next Step

Just add your OpenAI key to `translation-agent/.env`:
```bash
OPENAI_API_KEY=sk-...your_key_here
```

That's it! You're ready to go.
