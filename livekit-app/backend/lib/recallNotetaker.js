'use strict';

/**
 * Recall.ai v1.11 external meeting notetaker client, startup & URL guards,
 * signature verification, retry/backoff helper, async recording -> transcript
 * pipeline, encrypted settings, and COGS tracking.
 */
const crypto = require('crypto');
const net = require('net');
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
const DEFAULT_REGION = 'us-west-2';
const RECALL_REGIONS = ['us-west-2', 'us-east-1', 'eu-central-1', 'ap-northeast-1'];
const DRIVER_MODES = ['auto', 'recall', 'worker'];
const TRANSCRIPT_MODES = ['recallai_async', 'meeting_captions', 'recallai_streaming'];
const CACHE_MS = 3000;
const DEFAULT_CHAT_NOTICE = 'Lalia Notetaker is recording this meeting for notes and summary.';

let settingsCache = null;
let settingsCacheAt = 0;

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

function normalizeRegion(raw, fallback = DEFAULT_REGION) {
  const s = String(raw || '').trim().toLowerCase();
  return RECALL_REGIONS.includes(s) ? s : fallback;
}

function normalizeDriverMode(raw, fallback = 'auto') {
  const s = String(raw || '').trim().toLowerCase();
  return DRIVER_MODES.includes(s) ? s : fallback;
}

