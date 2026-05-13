const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { AccessToken } = require('livekit-server-sdk');
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { createLiveKitConferenceRoom, ensureRoomAndAgent } = require('../../lib/livekitService');
const { assertCanCreateMeeting } = require('../../lib/v2Entitlements');
const { publicFrontendBaseUrl } = require('../../lib/publicFrontendBaseUrl');

function defaultInviteTtlMs() {
  const days = Number(process.env.V2_DEFAULT_INVITE_TTL_DAYS || 7);
  return (Number.isFinite(days) && days > 0 ? days : 7) * 86400000;
}

function defaultRequireInvite() {
  return process.env.V2_DEFAULT_REQUIRE_INVITE !== '0';
}

async function assertMeetingAccess(row, auth) {
  if (!row) return false;
  if (row.host_user_id === auth.userId) return true;
  if (['owner', 'admin'].includes(auth.role)) return true;
  return false;
}

router.post('/', requireV2Auth, async (req, res) => {
  try {
    const gate = await assertCanCreateMeeting(req.v2Auth.orgId);
    if (!gate.ok) {
      return res.status(402).json({ error: gate.message, code: gate.code });
    }
    const { title, scheduled_start, scheduled_end, host_required_to_start } = req.body || {};
    const hostRequired = Boolean(host_required_to_start);
    const requireInvite = defaultRequireInvite();
    const roomName = `v2-${db.uuid().replace(/-/g, '').slice(0, 12)}-${Date.now().toString(36)}`;
    await createLiveKitConferenceRoom(roomName, 'multi-language');
    const hostCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const now = new Date().toISOString();
    let status = 'live';
    if (scheduled_start) {
      const t = new Date(scheduled_start).getTime();
      if (!Number.isNaN(t) && t > Date.now()) status = 'scheduled';
    }
    const meetingId = db.uuid();
    const hostPresent = hostRequired ? 0 : 1;
    await db.run(
      `INSERT INTO v2_meetings (id, org_id, host_user_id, livekit_room_name, title, status, scheduled_start, scheduled_end, host_code, started_at, metadata, host_present)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        meetingId,
        req.v2Auth.orgId,
        req.v2Auth.userId,
        roomName,
        title || 'Meeting',
        status,
        scheduled_start || null,
        scheduled_end || null,
        hostCode,
        status === 'live' ? now : null,
        JSON.stringify({ source: 'v2' }),
        hostPresent,
      ]
    );
    await db.run(
      `INSERT INTO v2_meeting_policies (meeting_id, host_required_to_start, require_invite_token) VALUES (?,?,?)`,
      [meetingId, hostRequired ? 1 : 0, requireInvite ? 1 : 0]
    );

    let defaultInviteToken = null;
    let defaultInviteExpiresAt = null;
    if (requireInvite) {
      const linkId = db.uuid();
      defaultInviteToken = crypto.randomBytes(18).toString('base64url');
      defaultInviteExpiresAt = new Date(Date.now() + defaultInviteTtlMs()).toISOString();
      await db.run(
        `INSERT INTO v2_meeting_invite_links (id, meeting_id, token, label, expires_at, revoked_at, reusable, use_count, max_uses)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [linkId, meetingId, defaultInviteToken, 'Default guest link', defaultInviteExpiresAt, null, 1, 0, null]
      );
    }

    const base = publicFrontendBaseUrl(req);
    const guestPath = requireInvite
      ? `${base}/join/${encodeURIComponent(roomName)}?i=${encodeURIComponent(defaultInviteToken)}`
      : `${base}/join/${encodeURIComponent(roomName)}`;
    res.status(201).json({
      id: meetingId,
      livekitRoomName: roomName,
      hostCode,
      status,
      joinUrl: guestPath,
      title: title || 'Meeting',
      policy: { host_required_to_start: hostRequired, require_invite_token: requireInvite },
      defaultInviteToken,
      defaultInviteExpiresAt,
    });
  } catch (e) {
    console.error('[v2/meetings POST]', e);
    res.status(500).json({ error: 'Failed to create meeting' });
  }
});

