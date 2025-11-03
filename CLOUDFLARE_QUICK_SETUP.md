# Quick Cloudflare TURN Setup Guide

## Your Credentials (Already Set)

- **Turn Token ID:** `59d87715faf308d4ea571375623ec7a3`
- **API Token:** `5ac6d30e0d584cca073a3cb922a430c826e25dcd7eaeb674e30fe25024c5e16e`

## Next Steps - Get Your TURN URLs

You need to get the actual TURN server URLs from Cloudflare. Here's how:

### Option 1: Cloudflare Dashboard

1. Go to https://dash.cloudflare.com/
2. Navigate to **Realtime** → **TURN** (or search for "Realtime")
3. Find your service: **jar-share**
4. Look for **TURN Server URLs** - they should look like:
   - `turn:xxx.cloudflare.com:3478?transport=udp`
   - `turn:xxx.cloudflare.com:3478?transport=tcp`
   - `turns:xxx.cloudflare.com:5349?transport=tcp`
5. Get the **username** and **password/credential**

### Option 2: Cloudflare API (If Available)

If Cloudflare provides an API endpoint, you might need your Account ID. You can find it:
- In your Cloudflare dashboard URL
- Or in your account settings

## Once You Have the URLs

Create a `.env` file in your project root:

```bash
# Cloudflare TURN Configuration
CLOUDFLARE_TURN_URLS=turn:your-domain.cloudflare.com:3478?transport=udp,turn:your-domain.cloudflare.com:3478?transport=tcp,turns:your-domain.cloudflare.com:5349?transport=tcp
CLOUDFLARE_TURN_USERNAME=your_username_from_dashboard
CLOUDFLARE_TURN_CREDENTIAL=your_password_from_dashboard
```

**Or** set environment variables directly:

```bash
export CLOUDFLARE_TURN_URLS="turn:your-domain.cloudflare.com:3478?transport=udp,turn:your-domain.cloudflare.com:3478?transport=tcp,turns:your-domain.cloudflare.com:5349?transport=tcp"
export CLOUDFLARE_TURN_USERNAME="your_username"
export CLOUDFLARE_TURN_CREDENTIAL="your_password"
```

## Restart Your Server

```bash
node server.js
```

You should see in the logs:
```
✅ Added Cloudflare TURN servers (direct configuration)
```

## Testing

1. Open your app in a browser
2. Open browser console (F12)
3. Join a meeting
4. Look for logs like:
   ```
   🌐 Using TURN relay (important for international users)
   ✅ Connection established via...
   ```

## If You Can't Find the URLs

1. Check Cloudflare's documentation: https://developers.cloudflare.com/realtime/
2. Contact Cloudflare support
3. Check if there's an API endpoint to fetch credentials using your API token

## Security Reminder

⚠️ **Never commit your `.env` file!** Add it to `.gitignore`:

```bash
echo ".env" >> .gitignore
```

## Need Help?

If you're having trouble finding the TURN URLs:
- Check Cloudflare's Realtime documentation
- Look for API endpoints that use your API token
- Contact Cloudflare support with your token ID

