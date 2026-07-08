const crypto = require('crypto');
const {
  getScenario,
  pickLine,
  normalizeText,
  matchResponse,
  DEMO_LANGUAGES,
  listScenarios,
} = require('./demoLabScenarios');
const { translateText } = require('./textTranslate');

const MAX_TURNS_PER_SESSION = 8;
const MAX_TEXT_LENGTH = 200;
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS_PER_IP_HOUR = 8;
const MAX_CONCURRENT_SESSIONS = 40;

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
  if (count >= MAX_SESSIONS_PER_IP_HOUR) {
    return { ok: false, error: 'rate_limit_ip', message: 'Demo limit reached for this hour. Try again later or sign up free.' };
  }
  return { ok: true, hourKey };
}

function incrementIpBudget(hourKey) {
  ipHourCounts.set(hourKey, (ipHourCounts.get(hourKey) || 0) + 1);
}

async function buildCaptionLine({ speaker, sourceLang, originalText, readLang }) {
  const src = sourceLang || 'en';
  const tgt = readLang || 'en';
  let primary = originalText;
  let secondary = null;
  if (src !== tgt) {
    primary = await translateText(originalText, src, tgt);
    secondary = originalText;
  }
  return { speaker, sourceLang: src, originalText, primary, secondary };
}

async function createDemoSession({ scenarioId, speakLang, readLang, ip }) {
  pruneSessions();
  if (sessions.size >= MAX_CONCURRENT_SESSIONS) {
    return { ok: false, error: 'capacity', message: 'Demo is busy right now. Please try again in a minute.' };
  }

  const ipCheck = checkIpBudget(ip);
  if (!ipCheck.ok) return ipCheck;

  const scenario = getScenario(scenarioId);
  if (!scenario) return { ok: false, error: 'invalid_scenario', message: 'Unknown scenario.' };

  const allowed = DEMO_LANGUAGES.map((l) => l.code);
  const speak = allowed.includes(speakLang) ? speakLang : 'en';
  const read = allowed.includes(readLang) ? readLang : 'en';

  const sessionId = newSessionId();
  const botOriginal = pickLine(scenario.opening, scenario.bot.speakLang);
  const openingLine = await buildCaptionLine({
    speaker: scenario.bot.name,
    sourceLang: scenario.bot.speakLang,
    originalText: botOriginal,
    readLang: read,
  });

  sessions.set(sessionId, {
    id: sessionId,
    ip,
    scenarioId,
    speakLang: speak,
    readLang: read,
    turnCount: 0,
    createdAt: Date.now(),
    events: [],
  });
  incrementIpBudget(ipCheck.hourKey);

  return {
    ok: true,
    sessionId,
    scenario: { id: scenario.id, title: scenario.title, bot: scenario.bot },
    speakLang: speak,
    readLang: read,
    maxTurns: MAX_TURNS_PER_SESSION,
    openingLine,
    lines: [openingLine],
  };
}

async function processDemoTurn({ sessionId, userText, ip }) {
  pruneSessions();
  const session = sessions.get(sessionId);
  if (!session) {
    return { ok: false, error: 'invalid_session', message: 'Session expired. Refresh to start again.' };
  }
  if (session.ip !== ip) {
    return { ok: false, error: 'session_mismatch', message: 'Invalid session.' };
  }
  if (session.turnCount >= MAX_TURNS_PER_SESSION) {
    return { ok: false, error: 'turn_limit', message: 'Turn limit reached for this demo session.' };
  }

  const text = normalizeText(userText);
  if (!text) {
    return { ok: false, error: 'empty_text', message: 'Say or type something to continue.' };
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, error: 'text_too_long', message: `Keep it under ${MAX_TEXT_LENGTH} characters.` };
  }

  const scenario = getScenario(session.scenarioId);
  if (!scenario) {
    return { ok: false, error: 'invalid_scenario', message: 'Unknown scenario.' };
  }

  session.turnCount += 1;

  const userLine = await buildCaptionLine({
    speaker: 'You',
    sourceLang: session.speakLang,
    originalText: text,
    readLang: session.readLang,
  });

  const botLines = matchResponse(scenario, text);
  const botOriginal = pickLine(botLines, scenario.bot.speakLang);
  const botLine = await buildCaptionLine({
    speaker: scenario.bot.name,
    sourceLang: scenario.bot.speakLang,
    originalText: botOriginal,
    readLang: session.readLang,
  });

  return {
    ok: true,
    turnsRemaining: MAX_TURNS_PER_SESSION - session.turnCount,
    userLine,
    botLine,
    complete: session.turnCount >= MAX_TURNS_PER_SESSION,
  };
}

function recordDemoEvent(sessionId, event, ip) {
  const session = sessions.get(sessionId);
  if (!session || session.ip !== ip) return { ok: false };
  session.events.push({ event, at: Date.now() });
  return { ok: true };
}

function getDemoConfig() {
  return {
    languages: DEMO_LANGUAGES,
    scenarios: listScenarios(),
    limits: {
      maxTurns: MAX_TURNS_PER_SESSION,
      maxTextLength: MAX_TEXT_LENGTH,
      sessionTtlMinutes: SESSION_TTL_MS / 60000,
    },
  };
}

module.exports = {
  createDemoSession,
  processDemoTurn,
  recordDemoEvent,
  getDemoConfig,
};
