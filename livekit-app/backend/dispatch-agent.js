#!/usr/bin/env node

/**
 * Script to manually dispatch the translation agent to a specific room
 * Usage: node dispatch-agent.js <roomName>
 * Example: node dispatch-agent.js room-n2kmlk31gxg-mi4yytma
 */

require('dotenv').config();
const { AgentDispatchClient } = require('livekit-server-sdk');

async function dispatchAgent(roomName) {
  try {
    // Check required environment variables
    if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET || !process.env.LIVEKIT_URL) {
      throw new Error('LiveKit configuration missing. Please set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and LIVEKIT_URL in your .env file.');
    }

    // Get agent name from environment (default: translation-bot-dev for dev)
    const agentName = process.env.AGENT_NAME || (process.env.NODE_ENV === 'production' ? 'translation-agent-production' : 'translation-bot-dev');

    // Convert WebSocket URL to HTTP/HTTPS for API calls
    const livekitHost = process.env.LIVEKIT_URL.replace('wss://', 'https://').replace('ws://', 'http://');

    console.log(`🚀 Dispatching agent "${agentName}" to room: ${roomName}`);
    console.log(`📍 LiveKit Host: ${livekitHost}`);

    // Create AgentDispatchClient
    const agentDispatch = new AgentDispatchClient(
      livekitHost,
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET
    );

    // Dispatch agent to room
    await agentDispatch.createDispatch(roomName, agentName);

    console.log(`✅ Successfully dispatched agent "${agentName}" to room "${roomName}"`);
    console.log(`🔗 Room URL: ${process.env.FRONTEND_URL || 'http://localhost:5174'}/room/${roomName}`);
    
  } catch (error) {
    console.error('❌ Error dispatching agent:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Get room name from command line arguments
const roomName = process.argv[2];

if (!roomName) {
  console.error('❌ Error: Room name is required');
  console.log('Usage: node dispatch-agent.js <roomName>');
  console.log('Example: node dispatch-agent.js room-n2kmlk31gxg-mi4yytma');
  process.exit(1);
}

// Dispatch the agent
dispatchAgent(roomName);

