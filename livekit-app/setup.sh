#!/bin/bash

# LiveKit App Setup Script
# This script helps set up the development environment

echo "🚀 LiveKit International Conference App Setup"
echo "==========================================="

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command_exists node; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

if ! command_exists npm; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

if ! command_exists python3; then
    echo "⚠️  Python 3 is not installed. Translation agent will not work."
    SKIP_PYTHON=true
fi

echo "✅ Prerequisites checked"
echo ""

# Setup Backend
echo "🔧 Setting up Backend..."
cd backend

if [ ! -f package-lock.json ]; then
    npm install
fi

if [ ! -f .env ]; then
    cp env.example .env
    echo "📝 Created backend/.env - Please add your LiveKit credentials"
fi

cd ..
echo "✅ Backend setup complete"
echo ""

# Setup Frontend
echo "🎨 Setting up Frontend..."
cd frontend

if [ ! -f package-lock.json ]; then
    npm install
fi

cd ..
echo "✅ Frontend setup complete"
echo ""

# Setup Translation Agent (if Python available)
if [ "$SKIP_PYTHON" != true ]; then
    echo "🌍 Setting up Translation Agent..."
    cd translation-agent
    
    if [ ! -d venv ]; then
        python3 -m venv venv
    fi
    
    # Activate virtual environment
    source venv/bin/activate
    
    # Install dependencies
    pip install -r requirements.txt
    
    if [ ! -f .env ]; then
        cp env.example .env
        echo "📝 Created translation-agent/.env - Please add your API keys"
    fi
    
    deactivate
    cd ..
    echo "✅ Translation Agent setup complete"
else
    echo "⚠️  Skipping Translation Agent setup (Python not found)"
fi

echo ""
echo "🎉 Setup Complete!"
echo ""
echo "📋 Next Steps:"
echo "1. Add your LiveKit credentials to backend/.env"
echo "2. Add translation API keys to translation-agent/.env (optional)"
echo "3. Start the services:"
echo "   - Backend: cd backend && npm run dev"
echo "   - Frontend: cd frontend && npm run dev"
echo "   - Translation Agent: cd translation-agent && source venv/bin/activate && python agent.py dev"
echo ""
echo "📚 See README.md for detailed instructions"
echo "🧪 See TESTING_GUIDE.md for testing instructions"
echo "🚀 See DEPLOYMENT.md for production deployment"
