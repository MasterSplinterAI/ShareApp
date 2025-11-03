# Quick Setup Commands for Share-App

## You're currently in /var/www/html

You have two sites:
- `axisalgo` 
- `share-app` ← This is the one we're configuring

## Setup Steps

```bash
# Navigate to share-app directory
cd /var/www/html/share-app

# Create .env file
sudo nano .env
```

**Paste these two lines:**
```
CLOUDFLARE_API_TOKEN=5ac6d30e0d584cca073a3cb922a430c826e25dcd7eaeb674e30fe25024c5e16e
CLOUDFLARE_TURN_TOKEN_ID=59d87715faf308d4ea571375623ec7a3
```

**Save:** Ctrl+X, then Y, then Enter

**Then set permissions:**
```bash
sudo chmod 600 .env
sudo chown www-data:www-data .env
```

**Install dotenv if not already installed:**
```bash
sudo npm install dotenv
```

**Check if you're using pm2:**
```bash
pm2 list
```

**If using pm2, restart:**
```bash
sudo pm2 restart share-app
# OR if it's named differently:
sudo pm2 restart all
```

**If NOT using pm2, restart manually:**
```bash
sudo pkill -f "node.*share-app"
cd /var/www/html/share-app
sudo PORT=3000 node server.js > /tmp/share-app.log 2>&1 &
```

**Check logs to verify it's working:**
```bash
pm2 logs share-app
# OR
tail -f /tmp/share-app.log
```

You should see:
```
✅ Added Cloudflare TURN servers (generated via API)
```