function normalizeTranscriptMode(raw, fallback = 'recallai_async') {
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

function isPrivateOrLocalHostname(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true;
  }
  const ipVer = net.isIP(host);
  if (ipVer === 4) {
    const parts = host.split('.').map(Number);
    if (parts[0] === 127 || parts[0] === 10 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    return false;
  }
  if (ipVer === 6) {
    return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80');
  }
  return false;
}

function assertPublicRecallUrl(rawUrl, label = 'PUBLIC_API_BASE_URL') {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    throw new Error(`${label} must be a valid public URL`);
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error(`${label} must use https:// or http://`);
  }
  if (isPrivateOrLocalHostname(parsed.hostname)) {
    throw new Error(`${label} must not be localhost or a private IP address`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function resolvePublicApiBaseUrl({ publicBaseUrl } = {}) {
  const raw =
    publicBaseUrl ||
    process.env.PUBLIC_API_BASE_URL ||
    process.env.PUBLIC_FRONTEND_BASE_URL ||
    process.env.FRONTEND_URL ||
    publicFrontendBaseUrl();
  return String(raw || '').trim().replace(/\/$/, '');
}

function mergeNotetakerSettings(row) {
  const envDriverMode = normalizeDriverMode(process.env.NOTETAKER_BOT_DRIVER, 'auto');
  const envRegion = normalizeRegion(process.env.RECALL_REGION, DEFAULT_REGION);
  const envApiKey = String(process.env.RECALL_API_KEY || '').trim() || null;
  const envWebhookSecret =
    String(
      process.env.RECALL_WEBHOOK_VERIFICATION_SECRET ||
        process.env.RECALL_WORKSPACE_VERIFICATION_SECRET ||
        process.env.RECALL_WEBHOOK_SECRET ||
        ''
    ).trim() || null;
  const envCalendarCallbackUri =
    String(process.env.RECALL_CALENDAR_REGIONAL_CALLBACK_URI || '').trim() || null;

  const dbApiKey = decryptField(row?.recall_api_key_enc, 'recall_api_key_enc');
  const dbWebhookSecret = decryptField(row?.recall_webhook_secret_enc, 'recall_webhook_secret_enc');

  const driverMode = row?.driver_mode ? normalizeDriverMode(row.driver_mode, envDriverMode) : envDriverMode;
  const recallRegion =
    process.env.RECALL_REGION && !row?.recall_api_key_enc
      ? envRegion
      : row?.recall_region
        ? normalizeRegion(row.recall_region, envRegion)
        : envRegion;
  const recallApiKey = dbApiKey || envApiKey;
  const recallWebhookSecret = dbWebhookSecret || envWebhookSecret;
  const transcriptMode = normalizeTranscriptMode(row?.transcript_mode, 'recallai_async');

  const hasDbOverrides = Boolean(
    row &&
      (row.recall_api_key_enc ||
        row.recall_webhook_secret_enc ||
        row.updated_at ||
        row.updated_by)
  );
  const hasEnv = Boolean(envApiKey || envWebhookSecret || process.env.RECALL_REGION || process.env.NOTETAKER_BOT_DRIVER);

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
    xaiFallbackEnabled: toBool(row?.xai_fallback_enabled, false),
    deleteRecallMediaAfterIngest: toBool(row?.delete_recall_media_after_ingest, true),
    waitingRoomTimeoutSec: clampInt(row?.waiting_room_timeout_sec, 600, 60, 1800),
    everyoneLeftTimeoutSec: clampInt(row?.everyone_left_timeout_sec, 30, 5, 600),
    chatNoticeEnabled: toBool(row?.chat_notice_enabled, true),
    chatNoticeText:
      row?.chat_notice_text && String(row.chat_notice_text).trim()
        ? String(row.chat_notice_text).trim()
        : DEFAULT_CHAT_NOTICE,
    calendarRegionalCallbackUri:
      (row?.calendar_regional_callback_uri && String(row.calendar_regional_callback_uri).trim()) ||
      envCalendarCallbackUri ||
      null,
    calendarSetupId: row?.calendar_setup_id ? String(row.calendar_setup_id).trim() : null,
    publicApiBaseUrl: resolvePublicApiBaseUrl(),
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

async function validateRecallStartupConfig() {
  const settings = await getNotetakerSettings({ fresh: true });
  const missing = [];
  if (!settings.recallRegion || !RECALL_REGIONS.includes(settings.recallRegion)) {
    missing.push('RECALL_REGION');
  }
  if (!settings.recallApiKey) missing.push('RECALL_API_KEY');
  if (!settings.recallWebhookSecret) missing.push('RECALL_WEBHOOK_VERIFICATION_SECRET');
  let publicUrlOk = false;
  try {
    assertPublicRecallUrl(settings.publicApiBaseUrl, 'PUBLIC_API_BASE_URL');
    publicUrlOk = true;
  } catch {
    missing.push('PUBLIC_API_BASE_URL');
  }
  return {
    region: settings.recallRegion,
    ready: missing.length === 0,
    publicUrlOk,
    missing,
  };
}

async function logRecallStartupSummary() {
  const status = await validateRecallStartupConfig();
  const missingInfo = status.missing.length ? `, missing=[${status.missing.join(',')}]` : '';
  console.log(`[recall] configured region: ${status.region} (ready=${status.ready}${missingInfo})`);
  return status;
}

function toNotetakerAdminView(settings, { publicBaseUrl } = {}) {
  const baseUrl = resolvePublicApiBaseUrl({ publicBaseUrl });
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
    chatNoticeEnabled: settings.chatNoticeEnabled,
    chatNoticeText: settings.chatNoticeText,
    calendarConnectedRedirectUri: `${baseUrl}/api/v2/notetaker/calendar/oauth/callback`,
    hasCalendarRegionalCallbackUri: Boolean(settings.calendarRegionalCallbackUri),
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
    recall_region: row?.recall_region || DEFAULT_REGION,
    recall_api_key_enc: row?.recall_api_key_enc || null,
    recall_webhook_secret_enc: row?.recall_webhook_secret_enc || null,
    transcript_mode: row?.transcript_mode || 'recallai_async',
    xai_fallback_enabled: row?.xai_fallback_enabled ?? 0,
    delete_recall_media_after_ingest: row?.delete_recall_media_after_ingest ?? 1,
    waiting_room_timeout_sec: row?.waiting_room_timeout_sec ?? 600,
    everyone_left_timeout_sec: row?.everyone_left_timeout_sec ?? 30,
    chat_notice_enabled: row?.chat_notice_enabled ?? 1,
    chat_notice_text: row?.chat_notice_text ?? DEFAULT_CHAT_NOTICE,
    calendar_regional_callback_uri: row?.calendar_regional_callback_uri || null,
    calendar_setup_id: row?.calendar_setup_id || null,
  };

  if (body.driverMode !== undefined) {
    const dm = String(body.driverMode || '').trim().toLowerCase();
    if (!DRIVER_MODES.includes(dm)) return { ok: false, error: 'Invalid driverMode' };
    next.driver_mode = dm;
  }

  if (body.recallRegion !== undefined) {
    const reg = String(body.recallRegion || '').trim().toLowerCase();
    if (!RECALL_REGIONS.includes(reg)) return { ok: false, error: 'Invalid recallRegion' };
    next.recall_region = reg;
  }

  if (body.transcriptMode !== undefined) {
    const tm = String(body.transcriptMode || '').trim().toLowerCase();
    if (!TRANSCRIPT_MODES.includes(tm)) return { ok: false, error: 'Invalid transcriptMode' };
    next.transcript_mode = tm;
  }

  if (body.clearRecallApiKey) {
    next.recall_api_key_enc = null;
  } else if (body.recallApiKey !== undefined && String(body.recallApiKey).trim() !== '') {
    const trimmed = String(body.recallApiKey).trim();
    if (trimmed.length < 8) return { ok: false, error: 'Recall API key looks too short' };
    next.recall_api_key_enc = encryptSecret(trimmed);
  }

  if (body.clearRecallWebhookSecret) {
    next.recall_webhook_secret_enc = null;
  } else if (body.recallWebhookSecret !== undefined && String(body.recallWebhookSecret).trim() !== '') {
    const trimmed = String(body.recallWebhookSecret).trim();
    if (!trimmed.startsWith('whsec_') || trimmed.length < 16) {
      return { ok: false, error: 'Recall webhook verification secret must start with whsec_' };
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
  if (body.chatNoticeEnabled !== undefined) {
    next.chat_notice_enabled = body.chatNoticeEnabled ? 1 : 0;
  }
  if (body.chatNoticeText !== undefined) {
    next.chat_notice_text = String(body.chatNoticeText || '').trim().slice(0, 300) || DEFAULT_CHAT_NOTICE;
  }
  if (body.calendarRegionalCallbackUri !== undefined) {
    next.calendar_regional_callback_uri = body.calendarRegionalCallbackUri
      ? String(body.calendarRegionalCallbackUri).trim().slice(0, 1000)
      : null;
  }
  if (body.calendarSetupId !== undefined) {
    next.calendar_setup_id = body.calendarSetupId ? String(body.calendarSetupId).trim().slice(0, 128) : null;
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
           chat_notice_enabled = ?,
           chat_notice_text = ?,
           calendar_regional_callback_uri = ?,
           calendar_setup_id = ?,
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
        next.chat_notice_enabled,
        next.chat_notice_text,
        next.calendar_regional_callback_uri,
        next.calendar_setup_id,
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
         waiting_room_timeout_sec, everyone_left_timeout_sec,
         chat_notice_enabled, chat_notice_text, calendar_regional_callback_uri, calendar_setup_id,
         updated_at, updated_by
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        next.chat_notice_enabled,
        next.chat_notice_text,
        next.calendar_regional_callback_uri,
        next.calendar_setup_id,
        nowIso,
        actorEmail || null,
      ]
    );
  }

  invalidateNotetakerSettingsCache();
  const settings = await getNotetakerSettings({ fresh: true });
  return { ok: true, settings, reason };
}

function recallApiBase(region, version = 'v1') {
  return `https://${normalizeRegion(region)}.recall.ai/api/${version}`;
}

/**
 * Verifies Recall.ai webhook / callback / websocket requests per authenticating-requests-from-recallai.
 */
function verifyRequestFromRecall({ secret, headers = {}, rawBody = null, maxSkewSeconds = 300 }) {
  const normalizedHeaders = {};
  for (const [k, v] of Object.entries(headers || {})) {
    normalizedHeaders[String(k).toLowerCase()] = Array.isArray(v) ? v.join(',') : v;
  }

  const msgId = normalizedHeaders['webhook-id'] ?? normalizedHeaders['svix-id'];
  const msgTimestamp = normalizedHeaders['webhook-timestamp'] ?? normalizedHeaders['svix-timestamp'];
  const msgSignature = normalizedHeaders['webhook-signature'] ?? normalizedHeaders['svix-signature'];

  if (!secret || typeof secret !== 'string' || !secret.startsWith('whsec_')) {
    return { ok: false, reason: 'missing_secret' };
  }
  if (!msgId || !msgTimestamp || !msgSignature) {
    return { ok: false, reason: 'missing_headers' };
  }

  const ts = Number(msgTimestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'bad_timestamp' };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > maxSkewSeconds) {
    return { ok: false, reason: 'timestamp_skew' };
  }

  let keyBytes;
  try {
    keyBytes = Buffer.from(secret.slice('whsec_'.length), 'base64');
  } catch {
    return { ok: false, reason: 'bad_secret' };
  }

  let payloadStr = '';
  if (rawBody !== null && rawBody !== undefined) {
    payloadStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  }

  const toSign = `${msgId}.${msgTimestamp}.${payloadStr}`;
  const expectedSigBytes = Buffer.from(
    crypto.createHmac('sha256', keyBytes).update(toSign).digest('base64'),
    'base64'
  );

  for (const versionedSig of String(msgSignature).split(' ')) {
    const idx = versionedSig.indexOf(',');
    if (idx <= 0) continue;
    const version = versionedSig.slice(0, idx);
    const sigB64 = versionedSig.slice(idx + 1);
    if (version !== 'v1' || !sigB64) continue;
    try {
      const sigBytes = Buffer.from(sigB64, 'base64');
      if (sigBytes.length === expectedSigBytes.length && crypto.timingSafeEqual(expectedSigBytes, sigBytes)) {
        return { ok: true, webhookId: String(msgId) };
      }
    } catch {
      /* continue */
    }
  }

  return { ok: false, reason: 'sig_mismatch' };
}

/**
 * Retries Recall HTTP 429 (honoring Retry-After), 503, and 507 responses with jitter.
 */
async function fetchWithRecallRetry(
  url,
  options = {},
  { fetchImpl = global.fetch, maxAttempts = 6, retryNetwork = false, baseDelayMs = 1000 } = {}
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        signal: AbortSignal.timeout(15_000),
        ...options,
      });
    } catch (err) {
      if (!retryNetwork || attempt >= maxAttempts) throw err;
      const delay = baseDelayMs * Math.min(8, 2 ** (attempt - 1));
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    let waitSeconds = 0;
    if (response.status === 429) {
      const ra = response.headers?.get?.('Retry-After') || response.headers?.get?.('retry-after');
      waitSeconds = Math.max(1, parseInt(ra || '1', 10) || 1);
    } else if (response.status === 503) {
      waitSeconds = 10;
    } else if (response.status === 507) {
      waitSeconds = 30;
    }

    if (waitSeconds > 0 && attempt < maxAttempts) {
      const jitter = Math.ceil(Math.random() * 5);
      const waitMs = baseDelayMs * (waitSeconds + (baseDelayMs >= 500 ? jitter : 1));
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    return response;
  }

  throw new Error(`Max attempts (${maxAttempts}) reached while calling Recall API`);
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

  const startRegion = normalizeRegion(region || settings.recallRegion, DEFAULT_REGION);
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

function summarizeRecallError(data, statusCode) {
  const raw =
    data?.detail ||
    data?.error ||
    data?.message ||
    (typeof data === 'object' && data ? JSON.stringify(data) : '');
  return String(raw || `Recall API returned HTTP ${statusCode}`).trim().slice(0, 260);
}

/**
 * Builds unified Create Bot / Calendar V2 bot_config payload.
 */
function buildRecallBotPayload({
  meetingUrl,
  joinAtIso,
  botDisplayName,
  platform,
  settings,
  metadata = {},
  omitMeetingUrl = false,
}) {
  const payload = {
    bot_name: botDisplayName || 'Lalia Notetaker',
    join_at: joinAtIso || new Date().toISOString(),
    metadata,
    recording_config: {
      audio_mixed_mp3: {},
    },
    automatic_leave: {
      waiting_room_timeout: settings.waitingRoomTimeoutSec || 600,
      noone_joined_timeout: 900,
      everyone_left_timeout: {
        timeout: settings.everyoneLeftTimeoutSec || 30,
        activate_after: null,
      },
    },
  };

  if (!omitMeetingUrl && meetingUrl) {
    payload.meeting_url = meetingUrl;
  }

  if (settings.transcriptMode === 'meeting_captions' && platform !== 'webex') {
    payload.recording_config.transcript = { provider: { meeting_captions: {} } };
  }

  // Recall chat.on_bot_join supports Zoom, Google Meet, and Microsoft Teams (not Webex).
  if (settings.chatNoticeEnabled && platform !== 'webex') {
    payload.chat = {
      on_bot_join: {
        send_to: 'everyone',
        message: settings.chatNoticeText || DEFAULT_CHAT_NOTICE,
      },
    };
  }

  return payload;
}

async function dispatchRecallBotForSession(sessionId, { fetchImpl = global.fetch, retryOptions } = {}) {
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
  const joinAtIso = Number.isFinite(schedMs) ? new Date(schedMs).toISOString() : nowIso;

  const payload = buildRecallBotPayload({
    meetingUrl: session.normalized_url || session.target_url,
    joinAtIso,
    botDisplayName: session.bot_display_name || 'Lalia Notetaker',
    platform: session.platform,
    settings,
    metadata: {
      lalia_session_id: session.id,
      lalia_meeting_id: session.meeting_id,
      lalia_org_id: session.org_id,
    },
  });

  let res;
  let botData = null;
  try {
    res = await fetchWithRecallRetry(
      `${recallApiBase(settings.recallRegion)}/bot/`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${settings.recallApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      { fetchImpl, retryNetwork: false, ...retryOptions }
    );
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
    const delRes = await fetchWithRecallRetry(
      `${botBase}/`,
      { method: 'DELETE', headers },
      { fetchImpl, maxAttempts: 3, retryNetwork: true }
    ).catch(() => ({ ok: false, status: 0 }));

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
    const leaveRes = await fetchWithRecallRetry(
      `${botBase}/leave_call/`,
      { method: 'POST', headers },
      { fetchImpl, maxAttempts: 3, retryNetwork: true }
    ).catch(() => ({ ok: false, status: 0 }));

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

/**
 * Converts Recall normalized transcript JSON (word/chunk array) into speaker-grouped
 * readable utterances while filtering out the bot's own utterances.
 */
function convertRecallTranscriptToReadableLines(rawJson, { baseStartMs, botDisplayName = '' } = {}) {
  const items = Array.isArray(rawJson)
    ? rawJson
    : Array.isArray(rawJson?.transcript)
      ? rawJson.transcript
      : Array.isArray(rawJson?.results)
        ? rawJson.results
        : [];

  const baseMs = Number.isFinite(baseStartMs) ? baseStartMs : Date.now();
  const botLower = String(botDisplayName || '').trim().toLowerCase();
  const grouped = [];
  let current = null;

  const flush = () => {
    if (!current || !current.tokens.length) return;
    const text = current.tokens.join(' ').replace(/\s+([,.;!?])/g, '$1').trim();
    if (text) {
      grouped.push({
        participant_identity: current.speaker,
        original_text: text,
        language: current.language || 'en',
        transcription_id: `recall-${grouped.length}`,
        recorded_at: current.recordedAt,
      });
    }
    current = null;
  };

  for (const item of items) {
    const words = Array.isArray(item?.words) ? item.words : [];
    const chunkText = String(
      item?.text ||
        words
          .map((w) => w?.text || w?.word || '')
          .filter(Boolean)
          .join(' ')
    ).trim();
    if (!chunkText) continue;

    const speakerRaw =
      item?.participant?.name ||
      item?.speaker ||
      (item?.participant?.id != null ? `Speaker ${item.participant.id}` : 'Speaker');
    const speaker = String(speakerRaw).trim().slice(0, 200) || 'Speaker';
    if (botLower && speaker.toLowerCase() === botLower) continue;

    const relStart =
      extractRelativeSeconds(item?.start_timestamp) ??
      extractRelativeSeconds(words[0]?.start_timestamp) ??
      (typeof words[0]?.start_time === 'number' ? Math.max(0, words[0].start_time) : 0);
    const relEnd =
      extractRelativeSeconds(item?.end_timestamp) ??
      extractRelativeSeconds(words[words.length - 1]?.end_timestamp) ??
      relStart;

    const recordedAt =
      item?.start_timestamp?.absolute ||
      words[0]?.start_timestamp?.absolute ||
      new Date(baseMs + (relStart || 0) * 1000).toISOString();

    const language = String(item?.language_code || item?.language || 'en').trim().slice(0, 32) || 'en';
    const gapSec = current ? Math.max(0, relStart - current.lastEndSec) : 0;
    const shouldSplit =
      !current ||
      current.speaker !== speaker ||
      current.tokens.length >= 60 ||
      gapSec > 4.0;

    if (shouldSplit) {
      flush();
      current = {
        speaker,
        language,
        recordedAt,
        lastEndSec: relEnd,
        tokens: [chunkText],
      };
    } else {
      current.tokens.push(chunkText);
      current.lastEndSec = Math.max(current.lastEndSec, relEnd);
    }
  }

  flush();
  return grouped;
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

async function recordNotetakerCostEvents({ meeting, session, durationSeconds }) {
  const roomName = meeting?.livekit_room_name;
  if (!roomName || !durationSeconds || durationSeconds <= 0) return;

  const existing = await db
    .get(`SELECT id FROM meeting_cost_events WHERE meeting_id = ? AND event_type = 'recall_bot_minute' LIMIT 1`, [
      roomName,
    ])
    .catch(() => null);
  if (existing) return;

  const botMinutes = Number((durationSeconds / 60).toFixed(4));
  if (botMinutes <= 0) return;

  let hasOutbox = false;
  try {
    await db.get(`SELECT 1 FROM ops_business_outbox LIMIT 1`);
    hasOutbox = true;
  } catch {
    hasOutbox = false;
  }

  const ts = Date.now();
  await db.transaction(async (tx) => {
    await insertCostEventRow(tx, {
      meetingRoomName: roomName,
      orgId: meeting.org_id,
      eventType: 'recall_bot_minute',
      units: botMinutes,
      ts,
      meta: { platform: session.platform, bot_session_id: session.id, external_bot_id: session.external_bot_id },
      hasOutbox,
    });

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
      [roomName, meeting.org_id, totalCost, JSON.stringify(breakdown), durationSeconds, ts]
    );
  });
}

async function downloadPresignedBuffer(url, fetchImpl) {
  // Never send Recall API Authorization headers to presigned S3 URLs.
  const res = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    throw new Error(`Artifact download failed (${res.status})`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function findSessionForWebhook(event) {
  const data = event?.data || {};
  const botId = data?.bot?.id || data?.bot_id || event?.bot?.id || null;
  const recordingId = data?.recording?.id || null;
  const transcriptId = data?.transcript?.id || null;
  const metaSessionId = data?.bot?.metadata?.lalia_session_id || data?.recording?.metadata?.lalia_session_id || null;

  if (botId) {
    const byBot = await db.get(`SELECT * FROM v2_external_bot_sessions WHERE external_bot_id = ? LIMIT 1`, [
      String(botId),
    ]);
    if (byBot) return byBot;
  }
  if (recordingId) {
    const byRec = await db.get(`SELECT * FROM v2_external_bot_sessions WHERE external_recording_id = ? LIMIT 1`, [
      String(recordingId),
    ]);
    if (byRec) return byRec;
  }
  if (transcriptId) {
    const byTr = await db.get(`SELECT * FROM v2_external_bot_sessions WHERE external_transcript_id = ? LIMIT 1`, [
      String(transcriptId),
    ]);
    if (byTr) return byTr;
  }
  if (metaSessionId) {
    const byMeta = await db.get(`SELECT * FROM v2_external_bot_sessions WHERE id = ? LIMIT 1`, [String(metaSessionId)]);
    if (byMeta) return byMeta;
  }

  const calEventId = data?.bot?.metadata?.lalia_calendar_event_id || null;
  if (calEventId) {
    const byCal = await db.get(`SELECT * FROM v2_external_bot_sessions WHERE calendar_event_id = ? LIMIT 1`, [
      String(calEventId),
    ]);
    if (byCal) return byCal;
  }

  return null;
}

async function handleBotLifecycleWebhook(session, event) {
  const evName = String(event?.event || '').toLowerCase();
  const statusObj = event?.data?.data || {};
  const code = String(statusObj.code || evName.replace(/^bot\./, '')).toLowerCase();
  const subCode = statusObj.sub_code ? String(statusObj.sub_code) : null;
  const updatedAt = statusObj.updated_at || new Date().toISOString();
  const nowIso = new Date().toISOString();
  const label = platformDisplayName(session.platform);

  if (code === 'fatal') {
    const errDetail = humanFatalReason(subCode, statusObj.message);
    await db.run(
      `UPDATE v2_external_bot_sessions
       SET status = 'failed', error_code = ?, status_detail = ?, heartbeat_at = ?,
           ended_at = COALESCE(ended_at, ?), updated_at = ?
       WHERE id = ?`,
      [String(subCode || 'recall_fatal').slice(0, 64), errDetail, nowIso, updatedAt, nowIso, session.id]
    );
    await db.run(`UPDATE v2_meetings SET status = 'ended', ended_at = COALESCE(ended_at, ?) WHERE id = ?`, [
      updatedAt,
      session.meeting_id,
    ]);
    return { ok: true, status: 'failed', errorCode: subCode };
  }

  let nextStatus = session.status;
  let nextDetail = session.status_detail;
  let joinedAt = session.joined_at;
  let endedAt = session.ended_at;

  switch (code) {
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
      nextDetail = `Recording audio in ${label}`;
      joinedAt = joinedAt || updatedAt;
      await db.run(
        `UPDATE v2_meetings SET status = 'live', started_at = COALESCE(started_at, ?) WHERE id = ?`,
        [joinedAt, session.meeting_id]
      );
      break;
    case 'recording_permission_denied':
      nextStatus = 'processing';
      nextDetail = 'Recording permission denied in call';
      endedAt = endedAt || updatedAt;
      break;
    case 'call_ended':
      nextStatus = 'processing';
      nextDetail = 'Call ended — finalizing recording…';
      endedAt = endedAt || updatedAt;
      break;
    case 'done': {
      if (session.external_recording_id || session.transcript_requested_at || session.ingested_at) {
        // Recording/transcript webhooks handle processing & completion.
        return { ok: true, status: session.status };
      }
      if (!session.joined_at) {
        nextStatus = 'completed';
        nextDetail = subCode ? `Call ended (${subCode})` : 'Call ended before recording started';
        endedAt = endedAt || updatedAt;
        await db.run(`UPDATE v2_meetings SET status = 'ended', ended_at = COALESCE(ended_at, ?) WHERE id = ?`, [
          endedAt,
          session.meeting_id,
        ]);
      } else {
        nextStatus = 'processing';
        nextDetail = 'Bot shut down — awaiting recording artifact…';
        endedAt = endedAt || updatedAt;
      }
      break;
    }
    default:
      break;
  }

  await db.run(
    `UPDATE v2_external_bot_sessions
     SET status = ?, status_detail = ?, joined_at = ?, ended_at = ?, heartbeat_at = ?, updated_at = ?
     WHERE id = ?`,
    [nextStatus, nextDetail, joinedAt, endedAt, nowIso, nowIso, session.id]
  );

  return { ok: true, status: nextStatus };
}

async function saveRecordingArtifactToStorage(session, recordingData, { fetchImpl }) {
  const audioUrl = recordingData?.media_shortcuts?.audio_mixed?.data?.download_url || null;
  if (!audioUrl) return null;

  const existingRec = await db.get(`SELECT id FROM v2_meeting_recordings WHERE bot_session_id = ? LIMIT 1`, [
    session.id,
  ]);
  if (existingRec) return existingRec;

  const audioBuf = await downloadPresignedBuffer(audioUrl, fetchImpl);
  if (!audioBuf.length) return null;

  let durationSeconds = session.duration_seconds || null;
  if (recordingData.started_at && recordingData.completed_at) {
    const ms = new Date(recordingData.completed_at).getTime() - new Date(recordingData.started_at).getTime();
    if (Number.isFinite(ms) && ms > 0) {
      durationSeconds = Math.max(1, Math.round(ms / 1000));
    }
  }

  const nowIso = new Date().toISOString();
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
      durationSeconds,
      nowIso,
    ]
  );

  if (durationSeconds) {
    await db.run(
      `UPDATE v2_external_bot_sessions SET duration_seconds = COALESCE(duration_seconds, ?) WHERE id = ?`,
      [durationSeconds, session.id]
    );
  }
  return { id: recordingId, durationSeconds };
}

async function handleRecordingDoneWebhook(session, event, settings, { fetchImpl, retryOptions, publicBaseUrl }) {
  const recordingId = event?.data?.recording?.id;
  if (!recordingId || !settings.recallApiKey) {
    return { ok: false, error: 'Missing recording ID or API key' };
  }

  const nowIso = new Date().toISOString();
  await db.run(
    `UPDATE v2_external_bot_sessions
     SET external_recording_id = COALESCE(external_recording_id, ?),
         status = 'processing',
         status_detail = 'Saving recording & starting Recall.ai transcription…',
         heartbeat_at = ?,
         updated_at = ?
     WHERE id = ?`,
    [String(recordingId), nowIso, nowIso, session.id]
  );

  const recRes = await fetchWithRecallRetry(
    `${recallApiBase(settings.recallRegion)}/recording/${encodeURIComponent(recordingId)}/`,
    {
      method: 'GET',
      headers: { Authorization: `Token ${settings.recallApiKey}` },
    },
    { fetchImpl, retryNetwork: true, ...retryOptions }
  );
  if (!recRes.ok) {
    throw new Error(`Retrieve Recording returned HTTP ${recRes.status}`);
  }
  const recordingData = await recRes.json();

  await saveRecordingArtifactToStorage(session, recordingData, { fetchImpl }).catch((err) => {
    console.warn(`[recallNotetaker] Audio download warning (${session.id}):`, err.message);
  });

  // If transcript shortcut is already populated (e.g. meeting_captions fallback), ingest immediately
  const inlineTranscriptUrl = recordingData?.media_shortcuts?.transcript?.data?.download_url || null;
  const refreshed = await db.get(`SELECT * FROM v2_external_bot_sessions WHERE id = ?`, [session.id]);

  if (settings.transcriptMode === 'meeting_captions' && inlineTranscriptUrl && !refreshed.ingested_at) {
    const trRes = await fetchImpl(inlineTranscriptUrl, { method: 'GET', signal: AbortSignal.timeout(60_000) });
    if (trRes.ok) {
      const json = await trRes.json();
      const baseMs = recordingData.started_at
        ? new Date(recordingData.started_at).getTime()
        : refreshed.joined_at
          ? new Date(refreshed.joined_at).getTime()
          : Date.now();
      const lines = convertRecallTranscriptToReadableLines(json, {
        baseStartMs: baseMs,
        botDisplayName: refreshed.bot_display_name,
      });
      if (lines.length > 0) {
        await ingestBotTranscriptLines(refreshed.meeting_id, lines);
        const meeting = await db.get(`SELECT * FROM v2_meetings WHERE id = ?`, [refreshed.meeting_id]);
        if (meeting) {
          await recordNotetakerCostEvents({
            meeting,
            session: refreshed,
            durationSeconds: refreshed.duration_seconds || 0,
          }).catch(() => {});
        }
        await finalizeBotSessionAndRunPipeline(refreshed.id, { publicBaseUrl });
        await db.run(`UPDATE v2_external_bot_sessions SET ingested_at = ?, updated_at = ? WHERE id = ?`, [
          new Date().toISOString(),
          new Date().toISOString(),
          refreshed.id,
        ]);
        return { ok: true, status: 'completed', lineCount: lines.length };
      }
    }
  }

  // Trigger Recall.ai v1.11 Post-Meeting Async Transcription idempotently.
  if (!refreshed.transcript_requested_at) {
    const trCreateRes = await fetchWithRecallRetry(
      `${recallApiBase(settings.recallRegion)}/recording/${encodeURIComponent(recordingId)}/create_transcript/`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${settings.recallApiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          provider: {
            recallai_async: {
              language_code: 'auto',
            },
          },
          diarization: {
            use_separate_streams_when_available: true,
          },
        }),
      },
      { fetchImpl, retryNetwork: false, ...retryOptions }
    );
    if (!trCreateRes.ok) {
      const errBody = await trCreateRes.json().catch(() => null);
      throw new Error(`Create Async Transcript failed: ${summarizeRecallError(errBody, trCreateRes.status)}`);
    }
    const createdTranscript = await trCreateRes.json().catch(() => ({}));
    const reqIso = new Date().toISOString();
    await db.run(
      `UPDATE v2_external_bot_sessions
       SET external_transcript_id = COALESCE(external_transcript_id, ?),
           transcript_requested_at = COALESCE(transcript_requested_at, ?),
           status = 'processing',
           status_detail = 'Transcribing recording with Recall.ai…',
           updated_at = ?
       WHERE id = ?`,
      [createdTranscript?.id ? String(createdTranscript.id) : null, reqIso, reqIso, session.id]
    );
  }

  return { ok: true, status: 'transcribing', recordingId: String(recordingId) };
}

async function handleTranscriptDoneWebhook(session, event, settings, { fetchImpl, retryOptions, publicBaseUrl }) {
  if (session.ingested_at) {
    return { ok: true, alreadyIngested: true };
  }

  const transcriptId = event?.data?.transcript?.id || session.external_transcript_id;
  if (!transcriptId || !settings.recallApiKey) {
    return { ok: false, error: 'Missing transcript ID or API key' };
  }

  const trRes = await fetchWithRecallRetry(
    `${recallApiBase(settings.recallRegion)}/transcript/${encodeURIComponent(transcriptId)}/`,
    {
      method: 'GET',
      headers: { Authorization: `Token ${settings.recallApiKey}` },
    },
    { fetchImpl, retryNetwork: true, ...retryOptions }
  );
  if (!trRes.ok) {
    throw new Error(`Retrieve Transcript returned HTTP ${trRes.status}`);
  }
  const transcriptMeta = await trRes.json();
  const downloadUrl = transcriptMeta?.data?.download_url;
  if (!downloadUrl) {
    throw new Error('Recall transcript has no download_url');
  }

  const rawRes = await fetchImpl(downloadUrl, { method: 'GET', signal: AbortSignal.timeout(60_000) });
  if (!rawRes.ok) {
    throw new Error(`Transcript download_url returned HTTP ${rawRes.status}`);
  }
  const rawTranscriptJson = await rawRes.json();

  const baseMs = session.joined_at ? new Date(session.joined_at).getTime() : Date.now();
  const lines = convertRecallTranscriptToReadableLines(rawTranscriptJson, {
    baseStartMs: baseMs,
    botDisplayName: session.bot_display_name,
  });

  if (lines.length > 0) {
    await ingestBotTranscriptLines(session.meeting_id, lines);
  }

  const meeting = await db.get(`SELECT * FROM v2_meetings WHERE id = ?`, [session.meeting_id]);
  if (meeting) {
    await recordNotetakerCostEvents({
      meeting,
      session,
      durationSeconds: session.duration_seconds || 0,
    }).catch((err) => {
      console.warn(`[recallNotetaker] Cost rollup warning (${session.id}):`, err.message);
    });
  }

  const pipelineResult = await finalizeBotSessionAndRunPipeline(session.id, { publicBaseUrl });
  const doneIso = new Date().toISOString();
  await db.run(
    `UPDATE v2_external_bot_sessions
     SET external_transcript_id = COALESCE(external_transcript_id, ?),
         ingested_at = COALESCE(ingested_at, ?),
         ended_at = COALESCE(ended_at, ?),
         updated_at = ?
     WHERE id = ?`,
    [String(transcriptId), doneIso, doneIso, doneIso, session.id]
  );

  if (settings.deleteRecallMediaAfterIngest && session.external_bot_id) {
    fetchImpl(
      `${recallApiBase(settings.recallRegion)}/bot/${encodeURIComponent(session.external_bot_id)}/delete_media/`,
      {
        method: 'POST',
        headers: { Authorization: `Token ${settings.recallApiKey}` },
        signal: AbortSignal.timeout(10_000),
      }
    ).catch(() => {});
  }

  return { ok: true, status: 'completed', lineCount: lines.length, ...pipelineResult };
}

/**
 * Processes a verified Recall.ai dashboard webhook event (bot.*, recording.*, transcript.*, calendar.*).
 */
async function processVerifiedRecallWebhookEvent(event, { fetchImpl = global.fetch, retryOptions, publicBaseUrl } = {}) {
  const eventType = String(event?.event || '').toLowerCase();

  if (eventType === 'calendar.update' || eventType === 'calendar.sync_events') {
    const calendarHandlers = require('./recallCalendarV2');
    const calendarId = event?.data?.calendar_id;
    if (!calendarId) return { ok: true, ignored: true };
    if (eventType === 'calendar.update') {
      return calendarHandlers.handleCalendarUpdateWebhook(calendarId, { fetchImpl, retryOptions });
    }
    return calendarHandlers.syncCalendarEventsFromRecall(calendarId, {
      updatedAtGte: event?.data?.last_updated_ts || null,
      fetchImpl,
      retryOptions,
    });
  }

  const session = await findSessionForWebhook(event);
  if (!session) {
    return { ok: true, unmatched: true, eventType };
  }

  const settings = await getNotetakerSettings();

  if (eventType === 'recording.done') {
    return handleRecordingDoneWebhook(session, event, settings, { fetchImpl, retryOptions, publicBaseUrl });
  }
  if (eventType === 'recording.failed') {
    const nowIso = new Date().toISOString();
    const sub = event?.data?.data?.sub_code || 'recording_failed';
    await db.run(
      `UPDATE v2_external_bot_sessions
       SET status = 'failed', error_code = ?, status_detail = 'Recording failed to process',
           ended_at = COALESCE(ended_at, ?), updated_at = ?
       WHERE id = ?`,
      [String(sub).slice(0, 64), nowIso, nowIso, session.id]
    );
    await db.run(`UPDATE v2_meetings SET status = 'ended', ended_at = COALESCE(ended_at, ?) WHERE id = ?`, [
      nowIso,
      session.meeting_id,
    ]);
    return { ok: true, status: 'failed' };
  }
  if (eventType === 'transcript.done') {
    return handleTranscriptDoneWebhook(session, event, settings, { fetchImpl, retryOptions, publicBaseUrl });
  }
  if (eventType === 'transcript.failed') {
    const sub = event?.data?.data?.sub_code || 'transcript_failed';
    const nowIso = new Date().toISOString();
    await db.run(
      `UPDATE v2_external_bot_sessions
       SET status_detail = ?, error_code = ?, updated_at = ?
       WHERE id = ?`,
      [`Recording saved (transcription unavailable: ${sub})`, String(sub).slice(0, 64), nowIso, session.id]
    );
    await finalizeBotSessionAndRunPipeline(session.id, { publicBaseUrl });
    await db.run(`UPDATE v2_external_bot_sessions SET ingested_at = COALESCE(ingested_at, ?) WHERE id = ?`, [
      nowIso,
      session.id,
    ]);
    return { ok: true, status: 'completed', transcriptFailed: true };
  }
  if (eventType.startsWith('bot.')) {
    return handleBotLifecycleWebhook(session, event);
  }

  return { ok: true, ignored: true, eventType };
}

module.exports = {
  RECALL_REGIONS,
  DRIVER_MODES,
  TRANSCRIPT_MODES,
  DEFAULT_CHAT_NOTICE,
  maskSecret,
  assertPublicRecallUrl,
  isPrivateOrLocalHostname,
  resolvePublicApiBaseUrl,
  getNotetakerSettings,
  saveNotetakerSettings,
  invalidateNotetakerSettingsCache,
  validateRecallStartupConfig,
  logRecallStartupSummary,
  toNotetakerAdminView,
  verifyRequestFromRecall,
  fetchWithRecallRetry,
  verifyRecallCredentials,
  persistDetectedRegionIfStored,
  buildRecallBotPayload,
  dispatchRecallBotForSession,
  stopRecallBotSession,
  processVerifiedRecallWebhookEvent,
  convertRecallTranscriptToReadableLines,
  recallApiBase,
};
