const { verifyToken } = require('../lib/authAdapter');
const db = require('../db/v2Database');
const { assertAccountActive } = require('../lib/v2OrgLifecycle');

/**
 * Bearer JWT for V2 APIs. Attaches req.v2Auth = { userId, email, orgId, role }.
 */
async function requireV2Auth(req, res, next) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return res.status(401).json({ error: 'Unauthorized', code: 'missing_token' });
  }
  const payload = verifyToken(m[1]);
  if (!payload || !payload.sub || !payload.orgId) {
    return res.status(401).json({ error: 'Unauthorized', code: 'invalid_token' });
  }
  try {
    const check = await assertAccountActive(payload.sub, payload.orgId);
    if (!check.ok) {
      return res.status(403).json({ error: check.message, code: check.code });
    }
  } catch (e) {
    console.error('[v2Auth]', e);
    return res.status(500).json({ error: 'Auth check failed' });
  }
  req.v2Auth = {
    userId: payload.sub,
    email: payload.email,
    orgId: payload.orgId,
    role: payload.role || 'member',
  };
  next();
}

function optionalV2Auth(req, res, next) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (m) {
    const payload = verifyToken(m[1]);
    if (payload && payload.sub && payload.orgId) {
      req.v2Auth = {
        userId: payload.sub,
        email: payload.email,
        orgId: payload.orgId,
        role: payload.role || 'member',
      };
    }
  }
  next();
}

module.exports = { requireV2Auth, optionalV2Auth };
