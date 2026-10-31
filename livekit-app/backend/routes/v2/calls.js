const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { createLiveKitConferenceRoom } = require('../../lib/livekitService');
const { assertCanCreateMeeting } = require('../../lib/v2Entitlements');
const { publicFrontendBaseUrl } = require('../../lib/publicFrontendBaseUrl');
const {
  defaultExpiryModeForMeeting,
  computeInviteExpiresAt,
} = require('../../lib/inviteExpiry');
const { sendEmail } = require('../../lib/mailer');

const CALL_RING_TTL_MS = 60 * 1000;

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function upsertContactForUser({ ownerUserId, email, name, preferredLanguage }) {
  const normEmail = normalizeEmail(email);
  if (!normEmail || !isValidEmail(normEmail)) return null;

  const matchedUser = await db.get(
    `SELECT id, email, display_name FROM v2_users WHERE LOWER(email) = LOWER(?) LIMIT 1`,
    [normEmail]
  );

  const existing = await db.get(
    `SELECT * FROM v2_contacts WHERE owner_user_id = ? AND LOWER(contact_email) = LOWER(?) LIMIT 1`,
    [ownerUserId, normEmail]
  );

  const cleanName = String(name || matchedUser?.display_name || normEmail.split('@')[0])
    .trim()
    .slice(0, 80);
  const cleanLang = preferredLanguage ? String(preferredLanguage).trim().slice(0, 16) : null;
  const contactUserId = matchedUser?.id || null;

  if (existing) {
    const nextName = name ? cleanName : existing.contact_name || cleanName;
    const nextLang = cleanLang || existing.preferred_language || null;
    await db.run(
      `UPDATE v2_contacts
       SET contact_name = ?, contact_user_id = ?, preferred_language = ?
       WHERE id = ?`,
      [nextName, contactUserId, nextLang, existing.id]
    );
    return {
      id: existing.id,
      email: normEmail,
      name: nextName,
      preferredLanguage: nextLang,
      contactUserId,
      hasAccount: Boolean(contactUserId),
    };
  }

  const id = db.uuid();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO v2_contacts (id, owner_user_id, contact_email, contact_name, contact_user_id, preferred_language, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, ownerUserId, normEmail, cleanName, contactUserId, cleanLang, now]
  );

  return {
    id,
    email: normEmail,
    name: cleanName,
    preferredLanguage: cleanLang,
    contactUserId,
    hasAccount: Boolean(contactUserId),
  };
}

