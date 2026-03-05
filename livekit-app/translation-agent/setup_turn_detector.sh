#!/bin/bash
# Setup script for contextual turn detector plugin
# This downloads the required model weights for the turn detector

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     SETTING UP CONTEXTUAL TURN DETECTOR PLUGIN              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Check if virtual environment is activated
if [ -z "$VIRTUAL_ENV" ]; then
    echo "⚠️  Virtual environment not detected. Activating venv..."
    if [ -d "venv" ]; then
        source venv/bin/activate
    else
        echo "❌ Error: venv directory not found. Please create a virtual environment first."
        exit 1
    fi
fi

echo "✅ Virtual environment: $VIRTUAL_ENV"
echo ""

# Check if turn detector plugin is installed
echo "📦 Checking for turn detector plugin..."
python -c "from livekit.plugins.turn_detector.multilingual import MultilingualModel" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "⚠️  Turn detector plugin not found. Installing..."
    pip install "livekit-plugins-turn-detector>=0.1.0"
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install turn detector plugin"
        exit 1
    fi
    echo "✅ Turn detector plugin installed"
else
    echo "✅ Turn detector plugin already installed"
fi

echo ""

# Check if Deepgram plugin is installed
echo "📦 Checking for Deepgram plugin..."
python -c "from livekit.plugins import deepgram" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "⚠️  Deepgram plugin not found. Installing..."
    pip install "livekit-plugins-deepgram>=0.6.0"
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install Deepgram plugin"
        exit 1
    fi
    echo "✅ Deepgram plugin installed"
else
    echo "✅ Deepgram plugin already installed"
fi

echo ""

# Download model weights
echo "📥 Downloading turn detector model weights..."
echo "   This may take a few minutes (model is ~500MB)..."
python -m livekit.plugins.turn_detector.multilingual download

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Turn detector setup complete!"
    echo ""
    echo "📝 Next steps:"
    echo "   1. Set DEEPGRAM_API_KEY in your .env file (optional - LiveKit Inference can route it)"
    echo "   2. Run: python realtime_agent_simple.py dev"
    echo ""
    echo "ℹ️  Note: If DEEPGRAM_API_KEY is not set, the agent will use LiveKit Inference routing"
    echo "   (requires LiveKit Cloud deployment or local LiveKit server with Inference enabled)"
else
    echo ""
    echo "⚠️  Model download failed, but agent will still work with fallback (server_vad only)"
    echo "   You can retry the download later or use the agent without turn detector"
fi

