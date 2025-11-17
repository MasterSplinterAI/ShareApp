# LiveKit App Deployment Guide

This guide covers deploying all components of the LiveKit conferencing app to production.

## Overview

The application consists of three main components:
1. **Frontend** (React) - Static site hosting
2. **Backend** (Node.js) - API server
3. **Translation Agent** (Python) - Real-time translation service

## Prerequisites

- LiveKit Cloud account with production API keys
- Accounts for chosen hosting providers
- API keys for translation services (Deepgram, Google Cloud, ElevenLabs)

## Frontend Deployment

### Option 1: Vercel (Recommended)

1. **Prepare for deployment**
   ```bash
   cd frontend
   npm run build
   ```

2. **Deploy to Vercel**
   ```bash
   npm i -g vercel
   vercel
   ```

3. **Set environment variables in Vercel dashboard**
   - `VITE_API_URL` = Your backend URL (e.g., https://api.yourdomain.com)
   - `VITE_LIVEKIT_URL` = wss://your-project.livekit.cloud

### Option 2: Netlify

1. **Create netlify.toml**
   ```toml
   [build]
     command = "npm run build"
     publish = "dist"

   [[redirects]]
     from = "/*"
     to = "/index.html"
     status = 200
   ```

2. **Deploy**
   ```bash
   npm i -g netlify-cli
   netlify deploy --prod
   ```

## Backend Deployment

### Option 1: Railway

1. **Create new project on Railway**

2. **Deploy from GitHub**
   - Connect your GitHub repo
   - Select `backend` directory as root

3. **Set environment variables**
   ```
   LIVEKIT_API_KEY=your_api_key
   LIVEKIT_API_SECRET=your_api_secret
   LIVEKIT_URL=wss://your-project.livekit.cloud
   PORT=3001
   FRONTEND_URL=https://yourdomain.com
   NODE_ENV=production
   ```

4. **Deploy command**
   ```bash
   railway up
   ```

### Option 2: Render

1. **Create Web Service on Render**
   - Connect GitHub repository
   - Root Directory: `backend`
   - Build Command: `npm install`
   - Start Command: `npm start`

2. **Environment variables** (same as above)

### Option 3: Docker (Any Cloud)

1. **Build and push image**
   ```bash
   cd backend
   docker build -t your-registry/livekit-backend:latest .
   docker push your-registry/livekit-backend:latest
   ```

2. **Deploy to your cloud provider**

## Translation Agent Deployment

### Option 1: Railway

1. **Create new service in same project**

2. **Deploy from GitHub**
   - Select `translation-agent` directory

3. **Set environment variables**
   ```
   LIVEKIT_API_KEY=your_api_key
   LIVEKIT_API_SECRET=your_api_secret
   LIVEKIT_URL=wss://your-project.livekit.cloud
   DEEPGRAM_API_KEY=your_deepgram_key
   GOOGLE_APPLICATION_CREDENTIALS=/app/google-creds.json
   ELEVENLABS_API_KEY=your_elevenlabs_key
   ```

4. **Add Google Cloud credentials**
   - Download service account JSON
   - Add as file in Railway

### Option 2: Fly.io

1. **Install Fly CLI**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Create fly.toml**
   ```toml
   app = "livekit-translation-agent"

   [env]
     AGENT_NAME = "translation-bot"

   [deploy]
     strategy = "immediate"

   [[services]]
     internal_port = 8080
     protocol = "tcp"
   ```

3. **Deploy**
   ```bash
   cd translation-agent
   fly launch
   fly secrets set LIVEKIT_API_KEY=xxx
   fly secrets set LIVEKIT_API_SECRET=xxx
   fly deploy
   ```

## Production Checklist

### Security
- [ ] Enable HTTPS on all services
- [ ] Set up CORS properly
- [ ] Use environment variables for secrets
- [ ] Enable rate limiting on API
- [ ] Set up monitoring and alerts

### Performance
- [ ] Enable CDN for frontend assets
- [ ] Set up auto-scaling for backend
- [ ] Configure caching headers
- [ ] Optimize bundle size

### Reliability
- [ ] Set up health checks
- [ ] Configure auto-restart
- [ ] Set up error logging (Sentry)
- [ ] Create backup strategy
- [ ] Test disaster recovery

### Monitoring
- [ ] Application performance monitoring
- [ ] Error tracking
- [ ] Usage analytics
- [ ] Cost monitoring

## Environment Variables Reference

### Frontend
```env
VITE_API_URL=https://api.yourdomain.com
VITE_LIVEKIT_URL=wss://your-project.livekit.cloud
```

### Backend
```env
# LiveKit
LIVEKIT_API_KEY=lk_xxxxxx
LIVEKIT_API_SECRET=secret_xxxxx
LIVEKIT_URL=wss://your-project.livekit.cloud

# Server
PORT=3001
NODE_ENV=production

# CORS
FRONTEND_URL=https://yourdomain.com
```

### Translation Agent
```env
# LiveKit
LIVEKIT_API_KEY=lk_xxxxxx
LIVEKIT_API_SECRET=secret_xxxxx
LIVEKIT_URL=wss://your-project.livekit.cloud

# Translation Services
DEEPGRAM_API_KEY=xxxxx
GOOGLE_APPLICATION_CREDENTIALS=/app/google-creds.json
ELEVENLABS_API_KEY=xxxxx
OPENAI_API_KEY=sk-xxxxx  # Optional fallback

# Agent Config
AGENT_NAME=translation-bot
LOG_LEVEL=INFO
```

## Cost Optimization

### Reduce Costs
1. **Use LiveKit Cloud regions** closest to users
2. **Optimize video quality** based on needs
3. **Cache translations** when possible
4. **Use batch processing** for TTS
5. **Monitor usage** and set alerts

### Estimated Monthly Costs (50 hours usage)
- LiveKit Cloud: ~$12
- Backend hosting: ~$5-20
- Translation agent: ~$5-20
- Translation APIs: ~$130
- **Total: ~$150-180/month**

## Troubleshooting

### Frontend Issues
- Check browser console for errors
- Verify API URL is correct
- Check CORS configuration

### Backend Issues
- Check environment variables
- Verify LiveKit credentials
- Monitor server logs

### Translation Agent Issues
- Verify all API keys are set
- Check agent can connect to LiveKit
- Monitor translation pipeline logs

### Common Problems

1. **WebSocket Connection Failed**
   - Check firewall rules
   - Verify LiveKit URL
   - Check SSL certificates

2. **Translation Not Working**
   - Verify agent is running
   - Check API quotas
   - Monitor agent logs

3. **High Latency**
   - Use closer server regions
   - Optimize bundle size
   - Check network conditions

## Maintenance

### Regular Tasks
- Update dependencies monthly
- Monitor API usage and costs
- Review error logs weekly
- Test disaster recovery quarterly

### Backup Strategy
- Database backups (if added)
- Configuration backups
- Document recovery procedures

## Scaling

### Horizontal Scaling
- Backend: Add load balancer
- Agent: Run multiple instances
- Use Redis for shared state

### Vertical Scaling
- Increase server resources
- Optimize code performance
- Use caching strategies

Remember to test thoroughly in staging before deploying to production!
