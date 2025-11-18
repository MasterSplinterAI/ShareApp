#!/bin/bash
# Stop all local development services

echo "Stopping all local services..."
pkill -f "node server.js"
pkill -f "vite --host"
pkill -f "realtime_agent"
sleep 2
echo "✅ All services stopped"
