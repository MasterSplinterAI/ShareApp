# Deploy Conference App to share.jarmetals.com

## Strategy: Deploy as Subdirectory App

Since you already have the main app at share.jarmetals.com, we'll deploy the conference app as a subdirectory:
- Main app: `https://share.jarmetals.com/`
- Conference app: `https://share.jarmetals.com/meet/`

## Step 1: Prepare Conference App for Subdirectory

### Update next.config.js:
```javascript
module.exports = {
  basePath: '/meet',
  assetPrefix: '/meet',
  reactStrictMode: true,
}
```

### Update environment variables:
Create `.env.production`:
```env
CLOUDFLARE_TURN_API_TOKEN=5ac6d30e0d584cca073a3cb922a430c826e25dcd7eaeb674e30fe25024c5e16e
CLOUDFLARE_TURN_TOKEN_ID=59d87715faf308d4ea571375623ec7a3
NEXT_PUBLIC_WS_URL=wss://share.jarmetals.com/meet
```

## Step 2: Build for Production

```bash
cd conference-app
npm run build
```

## Step 3: Deploy to Server

### Option A: Manual Deployment

1. SSH to your server:
```bash
ssh -i ~/Downloads/AxisAlgo.pem ubuntu@3.133.136.182
```

2. Create conference app directory:
```bash
sudo mkdir -p /var/www/html/meet
sudo chown -R ubuntu:ubuntu /var/www/html/meet
```

3. On your local machine, create deployment package:
```bash
cd conference-app
tar -czf conference-app.tar.gz \
  .next \
  public \
  package*.json \
  server-unified.js \
  lib \
  app \
  components \
  next.config.js \
  tsconfig.json \
  .env.production
```

4. Upload to server:
```bash
scp -i ~/Downloads/AxisAlgo.pem conference-app.tar.gz ubuntu@3.133.136.182:/tmp/
```

5. On server, extract and install:
```bash
cd /var/www/html/meet
tar -xzf /tmp/conference-app.tar.gz
npm ci --only=production
sudo chown -R www-data:www-data /var/www/html/meet
```

### Option B: Git-based Deployment (Recommended)

1. Add conference app to your main repository:
```bash
# In your main project directory
cp -r conference-app /Users/rhule/.cursor/worktrees/share-app/xJVlP/
cd /Users/rhule/.cursor/worktrees/share-app/xJVlP/
git add conference-app/
git commit -m "Add conference app"
git push origin main
```

2. Deploy using your existing script:
```bash
# Use your existing deploy-remote.ps1 script
# It will push everything including the conference app
```

## Step 4: Update Nginx Configuration

SSH to server and update Nginx:

```bash
sudo nano /etc/nginx/sites-available/share.jarmetals.com
```

Add this configuration:

```nginx
server {
    listen 80;
    server_name share.jarmetals.com;

    # Main app
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    # Conference app
    location /meet {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    # Socket.io for conference app
    location /meet/socket.io/ {
        proxy_pass http://localhost:3002/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/share.jarmetals.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/share.jarmetals.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}
```

## Step 5: Start Conference App with PM2

```bash
cd /var/www/html/meet

# Start the unified server (Next.js + Socket.io)
sudo pm2 start server-unified.js --name conference-app -- --port 3002

# Save PM2 configuration
sudo pm2 save
sudo pm2 startup
```

## Step 6: Test

1. Reload Nginx:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

2. Access the conference app:
```
https://share.jarmetals.com/meet/
```

## Alternative: Subdomain Deployment

If you prefer a subdomain like `meet.jarmetals.com`:

1. Add DNS A record for `meet.jarmetals.com` → `3.133.136.182`

2. Create new Nginx config:
```bash
sudo nano /etc/nginx/sites-available/meet.jarmetals.com
```

```nginx
server {
    listen 80;
    server_name meet.jarmetals.com;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

3. Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/meet.jarmetals.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

4. Get SSL certificate:
```bash
sudo certbot --nginx -d meet.jarmetals.com
```

## Quick Deployment Script

Create `deploy-conference.sh`:

```bash
#!/bin/bash

# Configuration
SERVER="3.133.136.182"
USER="ubuntu"
KEY="~/Downloads/AxisAlgo.pem"
REMOTE_DIR="/var/www/html/meet"

echo "Building conference app..."
cd conference-app
npm run build

echo "Creating deployment package..."
tar -czf conference-app.tar.gz \
  .next \
  public \
  package*.json \
  server-unified.js \
  lib \
  app \
  components \
  next.config.js \
  tsconfig.json

echo "Uploading to server..."
scp -i $KEY conference-app.tar.gz $USER@$SERVER:/tmp/

echo "Deploying on server..."
ssh -i $KEY $USER@$SERVER << 'ENDSSH'
  sudo mkdir -p /var/www/html/meet
  cd /var/www/html/meet
  sudo tar -xzf /tmp/conference-app.tar.gz
  sudo npm ci --only=production
  sudo chown -R www-data:www-data /var/www/html/meet
  sudo pm2 restart conference-app || sudo pm2 start server-unified.js --name conference-app -- --port 3002
  sudo pm2 save
  rm /tmp/conference-app.tar.gz
ENDSSH

echo "Deployment complete!"
echo "Access at: https://share.jarmetals.com/meet/"
```

## Environment Variables on Server

Make sure to set the Cloudflare credentials on the server:

```bash
cd /var/www/html/meet
sudo nano .env
```

Add:
```
CLOUDFLARE_TURN_API_TOKEN=5ac6d30e0d584cca073a3cb922a430c826e25dcd7eaeb674e30fe25024c5e16e
CLOUDFLARE_TURN_TOKEN_ID=59d87715faf308d4ea571375623ec7a3
NEXT_PUBLIC_WS_URL=wss://share.jarmetals.com/meet
```

## Monitoring

Check logs:
```bash
# PM2 logs
sudo pm2 logs conference-app

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

## Summary

This deployment strategy:
- Keeps your existing app untouched
- Adds conference app at `/meet` subdirectory
- Uses your existing infrastructure
- Shares the same domain and SSL certificate
- Uses PM2 for process management
- Works with your existing Cloudflare credentials