router.get('/', requireV2Auth, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT m.id, m.livekit_room_name, m.title, m.status, m.scheduled_start, m.scheduled_end, m.host_code,
              m.created_at, m.started_at, m.ended_at, m.host_present,
              IFNULL(p.host_required_to_start, 0) AS host_required_to_start,
              IFNULL(p.require_invite_token, 0) AS require_invite_token
       FROM v2_meetings m
       LEFT JOIN v2_meeting_policies p ON p.meeting_id = m.id
       WHERE m.org_id = ? ORDER BY datetime(m.created_at) DESC LIMIT 100`,
      [req.v2Auth.orgId]
    );
    res.json({ meetings: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list meetings' });
  }
});

router.get('/:id/invites', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(`SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`, [req.params.id, req.v2Auth.orgId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!(await assertMeetingAccess(row, req.v2Auth))) return res.status(403).json({ error: 'Forbidden' });
    const links = await db.all(
      `SELECT id, label, expires_at, revoked_at, reusable, use_count, max_uses, created_at FROM v2_meeting_invite_links WHERE meeting_id = ? ORDER BY datetime(created_at) DESC`,
      [req.params.id]
    );
    res.json({ invites: links });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/:id/invites', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(`SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`, [req.params.id, req.v2Auth.orgId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!(await assertMeetingAccess(row, req.v2Auth))) return res.status(403).json({ error: 'Forbidden' });
    const { expiresInHours, reusable, label, maxUses } = req.body || {};
    const hours = Number(expiresInHours);
    const ttlMs = (Number.isFinite(hours) && hours > 0 ? hours : 168) * 3600000;
    const token = crypto.randomBytes(18).toString('base64url');
    const linkId = db.uuid();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await db.run(
      `INSERT INTO v2_meeting_invite_links (id, meeting_id, token, label, expires_at, revoked_at, reusable, use_count, max_uses)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        linkId,
        req.params.id,
        token,
        (label && String(label).slice(0, 80)) || 'Guest link',
        expiresAt,
        null,
        reusable ? 1 : 0,
        0,
        maxUses != null && Number.isFinite(Number(maxUses)) ? Number(maxUses) : null,
      ]
    );
    const base = publicFrontendBaseUrl(req);
    const joinUrl = `${base}/join/${encodeURIComponent(row.livekit_room_name)}?i=${encodeURIComponent(token)}`;
    res.status(201).json({ id: linkId, token, expiresAt, joinUrl, reusable: Boolean(reusable) });
  } catch (e) {
    console.error('[v2/invites POST]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.delete('/:id/invites/:linkId', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(`SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`, [req.params.id, req.v2Auth.orgId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!(await assertMeetingAccess(row, req.v2Auth))) return res.status(403).json({ error: 'Forbidden' });
    const now = new Date().toISOString();
    const r = await db.run(
      `UPDATE v2_meeting_invite_links SET revoked_at = ? WHERE id = ? AND meeting_id = ? AND revoked_at IS NULL`,
      [now, req.params.linkId, req.params.id]
    );
    if (!r.changes) return res.status(404).json({ error: 'Invite not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/:id/host-session-open', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(`SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`, [req.params.id, req.v2Auth.orgId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.host_user_id !== req.v2Auth.userId) {
      return res.status(403).json({ error: 'Only the meeting host can open the session' });
    }
    await db.run(`UPDATE v2_meetings SET host_present = 1 WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/:id', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(
      `SELECT m.*,
         IFNULL(p.host_required_to_start, 0) AS host_required_to_start,
         IFNULL(p.require_invite_token, 0) AS require_invite_token
       FROM v2_meetings m
       LEFT JOIN v2_meeting_policies p ON p.meeting_id = m.id
       WHERE m.id = ? AND m.org_id = ?`,
      [req.params.id, req.v2Auth.orgId]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    const base = publicFrontendBaseUrl(req);
    const invites = await db.all(
      `SELECT id, label, expires_at, revoked_at, reusable, use_count, max_uses, created_at, token FROM v2_meeting_invite_links WHERE meeting_id = ? ORDER BY datetime(created_at) DESC`,
      [req.params.id]
    );
    const policy = {
      host_required_to_start: row.host_required_to_start === 1,
      require_invite_token: row.require_invite_token === 1,
    };
    const guestJoinBase = `${base}/join/${encodeURIComponent(row.livekit_room_name)}`;
    let joinUrl = guestJoinBase;
    const activeDefault = invites.find((l) => l.label === 'Default guest link' && !l.revoked_at);
    if (policy.require_invite_token && activeDefault) {
      joinUrl = `${guestJoinBase}?i=${encodeURIComponent(activeDefault.token)}`;
    }
    const { host_required_to_start, require_invite_token, ...meetingRow } = row;
    res.json({
      ...meetingRow,
      policy,
      joinUrl,
      invites,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/:id', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(`SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`, [req.params.id, req.v2Auth.orgId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!(await assertMeetingAccess(row, req.v2Auth))) return res.status(403).json({ error: 'Forbidden' });
    const { title, status, host_required_to_start, require_invite_token } = req.body || {};
    if (title != null) await db.run(`UPDATE v2_meetings SET title = ? WHERE id = ?`, [String(title).slice(0, 200), req.params.id]);
    if (status && ['scheduled', 'live', 'ended', 'archived'].includes(status)) {
      const now = new Date().toISOString();
      if (status === 'live') {
        await db.run(`UPDATE v2_meetings SET status = ?, started_at = COALESCE(started_at, ?) WHERE id = ?`, [status, now, req.params.id]);
      } else if (status === 'ended') {
        await db.run(`UPDATE v2_meetings SET status = ?, ended_at = ? WHERE id = ?`, [status, now, req.params.id]);
      } else if (status === 'archived') {
        await db.run(`UPDATE v2_meetings SET status = ? WHERE id = ?`, [status, req.params.id]);
      } else {
        await db.run(`UPDATE v2_meetings SET status = ? WHERE id = ?`, [status, req.params.id]);
      }
    }
    if (host_required_to_start !== undefined || require_invite_token !== undefined) {
      const pol = await db.get(`SELECT meeting_id FROM v2_meeting_policies WHERE meeting_id = ?`, [req.params.id]);
      const hr = host_required_to_start !== undefined ? (host_required_to_start ? 1 : 0) : null;
      const ri = require_invite_token !== undefined ? (require_invite_token ? 1 : 0) : null;
      if (pol) {
        if (hr !== null && ri !== null) {
          await db.run(`UPDATE v2_meeting_policies SET host_required_to_start = ?, require_invite_token = ? WHERE meeting_id = ?`, [hr, ri, req.params.id]);
        } else if (hr !== null) {
          await db.run(`UPDATE v2_meeting_policies SET host_required_to_start = ? WHERE meeting_id = ?`, [hr, req.params.id]);
        } else if (ri !== null) {
          await db.run(`UPDATE v2_meeting_policies SET require_invite_token = ? WHERE meeting_id = ?`, [ri, req.params.id]);
        }
      } else {
        await db.run(`INSERT INTO v2_meeting_policies (meeting_id, host_required_to_start, require_invite_token) VALUES (?,?,?)`, [
          req.params.id,
          hr !== null ? hr : 0,
          ri !== null ? ri : defaultRequireInvite() ? 1 : 0,
        ]);
      }
      if (hr === 1) {
        await db.run(`UPDATE v2_meetings SET host_present = 0 WHERE id = ?`, [req.params.id]);
      }
      if (hr === 0) {
        await db.run(`UPDATE v2_meetings SET host_present = 1 WHERE id = ?`, [req.params.id]);
      }
    }
    const updated = await db.get(
      `SELECT m.*,
         IFNULL(p.host_required_to_start, 0) AS host_required_to_start,
         IFNULL(p.require_invite_token, 0) AS require_invite_token
       FROM v2_meetings m
       LEFT JOIN v2_meeting_policies p ON p.meeting_id = m.id
       WHERE m.id = ?`,
      [req.params.id]
    );
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update' });
  }
});

router.post('/:id/token', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(
      `SELECT m.*,
         IFNULL(p.host_required_to_start, 0) AS host_required_to_start,
         IFNULL(p.require_invite_token, 0) AS require_invite_token
       FROM v2_meetings m
       LEFT JOIN v2_meeting_policies p ON p.meeting_id = m.id
       WHERE m.id = ? AND m.org_id = ?`,
      [req.params.id, req.v2Auth.orgId]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    const { participantName, isHost } = req.body || {};
    if (!participantName) return res.status(400).json({ error: 'participantName required' });
    const host = Boolean(isHost);
    if (host && row.host_user_id !== req.v2Auth.userId) {
      return res.status(403).json({ error: 'Only meeting host can request host token' });
    }
    if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      return res.status(500).json({ error: 'LiveKit not configured' });
    }
    await ensureRoomAndAgent(row.livekit_room_name, 'multi-language');
    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: String(participantName).slice(0, 128),
      ttl: '24h',
    });
    at.addGrant({
      roomJoin: true,
      room: row.livekit_room_name,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: host,
      recorder: host,
    });
    const token = await at.toJwt();
    if (host) {
      await db.run(`UPDATE v2_meetings SET host_present = 1 WHERE id = ?`, [req.params.id]);
    }
    res.json({ token, url: process.env.LIVEKIT_URL, roomName: row.livekit_room_name, participantName, isHost: host });
  } catch (e) {
    console.error('[v2/meetings/token]', e);
    res.status(500).json({ error: 'Token failed' });
  }
});

module.exports = router;
