const webPush = require('web-push');
const db = require('../db/v2Database');
const { encryptSecret, decryptSecret, isEncrypted } = require('./secretCrypto');

const SETTINGS_ID = 'default';
let cachedKeys = null;

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

async function sendIncomingCallPush({ calleeUserId, calleeEmail, callerName, joinUrl, callId }) {
  try {
    await ensureVapidKeys();

    let targetUserId = calleeUserId;
    if (!targetUserId && calleeEmail) {
      const u = await db.get(
        `SELECT id FROM v2_users WHERE LOWER(email) = LOWER(?) LIMIT 1`,
        [String(calleeEmail).trim()]
      );
      targetUserId = u?.id || null;
    }
    if (!targetUserId) return { sent: 0 };

    const subs = await db.all(
      `SELECT id, endpoint, p256dh, auth FROM v2_push_subscriptions WHERE user_id = ?`,
      [targetUserId]
    );
    if (!subs.length) return { sent: 0 };

    const payload = JSON.stringify({
      type: 'incoming_call',
      callId,
      title: `${callerName || 'Someone'} is calling you on Lalia`,
      body: 'Tap to answer with live translation & captions',
      joinUrl: joinUrl || '/v2/app',
      tag: `lalia-call-${callId || 'incoming'}`,
      timestamp: Date.now(),
    });

    let sent = 0;
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
          sent += 1;
        } catch (err) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await db
              .run(`DELETE FROM v2_push_subscriptions WHERE id = ?`, [sub.id])
              .catch(() => {});
          }
        }
      })
    );

    return { sent };
  } catch (e) {
    console.warn('[v2PushNotifications] sendIncomingCallPush error:', e.message);
    return { sent: 0 };
  }
}

module.exports = {
  getVapidPublicKey,
  savePushSubscription,
  sendIncomingCallPush,
};
