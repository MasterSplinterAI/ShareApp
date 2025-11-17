# Server .env File Templates

Copy these templates to your server and fill in your API keys.

## Backend .env
Location: `/var/www/share-app/livekit-app/backend/.env`

```env
# LiveKit Configuration
LIVEKIT_URL=wss://jayme-rhmomj8r.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key_here
LIVEKIT_API_SECRET=your_livekit_api_secret_here

# Server Configuration
PORT=3000
NODE_ENV=production

# Frontend URL (for CORS) - Update with your domain
FRONTEND_URL=https://yourdomain.com
```

## Translation Agent .env
Location: `/var/www/share-app/livekit-app/translation-agent/.env`

```env
# LiveKit Configuration
LIVEKIT_URL=wss://jayme-rhmomj8r.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key_here
LIVEKIT_API_SECRET=your_livekit_api_secret_here

# OpenAI Configuration (for STT/TTS/Translation)
OPENAI_API_KEY=your_openai_api_key_here

# Agent Configuration
AGENT_NAME=translation-bot
USE_VOICEASSISTANT=true
LOG_LEVEL=INFO
```

## Quick Setup Commands

After SSH'ing to server:

```bash
# Backend .env
sudo nano /var/www/share-app/livekit-app/backend/.env
# Paste backend template above, replace API keys

# Agent .env
sudo nano /var/www/share-app/livekit-app/translation-agent/.env
# Paste agent template above, replace API keys

# Set permissions
sudo chown ubuntu:ubuntu /var/www/share-app/livekit-app/backend/.env
sudo chown ubuntu:ubuntu /var/www/share-app/livekit-app/translation-agent/.env
```

