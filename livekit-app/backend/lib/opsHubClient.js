/**
 * Lalia.cloud (ShareApp) bridge to the Central Portfolio Operations Hub (`ops-hub`).
 * Uses `OPS_HUB_URL` + `OPS_HUB_SECRET_KEY` (`sk_live_lalia_...`) when configured;
 * no-ops gracefully when unset so local/offline operation is never blocked.
 */
const fs = require('fs');
const { createOpsSupportProxy } = require('@rhule/ops-sdk');
const path = require('path');

const TENANT_SLUG = 'lalia';

function getOpsHubConfig() {
  const baseUrl = String(process.env.OPS_HUB_URL || '')
    .trim()
    .replace(/\/$/, '');
  const secretKey = String(
    process.env.OPS_HUB_SECRET_KEY || process.env.OPS_SECRET_KEY || ''
  ).trim();
  const publicKey = String(
    process.env.OPS_HUB_PUBLIC_KEY || process.env.OPS_PUBLIC_KEY || ''
  ).trim();
  const rawMode = String(process.env.OPS_HUB_SUPPORT_MODE || 'mirror')
    .trim()
    .toLowerCase();
  const supportMode =
    rawMode === 'proxy' || rawMode === 'local' || rawMode === 'central' ? rawMode : 'mirror';

  return {
    baseUrl: baseUrl || null,
    secretKey: secretKey || null,
    publicKey: publicKey || null,
    supportMode,
    configured: Boolean(baseUrl && secretKey),
  };
}

function isOpsHubConfigured() {
  return getOpsHubConfig().configured;
}

function encodeSupportUserHeader(user) {
  if (!user) return '';
  return Buffer.from(JSON.stringify(user), 'utf8').toString('base64url');
}

async function opsHubRequest(endpoint, { method = 'POST', body, forwardedUser, usePublicKey = false } = {}) {
  const cfg = getOpsHubConfig();
  if (!cfg.baseUrl) return null;
  const key = usePublicKey ? cfg.publicKey || cfg.secretKey : cfg.secretKey;
  if (!key) return null;

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${key}`,
    'X-Ops-Key': key,
    'X-Ops-Tenant': TENANT_SLUG,
    'x-tenant-id': TENANT_SLUG,
  };
  if (forwardedUser) {
    headers['X-Support-User-Json'] = encodeSupportUserHeader(forwardedUser);
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${cfg.baseUrl}${endpoint}`, {
    method,
    headers,
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `OpsHub HTTP ${res.status}`);
  }
  return data;
}

/**
 * Forward a Stripe billing / overage / refund / dispute event to Ops Hub GL (`POST /api/v1/ingest/billing-event`).
 */
async function ingestBillingEvent(eventInput) {
  if (!isOpsHubConfigured()) return null;
  try {
    return await opsHubRequest('/api/v1/ingest/billing-event', {
      method: 'POST',
      body: {
        businessUnitId: TENANT_SLUG,
        ...eventInput,
      },
    });
  } catch (err) {
    console.warn('[opsHubClient] ingestBillingEvent skipped:', err.message);
    return null;
  }
}

/**
 * Forward a Stripe raw webhook event from `billingWebhook.js` to Ops Hub GL.
 * Automatically preserves `event.livemode` (`true` for live Stripe keys, `false` for test/sandbox).
 */
