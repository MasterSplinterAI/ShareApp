# Script to fix Nginx configuration and set up SSL

$DOMAIN = "share.jarmetals.com"
$EMAIL = "kenny@jarmetals.com"
$REMOTE_USER = "ubuntu"
$REMOTE_HOST = "3.133.136.182"
$PEM_KEY = "C:\Users\Administrator\Downloads\AxisAlgo.pem"

Write-Host "Creating corrected Nginx configuration for $DOMAIN..." -ForegroundColor Green

# Create properly formatted Nginx configuration file
$NGINX_CONFIG = @"
server {
    listen 80;
    server_name $DOMAIN;

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
"@

# Save the configuration to a local file
$NGINX_CONFIG | Out-File -FilePath "fixed-nginx-config.txt" -Encoding utf8

# Upload the configuration file to the server
Write-Host "Uploading fixed configuration to server..." -ForegroundColor Cyan
scp -i $PEM_KEY "fixed-nginx-config.txt" $REMOTE_USER@$REMOTE_HOST`:~/fixed-nginx-config.txt

# Apply the configuration and restart Nginx
Write-Host "Applying fixed configuration..." -ForegroundColor Cyan
ssh -i $PEM_KEY $REMOTE_USER@$REMOTE_HOST "sudo mv ~/fixed-nginx-config.txt /etc/nginx/sites-available/$DOMAIN && sudo nginx -t && sudo systemctl restart nginx"

Write-Host "Fixed configuration applied successfully!" -ForegroundColor Green

Write-Host "Checking if Certbot is installed..." -ForegroundColor Cyan
ssh -i $PEM_KEY $REMOTE_USER@$REMOTE_HOST "if ! command -v certbot &> /dev/null; then sudo apt update && sudo apt install -y certbot python3-certbot-nginx; fi"

Write-Host @"

OBTAINING SSL CERTIFICATE:

The script will now attempt to obtain an SSL certificate for $DOMAIN.
Make sure you've created an A record for $DOMAIN pointing to $REMOTE_HOST
and that DNS has propagated before continuing.

"@ -ForegroundColor Yellow

$continue = Read-Host "Would you like to continue and obtain the SSL certificate now? (y/n)"
if ($continue -eq "y") {
    Write-Host "Obtaining SSL certificate..." -ForegroundColor Cyan
    ssh -i $PEM_KEY $REMOTE_USER@$REMOTE_HOST "sudo certbot --nginx -d $DOMAIN --agree-tos -m $EMAIL --redirect --non-interactive"
    
    Write-Host @"

SSL CERTIFICATE SETUP COMPLETE:

If successful, your website should now be accessible via HTTPS at:
https://$DOMAIN

"@ -ForegroundColor Green
} else {
    Write-Host @"

SSL CERTIFICATE SETUP POSTPONED:

When you're ready to obtain the SSL certificate, run:
ssh -i "$PEM_KEY" $REMOTE_USER@$REMOTE_HOST "sudo certbot --nginx -d $DOMAIN --agree-tos -m $EMAIL --redirect"

"@ -ForegroundColor Yellow
} 