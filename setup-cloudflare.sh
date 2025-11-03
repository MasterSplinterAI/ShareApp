#!/bin/bash
# Cloudflare TURN Setup Script
# Run this to set up your Cloudflare TURN credentials

echo "🔧 Cloudflare TURN Configuration Setup"
echo ""

# Set your Cloudflare credentials
export CLOUDFLARE_TURN_TOKEN_ID="59d87715faf308d4ea571375623ec7a3"
export CLOUDFLARE_API_TOKEN="5ac6d30e0d584cca073a3cb922a430c826e25dcd7eaeb674e30fe25024c5e16e"

echo "✅ Credentials set!"
echo ""
echo "⚠️  IMPORTANT: You still need to get your TURN server URLs from Cloudflare dashboard."
echo ""
echo "To get your TURN URLs:"
echo "1. Go to https://dash.cloudflare.com/"
echo "2. Navigate to Realtime → TURN"
echo "3. Find your service: jar-share"
echo "4. Copy the TURN server URLs (they look like: turn:xxx.cloudflare.com:3478)"
echo "5. Get the username and password"
echo ""
echo "Then set these environment variables:"
echo ""
echo "export CLOUDFLARE_TURN_URLS=\"turn:your-domain.cloudflare.com:3478?transport=udp,turn:your-domain.cloudflare.com:3478?transport=tcp,turns:your-domain.cloudflare.com:5349?transport=tcp\""
echo "export CLOUDFLARE_TURN_USERNAME=\"your_username\""
echo "export CLOUDFLARE_TURN_CREDENTIAL=\"your_password\""
echo ""
echo "Or create a .env file with these values and restart your server."

