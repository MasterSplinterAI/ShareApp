/**
 * Unauthenticated join preview + guest LiveKit token for V2 meetings.
 */
const express = require('express');
const crypto = require('crypto');
const { AccessToken } = require('livekit-server-sdk');
const db = require('../../db/v2Database');
const { ensureRoomAndAgent } = require('../../lib/livekitService');
const { serializePublicBranding } = require('../../lib/v2Branding');
const { inviteIsUsable, inviteEffectiveFromMs } = require('../../lib/inviteExpiry');
const { orgIsSuspended } = require('../../lib/v2OrgLifecycle');
const { assertGuestJoinAllowed } = require('../../lib/v2Entitlements');
const { mintMeetingQualityToken } = require('../../lib/meetingQualityToken');
const { verifyToken } = require('../../lib/authAdapter');
const { participantMetadata } = require('../../lib/livekitTokenMetadata');

const router = express.Router();

/**
 * Logged-in admins often open /join/:code in the same browser. The guest token
 * stays a guest. Only current membership in the meeting's workspace may grant
 * workspace controls; a role in another workspace (or an old JWT) cannot.
 */
async function optionalJoinAuth(req, meeting) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const payload = verifyToken(match[1]);
  if (!payload?.sub) return null;
  const user = await db.get(`SELECT id, email, disabled_at FROM v2_users WHERE id = ?`, [payload.sub]);
  if (!user || user.disabled_at) return null;
  let role = 'guest';
  if (meeting.org_id) {
    const membership = await db.get(
      `SELECT role FROM v2_org_members WHERE user_id = ? AND org_id = ?`,
      [user.id, meeting.org_id]
    );
    if (membership?.role) role = membership.role;
  }
  return {
    userId: user.id,
    email: user.email,
    orgId: meeting.org_id,
    role,
  };
}

const INVITE_GATE_REASONS = new Set([
  'invite_required',
  'invalid_invite',
  'invite_expired',
  'invite_used',
  'invite_max_uses',
  'invite_not_yet_valid',
]);

