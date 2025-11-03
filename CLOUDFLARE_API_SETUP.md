# Cloudflare TURN API Setup (Updated)

## How Cloudflare Works

Cloudflare uses **short-lived credentials** that are generated dynamically via their API. This is more secure than static credentials.

## Your Credentials

- **API Token:** `5ac6d30e0d584cca073a3cb922a430c826e25dcd7eaeb674e30fe25024c5e16e`
- **TURN Token ID:** `59d87715faf308d4ea571375623ec7a3`

## Setup Instructions

### 1. Set Environment Variables on Your Server

SSH into your AWS server once:

```bash
ssh -i your-key.pem ubuntu@your-server-ip
cd /var/www/html
sudo nano .env
```

Add these two lines:
```bash
CLOUDFLARE_API_TOKEN=5ac6d30e0d584cca073a3cb922a430c826e25dcd7eaeb674e30fe25024c5e16e
CLOUDFLARE_TURN_TOKEN_ID=59d87715faf308d4ea571375623ec7a3
```

Save and set permissions:
```bash
sudo chmod 600 .env
sudo chown www-data:www-data .env
```

### 2. How It Works

Your server will automatically:
1. Call Cloudflare's API to generate fresh credentials (valid for 24 hours)
2. Cache credentials for 23 hours (to avoid excessive API calls)
3. Return credentials to your frontend via `/api/ice-servers` endpoint

**No need to manually get TURN URLs or passwords!** The server handles everything.

### 3. Restart Your Server

```bash
sudo pm2 restart server
# OR
sudo systemctl restart your-service
```

### 4. Deploy Your Code

Commit and push your changes:
```bash
git add .
git commit -m "Add Cloudflare TURN API support"
git push
```

The deployment script will preserve your `.env` file automatically.

## Testing

After deployment, check your server logs:
```bash
ssh -i your-key.pem ubuntu@your-server-ip
pm2 logs server
```

You should see:
```
🔄 Generating new Cloudflare TURN credentials...
✅ Added Cloudflare TURN servers (generated via API)
```

Or on subsequent requests:
```
✅ Using cached Cloudflare TURN credentials
```

## API Endpoint

Your frontend automatically calls `/api/ice-servers` which:
- Generates fresh Cloudflare credentials (if needed)
- Returns them in the format your WebRTC code expects
- Caches credentials to reduce API calls

## Security Benefits

✅ **Short-lived credentials** - Generated fresh every 24 hours  
✅ **No static passwords** - Credentials expire automatically  
✅ **Server-side generation** - API token never exposed to clients  
✅ **Automatic caching** - Reduces API calls while keeping credentials fresh  

## Troubleshooting

**If you see "Failed to fetch Cloudflare TURN credentials":**
1. Verify your API token is correct
2. Verify your TURN Token ID is correct
3. Check Cloudflare API is accessible from your server
4. Check server logs for detailed error messages

**To force refresh credentials:**
Restart your server - it will generate new credentials on the next request.

## What Changed

- ✅ Server now calls Cloudflare's API to generate credentials
- ✅ Credentials are cached for 23 hours (then auto-refresh)
- ✅ No need to manually configure TURN URLs or passwords
- ✅ More secure - credentials expire automatically

Your app is now configured to use Cloudflare's secure credential generation!

