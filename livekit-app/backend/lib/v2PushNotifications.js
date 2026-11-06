const crypto = require('crypto');
const fs = require('fs');
const http2 = require('http2');
const webPush = require('web-push');
const db = require('../db/v2Database');
const { encryptSecret, decryptSecret, isEncrypted } = require('./secretCrypto');

const SETTINGS_ID = 'default';
let cachedKeys = null;
let iosTableEnsured = false;
let cachedApnsJwt = { token: null, issuedAtSec: 0, keyFingerprint: '' };

async function ensureIosPushTable() {
  if (iosTableEnsured) return;
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS v2_ios_push_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        push_type TEXT NOT NULL DEFAULT 'voip',
        bundle_id TEXT NOT NULL DEFAULT 'cloud.lalia.app',
        environment TEXT NOT NULL DEFAULT 'sandbox',
        user_agent TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await db.run(
      `CREATE INDEX IF NOT EXISTS idx_v2_ios_push_tokens_user ON v2_ios_push_tokens(user_id)`
    );
    iosTableEnsured = true;
  } catch {
    /* ignore if already created by migration */
  }
}

function getApnsConfig() {
  const keyId = String(process.env.APNS_KEY_ID || '').trim();
  const teamId = String(process.env.APNS_TEAM_ID || '6XA276N3U8').trim();
  const bundleId = String(process.env.APNS_BUNDLE_ID || 'cloud.lalia.app').trim();
  const defaultEnv =
    String(process.env.APNS_DEFAULT_ENV || process.env.APNS_ENV || 'sandbox')
      .trim()
      .toLowerCase() === 'production'
      ? 'production'
      : 'sandbox';

  let rawKey = String(process.env.APNS_P8_KEY || process.env.APNS_PRIVATE_KEY || '').trim();
  const keyPath = String(process.env.APNS_P8_KEY_PATH || '').trim();
  if (!rawKey && keyPath) {
    try {
      if (fs.existsSync(keyPath)) {
        rawKey = fs.readFileSync(keyPath, 'utf8').trim();
      }
    } catch {
      /* ignore */
    }
  }

  let privateKeyPem = '';
  if (rawKey) {
    if (rawKey.includes('BEGIN PRIVATE KEY')) {
      privateKeyPem = rawKey.replace(/\\n/g, '\n');
    } else {
      try {
        const decoded = Buffer.from(rawKey, 'base64').toString('utf8');
        if (decoded.includes('BEGIN PRIVATE KEY')) {
          privateKeyPem = decoded;
        }
      } catch {
        /* ignore */
      }
    }
  }

  const configured = Boolean(keyId && teamId && bundleId && privateKeyPem);
  return {
    configured,
    keyId,
    teamId,
    bundleId,
    defaultEnv,
    privateKeyPem,
  };
}

function isApnsConfigured() {
  return getApnsConfig().configured;
}

function getApnsProviderJwt(config) {
  const nowSec = Math.floor(Date.now() / 1000);
  const fingerprint = `${config.keyId}:${config.teamId}`;
  if (
    cachedApnsJwt.token &&
    cachedApnsJwt.keyFingerprint === fingerprint &&
    nowSec - cachedApnsJwt.issuedAtSec < 50 * 60
  ) {
    return cachedApnsJwt.token;
  }

  const header = Buffer.from(
    JSON.stringify({ alg: 'ES256', kid: config.keyId })
  ).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({ iss: config.teamId, iat: nowSec })
  ).toString('base64url');
  const signingInput = `${header}.${claims}`;
  const signature = crypto
    .sign('sha256', Buffer.from(signingInput, 'utf8'), {
      key: config.privateKeyPem,
      dsaEncoding: 'ieee-p1363',
    })
    .toString('base64url');

  const jwt = `${signingInput}.${signature}`;
  cachedApnsJwt = {
    token: jwt,
    issuedAtSec: nowSec,
    keyFingerprint: fingerprint,
  };
  return jwt;
}

