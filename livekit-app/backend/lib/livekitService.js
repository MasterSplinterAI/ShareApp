/**
 * Shared LiveKit server SDK helpers (used by legacy routes and V2).
 */
const { RoomServiceClient, AgentDispatchClient } = require('livekit-server-sdk');

function getLivekitHttpHost() {
  const url = process.env.LIVEKIT_URL;
  if (!url) throw new Error('LIVEKIT_URL not configured');
  return url.replace('wss://', 'https://').replace('ws://', 'http://');
}

function getRoomService() {
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET || !process.env.LIVEKIT_URL) {
    throw new Error('LiveKit configuration missing');
  }
  return new RoomServiceClient(
    getLivekitHttpHost(),
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET
  );
}

function getAgentDispatch() {
  return new AgentDispatchClient(
    getLivekitHttpHost(),
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET
  );
}

function defaultAgentName() {
  return process.env.AGENT_NAME || (process.env.NODE_ENV === 'production' ? 'translation-cloud-prod' : 'translation-bot-dev');
}

async function createLiveKitConferenceRoom(roomName, roomMode = 'multi-language') {
  const roomService = getRoomService();
  const createOptions = {
    name: roomName,
    emptyTimeout: 300,
    maxParticipants: 50,
    metadata: JSON.stringify({
      createdAt: new Date().toISOString(),
      type: 'conference',
      roomMode,
    }),
  };
  const room = await roomService.createRoom(createOptions);
  const agentName = defaultAgentName();
  try {
    const agentDispatch = getAgentDispatch();
    await agentDispatch.createDispatch(roomName, agentName);
  } catch (e) {
    console.warn(`[livekitService] Agent dispatch failed for ${roomName}:`, e.message);
  }
  return room;
}

module.exports = {
  getRoomService,
  getAgentDispatch,
  getLivekitHttpHost,
  defaultAgentName,
  createLiveKitConferenceRoom,
};
