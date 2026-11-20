'use strict';

/**
 * Recall.ai external meeting notetaker driver, encrypted settings, Svix-triggered
 * & polling reconciler, xAI Grok STT fallback, and COGS tracking.
 */
const db = require('../db/v2Database');
const { computeCost } = require('./costConstants');
const { encryptSecret, decryptSecret } = require('./secretCrypto');
const { putOrgObject, objectKey } = require('./objectStorage');
const { queueCostEvent } = require('./opsOutbox');
const { platformDisplayName } = require('./externalMeetingUrls');
const { publicFrontendBaseUrl } = require('./publicFrontendBaseUrl');
const {
  ingestBotTranscriptLines,
  finalizeBotSessionAndRunPipeline,
} = require('./notetakerPipeline');

const SETTINGS_ID = 'default';
const RECALL_REGIONS = ['us-east-1', 'us-west-2', 'eu-central-1', 'ap-northeast-1'];
const DRIVER_MODES = ['auto', 'recall', 'worker'];
const TRANSCRIPT_MODES = ['meeting_captions', 'recallai_streaming'];
const CACHE_MS = 3000;
const DEFAULT_RECONCILE_INTERVAL_MS = 12_000;

let settingsCache = null;
let settingsCacheAt = 0;
let reconcilerTimer = null;
let reconcilerRunning = false;
const inFlightSyncs = new Map();