function sendSingleApnsHttp2Request({ host, token, headers, bodyJson, timeoutMs = 6000 }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let client = null;
    const timer = setTimeout(() => {
      try {
        client?.close();
      } catch {
        /* ignore */
      }
      finish({ ok: false, statusCode: 0, reason: 'Timeout' });
    }, timeoutMs);

    try {
      client = http2.connect(`https://${host}:443`);
      client.on('error', (err) => {
        clearTimeout(timer);
        try {
          client.close();
        } catch {
          /* ignore */
        }
        finish({ ok: false, statusCode: 0, reason: err?.message || 'ConnectionError' });
      });

      const req = client.request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        ...headers,
      });

      let statusCode = 0;
      let responseBody = '';

      req.on('response', (resHeaders) => {
        statusCode = Number(resHeaders[':status'] || 0);
      });
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        responseBody += chunk;
      });
      req.on('end', () => {
        clearTimeout(timer);
        try {
          client.close();
        } catch {
          /* ignore */
        }
        let reason = '';
        if (responseBody) {
          try {
            reason = JSON.parse(responseBody)?.reason || '';
          } catch {
            reason = responseBody.slice(0, 120);
          }
        }
        finish({ ok: statusCode >= 200 && statusCode < 300, statusCode, reason });
      });
      req.on('error', (err) => {
        clearTimeout(timer);
        try {
          client.close();
        } catch {
          /* ignore */
        }
        finish({ ok: false, statusCode: 0, reason: err?.message || 'RequestError' });
      });

      req.end(bodyJson);
    } catch (err) {
      clearTimeout(timer);
      try {
        client?.close();
      } catch {
        /* ignore */
      }
      finish({ ok: false, statusCode: 0, reason: err?.message || 'ConnectException' });
    }
  });
}

async function dispatchApnsToTokenRow(row, callPayload, config) {
  const jwt = getApnsProviderJwt(config);
  const bundleId = row.bundle_id || config.bundleId || 'cloud.lalia.app';
  const isVoip = row.push_type === 'voip';
  const topic = isVoip ? `${bundleId}.voip` : bundleId;
  const pushType = isVoip ? 'voip' : 'alert';
  const expiration = String(Math.floor(Date.now() / 1000) + 60);

  const apnsBody = isVoip
    ? JSON.stringify({
        aps: {
          'content-available': 1,
        },
        type: 'incoming_call',
        callId: callPayload.callId,
        callerName: callPayload.callerName,
        joinUrl: callPayload.joinUrl,
        roomName: callPayload.roomName || '',
        timestamp: Date.now(),
      })
    : JSON.stringify({
        aps: {
          alert: {
            title: `${callPayload.callerName || 'Someone'} is calling you on Lalia`,
            body: 'Tap to answer with live translation & captions',
          },
          sound: 'default',
          'interruption-level': 'time-sensitive',
          category: 'INCOMING_CALL',
        },
        type: 'incoming_call',
        callId: callPayload.callId,
        callerName: callPayload.callerName,
        joinUrl: callPayload.joinUrl,
        roomName: callPayload.roomName || '',
        timestamp: Date.now(),
      });

  const headers = {
    authorization: `bearer ${jwt}`,
    'apns-topic': topic,
    'apns-push-type': pushType,
    'apns-priority': '10',
    'apns-expiration': expiration,
    'content-type': 'application/json',
  };

  const primaryEnv = row.environment === 'production' ? 'production' : 'sandbox';
  const primaryHost =
    primaryEnv === 'production' ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';

  let res = await sendSingleApnsHttp2Request({
    host: primaryHost,
    token: row.token,
    headers,
    bodyJson: apnsBody,
  });

  if (
    !res.ok &&
    (res.reason === 'BadDeviceToken' || res.reason === 'DeviceTokenNotForTopic')
  ) {
    const fallbackEnv = primaryEnv === 'production' ? 'sandbox' : 'production';
    const fallbackHost =
      fallbackEnv === 'production' ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';
    const retryRes = await sendSingleApnsHttp2Request({
      host: fallbackHost,
      token: row.token,
      headers,
      bodyJson: apnsBody,
    });
    if (retryRes.ok) {
      await db
        .run(`UPDATE v2_ios_push_tokens SET environment = ?, updated_at = ? WHERE id = ?`, [
          fallbackEnv,
          new Date().toISOString(),
          row.id,
        ])
        .catch(() => {});
      return retryRes;
    }
    res = retryRes;
  }

  if (
    !res.ok &&
    (res.statusCode === 410 || res.reason === 'Unregistered')
  ) {
    await db
      .run(`DELETE FROM v2_ios_push_tokens WHERE id = ?`, [row.id])
      .catch(() => {});
  }

  return res;
}

function normalizeHexToken(raw) {
  return String(raw || '')
    .trim()
    .replace(/[<>\s-]/g, '')
    .toLowerCase();
}

