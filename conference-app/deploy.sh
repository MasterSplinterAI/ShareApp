#!/bin/bash

# Conference App Deployment Script for share.jarmetals.com/meet
# This script deploys the conference app to the production server

echo "=== Deploying Conference App to share.jarmetals.com/meet ===" 

# Configuration
SERVER="3.133.136.182"
USER="ubuntu"
KEY="$HOME/Downloads/AxisAlgo.pem"  # Adjust path if needed
REMOTE_DIR="/var/www/html/meet"

# Check if key exists
if [ ! -f "$KEY" ]; then
    echo "Error: PEM key not found at $KEY"
    echo "Please update the KEY path in this script"
    exit 1
fi

echo "Step 1: Building the app..."
npm run build

echo "Step 2: Creating deployment package..."
tar -czf conference-app-deploy.tar.gz \
  .next \
  public \
  package.json \
  package-lock.json \
  server-unified.js \
  next.config.js \
  tsconfig.json \
  postcss.config.js \
  tailwind.config.ts \
  env.production

echo "Step 3: Uploading to server..."
scp -i "$KEY" conference-app-deploy.tar.gz "$USER@$SERVER:/tmp/"

echo "Step 4: Deploying on server..."
ssh -i "$KEY" "$USER@$SERVER" << 'ENDSSH'
  echo "Creating conference app directory..."
  sudo mkdir -p /var/www/html/meet
  
  echo "Extracting files..."
  cd /var/www/html/meet
  sudo tar -xzf /tmp/conference-app-deploy.tar.gz
  
  echo "Copying production environment..."
  if [ -f env.production ]; then
    sudo cp env.production .env.production
  fi
  
  echo "Installing dependencies..."
  sudo npm ci --only=production
  
  echo "Setting permissions..."
  sudo chown -R www-data:www-data /var/www/html/meet
  
  echo "Starting/Restarting with PM2..."
  sudo pm2 delete conference-app 2>/dev/null || true
  cd /var/www/html/meet
  sudo PORT=3002 NODE_ENV=production pm2 start server-unified.js --name conference-app
  sudo pm2 save
  
  echo "Cleaning up..."
  rm /tmp/conference-app-deploy.tar.gz
  
  echo "Conference app deployed successfully!"
ENDSSH

# Clean up local file
rm conference-app-deploy.tar.gz

echo "Step 5: Updating Nginx configuration..."
ssh -i "$KEY" "$USER@$SERVER" << 'ENDSSH'
  # Check if nginx config needs updating
  if ! sudo grep -q "/meet" /etc/nginx/sites-available/default; then
    echo "Adding conference app to Nginx config..."
    sudo tee -a /etc/nginx/sites-available/default << 'EOF'

    # Conference app at /meet
    location /meet {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Socket.io for conference app
    location /meet/socket.io/ {
        proxy_pass http://localhost:3002/meet/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
EOF
    
    echo "Testing Nginx configuration..."
    sudo nginx -t
    
    echo "Reloading Nginx..."
    sudo systemctl reload nginx
  else
    echo "Nginx already configured for /meet"
  fi
ENDSSH

echo ""
echo "=== Deployment Complete! ==="
echo "Conference app is now accessible at:"
echo "https://share.jarmetals.com/meet/"
echo ""
echo "To check logs:"
echo "ssh -i $KEY $USER@$SERVER 'sudo pm2 logs conference-app'"