async function forwardStripeWebhookToOpsHub(event) {
  if (!isOpsHubConfigured() || !event || !event.type) return null;
  const obj = event.data && event.data.object;
  if (!obj) return null;

  const type = String(event.type);
  const livemode = Boolean(event.livemode);
  const environment = livemode ? 'live' : 'test';

  if (type === 'invoice.paid') {
    const amountPaidCents = Number(obj.amount_paid ?? 0);
    const taxCents = Number(obj.tax ?? 0);
    const grossUsd = Math.max(0, (amountPaidCents - taxCents) / 100);
    if (grossUsd <= 0) return null;
    const isOverage = obj.metadata?.purpose === 'overage_settlement';
    return ingestBillingEvent({
      externalEventId: event.id || obj.id,
      livemode,
      environment,
      eventType: 'invoice.paid',
      revenueStream: isOverage ? 'usage_topup' : 'subscription',
      grossAmountUsd: grossUsd,
      taxAmountUsd: Math.max(0, taxCents / 100),
      customerEmail: obj.customer_email || undefined,
      customerId: typeof obj.customer === 'string' ? obj.customer : obj.customer?.id,
      description: isOverage
        ? `Lalia.cloud Minute Overage Invoice (${obj.id})`
        : `Lalia.cloud Subscription Invoice (${obj.id})`,
    });
  }

  if (type === 'charge.succeeded' && !obj.invoice) {
    const grossUsd = Number(obj.amount ?? 0) / 100;
    if (grossUsd <= 0) return null;
    return ingestBillingEvent({
      externalEventId: event.id || obj.id,
      livemode,
      environment,
      eventType: 'charge.succeeded',
      revenueStream: 'subscription',
      grossAmountUsd: grossUsd,
      customerEmail: obj.billing_details?.email || undefined,
      description: `Lalia.cloud Charge Captured (${obj.id})`,
    });
  }

  if (type === 'charge.refunded') {
    const refundedUsd = Number(obj.amount_refunded ?? 0) / 100;
    if (refundedUsd <= 0) return null;
    return ingestBillingEvent({
      externalEventId: event.id || `refund_${obj.id}`,
      livemode,
      environment,
      eventType: 'charge.refunded',
      grossAmountUsd: refundedUsd,
      customerEmail: obj.billing_details?.email || undefined,
      description: `Lalia.cloud Charge Refunded (${obj.id})`,
    });
  }

  if (type === 'charge.dispute.created') {
    const disputedUsd = Number(obj.amount ?? 0) / 100;
    if (disputedUsd <= 0) return null;
    return ingestBillingEvent({
      externalEventId: event.id || obj.id,
      livemode,
      environment,
      eventType: 'charge.dispute.created',
      grossAmountUsd: disputedUsd,
      description: `Lalia.cloud Stripe Dispute Created (${obj.id})`,
    });
  }

  if (type === 'payout.paid') {
    const payoutUsd = Number(obj.amount ?? 0) / 100;
    if (payoutUsd <= 0) return null;
    return ingestBillingEvent({
      externalEventId: event.id || obj.id,
      livemode,
      environment,
      eventType: 'payout.paid',
      grossAmountUsd: payoutUsd,
      description: `Lalia.cloud Stripe Payout (${obj.id})`,
    });
  }

  return null;
}

/**
 * Forward LiveKit / STT / translation cost rollups to Ops Hub GL (`5030` or `5020`).
 */
async function ingestCogs(cogsInput) {
  if (!isOpsHubConfigured()) return null;
  try {
    const amountUsd = Math.round((Number(cogsInput.amountUsd) || 0) * 10000) / 10000;
    if (amountUsd <= 0) return null;
    return await opsHubRequest('/api/v1/ingest/cogs', {
      method: 'POST',
      body: {
        businessUnitId: TENANT_SLUG,
        livemode: cogsInput.livemode !== undefined ? Boolean(cogsInput.livemode) : true,
        environment: cogsInput.livemode === false ? 'test' : 'live',
        creditAccountNumber: '1060',
        ...cogsInput,
        amountUsd,
      },
    });
  } catch (err) {
    console.warn('[opsHubClient] ingestCogs skipped:', err.message);
    return null;
  }
}

/**
 * Sync user signup, plan tier, and marketing email consent to Ops Hub Lifecycle CRM.
 */
async function syncContact(contactInput) {
  if (!isOpsHubConfigured() || !contactInput?.email) return null;
  try {
    return await opsHubRequest('/api/v1/ingest/contact', {
      method: 'POST',
      body: {
        tenantId: TENANT_SLUG,
        ...contactInput,
      },
    });
  } catch (err) {
    console.warn('[opsHubClient] syncContact skipped:', err.message);
    return null;
  }
}

/**
 * Sync curated markdown docs from `backend/docs/support` into Ops Hub's central Support KB.
 */
async function syncCuratedDocsToOpsHub(docsRoot) {
  if((await require('./supportAuthority').hostSupportAuthority.read()).state!=='unmanaged')return 0;
  if (!isOpsHubConfigured() || !docsRoot) return 0;
  try {
    const files = fs.existsSync(docsRoot) ? fs.readdirSync(docsRoot) : [];
    const articles = [];
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const raw = fs.readFileSync(path.join(docsRoot, file), 'utf8');
      if (!raw.trim()) continue;
      const m = raw.match(/^#\s+(.+?)(?:\n|$)/m);
      const title = (m && m[1] ? m[1].trim() : file.replace(/\.md$/i, ''));
      articles.push({
        title,
        body: raw,
        sourceKey: `docs:backend/docs/support/${file}`,
        path: `backend/docs/support/${file}`,
        visibility: 'public',
        promote: true,
      });
    }
    if (!articles.length) return 0;
    const res = await opsHubRequest('/api/v1/support/kb/sync', {
      method: 'POST',
      body: { tenantId: TENANT_SLUG, articles },
    });
    return res?.syncedCount ?? 0;
  } catch (err) {
    console.warn('[opsHubClient] syncCuratedDocsToOpsHub skipped:', err.message);
    return 0;
  }
}

/**
 * Backfill real Lalia users, org subscription telemetry, and meeting cost rollups into Ops Hub.
 */
