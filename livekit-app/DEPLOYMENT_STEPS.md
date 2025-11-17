# Deployment Steps for t3.medium

## Prerequisites
- ✅ EC2 t3.medium instance running
- ✅ SSH access configured
- ✅ API keys ready (LiveKit, OpenAI)

## Step 1: Deploy Code

### Option A: Use Deploy Script
```bash
cd /Users/rhule/Documents/ShareApp/share-app
./deploy.sh
```

### Option B: Manual Deployment
```bash
# SSH to server
ssh -i ~/Downloads/AxisAlgo.pem ubuntu@3.16.210.84

# Pull latest code
cd ~/git/share-app.git
git pull origin main

# Create directories if needed
sudo mkdir -p /var/www/share-app/livekit-app/{backend,frontend,translation-agent}
sudo chown -R ubuntu:ubuntu /var/www/share-app
```

## Step 2: Create Environment Files

### Backend .env
```bash
sudo nano /var/www/share-app/livekit-app/backend/.env
```

Add:
```env
LIVEKIT_API_KEY=your_livekit_api_key_here
LIVEKIT_API_SECRET=your_livekit_api_secret_here
LIVEKIT_URL=wss://jayme-rhmomj8r.livekit.cloud
PORT=3000
NODE_ENV=production
FRONTEND_URL=https://yourdomain.com
```

### Translation Agent .env
```bash
sudo nano /var/www/share-app/livekit-app/translation-agent/.env
```

Add:
```env
LIVEKIT_API_KEY=your_livekit_api_key_here
LIVEKIT_API_SECRET=your_livekit_api_secret_here
LIVEKIT_URL=wss://jayme-rhmomj8r.livekit.cloud
OPENAI_API_KEY=your_openai_api_key_here
AGENT_NAME=translation-bot
USE_VOICEASSISTANT=true
LOG_LEVEL=INFO
```

**Important**: Replace placeholder values with your actual API keys!

## Step 3: Install Dependencies

### Backend
```bash
cd /var/www/share-app/livekit-app/backend
npm install --production
```

### Translation Agent
```bash
cd /var/www/share-app/livekit-app/translation-agent
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements_livekit.txt
deactivate
```

## Step 4: Start Services with PM2

### Backend
```bash
cd /var/www/share-app/livekit-app/backend
pm2 delete livekit-backend 2>/dev/null || true
pm2 start server.js --name livekit-backend --update-env
pm2 save
```

### Translation Agent
```bash
cd /var/www/share-app/livekit-app/translation-agent
source venv/bin/activate
pm2 delete livekit-agent 2>/dev/null || true
pm2 start realtime_agent.py --name livekit-agent --interpreter venv/bin/python -- dev
pm2 save
deactivate
```

## Step 5: Verify Services

```bash
# Check status
pm2 status

# View logs
pm2 logs livekit-backend
pm2 logs livekit-agent

# Monitor
pm2 monit
```

Expected output:
- ✅ `livekit-backend`: online, listening on port 3000
- ✅ `livekit-agent`: online, connected to LiveKit Cloud

## Step 6: Configure Nginx (if not already done)

```bash
sudo nano /etc/nginx/sites-available/share-app
```

Add:
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Frontend
    root /var/www/share-app/livekit-app/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable and restart:
```bash
sudo ln -s /etc/nginx/sites-available/share-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## Step 7: Set Up SSL (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

## Troubleshooting

### Services Not Starting
```bash
# Check PM2 logs
pm2 logs livekit-backend --lines 50
pm2 logs livekit-agent --lines 50

# Check if ports are in use
sudo netstat -tulpn | grep :3000

# Restart services
pm2 restart all
```

### Agent Not Connecting
- Verify LiveKit API keys in `.env`
- Check agent logs: `pm2 logs livekit-agent`
- Verify LiveKit URL is correct
- Check network connectivity

### Backend Not Responding
- Verify backend is running: `pm2 status`
- Check backend logs: `pm2 logs livekit-backend`
- Verify PORT in `.env` matches Nginx config
- Test locally: `curl http://localhost:3000/api/health`

## Post-Deployment Checklist

- [ ] Backend running on port 3000
- [ ] Translation agent connected to LiveKit Cloud
- [ ] Frontend accessible via Nginx
- [ ] SSL certificate installed
- [ ] PM2 services set to auto-start on reboot
- [ ] Environment variables set correctly
- [ ] Logs showing no errors

## Monitoring

### Check Resource Usage
```bash
htop
df -h
free -h
```

### Set Up CloudWatch Alarms (Optional)
- CPU utilization > 80%
- Memory utilization > 80%
- Status check failed

## Next Steps

1. Test the application
2. Monitor logs for first few hours
3. Set up log rotation
4. Configure backups
5. Set up monitoring/alerting