async function saveIosPushToken({
  userId,
  token,
  pushType = 'voip',
  bundleId = 'cloud.lalia.app',
  environment = 'sandbox',
  userAgent = '',
}) {
  await ensureIosPushTable();

  const cleanToken = normalizeHexToken(token);
  if (!userId || !cleanToken || !/^[0-9a-f]{32,200}$/.test(cleanToken)) {
    return { ok: false, error: 'Valid hex iOS push token is required' };
  }

  const cleanType = String(pushType || 'voip').toLowerCase() === 'apns' ? 'apns' : 'voip';
  const cleanBundle = String(bundleId || 'cloud.lalia.app').trim().slice(0, 120) || 'cloud.lalia.app';
  const cleanEnv =
    String(environment || 'sandbox').toLowerCase() === 'production'
      ? 'production'
      : 'sandbox';
  const ua = userAgent ? String(userAgent).slice(0, 255) : null;
  const now = new Date().toISOString();

  const existing = await db.get(
    `SELECT id FROM v2_ios_push_tokens WHERE token = ?`,
    [cleanToken]
  );

  if (existing) {
    await db.run(
      `UPDATE v2_ios_push_tokens
       SET user_id = ?, push_type = ?, bundle_id = ?, environment = ?, user_agent = ?, updated_at = ?
       WHERE id = ?`,
      [userId, cleanType, cleanBundle, cleanEnv, ua, now, existing.id]
    );
    return { ok: true, id: existing.id, pushType: cleanType };
  }

  const id = db.uuid();
  await db.run(
    `INSERT INTO v2_ios_push_tokens (id, user_id, token, push_type, bundle_id, environment, user_agent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, cleanToken, cleanType, cleanBundle, cleanEnv, ua, now, now]
  );
  return { ok: true, id, pushType: cleanType };
}

async function ensureVapidKeys() {
  if (cachedKeys) return cachedKeys;

  const envPub = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const envPriv = (process.env.VAPID_PRIVATE_KEY || '').trim();
  if (envPub && envPriv) {
    cachedKeys = { publicKey: envPub, privateKey: envPriv };
    webPush.setVapidDetails('mailto:notifications@lalia.cloud', envPub, envPriv);
    return cachedKeys;
  }

  let row = await db.get(`SELECT * FROM v2_platform_push_settings WHERE id = ?`, [SETTINGS_ID]);
  if (row?.public_key && row?.private_key) {
    const priv = isEncrypted(row.private_key) ? decryptSecret(row.private_key) : row.private_key;
    if (priv) {
      cachedKeys = { publicKey: row.public_key, privateKey: priv };
      webPush.setVapidDetails('mailto:notifications@lalia.cloud', row.public_key, priv);
      return cachedKeys;
    }
  }

  const generated = webPush.generateVAPIDKeys();
  const encryptedPriv = encryptSecret(generated.privateKey);
  const now = new Date().toISOString();

  await db
    .run(
      `INSERT OR IGNORE INTO v2_platform_push_settings (id, public_key, private_key, created_at)
       VALUES (?, ?, ?, ?)`,
      [SETTINGS_ID, generated.publicKey, encryptedPriv, now]
    )
    .catch(() => {});

  row = await db.get(`SELECT * FROM v2_platform_push_settings WHERE id = ?`, [SETTINGS_ID]);
  const finalPub = row?.public_key || generated.publicKey;
  const finalPriv = row?.private_key
    ? isEncrypted(row.private_key)
      ? decryptSecret(row.private_key)
      : row.private_key
    : generated.privateKey;

  cachedKeys = { publicKey: finalPub, privateKey: finalPriv };
  webPush.setVapidDetails('mailto:notifications@lalia.cloud', finalPub, finalPriv);
  return cachedKeys;
}

async function getVapidPublicKey() {
  const keys = await ensureVapidKeys();
  return keys.publicKey;
}

async function savePushSubscription({ userId, subscription, userAgent }) {
  if (!userId || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return { ok: false, error: 'Invalid push subscription' };
  }

  const endpoint = String(subscription.endpoint).trim();
  const p256dh = String(subscription.keys.p256dh).trim();
  const auth = String(subscription.keys.auth).trim();
  const ua = userAgent ? String(userAgent).slice(0, 255) : null;
  const now = new Date().toISOString();

  const existing = await db.get(
    `SELECT id FROM v2_push_subscriptions WHERE endpoint = ?`,
    [endpoint]
  );

  if (existing) {
    await db.run(
      `UPDATE v2_push_subscriptions
       SET user_id = ?, p256dh = ?, auth = ?, user_agent = ?, updated_at = ?
       WHERE id = ?`,
      [userId, p256dh, auth, ua, now, existing.id]
    );
    return { ok: true, id: existing.id };
  }

  const id = db.uuid();
  await db.run(
    `INSERT INTO v2_push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, endpoint, p256dh, auth, ua, now, now]
  );
  return { ok: true, id };
}

