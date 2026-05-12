const express = require('express');
const router = express.Router();
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { getRoomService } = require('../../lib/livekitService');

async function muteParticipantAudio(roomName, identity) {
  const roomService = getRoomService();
  const participant = await roomService.getParticipant(roomName, identity);
  const tracks = participant.tracks || [];
  for (const t of tracks) {
    if (t.type === 0 && t.sid) {
      await roomService.mutePublishedTrack(roomName, identity, t.sid, true);
    }
  }
}

router.get('/:id/participants', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(
      `SELECT livekit_room_name FROM v2_meetings WHERE id = ? AND org_id = ?`,
      [req.params.id, req.v2Auth.orgId]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    const roomService = getRoomService();
    const participants = await roomService.listParticipants(row.livekit_room_name);
    res.json({
      roomName: row.livekit_room_name,
      participants: participants.map((p) => ({
        identity: p.identity,
        sid: p.sid,
        name: p.name,
        state: p.state,
        joinedAt: p.joinedAt ? p.joinedAt.toString() : null,
      })),
    });
  } catch (e) {
    console.error('[v2/host participants]', e);
    res.status(500).json({ error: 'Failed to list participants' });
  }
});

router.post('/:id/participants/mute-all', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(
      `SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`,
      [req.params.id, req.v2Auth.orgId]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.host_user_id !== req.v2Auth.userId && !['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { exceptIdentity } = req.body || {};
    const roomService = getRoomService();
    const participants = await roomService.listParticipants(row.livekit_room_name);
    const except = exceptIdentity ? String(exceptIdentity) : null;
    for (const p of participants) {
      if (except && p.identity === except) continue;
      try {
        await muteParticipantAudio(row.livekit_room_name, p.identity);
      } catch (err) {
        console.warn('[mute-all] skip', p.identity, err.message);
      }
    }
    res.json({ ok: true, muted: participants.length });
  } catch (e) {
    console.error('[v2/host mute-all]', e);
    res.status(500).json({ error: 'Mute all failed' });
  }
});

router.post('/:id/participants/:identity/remove', requireV2Auth, async (req, res) => {
  try {
    const identity = decodeURIComponent(req.params.identity);
    const row = await db.get(
      `SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`,
      [req.params.id, req.v2Auth.orgId]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.host_user_id !== req.v2Auth.userId && !['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const roomService = getRoomService();
    await roomService.removeParticipant(row.livekit_room_name, identity);
    res.json({ ok: true });
  } catch (e) {
    console.error('[v2/host remove]', e);
    res.status(500).json({ error: 'Remove failed' });
  }
});

router.post('/:id/participants/:identity/mute', requireV2Auth, async (req, res) => {
  try {
    const identity = decodeURIComponent(req.params.identity);
    const row = await db.get(
      `SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`,
      [req.params.id, req.v2Auth.orgId]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.host_user_id !== req.v2Auth.userId && !['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await muteParticipantAudio(row.livekit_room_name, identity);
    res.json({ ok: true });
  } catch (e) {
    console.error('[v2/host mute]', e);
    res.status(500).json({ error: 'Mute failed' });
  }
});

router.post('/:id/end', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(
      `SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`,
      [req.params.id, req.v2Auth.orgId]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.host_user_id !== req.v2Auth.userId && !['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const roomService = getRoomService();
    try {
      await roomService.deleteRoom(row.livekit_room_name);
    } catch (e) {
      console.warn('[v2/host end] deleteRoom:', e.message);
    }
    const now = new Date().toISOString();
    await db.run(`UPDATE v2_meetings SET status = 'ended', ended_at = ? WHERE id = ?`, [now, req.params.id]);
    await db.run(`UPDATE v2_meeting_invite_links SET revoked_at = ? WHERE meeting_id = ? AND revoked_at IS NULL`, [now, req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'End meeting failed' });
  }
});

module.exports = router;
