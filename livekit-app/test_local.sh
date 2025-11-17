#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 LiveKit Translation App - Local Testing${NC}"
echo ""

# Check if services are running
echo -e "${YELLOW}Checking services...${NC}"

# Check backend
if curl -s http://localhost:3001/api/auth/token -X POST -H "Content-Type: application/json" -d '{"roomName":"test","participantName":"test","isHost":false}' > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend API is running${NC}"
else
    echo -e "❌ Backend API is not running"
    echo "   Run: cd backend && npm run dev"
    exit 1
fi

# Check frontend
if curl -s http://localhost:5174 > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Frontend is running${NC}"
else
    echo -e "❌ Frontend is not running"
    echo "   Run: cd frontend && npm run dev"
    exit 1
fi

# Check agent
if ps aux | grep -E "realtime_agent" | grep -v grep > /dev/null; then
    echo -e "${GREEN}✅ Translation Agent is running${NC}"
else
    echo -e "⚠️  Translation Agent is not running"
    echo "   (Optional) Run: cd translation-agent && source venv/bin/activate && python realtime_agent.py dev"
fi

echo ""
echo -e "${BLUE}Opening test windows...${NC}"
echo ""

# Open main window
echo -e "${GREEN}1. Opening host window...${NC}"
open "http://localhost:5174"

echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Click 'Host a Meeting' and enter your name"
echo "2. Once in the room, click the share button to get the join link"
echo "3. Open the join link in an incognito window to test with multiple participants"
echo "4. Test the language selector and translation features"
echo ""
echo -e "${BLUE}For mobile testing:${NC}"
echo "Network URL: http://$(ipconfig getifaddr en0 2>/dev/null || echo "YOUR_IP"):5174"
echo ""
echo -e "${GREEN}Happy testing! 🎉${NC}"
