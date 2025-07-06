#!/bin/bash
# Simple deployment script for AxisAlgo

echo "=== Starting deployment to production server ==="

# Set up variables
REMOTE_USER="ubuntu"
REMOTE_HOST="3.133.136.182"
PEM_KEY="C:\\Users\\Administrator\\Downloads\\AxisAlgo.pem"
TARGET_DIR="/var/www/html"
GIT_REPO="/home/ubuntu/git/axisalgo.git"

# 1. Push code to production Git repo
echo "Pushing latest code to production..."
export GIT_SSH="C:\\Users\\Administrator\\Documents\\JarWebapp\\AxisAlgo\\ssh-wrapper.bat"
git push production master

# 2. SSH to server and deploy code
echo "SSHing to server to deploy code..."
ssh -i "$PEM_KEY" $REMOTE_USER@$REMOTE_HOST << EOF
  # Create temp directory for checkout
  TEMP_DIR=\$(mktemp -d)
  echo "Using temporary directory: \$TEMP_DIR"
  
  # Checkout the latest code
  echo "Checking out latest code..."
  git --work-tree="\$TEMP_DIR" --git-dir="$GIT_REPO" checkout -f master
  
  # Copy files to web directory
  echo "Copying files to web directory..."
  sudo rm -rf "$TARGET_DIR"/*
  sudo cp -R "\$TEMP_DIR"/* "$TARGET_DIR"/
  
  # Set proper permissions
  echo "Setting permissions..."
  sudo chown -R www-data:www-data "$TARGET_DIR"
  
  # Install Node.js dependencies
  echo "Installing Node.js dependencies..."
  sudo npm install --prefix "$TARGET_DIR"
  
  # Restart the Node.js server
  echo "Restarting Node.js server..."
  sudo pkill -f "node $TARGET_DIR/server.js" || true
  cd "$TARGET_DIR" && sudo nohup node server.js > /dev/null 2>&1 &
  
  # Clean up
  echo "Cleaning up..."
  rm -rf "\$TEMP_DIR"
EOF

echo "=== Deployment completed successfully! ===" 