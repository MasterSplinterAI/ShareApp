const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { AccessToken } = require('livekit-server-sdk');
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { createLiveKitConferenceRoom, ensureRoomAndAgent, getRoomService, looksLikeAgentParticipant } = require('../../lib/livekitService');
const { assertCanCreateMeeting } = require('../../lib/v2Entitlements');
const { publicFrontendBaseUrl } = require('../../lib/publicFrontendBaseUrl');
const { listTemplates, instructionsHash, synthesizeTranscript } = require('../../lib/transcriptSynthesis');
const {
  maxInviteTtlMs,
  defaultExpiryModeForMeeting,
  computeInviteExpiresAt,
  inviteIsUsable,
  guestAccessActive,
  describeInviteExpiry,
  expiryModeLabel,
  linkTypeLabel,
  parseCreateInviteBody,
} = require('../../lib/inviteExpiry');

function enrichInvitesWithJoinUrls(invites, guestJoinBase, meeting) {
  return invites.map((inv) => {
    const usable = inviteIsUsable(inv, meeting);
    const joinUrl = usable ? `${guestJoinBase}?i=${encodeURIComponent(inv.token)}` : null;
    const expiry = describeInviteExpiry(inv, meeting);
    return {
      ...inv,
      joinUrl,
      usable,
      expiryLabel: expiry.short,
      expiryDetail: expiry.detail,
      expiryModeLabel: expiryModeLabel(inv.expiry_mode),
      linkTypeLabel: linkTypeLabel(Boolean(inv.reusable)),
    };
  });
}

function transcriptDedupeKey(meetingId, transcriptionId, language, originalText) {
  const h = crypto.createHash('sha256').update(String(originalText || '')).digest('hex').slice(0, 32);
  return `${meetingId}|${transcriptionId || 'na'}|${language || 'en'}|${h}`;
}

async function assertMeetingAccess(row, auth) {
  if (!row) return false;
  if (row.host_user_id === auth.userId) return true;
  if (['owner', 'admin'].includes(auth.role)) return true;
  return false;
}

