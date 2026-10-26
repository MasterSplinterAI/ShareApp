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

// Default pipeline for new rooms: codeswitch agent (detected source language +
// optional voice translation). Stable profile-only agent remains host-switchable
// via debug panel as `deepgram`. Override with DEFAULT_STT_PIPELINE env.
const _rawDefaultPipeline = String(
  process.env.DEFAULT_STT_PIPELINE || 'deepgram_codeswitch'
).toLowerCase();
const DEFAULT_STT_PIPELINE = VALID_STT_PIPELINES.includes(_rawDefaultPipeline)
  ? _rawDefaultPipeline
  : 'deepgram_codeswitch';

/**
 * Per-room promise-chain lock. Concurrent joins (host + guests hitting
 * ensureRoomAndAgent at once) otherwise race the dispatch check and can
 * create two agent jobs in one room — duplicate captions, TTS, and cost.
 */
const _roomLocks = new Map();

function withRoomLock(roomName, fn) {
  const key = String(roomName);
  const prev = _roomLocks.get(key) || Promise.resolve();
  const run = prev.then(() => fn());
  // Keep the chain alive even when fn throws; clean up when we're the tail.
  const tail = run.catch(() => {});
  _roomLocks.set(key, tail);
  tail.finally(() => {
    if (_roomLocks.get(key) === tail) _roomLocks.delete(key);
  });
  return run;
}

function isJobInFlight(job) {
  const status = job?.state?.status;
  const endedAt = job?.state?.endedAt;
  const ended = endedAt != null && String(endedAt) !== '0' && String(endedAt) !== '';
  if (ended) return false;
  return (
    status === 0 ||
    status === 1 ||
    status === 'JS_PENDING' ||
    status === 'JS_RUNNING'
  );
}

/**
 * Duplicate-agent + unnamed-dispatch guard:
 * - LiveKit Cloud creates an automatic default dispatch with `agentName: ""`
 *   on every `createRoom`. Our workers register with explicit names, so that
 *   default row never assigns a worker (`jobs: []`) and MUST be ignored.
 * - If a dispatch for `agentName` has a pending/running job in flight, do not
 *   create another dispatch (prevents duplicate agents).
 * - If a named dispatch has only completed/failed jobs (or is for another
 *   agentName) and no agent is in the room, mark it stale for deletion before
 *   creating a fresh dispatch.
 */
function decideDispatchAction({ agentPresent, dispatches = [], agentName = '' }) {
  if (agentPresent) {
    return { action: 'none', staleDispatchIds: [] };
  }
  const rows = Array.isArray(dispatches) ? dispatches : [];
  const staleDispatchIds = [];
  let hasInFlight = false;

  for (const d of rows) {
    const dName = String(d?.agentName || '').trim();
    // Ignore LiveKit Cloud's automatic unnamed room dispatch (`agentName: ""`).
    if (!dName) continue;

    const jobs = Array.isArray(d?.state?.jobs) ? d.state.jobs : [];
    const inFlight = dName === agentName && jobs.some(isJobInFlight);
    if (inFlight) {
      hasInFlight = true;
    } else if (d?.id) {
      staleDispatchIds.push(d.id);
    }
  }

  if (hasInFlight) {
    return { action: 'none', staleDispatchIds: [] };
  }
  return { action: 'create', staleDispatchIds };
}

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
  await withRoomLock(roomName, () => ensureAgentDispatchLocked(roomName, agentName));
  return room;
}

/**
 * Create exactly one agent dispatch for a room. Caller must hold the room lock.
 * Never creates a second dispatch when one exists or an agent is present —
 * that is how duplicate caption/TTS streams (and double inference cost) start.
 */
