const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { AccessToken } = require('livekit-server-sdk');
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { createLiveKitConferenceRoom, ensureRoomAndAgent, getRoomService, looksLikeAgentParticipant } = require('../../lib/livekitService');
const { assertCanCreateMeeting } = require('../../lib/v2Entitlements');
const { publicFrontendBaseUrl } = require('../../lib/publicFrontendBaseUrl');

const MS_DAY = 86400000;

/** Upper bound for any invite link lifetime (wall-clock from creation). */
function maxInviteTtlMs() {
  const days = Number(process.env.V2_MAX_INVITE_TTL_DAYS || 90);
  if (!Number.isFinite(days) || days <= 0) return 90 * MS_DAY;
  return Math.min(days, 365) * MS_DAY;
}

function clampInviteTtlMs(ms) {
  const cap = maxInviteTtlMs();
  return Math.min(Math.max(0, ms), cap);
}

function defaultInviteTtlMs() {
  const days = Number(process.env.V2_DEFAULT_INVITE_TTL_DAYS || 7);
  const desired = (Number.isFinite(days) && days > 0 ? days : 7) * MS_DAY;
  return clampInviteTtlMs(desired);
}

function defaultRequireInvite() {
  return process.env.V2_DEFAULT_REQUIRE_INVITE !== '0';
}

function inviteIsUsable(inv) {
  if (inv.revoked_at) return false;
  const exp = new Date(inv.expires_at).getTime();
  if (Number.isNaN(exp) || exp < Date.now()) return false;
  if (inv.max_uses != null && inv.use_count >= inv.max_uses) return false;
  if (!inv.reusable && inv.use_count >= 1) return false;
  return true;
}

function enrichInvitesWithJoinUrls(invites, guestJoinBase) {
  return invites.map((inv) => {
    const usable = inviteIsUsable(inv);
    const joinUrl = usable ? `${guestJoinBase}?i=${encodeURIComponent(inv.token)}` : null;
    return { ...inv, joinUrl, usable };
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

router.post('/', requireV2Auth, async (req, res) => {
  try {
    const gate = await assertCanCreateMeeting(req.v2Auth.orgId);
    if (!gate.ok) {
      return res.status(402).json({ error: gate.message, code: gate.code });
    }
    const { title, scheduled_start, scheduled_end, host_required_to_start, store_transcripts } = req.body || {};
    const hostRequired = Boolean(host_required_to_start);
    const requireInvite = defaultRequireInvite();
    const storeTr = Boolean(store_transcripts) ? 1 : 0;
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
      `INSERT INTO v2_meeting_policies (meeting_id, host_required_to_start, require_invite_token, store_transcripts) VALUES (?,?,?,?)`,
      [meetingId, hostRequired ? 1 : 0, requireInvite ? 1 : 0, storeTr]
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
    const rows = await db.all(
      `SELECT m.id, m.livekit_room_name, m.title, m.status, m.scheduled_start, m.scheduled_end, m.host_code,
              m.created_at, m.started_at, m.ended_at, m.host_present,
              IFNULL(p.host_required_to_start, 0) AS host_required_to_start,
              IFNULL(p.require_invite_token, 0) AS require_invite_token,
              IFNULL(p.store_transcripts, 0) AS store_transcripts
       FROM v2_meetings m
       LEFT JOIN v2_meeting_policies p ON p.meeting_id = m.id
       WHERE m.org_id = ? AND m.status != 'archived' ORDER BY datetime(m.created_at) DESC LIMIT 100`,
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
    const rawMs = (Number.isFinite(hours) && hours > 0 ? hours : 168) * 3600000;
    const ttlMs = clampInviteTtlMs(rawMs);
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
    res.status(201).json({
      id: linkId,
      token,
      expiresAt,
      joinUrl,
      reusable: Boolean(reusable),
      inviteMaxTtlHours: Math.floor(maxInviteTtlMs() / 3600000),
    });
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
         IFNULL(p.require_invite_token, 0) AS require_invite_token,
         IFNULL(p.store_transcripts, 0) AS store_transcripts
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
      store_transcripts: row.store_transcripts === 1,
    };
    const guestJoinBase = `${base}/join/${encodeURIComponent(row.livekit_room_name)}`;
    const invitesEnriched = enrichInvitesWithJoinUrls(invites, guestJoinBase);
    let joinUrl = guestJoinBase;
    if (policy.require_invite_token) {
      const primary =
        invitesEnriched.find((l) => l.label === 'Default guest link' && l.usable) ||
        invitesEnriched.find((l) => l.usable);
      if (primary?.joinUrl) {
        joinUrl = primary.joinUrl;
      }
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

    const { host_required_to_start, require_invite_token, store_transcripts, ...meetingRow } = row;
    res.json({
      ...meetingRow,
      policy,
      joinUrl,
      invites: invitesEnriched,
      inviteMaxTtlHours: Math.floor(maxInviteTtlMs() / 3600000),
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
    const { title, status, host_required_to_start, require_invite_token, store_transcripts } = req.body || {};
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
        await db.run(`INSERT INTO v2_meeting_policies (meeting_id, host_required_to_start, require_invite_token, store_transcripts) VALUES (?,?,?,?)`, [
          req.params.id,
          hr !== null ? hr : 0,
          ri !== null ? ri : defaultRequireInvite() ? 1 : 0,
          0,
        ]);
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
          [req.params.id, 0, defaultRequireInvite() ? 1 : 0, st]
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
