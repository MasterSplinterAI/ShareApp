/**
 * Automatic LiveKit self-hosted agent -> Cloud backup failover watchdog,
 * circuit breaker, and configurable admin notification engine.
 */
const axios = require('axios');
const db = require('../db/v2Database');
const { sendEmail } = require('./mailer');
const { encryptSecret, decryptSecret, maskSecret } = require('./secretCrypto');
const { superadminEmails } = require('./v2Superadmin');
const { mergeRoomMetadata } = require('./livekitRoomMetadata');

const SETTINGS_ID = 'default';
const PRIMARY_PIPELINE = 'selfhosted_xai';
const BACKUP_PIPELINE = 'deepgram_codeswitch';
const CACHE_MS = 3000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let settingsCache = null;
let settingsCacheAt = 0;

// In-process circuit breaker and watchdog timers.
let circuitOpenUntilMs = 0;
let incidentActive = false;
let lastFailoverAlertSentAtMs = 0;
let lastFailoverAt = null;
let lastRecoveryAt = null;
let totalFailoversSinceBoot = 0;
const activeWatchdogs = new Map();

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

function parseEmailList(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const seen = new Set();
  const out = [];
  for (const part of raw.split(',')) {
    const email = part.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

function decryptTelegramToken(row) {
  if (!row?.telegram_bot_token_enc) return null;
  try {
    return decryptSecret(row.telegram_bot_token_enc);
  } catch (err) {
    console.warn('[agentFailover] Failed to decrypt Telegram bot token:', err.message);
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function mergeAlertSettings(row) {
  const envEmails = [...superadminEmails()];
  const dbEmailsRaw = row?.email_recipients ? String(row.email_recipients).trim() : '';
  const dbEmails = parseEmailList(dbEmailsRaw);

  const envTelegramToken = String(process.env.SUPPORT_TELEGRAM_BOT_TOKEN || '').trim() || null;
  const dbTelegramToken = decryptTelegramToken(row);
  const envTelegramChatId = String(process.env.SUPPORT_TELEGRAM_CHAT_ID || '').trim() || null;
  const dbTelegramChatId = row?.telegram_chat_id ? String(row.telegram_chat_id).trim() : null;

  const hasDbOverrides = Boolean(
    row &&
      (dbEmailsRaw ||
        dbTelegramToken ||
        dbTelegramChatId ||
        row.updated_at ||
        row.updated_by)
  );
  const hasEnv = Boolean(envEmails.length || (envTelegramToken && envTelegramChatId));
  let source = 'environment';
  if (hasDbOverrides && hasEnv) source = 'mixed';
  else if (hasDbOverrides) source = 'database';

  return {
    failoverEnabled: toBool(row?.failover_enabled, true),
    joinTimeoutSec: clampInt(row?.join_timeout_sec, 10, 5, 45),
    circuitCooldownSec: clampInt(row?.circuit_cooldown_sec, 120, 30, 1800),
    alertCooldownMinutes: clampInt(row?.alert_cooldown_minutes, 15, 1, 240),
    bannerEnabled: toBool(row?.banner_enabled, true),
    emailEnabled: toBool(row?.email_enabled, true),
    emailRecipientsOverride: dbEmailsRaw,
    effectiveEmails: dbEmails.length ? dbEmails : envEmails,
    envEmails,
    telegramEnabled: toBool(row?.telegram_enabled, true),
    hasDbTelegramToken: Boolean(dbTelegramToken),
    hasEnvTelegramToken: Boolean(envTelegramToken),
    effectiveTelegramBotToken: dbTelegramToken || envTelegramToken,
    telegramChatIdOverride: dbTelegramChatId || '',
    hasDbTelegramChatId: Boolean(dbTelegramChatId),
    hasEnvTelegramChatId: Boolean(envTelegramChatId),
    effectiveTelegramChatId: dbTelegramChatId || envTelegramChatId,
    notifyOnRecovery: toBool(row?.notify_on_recovery, true),
    source,
    updatedAt: row?.updated_at || null,
    updatedBy: row?.updated_by || null,
  };
}

function invalidateAgentAlertSettingsCache() {
  settingsCache = null;
  settingsCacheAt = 0;
}

async function loadAlertSettingsRow() {
  return db.get(`SELECT * FROM v2_platform_alert_settings WHERE id = ?`, [SETTINGS_ID]);
}

async function getAgentAlertSettings({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && settingsCache && now - settingsCacheAt < CACHE_MS) {
    return settingsCache;
  }
  let row = null;
  try {
    row = await loadAlertSettingsRow();
  } catch {
    // Allow pure unit tests without DB initialization to use safe defaults.
    row = null;
  }
  const merged = mergeAlertSettings(row);
  settingsCache = merged;
  settingsCacheAt = now;
  return merged;
}

async function saveAgentAlertSettings(actorEmail, body = {}) {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 4) {
    return { ok: false, error: 'reason required (4+ chars)' };
  }

  const row = await loadAlertSettingsRow();
  const next = {
    failover_enabled: row ? (row.failover_enabled ? 1 : 0) : 1,
    join_timeout_sec: row?.join_timeout_sec ?? 10,
    circuit_cooldown_sec: row?.circuit_cooldown_sec ?? 120,
    alert_cooldown_minutes: row?.alert_cooldown_minutes ?? 15,
    banner_enabled: row ? (row.banner_enabled ? 1 : 0) : 1,
    email_enabled: row ? (row.email_enabled ? 1 : 0) : 1,
    email_recipients: row?.email_recipients ?? null,
    telegram_enabled: row ? (row.telegram_enabled ? 1 : 0) : 1,
    telegram_bot_token_enc: row?.telegram_bot_token_enc ?? null,
    telegram_chat_id: row?.telegram_chat_id ?? null,
    notify_on_recovery: row ? (row.notify_on_recovery ? 1 : 0) : 1,
  };

  if (body.failoverEnabled !== undefined) next.failover_enabled = toBool(body.failoverEnabled, true) ? 1 : 0;
  if (body.bannerEnabled !== undefined) next.banner_enabled = toBool(body.bannerEnabled, true) ? 1 : 0;
  if (body.emailEnabled !== undefined) next.email_enabled = toBool(body.emailEnabled, true) ? 1 : 0;
  if (body.telegramEnabled !== undefined) next.telegram_enabled = toBool(body.telegramEnabled, true) ? 1 : 0;
  if (body.notifyOnRecovery !== undefined) next.notify_on_recovery = toBool(body.notifyOnRecovery, true) ? 1 : 0;

  if (body.joinTimeoutSec !== undefined) {
    const val = Number(body.joinTimeoutSec);
    if (!Number.isFinite(val) || val < 5 || val > 45) {
      return { ok: false, error: 'joinTimeoutSec must be between 5 and 45 seconds' };
    }
    next.join_timeout_sec = Math.round(val);
  }
  if (body.circuitCooldownSec !== undefined) {
    const val = Number(body.circuitCooldownSec);
    if (!Number.isFinite(val) || val < 30 || val > 1800) {
      return { ok: false, error: 'circuitCooldownSec must be between 30 and 1800 seconds' };
    }
    next.circuit_cooldown_sec = Math.round(val);
  }
  if (body.alertCooldownMinutes !== undefined) {
    const val = Number(body.alertCooldownMinutes);
    if (!Number.isFinite(val) || val < 1 || val > 240) {
      return { ok: false, error: 'alertCooldownMinutes must be between 1 and 240 minutes' };
    }
    next.alert_cooldown_minutes = Math.round(val);
  }

  if (body.clearEmailRecipients) {
    next.email_recipients = null;
  } else if (body.emailRecipients !== undefined) {
    const raw = String(body.emailRecipients || '').trim();
    if (!raw) {
      next.email_recipients = null;
    } else {
      const parsed = parseEmailList(raw);
      if (parsed.length === 0 || parsed.length > 10 || parsed.some((e) => !EMAIL_RE.test(e))) {
        return { ok: false, error: 'emailRecipients must contain 1–10 valid comma-separated email addresses' };
      }
      next.email_recipients = parsed.join(', ');
    }
  }

  if (body.clearTelegramBotToken) {
    next.telegram_bot_token_enc = null;
  } else if (body.telegramBotToken !== undefined && String(body.telegramBotToken).trim() !== '') {
    const token = String(body.telegramBotToken).trim();
    if (token.length < 16 || !token.includes(':')) {
      return { ok: false, error: 'telegramBotToken format looks invalid' };
    }
    next.telegram_bot_token_enc = encryptSecret(token);
  }

  if (body.clearTelegramChatId) {
    next.telegram_chat_id = null;
  } else if (body.telegramChatId !== undefined) {
    const chatId = String(body.telegramChatId || '').trim();
    if (!chatId) {
      next.telegram_chat_id = null;
    } else if (!/^-?\d{4,32}$/.test(chatId)) {
      return { ok: false, error: 'telegramChatId must be a numeric Telegram chat/user ID' };
    } else {
      next.telegram_chat_id = chatId;
    }
  }

  const now = new Date().toISOString();
  if (row) {
    await db.run(
      `UPDATE v2_platform_alert_settings SET
        failover_enabled = ?, join_timeout_sec = ?, circuit_cooldown_sec = ?, alert_cooldown_minutes = ?,
        banner_enabled = ?, email_enabled = ?, email_recipients = ?, telegram_enabled = ?,
        telegram_bot_token_enc = ?, telegram_chat_id = ?, notify_on_recovery = ?, updated_at = ?, updated_by = ?
       WHERE id = ?`,
      [
        next.failover_enabled,
        next.join_timeout_sec,
        next.circuit_cooldown_sec,
        next.alert_cooldown_minutes,
        next.banner_enabled,
        next.email_enabled,
        next.email_recipients,
        next.telegram_enabled,
        next.telegram_bot_token_enc,
        next.telegram_chat_id,
        next.notify_on_recovery,
        now,
        actorEmail,
        SETTINGS_ID,
      ]
    );
  } else {
    await db.run(
      `INSERT INTO v2_platform_alert_settings (
        id, failover_enabled, join_timeout_sec, circuit_cooldown_sec, alert_cooldown_minutes,
        banner_enabled, email_enabled, email_recipients, telegram_enabled, telegram_bot_token_enc,
        telegram_chat_id, notify_on_recovery, updated_at, updated_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        SETTINGS_ID,
        next.failover_enabled,
        next.join_timeout_sec,
        next.circuit_cooldown_sec,
        next.alert_cooldown_minutes,
        next.banner_enabled,
        next.email_enabled,
        next.email_recipients,
        next.telegram_enabled,
        next.telegram_bot_token_enc,
        next.telegram_chat_id,
        next.notify_on_recovery,
        now,
        actorEmail,
      ]
    );
  }

  invalidateAgentAlertSettingsCache();
  const settings = await getAgentAlertSettings({ fresh: true });
  return { ok: true, settings, reason };
}

function toAgentAlertAdminView(settings) {
  return {
    failoverEnabled: settings.failoverEnabled,
    joinTimeoutSec: settings.joinTimeoutSec,
    circuitCooldownSec: settings.circuitCooldownSec,
    alertCooldownMinutes: settings.alertCooldownMinutes,
    bannerEnabled: settings.bannerEnabled,
    emailEnabled: settings.emailEnabled,
    emailRecipients: settings.emailRecipientsOverride || '',
    effectiveEmails: settings.effectiveEmails,
    envEmails: settings.envEmails,
    usingEnvEmailRecipients: !settings.emailRecipientsOverride && settings.envEmails.length > 0,
    telegramEnabled: settings.telegramEnabled,
    hasTelegramBotToken: Boolean(settings.effectiveTelegramBotToken),
    telegramBotTokenMasked: maskSecret(settings.effectiveTelegramBotToken),
    usingEnvTelegramToken: settings.hasEnvTelegramToken && !settings.hasDbTelegramToken,
    telegramChatId: settings.telegramChatIdOverride || '',
    effectiveTelegramChatIdMasked: settings.effectiveTelegramChatId
      ? maskSecret(settings.effectiveTelegramChatId, { keepStart: 0, keepEnd: 4 })
      : null,
    hasTelegramChatId: Boolean(settings.effectiveTelegramChatId),
    usingEnvTelegramChatId: settings.hasEnvTelegramChatId && !settings.hasDbTelegramChatId,
    notifyOnRecovery: settings.notifyOnRecovery,
    source: settings.source,
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
  };
}

function shouldBypassSelfHosted(settings, nowMs = Date.now()) {
  if (!settings?.failoverEnabled) return false;
  return nowMs < circuitOpenUntilMs;
}

function getFailoverRuntimeState(nowMs = Date.now()) {
  const open = nowMs < circuitOpenUntilMs;
  return {
    circuitOpen: open,
    circuitOpenUntil: open ? new Date(circuitOpenUntilMs).toISOString() : null,
    incidentActive,
    lastFailoverAt,
    lastRecoveryAt,
    totalFailoversSinceBoot,
    primaryPipeline: PRIMARY_PIPELINE,
    backupPipeline: BACKUP_PIPELINE,
  };
}

function resetCircuitBreaker() {
  circuitOpenUntilMs = 0;
  incidentActive = false;
}

function resetFailoverStateForTests() {
  circuitOpenUntilMs = 0;
  incidentActive = false;
  lastFailoverAlertSentAtMs = 0;
  lastFailoverAt = null;
  lastRecoveryAt = null;
  totalFailoversSinceBoot = 0;
  for (const timer of activeWatchdogs.values()) {
    clearTimeout(timer);
  }
  activeWatchdogs.clear();
  invalidateAgentAlertSettingsCache();
}

function adminOverviewUrl() {
  const base = (
    process.env.PUBLIC_FRONTEND_BASE_URL ||
    process.env.FRONTEND_URL ||
    'https://lalia.cloud'
  )
    .trim()
    .replace(/\/$/, '');
  return `${base}/v2/app/admin/overview`;
}

async function sendTelegramAlertDirect(text, { botToken, chatId }) {
  if (!botToken || !chatId) {
    return { sent: false, skipped: true };
  }
  try {
    const res = await axios.post(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        chat_id: chatId,
        text: String(text).slice(0, 4096),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      },
      { timeout: 10000 }
    );
    return { sent: true, messageId: res.data?.result?.message_id };
  } catch (err) {
    console.warn('[agentFailover] Telegram delivery failed:', err.response?.data || err.message);
    return { sent: false, error: err.message };
  }
}

function formatAlertContent({ roomName, orgId, eventKind, fromPipeline, toPipeline, reason, details }) {
  const url = adminOverviewUrl();
  const safeRoom = escapeHtml(roomName);
  const safeReason = escapeHtml(reason);
  const safeFrom = escapeHtml(fromPipeline);
  const safeTo = escapeHtml(toPipeline);

  if (eventKind === 'recovery') {
    return {
      subject: `[Lalia All Clear] Self-hosted worker recovered (${roomName})`,
      text:
        `Self-hosted worker (${toPipeline}) rejoined room ${roomName}.\n` +
        `New rooms will route back to EC2 primary.\nAdmin panel: ${url}`,
      html:
        `<p><strong>All Clear:</strong> Self-hosted EC2 worker (<code>${safeTo}</code>) is healthy again in room <code>${safeRoom}</code>.</p>` +
        `<p>New calls are routing back to the EC2 primary worker.</p>` +
        `<p><a href="${escapeHtml(url)}">Open Admin Dashboard</a></p>`,
      telegram:
        `✅ <b>Lalia All Clear</b>\n` +
        `Self-hosted EC2 worker recovered (<code>${safeTo}</code>) on room <code>${safeRoom}</code>.\n` +
        `<a href="${escapeHtml(url)}">Open Admin Dashboard</a>`,
    };
  }

  if (eventKind === 'test') {
    return {
      subject: '[Lalia Test] Agent failover notification check',
      text: `Test notification triggered from Lalia Admin Panel.\nPrimary: ${fromPipeline} -> Backup: ${toPipeline}\nAdmin panel: ${url}`,
      html:
        `<p><strong>Test Notification:</strong> Lalia Agent Failover alerts are configured and working.</p>` +
        `<p>Primary: <code>${safeFrom}</code> → Cloud Backup: <code>${safeTo}</code></p>` +
        `<p><a href="${escapeHtml(url)}">Open Admin Dashboard</a></p>`,
      telegram:
        `🔔 <b>Lalia Failover Alert Test</b>\n` +
        `Notifications verified for <code>${safeFrom}</code> → <code>${safeTo}</code>.\n` +
        `<a href="${escapeHtml(url)}">Open Admin Dashboard</a>`,
    };
  }

  const orgLine = orgId ? `\nOrg: ${orgId}` : '';
  const detailLine = details?.timeoutSec ? `Timeout: ${details.timeoutSec}s` : `Trigger: ${reason}`;
  return {
    subject: `[Lalia Alert] Self-hosted agent failover -> Cloud backup (${roomName})`,
    text:
      `Room ${roomName} failed over from ${fromPipeline} to LiveKit Cloud backup (${toPipeline}).\n` +
      `Reason: ${reason} (${detailLine})${orgLine}\n` +
      `Affected rooms continue normally at Cloud Agent rates until EC2 recovers.\nAdmin panel: ${url}`,
    html:
      `<p><strong>LiveKit Agent Failover Triggered</strong></p>` +
      `<ul>` +
      `<li><strong>Room:</strong> <code>${safeRoom}</code></li>` +
      `<li><strong>Transition:</strong> <code>${safeFrom}</code> → <code>${safeTo}</code></li>` +
      `<li><strong>Reason:</strong> ${safeReason} (${escapeHtml(detailLine)})</li>` +
      (orgId ? `<li><strong>Org:</strong> <code>${escapeHtml(orgId)}</code></li>` : '') +
      `</ul>` +
      `<p>Calls continue uninterrupted on the Cloud backup worker (billed at Cloud Agent rates). Check <code>lalia-agent-worker-asg</code> if failovers persist.</p>` +
      `<p><a href="${escapeHtml(url)}">Open Admin Dashboard</a></p>`,
    telegram:
      `⚠️ <b>Lalia Agent Failover</b>\n` +
      `Room <code>${safeRoom}</code> switched <code>${safeFrom}</code> → <b>Cloud Backup</b> (<code>${safeTo}</code>)\n` +
      `Reason: <code>${safeReason}</code> (${escapeHtml(detailLine)})\n` +
      `<a href="${escapeHtml(url)}">Acknowledge in Admin</a>`,
  };
}

async function recordAndNotifyAgentEvent({
  roomName,
  orgId = null,
  eventKind,
  fromPipeline = PRIMARY_PIPELINE,
  toPipeline = BACKUP_PIPELINE,
  reason = 'unknown',
  details = null,
  forceNotify = false,
  sendEmailFn = sendEmail,
  sendTelegramFn = sendTelegramAlertDirect,
} = {}) {
  const settings = await getAgentAlertSettings();
  const eventId = db.uuid();
  const createdAt = new Date().toISOString();
  const ackedAt = eventKind === 'recovery' ? createdAt : null;
  const ackedBy = eventKind === 'recovery' ? 'system' : null;

  try {
    await db.run(
      `INSERT INTO v2_agent_failover_events (
        id, room_name, org_id, event_kind, from_pipeline, to_pipeline, reason, details_json,
        acknowledged_at, acknowledged_by, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        eventId,
        String(roomName || 'unknown').slice(0, 255),
        orgId ? String(orgId).slice(0, 128) : null,
        String(eventKind || 'failover'),
        String(fromPipeline),
        String(toPipeline),
        String(reason),
        details ? JSON.stringify(details) : null,
        ackedAt,
        ackedBy,
        createdAt,
      ]
    );
  } catch (err) {
    console.warn('[agentFailover] Failed to persist failover event:', err.message);
  }

  let shouldSendOutbound = false;
  const nowMs = Date.now();
  if (eventKind === 'test') {
    shouldSendOutbound = true;
  } else if (eventKind === 'recovery') {
    shouldSendOutbound = Boolean(settings.notifyOnRecovery);
  } else {
    const cooldownMs = settings.alertCooldownMinutes * 60_000;
    if (forceNotify || nowMs - lastFailoverAlertSentAtMs >= cooldownMs) {
      shouldSendOutbound = true;
      lastFailoverAlertSentAtMs = nowMs;
    }
  }

  let emailResult = { sent: false, skipped: true };
  let telegramResult = { sent: false, skipped: true };

  if (shouldSendOutbound) {
    const msg = formatAlertContent({
      roomName,
      orgId,
      eventKind,
      fromPipeline,
      toPipeline,
      reason,
      details,
    });
    if (settings.emailEnabled && settings.effectiveEmails.length > 0) {
      try {
        emailResult = await sendEmailFn({
          to: settings.effectiveEmails,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
        });
      } catch (err) {
        emailResult = { sent: false, error: err.message };
      }
    }
    if (settings.telegramEnabled && settings.effectiveTelegramBotToken && settings.effectiveTelegramChatId) {
      telegramResult = await sendTelegramFn(msg.telegram, {
        botToken: settings.effectiveTelegramBotToken,
        chatId: settings.effectiveTelegramChatId,
      });
    }
  } else {
    emailResult = { sent: false, rateLimited: true };
    telegramResult = { sent: false, rateLimited: true };
  }

  return { eventId, emailResult, telegramResult };
}

function resolveLivekitModule(override) {
  return override || require('./livekitService');
}

function parseRoomMeta(room) {
  if (!room?.metadata) return {};
  try {
    return typeof room.metadata === 'string' ? JSON.parse(room.metadata) : room.metadata;
  } catch {
    return {};
  }
}

async function checkRoomSelfHostedHealth(roomName, { orgId = null, livekit = null, mergeMetaFn = mergeRoomMetadata, sendEmailFn = sendEmail, sendTelegramFn = sendTelegramAlertDirect } = {}) {
  const lk = resolveLivekitModule(livekit);
  return lk.withRoomLock(roomName, async () => {
    const settings = await getAgentAlertSettings();
    let rooms = [];
    try {
      rooms = await lk.getRoomService().listRooms([roomName]);
    } catch {
      return { action: 'room_gone' };
    }
    if (!Array.isArray(rooms) || rooms.length === 0) {
      return { action: 'room_gone' };
    }

    const roomMeta = parseRoomMeta(rooms[0]);
    if (roomMeta.stt_pipeline && roomMeta.stt_pipeline !== PRIMARY_PIPELINE) {
      return { action: 'not_selfhosted', pipeline: roomMeta.stt_pipeline };
    }

    let participants = [];
    try {
      participants = await lk.getRoomService().listParticipants(roomName);
    } catch {
      return { action: 'room_gone' };
    }

    const agentPresent = participants.some((p) => lk.looksLikeAgentParticipant(p));
    const humanPresent = participants.some((p) => !lk.looksLikeAgentParticipant(p));

    if (agentPresent) {
      if (incidentActive) {
        incidentActive = false;
        circuitOpenUntilMs = 0;
        lastRecoveryAt = new Date().toISOString();
        await recordAndNotifyAgentEvent({
          roomName,
          orgId: orgId || roomMeta.org_id || null,
          eventKind: 'recovery',
          fromPipeline: BACKUP_PIPELINE,
          toPipeline: PRIMARY_PIPELINE,
          reason: 'selfhosted_recovered',
          details: { participants: participants.length },
          sendEmailFn,
          sendTelegramFn,
        });
      }
      return { action: 'healthy' };
    }

    if (!humanPresent) {
      return { action: 'awaiting_humans' };
    }

    if (!settings.failoverEnabled) {
      return { action: 'disabled' };
    }

    const nowMs = Date.now();
    circuitOpenUntilMs = nowMs + settings.circuitCooldownSec * 1000;
    incidentActive = true;
    lastFailoverAt = new Date(nowMs).toISOString();
    totalFailoversSinceBoot += 1;

    await lk.removeAgentsFromRoom(roomName);
    const updatedMeta = await mergeMetaFn(roomName, {
      stt_pipeline: BACKUP_PIPELINE,
      fallback_from: PRIMARY_PIPELINE,
      fallback_reason: 'join_timeout',
      fallback_at: lastFailoverAt,
    });

    const cloudAgent = lk.agentNameForPipeline(BACKUP_PIPELINE);
    const dispatchMeta = roomMeta.demo ? JSON.stringify(updatedMeta) : undefined;
    await lk
      .getAgentDispatch()
      .createDispatch(roomName, cloudAgent, dispatchMeta ? { metadata: dispatchMeta } : undefined);

    console.warn(`[agentFailover] Room ${roomName} failed over ${PRIMARY_PIPELINE} -> ${cloudAgent} (join_timeout)`);

    const alert = await recordAndNotifyAgentEvent({
      roomName,
      orgId: orgId || roomMeta.org_id || null,
      eventKind: 'failover',
      fromPipeline: PRIMARY_PIPELINE,
      toPipeline: BACKUP_PIPELINE,
      reason: 'join_timeout',
      details: { timeoutSec: settings.joinTimeoutSec, cloudAgent },
      sendEmailFn,
      sendTelegramFn,
    });

    return {
      action: 'failed_over',
      toPipeline: BACKUP_PIPELINE,
      agentName: cloudAgent,
      eventId: alert.eventId,
    };
  });
}

function scheduleSelfHostedWatchdog(roomName, { orgId = null, allowInTest = false, followUp = false } = {}) {
  if (!roomName) return;
  if (process.env.NODE_ENV === 'test' && !allowInTest) return;
  if (activeWatchdogs.has(roomName)) return;

  Promise.resolve(getAgentAlertSettings())
    .then((settings) => {
      if (activeWatchdogs.has(roomName)) return;
      const delayMs = followUp ? 10_000 : (settings.joinTimeoutSec || 10) * 1000;
      const handle = setTimeout(async () => {
        activeWatchdogs.delete(roomName);
        try {
          const result = await checkRoomSelfHostedHealth(roomName, { orgId });
          if (result?.action === 'awaiting_humans' && !followUp) {
            scheduleSelfHostedWatchdog(roomName, { orgId, allowInTest, followUp: true });
          }
        } catch (err) {
          console.error(`[agentFailover] Watchdog failed for ${roomName}:`, err.message);
        }
      }, delayMs);
      if (typeof handle.unref === 'function') handle.unref();
      activeWatchdogs.set(roomName, handle);
    })
    .catch((err) => {
      console.warn('[agentFailover] Failed to schedule watchdog:', err.message);
    });
}

function parseDetails(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mapEventRow(row) {
  return {
    id: row.id,
    roomName: row.room_name,
    orgId: row.org_id || null,
    eventKind: row.event_kind,
    fromPipeline: row.from_pipeline,
    toPipeline: row.to_pipeline,
    reason: row.reason,
    details: parseDetails(row.details_json),
    acknowledgedAt: row.acknowledged_at || null,
    acknowledgedBy: row.acknowledged_by || null,
    createdAt: row.created_at,
  };
}

async function listUnacknowledgedFailoverEvents(limit = 20) {
  const safeLimit = clampInt(limit, 20, 1, 100);
  const rows = await db.all(
    `SELECT * FROM v2_agent_failover_events WHERE acknowledged_at IS NULL ORDER BY created_at DESC LIMIT ?`,
    [safeLimit]
  );
  return (rows || []).map(mapEventRow);
}

async function listRecentFailoverEvents(limit = 25) {
  const safeLimit = clampInt(limit, 25, 1, 100);
  const rows = await db.all(
    `SELECT * FROM v2_agent_failover_events ORDER BY created_at DESC LIMIT ?`,
    [safeLimit]
  );
  return (rows || []).map(mapEventRow);
}

async function acknowledgeFailoverEvents(actorEmail, ids = null) {
  const now = new Date().toISOString();
  const cleanIds = Array.isArray(ids)
    ? ids.map((x) => String(x).trim()).filter(Boolean).slice(0, 100)
    : [];
  let result;
  if (cleanIds.length > 0) {
    const placeholders = cleanIds.map(() => '?').join(',');
    result = await db.run(
      `UPDATE v2_agent_failover_events SET acknowledged_at = ?, acknowledged_by = ?
       WHERE acknowledged_at IS NULL AND id IN (${placeholders})`,
      [now, actorEmail, ...cleanIds]
    );
  } else {
    result = await db.run(
      `UPDATE v2_agent_failover_events SET acknowledged_at = ?, acknowledged_by = ?
       WHERE acknowledged_at IS NULL`,
      [now, actorEmail]
    );
  }
  return { acknowledgedCount: result?.changes ?? 0 };
}

async function sendTestAgentAlert(actorEmail, { sendEmailFn = sendEmail, sendTelegramFn = sendTelegramAlertDirect } = {}) {
  return recordAndNotifyAgentEvent({
    roomName: `admin-test-${Date.now().toString(36)}`,
    orgId: null,
    eventKind: 'test',
    fromPipeline: PRIMARY_PIPELINE,
    toPipeline: BACKUP_PIPELINE,
    reason: `manual_test_by:${actorEmail}`,
    details: { triggeredBy: actorEmail },
    forceNotify: true,
    sendEmailFn,
    sendTelegramFn,
  });
}

module.exports = {
  PRIMARY_PIPELINE,
  BACKUP_PIPELINE,
  getAgentAlertSettings,
  saveAgentAlertSettings,
  toAgentAlertAdminView,
  invalidateAgentAlertSettingsCache,
  mergeAlertSettings,
  shouldBypassSelfHosted,
  getFailoverRuntimeState,
  resetCircuitBreaker,
  resetFailoverStateForTests,
  recordAndNotifyAgentEvent,
  checkRoomSelfHostedHealth,
  scheduleSelfHostedWatchdog,
  listUnacknowledgedFailoverEvents,
  listRecentFailoverEvents,
  acknowledgeFailoverEvents,
  sendTestAgentAlert,
  sendTelegramAlertDirect,
};
