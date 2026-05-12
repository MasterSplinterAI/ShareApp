const { verifyToken } = require('../lib/authAdapter');

/**
 * Bearer JWT for V2 APIs. Attaches req.v2Auth = { userId, email, orgId, role }.
 */
function requireV2Auth(req, res, next) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return res.status(401).json({ error: 'Unauthorized', code: 'missing_token' });
  }
  const payload = verifyToken(m[1]);
  if (!payload || !payload.sub || !payload.orgId) {
    return res.status(401).json({ error: 'Unauthorized', code: 'invalid_token' });
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
