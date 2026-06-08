function superadminEmails() {
  const raw = process.env.V2_SUPERADMIN_EMAILS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isSuperadminEmail(email) {
  const e = (email || '').toLowerCase();
  return Boolean(e && superadminEmails().has(e));
}

function requireSuperadmin(req, res, next) {
  const email = (req.v2Auth?.email || '').toLowerCase();
  if (!email || !superadminEmails().has(email)) {
    return res.status(403).json({ error: 'Forbidden', code: 'not_superadmin' });
  }
  next();
}

async function writeAdminAudit(db, actorEmail, action, payload) {
  await db.run(
    `INSERT INTO v2_admin_audit_log (id, actor_email, action, payload_json, created_at)
     VALUES (?,?,?,?, datetime('now'))`,
    [db.uuid(), String(actorEmail || '').slice(0, 320), action, JSON.stringify(payload || {})]
  );
}

module.exports = {
  superadminEmails,
  isSuperadminEmail,
  requireSuperadmin,
  writeAdminAudit,
};
