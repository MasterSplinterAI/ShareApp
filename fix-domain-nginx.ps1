# Script to fix Nginx configuration for domain access

$REMOTE_USER = "ubuntu"
$REMOTE_HOST = "3.133.136.182"
$PEM_KEY = "C:\Users\Administrator\Downloads\AxisAlgo.pem"

Write-Host "Creating domain-based Nginx configuration..." -ForegroundColor Green

# Create domain configuration content with socket.io route
$DOMAIN_CONFIG = @"
server {
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
    
    location /socket.io/ {
        proxy_pass http://localhost:3000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_cache_bypass \$http_upgrade;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/share.jarmetals.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/share.jarmetals.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}

server {
    if (\$host = share.jarmetals.com) {
        return 301 https://\$host\$request_uri;
    } # managed by Certbot

    listen 80;
    server_name share.jarmetals.com;
}
"@

# Save the configuration to a local file
$DOMAIN_CONFIG | Out-File -FilePath "domain-nginx-config.txt" -Encoding ASCII

# Upload the configuration file to the server
Write-Host "Uploading configuration to server..." -ForegroundColor Cyan
scp -i $PEM_KEY "domain-nginx-config.txt" $REMOTE_USER@$REMOTE_HOST`:~/domain-nginx-config.txt

# Apply the configuration
Write-Host "Applying configuration..." -ForegroundColor Cyan
ssh -i $PEM_KEY $REMOTE_USER@$REMOTE_HOST "sudo cp ~/domain-nginx-config.txt /etc/nginx/sites-available/axisalgo && sudo nginx -t && sudo systemctl restart nginx"

Write-Host @"

DOMAIN NGINX CONFIGURATION UPDATED

The Nginx configuration for your domain has been updated to properly handle socket.io connections.
Try accessing your site at https://share.jarmetals.com again.

"@ -ForegroundColor Green 