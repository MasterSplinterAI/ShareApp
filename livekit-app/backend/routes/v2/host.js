const express = require('express');
const { TrackType } = require('@livekit/protocol');
const router = express.Router();
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { getRoomService } = require('../../lib/livekitService');

async function muteParticipantAudio(roomName, identity, muted = true) {
  const roomService = getRoomService();
  let participant;
  try {
    participant = await roomService.getParticipant(roomName, identity);
  } catch (e) {
    const err = new Error(e.message || 'Participant not found in room');
    err.code = 'PARTICIPANT_NOT_FOUND';
    throw err;
  }
  const tracks = participant.tracks || [];
  const audioTracks = tracks.filter((t) => {
    if (!t || !t.sid) return false;
    const ty = Number(t.type);
    return Number.isFinite(ty) && ty === TrackType.AUDIO;
  });
  if (audioTracks.length === 0) {
    const err = new Error('No microphone track published for this participant');
    err.code = 'NO_AUDIO_TRACK';
    throw err;
  }
  for (const t of audioTracks) {
    await roomService.mutePublishedTrack(roomName, identity, String(t.sid), Boolean(muted));
  }
}

function livekitErrorMessage(e) {
  if (!e) return '';
  if (typeof e.message === 'string') return e.message;
  return String(e);
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
    const muted = req.body?.muted !== undefined ? Boolean(req.body.muted) : true;
    await muteParticipantAudio(row.livekit_room_name, identity, muted);
    res.json({ ok: true, muted });
  } catch (e) {
    const msg = livekitErrorMessage(e);
    console.error('[v2/host mute]', msg, e);
    if (msg.toLowerCase().includes('remote unmute is disabled')) {
      return res.status(403).json({
        error: 'Remote unmute is disabled for this LiveKit project.',
        code: 'remote_unmute_disabled',
        hint:
          'LiveKit Cloud: open https://cloud.livekit.io → your project → Settings → enable ' +
          '"Admins can remotely unmute tracks" (required for host unmute from the dashboard).',
      });
    }
    if (e.code === 'NO_AUDIO_TRACK') {
      return res.status(409).json({ error: msg, code: 'no_audio_track' });
    }
    if (e.code === 'PARTICIPANT_NOT_FOUND') {
      return res.status(404).json({ error: msg, code: 'participant_not_found' });
    }
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
