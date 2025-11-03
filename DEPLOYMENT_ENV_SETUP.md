# Deployment Guide: Environment Variables for AWS Server

## Important: Security First!

⚠️ **NEVER commit your `.env` file to git!** It's already in `.gitignore`, but make sure it stays there.

## Setup Options

You have two options:

### Option 1: Use `.env` File (Recommended - Easy)

**On your AWS server (SSH in once):**

```bash
# SSH into your server
ssh -i your-key.pem ubuntu@your-server-ip

# Navigate to your app directory
cd /var/www/html

# Create .env file
sudo nano .env
```

Add your Cloudflare credentials (only need API token and token ID - server generates credentials automatically):
```bash
CLOUDFLARE_API_TOKEN=5ac6d30e0d584cca073a3cb922a430c826e25dcd7eaeb674e30fe25024c5e16e
CLOUDFLARE_TURN_TOKEN_ID=59d87715faf308d4ea571375623ec7a3
```

Save and exit (Ctrl+X, Y, Enter)

**Install dotenv package:**
```bash
cd /var/www/html
sudo npm install dotenv
```

**Update your deployment script** to preserve the `.env` file during deployment (see below)

### Option 2: Use System Environment Variables (More Secure)

**On your AWS server (SSH in once):**

```bash
# SSH into your server
ssh -i your-key.pem ubuntu@your-server-ip

# Edit your shell profile (choose one based on your setup)
sudo nano ~/.bashrc
# OR if using pm2:
sudo nano /etc/environment
```

Add at the end:
```bash
export CLOUDFLARE_TURN_URLS="turn:your-domain.cloudflare.com:3478?transport=udp,turn:your-domain.cloudflare.com:3478?transport=tcp,turns:your-domain.cloudflare.com:5349?transport=tcp"
export CLOUDFLARE_TURN_USERNAME="your_username"
export CLOUDFLARE_TURN_CREDENTIAL="your_password"
```

**If using PM2:**
```bash
# PM2 ecosystem file approach (better)
sudo nano /var/www/html/ecosystem.config.js
```

Create the file:
```javascript
module.exports = {
  apps: [{
    name: 'server',
    script: './server.js',
    env: {
      CLOUDFLARE_TURN_URLS: 'turn:your-domain.cloudflare.com:3478?transport=udp,turn:your-domain.cloudflare.com:3478?transport=tcp,turns:your-domain.cloudflare.com:5349?transport=tcp',
      CLOUDFLARE_TURN_USERNAME: 'your_username',
      CLOUDFLARE_TURN_CREDENTIAL: 'your_password'
    }
  }]
}
```

Then update pm2 to use the ecosystem file:
```bash
pm2 delete server
pm2 start ecosystem.config.js
pm2 save
```

## Update Your Deployment Script

Update `post-receive.sh` to preserve the `.env` file:

```bash
# After copying files, preserve .env if it exists
if [ -f "$TARGET/.env" ]; then
    echo "Preserving existing .env file..."
    sudo cp "$TARGET/.env" "$TARGET/.env.backup"
fi

# Copy files to web directory
sudo rm -rf "$TARGET"/*
sudo cp -R "$TEMP_GIT_CLONE"/* "$TARGET"/

# Restore .env if it existed
if [ -f "$TARGET/.env.backup" ]; then
    echo "Restoring .env file..."
    sudo mv "$TARGET/.env.backup" "$TARGET/.env"
fi
```

## Update server.js to Load Environment Variables

Add this at the very top of `server.js`:

```javascript
// Load environment variables from .env file
require('dotenv').config();
```

## Quick Setup Script

Here's a one-time setup script you can run on your server:

```bash
#!/bin/bash
# Run this ONCE on your AWS server

cd /var/www/html

# Install dotenv
sudo npm install dotenv

# Create .env file (you'll need to edit it)
sudo nano .env
# Paste your Cloudflare credentials, save and exit

# Restart your server
sudo pm2 restart server || sudo systemctl restart your-service
```

## Testing

After setup, test that environment variables are loaded:

```bash
# SSH into server
ssh -i your-key.pem ubuntu@your-server-ip

# Check if variables are loaded
cd /var/www/html
node -e "require('dotenv').config(); console.log(process.env.CLOUDFLARE_TURN_USERNAME)"
```

## Deployment Workflow

1. **Local development:** Create `.env` locally (not committed)
2. **First time on server:** SSH in once to create `.env` file
3. **Future deployments:** Just `git push` - the `.env` file will be preserved

## Verification

After deployment, check server logs:
```bash
# SSH into server
ssh -i your-key.pem ubuntu@your-server-ip

# Check logs
pm2 logs server
# OR
tail -f /var/log/your-app.log
```

You should see:
```
✅ Added Cloudflare TURN servers (direct configuration)
```

## Troubleshooting

**If environment variables aren't loading:**
1. Check `.env` file exists: `ls -la /var/www/html/.env`
2. Check file permissions: `sudo chmod 600 /var/www/html/.env`
3. Verify dotenv is installed: `npm list dotenv`
4. Check server logs for errors

**If using PM2:**
```bash
# Restart with environment variables
pm2 restart server --update-env
```

## Security Best Practices

1. ✅ `.env` is in `.gitignore` (already done)
2. ✅ Set `.env` permissions: `chmod 600 .env` (only owner can read)
3. ✅ Use strong passwords for TURN credentials
4. ✅ Rotate credentials periodically
5. ✅ Never share `.env` file contents

