#!/bin/bash
# Startup script for LiveKit backend server

cd "$(dirname "$0")"

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Kill any existing process on port 3001
lsof -ti:3001 | xargs kill -9 2>/dev/null || true

# Start the server
echo "Starting LiveKit backend server on port ${PORT:-3001}..."
node server.js

