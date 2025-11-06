# Manual Deployment Guide

## Quick Deploy (SSH'd into server)

```bash
# Navigate to web directory
cd /var/www/html

# Pull latest code
sudo git pull origin main

# Install dependencies (if needed - skip if already installed)
sudo npm install --production=false

# Build Vue app (with low priority to prevent server freeze)
sudo nice -n 19 ionice -c 3 timeout 300 npm run build:vue || echo "Build failed or timed out"

# Restart Node.js server
sudo pkill -f "node.*server.js" || true
sleep 2
sudo -u www-data PORT=3000 nohup node server.js > /tmp/share-app.log 2>&1 &

# Check if server started
sleep 3
ps aux | grep 'node.*server.js' | grep -v grep

# Check server logs
tail -20 /tmp/share-app.log
```

## Full Deploy Script (Copy/paste all at once)

```bash
cd /var/www/html && \
sudo git pull origin main && \
sudo nice -n 10 npm install --production=false && \
sudo nice -n 19 ionice -c 3 timeout 300 npm run build:vue || echo "Build skipped/failed" && \
sudo pkill -f "node.*server.js" || true && \
sleep 2 && \
sudo -u www-data bash -c "cd /var/www/html && PORT=3000 nohup node server.js > /tmp/share-app.log 2>&1 &" && \
sleep 3 && \
ps aux | grep 'node.*server.js' | grep -v grep && \
echo "=== Server Logs ===" && \
tail -20 /tmp/share-app.log
```

## Check Server Status

```bash
# Check if Node.js server is running
ps aux | grep 'node.*server.js' | grep -v grep

# Check recent logs
tail -50 /tmp/share-app.log

# Check Apache status
sudo systemctl status apache2

# Check disk space
df -h

# Check memory usage
free -h
```

## Troubleshooting

### If server won't start:
```bash
# Check for errors
tail -100 /tmp/share-app.log

# Check if port 3000 is in use
sudo lsof -i :3000

# Try starting manually to see errors
cd /var/www/html
sudo -u www-data node server.js
```

### If build fails:
```bash
# Check Node.js version (should be 18+)
node --version

# Check if dependencies are installed
ls -la node_modules | head -20

# Reinstall dependencies
sudo npm install --production=false
```

### If Apache won't serve the app:
```bash
# Restart Apache
sudo systemctl restart apache2

# Check Apache error logs
sudo tail -50 /var/log/apache2/error.log
```

