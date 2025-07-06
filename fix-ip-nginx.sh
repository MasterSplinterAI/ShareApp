#!/bin/bash

# Create a clean Nginx configuration file for IP access
cat > ip-nginx-config.txt << 'EOF'
server {
    listen 80;
    server_name 3.133.136.182;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \System.Management.Automation.Internal.Host.InternalHost;
        proxy_set_header X-Real-IP \;
        proxy_cache_bypass \;
    }
    
    location /socket.io/ {
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
sudo cp ip-nginx-config.txt /etc/nginx/sites-available/ip-config
sudo ln -sf /etc/nginx/sites-available/ip-config /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx

echo "IP-based Nginx configuration fixed successfully!"
