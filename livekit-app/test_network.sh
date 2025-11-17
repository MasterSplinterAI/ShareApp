#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get local IP
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ifconfig en0 | grep 'inet ' | awk '{print $2}' || echo "YOUR_IP")

echo -e "${BLUE}🌐 Network Access Test for LiveKit App${NC}"
echo ""

# Check if services are accessible
echo -e "${YELLOW}Testing network accessibility...${NC}"
echo ""

# Test frontend
if curl -s http://localhost:5174 > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Frontend (localhost): Running${NC}"
else
    echo -e "${RED}❌ Frontend not accessible on localhost${NC}"
fi

if curl -s http://$LOCAL_IP:5174 > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Frontend (network): Accessible from WiFi${NC}"
else
    echo -e "${YELLOW}⚠️  Frontend may not be accessible from network${NC}"
    echo "   Make sure firewall allows port 5174"
fi

# Test backend
if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend (localhost): Running${NC}"
else
    echo -e "${RED}❌ Backend not accessible on localhost${NC}"
fi

if curl -s http://$LOCAL_IP:3001/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend (network): Accessible from WiFi${NC}"
else
    echo -e "${YELLOW}⚠️  Backend may not be accessible from network${NC}"
    echo "   Make sure firewall allows port 3001"
fi

echo ""
echo -e "${BLUE}📱 Access from Other Devices (Phone/Tablet/Another Computer):${NC}"
echo ""
echo -e "${GREEN}Frontend URL:${NC} http://$LOCAL_IP:5174"
echo -e "${GREEN}Share this link:${NC} http://$LOCAL_IP:5174"
echo ""

# Check if macOS firewall might be blocking
if [ "$(uname)" = "Darwin" ]; then
    echo -e "${YELLOW}🔥 macOS Firewall Note:${NC}"
    echo "If other devices can't connect, you may need to:"
    echo "1. Go to System Settings → Network → Firewall"
    echo "2. Click 'Options...'"
    echo "3. Add 'node' to allowed applications"
    echo "4. Or temporarily turn off firewall for testing"
fi

echo ""
echo -e "${BLUE}🧪 Testing Instructions:${NC}"
echo "1. On your phone/tablet, connect to the same WiFi network"
echo "2. Open browser and go to: ${GREEN}http://$LOCAL_IP:5174${NC}"
echo "3. You should see the LiveKit app homepage"
echo "4. Try hosting/joining a meeting"
echo ""
echo -e "${YELLOW}💡 Troubleshooting:${NC}"
echo "• Can't access? Check firewall settings"
echo "• Wrong IP? Your actual IP might be different"
echo "• Run 'ifconfig' to see all network interfaces"
echo ""
