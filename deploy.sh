#!/bin/bash
# Deployment script for Daily.co Video Conference App

echo "=== Starting deployment to production server ==="

# Set up variables
REMOTE_USER="ubuntu"
REMOTE_HOST="3.16.210.84"
PEM_KEY="$HOME/Downloads/AxisAlgo.pem"
APP_DIR="/var/www/share-app"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"
GIT_REPO="/home/ubuntu/git/share-app.git"

# Check if PEM key exists
if [ ! -f "$PEM_KEY" ]; then
  echo "Error: PEM key not found at $PEM_KEY"
  echo "Please update PEM_KEY path in deploy.sh"
  exit 1
fi

# 1. Commit and push to git (if there are changes)
echo "=== Step 1: Checking git status ==="
if [ -n "$(git status --porcelain)" ]; then
  echo "Changes detected. Committing and pushing..."
  read -p "Commit message (or press Enter for default): " COMMIT_MSG
  if [ -z "$COMMIT_MSG" ]; then
    COMMIT_MSG="Deploy Daily.co video conference app"
  fi
  
  git add -A
  git commit -m "$COMMIT_MSG"
  git push origin main
else
  echo "No changes to commit. Proceeding with deployment..."
fi

# 2. SSH to server and deploy code
echo "=== Step 2: Deploying to server ==="
ssh -i "$PEM_KEY" $REMOTE_USER@$REMOTE_HOST << EOF
  set -e  # Exit on error
  
  echo "Creating app directory..."
  sudo mkdir -p $APP_DIR
  sudo mkdir -p $BACKEND_DIR
  sudo mkdir -p $FRONTEND_DIR
  
  # Create temp directory for checkout
  TEMP_DIR=\$(mktemp -d)
  echo "Using temporary directory: \$TEMP_DIR"
  
  # Checkout the latest code
  echo "Checking out latest code..."
  if [ -d "$GIT_REPO" ]; then
    git --work-tree="\$TEMP_DIR" --git-dir="$GIT_REPO" checkout -f main || git --work-tree="\$TEMP_DIR" --git-dir="$GIT_REPO" checkout -f master
  else
    echo "Git repo not found at $GIT_REPO"
    echo "Please set up the git repo on the server first"
    exit 1
  fi
  
  # Install backend dependencies
  echo "Installing backend dependencies..."
  cd "\$TEMP_DIR/backend"
  npm install --production
  
  # Build frontend
  echo "Building frontend..."
  cd "\$TEMP_DIR/frontend"
  npm install
  npm run build
  
  # Copy backend files
  echo "Copying backend files..."
  sudo rm -rf $BACKEND_DIR/*
  sudo cp -R "\$TEMP_DIR/backend"/* $BACKEND_DIR/
  
  # Copy frontend build
  echo "Copying frontend build..."
  sudo rm -rf $FRONTEND_DIR/*
  sudo cp -R "\$TEMP_DIR/frontend/dist"/* $FRONTEND_DIR/
  
  # Copy other files
  echo "Copying other files..."
  sudo cp -R "\$TEMP_DIR/translation-agent" $APP_DIR/ 2>/dev/null || true
  sudo cp "\$TEMP_DIR"/*.md $APP_DIR/ 2>/dev/null || true
  
  # Set proper permissions
  echo "Setting permissions..."
  sudo chown -R ubuntu:ubuntu $APP_DIR
  
  # Install PM2 if not installed
  if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    sudo npm install -g pm2
  fi
  
  # Restart backend server with PM2
  echo "Restarting backend server..."
  cd $BACKEND_DIR
  pm2 delete share-app-backend 2>/dev/null || true
  pm2 start server.js --name share-app-backend --update-env
  pm2 save
  
  # Set up Nginx for frontend (if needed)
  echo "Frontend built and ready. Configure Nginx to serve $FRONTEND_DIR"
  
  # Clean up
  echo "Cleaning up..."
  rm -rf "\$TEMP_DIR"
  
  echo "=== Deployment completed successfully! ==="
  echo "Backend running on port 3000"
  echo "Frontend built in $FRONTEND_DIR"
  echo "Make sure to:"
  echo "  1. Set up .env files in backend/ and translation-agent/"
  echo "  2. Configure Nginx to serve the frontend"
  echo "  3. Set up SSL certificates for HTTPS (required for WebRTC)"
EOF

echo ""
echo "=== Local deployment completed! ==="
echo "Next steps on server:"
echo "  1. SSH to server and set up .env files:"
echo "     - $BACKEND_DIR/.env (DAILY_API_KEY, PORT, FRONTEND_URL)"
echo "     - $FRONTEND_DIR/.env (if needed)"
echo "  2. Configure Nginx to serve frontend and proxy /api to backend"
echo "  3. Set up SSL certificates (Let's Encrypt) for HTTPS"
echo "  4. Restart services: pm2 restart share-app-backend" 