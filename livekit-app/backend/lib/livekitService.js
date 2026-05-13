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

/** Match frontend RoomControls / host heuristics so we do not count the bot as a human speaker. */
function looksLikeAgentIdentity(identity) {
  if (!identity) return false;
  const s = String(identity).toLowerCase();
  return (
    s.startsWith('agent-') ||
    s.includes('translation') ||
    s.includes('-agent') ||
    s.includes('agent_')
  );
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

/**
 * Ensure a LiveKit room exists and has an agent dispatched.
 * If the room was torn down after emptyTimeout, LiveKit's createRoom is
 * idempotent — it returns the existing room or creates a new one.
 * We then check for an active agent dispatch and create one if missing.
 */
async function ensureRoomAndAgent(roomName, roomMode = 'multi-language') {
  const roomService = getRoomService();
  const room = await roomService.createRoom({
    name: roomName,
    emptyTimeout: 300,
    maxParticipants: 50,
    metadata: JSON.stringify({
      createdAt: new Date().toISOString(),
      type: 'conference',
      roomMode,
    }),
  });

  const agentName = defaultAgentName();
  let participants = [];
  try {
    participants = await roomService.listParticipants(roomName);
  } catch (e) {
    console.warn(`[livekitService] listParticipants(${roomName}):`, e.message);
  }
  const agentParticipantPresent = participants.some((p) => looksLikeAgentIdentity(p.identity));

  try {
    const dispatch = getAgentDispatch();
    const existing = await dispatch.listDispatch(roomName);
    const dispatchRows = Array.isArray(existing) ? existing : [];

    // listDispatch can still return rows after the worker exited or the room was empty.
    // In that case LiveKit will not join a new agent unless we remove stale dispatches and create a fresh one.
    if (!agentParticipantPresent && dispatchRows.length > 0) {
      for (const row of dispatchRows) {
        const dispatchId = row && row.id;
        if (!dispatchId) continue;
        try {
          await dispatch.deleteDispatch(dispatchId, roomName);
          console.log(`[livekitService] Removed stale agent dispatch ${dispatchId} for ${roomName}`);
        } catch (delErr) {
          console.warn(`[livekitService] deleteDispatch ${dispatchId}:`, delErr.message);
        }
      }
    }

    if (!agentParticipantPresent) {
      await dispatch.createDispatch(roomName, agentName);
      console.log(`[livekitService] Agent dispatched to ${roomName} (no agent participant in room)`);
    } else if (dispatchRows.length === 0) {
      await dispatch.createDispatch(roomName, agentName);
      console.log(`[livekitService] Agent dispatched to ${roomName} (participant present but no dispatch rows)`);
    }
  } catch (e) {
    console.warn(`[livekitService] ensureRoomAndAgent dispatch check for ${roomName}:`, e.message);
    try {
      await getAgentDispatch().createDispatch(roomName, agentName);
    } catch (e2) {
      console.warn(`[livekitService] Fallback dispatch also failed for ${roomName}:`, e2.message);
    }
  }
  return room;
}

module.exports = {
  getRoomService,
  getAgentDispatch,
  getLivekitHttpHost,
  defaultAgentName,
  createLiveKitConferenceRoom,
  ensureRoomAndAgent,
};
