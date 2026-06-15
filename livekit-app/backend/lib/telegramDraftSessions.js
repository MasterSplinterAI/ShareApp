const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map();

function sessionKey(telegramUserId) {
  return String(telegramUserId);
}

function startDraftSession(telegramUserId, { proposalId, ticketId, publicNumber }) {
  const key = sessionKey(telegramUserId);
  sessions.set(key, {
    proposalId,
    ticketId,
    publicNumber,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
}

function getDraftSession(telegramUserId) {
  const key = sessionKey(telegramUserId);
  const session = sessions.get(key);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(key);
    return null;
  }
  return session;
}

function clearDraftSession(telegramUserId) {
  sessions.delete(sessionKey(telegramUserId));
}

module.exports = {
  startDraftSession,
  getDraftSession,
  clearDraftSession,
  SESSION_TTL_MS,
};
