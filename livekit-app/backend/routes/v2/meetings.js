const express = require('express');
const router = express.Router();
const { AccessToken } = require('livekit-server-sdk');
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { createLiveKitConferenceRoom } = require('../../lib/livekitService');
const { assertCanCreateMeeting } = require('../../lib/v2Entitlements');
const { publicFrontendBaseUrl } = require('../../lib/publicFrontendBaseUrl');

router.post('/', requireV2Auth, async (req, res) => {
  try {
    const gate = await assertCanCreateMeeting(req.v2Auth.orgId);
    if (!gate.ok) {
      return res.status(402).json({ error: gate.message, code: gate.code });
    }
    const { title, scheduled_start, scheduled_end } = req.body || {};
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
    await db.run(
      `INSERT INTO v2_meetings (id, org_id, host_user_id, livekit_room_name, title, status, scheduled_start, scheduled_end, host_code, started_at, metadata)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
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
      ]
    );
    const base = publicFrontendBaseUrl(req);
    res.status(201).json({
      id: meetingId,
      livekitRoomName: roomName,
      hostCode,
      status,
      joinUrl: `${base}/join/${encodeURIComponent(roomName)}`,
      title: title || 'Meeting',
    });
  } catch (e) {
    console.error('[v2/meetings POST]', e);
    res.status(500).json({ error: 'Failed to create meeting' });
  }
});

router.get('/', requireV2Auth, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT id, livekit_room_name, title, status, scheduled_start, scheduled_end, host_code, created_at, started_at, ended_at
       FROM v2_meetings WHERE org_id = ? ORDER BY datetime(created_at) DESC LIMIT 100`,
      [req.v2Auth.orgId]
    );
    res.json({ meetings: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list meetings' });
  }
});

router.get('/:id', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(
      `SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`,
      [req.params.id, req.v2Auth.orgId]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    const base = publicFrontendBaseUrl(req);
    res.json({
      ...row,
      joinUrl: `${base}/join/${encodeURIComponent(row.livekit_room_name)}`,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/:id', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(
      `SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`,
      [req.params.id, req.v2Auth.orgId]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.host_user_id !== req.v2Auth.userId && req.v2Auth.role !== 'owner' && req.v2Auth.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { title, status } = req.body || {};
    if (title) await db.run(`UPDATE v2_meetings SET title = ? WHERE id = ?`, [String(title).slice(0, 200), req.params.id]);
    if (status && ['scheduled', 'live', 'ended'].includes(status)) {
      const now = new Date().toISOString();
      if (status === 'live') await db.run(`UPDATE v2_meetings SET status = ?, started_at = COALESCE(started_at, ?) WHERE id = ?`, [status, now, req.params.id]);
      if (status === 'ended') await db.run(`UPDATE v2_meetings SET status = ?, ended_at = ? WHERE id = ?`, [status, now, req.params.id]);
    }
    const updated = await db.get(`SELECT * FROM v2_meetings WHERE id = ?`, [req.params.id]);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update' });
  }
});

router.post('/:id/token', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(
      `SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`,
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
    res.json({ token, url: process.env.LIVEKIT_URL, roomName: row.livekit_room_name, participantName, isHost: host });
  } catch (e) {
    console.error('[v2/meetings/token]', e);
    res.status(500).json({ error: 'Token failed' });
  }
});

module.exports = router;
