#!/bin/bash
# Deployment script for Daily.co Video Conference App

echo "=== Starting deployment to production server ==="

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
    # Fetch latest changes from remote
    echo "Fetching latest changes from git..."
    git --git-dir="$GIT_REPO" fetch origin main 2>&1 || git --git-dir="$GIT_REPO" fetch origin master 2>&1
    
    # Try to checkout from FETCH_HEAD first (most recent), then fall back to branch
    echo "Checking out latest code from git..."
    if git --work-tree="\$TEMP_DIR" --git-dir="$GIT_REPO" checkout -f FETCH_HEAD 2>&1; then
      echo "Checked out latest code from FETCH_HEAD"
    elif git --work-tree="\$TEMP_DIR" --git-dir="$GIT_REPO" checkout -f main 2>&1; then
      echo "Checked out latest code from main branch"
    elif git --work-tree="\$TEMP_DIR" --git-dir="$GIT_REPO" checkout -f master 2>&1; then
      echo "Checked out latest code from master branch"
    else
      echo "ERROR: Failed to checkout code from git"
      exit 1
    fi
    
    # Verify we got the latest code
    LATEST_COMMIT=\$(git --git-dir="$GIT_REPO" rev-parse FETCH_HEAD 2>/dev/null || git --git-dir="$GIT_REPO" rev-parse HEAD)
    echo "Deployed commit: \$LATEST_COMMIT"
  else
    echo "Git repo not found at $GIT_REPO"
    echo "Please set up the git repo on the server first"
    exit 1
  fi
  
  # Build frontend (only if needed)
  echo "Building frontend..."
  cd "\$TEMP_DIR/livekit-app/frontend"
  npm ci --prefer-offline --no-audit --silent 2>/dev/null || npm install --prefer-offline --no-audit --silent
  npm run build --silent
  
  # Remove node_modules after build to save space
  echo "Removing frontend node_modules after build..."
  rm -rf node_modules
  
  # Clean up old files before copying new ones
  echo "Cleaning up old deployment files..."
  sudo rm -rf $BACKEND_DIR/* 2>/dev/null || true
  sudo rm -rf $FRONTEND_DIR/* 2>/dev/null || true
  
  # Copy backend files
  echo "Copying backend files..."
  sudo cp -R "\$TEMP_DIR/livekit-app/backend"/* $BACKEND_DIR/
  
  # Copy frontend build
  echo "Copying frontend build..."
  sudo cp -R "\$TEMP_DIR/livekit-app/frontend/dist"/* $FRONTEND_DIR/
  
  # Copy other files
  echo "Copying other files..."
  # Copy translation-agent directory (preserve venv if it exists)
  if [ -d "\$TEMP_DIR/livekit-app/translation-agent" ]; then
    echo "Copying translation-agent directory..."
    # Backup venv if it exists
    if [ -d "$AGENT_DIR/venv" ]; then
      echo "Backing up existing venv..."
      sudo mv $AGENT_DIR/venv $AGENT_DIR/venv.backup 2>/dev/null || true
    fi
    # Remove old translation-agent (but preserve .env if it exists)
    if [ -f "$AGENT_DIR/.env" ]; then
      sudo cp $AGENT_DIR/.env /tmp/translation-agent-env.backup 2>/dev/null || true
    fi
    sudo rm -rf $AGENT_DIR 2>/dev/null || true
    sudo mkdir -p $AGENT_DIR
    sudo cp -R "\$TEMP_DIR/livekit-app/translation-agent"/* $AGENT_DIR/
    # Restore venv if backup exists
    if [ -d "$AGENT_DIR/venv.backup" ]; then
      echo "Restoring venv..."
      sudo mv $AGENT_DIR/venv.backup $AGENT_DIR/venv 2>/dev/null || true
    fi
    # Restore .env if backup exists
    if [ -f "/tmp/translation-agent-env.backup" ]; then
      sudo cp /tmp/translation-agent-env.backup $AGENT_DIR/.env 2>/dev/null || true
      sudo rm /tmp/translation-agent-env.backup 2>/dev/null || true
    fi
    echo "Translation-agent copied successfully"
  else
    echo "Warning: translation-agent directory not found in repo"
  fi
  sudo cp "\$TEMP_DIR"/*.md $APP_DIR/ 2>/dev/null || true
  
  # Copy .env files if they exist in the repo
  echo "Copying .env files..."
  if [ -f "\$TEMP_DIR/livekit-app/backend/.env" ]; then
    sudo cp "\$TEMP_DIR/livekit-app/backend/.env" $BACKEND_DIR/.env
    echo "Copied backend/.env"
  else
    echo "Warning: backend/.env not found in repo. Create it manually on server."
  fi
  
  if [ -f "\$TEMP_DIR/livekit-app/translation-agent/.env" ]; then
    sudo cp "\$TEMP_DIR/livekit-app/translation-agent/.env" $AGENT_DIR/.env
    echo "Copied translation-agent/.env"
  else
    echo "Warning: translation-agent/.env not found in repo. Create it manually on server."
  fi
  
  # Set proper permissions
  echo "Setting permissions..."
  sudo chown -R ubuntu:ubuntu $APP_DIR
  
  # Install backend dependencies in final location (only once, not duplicated)
  echo "Installing backend dependencies..."
  cd $BACKEND_DIR
  # Only reinstall if package.json changed or node_modules missing
  if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules/.package-lock.json" ] 2>/dev/null; then
    npm install --production --prefer-offline --no-audit --silent
  else
    echo "Using existing backend node_modules (package.json unchanged)"
  fi
  
  # Install Python dependencies for translation agent (only if requirements changed)
  echo "Installing Python dependencies for translation agent..."
  cd $AGENT_DIR
  if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    pip install --upgrade pip --quiet --disable-pip-version-check
    if [ -f "requirements_livekit.txt" ]; then
      pip install -r requirements_livekit.txt --quiet --disable-pip-version-check
    elif [ -f "requirements.txt" ]; then
      pip install -r requirements.txt --quiet --disable-pip-version-check
    else
      echo "Warning: requirements file not found, installing basic dependencies..."
      pip install livekit-agents livekit-plugins-openai livekit-plugins-silero openai python-dotenv numpy aiohttp websockets --quiet --disable-pip-version-check
    fi
    deactivate
  else
    # Only reinstall if requirements file changed
    source venv/bin/activate
    if [ -f "requirements_livekit.txt" ] && [ "requirements_livekit.txt" -nt "venv/.requirements-installed" ] 2>/dev/null; then
      pip install --upgrade pip --quiet --disable-pip-version-check
      pip install -r requirements_livekit.txt --quiet --disable-pip-version-check
      touch venv/.requirements-installed
      echo "Python dependencies updated"
    elif [ -f "requirements.txt" ] && [ "requirements.txt" -nt "venv/.requirements-installed" ] 2>/dev/null; then
      pip install --upgrade pip --quiet --disable-pip-version-check
      pip install -r requirements.txt --quiet --disable-pip-version-check
      touch venv/.requirements-installed
      echo "Python dependencies updated"
    else
      echo "Using existing Python dependencies (requirements unchanged)"
    fi
    deactivate
  fi
  
  # Install PM2 if not installed
  if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    sudo npm install -g pm2
  fi
  
  # Restart backend server with PM2
  echo "Restarting backend server..."
  pm2 delete livekit-backend 2>/dev/null || true
  pm2 delete share-app-backend 2>/dev/null || true
  cd $BACKEND_DIR
  pm2 start server.js --name livekit-backend --update-env
  pm2 save
  
  # Start translation agent with PM2 (if not already running)
  echo "Starting translation agent..."
  pm2 delete livekit-agent 2>/dev/null || true
  cd $AGENT_DIR
  source venv/bin/activate
  # Use simplified agent (realtime_agent_simple.py) for better architecture
  # Note: PM2 will load .env file automatically when started from the directory containing it
  # The 'dev' command is required by LiveKit CLI framework
  if [ -f "realtime_agent_simple.py" ]; then
    echo "Starting SIMPLIFIED agent with one-per-language architecture..."
    pm2 start realtime_agent_simple.py --name livekit-agent --interpreter venv/bin/python --update-env -- dev
  elif [ -f "realtime_agent_realtime.py" ]; then
    pm2 start realtime_agent_realtime.py --name livekit-agent --interpreter venv/bin/python --update-env -- production
  elif [ -f "realtime_agent.py" ]; then
    pm2 start realtime_agent.py --name livekit-agent --interpreter venv/bin/python --update-env -- production
  else
    echo "ERROR: No agent file found"
    exit 1
  fi
  pm2 save
  deactivate
  
  # Clean up old files to free space
  echo "Cleaning up old files..."
  # DO NOT remove backend node_modules - it's needed for the server to run!
  # Only remove frontend node_modules (not needed after build)
  sudo rm -rf $FRONTEND_DIR/node_modules 2>/dev/null || true
  # Remove old build artifacts
  sudo rm -rf $FRONTEND_DIR/dist 2>/dev/null || true
  sudo rm -rf $FRONTEND_DIR/build 2>/dev/null || true
  # Remove backup folder if it exists
  sudo rm -rf $APP_DIR/backup 2>/dev/null || true
  # Remove any .log files
  sudo find $APP_DIR -name "*.log" -type f -delete 2>/dev/null || true
  
  # Clean up temp directory
  echo "Cleaning up temp directory..."
  rm -rf "\$TEMP_DIR"
  
  # Show disk usage
  echo ""
  echo "Disk usage after cleanup:"
  df -h $APP_DIR | tail -1
  
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
echo "     - $BACKEND_DIR/.env (LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL, PORT)"
echo "     - $AGENT_DIR/.env (LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL, OPENAI_API_KEY, AGENT_NAME)"
echo "  2. Configure Nginx to serve frontend and proxy /api to backend"
echo "  3. Set up SSL certificates (Let's Encrypt) for HTTPS"
echo "  4. Check services: pm2 status"
echo "  5. View logs: pm2 logs livekit-backend or pm2 logs livekit-agent" 