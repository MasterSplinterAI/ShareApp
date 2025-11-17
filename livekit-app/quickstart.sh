#!/bin/bash

echo "🚀 LiveKit App Quick Start"
echo "=========================="
echo ""

# Backend setup
echo "📦 Setting up backend..."
cd backend
if [ ! -f .env ]; then
    cp env.ready .env
    echo "✅ Backend configured with your LiveKit credentials"
fi
if [ ! -d node_modules ]; then
    npm install --silent
fi
cd ..

# Frontend setup
echo "📦 Setting up frontend..."
cd frontend
if [ ! -d node_modules ]; then
    npm install --silent
fi
cd ..

# Translation agent setup (optional)
echo ""
echo "📝 Translation Agent Setup:"
echo "1. Add your OpenAI API key to translation-agent/.env"
echo "2. Run: cd translation-agent && cp env.ready .env"
echo "3. Edit .env and add your OpenAI key"
echo ""

echo "✅ Setup complete!"
echo ""
echo "🎯 To start the app:"
echo ""
echo "Terminal 1 - Backend:"
echo "  cd backend && npm run dev"
echo ""
echo "Terminal 2 - Frontend:"
echo "  cd frontend && npm run dev"
echo ""
echo "Terminal 3 - Translation (optional):"
echo "  cd translation-agent"
echo "  python -m venv venv && source venv/bin/activate"
echo "  pip install -r requirements_openai.txt"
echo "  python agent_openai.py dev"
echo ""
echo "📱 Then open: http://localhost:5174"