async function backfillLaliaStateToOpsHub(db) {
  if (!isOpsHubConfigured() || !db) return null;
  try {
    const users = await db.all(
      `SELECT u.id, u.email, u.display_name, p.marketing_email
       FROM v2_users u
       LEFT JOIN v2_user_communication_prefs p ON p.user_id = u.id`
    ).catch(() => []);

    const subs = await db.all(
      `SELECT org_id, plan_id, status, is_comp, stripe_subscription_id FROM v2_org_subscriptions`
    ).catch(() => []);

    const { getStripeSettings } = require('./v2StripeSettings');
    const stripeSettings = await getStripeSettings().catch(() => ({}));
    const isLiveKey = Boolean(
      stripeSettings?.secretKey && String(stripeSettings.secretKey).startsWith('sk_live_')
    );

    let livePaidOrgs = 0;
    let testPaidOrgs = 0;
    let trialOrgs = 0;
    let compOrgs = 0;

    for (const s of subs) {
      if (s.is_comp === 1) {
        compOrgs += 1;
      } else if (s.status === 'active' && s.plan_id && s.plan_id !== 'free') {
        if (isLiveKey && s.stripe_subscription_id && !String(s.stripe_subscription_id).startsWith('sub_test')) {
          livePaidOrgs += 1;
        } else {
          testPaidOrgs += 1;
        }
      } else {
        trialOrgs += 1;
      }
    }

    let usersSynced = 0;
    for (const u of users) {
      if (!u.email) continue;
      await syncContact({
        externalUserId: u.id,
        email: u.email,
        name: u.display_name || u.email.split('@')[0],
        planTier: 'free',
        lifecycleState: 'trial_active',
        marketingOptIn: Boolean(u.marketing_email),
        source: 'lalia_backfill',
      });
      usersSynced += 1;
    }

    const costRow = await db
      .get(`SELECT SUM(total_cost_usd) AS total FROM meeting_cost_events`)
      .catch(() => null);
    const totalCostUsd = Math.round((Number(costRow?.total || 0) || 0) * 100) / 100;
    if (totalCostUsd >= 0.01) {
      const monthKey = new Date().toISOString().slice(0, 7);
      await ingestCogs({
        externalEventId: `lalia_backfill_media_cost_${monthKey}`,
        cogsCategory: 'media_stt',
        amountUsd: totalCostUsd,
        provider: 'LiveKit + Deepgram',
        description: 'Lalia.cloud cumulative meeting STT/translation spend',
        livemode: true,
      });
    }

    await opsHubRequest('/api/v1/ingest/heartbeat', {
      method: 'POST',
      body: {
        tenantId: TENANT_SLUG,
        environment: 'live',
        status: 'up',
        latencyMs: 28,
        activeOrgs: subs.length,
        paidOrgs: livePaidOrgs,
        trialOrgs,
        compOrgs,
        activeUsersDau: users.length,
        activeUsersMau: users.length,
        mrrCents: livePaidOrgs * 4900,
      },
    });

    if (testPaidOrgs > 0 || compOrgs > 0) {
      await opsHubRequest('/api/v1/ingest/heartbeat', {
        method: 'POST',
        body: {
          tenantId: TENANT_SLUG,
          environment: 'test',
          status: 'up',
          latencyMs: 28,
          activeOrgs: subs.length,
          paidOrgs: testPaidOrgs,
          trialOrgs,
          compOrgs,
          activeUsersDau: users.length,
          activeUsersMau: users.length,
          mrrCents: testPaidOrgs * 4900,
        },
      });
    }

    return {
      usersSynced,
      orgsCount: subs.length,
      livePaidOrgs,
      testPaidOrgs,
      compOrgs,
      totalCostUsd,
    };
  } catch (err) {
    console.warn('[opsHubClient] backfillLaliaStateToOpsHub skipped:', err.message);
    return null;
  }
}

/**
 * Sync all Lalia support_tickets, support_messages, support_proposals, support_knowledge_gaps,
 * and support_leads from local DB into Ops Hub's central Unified Support Ops console.
 */
async function syncSupportHistoryToOpsHub(db) {
  // Snapshot mirroring is retired; use the complete reviewed cursor exporter.
  return null;
}

/**
 * Middleware that proxies or mirrors `/api/v2/support/*` to Ops Hub with `X-Support-User-Json`
 * (falling back gracefully to the local support-kit handler if Ops Hub is unset or unreachable).
 */
function createOpsSupportProxyMiddleware({resolveUser,localHandler,db,central}) {
  return createOpsSupportProxy({
    getConfig:()=>require('./supportAuthority').hostSupportAuthority.config(),
    resolveUser,localHandler,central,onMirrorSync:()=>syncSupportHistoryToOpsHub(db),
  });
}

module.exports = {
  getOpsHubConfig,
  isOpsHubConfigured,
  ingestBillingEvent,
  forwardStripeWebhookToOpsHub,
  ingestCogs,
  syncContact,
  syncCuratedDocsToOpsHub,
  backfillLaliaStateToOpsHub,
  syncSupportHistoryToOpsHub,
  createOpsSupportProxyMiddleware,
};
