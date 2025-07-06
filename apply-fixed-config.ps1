$REMOTE_USER = "ubuntu"
$REMOTE_HOST = "3.133.136.182"
$PEM_KEY = "C:\Users\Administrator\Downloads\AxisAlgo.pem"

Write-Host "Applying fixed Nginx configuration..." -ForegroundColor Green

# Upload the fixed configuration file to the server
scp -i $PEM_KEY "fixed-domain-config.txt" $REMOTE_USER@$REMOTE_HOST`:~/fixed-domain-config.txt

# Apply the configuration and restart Nginx
ssh -i $PEM_KEY $REMOTE_USER@$REMOTE_HOST @"
sudo cp ~/fixed-domain-config.txt /etc/nginx/sites-available/axisalgo
sudo rm -f /etc/nginx/sites-enabled/ip-config
sudo rm -f /etc/nginx/sites-enabled/share.jarmetals.com
sudo ln -sf /etc/nginx/sites-available/axisalgo /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx
"@

Write-Host @"

FIXED NGINX CONFIGURATION APPLIED

The potential proxy loop issue has been fixed. 
Try accessing your site at https://share.jarmetals.com again.

"@ -ForegroundColor Green 