/**
 * Unauthenticated join preview + guest LiveKit token for V2 meetings.
 */
const express = require('express');
const { AccessToken } = require('livekit-server-sdk');
const db = require('../../db/v2Database');

const router = express.Router();

async function loadV2MeetingByRoom(roomName) {
  return db.get(
    `SELECT m.*,
       IFNULL(p.host_required_to_start, 0) AS host_required_to_start,
       IFNULL(p.require_invite_token, 0) AS require_invite_token
     FROM v2_meetings m
     LEFT JOIN v2_meeting_policies p ON p.meeting_id = m.id
     WHERE m.livekit_room_name = ?`,
    [roomName]
  );
}

async function validateGuestAccess(meeting, inviteToken) {
  if (['ended', 'archived'].includes(meeting.status)) {
    return { ok: false, reason: 'meeting_ended' };
  }
  if (meeting.host_required_to_start === 1 && meeting.host_present !== 1) {
    return { ok: false, reason: 'waiting_for_host' };
  }
  if (meeting.require_invite_token !== 1) {
    return { ok: true, link: null };
  }
  if (!inviteToken || typeof inviteToken !== 'string') {
    return { ok: false, reason: 'invite_required' };
  }
  const link = await db.get(
    `SELECT * FROM v2_meeting_invite_links WHERE meeting_id = ? AND token = ? AND revoked_at IS NULL`,
    [meeting.id, inviteToken]
  );
  if (!link) {
    return { ok: false, reason: 'invalid_invite' };
  }
  const exp = new Date(link.expires_at).getTime();
  if (Number.isNaN(exp) || exp < Date.now()) {
    return { ok: false, reason: 'invite_expired' };
  }
  if (link.max_uses != null && link.use_count >= link.max_uses) {
    return { ok: false, reason: 'invite_max_uses' };
  }
  if (!link.reusable && link.use_count >= 1) {
    return { ok: false, reason: 'invite_used' };
  }
  return { ok: true, link };
}

router.get('/join-info', async (req, res) => {
  try {
    const roomName = req.query.roomName;
    const inviteToken = typeof req.query.i === 'string' ? req.query.i : '';
    if (!roomName || typeof roomName !== 'string') {
      return res.status(400).json({ error: 'roomName required' });
    }
    const meeting = await loadV2MeetingByRoom(roomName);
    if (!meeting) {
      return res.json({ mode: 'classic', allowed: true });
    }
    const v = await validateGuestAccess(meeting, inviteToken);
    if (!v.ok) {
      return res.json({
        mode: 'v2',
        allowed: false,
        reason: v.reason,
        meetingId: meeting.id,
        title: meeting.title,
      });
    }
    return res.json({
      mode: 'v2',
      allowed: true,
      meetingId: meeting.id,
      title: meeting.title,
      inviteRequired: meeting.require_invite_token === 1,
    });
  } catch (e) {
    console.error('[v2/join-info]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/guest-token', async (req, res) => {
  try {
    const { roomName, participantName, inviteToken } = req.body || {};
    if (!roomName || !participantName) {
      return res.status(400).json({ error: 'roomName and participantName required' });
    }
    const meeting = await loadV2MeetingByRoom(String(roomName));
    if (!meeting) {
      return res.status(404).json({ error: 'Not a V2 meeting' });
    }
    const v = await validateGuestAccess(meeting, inviteToken || '');
    if (!v.ok) {
      return res.status(403).json({ error: 'Join not allowed', code: v.reason });
    }
    if (v.link) {
      await db.run(`UPDATE v2_meeting_invite_links SET use_count = use_count + 1 WHERE id = ?`, [v.link.id]);
    }
    if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      return res.status(500).json({ error: 'LiveKit not configured' });
    }
    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: String(participantName).slice(0, 128),
      ttl: '12h',
    });
    at.addGrant({
      roomJoin: true,
      room: meeting.livekit_room_name,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: false,
      recorder: false,
    });
    const token = await at.toJwt();
    res.json({
      token,
      url: process.env.LIVEKIT_URL,
      roomName: meeting.livekit_room_name,
      meetingId: meeting.id,
      participantName,
      isHost: false,
    });
  } catch (e) {
    console.error('[v2/guest-token]', e);
    res.status(500).json({ error: 'Token failed' });
  }
});

module.exports = router;