async function ensureAgentDispatchLocked(roomName, agentName) {
  const roomService = getRoomService();
  let participants = [];
  try {
    participants = await roomService.listParticipants(roomName);
  } catch (e) {
    console.warn(`[livekitService] listParticipants(${roomName}):`, e.message);
  }
  const agentPresent = participants.some((p) => looksLikeAgentParticipant(p));

  const agentDispatch = getAgentDispatch();
  let dispatches = [];
  try {
    const existing = await agentDispatch.listDispatch(roomName);
    dispatches = Array.isArray(existing) ? existing : [];
  } catch (e) {
    console.warn(`[livekitService] listDispatch(${roomName}):`, e.message);
  }

  const { action, staleDispatchIds } = decideDispatchAction({
    agentPresent,
    dispatches,
    agentName,
  });

  if (action !== 'create') {
    return agentPresent ? 'present' : 'in-flight';
  }

  for (const dispatchId of staleDispatchIds) {
    try {
      await agentDispatch.deleteDispatch(dispatchId, roomName);
      console.log(`[livekitService] Removed stale agent dispatch ${dispatchId} for ${roomName}`);
    } catch (delErr) {
      console.warn(`[livekitService] deleteDispatch ${dispatchId}:`, delErr.message);
    }
  }

  try {
    await agentDispatch.createDispatch(roomName, agentName);
    console.log(`[livekitService] Agent dispatched to ${roomName} (${agentName})`);
    return 'created';
  } catch (e) {
    // No fallback createDispatch here: a blind retry after a partial success
    // is another duplicate-agent path.
    console.warn(`[livekitService] Agent dispatch failed for ${roomName}:`, e.message);
    return 'failed';
  }
}

/** Ephemeral public demo room — shorter empty timeout, demo metadata flag. */
async function createDemoLiveKitRoom(roomName, demoMeta = {}) {
  const roomService = getRoomService();
  const emptyTimeout = 600;
  const departureTimeout = 120;
  const metadata = {
    createdAt: new Date().toISOString(),
    type: 'demo',
    roomMode: 'multi-language',
    stt_pipeline: 'deepgram_codeswitch',
    demo: true,
    ...demoMeta,
  };
  const room = await roomService.createRoom({
    name: roomName,
    emptyTimeout,
    departureTimeout,
    maxParticipants: 10,
    metadata: JSON.stringify(metadata),
  });
  const agentName = agentNameForPipeline('deepgram_codeswitch');
  await withRoomLock(roomName, () => ensureAgentDispatchLocked(roomName, agentName));
  return room;
}

/**
 * Ensure a LiveKit room exists and has an agent dispatched.
 * If the room was torn down after emptyTimeout, LiveKit's createRoom is
 * idempotent — it returns the existing room or creates a new one.
 * We then check for an active agent dispatch and create one if missing.
 */
async function ensureRoomAndAgent(roomName, roomMode = 'multi-language', orgId = null) {
  // Serialized per room: simultaneous host/guest joins must not race the
  // participant/dispatch checks below.
  return withRoomLock(roomName, () => ensureRoomAndAgentLocked(roomName, roomMode, orgId));
}

async function ensureRoomAndAgentLocked(roomName, roomMode = 'multi-language', orgId = null) {
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
  // Exactly one dispatch per room (see ensureAgentDispatchLocked). Previously
  // this deleted live dispatches while their agent was still connecting and
  // created fresh ones — plus an unconditional fallback create on any error —
  // which could land two agents (duplicate captions/TTS/cost) in one room.
  // Explicit removal still happens in removeAgentsFromRoom/switchRoomSttPipeline.
  await ensureAgentDispatchLocked(roomName, agentName);

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
  // Locked so a concurrent guest join can't dispatch the old agent mid-swap.
  return withRoomLock(roomName, async () => {
    await removeAgentsFromRoom(roomName);
    await new Promise((r) => setTimeout(r, 600));
    const agentName = agentNameForPipeline(normalized);
    await getAgentDispatch().createDispatch(roomName, agentName);
    console.log(`[livekitService] Switched ${roomName} to pipeline=${normalized} agent=${agentName}`);
    return { pipeline: normalized, agentName };
  });
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
  createDemoLiveKitRoom,
  ensureRoomAndAgent,
  removeAgentsFromRoom,
  switchRoomSttPipeline,
  looksLikeAgentParticipant,
  decideDispatchAction,
  withRoomLock,
};
