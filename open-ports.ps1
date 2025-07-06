$REMOTE_USER = "ubuntu"
$REMOTE_HOST = "3.133.136.182"
$PEM_KEY = "C:\Users\Administrator\Downloads\AxisAlgo.pem"

Write-Host "Opening HTTPS port (443) in AWS security group..." -ForegroundColor Green

# Create and upload a script to open the ports
$PORT_SCRIPT = @"
#!/bin/bash

# Get instance ID and security group ID
INSTANCE_ID=\$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
SECURITY_GROUP_ID=\$(aws ec2 describe-instances --instance-ids \$INSTANCE_ID --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "AWS CLI not configured")

if [[ \$SECURITY_GROUP_ID == "AWS CLI not configured" ]]; then
  echo "AWS CLI not configured properly. Let's try to install and configure it."
  
  # Install AWS CLI if not present
  if ! command -v aws &> /dev/null; then
    sudo apt-get update
    sudo apt-get install -y awscli
  fi
  
  # Try to get instance metadata using IMDSv2
  TOKEN=\$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
  INSTANCE_ID=\$(curl -s -H "X-aws-ec2-metadata-token: \$TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
  REGION=\$(curl -s -H "X-aws-ec2-metadata-token: \$TOKEN" http://169.254.169.254/latest/meta-data/placement/region)
  
  # Get security groups using instance-id
  SECURITY_GROUP_ID=\$(aws ec2 describe-instances --region \$REGION --instance-ids \$INSTANCE_ID --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "Cannot get SG ID")
fi

if [[ \$SECURITY_GROUP_ID == "Cannot get SG ID" ]]; then
  echo "Could not determine security group ID automatically."
  echo "Please open your AWS console and ensure ports 80 and 443 are open in your security group."
  exit 1
fi

echo "Instance ID: \$INSTANCE_ID"
echo "Security Group ID: \$SECURITY_GROUP_ID"
echo "Opening ports 80 and 443 for this security group..."

# Open HTTP port if not already open
aws ec2 authorize-security-group-ingress \
  --group-id \$SECURITY_GROUP_ID \
  --protocol tcp \
  --port 80 \
  --cidr 0.0.0.0/0 2>/dev/null || echo "Port 80 may already be open"

# Open HTTPS port if not already open
aws ec2 authorize-security-group-ingress \
  --group-id \$SECURITY_GROUP_ID \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0 2>/dev/null || echo "Port 443 may already be open"

echo "Security group update attempted. Please check your AWS Console to verify."
"@

# Save the script locally
$PORT_SCRIPT | Out-File -FilePath "open-ports.sh" -Encoding ASCII

# Upload the script to the server
scp -i $PEM_KEY "open-ports.sh" $REMOTE_USER@$REMOTE_HOST`:~/open-ports.sh

# Make the script executable and run it
ssh -i $PEM_KEY $REMOTE_USER@$REMOTE_HOST "chmod +x ~/open-ports.sh && ~/open-ports.sh"

Write-Host @"

SECURITY GROUP UPDATE ATTEMPTED

Please check your AWS Console to verify ports 80 and 443 are open.
If the automatic script didn't work, you'll need to:

1. Log into AWS Console
2. Go to EC2 > Security Groups
3. Find the security group associated with your instance (3.133.136.182)
4. Edit inbound rules to allow traffic on ports 80 and 443 from anywhere (0.0.0.0/0)

"@ -ForegroundColor Yellow 