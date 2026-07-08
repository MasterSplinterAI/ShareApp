const crypto = require('crypto');
const { AccessToken } = require('livekit-server-sdk');
const { createDemoLiveKitRoom } = require('./livekitService');
const { getScenario, getScenarioParticipants } = require('./demoLabScenarios');
const { getAgentsForScenario } = require('./demoLabAgents');
const { generateDemoAgentTurns } = require('./demoOrchestratorLlm');
const { translateText } = require('./textTranslate');

const DEMO_LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'ja'];
const MAX_TURNS = 12;
const MAX_ROOMS_PER_IP_HOUR = 6;
const MAX_CONCURRENT_ROOMS = 30;
const SESSION_TTL_MS = 15 * 60 * 1000;

const sessions = new Map();
const ipHourCounts = new Map();

function newSessionId() {
  return crypto.randomUUID();
}

function clientIp(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function pruneSessions() {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

function checkIpBudget(ip) {
  const hourKey = `${ip}:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
  const count = ipHourCounts.get(hourKey) || 0;
  if (count >= MAX_ROOMS_PER_IP_HOUR) {
    return { ok: false, error: 'rate_limit_ip', message: 'Demo room limit reached for this hour. Try again later or sign up free.' };
  }
  return { ok: true, hourKey };
}

function incrementIpBudget(hourKey) {
  ipHourCounts.set(hourKey, (ipHourCounts.get(hourKey) || 0) + 1);
}

async function buildAgentLine(line, readLang) {
  const src = line.sourceLang || 'en';
  const tgt = readLang || 'en';
  let primary = line.originalText;
  let secondary = null;
  if (src !== tgt) {
    primary = await translateText(line.originalText, src, tgt);
    secondary = line.originalText;
  }
  return {
    speaker: line.speaker,
    sourceLang: src,
    originalText: line.originalText,
    primary,
    secondary,
  };
}

async function createDemoLiveRoomSession({
  scenarioId,
  speakLang,
  readLang,
  participantLangs,
  participantName,
  ip,
}) {
  pruneSessions();
  if (sessions.size >= MAX_CONCURRENT_ROOMS) {
    return { ok: false, error: 'capacity', message: 'Demo rooms are busy right now. Please try again in a minute.' };
  }

  const ipCheck = checkIpBudget(ip);
  if (!ipCheck.ok) return ipCheck;

  const scenario = getScenario(scenarioId);
  if (!scenario) return { ok: false, error: 'invalid_scenario', message: 'Unknown scenario.' };

  const langs = participantLangs && typeof participantLangs === 'object' ? participantLangs : {};
  const speak = DEMO_LANGUAGES.includes(langs.You || speakLang) ? langs.You || speakLang : 'en';
  const read = DEMO_LANGUAGES.includes(readLang) ? readLang : 'en';
  const mergedLangs = { ...langs, You: speak };

  const demoSessionId = newSessionId();
  const roomName = `demo-${demoSessionId.slice(0, 8)}`;
  const displayName = String(participantName || 'Guest').trim().slice(0, 64) || 'Guest';
  const identity = displayName;
  const agents = getAgentsForScenario(scenarioId, mergedLangs);

  await createDemoLiveKitRoom(roomName, {
    demoSessionId,
    scenarioId,
    readLang: read,
    speakLang: speak,
    agentNames: agents.map((a) => a.name),
  });

  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity,
    ttl: '30m',
  });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();
  const participants = getScenarioParticipants(scenario, mergedLangs, displayName);

  sessions.set(demoSessionId, {
    id: demoSessionId,
    roomName,
    ip,
    scenarioId,
    speakLang: speak,
    readLang: read,
    participantLangs: mergedLangs,
    userIdentity: identity,
    turnCount: 0,
    openingDone: false,
    history: [],
    createdAt: Date.now(),
  });
  incrementIpBudget(ipCheck.hourKey);

  return {
    ok: true,
    demoSessionId,
    roomName,
    token,
    url: process.env.LIVEKIT_URL,
    identity,
    displayName,
    scenario: { id: scenario.id, title: scenario.title },
    agents,
    participants,
    speakLang: speak,
    readLang: read,
    maxTurns: MAX_TURNS,
  };
}

async function orchestrateDemoRoom({ demoSessionId, userText, trigger }) {
  pruneSessions();
  const session = sessions.get(demoSessionId);
  if (!session) {
    return { ok: false, error: 'invalid_session', message: 'Demo session expired. Refresh to start again.' };
  }

  const isOpening = trigger === 'opening' || (!session.openingDone && !userText);
  if (isOpening) {
    if (session.openingDone) {
      return { ok: true, agentLines: [], turnsRemaining: MAX_TURNS - session.turnCount, complete: false };
    }
    session.openingDone = true;
  } else {
    const text = String(userText || '').trim();
    if (!text) {
      return { ok: false, error: 'empty_text', message: 'No speech detected.' };
    }
    if (session.turnCount >= MAX_TURNS) {
      return { ok: false, error: 'turn_limit', message: 'Turn limit reached for this demo.' };
    }
    session.turnCount += 1;
    session.history.push({ speaker: session.userIdentity, text, lang: session.speakLang });
  }

  const { lines, fallback } = await generateDemoAgentTurns({
    scenarioId: session.scenarioId,
    participantLangs: session.participantLangs,
    history: session.history,
    userText: userText || '',
    isOpening,
  });

  const agentLines = [];
  for (const line of lines) {
    const built = await buildAgentLine(line, session.readLang);
    agentLines.push(built);
    session.history.push({ speaker: line.speaker, text: line.originalText, lang: line.sourceLang });
  }

  return {
    ok: true,
    agentLines,
    turnsRemaining: MAX_TURNS - session.turnCount,
    complete: session.turnCount >= MAX_TURNS,
    fallback: Boolean(fallback),
    isOpening,
  };
}

function getDemoLiveSession(demoSessionId) {
  return sessions.get(demoSessionId) || null;
}

module.exports = {
  createDemoLiveRoomSession,
  orchestrateDemoRoom,
  getDemoLiveSession,
};
