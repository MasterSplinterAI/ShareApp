/**
 * Shared LiveKit server SDK helpers (used by legacy routes and V2).
 */
const { ParticipantInfo_Kind } = require('@livekit/protocol');
const { RoomServiceClient, AgentDispatchClient } = require('livekit-server-sdk');
const { readRoomMetadata, mergeRoomMetadata } = require('./livekitRoomMetadata');

/** LiveKit worker names for STT pipeline A/B testing (host switch on staging). */
const STT_PIPELINE_AGENTS = {
  deepgram: 'translation-cloud-prod',
  deepgram_codeswitch: 'translation-cloud-deepgram-codeswitch',
};

const VALID_STT_PIPELINES = Object.keys(STT_PIPELINE_AGENTS);

// Default pipeline for new rooms. Deepgram for launch: Gladia finalizes utterances
// noticeably slower, which delays translation. Gladia stays host-switchable per room
// (debug panel) while we tune its endpointing; flip via DEFAULT_STT_PIPELINE env.
const _rawDefaultPipeline = String(process.env.DEFAULT_STT_PIPELINE || 'deepgram').toLowerCase();
const DEFAULT_STT_PIPELINE = VALID_STT_PIPELINES.includes(_rawDefaultPipeline)
  ? _rawDefaultPipeline
  : 'deepgram';

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
  if (process.env.AGENT_NAME) return process.env.AGENT_NAME;
  // Staging often runs NODE_ENV=development but still uses LiveKit Cloud; the cloud worker
  // registers as translation-cloud-prod (see translation-agent/livekit.toml). Do not infer
  // from NODE_ENV alone or dispatches never match a worker.
  const lk = (process.env.LIVEKIT_URL || '').toLowerCase();
  if (lk.includes('livekit.cloud')) {
    return STT_PIPELINE_AGENTS[DEFAULT_STT_PIPELINE];
  }
  return process.env.NODE_ENV === 'production' ? STT_PIPELINE_AGENTS[DEFAULT_STT_PIPELINE] : 'translation-bot-dev';
}

function agentNameForPipeline(pipeline) {
  const key = String(pipeline || DEFAULT_STT_PIPELINE).toLowerCase();
  return STT_PIPELINE_AGENTS[key] || defaultAgentName();
}

function normalizeSttPipeline(pipeline) {
  const key = String(pipeline || DEFAULT_STT_PIPELINE).toLowerCase();
  return VALID_STT_PIPELINES.includes(key) ? key : DEFAULT_STT_PIPELINE;
}

async function resolveRoomSttPipeline(roomName) {
  try {
    const meta = await readRoomMetadata(roomName);
    return normalizeSttPipeline(meta.stt_pipeline);
  } catch {
    return DEFAULT_STT_PIPELINE;
  }
}

/**
 * True if this ListParticipants row is the translation/LiveKit agent (not a human).
 * Prefer server `kind` — cloud agent identities often look like opaque IDs (no "agent-" prefix).
 */
function looksLikeAgentParticipant(p) {
  if (!p) return false;
  if (p.kind === ParticipantInfo_Kind.AGENT) return true;
  const identity = p.identity;
  if (!identity) return false;
  const s = String(identity).toLowerCase();
  return (
    s.startsWith('agent-') ||
    s.includes('translation') ||
    s.includes('-agent') ||
    s.includes('agent_')
  );
}

function roomLifecycleTimeouts() {
  const emptyRaw = Number(process.env.LIVEKIT_EMPTY_TIMEOUT_SEC || 1800);
  const departRaw = Number(process.env.LIVEKIT_DEPARTURE_TIMEOUT_SEC || 600);
  return {
    emptyTimeout: Number.isFinite(emptyRaw) && emptyRaw > 0 ? Math.min(emptyRaw, 86400) : 1800,
    departureTimeout: Number.isFinite(departRaw) && departRaw > 0 ? Math.min(departRaw, 86400) : 600,
  };
}

