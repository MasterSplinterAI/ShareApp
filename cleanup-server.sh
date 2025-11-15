#!/bin/bash
# Server cleanup script - run this on the server to free up space

echo "=== Server Cleanup Script ==="

APP_DIR="/var/www/share-app"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"

echo "Current disk usage:"
df -h | grep -E "Filesystem|/var"

echo ""
echo "Cleaning up..."

# Remove node_modules (will be reinstalled on next deploy)
echo "Removing node_modules..."
sudo rm -rf $BACKEND_DIR/node_modules 2>/dev/null || true
sudo rm -rf $FRONTEND_DIR/node_modules 2>/dev/null || true

# Remove old build artifacts
echo "Removing old build artifacts..."
sudo rm -rf $FRONTEND_DIR/dist 2>/dev/null || true
sudo rm -rf $FRONTEND_DIR/build 2>/dev/null || true

# Remove backup folder
echo "Removing backup folder..."
sudo rm -rf $APP_DIR/backup 2>/dev/null || true

# Remove log files
echo "Removing log files..."
sudo find $APP_DIR -name "*.log" -type f -delete 2>/dev/null || true

# Remove npm cache
echo "Cleaning npm cache..."
npm cache clean --force 2>/dev/null || true

# Remove PM2 logs (older than 7 days)
echo "Cleaning PM2 logs..."
pm2 flush 2>/dev/null || true

# Remove old git objects
echo "Cleaning git repository..."
if [ -d "/home/ubuntu/git/share-app.git" ]; then
  cd /home/ubuntu/git/share-app.git
  git gc --prune=now --aggressive 2>/dev/null || true
fi

# Show disk usage after cleanup
echo ""
echo "Disk usage after cleanup:"
df -h | grep -E "Filesystem|/var"

echo ""
echo "=== Cleanup completed! ==="

