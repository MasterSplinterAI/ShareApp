#!/bin/bash
# Fast deployment script - optimized for speed
# Skips unnecessary rebuilds and uses caching

echo "=== Starting FAST deployment to production server ==="

# Set up variables
REMOTE_USER="ubuntu"
REMOTE_HOST="3.16.210.84"
PEM_KEY="$HOME/Downloads/AxisAlgo.pem"
APP_DIR="/var/www/share-app"
BACKEND_DIR="$APP_DIR/livekit-app/backend"
FRONTEND_DIR="$APP_DIR/livekit-app/frontend"
AGENT_DIR="$APP_DIR/livekit-app/translation-agent"
GIT_REPO="/home/ubuntu/git/share-app.git"

# Check if PEM key exists
if [ ! -f "$PEM_KEY" ]; then
  echo "Error: PEM key not found at $PEM_KEY"
  exit 1
fi

# 1. Commit and push to git (if there are changes)
echo "=== Step 1: Checking git status ==="
if [ -n "$(git status --porcelain)" ]; then
  echo "Changes detected. Committing and pushing..."
  read -p "Commit message (or press Enter for default): " COMMIT_MSG
  if [ -z "$COMMIT_MSG" ]; then
    COMMIT_MSG="Fast deploy"
  fi
  
  git add -A
  git commit -m "$COMMIT_MSG"
  git push origin main
else
  echo "No changes to commit. Proceeding with deployment..."
fi