function maskSecret(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.length <= 10) return '••••••••';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function clampInt(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function toBool(raw, fallback) {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  const s = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return fallback;
}

function normalizeRegion(raw, fallback = 'us-east-1') {
  const s = String(raw || '').trim().toLowerCase();
  return RECALL_REGIONS.includes(s) ? s : fallback;
}

function normalizeDriverMode(raw, fallback = 'auto') {
  const s = String(raw || '').trim().toLowerCase();
  return DRIVER_MODES.includes(s) ? s : fallback;
}

function normalizeTranscriptMode(raw, fallback = 'meeting_captions') {
  const s = String(raw || '').trim().toLowerCase();
  return TRANSCRIPT_MODES.includes(s) ? s : fallback;
}

function decryptField(raw, label) {
  if (!raw) return null;
  try {
    return decryptSecret(String(raw).trim());
  } catch (err) {
    console.warn(`[recallNotetaker] Failed to decrypt ${label}:`, err.message);
    return null;
  }
}

function invalidateNotetakerSettingsCache() {
  settingsCache = null;
  settingsCacheAt = 0;
}

function mergeNotetakerSettings(row) {
  const envDriverMode = normalizeDriverMode(process.env.NOTETAKER_BOT_DRIVER, 'auto');
  const envRegion = normalizeRegion(process.env.RECALL_REGION, 'us-east-1');
  const envApiKey = String(process.env.RECALL_API_KEY || '').trim() || null;
  const envWebhookSecret = String(process.env.RECALL_WEBHOOK_SECRET || '').trim() || null;

  const dbApiKey = decryptField(row?.recall_api_key_enc, 'recall_api_key_enc');
  const dbWebhookSecret = decryptField(row?.recall_webhook_secret_enc, 'recall_webhook_secret_enc');

  const driverMode = row?.driver_mode ? normalizeDriverMode(row.driver_mode, envDriverMode) : envDriverMode;
  const recallRegion = row?.recall_region ? normalizeRegion(row.recall_region, envRegion) : envRegion;
  const recallApiKey = dbApiKey || envApiKey;
  const recallWebhookSecret = dbWebhookSecret || envWebhookSecret;
  const transcriptMode = normalizeTranscriptMode(row?.transcript_mode, 'meeting_captions');

  const hasDbOverrides = Boolean(
    row &&
      (row.recall_api_key_enc ||
        row.recall_webhook_secret_enc ||
        row.updated_at ||
        row.updated_by)
  );
  const hasEnv = Boolean(envApiKey || envWebhookSecret || process.env.NOTETAKER_BOT_DRIVER);

  let source = 'environment';
  if (hasDbOverrides && hasEnv) source = 'mixed';
  else if (hasDbOverrides) source = 'database';

  const effectiveDriver =
    driverMode === 'recall' || (driverMode === 'auto' && Boolean(recallApiKey))
      ? 'recall'
      : 'worker';

  return {
    driverMode,
    effectiveDriver,
    recallRegion,
    recallApiKey,
    recallWebhookSecret,
    transcriptMode,
    xaiFallbackEnabled: toBool(row?.xai_fallback_enabled, true),
    deleteRecallMediaAfterIngest: toBool(row?.delete_recall_media_after_ingest, true),
    waitingRoomTimeoutSec: clampInt(row?.waiting_room_timeout_sec, 600, 60, 1800),
    everyoneLeftTimeoutSec: clampInt(row?.everyone_left_timeout_sec, 30, 5, 600),
    hasDbKey: Boolean(dbApiKey),
    hasEnvKey: Boolean(envApiKey),
    hasDbWebhookSecret: Boolean(dbWebhookSecret),
    hasEnvWebhookSecret: Boolean(envWebhookSecret),
    source,
    updatedAt: row?.updated_at || null,
    updatedBy: row?.updated_by || null,
  };
}

async function loadSettingsRow() {
  return db.get(`SELECT * FROM v2_platform_notetaker_settings WHERE id = ?`, [SETTINGS_ID]);
}

async function getNotetakerSettings({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && settingsCache && now - settingsCacheAt < CACHE_MS) {
    return settingsCache;
  }
  let row = null;
  try {
    row = await loadSettingsRow();
  } catch {
    row = null;
  }
  const merged = mergeNotetakerSettings(row);
  settingsCache = merged;
  settingsCacheAt = now;
  return merged;
}

function toNotetakerAdminView(settings, { publicBaseUrl } = {}) {
  const baseUrl = String(publicBaseUrl || publicFrontendBaseUrl()).replace(/\/$/, '');
  return {
    driverMode: settings.driverMode,
    effectiveDriver: settings.effectiveDriver,
    recallRegion: settings.recallRegion,
    hasRecallApiKey: Boolean(settings.recallApiKey),
    recallApiKeyMasked: maskSecret(settings.recallApiKey),
    usingEnvApiKey: settings.hasEnvKey && !settings.hasDbKey,
    hasRecallWebhookSecret: Boolean(settings.recallWebhookSecret),
    recallWebhookSecretMasked: maskSecret(settings.recallWebhookSecret),
    usingEnvWebhookSecret: settings.hasEnvWebhookSecret && !settings.hasDbWebhookSecret,
    transcriptMode: settings.transcriptMode,
    xaiFallbackEnabled: settings.xaiFallbackEnabled,
    deleteRecallMediaAfterIngest: settings.deleteRecallMediaAfterIngest,
    waitingRoomTimeoutSec: settings.waitingRoomTimeoutSec,
    everyoneLeftTimeoutSec: settings.everyoneLeftTimeoutSec,
    webhookUrl: `${baseUrl}/api/v2/webhooks/recall`,
    source: settings.source,
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
  };
}

async function saveNotetakerSettings(actorEmail, body = {}) {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 4) {
    return { ok: false, error: 'reason required (4+ chars)' };
  }

  const row = await loadSettingsRow().catch(() => null);
  const next = {
    driver_mode: row?.driver_mode || 'auto',
    recall_region: row?.recall_region || 'us-east-1',
    recall_api_key_enc: row?.recall_api_key_enc || null,
    recall_webhook_secret_enc: row?.recall_webhook_secret_enc || null,
    transcript_mode: row?.transcript_mode || 'meeting_captions',
    xai_fallback_enabled: row?.xai_fallback_enabled ?? 1,
    delete_recall_media_after_ingest: row?.delete_recall_media_after_ingest ?? 1,
    waiting_room_timeout_sec: row?.waiting_room_timeout_sec ?? 600,
    everyone_left_timeout_sec: row?.everyone_left_timeout_sec ?? 30,
  };

  if (body.driverMode !== undefined) {
    const dm = String(body.driverMode || '').trim().toLowerCase();
    if (!DRIVER_MODES.includes(dm)) {
      return { ok: false, error: 'Invalid driverMode' };
    }
    next.driver_mode = dm;
  }

  if (body.recallRegion !== undefined) {
    const reg = String(body.recallRegion || '').trim().toLowerCase();
    if (!RECALL_REGIONS.includes(reg)) {
      return { ok: false, error: 'Invalid recallRegion' };
    }
    next.recall_region = reg;
  }

  if (body.transcriptMode !== undefined) {
    const tm = String(body.transcriptMode || '').trim().toLowerCase();
    if (!TRANSCRIPT_MODES.includes(tm)) {
      return { ok: false, error: 'Invalid transcriptMode' };
    }
    next.transcript_mode = tm;
  }

  if (body.clearRecallApiKey) {
    next.recall_api_key_enc = null;
  } else if (body.recallApiKey !== undefined && String(body.recallApiKey).trim() !== '') {
    const trimmed = String(body.recallApiKey).trim();
    if (trimmed.length < 8) {
      return { ok: false, error: 'Recall API key looks too short' };
    }
    next.recall_api_key_enc = encryptSecret(trimmed);
  }

  if (body.clearRecallWebhookSecret) {
    next.recall_webhook_secret_enc = null;
  } else if (body.recallWebhookSecret !== undefined && String(body.recallWebhookSecret).trim() !== '') {
    const trimmed = String(body.recallWebhookSecret).trim();
    if (trimmed.length < 8) {
      return { ok: false, error: 'Recall webhook signing secret looks too short' };
    }
    next.recall_webhook_secret_enc = encryptSecret(trimmed);
  }

  if (body.xaiFallbackEnabled !== undefined) {
    next.xai_fallback_enabled = body.xaiFallbackEnabled ? 1 : 0;
  }
  if (body.deleteRecallMediaAfterIngest !== undefined) {
    next.delete_recall_media_after_ingest = body.deleteRecallMediaAfterIngest ? 1 : 0;
  }
  if (body.waitingRoomTimeoutSec !== undefined) {
    next.waiting_room_timeout_sec = clampInt(body.waitingRoomTimeoutSec, 600, 60, 1800);
  }
  if (body.everyoneLeftTimeoutSec !== undefined) {
    next.everyone_left_timeout_sec = clampInt(body.everyoneLeftTimeoutSec, 30, 5, 600);
  }

  const nowIso = new Date().toISOString();
  if (row) {
    await db.run(
      `UPDATE v2_platform_notetaker_settings
       SET driver_mode = ?,
           recall_region = ?,
           recall_api_key_enc = ?,
           recall_webhook_secret_enc = ?,
           transcript_mode = ?,
           xai_fallback_enabled = ?,
           delete_recall_media_after_ingest = ?,
           waiting_room_timeout_sec = ?,
           everyone_left_timeout_sec = ?,
           updated_at = ?,
           updated_by = ?
       WHERE id = ?`,
      [
        next.driver_mode,
        next.recall_region,
        next.recall_api_key_enc,
        next.recall_webhook_secret_enc,
        next.transcript_mode,
        next.xai_fallback_enabled,
        next.delete_recall_media_after_ingest,
        next.waiting_room_timeout_sec,
        next.everyone_left_timeout_sec,
        nowIso,
        actorEmail || null,
        SETTINGS_ID,
      ]
    );
  } else {
    await db.run(
      `INSERT INTO v2_platform_notetaker_settings (
         id, driver_mode, recall_region, recall_api_key_enc, recall_webhook_secret_enc,
         transcript_mode, xai_fallback_enabled, delete_recall_media_after_ingest,
         waiting_room_timeout_sec, everyone_left_timeout_sec, updated_at, updated_by
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        SETTINGS_ID,
        next.driver_mode,
        next.recall_region,
        next.recall_api_key_enc,
        next.recall_webhook_secret_enc,
        next.transcript_mode,
        next.xai_fallback_enabled,
        next.delete_recall_media_after_ingest,
        next.waiting_room_timeout_sec,
        next.everyone_left_timeout_sec,
        nowIso,
        actorEmail || null,
      ]
    );
  }

  invalidateNotetakerSettingsCache();
  const settings = await getNotetakerSettings({ fresh: true });
  return { ok: true, settings, reason };
}

function recallApiBase(region) {
  return `https://${normalizeRegion(region)}.recall.ai/api/v1`;
}

async function probeRecallRegion(region, apiKey, fetchImpl) {
  try {
    const res = await fetchImpl(`${recallApiBase(region)}/bot/?limit=1`, {
      method: 'GET',
      headers: { Authorization: `Token ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

async function verifyRecallCredentials({ apiKey, region } = {}, { fetchImpl = global.fetch } = {}) {
  const settings = await getNotetakerSettings({ fresh: true });
  const key = String(apiKey || '').trim() || settings.recallApiKey;
  if (!key) {
    return { ok: false, error: 'Enter a Recall.ai API key first.' };
  }

  const startRegion = normalizeRegion(region || settings.recallRegion, 'us-east-1');
  const first = await probeRecallRegion(startRegion, key, fetchImpl);
  if (first.ok) {
    return { ok: true, region: startRegion, regionAutoDetected: false };
  }

  if (first.status === 401 || first.status === 403) {
    for (const candidate of RECALL_REGIONS) {
      if (candidate === startRegion) continue;
      const probe = await probeRecallRegion(candidate, key, fetchImpl);
      if (probe.ok) {
        return { ok: true, region: candidate, regionAutoDetected: true };
      }
    }
    return {
      ok: false,
      region: startRegion,
      error: 'Invalid Recall.ai API key (rejected across all Recall regions).',
    };
  }

  return {
    ok: false,
    region: startRegion,
    error: first.error || `Recall API returned HTTP ${first.status}`,
  };
}

async function persistDetectedRegionIfStored(region, actorEmail = 'auto-detect') {
  try {
    const row = await loadSettingsRow();
    if (!row || normalizeRegion(row.recall_region) === region) return;
    await db.run(
      `UPDATE v2_platform_notetaker_settings SET recall_region = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
      [region, new Date().toISOString(), actorEmail, SETTINGS_ID]
    );
    invalidateNotetakerSettingsCache();
  } catch {
    /* ignore */
  }
}

function selectTranscriptProviderConfig(platform, transcriptMode) {
  if (platform === 'webex' || transcriptMode === 'recallai_streaming') {
    return { recallai_streaming: {} };
  }
  return { meeting_captions: {} };
}

function summarizeRecallError(data, statusCode) {
  const raw =
    data?.detail ||
    data?.error ||
    data?.message ||
    (typeof data === 'object' && data ? JSON.stringify(data) : '');
  const clean = String(raw || `Recall API returned HTTP ${statusCode}`).trim();
  return clean.slice(0, 260);
}

async function dispatchRecallBotForSession(sessionId, { fetchImpl = global.fetch } = {}) {
  const session = await db.get(`SELECT * FROM v2_external_bot_sessions WHERE id = ?`, [sessionId]);
  if (!session) return { ok: false, error: 'Session not found' };

  const settings = await getNotetakerSettings();
  const nowIso = new Date().toISOString();

  if (!settings.recallApiKey) {
    const msg = 'Recall.ai API key is not configured.';
    await db.run(
      `UPDATE v2_external_bot_sessions
       SET bot_provider = 'recall', status = 'failed', error_code = 'recall_api_key_missing',
           status_detail = ?, ended_at = ?, updated_at = ?
       WHERE id = ?`,
      [msg, nowIso, nowIso, session.id]
    );
    await db.run(`UPDATE v2_meetings SET status = 'ended', ended_at = COALESCE(ended_at, ?) WHERE id = ?`, [
      nowIso,
      session.meeting_id,
    ]);
    return { ok: false, error: msg };
  }

  const schedMs = session.scheduled_for ? new Date(session.scheduled_for).getTime() : NaN;
  const isScheduled = Number.isFinite(schedMs) && schedMs > Date.now() + 60_000;
  const payload = {
    meeting_url: session.normalized_url || session.target_url,
    bot_name: session.bot_display_name || 'Lalia Notetaker',
    metadata: {
      lalia_session_id: session.id,
      lalia_meeting_id: session.meeting_id,
      lalia_org_id: session.org_id,
    },
    recording_config: {
      audio_mixed_mp3: {},
      video_mixed_mp4: null,
      transcript: {
        provider: selectTranscriptProviderConfig(session.platform, settings.transcriptMode),
      },
    },
    automatic_leave: {
      waiting_room_timeout: settings.waitingRoomTimeoutSec,
      noone_joined_timeout: 900,
      everyone_left_timeout: {
        timeout: settings.everyoneLeftTimeoutSec,
        activate_after: null,
      },
    },
  };
  if (isScheduled) {
    payload.join_at = new Date(schedMs).toISOString();
  }

  let res;
  let botData = null;
  try {
    res = await fetchImpl(`${recallApiBase(settings.recallRegion)}/bot/`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${settings.recallApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    botData = await res.json().catch(() => null);
  } catch (err) {
    botData = { detail: `Failed reaching Recall API: ${err.message}` };
    res = { ok: false, status: 502 };
  }

  if (!res.ok || !botData?.id) {
    const errMsg = summarizeRecallError(botData, res.status || 502);
    const failedIso = new Date().toISOString();
    await db.run(
      `UPDATE v2_external_bot_sessions
       SET bot_provider = 'recall', status = 'failed', error_code = 'recall_dispatch_failed',
           status_detail = ?, ended_at = ?, updated_at = ?
       WHERE id = ?`,
      [errMsg, failedIso, failedIso, session.id]
    );
    await db.run(`UPDATE v2_meetings SET status = 'ended', ended_at = COALESCE(ended_at, ?) WHERE id = ?`, [
      failedIso,
      session.meeting_id,
    ]);
    return { ok: false, error: errMsg };
  }

  const label = platformDisplayName(session.platform);
  const nextStatus = isScheduled ? 'scheduled' : 'joining';
  const nextDetail = isScheduled
    ? `Scheduled via Recall.ai for ${label}`
    : `Dispatched Recall.ai bot to ${label}…`;

  await db.run(
    `UPDATE v2_external_bot_sessions
     SET bot_provider = 'recall',
         external_bot_id = ?,
         status = ?,
         status_detail = ?,
         heartbeat_at = ?,
         updated_at = ?
     WHERE id = ?`,
    [String(botData.id), nextStatus, nextDetail, nowIso, nowIso, session.id]
  );

  return { ok: true, botId: String(botData.id), sessionId: session.id, status: nextStatus };
}

async function stopRecallBotSession(session, { fetchImpl = global.fetch } = {}) {
  const nowIso = new Date().toISOString();
  if (!session?.external_bot_id) {
    return { ok: true, localOnly: true };
  }

  const settings = await getNotetakerSettings();
  if (!settings.recallApiKey) {
    return { ok: false, error: 'Recall.ai API key is not configured.' };
  }

  const botBase = `${recallApiBase(settings.recallRegion)}/bot/${encodeURIComponent(session.external_bot_id)}`;
  const headers = { Authorization: `Token ${settings.recallApiKey}` };

  if (session.status === 'scheduled' || session.status === 'queued') {
    const delRes = await fetchImpl(`${botBase}/`, {
      method: 'DELETE',
      headers,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => ({ ok: false, status: 0 }));

    if ([200, 202, 204, 404].includes(delRes.status)) {
      await db.run(
        `UPDATE v2_external_bot_sessions
         SET status = 'canceled', stop_requested = 1, status_detail = 'Canceled before joining',
             ended_at = ?, updated_at = ?
         WHERE id = ?`,
        [nowIso, nowIso, session.id]
      );
      await db.run(`UPDATE v2_meetings SET status = 'ended', ended_at = COALESCE(ended_at, ?) WHERE id = ?`, [
        nowIso,
        session.meeting_id,
      ]);
      return { ok: true, canceled: true };
    }
  }

  if (!['completed', 'failed', 'canceled'].includes(session.status)) {
    const leaveRes = await fetchImpl(`${botBase}/leave_call/`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => ({ ok: false, status: 0 }));

    await db.run(
      `UPDATE v2_external_bot_sessions
       SET stop_requested = 1, status_detail = 'Leaving call & saving recording…', updated_at = ?
       WHERE id = ?`,
      [nowIso, session.id]
    );
    return { ok: Boolean(leaveRes.ok || leaveRes.status === 404), leaving: true };
  }

  return { ok: true };
}

function getLatestRecallStatus(botData) {
  const changes = Array.isArray(botData?.status_changes) ? botData.status_changes : [];
  if (changes.length > 0) {
    const last = changes[changes.length - 1];
    return {
      code: String(last?.code || '').toLowerCase(),
      subCode: last?.sub_code ? String(last.sub_code) : null,
      createdAt: last?.created_at || null,
      message: last?.message || null,
    };
  }
  const st = botData?.status;
  if (st && typeof st === 'object') {
    return {
      code: String(st.code || '').toLowerCase(),
      subCode: st.sub_code ? String(st.sub_code) : null,
      createdAt: st.created_at || st.updated_at || null,
      message: st.message || null,
    };
  }
  return {
    code: String(st || '').toLowerCase(),
    subCode: null,
    createdAt: null,
    message: null,
  };
}

function computeRecallDurationSeconds(botData, session) {
  const changes = Array.isArray(botData?.status_changes) ? botData.status_changes : [];
  const startEv = changes.find(
    (c) => c?.code === 'in_call_recording' || c?.code === 'recording_permission_allowed'
  );
  const endEv = [...changes]
    .reverse()
    .find((c) => c?.code === 'call_ended' || c?.code === 'done');

  const startMs = startEv?.created_at
    ? new Date(startEv.created_at).getTime()
    : session.joined_at
      ? new Date(session.joined_at).getTime()
      : NaN;
  const endMs = endEv?.created_at ? new Date(endEv.created_at).getTime() : Date.now();

  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
    return Math.max(1, Math.round((endMs - startMs) / 1000));
  }
  return Number.isFinite(Number(session.duration_seconds)) && Number(session.duration_seconds) > 0
    ? Number(session.duration_seconds)
    : 0;
}

function humanFatalReason(subCode, message) {
  const map = {
    meeting_not_found: 'Meeting URL was not found or has ended.',
    meeting_already_ended: 'The meeting already ended before the bot could join.',
    bot_kicked_from_call: 'The notetaker was removed from the meeting.',
    bot_not_accepted: 'Host did not admit the notetaker from the lobby in time.',
    timeout_exceeded_waiting_room: 'Timed out waiting in the meeting lobby.',
    timeout_exceeded_noone_joined: 'No participants joined the meeting.',
    recording_permission_denied: 'Host denied recording permission in the meeting.',
    zoom_registration_required: 'Zoom meeting requires attendee registration.',
    internal_error: 'Temporary Recall.ai bot error.',
  };
  if (subCode && map[subCode]) return map[subCode];
  if (message) return String(message).slice(0, 260);
  if (subCode) return `Meeting ended (${subCode})`;
  return 'Could not join or record meeting';
}

function extractRelativeSeconds(rawTimestamp) {
  if (typeof rawTimestamp === 'number' && Number.isFinite(rawTimestamp)) {
    return Math.max(0, rawTimestamp);
  }
  if (rawTimestamp && typeof rawTimestamp === 'object') {
    if (typeof rawTimestamp.relative === 'number' && Number.isFinite(rawTimestamp.relative)) {
      return Math.max(0, rawTimestamp.relative);
    }
  }
  return null;
}

function parseRecallTranscriptJson(rawJson, { baseStartMs, botDisplayName = '' } = {}) {
  const items = Array.isArray(rawJson)
    ? rawJson
    : Array.isArray(rawJson?.transcript)
      ? rawJson.transcript
      : Array.isArray(rawJson?.results)
        ? rawJson.results
        : [];
  const baseMs = Number.isFinite(baseStartMs) ? baseStartMs : Date.now();
  const botLower = String(botDisplayName || '').trim().toLowerCase();
  const lines = [];

  items.forEach((item, idx) => {
    const words = Array.isArray(item?.words) ? item.words : [];
    const text = String(
      item?.text ||
        words
          .map((w) => w?.text || w?.word || '')
          .filter(Boolean)
          .join(' ')
    ).trim();
    if (!text) return;

    const speakerRaw =
      item?.participant?.name ||
      item?.speaker ||
      (item?.participant?.id != null ? `Speaker ${item.participant.id}` : 'Speaker');
    const speaker = String(speakerRaw).trim().slice(0, 200) || 'Speaker';
    if (botLower && speaker.toLowerCase() === botLower) return;

    const relSec =
      extractRelativeSeconds(item?.start_timestamp) ??
      extractRelativeSeconds(words[0]?.start_timestamp) ??
      (typeof words[0]?.start_time === 'number' ? Math.max(0, words[0].start_time) : 0);

    const recordedAt =
      item?.start_timestamp?.absolute ||
      new Date(baseMs + (relSec || 0) * 1000).toISOString();

    lines.push({
      participant_identity: speaker,
      original_text: text,
      language: String(item?.language || 'en').trim().slice(0, 32) || 'en',
      transcription_id: `recall-${idx}`,
      recorded_at: recordedAt,
    });
  });

  return lines;
}

function groupXaiWordsIntoLines(data, { baseStartMs }) {
  const baseMs = Number.isFinite(baseStartMs) ? baseStartMs : Date.now();
  const words = Array.isArray(data?.words) ? data.words : [];
  const language = String(data?.language || 'en').trim().slice(0, 32) || 'en';
  const lines = [];

  if (words.length > 0) {
    let curSpeaker = words[0]?.speaker ?? 0;
    let curStart = Number(words[0]?.start) || 0;
    let tokens = [];

    const flush = () => {
      const txt = tokens.join(' ').trim();
      if (!txt) return;
      const uttIdx = lines.length;
      lines.push({
        participant_identity: `Speaker ${Number(curSpeaker) + 1}`,
        original_text: txt,
        language,
        transcription_id: `xai-${uttIdx}`,
        recorded_at: new Date(baseMs + curStart * 1000).toISOString(),
      });
      tokens = [];
    };

    for (const w of words) {
      const tok = String(w?.text || '').trim();
      if (!tok) continue;
      const spk = w?.speaker ?? 0;
      if (spk !== curSpeaker || tokens.length >= 45) {
        flush();
        curSpeaker = spk;
        curStart = Number(w?.start) || curStart;
      }
      tokens.push(tok);
    }
    flush();
  } else if (String(data?.text || '').trim()) {
    lines.push({
      participant_identity: 'Speaker 1',
      original_text: String(data.text).trim(),
      language,
      transcription_id: 'xai-0',
      recorded_at: new Date(baseMs).toISOString(),
    });
  }

  return lines;
}

async function transcribeAudioBufferWithXai(audioBuf, { xaiApiKey, baseStartMs, fetchImpl = global.fetch } = {}) {
  if (!audioBuf || !audioBuf.length || !xaiApiKey) return { lines: [], durationSeconds: 0 };

  const form = new FormData();
  // xAI STT requires option fields to precede the file field in multipart bodies.
  form.append('model', 'grok-voice-transcribe-2.0');
  form.append('diarize', 'true');
  form.append('file', new Blob([audioBuf], { type: 'audio/mpeg' }), 'recording.mp3');

  const res = await fetchImpl('https://api.x.ai/v1/stt', {
    method: 'POST',
    headers: { Authorization: `Bearer ${xaiApiKey}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`xAI STT failed (${res.status}): ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const lines = groupXaiWordsIntoLines(data, { baseStartMs });
  return {
    lines,
    durationSeconds: Number(data?.duration) || 0,
  };
}

async function insertCostEventRow(tx, { meetingRoomName, orgId, eventType, units, ts, meta, hasOutbox }) {
  const costInfo = computeCost(eventType, units);
  const inserted = await tx.run(
    `INSERT INTO meeting_cost_events (meeting_id, org_id, event_type, provider, units, unit_cost_usd, total_cost_usd, ts, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      meetingRoomName,
      orgId || null,
      eventType,
      costInfo.provider,
      units,
      costInfo.unit_cost_usd,
      costInfo.total_cost_usd,
      ts,
      meta ? JSON.stringify(meta) : null,
    ]
  );
  if (hasOutbox && inserted?.lastID) {
    await queueCostEvent(tx, {
      id: inserted.lastID,
      meeting_id: meetingRoomName,
      event_type: eventType,
      provider: costInfo.provider,
      total_cost_usd: costInfo.total_cost_usd,
      ts,
    });
  }
}

async function recordNotetakerCostEvents({ meeting, session, durationSeconds, xaiMinutesUsed = 0 }) {
  const roomName = meeting?.livekit_room_name;
  if (!roomName) return;

  const existing = await db
    .get(`SELECT id FROM meeting_cost_events WHERE meeting_id = ? AND event_type = 'recall_bot_minute' LIMIT 1`, [
      roomName,
    ])
    .catch(() => null);
  if (existing) return;

  const botMinutes = durationSeconds > 0 ? Number((durationSeconds / 60).toFixed(4)) : 0;
  const xaiMinutes = xaiMinutesUsed > 0 ? Number(xaiMinutesUsed.toFixed(4)) : 0;
  if (botMinutes <= 0 && xaiMinutes <= 0) return;

  let hasOutbox = false;
  try {
    await db.get(`SELECT 1 FROM ops_business_outbox LIMIT 1`);
    hasOutbox = true;
  } catch {
    hasOutbox = false;
  }

  const ts = Date.now();
  await db.transaction(async (tx) => {
    if (botMinutes > 0) {
      await insertCostEventRow(tx, {
        meetingRoomName: roomName,
        orgId: meeting.org_id,
        eventType: 'recall_bot_minute',
        units: botMinutes,
        ts,
        meta: { platform: session.platform, bot_session_id: session.id, external_bot_id: session.external_bot_id },
        hasOutbox,
      });
    }
    if (xaiMinutes > 0) {
      await insertCostEventRow(tx, {
        meetingRoomName: roomName,
        orgId: meeting.org_id,
        eventType: 'xai_stt_minute',
        units: xaiMinutes,
        ts,
        meta: { source: 'notetaker_fallback', bot_session_id: session.id },
        hasOutbox,
      });
    }

    const byProvider = await tx.all(
      `SELECT provider, SUM(total_cost_usd) AS subtotal FROM meeting_cost_events WHERE meeting_id = ? GROUP BY provider`,
      [roomName]
    );
    const breakdown = {};
    let totalCost = 0;
    for (const row of byProvider) {
      breakdown[row.provider] = Number(row.subtotal) || 0;
      totalCost += Number(row.subtotal) || 0;
    }

    await tx.run(
      `INSERT INTO meeting_cost_rollups (meeting_id, org_id, total_cost_usd, breakdown_json, duration_seconds, computed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(meeting_id) DO UPDATE SET
         org_id = excluded.org_id,
         total_cost_usd = excluded.total_cost_usd,
         breakdown_json = excluded.breakdown_json,
         duration_seconds = excluded.duration_seconds,
         computed_at = excluded.computed_at`,
      [roomName, meeting.org_id, totalCost, JSON.stringify(breakdown), durationSeconds || 0, ts]
    );
  });
}

function shortcutStatus(shortcut) {
  if (!shortcut) return '';
  if (typeof shortcut.status === 'string') return shortcut.status.toLowerCase();
  return String(shortcut.status?.code || '').toLowerCase();
}

async function downloadPresignedBuffer(url, fetchImpl) {
  const res = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    throw new Error(`Artifact download failed (${res.status})`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function ingestCompletedRecallBot(session, botData, settings, { fetchImpl, publicBaseUrl }) {
  const nowIso = new Date().toISOString();
  if (session.ingested_at) {
    if (session.status !== 'completed') {
      await db.run(
        `UPDATE v2_external_bot_sessions SET status = 'completed', updated_at = ? WHERE id = ?`,
        [nowIso, session.id]
      );
    }
    return { ok: true, alreadyIngested: true };
  }

  const recordings = Array.isArray(botData?.recordings) ? botData.recordings : [];
  const rec = recordings[0] || null;
  const media = rec?.media_shortcuts || {};
  const audioShortcut = media.audio_mixed || null;
  const transcriptShortcut = media.transcript || null;

  const latest = getLatestRecallStatus(botData);
  const doneAtMs = latest.createdAt ? new Date(latest.createdAt).getTime() : Date.now();
  const waitBudgetOpen = Number.isFinite(doneAtMs) && Date.now() - doneAtMs < 120_000;
  const audioPending =
    rec &&
    !audioShortcut?.data?.download_url &&
    ['processing', 'in_progress', 'pending'].includes(shortcutStatus(audioShortcut));
  const transcriptPending =
    rec &&
    !transcriptShortcut?.data?.download_url &&
    ['processing', 'in_progress', 'pending'].includes(shortcutStatus(transcriptShortcut));

  if ((audioPending || transcriptPending) && waitBudgetOpen) {
    await db.run(
      `UPDATE v2_external_bot_sessions
       SET status = 'processing', status_detail = 'Compiling recording & transcript…', heartbeat_at = ?, updated_at = ?
       WHERE id = ?`,
      [nowIso, nowIso, session.id]
    );
    return { ok: true, pendingArtifacts: true };
  }

  const durationSeconds = computeRecallDurationSeconds(botData, session);
  const recordingStartMs = (() => {
    const changes = Array.isArray(botData?.status_changes) ? botData.status_changes : [];
    const recEv = changes.find((c) => c?.code === 'in_call_recording');
    if (recEv?.created_at) return new Date(recEv.created_at).getTime();
    if (session.joined_at) return new Date(session.joined_at).getTime();
    return Date.now();
  })();

  await db.run(
    `UPDATE v2_external_bot_sessions
     SET status = 'processing', status_detail = 'Saving recording & generating AI insights…',
         heartbeat_at = ?, duration_seconds = COALESCE(?, duration_seconds), updated_at = ?
     WHERE id = ?`,
    [nowIso, durationSeconds || null, nowIso, session.id]
  );

  // 1. Download mixed MP3 audio and store permanently in Lalia S3 / object storage
  let audioBuf = null;
  const audioUrl = audioShortcut?.data?.download_url || null;
  if (audioUrl) {
    try {
      audioBuf = await downloadPresignedBuffer(audioUrl, fetchImpl);
      if (audioBuf.length > 0) {
        const existingRec = await db.get(
          `SELECT id FROM v2_meeting_recordings WHERE bot_session_id = ? LIMIT 1`,
          [session.id]
        );
        if (!existingRec) {
          const recordingId = db.uuid();
          const relativePath = `recordings/${session.meeting_id}-${recordingId.slice(0, 8)}.mp3`;
          const storageKey = objectKey(session.org_id, relativePath);
          await putOrgObject(session.org_id, relativePath, audioBuf, {
            contentType: 'audio/mpeg',
          });
          await db.run(
            `INSERT INTO v2_meeting_recordings (
              id, org_id, meeting_id, bot_session_id, storage_key, relative_path,
              mime_type, size_bytes, duration_seconds, created_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [
              recordingId,
              session.org_id,
              session.meeting_id,
              session.id,
              storageKey,
              relativePath,
              'audio/mpeg',
              audioBuf.length,
              durationSeconds || null,
              nowIso,
            ]
          );
        }
      }
    } catch (err) {
      console.warn(`[recallNotetaker] Audio download/upload failed for ${session.id}:`, err.message);
    }
  }

  // 2. Download transcript from Recall if available
  let transcriptLines = [];
  const transcriptUrl = transcriptShortcut?.data?.download_url || null;
  if (transcriptUrl) {
    try {
      const trRes = await fetchImpl(transcriptUrl, { method: 'GET', signal: AbortSignal.timeout(60_000) });
      if (trRes.ok) {
        const rawJson = await trRes.json();
        transcriptLines = parseRecallTranscriptJson(rawJson, {
          baseStartMs: recordingStartMs,
          botDisplayName: session.bot_display_name,
        });
      }
    } catch (err) {
      console.warn(`[recallNotetaker] Transcript download failed for ${session.id}:`, err.message);
    }
  }

  // 3. Automatic xAI Grok STT fallback if native captions were disabled or empty
  let xaiMinutesUsed = 0;
  const xaiKey = String(process.env.XAI_API_KEY || '').trim();
  if (transcriptLines.length === 0 && audioBuf && audioBuf.length > 512 && settings.xaiFallbackEnabled && xaiKey) {
    try {
      const xaiResult = await transcribeAudioBufferWithXai(audioBuf, {
        xaiApiKey: xaiKey,
        baseStartMs: recordingStartMs,
        fetchImpl,
      });
      transcriptLines = xaiResult.lines || [];
      const fallbackSec = xaiResult.durationSeconds || durationSeconds;
      if (fallbackSec > 0) xaiMinutesUsed = fallbackSec / 60;
    } catch (err) {
      console.warn(`[recallNotetaker] xAI STT fallback warning for ${session.id}:`, err.message);
    }
  }

  if (transcriptLines.length > 0) {
    await ingestBotTranscriptLines(session.meeting_id, transcriptLines);
  }

  // 4. Record COGS (Recall bot minutes + any xAI STT fallback)
  const meeting = await db.get(`SELECT * FROM v2_meetings WHERE id = ?`, [session.meeting_id]);
  if (meeting) {
    await recordNotetakerCostEvents({
      meeting,
      session,
      durationSeconds,
      xaiMinutesUsed,
    }).catch((err) => {
      console.warn(`[recallNotetaker] Cost rollup warning for ${session.id}:`, err.message);
    });
  }

  // 5. Run Executive Summary & Email Recap pipeline
  const pipelineResult = await finalizeBotSessionAndRunPipeline(session.id, { publicBaseUrl });
  const doneIso = new Date().toISOString();
  await db.run(
    `UPDATE v2_external_bot_sessions
     SET ingested_at = COALESCE(ingested_at, ?),
         duration_seconds = COALESCE(duration_seconds, ?),
         ended_at = COALESCE(ended_at, ?),
         updated_at = ?
     WHERE id = ?`,
    [doneIso, durationSeconds || 0, doneIso, doneIso, session.id]
  );

  // 6. Best-effort cleanup of Recall-hosted media to avoid retention charges
  if (settings.deleteRecallMediaAfterIngest && botData?.id) {
    fetchImpl(`${recallApiBase(settings.recallRegion)}/bot/${encodeURIComponent(botData.id)}/delete_media/`, {
      method: 'POST',
      headers: { Authorization: `Token ${settings.recallApiKey}` },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }

  return { ok: true, status: 'completed', durationSeconds, ...pipelineResult };
}

async function performRecallSync(sessionOrId, { fetchImpl = global.fetch, publicBaseUrl } = {}) {
  const session =
    typeof sessionOrId === 'string'
      ? await db.get(`SELECT * FROM v2_external_bot_sessions WHERE id = ?`, [sessionOrId])
      : await db.get(`SELECT * FROM v2_external_bot_sessions WHERE id = ?`, [sessionOrId?.id]);

  if (!session || !session.external_bot_id) {
    return { ok: false, error: 'Recall bot session not found' };
  }

  const settings = await getNotetakerSettings();
  if (!settings.recallApiKey) {
    return { ok: false, error: 'Recall API key missing' };
  }

  const res = await fetchImpl(
    `${recallApiBase(settings.recallRegion)}/bot/${encodeURIComponent(session.external_bot_id)}/`,
    {
      method: 'GET',
      headers: { Authorization: `Token ${settings.recallApiKey}` },
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!res.ok) {
    return { ok: false, error: `Recall GET bot returned HTTP ${res.status}` };
  }
  const botData = await res.json();
  const latest = getLatestRecallStatus(botData);
  const nowIso = new Date().toISOString();
  const label = platformDisplayName(session.platform);

  if (latest.code === 'done') {
    return ingestCompletedRecallBot(session, botData, settings, { fetchImpl, publicBaseUrl });
  }

  if (latest.code === 'fatal') {
    const errDetail = humanFatalReason(latest.subCode, latest.message);
    await db.run(
      `UPDATE v2_external_bot_sessions
       SET status = 'failed', error_code = ?, status_detail = ?, heartbeat_at = ?,
           ended_at = COALESCE(ended_at, ?), updated_at = ?
       WHERE id = ?`,
      [String(latest.subCode || 'recall_fatal').slice(0, 64), errDetail, nowIso, nowIso, nowIso, session.id]
    );
    await db.run(`UPDATE v2_meetings SET status = 'ended', ended_at = COALESCE(ended_at, ?) WHERE id = ?`, [
      nowIso,
      session.meeting_id,
    ]);
    return { ok: true, status: 'failed', errorCode: latest.subCode };
  }

  let nextStatus = session.status;
  let nextDetail = session.status_detail;
  let joinedAt = session.joined_at;
  let endedAt = session.ended_at;

  switch (latest.code) {
    case 'ready':
    case 'scheduled': {
      const schedMs = session.scheduled_for ? new Date(session.scheduled_for).getTime() : NaN;
      const isFuture = Number.isFinite(schedMs) && schedMs > Date.now() + 60_000;
      nextStatus = isFuture ? 'scheduled' : 'joining';
      nextDetail = isFuture ? `Scheduled to join ${label}` : `Preparing to join ${label}…`;
      break;
    }
    case 'joining_call':
      nextStatus = 'joining';
      nextDetail = `Opening ${label}…`;
      break;
    case 'in_waiting_room':
      nextStatus = 'waiting_in_lobby';
      nextDetail = `Waiting for the host to admit "${session.bot_display_name}"…`;
      break;
    case 'in_call_not_recording':
      nextStatus = 'joining';
      nextDetail = `In ${label} — waiting for recording permission…`;
      break;
    case 'in_call_recording':
    case 'recording_permission_allowed':
      nextStatus = 'recording';
      nextDetail = `Recording audio & transcript in ${label}`;
      joinedAt = joinedAt || latest.createdAt || nowIso;
      await db.run(
        `UPDATE v2_meetings SET status = 'live', started_at = COALESCE(started_at, ?) WHERE id = ?`,
        [joinedAt, session.meeting_id]
      );
      break;
    case 'call_ended':
    case 'recording_permission_denied':
      nextStatus = 'processing';
      nextDetail = 'Call ended — compiling audio & transcript…';
      endedAt = endedAt || latest.createdAt || nowIso;
      break;
    default:
      break;
  }

  await db.run(
    `UPDATE v2_external_bot_sessions
     SET status = ?, status_detail = ?, joined_at = ?, ended_at = ?, heartbeat_at = ?, updated_at = ?
     WHERE id = ?`,
    [nextStatus, nextDetail, joinedAt, endedAt, nowIso, nowIso, session.id]
  );

  return { ok: true, status: nextStatus, recallCode: latest.code };
}

function syncRecallBotSession(sessionOrId, opts = {}) {
  const key = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId?.id;
  if (!key) return Promise.resolve({ ok: false, error: 'Missing session id' });

  const existing = inFlightSyncs.get(key);
  if (existing) return existing;

  const p = performRecallSync(sessionOrId, opts).finally(() => {
    inFlightSyncs.delete(key);
  });
  inFlightSyncs.set(key, p);
  return p;
}

async function reconcileActiveRecallSessions({ fetchImpl = global.fetch } = {}) {
  if (reconcilerRunning) return { skipped: true };
  reconcilerRunning = true;
  try {
    const settings = await getNotetakerSettings();
    if (!settings.recallApiKey) return { synced: 0 };

    const rows = await db.all(
      `SELECT * FROM v2_external_bot_sessions
       WHERE bot_provider = 'recall'
         AND external_bot_id IS NOT NULL
         AND status IN ('scheduled', 'queued', 'joining', 'waiting_in_lobby', 'recording', 'processing')
       ORDER BY created_at ASC
       LIMIT 15`
    );
    if (!rows.length) return { synced: 0 };

    const leadHorizonMs = Date.now() + 120_000;
    let synced = 0;
    for (const row of rows) {
      if (row.status === 'scheduled' && row.scheduled_for) {
        const schedMs = new Date(row.scheduled_for).getTime();
        if (Number.isFinite(schedMs) && schedMs > leadHorizonMs) {
          continue;
        }
      }
      await syncRecallBotSession(row, { fetchImpl }).catch((err) => {
        console.warn(`[recallReconciler] Failed syncing session ${row.id}:`, err.message);
      });
      synced += 1;
    }
    return { synced };
  } finally {
    reconcilerRunning = false;
  }
}

function startRecallReconciler({ intervalMs = DEFAULT_RECONCILE_INTERVAL_MS } = {}) {
  if (reconcilerTimer) return reconcilerTimer;
  const ms = Math.max(3000, Number(process.env.RECALL_RECONCILE_INTERVAL_MS || intervalMs));
  reconcilerTimer = setInterval(() => {
    reconcileActiveRecallSessions().catch((err) => {
      console.warn('[recallReconciler] tick error:', err.message);
    });
  }, ms);
  if (typeof reconcilerTimer.unref === 'function') {
    reconcilerTimer.unref();
  }
  console.log(`[recallReconciler] polling active sessions every ${ms}ms`);
  return reconcilerTimer;
}

function stopRecallReconciler() {
  if (reconcilerTimer) {
    clearInterval(reconcilerTimer);
    reconcilerTimer = null;
  }
}

module.exports = {
  RECALL_REGIONS,
  DRIVER_MODES,
  TRANSCRIPT_MODES,
  maskSecret,
  getNotetakerSettings,
  saveNotetakerSettings,
  invalidateNotetakerSettingsCache,
  toNotetakerAdminView,
  verifyRecallCredentials,
  persistDetectedRegionIfStored,
  dispatchRecallBotForSession,
  stopRecallBotSession,
  syncRecallBotSession,
  reconcileActiveRecallSessions,
  startRecallReconciler,
  stopRecallReconciler,
  parseRecallTranscriptJson,
  groupXaiWordsIntoLines,
  transcribeAudioBufferWithXai,
};
