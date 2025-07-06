# Script to fix Nginx configuration for direct IP access

$REMOTE_USER = "ubuntu"
$REMOTE_HOST = "3.133.136.182"
$PEM_KEY = "C:\Users\Administrator\Downloads\AxisAlgo.pem"

Write-Host "Creating IP-based Nginx configuration..." -ForegroundColor Green

# Create shell script content
$SHELL_SCRIPT = @"
#!/bin/bash

# Create a clean Nginx configuration file for IP access
cat > ip-nginx-config.txt << 'EOF'
server {
    listen 80;
    server_name 3.133.136.182;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_cache_bypass \$http_upgrade;
    }
    
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Apply the configuration
sudo cp ip-nginx-config.txt /etc/nginx/sites-available/ip-config
sudo ln -sf /etc/nginx/sites-available/ip-config /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx

echo "IP-based Nginx configuration fixed successfully!"
"@

# Save the script to a local file
$SHELL_SCRIPT | Out-File -FilePath "fix-ip-nginx.sh" -Encoding ASCII

# Upload the script file to the server
Write-Host "Uploading script to server..." -ForegroundColor Cyan
scp -i $PEM_KEY "fix-ip-nginx.sh" $REMOTE_USER@$REMOTE_HOST`:~/fix-ip-nginx.sh

# Run the script on the server
Write-Host "Running script on server..." -ForegroundColor Cyan
ssh -i $PEM_KEY $REMOTE_USER@$REMOTE_HOST "chmod +x ~/fix-ip-nginx.sh && ~/fix-ip-nginx.sh"

Write-Host @"

NGINX CONFIGURATION FIXED

You should now be able to access the application via:
1. http://3.133.136.182 (direct IP, no HTTPS)
2. https://share.jarmetals.com (domain name with HTTPS)

"@ -ForegroundColor Green 