# 2. SSH to server and deploy code
echo "=== Step 2: FAST Deploying to server ==="
ssh -i "$PEM_KEY" $REMOTE_USER@$REMOTE_HOST << 'FASTDEPLOY'
  set -e
  
  APP_DIR="/var/www/share-app"
  BACKEND_DIR="$APP_DIR/livekit-app/backend"
  FRONTEND_DIR="$APP_DIR/livekit-app/frontend"
  AGENT_DIR="$APP_DIR/livekit-app/translation-agent"
  GIT_REPO="/home/ubuntu/git/share-app.git"
  
  echo "Fetching latest code..."
  git --git-dir="$GIT_REPO" fetch origin main 2>&1 || git --git-dir="$GIT_REPO" fetch origin master 2>&1
  
  # Check what changed
  OLD_COMMIT=$(git --git-dir="$GIT_REPO" rev-parse HEAD 2>/dev/null || echo "")
  NEW_COMMIT=$(git --git-dir="$GIT_REPO" rev-parse FETCH_HEAD 2>/dev/null || echo "")
  
  if [ "$OLD_COMMIT" = "$NEW_COMMIT" ] && [ -n "$OLD_COMMIT" ]; then
    echo "⚠️  No new commits - skipping deployment"
    exit 0
  fi
  
  # Create temp directory
  TEMP_DIR=$(mktemp -d)
  echo "Using temp directory: $TEMP_DIR"
  
  # Checkout code
  git --work-tree="$TEMP_DIR" --git-dir="$GIT_REPO" checkout -f FETCH_HEAD 2>&1 || \
  git --work-tree="$TEMP_DIR" --git-dir="$GIT_REPO" checkout -f main 2>&1 || \
  git --work-tree="$TEMP_DIR" --git-dir="$GIT_REPO" checkout -f master 2>&1
  
  LATEST_COMMIT=$(git --git-dir="$GIT_REPO" rev-parse FETCH_HEAD 2>/dev/null || git --git-dir="$GIT_REPO" rev-parse HEAD)
  echo "Deploying commit: $LATEST_COMMIT"
  
  # Check what files changed to optimize
  CHANGED_FILES=$(git --git-dir="$GIT_REPO" diff --name-only HEAD FETCH_HEAD 2>/dev/null || echo "")
  NEED_FRONTEND_BUILD=false
  NEED_BACKEND_INSTALL=false
  NEED_AGENT_INSTALL=false
  
  if echo "$CHANGED_FILES" | grep -q "livekit-app/frontend"; then
    NEED_FRONTEND_BUILD=true
  fi
  if echo "$CHANGED_FILES" | grep -q "livekit-app/backend/package.json\|livekit-app/backend/.*\.js"; then
    NEED_BACKEND_INSTALL=true
  fi
  if echo "$CHANGED_FILES" | grep -q "livekit-app/translation-agent/requirements\|livekit-app/translation-agent/.*\.py"; then
    NEED_AGENT_INSTALL=true
  fi
  
  # OPTIMIZATION: Only build frontend if needed
  if [ "$NEED_FRONTEND_BUILD" = true ] || [ ! -d "$FRONTEND_DIR/index.html" ]; then
    echo "Building frontend..."
    cd "$TEMP_DIR/livekit-app/frontend"
    # Use existing node_modules if package.json unchanged
    if [ -d "$FRONTEND_DIR/node_modules" ] && [ "$FRONTEND_DIR/package.json" -nt "$TEMP_DIR/livekit-app/frontend/package.json" ]; then
      echo "Using cached node_modules..."
      cp -r "$FRONTEND_DIR/node_modules" .
    else
      npm ci --prefer-offline --no-audit --silent 2>/dev/null || npm install --prefer-offline --no-audit --silent
    fi
    npm run build --silent
  else
    echo "⏭️  Skipping frontend build (no changes)"
  fi
  
  # Copy files (only if changed)
  echo "Copying files..."
  
  # Backend - preserve node_modules if package.json unchanged
  if [ "$NEED_BACKEND_INSTALL" = false ] && [ -d "$BACKEND_DIR/node_modules" ]; then
    echo "Preserving backend node_modules..."
    sudo rm -rf "$BACKEND_DIR"/*.js "$BACKEND_DIR"/*.json "$BACKEND_DIR"/routes "$BACKEND_DIR"/.env 2>/dev/null || true
    sudo cp -R "$TEMP_DIR/livekit-app/backend"/*.js "$TEMP_DIR/livekit-app/backend"/*.json "$TEMP_DIR/livekit-app/backend"/routes "$BACKEND_DIR/" 2>/dev/null || true
  else
    echo "Full backend copy (dependencies changed)..."
    sudo rm -rf "$BACKEND_DIR"/* 2>/dev/null || true
    sudo cp -R "$TEMP_DIR/livekit-app/backend"/* "$BACKEND_DIR/"
    cd "$BACKEND_DIR"
    npm install --production --prefer-offline --no-audit --silent
  fi
  
  # Frontend - only copy dist if built
  if [ "$NEED_FRONTEND_BUILD" = true ] || [ ! -d "$FRONTEND_DIR/index.html" ]; then
    sudo rm -rf "$FRONTEND_DIR"/* 2>/dev/null || true
    sudo cp -R "$TEMP_DIR/livekit-app/frontend/dist"/* "$FRONTEND_DIR/"
  fi
  
  # Agent - preserve venv, only copy code
  echo "Copying translation-agent..."
  if [ -d "$AGENT_DIR/venv" ]; then
    sudo mv "$AGENT_DIR/venv" "$AGENT_DIR/venv.backup" 2>/dev/null || true
  fi
  if [ -f "$AGENT_DIR/.env" ]; then
    sudo cp "$AGENT_DIR/.env" /tmp/agent-env.backup 2>/dev/null || true
  fi
  
  sudo rm -rf "$AGENT_DIR"/*.py "$AGENT_DIR"/*.txt "$AGENT_DIR"/*.md "$AGENT_DIR"/*.sh 2>/dev/null || true
  sudo cp -R "$TEMP_DIR/livekit-app/translation-agent"/*.py "$TEMP_DIR/livekit-app/translation-agent"/*.txt "$TEMP_DIR/livekit-app/translation-agent"/*.md "$TEMP_DIR/livekit-app/translation-agent"/*.sh "$AGENT_DIR/" 2>/dev/null || true
  
  # Restore venv
  if [ -d "$AGENT_DIR/venv.backup" ]; then
    sudo mv "$AGENT_DIR/venv.backup" "$AGENT_DIR/venv"
  fi
  if [ -f "/tmp/agent-env.backup" ]; then
    sudo cp /tmp/agent-env.backup "$AGENT_DIR/.env"
    sudo rm /tmp/agent-env.backup
  fi
  
  # Only install Python deps if requirements changed
  if [ "$NEED_AGENT_INSTALL" = true ] || [ ! -d "$AGENT_DIR/venv" ]; then
    echo "Installing Python dependencies..."
    cd "$AGENT_DIR"
    if [ ! -d "venv" ]; then
      python3 -m venv venv
    fi
    source venv/bin/activate
    pip install --upgrade pip --quiet --disable-pip-version-check
    if [ -f "requirements_livekit.txt" ]; then
      pip install -r requirements_livekit.txt --quiet --disable-pip-version-check
    elif [ -f "requirements.txt" ]; then
      pip install -r requirements.txt --quiet --disable-pip-version-check
    fi
    deactivate
  else
    echo "⏭️  Skipping Python install (no changes)"
  fi
  
  # Set permissions
  sudo chown -R ubuntu:ubuntu "$APP_DIR"
  
  # Restart services
  echo "Restarting services..."
  pm2 restart livekit-backend --update-env 2>/dev/null || {
    cd "$BACKEND_DIR"
    pm2 start server.js --name livekit-backend --update-env
  }
  
  pm2 restart livekit-agent --update-env 2>/dev/null || {
    cd "$AGENT_DIR"
    source venv/bin/activate
    pm2 start realtime_agent.py --name livekit-agent --interpreter venv/bin/python -- start
    deactivate
  }
  
  pm2 save
  
  # Cleanup
  rm -rf "$TEMP_DIR"
  
  echo "✅ Fast deployment completed!"
  echo "Deployed commit: $LATEST_COMMIT"
FASTDEPLOY

echo ""
echo "=== Fast deployment completed! ==="

