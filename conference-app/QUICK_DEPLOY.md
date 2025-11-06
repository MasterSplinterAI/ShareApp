# Quick Deployment Guide

## Step 1: SSH into Server
```bash
ssh -i ~/Downloads/AxisAlgo.pem ubuntu@3.16.210.84
```

## Step 2: Copy and Run Deployment Script

Once SSH'd in, copy this entire script and paste it:

```bash
#!/bin/bash
set -e

APP_DIR="/var/www/html/meet"
PORT=3002

echo "=== Deploying Conference App ==="

# Create directory
sudo mkdir -p "$APP_DIR"
cd "$APP_DIR"

# Create package.json
sudo tee package.json > /dev/null << 'EOF'
{
  "name": "conference-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start": "NODE_ENV=production PORT=3002 node server-unified.js"
  },
  "dependencies": {
    "next": "14.2.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "socket.io": "^4.7.5",
    "socket.io-client": "^4.7.5",
    "zustand": "^4.5.2"
  }
}
EOF

# Install dependencies
sudo npm install --production

# Create next.config.js
sudo tee next.config.js > /dev/null << 'EOF'
module.exports = {
  basePath: '/meet',
  assetPrefix: '/meet',
  reactStrictMode: true,
}
EOF

# Create .env.production
sudo tee .env.production > /dev/null << 'EOF'
CLOUDFLARE_TURN_API_TOKEN=5ac6d30e0d584cca073a3cb922a430c826e25dcd7eaeb674e30fe25024c5e16e
CLOUDFLARE_TURN_TOKEN_ID=59d87715faf308d4ea571375623ec7a3
NEXT_PUBLIC_WS_URL=wss://share.jarmetals.com/meet
EOF

# Set permissions
sudo chown -R ubuntu:ubuntu "$APP_DIR"

echo "=== Basic setup complete ==="
echo "Now you need to copy the built files from your local machine"
```

## Step 3: From Your Local Machine, Copy Built Files

In a NEW terminal (keep SSH session open), run:

```bash
cd /Users/rhule/.cursor/worktrees/share-app/xJVlP/conference-app

# Create a deployment package with built files
tar -czf conference-deploy.tar.gz \
  .next \
  public \
  server-unified.js \
  next.config.js \
  package.json \
  package-lock.json

# Upload to server
scp -i ~/Downloads/AxisAlgo.pem conference-deploy.tar.gz ubuntu@3.16.210.84:/tmp/
```

## Step 4: Back on Server, Extract and Start

Back in your SSH session:

```bash
cd /var/www/html/meet
sudo tar -xzf /tmp/conference-deploy.tar.gz
sudo chown -R www-data:www-data /var/www/html/meet

# Create server-unified.js if not already there
# (Copy from the file in the repo)

# Start with PM2
sudo pm2 delete conference-app 2>/dev/null || true
sudo PORT=3002 NODE_ENV=production pm2 start server-unified.js --name conference-app
sudo pm2 save
```

## Step 5: Update Nginx

```bash
sudo nano /etc/nginx/sites-available/default
```

Add before the closing `}`:

```nginx
    location /meet {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    location /meet/socket.io/ {
        proxy_pass http://localhost:3002/meet/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
```

Then:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Step 6: Test

```bash
# Check PM2
sudo pm2 status

# Check logs
sudo pm2 logs conference-app

# Test locally
curl http://localhost:3002/meet
```

Access at: **https://share.jarmetals.com/meet/**
