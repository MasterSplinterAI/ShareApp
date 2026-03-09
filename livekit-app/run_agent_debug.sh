#!/bin/bash
# Run agent with venv, logging to agent_debug.log for debugging
cd "$(dirname "$0")"
source translation-agent/venv/bin/activate
export AGENT_NAME=translation-bot-dev
export LIVEKIT_CLOUD=false
echo "Starting agent (logs to agent_debug.log)..."
python translation-agent/transcription_only_agent.py dev 2>&1 | tee agent_debug.log
