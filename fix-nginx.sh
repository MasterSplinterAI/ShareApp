#!/bin/bash

# Create a clean Nginx configuration file
cat > nginx-config.txt << 'EOF'
server {
    listen 80;
    server_name share.jarmetals.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \System.Management.Automation.Internal.Host.InternalHost;
        proxy_set_header X-Real-IP \;
        proxy_cache_bypass \;
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
