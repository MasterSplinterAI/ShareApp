# EC2 t3.small Deployment Guide

## Server Requirements

### EC2 t3.small Specifications
- **CPU**: 2 vCPUs
- **RAM**: 2 GB
- **Storage**: EBS (recommend 20GB minimum)
- **Network**: Up to 5 Gbps

### Is t3.small Sufficient?

**✅ YES** - t3.small is sufficient for:
- Backend Node.js server (PM2)
- Translation Agent (Python with VoiceAssistant)
- Frontend static files (Nginx)

**Resource Usage Estimates:**
- Backend: ~200-300 MB RAM
- Translation Agent: ~400-600 MB RAM (with VoiceAssistant/VAD)
- Nginx: ~50 MB RAM
- System: ~500 MB RAM
- **Total: ~1.5 GB RAM** (fits comfortably in 2GB)

**Note**: If you plan to run multiple concurrent translation sessions, consider t3.medium (4GB RAM) for better performance.

## Deployment Steps

### 1. Update Deploy Script

The deploy script (`deploy.sh`) needs to be updated for LiveKit:

```bash
# Update paths in deploy.sh:
APP_DIR="/var/www/share-app"
BACKEND_DIR="$APP_DIR/livekit-app/backend"
FRONTEND_DIR="$APP_DIR/livekit-app/frontend"
AGENT_DIR="$APP_DIR/livekit-app/translation-agent"
```

### 2. Server Setup (First Time)

SSH to your EC2 instance:

```bash
ssh -i ~/Downloads/AxisAlgo.pem ubuntu@3.16.210.84
```

**Install dependencies:**

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install Python 3.10+ and venv
sudo apt install -y python3 python3-pip python3-venv

# Install Nginx
sudo apt install -y nginx

# Install PM2 globally
sudo npm install -g pm2

# Install Git (if not already installed)
sudo apt install -y git

# Set up git repo (if not already done)
mkdir -p ~/git
cd ~/git
git clone <your-repo-url> share-app.git
```

### 3. Create Directory Structure

```bash
sudo mkdir -p /var/www/share-app/livekit-app/{backend,frontend,translation-agent}
sudo chown -R ubuntu:ubuntu /var/www/share-app
```

### 4. Set Up Environment Files

**Backend `.env`:**
```bash
sudo nano /var/www/share-app/livekit-app/backend/.env
```

```env
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
LIVEKIT_URL=wss://your-project.livekit.cloud
PORT=3000
NODE_ENV=production
FRONTEND_URL=https://yourdomain.com
```

**Translation Agent `.env`:**
```bash
sudo nano /var/www/share-app/livekit-app/translation-agent/.env
```

```env
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
LIVEKIT_URL=wss://your-project.livekit.cloud
OPENAI_API_KEY=your_openai_key
AGENT_NAME=translation-bot
USE_VOICEASSISTANT=true
LOG_LEVEL=INFO
```

### 5. Deploy Code

Run the deploy script from your local machine:

```bash
cd /Users/rhule/Documents/ShareApp/share-app
./deploy.sh
```

Or manually:

```bash
# Commit and push
git add -A
git commit -m "Deploy LiveKit app"
git push origin main

# SSH and pull
ssh -i ~/Downloads/AxisAlgo.pem ubuntu@3.16.210.84
cd ~/git/share-app.git
git pull origin main
```

### 6. Install Python Dependencies

```bash
cd /var/www/share-app/livekit-app/translation-agent
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements_livekit.txt
deactivate
```

### 7. Start Services with PM2

**Backend:**
```bash
cd /var/www/share-app/livekit-app/backend
pm2 start server.js --name livekit-backend --update-env
pm2 save
```

**Translation Agent:**
```bash
cd /var/www/share-app/livekit-app/translation-agent
source venv/bin/activate
pm2 start realtime_agent.py --name livekit-agent --interpreter venv/bin/python -- dev
pm2 save
deactivate
```

**Check status:**
```bash
pm2 status
pm2 logs livekit-backend
pm2 logs livekit-agent
```

### 8. Configure Nginx

```bash
sudo nano /etc/nginx/sites-available/share-app
```

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

    # WebSocket support for LiveKit (if needed)
    location /rtc {
        proxy_pass https://your-project.livekit.cloud;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/share-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 9. Set Up SSL (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

### 10. Firewall Configuration

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## Monitoring

### Check PM2 Status
```bash
pm2 status
pm2 monit
```

### View Logs
```bash
# Backend logs
pm2 logs livekit-backend

# Agent logs
pm2 logs livekit-agent

# Or view log files directly
tail -f /var/www/share-app/livekit-app/translation-agent/agent.log
```

### Check Resource Usage
```bash
# CPU and Memory
htop

# Disk space
df -h

# Network
sudo netstat -tulpn
```

## Troubleshooting

### Agent Not Starting
1. Check Python virtual environment is activated
2. Verify all environment variables are set
3. Check LiveKit credentials
4. Review agent logs: `pm2 logs livekit-agent`

### Backend Not Responding
1. Check PM2 status: `pm2 status`
2. Verify port 3000 is not blocked
3. Check backend logs: `pm2 logs livekit-backend`
4. Verify environment variables

### High Memory Usage
- Monitor with `htop`
- Consider upgrading to t3.medium if consistently >80% RAM
- Restart services: `pm2 restart all`

## Cost Optimization

### EC2 t3.small Costs
- **On-Demand**: ~$15/month
- **Reserved (1-year)**: ~$10/month
- **Spot Instance**: ~$5/month (can be interrupted)

### Additional Costs
- EBS Storage (20GB): ~$2/month
- Data Transfer: ~$0.09/GB (first 1GB free)
- **Total**: ~$17-20/month

## Scaling Options

If you need more resources:

1. **Upgrade to t3.medium** (4GB RAM) - ~$30/month
2. **Use Auto Scaling** for multiple instances
3. **Separate services**:
   - Frontend: S3 + CloudFront
   - Backend: Separate EC2 or ECS
   - Agent: Separate EC2 or ECS

## Security Checklist

- [ ] Set up SSH key authentication only
- [ ] Configure firewall (UFW)
- [ ] Enable SSL/HTTPS
- [ ] Set up regular backups
- [ ] Use environment variables for secrets
- [ ] Enable CloudWatch monitoring
- [ ] Set up log rotation
- [ ] Regular security updates

## Next Steps

1. Update `deploy.sh` with correct paths
2. Commit and push code
3. Run deployment script
4. Set up environment variables on server
5. Start services with PM2
6. Configure Nginx
7. Set up SSL
8. Test the application

