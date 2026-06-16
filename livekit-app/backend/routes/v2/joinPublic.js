/**
 * Unauthenticated join preview + guest LiveKit token for V2 meetings.
 */
const express = require('express');
const { AccessToken } = require('livekit-server-sdk');
const db = require('../../db/v2Database');
const { ensureRoomAndAgent } = require('../../lib/livekitService');
const { serializePublicBranding } = require('../../lib/v2Branding');
const { inviteIsUsable, inviteEffectiveFromMs } = require('../../lib/inviteExpiry');
const { orgIsSuspended } = require('../../lib/v2OrgLifecycle');

const router = express.Router();

async function loadV2MeetingByRoom(roomName) {
  return db.get(
    `SELECT m.*,
       IFNULL(p.host_required_to_start, 0) AS host_required_to_start,
       IFNULL(p.require_invite_token, 0) AS require_invite_token,
       o.id AS org_id_ref,
       o.name AS org_name,
       o.account_type AS org_account_type,
       o.brand_accent_color,
       o.brand_welcome_message,
       o.brand_logo_file,
       u.display_name AS host_display_name
     FROM v2_meetings m
     LEFT JOIN v2_meeting_policies p ON p.meeting_id = m.id
     LEFT JOIN v2_organizations o ON o.id = m.org_id
     LEFT JOIN v2_users u ON u.id = m.host_user_id
     WHERE m.livekit_room_name = ?`,
    [roomName]
  );
}

function meetingBranding(req, meeting) {
  if (!meeting?.org_id_ref) return null;
  const org = {
    id: meeting.org_id_ref,
    name: meeting.org_name,
    account_type: meeting.org_account_type,
    brand_accent_color: meeting.brand_accent_color,
    brand_welcome_message: meeting.brand_welcome_message,
    brand_logo_file: meeting.brand_logo_file,
  };
  const hostUser = { display_name: meeting.host_display_name };
  return serializePublicBranding(req, org, hostUser);
}

async function validateGuestAccess(meeting, inviteToken) {
  const org = meeting.org_id
    ? await db.get(`SELECT suspended_at, billing_status FROM v2_organizations WHERE id = ?`, [meeting.org_id])
    : null;
  if (org && orgIsSuspended(org)) {
    return { ok: false, reason: 'org_suspended' };
  }
  if (org?.billing_status === 'suspended' || org?.billing_status === 'canceled') {
    return { ok: false, reason: 'billing_inactive' };
  }
  if (meeting.status === 'archived') {
    return { ok: false, reason: 'meeting_ended' };
  }
  if (meeting.status === 'ended' && !inviteToken) {
    return { ok: false, reason: 'meeting_ended' };
  }
  if (meeting.host_required_to_start === 1 && meeting.host_present !== 1) {
    return { ok: false, reason: 'waiting_for_host' };
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
  const fromMs = inviteEffectiveFromMs(meeting, link);
  if (fromMs != null && Date.now() < fromMs) {
    return { ok: false, reason: 'invite_not_yet_valid' };
  }
  if (!inviteIsUsable(link, meeting)) {
    if (meeting.status === 'ended' && ['through_meeting', 'day_of_meeting'].includes(link.expiry_mode)) {
      return { ok: false, reason: 'invite_expired' };
    }
    if (link.max_uses != null && link.use_count >= link.max_uses) {
      return { ok: false, reason: 'invite_max_uses' };
    }
    if (!link.reusable && link.use_count >= 1) {
      return { ok: false, reason: 'invite_used' };
    }
    return { ok: false, reason: 'invite_expired' };
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
        branding: meetingBranding(req, meeting),
      });
    }
    return res.json({
      mode: 'v2',
      allowed: true,
      meetingId: meeting.id,
      title: meeting.title,
      inviteRequired: true,
      branding: meetingBranding(req, meeting),
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
    await ensureRoomAndAgent(meeting.livekit_room_name, 'multi-language');
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
