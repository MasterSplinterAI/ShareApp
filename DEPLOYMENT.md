# Deployment Guide

## Quick Deploy

Run the deployment script:

```bash
./deploy.sh
```

Or explicitly with bash:

```bash
bash deploy.sh
```

## Prerequisites

### 1. Server Setup

SSH to your server and set up the git repository:

```bash
ssh -i ~/Downloads/AxisAlgo.pem ubuntu@3.16.210.84

# On server:
mkdir -p /home/ubuntu/git
cd /home/ubuntu/git
git clone --bare https://github.com/MasterSplinterAI/ShareApp.git share-app.git
```

### 2. Environment Variables

Create `.env` files on the server:

**Backend** (`/var/www/share-app/backend/.env`):
```bash
DAILY_API_KEY=your_daily_api_key_here
PORT=3000
FRONTEND_URL=https://yourdomain.com
```

**Translation Agent** (`/var/www/share-app/translation-agent/.env`):
```bash
OPENAI_API_KEY=your_openai_api_key_here
AGENT_NAME=Translation Agent
OPENAI_MODEL=gpt-realtime-2025-08-28
OPENAI_VOICE=alloy
```

### 3. Nginx Configuration

Create `/etc/nginx/sites-available/share-app`:

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    
    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;
    
    # SSL certificates (use Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    
    # Frontend
    root /var/www/share-app/frontend;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # API proxy
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/share-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4. SSL Certificate (Let's Encrypt)

```bash
sudo apt-get update
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

## Troubleshooting

### Deploy Script Errors

If you get errors running `./deploy.sh`:

1. **Make sure it's executable:**
   ```bash
   chmod +x deploy.sh
   ```

2. **Run with bash explicitly:**
   ```bash
   bash deploy.sh
   ```

3. **Check PEM key path:**
   - Default: `~/Downloads/AxisAlgo.pem`
   - Update `PEM_KEY` in `deploy.sh` if different

### Server Connection Issues

1. **Test SSH connection:**
   ```bash
   ssh -i ~/Downloads/AxisAlgo.pem ubuntu@3.16.210.84
   ```

2. **Check firewall:**
   ```bash
   # On server
   sudo ufw status
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   ```

### Backend Not Starting

1. **Check PM2 status:**
   ```bash
   pm2 list
   pm2 logs share-app-backend
   ```

2. **Check environment variables:**
   ```bash
   cd /var/www/share-app/backend
   cat .env
   ```

3. **Restart manually:**
   ```bash
   cd /var/www/share-app/backend
   pm2 restart share-app-backend
   ```

### Frontend Not Loading

1. **Check Nginx:**
   ```bash
   sudo nginx -t
   sudo systemctl status nginx
   ```

2. **Check file permissions:**
   ```bash
   sudo chown -R ubuntu:ubuntu /var/www/share-app/frontend
   ```

3. **Check build:**
   ```bash
   ls -la /var/www/share-app/frontend/
   ```

## Manual Deployment Steps

If the script fails, you can deploy manually:

```bash
# 1. SSH to server
ssh -i ~/Downloads/AxisAlgo.pem ubuntu@3.16.210.84

# 2. Navigate to git repo
cd /home/ubuntu/git/share-app.git

# 3. Checkout latest code
TEMP_DIR=$(mktemp -d)
git --work-tree="$TEMP_DIR" checkout -f main

# 4. Build frontend
cd "$TEMP_DIR/frontend"
npm install
npm run build

# 5. Install backend dependencies
cd "$TEMP_DIR/backend"
npm install --production

# 6. Copy files
sudo cp -R "$TEMP_DIR/backend"/* /var/www/share-app/backend/
sudo cp -R "$TEMP_DIR/frontend/dist"/* /var/www/share-app/frontend/

# 7. Restart backend
cd /var/www/share-app/backend
pm2 restart share-app-backend

# 8. Cleanup
rm -rf "$TEMP_DIR"
```

