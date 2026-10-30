#!/bin/bash
# Stop local backend + frontend started by start_local_app.sh

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [ -f .backend.pid ]; then kill "$(cat .backend.pid)" 2>/dev/null || true; rm -f .backend.pid; fi
if [ -f .frontend.pid ]; then kill "$(cat .frontend.pid)" 2>/dev/null || true; rm -f .frontend.pid; fi
pkill -f "nodemon server.js" 2>/dev/null || true
pkill -f "vite --host 0.0.0.0 --port 5174" 2>/dev/null || true
echo "Local app servers stopped."
