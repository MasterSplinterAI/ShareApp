# Script to fix Nginx configuration on server side

$DOMAIN = "share.jarmetals.com"
$REMOTE_USER = "ubuntu"
$REMOTE_HOST = "3.133.136.182"
$PEM_KEY = "C:\Users\Administrator\Downloads\AxisAlgo.pem"

Write-Host "Creating shell script to fix Nginx configuration..." -ForegroundColor Green

# Create shell script content
$SHELL_SCRIPT = @"
#!/bin/bash

# Create a clean Nginx configuration file
cat > nginx-config.txt << 'EOF'
server {
    listen 80;
    server_name share.jarmetals.com;

    location / {
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
sudo cp nginx-config.txt /etc/nginx/sites-available/share.jarmetals.com
sudo ln -sf /etc/nginx/sites-available/share.jarmetals.com /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx

# Install certbot if needed
if ! command -v certbot &> /dev/null; then
    sudo apt update
    sudo apt install -y certbot python3-certbot-nginx
fi

echo "Nginx configuration fixed successfully!"
"@

# Save the script to a local file
$SHELL_SCRIPT | Out-File -FilePath "fix-nginx.sh" -Encoding ASCII

# Upload the script file to the server
Write-Host "Uploading script to server..." -ForegroundColor Cyan
scp -i $PEM_KEY "fix-nginx.sh" $REMOTE_USER@$REMOTE_HOST`:~/fix-nginx.sh

# Run the script on the server
Write-Host "Running script on server..." -ForegroundColor Cyan
ssh -i $PEM_KEY $REMOTE_USER@$REMOTE_HOST "chmod +x ~/fix-nginx.sh && ~/fix-nginx.sh"

Write-Host @"

NGINX CONFIGURATION FIXED

Now you can obtain the SSL certificate with:

ssh -i "$PEM_KEY" $REMOTE_USER@$REMOTE_HOST "sudo certbot --nginx -d $DOMAIN --agree-tos -m kenny@jarmetals.com --redirect"

"@ -ForegroundColor Green 