async function loadV2MeetingByRoom(roomName) {
  return db.get(
    `SELECT m.*,
       IFNULL(p.host_required_to_start, 0) AS host_required_to_start,
       IFNULL(p.require_invite_token, 0) AS require_invite_token,
       IFNULL(p.store_transcripts, 0) AS store_transcripts,
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

/**
 * Validate invite first so join-info can stay generic until the invite proves
 * the caller is intended to see the meeting. Org/billing/hard-cap run after.
 */
async function validateGuestAccess(meeting, inviteToken) {
  if (meeting.status === 'archived') {
    return { ok: false, reason: 'meeting_ended' };
  }
  if (meeting.status === 'ended' && !inviteToken) {
    return { ok: false, reason: 'meeting_ended' };
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

  const org = meeting.org_id
    ? await db.get(`SELECT suspended_at, billing_status FROM v2_organizations WHERE id = ?`, [meeting.org_id])
    : null;
  if (org && orgIsSuspended(org)) {
    return { ok: false, reason: 'org_suspended', link };
  }
  if (org?.billing_status === 'suspended' || org?.billing_status === 'canceled') {
    return { ok: false, reason: 'billing_inactive', link };
  }
  if (meeting.org_id) {
    const gate = await assertGuestJoinAllowed(meeting.org_id);
    if (!gate.ok) {
      return { ok: false, reason: gate.code || 'usage_blocked', message: gate.message, link };
    }
  }
  if (meeting.host_required_to_start === 1 && meeting.host_present !== 1) {
    return { ok: false, reason: 'waiting_for_host', link };
  }
  return { ok: true, link };
}

function scrubbedJoinDenial(reason) {
  const safeReason = INVITE_GATE_REASONS.has(reason) ? reason : 'invite_required';
  return {
    mode: 'v2',
    allowed: false,
    reason: safeReason,
    message: null,
  };
}

function sanitizeLangParam(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/_/g, '-');
  if (!trimmed || trimmed.toLowerCase() === 'auto') return null;
  if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/.test(trimmed)) return null;
  return trimmed.slice(0, 16);
}

async function resolveDefaultLanguageForJoin(meeting, link, queryLang) {
  const fromQuery = sanitizeLangParam(queryLang);
  if (fromQuery) return fromQuery;

  const fromLink = sanitizeLangParam(link?.default_language);
  if (fromLink) return fromLink;

  try {
    const guestInvite = await db.get(
      `SELECT default_language FROM v2_meeting_guest_invites
       WHERE meeting_id = ? AND default_language IS NOT NULL
       ORDER BY datetime(created_at) DESC LIMIT 1`,
      [meeting.id]
    );
    const fromGuestInvite = sanitizeLangParam(guestInvite?.default_language);
    if (fromGuestInvite) return fromGuestInvite;
  } catch {
    /* ignore */
  }

  try {
    const dc = await db.get(
      `SELECT caller_user_id, callee_email, join_url FROM v2_direct_calls
       WHERE meeting_id = ?
       ORDER BY datetime(created_at) DESC LIMIT 1`,
      [meeting.id]
    );
    if (dc?.join_url) {
      const m = /[?&](?:lang|l)=([^&#]+)/i.exec(dc.join_url);
      if (m && m[1]) {
        const fromDcUrl = sanitizeLangParam(decodeURIComponent(m[1]));
        if (fromDcUrl) return fromDcUrl;
      }
    }
    if (dc?.caller_user_id && dc?.callee_email) {
      const cRow = await db.get(
        `SELECT preferred_language FROM v2_contacts
         WHERE owner_user_id = ? AND LOWER(contact_email) = LOWER(?) AND preferred_language IS NOT NULL
         LIMIT 1`,
        [dc.caller_user_id, dc.callee_email]
      );
      const fromContact = sanitizeLangParam(cRow?.preferred_language);
      if (fromContact) return fromContact;
    }
  } catch {
    /* ignore */
  }

  return null;
}

function detailedJoinDenial(req, meeting, v, defaultLanguage = null) {
  return {
    mode: 'v2',
    allowed: false,
    reason: v.reason,
    message: v.message || null,
    meetingId: meeting.id,
    title: meeting.title,
    branding: meetingBranding(req, meeting),
    defaultLanguage,
    default_language: defaultLanguage,
  };
}

router.get('/join-info', async (req, res) => {
  try {
    const roomName = req.query.roomName;
    const inviteToken = typeof req.query.i === 'string' ? req.query.i : '';
    const queryLang = typeof req.query.lang === 'string'
      ? req.query.lang
      : typeof req.query.l === 'string'
        ? req.query.l
        : '';
    if (!roomName || typeof roomName !== 'string') {
      return res.status(400).json({ error: 'roomName required' });
    }
    const meeting = await loadV2MeetingByRoom(roomName);
    if (!meeting) {
      const classicLang = sanitizeLangParam(queryLang);
      return res.json({
        mode: 'classic',
        allowed: true,
        defaultLanguage: classicLang,
        default_language: classicLang,
      });
    }
    const v = await validateGuestAccess(meeting, inviteToken);
    if (!v.ok) {
      if (!v.link) {
        return res.json(scrubbedJoinDenial(v.reason));
      }
      const defaultLanguage = await resolveDefaultLanguageForJoin(meeting, v.link, queryLang);
      return res.json(detailedJoinDenial(req, meeting, v, defaultLanguage));
    }
    // Guest is allowed — ensure LiveKit room exists before the client calls GET /rooms/:name.
    // Without this, host-not-required meetings fail with 404 even though join-info said allowed.
    await ensureRoomAndAgent(meeting.livekit_room_name, 'multi-language', meeting.org_id);

    // If this room was started as a Direct Call to a contact, return the contact's name
    // so the callee's join screen can pre-populate their name automatically.
    let suggestedParticipantName = null;
    try {
      const dc = await db.get(
        `SELECT callee_name FROM v2_direct_calls WHERE meeting_id = ? AND callee_name IS NOT NULL ORDER BY datetime(created_at) DESC LIMIT 1`,
        [meeting.id]
      );
      if (dc?.callee_name) {
        suggestedParticipantName = String(dc.callee_name).trim();
      }
    } catch {
      /* ignore */
    }

    const defaultLanguage = await resolveDefaultLanguageForJoin(meeting, v.link, queryLang);

    return res.json({
      mode: 'v2',
      allowed: true,
      meetingId: meeting.id,
      title: meeting.title,
      inviteRequired: true,
      policy: { store_transcripts: meeting.store_transcripts === 1 },
      branding: meetingBranding(req, meeting),
      suggestedParticipantName,
      defaultLanguage,
      default_language: defaultLanguage,
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
      const status =
        v.reason === 'hard_cap_meeting' ||
        v.reason === 'hard_cap_translation' ||
        v.reason === 'billing_inactive' ||
        v.reason === 'org_suspended'
          ? 402
          : 403;
      return res.status(status).json({
        error: v.message || 'Join not allowed',
        code: v.reason,
      });
    }
    if (v.link) {
      await db.run(`UPDATE v2_meeting_invite_links SET use_count = use_count + 1 WHERE id = ?`, [v.link.id]);
    }
    if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      return res.status(500).json({ error: 'LiveKit not configured' });
    }
    await ensureRoomAndAgent(meeting.livekit_room_name, 'multi-language');
    const displayName = String(participantName).trim().slice(0, 128) || 'Guest';
    const identity = `guest-${crypto.randomUUID()}`;
    const auth = await optionalJoinAuth(req, meeting);
    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity,
      name: displayName,
      metadata: participantMetadata({
        displayName,
        role: 'guest',
        auth,
      }),
      ttl: '12h',
    });
    // Ensure JWT `name` claim is set even if constructor options are ignored by SDK version.
    at.name = displayName;
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
    const qualityEventToken = mintMeetingQualityToken(meeting.id);
    res.json({
      token,
      url: process.env.LIVEKIT_URL,
      roomName: meeting.livekit_room_name,
      meetingId: meeting.id,
      participantName: displayName,
      participantIdentity: identity,
      isHost: false,
      qualityEventToken,
    });
  } catch (e) {
    console.error('[v2/guest-token]', e);
    res.status(500).json({ error: 'Token failed' });
  }
});

module.exports = router;
module.exports.scrubbedJoinDenial = scrubbedJoinDenial;
module.exports.INVITE_GATE_REASONS = INVITE_GATE_REASONS;
