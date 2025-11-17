# Fix EC2 Security Group for Connection Timeout

## Problem
Connection timeout when accessing `share.jarmetals.com` - this is almost always caused by EC2 Security Group blocking ports 80/443.

## Diagnosis Results
✅ Nginx is running and listening on port 80
✅ Backend is responding on port 3000
✅ Nginx responds locally
✅ UFW firewall is inactive (not blocking)
❌ **EC2 Security Group is blocking external traffic**

## Solution: Open Ports in EC2 Security Group

### Step 1: Find Your Security Group

1. Go to **AWS Console** → **EC2**
2. Click **Instances** in left sidebar
3. Find your instance (IP: 3.16.210.84)
4. Click on the instance
5. Look at **Security** tab → **Security groups** → Click on the security group name

### Step 2: Add Inbound Rules

1. In the Security Group page, click **Edit inbound rules**
2. Click **Add rule**
3. Add these rules:

**Rule 1: HTTP**
- **Type**: HTTP
- **Protocol**: TCP
- **Port range**: 80
- **Source**: 0.0.0.0/0 (or Custom → 0.0.0.0/0)
- **Description**: Allow HTTP traffic

**Rule 2: HTTPS**
- **Type**: HTTPS
- **Protocol**: TCP
- **Port range**: 443
- **Source**: 0.0.0.0/0 (or Custom → 0.0.0.0/0)
- **Description**: Allow HTTPS traffic

4. Click **Save rules**

### Step 3: Verify

After saving, test immediately:
```bash
curl -I http://share.jarmetals.com
```

Or visit in browser: `http://share.jarmetals.com`

## Quick AWS CLI Method (Alternative)

If you have AWS CLI configured:

```bash
# Get your instance ID
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=ip-address,Values=3.16.210.84" \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text)

# Get security group ID
SG_ID=$(aws ec2 describe-instances \
  --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' \
  --output text)

# Add HTTP rule
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 80 \
  --cidr 0.0.0.0/0

# Add HTTPS rule
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0
```

## Common Security Group Issues

### Issue 1: Only SSH (22) is open
- **Symptom**: Can SSH but can't access website
- **Fix**: Add ports 80 and 443 as above

### Issue 2: Rules exist but wrong source
- **Symptom**: Rules exist but source is restricted
- **Fix**: Change source to `0.0.0.0/0` for public access

### Issue 3: Multiple Security Groups
- **Symptom**: Instance has multiple security groups
- **Fix**: Check ALL security groups attached to instance

## Verification Checklist

After fixing Security Group:

- [ ] Port 80 (HTTP) rule added
- [ ] Port 443 (HTTPS) rule added
- [ ] Source is 0.0.0.0/0 (or your IP range)
- [ ] Rules saved successfully
- [ ] Test: `curl -I http://share.jarmetals.com`
- [ ] Test: Visit `http://share.jarmetals.com` in browser

## Expected Result

After fixing Security Group:
- ✅ `http://share.jarmetals.com` should load
- ✅ You should see the LiveKit app frontend
- ✅ API calls to `/api/*` should work

## Still Not Working?

If still timing out after fixing Security Group:

1. **Wait 1-2 minutes** - AWS changes can take a moment
2. **Check DNS**: `nslookup share.jarmetals.com` (should resolve to 3.16.210.84)
3. **Test direct IP**: `http://3.16.210.84` (bypasses DNS)
4. **Check Nginx logs**: `sudo tail -f /var/log/nginx/error.log`
5. **Check backend logs**: `pm2 logs livekit-backend`

