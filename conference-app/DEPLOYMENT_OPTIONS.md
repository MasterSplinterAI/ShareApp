# Deployment Options - Without Affecting Main App

## Option 1: Deploy to Subdomain (Recommended)
Deploy the conference app to a subdomain like `meet.yourdomain.com`

### Steps:
1. **Set up subdomain in your DNS**
   - Add A record: `meet.yourdomain.com` → your server IP

2. **Deploy with PM2 on different ports**
   ```bash
   # On your server
   cd /var/www/conference-app
   
   # Install dependencies
   npm install
   
   # Build the app
   npm run build
   
   # Start with PM2 on different ports
   pm2 start npm --name "conference-app" -- run start -- -p 3002
   pm2 start server/socket.js --name "conference-socket"
   pm2 save
   ```

3. **Configure Nginx for subdomain**
   ```nginx
   server {
       listen 80;
       server_name meet.yourdomain.com;
       
       location / {
           proxy_pass http://localhost:3002;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
       
       location /socket.io/ {
           proxy_pass http://localhost:3001;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
       }
   }
   ```

## Option 2: Deploy to Subfolder
Deploy at `yourdomain.com/meet`

### Modify next.config.js:
```javascript
module.exports = {
  basePath: '/meet',
  reactStrictMode: true,
}
```

### Update environment:
```env
NEXT_PUBLIC_WS_URL=wss://yourdomain.com/meet-socket
```

## Option 3: Deploy to Different Server/VPS
Use a separate VPS or cloud instance entirely

### Providers:
- **Vercel** (Free tier) - Perfect for Next.js
- **Railway** - Easy deployment with WebSocket support
- **Render** - Good free tier
- **DigitalOcean App Platform**

## Option 4: Docker Deployment (Isolated)
Keep both apps completely separate using Docker

### Create Dockerfile:
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000 3001

CMD ["npm", "run", "start:all"]
```

### Docker Compose:
```yaml
version: '3'
services:
  conference-app:
    build: .
    ports:
      - "3002:3000"
      - "3003:3001"
    environment:
      - NEXT_PUBLIC_WS_URL=wss://meet.yourdomain.com
    restart: unless-stopped
```

## Quick Deployment Script

Create `deploy.sh` in conference-app folder:

```bash
#!/bin/bash

# Configuration
SERVER="your-server-ip"
USER="your-username"
DEPLOY_PATH="/var/www/conference-app"
SUBDOMAIN="meet.yourdomain.com"

echo "🚀 Deploying Conference App..."

# Build locally
echo "📦 Building application..."
npm run build

# Create deployment package
echo "📦 Creating deployment package..."
tar -czf deploy.tar.gz \
  .next \
  public \
  package*.json \
  server \
  lib \
  app \
  components \
  next.config.js \
  tsconfig.json

# Upload to server
echo "📤 Uploading to server..."
scp deploy.tar.gz $USER@$SERVER:/tmp/

# Deploy on server
echo "🔧 Deploying on server..."
ssh $USER@$SERVER << 'ENDSSH'
  # Create app directory if it doesn't exist
  mkdir -p /var/www/conference-app
  cd /var/www/conference-app
  
  # Extract files
  tar -xzf /tmp/deploy.tar.gz
  
  # Install dependencies
  npm ci --only=production
  
  # Restart services
  pm2 restart conference-app conference-socket || \
  pm2 start npm --name "conference-app" -- run start -- -p 3002
  pm2 start server/socket.js --name "conference-socket"
  
  pm2 save
  
  # Clean up
  rm /tmp/deploy.tar.gz
ENDSSH

# Clean up local
rm deploy.tar.gz

echo "✅ Deployment complete!"
echo "🌐 Access at: https://$SUBDOMAIN"
```

## Environment Variables for Production

Update `.env.production`:
```env
# Your actual Cloudflare credentials
CLOUDFLARE_TURN_API_TOKEN=your_actual_token
CLOUDFLARE_TURN_TOKEN_ID=59d87715faf308d4ea571375623ec7a3

# Production URLs
NEXT_PUBLIC_WS_URL=wss://meet.yourdomain.com/socket.io
```

## SSL/HTTPS Setup

For production, you'll need SSL:

```bash
# Using Certbot
sudo certbot --nginx -d meet.yourdomain.com
```

## Testing Deployment

1. **Test locally with production build:**
   ```bash
   npm run build
   npm run start:all
   ```

2. **Test from mobile on same network:**
   - Find your local IP: `ifconfig` or `ipconfig`
   - Access: `http://YOUR_LOCAL_IP:3000`

3. **Test WebSocket connection:**
   ```bash
   curl -i -N -H "Connection: Upgrade" \
        -H "Upgrade: websocket" \
        -H "Sec-WebSocket-Version: 13" \
        -H "Sec-WebSocket-Key: test" \
        http://localhost:3001/socket.io/
   ```

## Monitoring

Add monitoring with PM2:
```bash
# View logs
pm2 logs conference-app
pm2 logs conference-socket

# Monitor
pm2 monit

# Web dashboard
pm2 install pm2-web
```

## Recommended: Subdomain Approach

The cleanest approach is **Option 1 (Subdomain)**:
- Completely separate from main app
- Easy to manage
- Clean URLs
- Independent scaling
- No conflicts

Would you like me to help you set up any of these deployment options?
