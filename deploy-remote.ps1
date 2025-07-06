# AxisAlgo Remote Deployment Script
# This script deploys the application to the remote server by pushing to the production Git repository

Write-Host "=== Starting deployment to production server ===" -ForegroundColor Green

# Set up variables
$REMOTE_USER = "ubuntu"
$REMOTE_HOST = "3.133.136.182"
$PEM_KEY = "C:\Users\Administrator\Downloads\AxisAlgo.pem"
$TARGET_DIR = "/var/www/html"
$GIT_REPO = "/home/ubuntu/git/axisalgo.git"

# 1. Ask if we should stage and commit all changes
$commitChanges = Read-Host "Do you want to commit all changes before deploying? (y/n)"
if ($commitChanges -eq "y") {
    # Stage all changes
    Write-Host "Staging all changes..." -ForegroundColor Cyan
    git add .
    
    # Get commit message
    $commitMsg = Read-Host "Enter commit message"
    
    # Commit changes
    Write-Host "Committing changes..." -ForegroundColor Cyan
    git commit -m $commitMsg
}

# 2. Push code to production Git repo
Write-Host "Pushing latest code to production..." -ForegroundColor Cyan
$env:GIT_SSH = 'C:\Users\Administrator\Documents\JarWebapp\AxisAlgo\ssh-wrapper.bat'
git push production master

# 3. SSH to server and execute deployment commands one by one
Write-Host "Deploying code on the server..." -ForegroundColor Cyan

# Kill all Node.js processes to avoid port conflicts
Write-Host "Killing all Node.js processes..." -ForegroundColor Yellow
ssh -i $PEM_KEY $REMOTE_USER@$REMOTE_HOST "sudo killall node || true"

# Create a temp directory and store it
Write-Host "Creating temporary directory..." -ForegroundColor Cyan
$TEMP_DIR = ssh -i $PEM_KEY $REMOTE_USER@$REMOTE_HOST "mktemp -d"
Write-Host "Created temporary directory: $TEMP_DIR" -ForegroundColor Cyan

# Checkout the latest code
Write-Host "Checking out latest code..." -ForegroundColor Cyan
ssh -i $PEM_KEY $REMOTE_USER@$REMOTE_HOST "git --work-tree=$TEMP_DIR --git-dir=$GIT_REPO checkout -f master"

# Copy files to web directory
Write-Host "Copying files to web directory..." -ForegroundColor Cyan
ssh -i $PEM_KEY $REMOTE_USER@$REMOTE_HOST "sudo rm -rf $TARGET_DIR/* && sudo cp -R $TEMP_DIR/* $TARGET_DIR/"

# Set proper permissions
Write-Host "Setting permissions..." -ForegroundColor Cyan
ssh -i $PEM_KEY $REMOTE_USER@$REMOTE_HOST "sudo chown -R www-data:www-data $TARGET_DIR"

# Install Node.js dependencies
Write-Host "Installing Node.js dependencies..." -ForegroundColor Cyan
ssh -i $PEM_KEY $REMOTE_USER@$REMOTE_HOST "cd $TARGET_DIR && sudo npm install --verbose"

# Build Tailwind CSS
Write-Host "Building Tailwind CSS..." -ForegroundColor Cyan
ssh -i $PEM_KEY $REMOTE_USER@$REMOTE_HOST "cd $TARGET_DIR && sudo npx tailwindcss -i ./src/styles.css -o ./public/styles.css"

# Start the Node.js server
Write-Host "Starting Node.js server..." -ForegroundColor Cyan
ssh -i $PEM_KEY $REMOTE_USER@$REMOTE_HOST "cd $TARGET_DIR && sudo PORT=3000 node server.js > /tmp/node-server.log 2>&1 &"

# Clean up
Write-Host "Cleaning up..." -ForegroundColor Cyan
ssh -i $PEM_KEY $REMOTE_USER@$REMOTE_HOST "rm -rf $TEMP_DIR"

Write-Host "=== Deployment completed successfully! ===" -ForegroundColor Green
Write-Host "The application should now be accessible at https://share.jarmetals.com" -ForegroundColor Green 