async function ensureReusableInviteToken(meetingRow) {
  const nowIso = new Date().toISOString();
  const existing = await db.get(
    `SELECT * FROM v2_meeting_invite_links
     WHERE meeting_id = ? AND revoked_at IS NULL AND reusable = 1 AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`,
    [meetingRow.id, nowIso]
  );
  if (existing?.token) return existing.token;

  const linkId = db.uuid();
  const token = crypto.randomBytes(18).toString('base64url');
  const expiryMode = defaultExpiryModeForMeeting(meetingRow);
  const expiresAt = computeInviteExpiresAt(meetingRow, { mode: expiryMode });

  await db.run(
    `INSERT INTO v2_meeting_invite_links (id, meeting_id, token, label, expires_at, revoked_at, reusable, use_count, max_uses, expiry_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [linkId, meetingRow.id, token, 'Default guest link', expiresAt, null, 1, 0, null, expiryMode]
  );
  return token;
}

function sendDirectCallEmailAsync({ toEmail, calleeName, callerName, joinUrl }) {
  const safeCaller = escapeHtml(callerName || 'Someone');
  const safeCallee = escapeHtml(calleeName || '');
  const safeUrl = escapeHtml(joinUrl);
  const subject = `${callerName || 'Someone'} is calling you on Lalia`;
  const text = [
    `Hi${calleeName ? ` ${calleeName}` : ''},`,
    '',
    `${callerName || 'Someone'} is calling you right now on Lalia with live multilingual translation and captions.`,
    '',
    `Tap to join the call (no download or account required):`,
    joinUrl,
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #0f172a;">
      <p style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #2563eb; margin: 0 0 8px;">
        Incoming Lalia Call
      </p>
      <h2 style="font-size: 20px; font-weight: 600; margin: 0 0 12px;">
        ${safeCaller} is calling you${safeCallee ? `, ${safeCallee}` : ''}
      </h2>
      <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 20px;">
        Join in one tap with real-time speech translation and captions in your language. Works directly in your browser or the Lalia app.
      </p>
      <p style="margin: 0 0 20px;">
        <a href="${safeUrl}" style="display: inline-block; background: #16a34a; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 22px; border-radius: 10px;">
          Answer &amp; Join Call
        </a>
      </p>
      <p style="font-size: 12px; color: #64748b; word-break: break-all;">
        Or copy link: <a href="${safeUrl}" style="color: #2563eb;">${safeUrl}</a>
      </p>
    </div>
  `;

  sendEmail({ to: toEmail, subject, text, html }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Contacts endpoints (/api/v2/contacts)
// ---------------------------------------------------------------------------

router.get('/contacts', requireV2Auth, async (req, res) => {
  try {
    const [savedRows, teamRows] = await Promise.all([
      db.all(
        `SELECT c.id, c.contact_email, c.contact_name, c.preferred_language, c.created_at,
                u.id AS matched_user_id, u.display_name AS matched_display_name
         FROM v2_contacts c
         LEFT JOIN v2_users u ON LOWER(u.email) = LOWER(c.contact_email)
         WHERE c.owner_user_id = ?
         ORDER BY c.contact_name ASC, c.contact_email ASC`,
        [req.v2Auth.userId]
      ),
      db.all(
        `SELECT u.id, u.email, u.display_name, m.role, m.created_at
         FROM v2_org_members m
         JOIN v2_users u ON u.id = m.user_id
         WHERE m.org_id = ? AND m.user_id != ?
         ORDER BY u.display_name ASC, u.email ASC`,
        [req.v2Auth.orgId, req.v2Auth.userId]
      ),
    ]);

    const teamByEmail = new Map(
      teamRows.map((t) => [String(t.email || '').toLowerCase(), t])
    );
    const seenEmails = new Set();
    const contacts = [];

    // 1. Include all workspace teammates first (Team Directory)
    for (const tm of teamRows) {
      const emailKey = String(tm.email || '').toLowerCase();
      if (!emailKey) continue;
      const savedMatch = savedRows.find(
        (s) => String(s.contact_email || '').toLowerCase() === emailKey
      );
      seenEmails.add(emailKey);
      contacts.push({
        id: savedMatch ? savedMatch.id : `teammate:${tm.id}`,
        email: tm.email,
        name:
          savedMatch?.contact_name ||
          tm.display_name ||
          tm.email.split('@')[0],
        preferredLanguage: savedMatch?.preferred_language || null,
        contactUserId: tm.id,
        hasAccount: true,
        isTeammate: true,
        teamRole: tm.role,
        isSavedContact: Boolean(savedMatch),
        createdAt: savedMatch?.created_at || tm.created_at,
      });
    }

    // 2. Append the user's personal/external saved contacts
    for (const r of savedRows) {
      const emailKey = String(r.contact_email || '').toLowerCase();
      if (seenEmails.has(emailKey)) continue;
      seenEmails.add(emailKey);
      contacts.push({
        id: r.id,
        email: r.contact_email,
        name: r.contact_name || r.matched_display_name || r.contact_email.split('@')[0],
        preferredLanguage: r.preferred_language || null,
        contactUserId: r.matched_user_id || null,
        hasAccount: Boolean(r.matched_user_id),
        isTeammate: teamByEmail.has(emailKey),
        isSavedContact: true,
        createdAt: r.created_at,
      });
    }

    res.json({ contacts });
  } catch (e) {
    console.error('[v2/contacts GET]', e);
    res.status(500).json({ error: 'Failed to load contacts' });
  }
});

router.post('/contacts', requireV2Auth, async (req, res) => {
  try {
    const { email, name, preferredLanguage } = req.body || {};
    const normEmail = normalizeEmail(email);
    if (!normEmail || !isValidEmail(normEmail)) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    const contact = await upsertContactForUser({
      ownerUserId: req.v2Auth.userId,
      email: normEmail,
      name,
      preferredLanguage,
    });

    res.status(201).json({ contact });
  } catch (e) {
    console.error('[v2/contacts POST]', e);
    res.status(500).json({ error: 'Failed to save contact' });
  }
});

router.delete('/contacts/:id', requireV2Auth, async (req, res) => {
  try {
    const r = await db.run(
      `DELETE FROM v2_contacts WHERE id = ? AND owner_user_id = ?`,
      [req.params.id, req.v2Auth.userId]
    );
    if (!r.changes) return res.status(404).json({ error: 'Contact not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[v2/contacts DELETE]', e);
    res.status(500).json({ error: 'Failed to remove contact' });
  }
});

// ---------------------------------------------------------------------------
// Direct Call & In-Call Ringing endpoints (/api/v2/calls)
// ---------------------------------------------------------------------------

router.post('/calls/start', requireV2Auth, async (req, res) => {
  try {
    const { contactId, email, name, preferredLanguage, meetingId, roomName: existingRoomName } =
      req.body || {};

    let targetContact = null;
    if (contactId && String(contactId).startsWith('teammate:')) {
      const tmUserId = String(contactId).slice('teammate:'.length);
      const tmUser = await db.get(
        `SELECT u.id, u.email, u.display_name
         FROM v2_org_members m
         JOIN v2_users u ON u.id = m.user_id
         WHERE m.org_id = ? AND u.id = ?`,
        [req.v2Auth.orgId, tmUserId]
      );
      if (!tmUser) return res.status(404).json({ error: 'Teammate not found' });
      targetContact = {
        id: `teammate:${tmUser.id}`,
        email: tmUser.email,
        name: tmUser.display_name || tmUser.email.split('@')[0],
        preferredLanguage: null,
        contactUserId: tmUser.id,
        hasAccount: true,
        isTeammate: true,
      };
    } else if (contactId) {
      const row = await db.get(
        `SELECT * FROM v2_contacts WHERE id = ? AND owner_user_id = ?`,
        [String(contactId), req.v2Auth.userId]
      );
      if (!row) return res.status(404).json({ error: 'Contact not found' });
      targetContact = await upsertContactForUser({
        ownerUserId: req.v2Auth.userId,
        email: row.contact_email,
        name: row.contact_name,
        preferredLanguage: row.preferred_language,
      });
    } else {
      const normEmail = normalizeEmail(email);
      if (!normEmail || !isValidEmail(normEmail)) {
        return res.status(400).json({ error: 'Valid contact or email is required to place a call' });
      }
      targetContact = await upsertContactForUser({
        ownerUserId: req.v2Auth.userId,
        email: normEmail,
        name,
        preferredLanguage,
      });
    }

    const caller = await db.get(
      `SELECT id, email, display_name FROM v2_users WHERE id = ?`,
      [req.v2Auth.userId]
    );
    const callerName =
      caller?.display_name || caller?.email?.split('@')[0] || 'Lalia Host';

    const base = publicFrontendBaseUrl(req);
    let meetingInfo = null;

    if (meetingId || existingRoomName) {
      // Ringing a contact into an already-active call/meeting!
      const existingMeeting = await db.get(
        `SELECT * FROM v2_meetings WHERE (id = ? OR livekit_room_name = ?) AND org_id = ? LIMIT 1`,
        [meetingId || '', existingRoomName || '', req.v2Auth.orgId]
      );
      if (!existingMeeting) {
        return res.status(404).json({ error: 'Active meeting not found' });
      }
      const inviteToken = await ensureReusableInviteToken(existingMeeting);
      const joinUrl = `${base}/join/${encodeURIComponent(existingMeeting.livekit_room_name)}?i=${encodeURIComponent(inviteToken)}`;
      meetingInfo = {
        id: existingMeeting.id,
        livekitRoomName: existingMeeting.livekit_room_name,
        hostCode: existingMeeting.host_code,
        joinUrl,
        title: existingMeeting.title || `Call with ${targetContact.name}`,
      };
    } else {
      // Starting a brand-new 1-on-1 call (which is a full conference room under the hood so more people can be added anytime)
      const gate = await assertCanCreateMeeting(req.v2Auth.orgId);
      if (!gate.ok) {
        return res.status(403).json({ error: gate.reason, code: gate.code, details: gate });
      }

      const newRoomName = `v2-${db.uuid().replace(/-/g, '').slice(0, 12)}-${Date.now().toString(36)}`;
      await createLiveKitConferenceRoom(newRoomName, 'multi-language', req.v2Auth.orgId);
      const hostCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      const now = new Date().toISOString();
      const newMeetingId = db.uuid();
      const callTitle = `Call with ${targetContact.name}`;

      await db.run(
        `INSERT INTO v2_meetings (id, org_id, host_user_id, livekit_room_name, title, status, scheduled_start, scheduled_end, host_code, started_at, metadata, host_present)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          newMeetingId,
          req.v2Auth.orgId,
          req.v2Auth.userId,
          newRoomName,
          callTitle,
          'live',
          null,
          null,
          hostCode,
          now,
          JSON.stringify({ source: 'v2_direct_call', calleeEmail: targetContact.email }),
          1,
        ]
      );
      await db.run(
        `INSERT INTO v2_meeting_policies (meeting_id, host_required_to_start, require_invite_token, store_transcripts)
         VALUES (?,?,?,?)`,
        [newMeetingId, 0, 1, 1]
      );

      const linkId = db.uuid();
      const inviteToken = crypto.randomBytes(18).toString('base64url');
      const expiryMode = defaultExpiryModeForMeeting({ scheduled_start: null });
      const expiresAt = computeInviteExpiresAt({ scheduled_start: null, scheduled_end: null }, { mode: expiryMode });
      await db.run(
        `INSERT INTO v2_meeting_invite_links (id, meeting_id, token, label, expires_at, revoked_at, reusable, use_count, max_uses, expiry_mode)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [linkId, newMeetingId, inviteToken, 'Default guest link', expiresAt, null, 1, 0, null, expiryMode]
      );

      const joinUrl = `${base}/join/${encodeURIComponent(newRoomName)}?i=${encodeURIComponent(inviteToken)}`;
      meetingInfo = {
        id: newMeetingId,
        livekitRoomName: newRoomName,
        hostCode,
        joinUrl,
        title: callTitle,
      };
    }

    const callId = db.uuid();
    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + CALL_RING_TTL_MS).toISOString();

    await db.run(
      `INSERT INTO v2_direct_calls (
         id, caller_user_id, caller_name, caller_email,
         callee_user_id, callee_email, callee_name,
         meeting_id, room_name, join_url, status,
         created_at, updated_at, expires_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        callId,
        req.v2Auth.userId,
        callerName,
        caller?.email || null,
        targetContact.contactUserId || null,
        targetContact.email,
        targetContact.name,
        meetingInfo.id,
        meetingInfo.livekitRoomName,
        meetingInfo.joinUrl,
        'ringing',
        nowIso,
        nowIso,
        expiresIso,
      ]
    );

    sendDirectCallEmailAsync({
      toEmail: targetContact.email,
      calleeName: targetContact.name,
      callerName,
      joinUrl: meetingInfo.joinUrl,
    });

    res.status(201).json({
      call: {
        id: callId,
        status: 'ringing',
        calleeEmail: targetContact.email,
        calleeName: targetContact.name,
        hasAccount: targetContact.hasAccount,
        expiresAt: expiresIso,
      },
      meeting: meetingInfo,
      contact: targetContact,
    });
  } catch (e) {
    console.error('[v2/calls/start POST]', e);
    res.status(500).json({ error: 'Failed to start call' });
  }
});

router.get('/calls/incoming', requireV2Auth, async (req, res) => {
  try {
    const user = await db.get(`SELECT id, email FROM v2_users WHERE id = ?`, [req.v2Auth.userId]);
    if (!user) return res.json({ incomingCalls: [] });

    const nowIso = new Date().toISOString();
    const rows = await db.all(
      `SELECT id, caller_user_id, caller_name, caller_email, meeting_id, room_name, join_url, status, created_at, expires_at
       FROM v2_direct_calls
       WHERE status = 'ringing'
         AND expires_at > ?
         AND (callee_user_id = ? OR LOWER(callee_email) = LOWER(?))
       ORDER BY created_at DESC
       LIMIT 5`,
      [nowIso, user.id, user.email]
    );

    res.json({
      incomingCalls: rows.map((r) => ({
        id: r.id,
        callerUserId: r.caller_user_id,
        callerName: r.caller_name,
        callerEmail: r.caller_email,
        meetingId: r.meeting_id,
        roomName: r.room_name,
        joinUrl: r.join_url,
        status: r.status,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      })),
    });
  } catch (e) {
    console.error('[v2/calls/incoming GET]', e);
    res.status(500).json({ error: 'Failed to check incoming calls' });
  }
});

router.get('/calls/history', requireV2Auth, async (req, res) => {
  try {
    const user = await db.get(`SELECT id, email FROM v2_users WHERE id = ?`, [req.v2Auth.userId]);
    if (!user) return res.json({ calls: [] });

    const nowIso = new Date().toISOString();
    // Mark any expired ringing calls involving this user as missed
    await db.run(
      `UPDATE v2_direct_calls
       SET status = 'missed', updated_at = ?
       WHERE status = 'ringing'
         AND expires_at <= ?
         AND (caller_user_id = ? OR callee_user_id = ? OR LOWER(callee_email) = LOWER(?))`,
      [nowIso, nowIso, user.id, user.id, user.email]
    );

    const rows = await db.all(
      `SELECT dc.id, dc.caller_user_id, dc.caller_name, dc.caller_email,
              dc.callee_user_id, dc.callee_name, dc.callee_email,
              dc.meeting_id, dc.room_name, dc.join_url, dc.status,
              dc.created_at, dc.updated_at, dc.expires_at,
              m.title AS meeting_title,
              (SELECT COUNT(*) FROM v2_meeting_transcript_lines t WHERE t.meeting_id = dc.meeting_id) AS transcript_line_count,
              (SELECT COUNT(*) FROM v2_meeting_transcript_reports r WHERE r.meeting_id = dc.meeting_id) AS report_count
       FROM v2_direct_calls dc
       LEFT JOIN v2_meetings m ON m.id = dc.meeting_id
       WHERE dc.caller_user_id = ?
          OR dc.callee_user_id = ?
          OR LOWER(dc.callee_email) = LOWER(?)
       ORDER BY dc.created_at DESC
       LIMIT 30`,
      [user.id, user.id, user.email]
    );

    const calls = rows.map((r) => {
      const isOutgoing = r.caller_user_id === user.id;
      const counterpartName = isOutgoing
        ? r.callee_name || r.callee_email?.split('@')[0] || 'Contact'
        : r.caller_name || r.caller_email?.split('@')[0] || 'Caller';
      const counterpartEmail = isOutgoing ? r.callee_email : r.caller_email;
      return {
        id: r.id,
        direction: isOutgoing ? 'outgoing' : 'incoming',
        status: r.status,
        counterpartName,
        counterpartEmail,
        meetingId: r.meeting_id,
        roomName: r.room_name,
        meetingTitle: r.meeting_title || `Call with ${counterpartName}`,
        transcriptLineCount: Number(r.transcript_line_count || 0),
        reportCount: Number(r.report_count || 0),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });

    res.json({ calls });
  } catch (e) {
    console.error('[v2/calls/history GET]', e);
    res.status(500).json({ error: 'Failed to load call history' });
  }
});

router.get('/calls/:id/status', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(
      `SELECT * FROM v2_direct_calls WHERE id = ? AND (caller_user_id = ? OR callee_user_id = ?)`,
      [req.params.id, req.v2Auth.userId, req.v2Auth.userId]
    );
    if (!row) return res.status(404).json({ error: 'Call not found' });

    const nowIso = new Date().toISOString();
    let effectiveStatus = row.status;
    if (effectiveStatus === 'ringing' && row.expires_at <= nowIso) {
      effectiveStatus = 'missed';
      await db.run(
        `UPDATE v2_direct_calls SET status = 'missed', updated_at = ? WHERE id = ?`,
        [nowIso, row.id]
      );
    }

    res.json({
      call: {
        id: row.id,
        status: effectiveStatus,
        calleeName: row.callee_name,
        calleeEmail: row.callee_email,
        meetingId: row.meeting_id,
        roomName: row.room_name,
        joinUrl: row.join_url,
        expiresAt: row.expires_at,
      },
    });
  } catch (e) {
    console.error('[v2/calls/:id/status GET]', e);
    res.status(500).json({ error: 'Failed to get call status' });
  }
});

router.post('/calls/:id/respond', requireV2Auth, async (req, res) => {
  try {
    const { action } = req.body || {};
    if (!['accept', 'decline', 'cancel'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const row = await db.get(`SELECT * FROM v2_direct_calls WHERE id = ?`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Call not found' });

    const user = await db.get(`SELECT id, email FROM v2_users WHERE id = ?`, [req.v2Auth.userId]);
    const isCaller = row.caller_user_id === req.v2Auth.userId;
    const isCallee =
      row.callee_user_id === req.v2Auth.userId ||
      (user?.email && normalizeEmail(user.email) === normalizeEmail(row.callee_email));

    if (!isCaller && !isCallee) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const nextStatus =
      action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'canceled';
    const nowIso = new Date().toISOString();

    await db.run(
      `UPDATE v2_direct_calls SET status = ?, updated_at = ? WHERE id = ?`,
      [nextStatus, nowIso, row.id]
    );

    res.json({
      ok: true,
      status: nextStatus,
      meetingId: row.meeting_id,
      roomName: row.room_name,
      joinUrl: row.join_url,
    });
  } catch (e) {
    console.error('[v2/calls/:id/respond POST]', e);
    res.status(500).json({ error: 'Failed to respond to call' });
  }
});

module.exports = router;