async function createLiveKitConferenceRoom(roomName, roomMode = 'multi-language', orgId = null) {
  const roomService = getRoomService();
  const { emptyTimeout, departureTimeout } = roomLifecycleTimeouts();
  const metadata = {
    createdAt: new Date().toISOString(),
    type: 'conference',
    roomMode,
    stt_pipeline: DEFAULT_STT_PIPELINE,
  };
  if (orgId) metadata.org_id = orgId;
  const createOptions = {
    name: roomName,
    emptyTimeout,
    departureTimeout,
    maxParticipants: 50,
    metadata: JSON.stringify(metadata),
  };
  const room = await roomService.createRoom(createOptions);
  const agentName = agentNameForPipeline(DEFAULT_STT_PIPELINE);
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
async function ensureRoomAndAgent(roomName, roomMode = 'multi-language', orgId = null) {
  const roomService = getRoomService();
  const { emptyTimeout, departureTimeout } = roomLifecycleTimeouts();
  const metadata = {
    createdAt: new Date().toISOString(),
    type: 'conference',
    roomMode,
  };
  if (orgId) metadata.org_id = orgId;
  const existingMeta = await readRoomMetadata(roomName).catch(() => ({}));
  if (!existingMeta.stt_pipeline) metadata.stt_pipeline = DEFAULT_STT_PIPELINE;
  const room = await roomService.createRoom({
    name: roomName,
    emptyTimeout,
    departureTimeout,
    maxParticipants: 50,
    metadata: JSON.stringify({ ...existingMeta, ...metadata }),
  });

  const pipeline = normalizeSttPipeline(metadata.stt_pipeline || existingMeta.stt_pipeline);
  const agentName = agentNameForPipeline(pipeline);
  let participants = [];
  try {
    participants = await roomService.listParticipants(roomName);
  } catch (e) {
    console.warn(`[livekitService] listParticipants(${roomName}):`, e.message);
  }
  const agentParticipantPresent = participants.some((p) => looksLikeAgentParticipant(p));

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

  if (orgId) {
    try {
      const { ensureRoomOrgMetadata } = require('./livekitRoomMetadata');
      await ensureRoomOrgMetadata(roomName, orgId);
    } catch (metaErr) {
      console.warn(`[livekitService] org metadata merge for ${roomName}:`, metaErr.message);
    }
  }

  return room;
}

async function removeAgentsFromRoom(roomName) {
  const roomService = getRoomService();
  const dispatch = getAgentDispatch();

  try {
    const participants = await roomService.listParticipants(roomName);
    for (const p of participants) {
      if (!looksLikeAgentParticipant(p)) continue;
      try {
        await roomService.removeParticipant(roomName, p.identity);
        console.log(`[livekitService] Removed agent participant ${p.identity} from ${roomName}`);
      } catch (e) {
        console.warn(`[livekitService] removeParticipant ${p.identity}:`, e.message);
      }
    }
  } catch (e) {
    console.warn(`[livekitService] listParticipants(${roomName}) during agent removal:`, e.message);
  }

  try {
    const existing = await dispatch.listDispatch(roomName);
    const dispatchRows = Array.isArray(existing) ? existing : [];
    for (const row of dispatchRows) {
      const dispatchId = row && row.id;
      if (!dispatchId) continue;
      try {
        await dispatch.deleteDispatch(dispatchId, roomName);
        console.log(`[livekitService] Removed agent dispatch ${dispatchId} for ${roomName}`);
      } catch (e) {
        console.warn(`[livekitService] deleteDispatch ${dispatchId}:`, e.message);
      }
    }
  } catch (e) {
    console.warn(`[livekitService] listDispatch(${roomName}) during agent removal:`, e.message);
  }
}

/**
 * Host-only: swap STT pipeline by removing the current agent and dispatching another worker.
 */
async function switchRoomSttPipeline(roomName, pipeline) {
  const normalized = normalizeSttPipeline(pipeline);
  await mergeRoomMetadata(roomName, { stt_pipeline: normalized });
  await removeAgentsFromRoom(roomName);
  await new Promise((r) => setTimeout(r, 600));
  const agentName = agentNameForPipeline(normalized);
  await getAgentDispatch().createDispatch(roomName, agentName);
  console.log(`[livekitService] Switched ${roomName} to pipeline=${normalized} agent=${agentName}`);
  return { pipeline: normalized, agentName };
}

module.exports = {
  getRoomService,
  getAgentDispatch,
  getLivekitHttpHost,
  defaultAgentName,
  agentNameForPipeline,
  normalizeSttPipeline,
  resolveRoomSttPipeline,
  STT_PIPELINE_AGENTS,
  VALID_STT_PIPELINES,
  DEFAULT_STT_PIPELINE,
  createLiveKitConferenceRoom,
  ensureRoomAndAgent,
  removeAgentsFromRoom,
  switchRoomSttPipeline,
  looksLikeAgentParticipant,
};
