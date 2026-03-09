#!/bin/bash
# Run the transcription-only agent locally for debugging.
# Agent connects OUT to LiveKit - no ngrok needed for the agent.
# Use with: backend + frontend running (or full start_local.sh)

set -e
cd "$(dirname "$0")"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Starting transcription_only_agent locally...${NC}"
echo "Agent connects to LiveKit (outbound) - no ngrok needed for agent."
echo ""

cd translation-agent

# Use venv if it exists
if [ -d "venv" ]; then
  source venv/bin/activate
fi

# Local dev: use translation-bot-dev so backend dispatches to us
export AGENT_NAME="${AGENT_NAME:-translation-bot-dev}"
# Use local OpenAI if available (faster iteration); else LiveKit Inference
# Unset LIVEKIT_CLOUD or set to false to use local OpenAI
export LIVEKIT_CLOUD="${LIVEKIT_CLOUD:-false}"

echo "AGENT_NAME=$AGENT_NAME"
echo "LIVEKIT_CLOUD=$LIVEKIT_CLOUD (false = use local OpenAI)"
echo ""

# Run with dev command - logs to stdout for debugging
python transcription_only_agent.py dev
