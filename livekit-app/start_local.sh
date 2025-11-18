#!/bin/bash
# Start all services for local development

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          STARTING LOCAL DEVELOPMENT ENVIRONMENT              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Kill existing processes
echo -e "${YELLOW}Stopping existing processes...${NC}"
pkill -f "node server.js" 2>/dev/null
pkill -f "vite --host" 2>/dev/null
pkill -f "realtime_agent" 2>/dev/null
sleep 2

# Start Backend
echo -e "${GREEN}Starting Backend (port 3000)...${NC}"
cd backend
# Set NODE_ENV and AGENT_NAME for local development
export NODE_ENV=development
export AGENT_NAME="${AGENT_NAME:-translation-bot-dev}"
npm run dev > ../backend.log 2>&1 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"
echo "Backend Environment: development"
echo "Backend Agent Name: ${AGENT_NAME:-translation-bot-dev}"
cd ..

# Start Frontend
echo -e "${GREEN}Starting Frontend (port 5174)...${NC}"
cd frontend
npm run dev > ../frontend.log 2>&1 &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"
cd ..

# Start Agent
echo -e "${GREEN}Starting Translation Agent (OpenAI Realtime API)...${NC}"
cd translation-agent
source venv/bin/activate
# Use realtime_agent_realtime.py for OpenAI Realtime API (lowest latency)
# Set AGENT_NAME explicitly for local development to avoid conflicts with production
export AGENT_NAME="${AGENT_NAME:-translation-bot-dev}"
# Run with 'dev' command for local development
python realtime_agent_realtime.py dev > ../agent.log 2>&1 &
AGENT_PID=$!
echo "Agent PID: $AGENT_PID"
echo "Agent Name: ${AGENT_NAME:-translation-bot-dev}"
deactivate
cd ..

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          SERVICES STARTED                                    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Backend:  http://localhost:3000 (PID: $BACKEND_PID)"
echo "Frontend: http://localhost:5174 (PID: $FRONTEND_PID)"
echo "Agent:    Running (PID: $AGENT_PID)"
echo ""
echo "Ngrok URL: https://f46bc88e5f4e.ngrok.app"
echo ""
echo "Logs:"
echo "  - Backend:  ./backend.log"
echo "  - Frontend: ./frontend.log"
echo "  - Agent:    ./agent.log"
echo ""
echo "To stop all services: pkill -f 'node server.js|vite|realtime_agent'"
echo ""
