#!/bin/bash
# Script to delete LiveKit agent using REST API
# This uses your API credentials to make a direct API call

set -e

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

AGENT_ID="${1:-A_4NQozRThmiRx}"

if [ -z "$LIVEKIT_API_KEY" ] || [ -z "$LIVEKIT_API_SECRET" ]; then
    echo "Error: LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set in .env"
    exit 1
fi

# Convert WebSocket URL to HTTPS
LIVEKIT_HOST=$(echo "$LIVEKIT_URL" | sed 's/wss:\/\///' | sed 's/ws:\/\///')
LIVEKIT_HOST=$(echo "$LIVEKIT_HOST" | sed 's/\/$//')

echo "Attempting to delete agent: $AGENT_ID"
echo "LiveKit Host: $LIVEKIT_HOST"
echo ""

# Note: LiveKit Cloud agent management might require Cloud API token
# The regular API key/secret might not have permissions for agent management
# Try using curl with basic auth

# Generate JWT token for API access (simplified - you might need proper JWT generation)
echo "⚠️  LiveKit Cloud agent deletion requires Cloud API access."
echo ""
echo "Options:"
echo ""
echo "1. Use LiveKit Cloud Dashboard (if accessible):"
echo "   - Go to: https://cloud.livekit.io"
echo "   - Navigate to Agents section"
echo "   - Find agent $AGENT_ID"
echo "   - Delete or disable it"
echo ""
echo "2. Contact LiveKit Support:"
echo "   - They can disable/delete the agent for you"
echo "   - Provide agent ID: $AGENT_ID"
echo ""
echo "3. Try LiveKit CLI with Cloud token:"
echo "   - Get Cloud API token from dashboard"
echo "   - Set: export LIVEKIT_CLOUD_TOKEN=<token>"
echo "   - Then: lk agent delete $AGENT_ID"
echo ""
echo "4. Disable auto-dispatch by updating room pattern (if CLI works):"
echo "   lk agent update $AGENT_ID --room-pattern 'disabled-*'"

