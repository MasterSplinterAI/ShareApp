# SSH Connection Guide

## Your Server Details
- **Server IP:** 3.133.136.182
- **Username:** ubuntu
- **Key File:** AxisAlgo.pem

## SSH Command (macOS/Linux)

First, find your PEM key file. It might be in:
- `~/Downloads/AxisAlgo.pem`
- `~/Documents/AxisAlgo.pem`
- Or wherever you saved it

Then run:

```bash
ssh -i ~/Downloads/AxisAlgo.pem ubuntu@3.133.136.182
```

Or if your key is in a different location:

```bash
ssh -i /path/to/AxisAlgo.pem ubuntu@3.133.136.182
```

## Set Permissions (Important!)

If you get a "Permissions too open" error, fix the key permissions:

```bash
chmod 400 ~/Downloads/AxisAlgo.pem
ssh -i ~/Downloads/AxisAlgo.pem ubuntu@3.133.136.182
```

## Troubleshooting

**"Permission denied (publickey)" error:**
- Make sure the key file path is correct
- Check permissions: `chmod 400 AxisAlgo.pem`
- Verify you're using the correct username (`ubuntu`)

**"Connection refused" error:**
- Check if your IP is allowed in AWS Security Groups
- Verify the server is running

**"Host key verification failed":**
- Remove old host key: `ssh-keygen -R 3.133.136.182`
- Or use: `ssh -o StrictHostKeyChecking=no -i ~/Downloads/AxisAlgo.pem ubuntu@3.133.136.182`

## Quick Test

Test if you can connect:

```bash
ssh -i ~/Downloads/AxisAlgo.pem ubuntu@3.133.136.182 "echo 'Connection successful!'"
```

## After Connecting

Once connected, you'll be on your server. Then run:

```bash
cd /var/www/html
sudo nano .env
```

Add your Cloudflare credentials:
```
CLOUDFLARE_API_TOKEN=5ac6d30e0d584cca073a3cb922a430c826e25dcd7eaeb674e30fe25024c5e16e
CLOUDFLARE_TURN_TOKEN_ID=59d87715faf308d4ea571375623ec7a3
```

Save (Ctrl+X, then Y, then Enter), then:

```bash
sudo chmod 600 .env
sudo chown www-data:www-data .env
sudo pm2 restart server
```