async function sendIncomingCallPush({
  calleeUserId,
  calleeEmail,
  callerName,
  joinUrl,
  callId,
  roomName = '',
}) {
  try {
    await ensureVapidKeys();
    await ensureIosPushTable();

    let targetUserId = calleeUserId;
    if (!targetUserId && calleeEmail) {
      const u = await db.get(
        `SELECT id FROM v2_users WHERE LOWER(email) = LOWER(?) LIMIT 1`,
        [String(calleeEmail).trim()]
      );
      targetUserId = u?.id || null;
    }
    if (!targetUserId) return { sent: 0, webSent: 0, iosSent: 0 };

    const [subs, iosTokens] = await Promise.all([
      db
        .all(
          `SELECT id, endpoint, p256dh, auth FROM v2_push_subscriptions WHERE user_id = ?`,
          [targetUserId]
        )
        .catch(() => []),
      db
        .all(
          `SELECT id, token, push_type, bundle_id, environment FROM v2_ios_push_tokens WHERE user_id = ?`,
          [targetUserId]
        )
        .catch(() => []),
    ]);

    const payload = JSON.stringify({
      type: 'incoming_call',
      callId,
      callerName: callerName || 'Someone',
      roomName: roomName || '',
      title: `${callerName || 'Someone'} is calling you on Lalia`,
      body: 'Tap to answer with live translation & captions',
      joinUrl: joinUrl || '/v2/app',
      tag: `lalia-call-${callId || 'incoming'}`,
      timestamp: Date.now(),
    });

    let webSent = 0;
    let iosSent = 0;

    if (subs.length > 0) {
      await Promise.all(
        subs.map(async (sub) => {
          try {
            await webPush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: {
                  p256dh: sub.p256dh,
                  auth: sub.auth,
                },
              },
              payload,
              {
                TTL: 60,
                urgency: 'high',
              }
            );
            webSent += 1;
          } catch (err) {
            if (err?.statusCode === 404 || err?.statusCode === 410) {
              await db
                .run(`DELETE FROM v2_push_subscriptions WHERE id = ?`, [sub.id])
                .catch(() => {});
            }
          }
        })
      );
    }

    const apnsConfig = getApnsConfig();
    if (iosTokens.length > 0 && apnsConfig.configured) {
      const callData = {
        callId,
        callerName: callerName || 'Someone',
        joinUrl: joinUrl || '/v2/app',
        roomName: roomName || '',
      };
      const voipRows = iosTokens.filter((r) => r.push_type === 'voip');
      const alertRows = iosTokens.filter((r) => r.push_type !== 'voip');

      let voipSent = 0;
      if (voipRows.length > 0) {
        await Promise.all(
          voipRows.map(async (row) => {
            try {
              const res = await dispatchApnsToTokenRow(row, callData, apnsConfig);
              console.log(
                `[v2PushNotifications] APNs VoIP push -> status=${res.statusCode} ok=${res.ok} reason=${res.reason || 'none'}`
              );
              if (res.ok) {
                voipSent += 1;
                iosSent += 1;
              }
            } catch {
              /* ignore single token dispatch failure */
            }
          })
        );
      }

      if (voipSent === 0 && alertRows.length > 0) {
        await Promise.all(
          alertRows.map(async (row) => {
            try {
              const res = await dispatchApnsToTokenRow(row, callData, apnsConfig);
              console.log(
                `[v2PushNotifications] APNs alert push -> status=${res.statusCode} ok=${res.ok} reason=${res.reason || 'none'}`
              );
              if (res.ok) {
                iosSent += 1;
              }
            } catch {
              /* ignore single token dispatch failure */
            }
          })
        );
      }
    }

    return {
      sent: webSent + iosSent,
      webSent,
      iosSent,
      apnsConfigured: apnsConfig.configured,
    };
  } catch (e) {
    console.warn('[v2PushNotifications] sendIncomingCallPush error:', e.message);
    return { sent: 0, webSent: 0, iosSent: 0 };
  }
}

async function getUserPushDiagnostics(userId) {
  await ensureIosPushTable();
  const [webSubs, iosTokens] = await Promise.all([
    db
      .all(
        `SELECT id, endpoint, user_agent, updated_at FROM v2_push_subscriptions WHERE user_id = ?`,
        [userId]
      )
      .catch(() => []),
    db
      .all(
        `SELECT id, push_type, bundle_id, environment, updated_at FROM v2_ios_push_tokens WHERE user_id = ?`,
        [userId]
      )
      .catch(() => []),
  ]);
  return {
    webSubscriptionCount: webSubs.length,
    iosTokenCount: iosTokens.length,
    iosTokens: iosTokens.map((t) => ({
      pushType: t.push_type,
      bundleId: t.bundle_id,
      environment: t.environment,
      updatedAt: t.updated_at,
    })),
    apnsConfigured: isApnsConfigured(),
  };
}

module.exports = {
  getVapidPublicKey,
  savePushSubscription,
  saveIosPushToken,
  sendIncomingCallPush,
  getUserPushDiagnostics,
  isApnsConfigured,
};
