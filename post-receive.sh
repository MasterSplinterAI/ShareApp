#!/bin/bash
# Deployment script for Node.js application
TARGET="/var/www/html"
GIT_DIR="/home/ubuntu/git/axisalgo.git"
BRANCH="master"
echo "=== Starting deployment $(date) ==="
echo "Target directory: $TARGET"
echo "Git directory: $GIT_DIR"
echo "Branch: $BRANCH"
# Create a temp directory for the checkout
TEMP_GIT_CLONE=$(mktemp -d)
echo "Using temporary directory: $TEMP_GIT_CLONE"
# Checkout the latest code
echo "Checking out latest code..."
git --work-tree="$TEMP_GIT_CLONE" --git-dir="$GIT_DIR" checkout -f "$BRANCH"
# Copy files to the web directory
echo "Copying files to web directory..."
sudo rm -rf "$TARGET"/*
sudo cp -R "$TEMP_GIT_CLONE"/* "$TARGET"/
# Set proper permissions
echo "Setting permissions..."
sudo chown -R www-data:www-data "$TARGET"
# Install Node.js dependencies
echo "Installing Node.js dependencies..."
sudo npm install --prefix "$TARGET"
# Restart the Node.js server (assuming it's managed by pm2 or similar)
echo "Restarting Node.js server..."
# Check if pm2 is installed, if not, start the server directly
if command -v pm2 &> /dev/null; then
    sudo pm2 restart server || sudo pm2 start "$TARGET/server.js" --name server
else
    # If no process manager, attempt to start directly (assuming it's not already running)
    sudo pkill -f "node $TARGET/server.js" || true
    sudo nohup node "$TARGET/server.js" &
fi
# Clean up
echo "Cleaning up..."
rm -rf "$TEMP_GIT_CLONE"
echo "=== Deployment completed successfully! $(date) ==="
