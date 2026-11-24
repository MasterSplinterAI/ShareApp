const crypto = require('crypto');
const db = require('../db/v2Database');
const { synthesizeTranscript, instructionsHash } = require('./transcriptSynthesis');
const { reportToPdfBuffer, safeFilename, templateLabel } = require('./reportExport');
const { renderTranscriptReport } = require('./emailTemplates/transcriptReport');
const { sendEmail } = require('./mailer');
const { translateText } = require('./textTranslate');
const { platformDisplayName } = require('./externalMeetingUrls');

const LANGUAGE_NAMES = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  zh: 'Chinese',
  'zh-CN': 'Mandarin Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  ar: 'Arabic',
  hi: 'Hindi',
  ru: 'Russian',
};

function playbackSigningSecret() {
  return (
    process.env.RECORDING_TOKEN_SECRET ||
    process.env.JWT_SECRET_V2 ||
    process.env.JWT_SECRET ||
    process.env.V2_JWT_SECRET ||
    'lalia-dev-recording-secret'
  );
}

/**
 * Short-lived HMAC token so HTML5 <audio src="..."> can stream & seek (HTTP Range)
 * without needing custom Authorization headers.
 */
function mintRecordingPlaybackToken({ meetingId, orgId, recordingId, ttlSeconds = 6 * 3600 }) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = Buffer.from(
    JSON.stringify({ mid: meetingId, oid: orgId, rid: recordingId, exp }),
    'utf8'
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', playbackSigningSecret())
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifyRecordingPlaybackToken(token, expectedMeetingId) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expectedSig = crypto
    .createHmac('sha256', playbackSigningSecret())
    .update(payload)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed?.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    if (expectedMeetingId && parsed.mid !== expectedMeetingId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function transcriptDedupeKey(meetingId, transcriptionId, language, originalText) {
  const h = crypto
    .createHash('sha256')
    .update(String(originalText || ''))
    .digest('hex')
    .slice(0, 32);
  return `${meetingId}|${transcriptionId || 'na'}|${language || 'en'}|${h}`;
}

async function ingestBotTranscriptLines(meetingId, lines = []) {
  if (!Array.isArray(lines) || lines.length === 0) return { inserted: 0 };
  let inserted = 0;
  for (const raw of lines.slice(0, 500)) {
    const originalText = String(raw.original_text || raw.text || '').trim();
    if (!originalText) continue;
    const speaker = String(raw.participant_identity || raw.speaker || 'Speaker').trim().slice(0, 200);
    const language = String(raw.language || 'en').trim().slice(0, 32);
    const sourceLanguage = raw.source_language ? String(raw.source_language).trim().slice(0, 32) : null;
    const translatedText = raw.translated_text ? String(raw.translated_text).trim() : null;
    const transcriptionId = raw.transcription_id != null ? String(raw.transcription_id).slice(0, 128) : null;
    const recordedAt = raw.recorded_at || new Date().toISOString();
    const dedupeKey = transcriptDedupeKey(meetingId, transcriptionId, language, originalText);

    try {
      const res = await db.run(
        `INSERT INTO v2_meeting_transcript_lines
          (id, meeting_id, participant_identity, original_text, translated_text, language, source_language, transcription_id, dedupe_key, recorded_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(dedupe_key) DO NOTHING`,
        [
          db.uuid(),
          meetingId,
          speaker,
          originalText,
          translatedText,
          language,
          sourceLanguage,
          transcriptionId,
          dedupeKey,
          recordedAt,
        ]
      );
      if (res?.changes > 0) inserted += 1;
    } catch (e) {
      if (!String(e.message || '').toLowerCase().includes('unique')) {
        console.warn('[notetakerPipeline] Failed inserting transcript line:', e.message);
      }
    }
  }
  return { inserted };
}

async function resolveAutoRecapRecipients(meeting) {
  const mode = String(meeting.auto_recap_mode || 'host_only').toLowerCase();
  if (mode === 'off') return [];

  const emailSet = new Set();
  const addEmail = (raw) => {
    const clean = String(raw || '').trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      emailSet.add(clean);
    }
  };

  const host = await db.get(`SELECT email, display_name FROM v2_users WHERE id = ?`, [meeting.host_user_id]);
  if (host?.email) addEmail(host.email);

  if (mode === 'workspace' || mode === 'attendees') {
    if (mode === 'workspace') {
      const members = await db.all(
        `SELECT u.email
         FROM v2_org_members m
         JOIN v2_users u ON u.id = m.user_id
         WHERE m.org_id = ? AND u.disabled_at IS NULL`,
        [meeting.org_id]
      );
      for (const m of members) addEmail(m.email);
    }

    if (mode === 'attendees') {
      if (meeting.attendee_emails_json) {
        try {
          const parsed = JSON.parse(meeting.attendee_emails_json);
          if (Array.isArray(parsed)) parsed.forEach(addEmail);
        } catch {
          /* ignore invalid json */
        }
      }
      const invited = await db.all(
        `SELECT DISTINCT email FROM v2_meeting_guest_invites WHERE meeting_id = ? AND email IS NOT NULL`,
        [meeting.id]
      );
      for (const inv of invited) addEmail(inv.email);
    }
  }

  return [...emailSet];
}

async function autoTranslateMeetingTranscriptIfNeeded(meetingId, targetLang) {
  if (!targetLang || !process.env.TRANSLATION_API_KEY) return;
  const normTarget = String(targetLang).trim();
  if (!normTarget) return;

  const lines = await db.all(
    `SELECT id, original_text, translated_text, source_language
     FROM v2_meeting_transcript_lines
     WHERE meeting_id = ?
     ORDER BY datetime(recorded_at) ASC
     LIMIT 400`,
    [meetingId]
  );

  for (const line of lines) {
    if (line.translated_text) continue;
    const src = line.source_language || 'auto';
    if (src.split('-')[0].toLowerCase() === normTarget.split('-')[0].toLowerCase()) continue;
    const translated = await translateText(line.original_text, src, normTarget);
    if (translated && translated !== line.original_text) {
      await db.run(
        `UPDATE v2_meeting_transcript_lines SET translated_text = ?, language = ? WHERE id = ?`,
        [translated, normTarget, line.id]
      );
    }
  }
}

/**
 * Runs post-call processing for a completed bot session:
 * 1. Marks meeting ended + records usage analytics event
 * 2. Optional post-call auto-translation if recap_language is configured
 * 3. Generates Executive Summary AI report
 * 4. Sends recap email + PDF + transcript according to auto_recap_mode
 */
async function finalizeBotSessionAndRunPipeline(sessionId, { publicBaseUrl } = {}) {
  const session = await db.get(`SELECT * FROM v2_external_bot_sessions WHERE id = ?`, [sessionId]);
  if (!session) return { ok: false, error: 'Session not found' };

  const meeting = await db.get(`SELECT * FROM v2_meetings WHERE id = ?`, [session.meeting_id]);
  if (!meeting) return { ok: false, error: 'Meeting not found' };

  const nowIso = new Date().toISOString();
  const durationSeconds =
    Number.isFinite(Number(session.duration_seconds)) && Number(session.duration_seconds) > 0
      ? Number(session.duration_seconds)
      : session.joined_at
        ? Math.max(0, Math.round((Date.now() - new Date(session.joined_at).getTime()) / 1000))
        : 0;

  await db.run(
    `UPDATE v2_meetings
     SET status = CASE WHEN status = 'archived' THEN status ELSE 'ended' END,
         ended_at = COALESCE(ended_at, ?)
     WHERE id = ?`,
    [nowIso, meeting.id]
  );

  if (durationSeconds > 0) {
    const minutes = Number((durationSeconds / 60).toFixed(2));
    await db
      .run(
        `INSERT INTO v2_usage_events (id, org_id, meeting_id, event_type, quantity, unit, meta_json, idempotency_key)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          db.uuid(),
          meeting.org_id,
          meeting.id,
          'notetaker_minutes',
          minutes,
          'minutes',
          JSON.stringify({ platform: session.platform, botSessionId: session.id }),
          `notetaker:${session.id}`,
        ]
      )
      .catch(() => {});
  }

  // 1. Auto-translate transcript lines if requested
  if (meeting.recap_language) {
    await autoTranslateMeetingTranscriptIfNeeded(meeting.id, meeting.recap_language).catch((e) => {
      console.warn('[notetakerPipeline] Auto-translate skipped:', e.message);
    });
  }

  const lines = await db.all(
    `SELECT id, participant_identity, original_text, translated_text, language, source_language, recorded_at
     FROM v2_meeting_transcript_lines
     WHERE meeting_id = ?
     ORDER BY datetime(recorded_at) ASC`,
    [meeting.id]
  );

  if (!lines.length) {
    await db.run(
      `UPDATE v2_external_bot_sessions
       SET status = 'completed', status_detail = COALESCE(status_detail, 'Call ended (no speech detected)'), ended_at = COALESCE(ended_at, ?), duration_seconds = ?, updated_at = ?
       WHERE id = ?`,
      [nowIso, durationSeconds, nowIso, session.id]
    );
    return { ok: true, synthesized: false, emailed: false, lineCount: 0 };
  }

  // 2. Synthesize Executive Summary report (if API key configured)
  let reportRow = null;
  const langName = meeting.recap_language
    ? LANGUAGE_NAMES[meeting.recap_language] || meeting.recap_language
    : '';
  const customInstructions = langName
    ? `Write the entire summary, headings, and action items in ${langName}.`
    : '';
  const hash = instructionsHash('executive_summary', customInstructions, lines.length);

  reportRow = await db.get(
    `SELECT * FROM v2_meeting_transcript_reports WHERE meeting_id = ? AND instructions_hash = ? LIMIT 1`,
    [meeting.id, hash]
  );

  if (!reportRow && process.env.TRANSLATION_API_KEY) {
    try {
      const synth = await synthesizeTranscript({
        templateId: 'executive_summary',
        customInstructions,
        lines,
        meetingTitle: meeting.title,
      });
      const reportId = db.uuid();
      await db.run(
        `INSERT INTO v2_meeting_transcript_reports
          (id, meeting_id, template_id, custom_instructions, instructions_hash, line_count, content_markdown, model, input_tokens, output_tokens, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          reportId,
          meeting.id,
          'executive_summary',
          customInstructions || null,
          hash,
          lines.length,
          synth.markdown,
          synth.model,
          synth.inputTokens,
          synth.outputTokens,
          nowIso,
        ]
      );
      reportRow = await db.get(`SELECT * FROM v2_meeting_transcript_reports WHERE id = ?`, [reportId]);
    } catch (e) {
      console.warn('[notetakerPipeline] Auto-synthesis failed:', e.message);
    }
  }

  // 3. Auto-email recap if configured and not yet sent
  let emailed = false;
  if (!session.recap_sent_at && reportRow) {
    const recipients = await resolveAutoRecapRecipients(meeting);
    if (recipients.length > 0) {
      try {
        const org = await db.get(`SELECT name FROM v2_organizations WHERE id = ?`, [meeting.org_id]);
        const host = await db.get(`SELECT display_name, email FROM v2_users WHERE id = ?`, [meeting.host_user_id]);
        const senderName = host?.display_name || host?.email?.split('@')[0] || 'Lalia Notetaker';
        const recording = await db.get(
          `SELECT id FROM v2_meeting_recordings WHERE meeting_id = ? ORDER BY created_at DESC LIMIT 1`,
          [meeting.id]
        );
        const appOrigin = (
          publicBaseUrl ||
          process.env.PUBLIC_APP_URL ||
          process.env.FRONTEND_URL ||
          'https://lalia.cloud'
        ).replace(/\/$/, '');
        const meetingLink = `${appOrigin}/v2/app/meetings/${meeting.id}?tab=insights`;
        const platformLabel = platformDisplayName(session.platform);
        const personalNote = recording
          ? `Recorded from ${platformLabel}. Listen to the audio recording and review full AI insights in Lalia: ${meetingLink}`
          : `Captured from ${platformLabel}. View full AI insights in Lalia: ${meetingLink}`;

        const transcriptTxt = lines
          .map((l) => {
            const ts = l.recorded_at || '';
            const who = l.participant_identity || 'Speaker';
            const body = [l.original_text, l.translated_text ? ` / ${l.translated_text}` : ''].join('');
            return `${ts ? `[${ts}] ` : ''}${who}: ${body}`;
          })
          .join('\n');

        const pdf = await reportToPdfBuffer({
          report: reportRow,
          meetingTitle: meeting.title,
          orgName: org?.name,
        });
        const label = templateLabel('executive_summary');
        const email = renderTranscriptReport({
          meetingTitle: meeting.title,
          label,
          orgName: org?.name,
          summaryExcerpt: reportRow.content_markdown,
          senderName,
          personalNote,
          transcriptPreview: transcriptTxt,
          includeTranscript: true,
        });

        const baseName = `${safeFilename(meeting.title || 'meeting')}-summary`;
        const sendRes = await sendEmail({
          to: recipients,
          subject: email.subject,
          text: email.text,
          html: email.html,
          attachments: [
            { filename: `${baseName}.pdf`, content: pdf.toString('base64') },
            {
              filename: `${safeFilename(meeting.title || 'meeting')}-transcript.txt`,
              content: Buffer.from(transcriptTxt, 'utf8').toString('base64'),
            },
          ],
        });

        if (sendRes?.sent) {
          emailed = true;
          await db.run(`UPDATE v2_external_bot_sessions SET recap_sent_at = ? WHERE id = ?`, [nowIso, session.id]);
        }
      } catch (e) {
        console.warn('[notetakerPipeline] Auto-email recap failed:', e.message);
      }
    }
  }

  await db.run(
    `UPDATE v2_external_bot_sessions
     SET status = 'completed',
         status_detail = 'Recording & AI summary ready',
         ended_at = COALESCE(ended_at, ?),
         duration_seconds = ?,
         updated_at = ?
     WHERE id = ?`,
    [nowIso, durationSeconds, nowIso, session.id]
  );

  return {
    ok: true,
    synthesized: Boolean(reportRow),
    emailed,
    lineCount: lines.length,
  };
}

module.exports = {
  mintRecordingPlaybackToken,
  verifyRecordingPlaybackToken,
  ingestBotTranscriptLines,
  resolveAutoRecapRecipients,
  finalizeBotSessionAndRunPipeline,
};
