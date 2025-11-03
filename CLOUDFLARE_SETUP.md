# Cloudflare TURN Configuration

## Your Credentials

You've been provided with Cloudflare TURN credentials:
- **Name:** jar-share
- **Turn Token ID:** 59d87715faf308d4ea571375623ec7a3
- **API Token:** 5ac6d30e0d584cca073a3cb922a430c826e25dcd7eaeb674e30fe25024c5e16e

## Setup Instructions

### Method 1: Direct Configuration (Recommended for Quick Setup)

Cloudflare's Realtime TURN service typically provides TURN URLs. You'll need to get the actual TURN server URLs from your Cloudflare dashboard. Once you have them, set these environment variables:

```bash
export CLOUDFLARE_TURN_URLS="turn:your-domain.cloudflare.com:3478?transport=udp,turn:your-domain.cloudflare.com:3478?transport=tcp,turns:your-domain.cloudflare.com:5349?transport=tcp"
export CLOUDFLARE_TURN_USERNAME="your_username"
export CLOUDFLARE_TURN_CREDENTIAL="your_password"
```

### Method 2: API-Based Configuration (If Cloudflare Provides API Access)

If Cloudflare provides an API endpoint to fetch credentials, set:

```bash
export CLOUDFLARE_API_TOKEN="5ac6d30e0d584cca073a3cb922a430c826e25dcd7eaeb674e30fe25024c5e16e"
export CLOUDFLARE_TURN_TOKEN_ID="59d87715faf308d4ea571375623ec7a3"
export CLOUDFLARE_ACCOUNT_ID="your_cloudflare_account_id"
```

## Getting Your Cloudflare TURN URLs

1. Log into your Cloudflare dashboard: https://dash.cloudflare.com/
2. Navigate to the Realtime section
3. Find your TURN service (jar-share)
4. Copy the TURN server URLs (typically look like):
   - `turn:your-domain.cloudflare.com:3478?transport=udp`
   - `turn:your-domain.cloudflare.com:3478?transport=tcp`
   - `turns:your-domain.cloudflare.com:5349?transport=tcp`
5. Get the username and password/credential

## Quick Start

Once you have the TURN URLs and credentials, create a `.env` file in your project root:

```bash
# Cloudflare TURN Configuration
CLOUDFLARE_TURN_URLS=turn:your-domain.cloudflare.com:3478?transport=udp,turn:your-domain.cloudflare.com:3478?transport=tcp,turns:your-domain.cloudflare.com:5349?transport=tcp
CLOUDFLARE_TURN_USERNAME=your_username_here
CLOUDFLARE_TURN_CREDENTIAL=your_password_here
```

Then restart your server:

```bash
node server.js
```

## Testing

After setting up, check your server logs. You should see:
```
✅ Added Cloudflare TURN servers (direct configuration)
```

Test with international users and check the browser console for:
```
🌐 Using TURN relay (important for international users)
```

## Security Note

⚠️ **Important:** Never commit your `.env` file or credentials to version control. Add `.env` to your `.gitignore` file.

## Troubleshooting

If you don't see the Cloudflare TURN servers being added:
1. Check that environment variables are set correctly
2. Verify the TURN URLs format is correct
3. Check server logs for any error messages
4. Try accessing `/api/ice-servers` endpoint directly to see what's returned

## Need Help?

If Cloudflare's dashboard doesn't show the TURN URLs clearly, you may need to:
1. Contact Cloudflare support for the exact TURN server URLs
2. Check Cloudflare's API documentation for fetching credentials
3. Use the generic TURN_URLS format if you have the URLs but not API access

