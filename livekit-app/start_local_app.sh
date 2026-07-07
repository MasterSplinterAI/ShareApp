#!/bin/bash
# Start backend + frontend only (no translation agent).
# Run this from your own terminal — keep the window open, or use two tabs:
#   cd livekit-app/backend && npm run dev
#   cd livekit-app/frontend && npm run dev

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

if [ ! -f backend/.env ]; then
  echo -e "${RED}Missing backend/.env — copy backend/.env.example and set JWT_SECRET_V2 (openssl rand -hex 32).${NC}"
  exit 1
fi

if ! grep -q '^JWT_SECRET_V2=' backend/.env 2>/dev/null; then
  echo -e "${RED}backend/.env needs JWT_SECRET_V2. Run: echo \"JWT_SECRET_V2=\$(openssl rand -hex 32)\" >> backend/.env${NC}"
  exit 1
fi

echo -e "${YELLOW}Stopping existing local backend/frontend...${NC}"
"$ROOT/stop_local_app.sh" 2>/dev/null || true

export NODE_ENV=development

echo -e "${GREEN}Starting backend (port 3001)...${NC}"
: > backend.log
(cd "$ROOT/backend" && nohup npm run dev >> "$ROOT/backend.log" 2>&1 &)

echo -e "${GREEN}Starting frontend (port 5174)...${NC}"
: > frontend.log
(cd "$ROOT/frontend" && nohup npm run dev >> "$ROOT/frontend.log" 2>&1 &)

echo "Waiting for services..."
for i in $(seq 1 45); do
  if curl -sf http://127.0.0.1:3001/api/health >/dev/null 2>&1 \
     && curl -sf http://127.0.0.1:5174/ >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -sf http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
  echo -e "${RED}Backend failed to start. Tail backend.log:${NC}"
  tail -20 backend.log
  exit 1
fi

sleep 1
pgrep -f "nodemon server.js" | head -1 > .backend.pid 2>/dev/null || true
pgrep -f "vite --host 0.0.0.0 --port 5174" | head -1 > .frontend.pid 2>/dev/null || true

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  LOCAL APP READY (no agent)                                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Landing:  http://localhost:5174/"
echo "  Sign up:  http://localhost:5174/v2/signup"
echo "  Log in:   http://localhost:5174/v2/login"
echo "  App:      http://localhost:5174/v2/app"
echo ""
echo "  Backend:  http://localhost:3001/api/health"
echo "  Logs:     tail -f backend.log frontend.log"
echo ""
echo "  Stop:     ./stop_local_app.sh"
