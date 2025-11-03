#!/bin/bash
# One-time setup script for environment variables on AWS server
# Run this ONCE on your server after SSH'ing in

echo "🔧 Setting up environment variables for Cloudflare TURN..."
echo ""

cd /var/www/html || exit 1

# Install dotenv package
echo "📦 Installing dotenv package..."
sudo npm install dotenv

# Create .env file
echo ""
echo "📝 Creating .env file..."
echo "You'll need to edit this file with your Cloudflare credentials"
echo ""

# Create .env file with template
sudo tee .env > /dev/null <<EOF
# Cloudflare TURN Configuration
# Fill in your actual values from Cloudflare dashboard

CLOUDFLARE_TURN_URLS=turn:your-domain.cloudflare.com:3478?transport=udp,turn:your-domain.cloudflare.com:3478?transport=tcp,turns:your-domain.cloudflare.com:5349?transport=tcp
CLOUDFLARE_TURN_USERNAME=your_username_here
CLOUDFLARE_TURN_CREDENTIAL=your_password_here
EOF

# Set secure permissions
sudo chmod 600 .env
sudo chown www-data:www-data .env

echo ""
echo "✅ .env file created!"
echo ""
echo "⚠️  IMPORTANT: Edit the .env file with your actual Cloudflare credentials:"
echo "   sudo nano .env"
echo ""
echo "After editing, restart your server:"
echo "   sudo pm2 restart server"
echo "   OR"
echo "   sudo systemctl restart your-service"
echo ""
echo "To verify it's working, check server logs for:"
echo "   ✅ Added Cloudflare TURN servers"

