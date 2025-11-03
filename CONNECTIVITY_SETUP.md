# International Connectivity Setup Guide

This guide explains how to configure TURN servers for better international connectivity in your video meeting app.

## The Problem

Users from different countries may experience connection issues due to:
- Restrictive firewalls/NATs
- Network policies blocking direct peer-to-peer connections
- Geographic distance between participants

## Solution: TURN Servers

TURN (Traversal Using Relays around NAT) servers act as relays when direct connections fail. This is critical for international users.

## Configuration Options

### Option 1: Use Free TURN Servers (Default)

The app currently uses free TURN servers from `openrelay.metered.ca`. These work but have limitations:
- Limited bandwidth
- May have rate limits
- May not work in all countries

**Recommendation:** Only use for testing. Upgrade to a commercial service for production.

### Option 2: Use Commercial TURN Services (Recommended for Production)

**💡 RECOMMENDED FOR CORPORATE USE:**

For your use case (limited users, rare calls, ≤10 connections per call), **Cloudflare Realtime TURN** is the best option:

✅ **Free tier:** 1,000 GB/month (likely covers all your needs)  
✅ **Global network:** 330+ cities worldwide for low latency  
✅ **Cost-effective:** $0.05/GB after free tier (you probably won't exceed free tier)  
✅ **Easy integration:** Simple API-based setup  
✅ **Reliable:** Enterprise-grade infrastructure  

**Cost Estimate:** With rare calls and ≤10 users, you'll likely stay within the free tier. Even if you exceed it, typical usage would be $5-20/month.

#### Cloudflare Realtime TURN (Recommended)

1. Sign up at https://developers.cloudflare.com/realtime/
2. Get your TURN credentials from the dashboard
3. Set environment variables:
```bash
export TURN_URLS="turn:your-domain.cloudflare.com:3478?transport=udp,turn:your-domain.cloudflare.com:3478?transport=tcp,turns:your-domain.cloudflare.com:5349?transport=tcp"
export TURN_USERNAME="your_cloudflare_username"
export TURN_CREDENTIAL="your_cloudflare_credential"
```

**Alternative Options:**

For better reliability and international coverage, consider these services:

#### Metered.ca (Alternative)
- **Pricing:** Free trial (500 MB), then Growth plan: $0.40/GB (150 GB bundled)
- **Best for:** If you need more control or Cloudflare doesn't fit your needs
- **Setup:**
  1. Sign up at https://www.metered.ca/
  2. Get your TURN server credentials
  3. Set environment variables:
```bash
export TURN_URLS="turn:turn.metered.ca:80,turn:turn.metered.ca:443,turn:turn.metered.ca:443?transport=tcp"
export TURN_USERNAME="your_username"
export TURN_CREDENTIAL="your_credential"
```

#### Twilio STUN/TURN (Enterprise Grade)
- **Pricing:** Pay-as-you-go, typically $0.40/GB
- **Best for:** If you're already using Twilio for other services
- **Setup:**
  1. Sign up at https://www.twilio.com/stun-turn
  2. Get credentials from Twilio console
  3. Set environment variables:
```bash
export TURN_URLS="turn:global.turn.twilio.com:3478?transport=udp,turn:global.turn.twilio.com:3478?transport=tcp,turns:global.turn.twilio.com:5349?transport=tcp"
export TURN_USERNAME="your_twilio_username"
export TURN_CREDENTIAL="your_twilio_credential"
```

#### Vonage Video API (Not Recommended for TURN-only)
- **Pricing:** $0.0041 per participant per minute (includes full video API)
- **Best for:** If you need a complete video platform, not just TURN
- **Note:** More expensive if you only need TURN servers. Better suited if you want to replace your entire WebRTC implementation with their SDK.

#### Xirsys (Global Coverage)
- **Pricing:** Various plans starting around $20/month
- **Best for:** High-volume usage or specific regional requirements
- **Setup:**
  1. Sign up at https://xirsys.com/
  2. Get your TURN server details
  3. Set environment variables:
```bash
export TURN_URLS="turn:your-domain.xirsys.com:80?transport=udp,turn:your-domain.xirsys.com:80?transport=tcp,turns:your-domain.xirsys.com:443?transport=tcp"
export TURN_USERNAME="your_xirsys_username"
export TURN_CREDENTIAL="your_xirsys_credential"
```

### Option 3: Self-Hosted TURN Server

If you want to host your own TURN server:
1. Set up a Coturn server (https://github.com/coturn/coturn)
2. Configure with your domain/IP
3. Set environment variables:
```bash
export TURN_URLS="turn:your-turn-server.com:3478"
export TURN_USERNAME="your_username"
export TURN_CREDENTIAL="your_credential"
```

## Environment Variable Format

The server supports multiple TURN URLs with the format:
```bash
TURN_URLS="url1,url2|username|credential,url3|username|credential"
```

Or use global credentials:
```bash
TURN_URLS="url1,url2,url3"
TURN_USERNAME="global_username"
TURN_CREDENTIAL="global_credential"
```

## Testing Your Configuration

1. Start your server with the environment variables set
2. Check the server logs for "Added TURN server" messages
3. Test with users from different countries
4. Check browser console for connection type logs:
   - 🌐 Using TURN relay (good for international)
   - 🔗 Using STUN (NAT traversal)
   - 🏠 Direct connection (same network)

## Monitoring Connection Quality

The app now includes:
- Automatic retry with exponential backoff
- Connection type detection (TURN/STUN/Direct)
- User-friendly error messages
- Connection status indicators

## Troubleshooting

If users still can't connect:
1. Check browser console for connection errors
2. Verify TURN servers are accessible from user's location
3. Check firewall settings on the server
4. Ensure HTTPS is enabled (required for WebRTC)
5. Try different TURN server providers

## Additional Improvements Made

1. **Enhanced ICE Server Configuration**: Dynamic TURN server support via API
2. **Better Retry Logic**: Exponential backoff for failed connections
3. **Connection Monitoring**: Detailed logging of connection types
4. **Error Handling**: User-friendly error messages with retry suggestions
5. **Connection Quality Indicators**: Visual feedback for connection status

