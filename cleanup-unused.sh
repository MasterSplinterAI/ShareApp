#!/bin/bash
# Cleanup script to remove unused React, Vue, and other UI frameworks

echo "🧹 Cleaning up unused frameworks and files..."

# Remove React/Next.js conference app
if [ -d "conference-app" ]; then
    echo "Removing conference-app (React/Next.js)..."
    rm -rf conference-app
fi

# Remove Vue-related files
echo "Removing Vue-related files..."
rm -f VUE_*.md
rm -f WHY_VUE_SUMMARY.md
rm -f FRONTEND_MIGRATION_PLAN.md

# Remove unused HTML files
echo "Removing unused HTML files..."
rm -f public/enhanced.html
rm -f public/app-tailwind.html
rm -f public/modern-ui.html
rm -f public/index-enhanced.html
rm -f public/index-working.html
rm -f public/mobile-test.html

# Remove unused CSS files
echo "Removing unused CSS files..."
rm -f public/enhanced-style.css
rm -f public/css/modern-ui.css

# Remove unused JS files
echo "Removing unused JS files..."
rm -f public/app.js.backup
rm -f public/app.js.fixed
rm -f public/app.js.fixed.end
rm -f public/js/app.js  # This is a duplicate, we use public/app.js
rm -f public/js/ui-enhancer.js
rm -rf public/js/modern-ui/

# Remove React-related files from public
rm -f public/local-video-fix.js
rm -f public/webrtc-bridge.js

# Remove unused config files
rm -f fixed-app.js
rm -f apply-fixed-config.ps1
rm -f deploy-remote.ps1
rm -f fix-*.ps1
rm -f fix-*.sh
rm -f open-ports.ps1
rm -f setup-*.ps1
rm -f setup-*.sh
rm -f ssh-wrapper.bat
rm -f simple-post-receive
rm -f post-receive-fixed
rm -f post-receive.sh

# Remove unused nginx config files (keep only what's needed)
rm -f nginx-*.txt
rm -f domain-nginx-config.txt
rm -f final-domain-config.txt
rm -f fixed-domain-config.txt
rm -f fixed-nginx-config.txt
rm -f minimal-domain-config.txt

# Remove documentation for unused frameworks
rm -f DEPLOYMENT_OPTIONS.md
rm -f HOST_REJOIN_SCENARIO.md
rm -f ROOM_PERSISTENCE_GUIDE.md
rm -f SERVER_CLEANUP_ANALYSIS.md

echo "✅ Cleanup complete!"
echo ""
echo "Remaining core files:"
echo "  - public/index.html (main app)"
echo "  - public/app.js (main app logic)"
echo "  - public/js/app-enhancements.js (our enhancements)"
echo "  - server.js (main server)"
echo "  - api-rooms.js (room API)"
echo "  - public/js/ (core JS modules)"

