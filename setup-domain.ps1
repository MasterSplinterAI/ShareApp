# Script to set up the domain with Nginx and SSL

$DOMAIN = "share.jarmetals.com"
$EMAIL = "kenny@jarmetals.com"
$REMOTE_USER = "ubuntu"
$REMOTE_HOST = "3.133.136.182"
$PEM_KEY = "C:\Users\Administrator\Downloads\AxisAlgo.pem"

Write-Host "Setting up Nginx configuration for $DOMAIN..." -ForegroundColor Green

# Create Nginx configuration file - properly escaping dollar signs with double backticks
$NGINX_CONFIG = @"
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \`$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \`$host;
        proxy_set_header X-Real-IP \`$remote_addr;
        proxy_cache_bypass \`$http_upgrade;
    }
}
"@

# Save the configuration to a local file
$NGINX_CONFIG | Out-File -FilePath "nginx-domain-config.txt" -Encoding utf8

# Upload the configuration file to the server
Write-Host "Uploading configuration to server..." -ForegroundColor Cyan
scp -i $PEM_KEY "nginx-domain-config.txt" $REMOTE_USER@$REMOTE_HOST`:~/nginx-domain-config.txt

# Apply the configuration and restart Nginx
Write-Host "Applying configuration..." -ForegroundColor Cyan
ssh -i $PEM_KEY $REMOTE_USER@$REMOTE_HOST "sudo mv ~/nginx-domain-config.txt /etc/nginx/sites-available/$DOMAIN && sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl restart nginx"

Write-Host "Configuration applied successfully!" -ForegroundColor Green

# Instructions for SSL certificate
Write-Host @"

NEXT STEPS:

1. Make sure you've created an A record for $DOMAIN pointing to $REMOTE_HOST

2. Once DNS has propagated (can take up to 24-48 hours), run this command to get an SSL certificate:

   ssh -i "$PEM_KEY" $REMOTE_USER@$REMOTE_HOST "sudo certbot --nginx -d $DOMAIN --agree-tos -m $EMAIL --redirect"

3. This will automatically configure HTTPS and redirect HTTP traffic to HTTPS

"@ -ForegroundColor Yellow 