/** Secure invite links are always required — upgrade legacy meetings and ensure a default link exists. */
async function ensureSecureInviteForMeeting(meetingRow) {
  const meetingId = meetingRow.id;
  const pol = await db.get(`SELECT * FROM v2_meeting_policies WHERE meeting_id = ?`, [meetingId]);
  if (!pol || pol.require_invite_token !== 1) {
    if (pol) {
      await db.run(`UPDATE v2_meeting_policies SET require_invite_token = 1 WHERE meeting_id = ?`, [meetingId]);
    } else {
      await db.run(
        `INSERT INTO v2_meeting_policies (meeting_id, host_required_to_start, require_invite_token, store_transcripts) VALUES (?,?,?,?)`,
        [meetingId, meetingRow.host_required_to_start ? 1 : 0, 1, meetingRow.store_transcripts === false || meetingRow.store_transcripts === 0 ? 0 : 1]
      );
    }
  }
  const active = await db.get(
    `SELECT id FROM v2_meeting_invite_links WHERE meeting_id = ? AND revoked_at IS NULL LIMIT 1`,
    [meetingId]
  );
  if (active) return;
  const linkId = db.uuid();
  const token = crypto.randomBytes(18).toString('base64url');
  const expiryMode = defaultExpiryModeForMeeting(meetingRow);
  const expiresAt = computeInviteExpiresAt(meetingRow, { mode: expiryMode });
  await db.run(
    `INSERT INTO v2_meeting_invite_links (id, meeting_id, token, label, expires_at, revoked_at, reusable, use_count, max_uses, expiry_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [linkId, meetingId, token, 'Default guest link', expiresAt, null, 1, 0, null, expiryMode]
  );
}

router.post('/', requireV2Auth, async (req, res) => {
  try {
    const gate = await assertCanCreateMeeting(req.v2Auth.orgId);
    if (!gate.ok) {
      return res.status(402).json({ error: gate.message, code: gate.code });
    }
    const { title, scheduled_start, scheduled_end, host_required_to_start, store_transcripts } = req.body || {};
    const hostRequired = Boolean(host_required_to_start);
    const requireInvite = true;
    const storeTr = store_transcripts === false ? 0 : 1;
    const roomName = `v2-${db.uuid().replace(/-/g, '').slice(0, 12)}-${Date.now().toString(36)}`;
    await createLiveKitConferenceRoom(roomName, 'multi-language', req.v2Auth.orgId);
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
      `INSERT INTO v2_meeting_policies (meeting_id, host_required_to_start, require_invite_token, store_transcripts) VALUES (?,?,?,?)`,
      [meetingId, hostRequired ? 1 : 0, requireInvite ? 1 : 0, storeTr]
    );

    let defaultInviteToken = null;
    let defaultInviteExpiresAt = null;
    const linkId = db.uuid();
    defaultInviteToken = crypto.randomBytes(18).toString('base64url');
    defaultInviteExpiresAt = computeInviteExpiresAt(
      { scheduled_start: scheduled_start || null, scheduled_end: scheduled_end || null },
      { mode: defaultExpiryModeForMeeting({ scheduled_start: scheduled_start || null }) }
    );
    const defaultExpiryMode = defaultExpiryModeForMeeting({ scheduled_start: scheduled_start || null });
    await db.run(
      `INSERT INTO v2_meeting_invite_links (id, meeting_id, token, label, expires_at, revoked_at, reusable, use_count, max_uses, expiry_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [linkId, meetingId, defaultInviteToken, 'Default guest link', defaultInviteExpiresAt, null, 1, 0, null, defaultExpiryMode]
    );

    const base = publicFrontendBaseUrl(req);
    const guestPath = `${base}/join/${encodeURIComponent(roomName)}?i=${encodeURIComponent(defaultInviteToken)}`;
    res.status(201).json({
      id: meetingId,
      livekitRoomName: roomName,
      hostCode,
      status,
      joinUrl: guestPath,
      title: title || 'Meeting',
      policy: { host_required_to_start: hostRequired, require_invite_token: requireInvite, store_transcripts: storeTr === 1 },
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
    const archivedOnly = req.query.archived === '1' || req.query.status === 'archived';
    const statusClause = archivedOnly ? `m.status = 'archived'` : `m.status != 'archived'`;
    const rows = await db.all(
      `SELECT m.id, m.livekit_room_name, m.title, m.status, m.scheduled_start, m.scheduled_end, m.host_code,
              m.created_at, m.started_at, m.ended_at, m.host_present,
              IFNULL(p.host_required_to_start, 0) AS host_required_to_start,
              IFNULL(p.require_invite_token, 0) AS require_invite_token,
              IFNULL(p.store_transcripts, 0) AS store_transcripts,
              (SELECT COUNT(*) FROM v2_meeting_transcript_lines t WHERE t.meeting_id = m.id) AS transcript_line_count
       FROM v2_meetings m
       LEFT JOIN v2_meeting_policies p ON p.meeting_id = m.id
       WHERE m.org_id = ? AND ${statusClause} ORDER BY datetime(m.created_at) DESC LIMIT 100`,
      [req.v2Auth.orgId]
    );

    // Enrich live/scheduled meetings with room presence (best-effort)
    const liveMeetings = rows.filter((m) => m.status === 'live' || m.status === 'scheduled');
    if (liveMeetings.length > 0) {
      try {
        const roomService = getRoomService();
        await Promise.all(liveMeetings.map(async (m) => {
          try {
            const lp = await roomService.listParticipants(m.livekit_room_name);
            const humans = (lp || []).filter((p) => !looksLikeAgentParticipant(p));
            m.room_human_count = humans.length;
          } catch {
            m.room_human_count = 0;
          }
        }));
      } catch {
        // LiveKit unreachable — leave room_human_count unset
      }
    }

    const allIds = rows.map((m) => m.id);
    if (allIds.length > 0) {
      const placeholders = allIds.map(() => '?').join(',');
      const inviteRows = await db.all(
        `SELECT meeting_id, expires_at, revoked_at, reusable, use_count, max_uses, expiry_mode
         FROM v2_meeting_invite_links
         WHERE meeting_id IN (${placeholders}) AND revoked_at IS NULL`,
        allIds
      );
      const invitesByMeeting = new Map();
      for (const inv of inviteRows) {
        const list = invitesByMeeting.get(inv.meeting_id) || [];
        list.push(inv);
        invitesByMeeting.set(inv.meeting_id, list);
      }
      for (const m of rows) {
        m.require_invite_token = 1;
        m.guestAccessActive = guestAccessActive(m, invitesByMeeting.get(m.id) || [], true);
      }
    }

    res.json({ meetings: rows, archivedOnly });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list meetings' });
  }
});

router.get('/transcript-templates', requireV2Auth, (_req, res) => {
  res.json({ templates: listTemplates() });
});

router.get('/:id/invites', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(`SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`, [req.params.id, req.v2Auth.orgId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!(await assertMeetingAccess(row, req.v2Auth))) return res.status(403).json({ error: 'Forbidden' });
    const links = await db.all(
      `SELECT id, label, expires_at, revoked_at, reusable, use_count, max_uses, expiry_mode, created_at FROM v2_meeting_invite_links WHERE meeting_id = ? ORDER BY datetime(created_at) DESC`,
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
    const { reusable, expiryMode, opts } = parseCreateInviteBody(req.body);
    const { label, maxUses } = req.body || {};
    const token = crypto.randomBytes(18).toString('base64url');
    const linkId = db.uuid();
    const expiresAt = computeInviteExpiresAt(row, opts);
    await db.run(
      `INSERT INTO v2_meeting_invite_links (id, meeting_id, token, label, expires_at, revoked_at, reusable, use_count, max_uses, expiry_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
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
        expiryMode,
      ]
    );
    const base = publicFrontendBaseUrl(req);
    const joinUrl = `${base}/join/${encodeURIComponent(row.livekit_room_name)}?i=${encodeURIComponent(token)}`;
    const invRow = {
      id: linkId,
      expires_at: expiresAt,
      expiry_mode: expiryMode,
      reusable: reusable ? 1 : 0,
      use_count: 0,
      revoked_at: null,
    };
    const expiry = describeInviteExpiry(invRow, row);
    res.status(201).json({
      id: linkId,
      token,
      expiresAt,
      expiryMode,
      expiryLabel: expiry.short,
      expiryDetail: expiry.detail,
      linkType: 'shared',
      joinUrl,
      reusable: Boolean(reusable),
      inviteMaxTtlDays: Math.floor(maxInviteTtlMs() / 86400000),
    });
  } catch (e) {
    console.error('[v2/invites POST]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/:id/invites/default', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(`SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`, [req.params.id, req.v2Auth.orgId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!(await assertMeetingAccess(row, req.v2Auth))) return res.status(403).json({ error: 'Forbidden' });

    const { expiryMode, opts } = parseCreateInviteBody(req.body);
    const expiresAt = computeInviteExpiresAt(row, opts);
    const base = publicFrontendBaseUrl(req);

    const requestedLinkId = typeof req.body?.linkId === 'string' ? req.body.linkId : null;
    let link = requestedLinkId
      ? await db.get(
          `SELECT * FROM v2_meeting_invite_links WHERE id = ? AND meeting_id = ? AND revoked_at IS NULL`,
          [requestedLinkId, req.params.id]
        )
      : null;
    if (!link) {
      link = await db.get(
        `SELECT * FROM v2_meeting_invite_links
         WHERE meeting_id = ? AND label = 'Default guest link' AND revoked_at IS NULL
         ORDER BY datetime(created_at) DESC LIMIT 1`,
        [req.params.id]
      );
    }

    if (link) {
      await db.run(
        `UPDATE v2_meeting_invite_links
         SET expires_at = ?, expiry_mode = ?, reusable = 1, max_uses = NULL
         WHERE id = ?`,
        [expiresAt, expiryMode, link.id]
      );
      link = { ...link, expires_at: expiresAt, expiry_mode: expiryMode, reusable: 1, max_uses: null };
    } else {
      const token = crypto.randomBytes(18).toString('base64url');
      const linkId = db.uuid();
      await db.run(
        `INSERT INTO v2_meeting_invite_links (id, meeting_id, token, label, expires_at, revoked_at, reusable, use_count, max_uses, expiry_mode)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [linkId, req.params.id, token, 'Default guest link', expiresAt, null, 1, 0, null, expiryMode]
      );
      link = {
        id: linkId,
        token,
        label: 'Default guest link',
        expires_at: expiresAt,
        expiry_mode: expiryMode,
        reusable: 1,
        use_count: 0,
        max_uses: null,
        revoked_at: null,
      };
    }

    const joinUrl = `${base}/join/${encodeURIComponent(row.livekit_room_name)}?i=${encodeURIComponent(link.token)}`;
    const expiry = describeInviteExpiry(link, row);
    res.json({
      ok: true,
      id: link.id,
      expiresAt,
      expiryMode,
      expiryLabel: expiry.short,
      expiryDetail: expiry.detail,
      joinUrl,
    });
  } catch (e) {
    console.error('[v2/invites default PATCH]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/:id/invites/email', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(`SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`, [req.params.id, req.v2Auth.orgId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!(await assertMeetingAccess(row, req.v2Auth))) return res.status(403).json({ error: 'Forbidden' });
    const guests = await db.all(
      `SELECT id, email, sent_at, reminder_sent_at, reminders_sent_json, created_at
       FROM v2_meeting_guest_invites WHERE meeting_id = ? ORDER BY datetime(created_at) DESC LIMIT 100`,
      [req.params.id]
    );
    const { getMeetingInviteEmailSettings, parseRemindersSent } = require('../../lib/guestInviteReminderPrefs');
    const settings = await getMeetingInviteEmailSettings(req.params.id, req.v2Auth.userId);
    res.json({
      guests: guests.map((g) => ({
        ...g,
        reminders_sent: parseRemindersSent(g),
      })),
      settings,
    });
  } catch (e) {
    console.error('[v2/invites/email GET]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.patch('/:id/invites/reminder-settings', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(`SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`, [req.params.id, req.v2Auth.orgId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!(await assertMeetingAccess(row, req.v2Auth))) return res.status(403).json({ error: 'Forbidden' });

    const { offsetsToJson, normalizeOffsets, getMeetingInviteEmailSettings } = require('../../lib/guestInviteReminderPrefs');
    const { useAccountDefaults, reminderOffsets } = req.body || {};

    if (useAccountDefaults) {
      await db.run(`UPDATE v2_meetings SET guest_invite_reminder_offsets_json = NULL WHERE id = ?`, [req.params.id]);
    } else if (reminderOffsets !== undefined) {
      const normalized = normalizeOffsets(reminderOffsets);
      if (!normalized?.length) {
        return res.status(400).json({ error: 'At least one valid reminder offset is required (5 minutes to 7 days before)' });
      }
      await db.run(`UPDATE v2_meetings SET guest_invite_reminder_offsets_json = ? WHERE id = ?`, [
        offsetsToJson(normalized),
        req.params.id,
      ]);
    } else {
      return res.status(400).json({ error: 'Provide useAccountDefaults or reminderOffsets' });
    }

    const settings = await getMeetingInviteEmailSettings(req.params.id, req.v2Auth.userId);
    res.json({ ok: true, settings });
  } catch (e) {
    console.error('[v2/invites/reminder-settings PATCH]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/:id/invites/email', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(`SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`, [req.params.id, req.v2Auth.orgId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!(await assertMeetingAccess(row, req.v2Auth))) return res.status(403).json({ error: 'Forbidden' });

    const raw = Array.isArray(req.body?.emails) ? req.body.emails : [];
    const emails = [...new Set(raw.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    const valid = emails.filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (!valid.length) return res.status(400).json({ error: 'At least one valid email is required' });

    // Reuse the best usable reusable link, or mint one valid through the meeting.
    let link = await db.get(
      `SELECT * FROM v2_meeting_invite_links
       WHERE meeting_id = ? AND revoked_at IS NULL AND reusable = 1 AND datetime(expires_at) > datetime('now')
       ORDER BY datetime(expires_at) DESC LIMIT 1`,
      [req.params.id]
    );
    if (!link) {
      const token = crypto.randomBytes(18).toString('base64url');
      const linkId = db.uuid();
      const expiresAt = computeInviteExpiresAt(row, {
        mode: defaultExpiryModeForMeeting(row),
      });
      const emailExpiryMode = defaultExpiryModeForMeeting(row);
      await db.run(
        `INSERT INTO v2_meeting_invite_links (id, meeting_id, token, label, expires_at, revoked_at, reusable, use_count, max_uses, expiry_mode)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [linkId, req.params.id, token, 'Email invite link', expiresAt, null, 1, 0, null, emailExpiryMode]
      );
      link = { id: linkId, token };
    }

    const { sendGuestInvite } = require('../../lib/guestInvites');
    const { getGuestInvitePrefs } = require('../../lib/guestInviteReminderPrefs');
    const { isMailerConfigured } = require('../../lib/v2EmailSettings');
    const base = publicFrontendBaseUrl(req);
    const joinUrl = `${base}/join/${encodeURIComponent(row.livekit_room_name)}?i=${encodeURIComponent(link.token)}`;
    const inviter = await db.get(`SELECT display_name, email FROM v2_users WHERE id = ?`, [req.v2Auth.userId]);
    const invitePrefs = await getGuestInvitePrefs(req.v2Auth.userId);
    const cc =
      invitePrefs.ccHost && inviter?.email ? inviter.email : undefined;

    const results = [];
    for (const email of valid) {
      const sendResult = await sendGuestInvite({
        email,
        meetingTitle: row.title || 'Meeting',
        scheduledStart: row.scheduled_start,
        scheduledEnd: row.scheduled_end,
        joinUrl,
        inviterName: inviter?.display_name || inviter?.email,
        meetingId: req.params.id,
        timeZone: invitePrefs.timezone,
        cc,
      });
      await db.run(
        `INSERT INTO v2_meeting_guest_invites (id, meeting_id, invite_link_id, email, invited_by, sent_at)
         VALUES (?,?,?,?,?,?)`,
        [db.uuid(), req.params.id, link.id, email, req.v2Auth.userId, sendResult?.sent ? new Date().toISOString() : null]
      );
      results.push({ email, sent: Boolean(sendResult?.sent), error: sendResult?.error || undefined });
    }

    const anySent = results.some((r) => r.sent);
    const configured = await isMailerConfigured();
    const firstError = results.find((r) => r.error)?.error;
    let message;
    if (!anySent) {
      if (!configured) {
        message =
          'Invites recorded, but email delivery is not configured on this server yet — share the link directly.';
      } else if (firstError) {
        message = `Email could not be sent: ${firstError}`;
      } else {
        message = 'Invites recorded, but email delivery failed — share the link directly.';
      }
    }
    res.status(201).json({
      ok: true,
      results,
      joinUrl,
      mailerConfigured: configured,
      message,
    });
  } catch (e) {
    console.error('[v2/invites/email POST]', e);
    res.status(500).json({ error: 'Failed to send invites' });
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
         IFNULL(p.require_invite_token, 0) AS require_invite_token,
         IFNULL(p.store_transcripts, 0) AS store_transcripts
       FROM v2_meetings m
       LEFT JOIN v2_meeting_policies p ON p.meeting_id = m.id
       WHERE m.id = ? AND m.org_id = ?`,
      [req.params.id, req.v2Auth.orgId]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    await ensureSecureInviteForMeeting(row);
    const base = publicFrontendBaseUrl(req);
    const invites = await db.all(
      `SELECT id, label, expires_at, revoked_at, reusable, use_count, max_uses, expiry_mode, created_at, token FROM v2_meeting_invite_links WHERE meeting_id = ? ORDER BY datetime(created_at) DESC`,
      [req.params.id]
    );
    const policy = {
      host_required_to_start: row.host_required_to_start === 1,
      require_invite_token: true,
      store_transcripts: row.store_transcripts === 1,
    };
    const guestJoinBase = `${base}/join/${encodeURIComponent(row.livekit_room_name)}`;
    const invitesEnriched = enrichInvitesWithJoinUrls(invites, guestJoinBase, row);
    let joinUrl = guestJoinBase;
    let guestLinkMeta = null;
    const primary =
      invitesEnriched.find((l) => l.label === 'Default guest link' && l.usable) ||
      invitesEnriched.find((l) => l.usable);
    if (primary?.joinUrl) {
      joinUrl = primary.joinUrl;
      guestLinkMeta = {
        id: primary.id,
        label: primary.label,
        expiryLabel: primary.expiryLabel,
        expiryDetail: primary.expiryDetail,
        expiryMode: primary.expiry_mode,
        expiryModeLabel: primary.expiryModeLabel,
        linkTypeLabel: primary.linkTypeLabel,
        expiresAt: primary.expires_at,
        reusable: Boolean(primary.reusable),
      };
    }
    let roomPresence = { humanCount: 0, participants: [] };
    try {
      const roomService = getRoomService();
      const lp = await roomService.listParticipants(row.livekit_room_name);
      const humans = (lp || []).filter((p) => !looksLikeAgentParticipant(p));
      roomPresence = {
        humanCount: humans.length,
        participants: humans.map((p) => ({
          identity: p.identity,
          name: p.name || p.identity || '',
        })),
      };
    } catch (e) {
      console.warn('[v2/meetings/:id] listParticipants:', e.message);
    }
    const tr = await db.get(`SELECT COUNT(*) AS c FROM v2_meeting_transcript_lines WHERE meeting_id = ?`, [req.params.id]);
    const transcriptLineCount = tr && Number.isFinite(Number(tr.c)) ? Number(tr.c) : 0;

    const guestAccessActiveFlag = guestAccessActive(row, invites, true);
    const { host_required_to_start, require_invite_token, store_transcripts, ...meetingRow } = row;
    res.json({
      ...meetingRow,
      policy,
      joinUrl,
      guestLinkMeta,
      guestAccessActive: guestAccessActiveFlag,
      invites: invitesEnriched,
      inviteMaxTtlDays: Math.floor(maxInviteTtlMs() / 86400000),
      defaultExpiryMode: defaultExpiryModeForMeeting(row),
      roomPresence,
      transcriptLineCount,
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
    const { title, status, host_required_to_start, store_transcripts } = req.body || {};
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
    if (host_required_to_start !== undefined) {
      const pol = await db.get(`SELECT meeting_id FROM v2_meeting_policies WHERE meeting_id = ?`, [req.params.id]);
      const hr = host_required_to_start ? 1 : 0;
      if (pol) {
        await db.run(
          `UPDATE v2_meeting_policies SET host_required_to_start = ?, require_invite_token = 1 WHERE meeting_id = ?`,
          [hr, req.params.id]
        );
      } else {
        await db.run(
          `INSERT INTO v2_meeting_policies (meeting_id, host_required_to_start, require_invite_token, store_transcripts) VALUES (?,?,?,?)`,
          [req.params.id, hr, 1, 0]
        );
      }
      if (hr === 1) {
        await db.run(`UPDATE v2_meetings SET host_present = 0 WHERE id = ?`, [req.params.id]);
      }
      if (hr === 0) {
        await db.run(`UPDATE v2_meetings SET host_present = 1 WHERE id = ?`, [req.params.id]);
      }
    }
    if (store_transcripts !== undefined) {
      const st = store_transcripts ? 1 : 0;
      const pol = await db.get(`SELECT meeting_id FROM v2_meeting_policies WHERE meeting_id = ?`, [req.params.id]);
      if (pol) {
        await db.run(`UPDATE v2_meeting_policies SET store_transcripts = ? WHERE meeting_id = ?`, [st, req.params.id]);
      } else {
        await db.run(
          `INSERT INTO v2_meeting_policies (meeting_id, host_required_to_start, require_invite_token, store_transcripts) VALUES (?,?,?,?)`,
          [req.params.id, 0, 1, st]
        );
      }
    }
    const updated = await db.get(
      `SELECT m.*,
         IFNULL(p.host_required_to_start, 0) AS host_required_to_start,
         IFNULL(p.require_invite_token, 0) AS require_invite_token,
         IFNULL(p.store_transcripts, 0) AS store_transcripts
       FROM v2_meetings m
       LEFT JOIN v2_meeting_policies p ON p.meeting_id = m.id
       WHERE m.id = ?`,
      [req.params.id]
    );
    await ensureSecureInviteForMeeting(updated);
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
         IFNULL(p.require_invite_token, 0) AS require_invite_token,
         IFNULL(p.store_transcripts, 0) AS store_transcripts
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
    if (host) {
      const gate = await assertCanCreateMeeting(req.v2Auth.orgId);
      if (!gate.ok) {
        return res.status(402).json({ error: gate.message, code: gate.code });
      }
    }
    if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      return res.status(500).json({ error: 'LiveKit not configured' });
    }
    await ensureRoomAndAgent(row.livekit_room_name, 'multi-language', row.org_id);
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
    res.json({
      token,
      url: process.env.LIVEKIT_URL,
      roomName: row.livekit_room_name,
      participantName,
      isHost: host,
      policy: {
        host_required_to_start: row.host_required_to_start === 1,
        require_invite_token: row.require_invite_token === 1,
        store_transcripts: row.store_transcripts === 1,
      },
    });
  } catch (e) {
    console.error('[v2/meetings/token]', e);
    res.status(500).json({ error: 'Token failed' });
  }
});

async function loadTranscriptLines(meetingId) {
  return db.all(
    `SELECT recorded_at, participant_identity, language, source_language, original_text, translated_text, transcription_id
     FROM v2_meeting_transcript_lines WHERE meeting_id = ? ORDER BY datetime(recorded_at) ASC`,
    [meetingId]
  );
}

router.post('/:id/transcript-lines', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(
      `SELECT m.*, IFNULL(p.store_transcripts, 0) AS store_transcripts
       FROM v2_meetings m
       LEFT JOIN v2_meeting_policies p ON p.meeting_id = m.id
       WHERE m.id = ? AND m.org_id = ?`,
      [req.params.id, req.v2Auth.orgId]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!(await assertMeetingAccess(row, req.v2Auth))) return res.status(403).json({ error: 'Forbidden' });
    if (row.host_user_id !== req.v2Auth.userId && !['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Only the meeting host or an org admin can upload transcripts' });
    }
    if (!row.store_transcripts) {
      return res.status(403).json({ error: 'Transcript storage is off for this meeting', code: 'transcripts_disabled' });
    }
    const lines = req.body?.lines;
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'lines[] required' });
    }
    let inserted = 0;
    for (const L of lines.slice(0, 200)) {
      const oid = String(L.participant_identity || 'unknown').slice(0, 200);
      const orig = String(L.original_text || L.originalText || '').slice(0, 20000);
      if (!orig) continue;
      const lang = L.language != null ? String(L.language).slice(0, 32) : null;
      const srcL = L.source_language != null ? String(L.source_language).slice(0, 32) : null;
      const tr =
        L.translated_text != null || L.text != null ? String(L.translated_text || L.text || '').slice(0, 20000) : null;
      const tid = L.transcription_id != null ? String(L.transcription_id).slice(0, 200) : null;
      let recordedAt;
      try {
        recordedAt = L.recorded_at ? new Date(L.recorded_at).toISOString() : new Date().toISOString();
      } catch {
        recordedAt = new Date().toISOString();
      }
      const dedupe = transcriptDedupeKey(req.params.id, tid, lang || 'en', orig);
      const id = db.uuid();
      const r = await db.run(
        `INSERT OR IGNORE INTO v2_meeting_transcript_lines (id, meeting_id, recorded_at, participant_identity, language, source_language, original_text, translated_text, transcription_id, dedupe_key) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [id, req.params.id, recordedAt, oid, lang, srcL, orig, tr, tid, dedupe]
      );
      if (r.changes) inserted += 1;
    }
    res.json({ ok: true, inserted });
  } catch (e) {
    console.error('[v2/transcript-lines]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/:id/transcript', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(`SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`, [req.params.id, req.v2Auth.orgId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!(await assertMeetingAccess(row, req.v2Auth))) return res.status(403).json({ error: 'Forbidden' });
    const lines = await loadTranscriptLines(req.params.id);
    res.json({ meetingId: req.params.id, lines });
  } catch (e) {
    console.error('[v2/transcript GET]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/:id/transcript/reports', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(`SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`, [req.params.id, req.v2Auth.orgId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!(await assertMeetingAccess(row, req.v2Auth))) return res.status(403).json({ error: 'Forbidden' });
    const reports = await db.all(
      `SELECT id, template_id, custom_instructions, line_count, content_markdown, model, created_at
       FROM v2_meeting_transcript_reports WHERE meeting_id = ? ORDER BY datetime(created_at) DESC LIMIT 20`,
      [req.params.id]
    );
    res.json({ reports });
  } catch (e) {
    console.error('[v2/transcript/reports GET]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/:id/transcript/reports/:reportId/export', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(`SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`, [req.params.id, req.v2Auth.orgId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!(await assertMeetingAccess(row, req.v2Auth))) return res.status(403).json({ error: 'Forbidden' });
    const report = await db.get(
      `SELECT * FROM v2_meeting_transcript_reports WHERE id = ? AND meeting_id = ?`,
      [req.params.reportId, req.params.id]
    );
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const { reportToPdfBuffer, reportToMarkdown, templateLabel, safeFilename } = require('../../lib/reportExport');
    const org = await db.get(`SELECT name FROM v2_organizations WHERE id = ?`, [req.v2Auth.orgId]);
    const base = safeFilename(`${row.title || 'meeting'}-${templateLabel(report.template_id)}`);
    const format = String(req.query.format || 'pdf').toLowerCase();

    if (format === 'md' || format === 'markdown') {
      const md = reportToMarkdown({ report, meetingTitle: row.title, orgName: org?.name });
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.md"`);
      return res.send(md);
    }
    const pdf = await reportToPdfBuffer({ report, meetingTitle: row.title, orgName: org?.name });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
    return res.send(pdf);
  } catch (e) {
    console.error('[v2/transcript/reports export]', e);
    res.status(500).json({ error: 'Export failed' });
  }
});

router.post('/:id/transcript/reports/:reportId/email', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(`SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`, [req.params.id, req.v2Auth.orgId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!(await assertMeetingAccess(row, req.v2Auth))) return res.status(403).json({ error: 'Forbidden' });
    const report = await db.get(
      `SELECT * FROM v2_meeting_transcript_reports WHERE id = ? AND meeting_id = ?`,
      [req.params.reportId, req.params.id]
    );
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const to = String(req.body?.to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ error: 'Valid recipient email required' });
    }

    const { reportToPdfBuffer, reportToMarkdown, templateLabel, safeFilename } = require('../../lib/reportExport');
    const { sendEmail } = require('../../lib/mailer');
    const { isMailerConfigured } = require('../../lib/v2EmailSettings');
    const { renderTranscriptReport } = require('../../lib/emailTemplates');
    const org = await db.get(`SELECT name FROM v2_organizations WHERE id = ?`, [req.v2Auth.orgId]);
    const pdf = await reportToPdfBuffer({ report, meetingTitle: row.title, orgName: org?.name });
    const md = reportToMarkdown({ report, meetingTitle: row.title, orgName: org?.name });
    const label = templateLabel(report.template_id);
    const base = safeFilename(`${row.title || 'meeting'}-${label}`);
    const email = renderTranscriptReport({
      meetingTitle: row.title,
      label,
      orgName: org?.name,
      summaryExcerpt: md,
    });

    const result = await sendEmail({
      to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      attachments: [
        { filename: `${base}.pdf`, content: pdf.toString('base64') },
      ],
    });
    if (!result?.sent) {
      return res.status(503).json({
        error: 'email_not_configured',
        message: 'Email delivery is not configured on this server yet. Download the PDF instead.',
      });
    }
    res.json({ ok: true, to });
  } catch (e) {
    console.error('[v2/transcript/reports email]', e);
    res.status(500).json({ error: 'Email failed' });
  }
});

router.post('/:id/transcript/synthesize', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(`SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`, [req.params.id, req.v2Auth.orgId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!(await assertMeetingAccess(row, req.v2Auth))) return res.status(403).json({ error: 'Forbidden' });

    const { templateId, customInstructions, regenerate } = req.body || {};
    const tid = templateId && String(templateId).slice(0, 64);
    if (!tid || !listTemplates().some((t) => t.id === tid)) {
      return res.status(400).json({ error: 'Invalid templateId' });
    }

    const lines = await loadTranscriptLines(req.params.id);
    if (!lines.length) {
      return res.status(400).json({ error: 'No transcript lines saved for this meeting' });
    }

    const custom = customInstructions != null ? String(customInstructions).trim().slice(0, 1000) : '';
    const hash = instructionsHash(tid, custom, lines.length);

    if (!regenerate) {
      const cached = await db.get(
        `SELECT id, template_id, custom_instructions, line_count, content_markdown, model, created_at
         FROM v2_meeting_transcript_reports WHERE meeting_id = ? AND instructions_hash = ? ORDER BY datetime(created_at) DESC LIMIT 1`,
        [req.params.id, hash]
      );
      if (cached) {
        return res.json({ report: cached, cached: true });
      }
    }

    let result;
    try {
      result = await synthesizeTranscript({
        templateId: tid,
        customInstructions: custom,
        lines,
        meetingTitle: row.title,
      });
    } catch (e) {
      const msg = e.message || 'Synthesis failed';
      if (msg.includes('TRANSLATION_API_KEY')) {
        return res.status(503).json({ error: 'AI synthesis is not configured on this server' });
      }
      console.error('[v2/transcript/synthesize]', e);
      return res.status(502).json({ error: msg });
    }

    const reportId = db.uuid();
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO v2_meeting_transcript_reports (id, meeting_id, template_id, custom_instructions, instructions_hash, line_count, content_markdown, model, input_tokens, output_tokens, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        reportId,
        req.params.id,
        tid,
        custom || null,
        hash,
        lines.length,
        result.markdown,
        result.model,
        result.inputTokens,
        result.outputTokens,
        now,
      ]
    );

    res.status(201).json({
      report: {
        id: reportId,
        template_id: tid,
        custom_instructions: custom || null,
        line_count: lines.length,
        content_markdown: result.markdown,
        model: result.model,
        created_at: now,
      },
      cached: false,
    });
  } catch (e) {
    console.error('[v2/transcript/synthesize]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

router.delete('/:id', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(`SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`, [req.params.id, req.v2Auth.orgId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!(await assertMeetingAccess(row, req.v2Auth))) return res.status(403).json({ error: 'Forbidden' });

    const meetingId = req.params.id;
    await db.run(`DELETE FROM v2_meeting_transcript_reports WHERE meeting_id = ?`, [meetingId]);
    await db.run(`DELETE FROM v2_meeting_transcript_lines WHERE meeting_id = ?`, [meetingId]);
    await db.run(`DELETE FROM v2_meeting_invite_links WHERE meeting_id = ?`, [meetingId]);
    await db.run(`DELETE FROM v2_meeting_policies WHERE meeting_id = ?`, [meetingId]);
    await db.run(`DELETE FROM v2_meetings WHERE id = ?`, [meetingId]);

    res.json({ ok: true, deleted: meetingId });
  } catch (e) {
    console.error('[v2/meetings DELETE]', e);
    res.status(500).json({ error: 'Failed to delete meeting' });
  }
});

router.get('/:id/transcript.txt', requireV2Auth, async (req, res) => {
  try {
    const row = await db.get(`SELECT * FROM v2_meetings WHERE id = ? AND org_id = ?`, [req.params.id, req.v2Auth.orgId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!(await assertMeetingAccess(row, req.v2Auth))) return res.status(403).json({ error: 'Forbidden' });
    const lines = await loadTranscriptLines(req.params.id);
    const parts = lines.map((l) => {
      const ts = l.recorded_at || '';
      const who = l.participant_identity || '';
      const body = [l.original_text, l.translated_text ? ` / ${l.translated_text}` : ''].join('');
      return `[${ts}] ${who}: ${body}`;
    });
    const txt = parts.join('\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="meeting-${req.params.id}-transcript.txt"`);
    res.send(txt);
  } catch (e) {
    console.error('[v2/transcript.txt]', e);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
