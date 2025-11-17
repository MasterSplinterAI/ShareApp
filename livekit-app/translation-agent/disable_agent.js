#!/usr/bin/env node
/**
 * Script to disable/delete the unnamed LiveKit agent
 * Usage: node disable_agent.js <agent-id>
 * Example: node disable_agent.js A_4NQozRThmiRx
 */

require('dotenv').config();
const https = require('https');

const LIVEKIT_URL = process.env.LIVEKIT_URL || 'wss://jayme-rhmomj8r.livekit.cloud';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error('Error: LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set in .env');
  process.exit(1);
}

const agentId = process.argv[2];

if (!agentId) {
  console.error('Usage: node disable_agent.js <agent-id>');
  console.error('Example: node disable_agent.js A_4NQozRThmiRx');
  process.exit(1);
}

// Convert WebSocket URL to HTTPS
const livekitHost = LIVEKIT_URL.replace('wss://', '').replace('ws://', '');

// Note: LiveKit Cloud API for agent management might require different endpoints
// This is a placeholder - you may need to use the LiveKit CLI or Cloud API directly
console.log('⚠️  LiveKit Cloud agent management via API is limited.');
console.log('Please use one of these methods:\n');
console.log('1. Use LiveKit CLI (recommended):');
console.log(`   lk agent delete ${agentId}`);
console.log('\n2. Or authenticate LiveKit CLI first:');
console.log('   lk auth');
console.log('   Then: lk agent delete', agentId);
console.log('\n3. Or disable auto-dispatch via CLI:');
console.log(`   lk agent update ${agentId} --room-pattern "disabled-*"`);
console.log('\n4. Contact LiveKit support to disable the agent via their dashboard');

