/**
 * ShareApp host wiring for @rhule/marketing-kit.
 * Sibling to supportKit — Admin Marketing console + public SEO + Resend webhooks.
 */
const path = require('path');
const fs = require('fs');
const db = require('../db/v2Database');
const { aiEnabled, callSupportLlm } = require('./supportAgent/llm');
const { getEmailSettings } = require('./v2EmailSettings');
const {
  getResolvedMarketingEmailConfig,
} = require('./v2MarketingEmailSettings');
const { createMarketingKit, createMarketingCodebaseAdapter } = require('@rhule/marketing-core');

function resolveHostUser(req) {
  // Lazy require — supportKit validates JWT_SECRET_V2 at import time.
  const { resolveUser } = require('./supportKit');
  return resolveUser(req);
}

const LIVEKIT_ROOT = path.join(__dirname, '../..');
const TENANT_ID = 'lalia';
const APP_ORIGIN = (
  process.env.PUBLIC_FRONTEND_BASE_URL ||
  process.env.FRONTEND_URL ||
  'https://lalia.cloud'
)
  .trim()
  .replace(/\/$/, '');

const LALIA_MARKETING_BRAND = {
  tenantId: TENANT_ID,
  name: 'Lalia',
  domain: 'lalia.cloud',
  tagline:
    'The world is one conversation — real-time voice translation, bilingual captions, and video calls.',
  brandVoice:
    'Warm, human, and globally minded. Short sentences, concrete moments (a family call, a client meeting, a classroom). Never overpromise accuracy; say what Lalia does and let people try it free.',
  primaryColor: '#1e304b',
  accentColor: '#5b8def',
  logoText: 'Lalia',
  signupUrl: `${APP_ORIGIN}/v2/signup`,
  pricingSummary:
    'Start free; paid plans add longer meetings, more languages per room, and AI meeting insights.',
  coreFeatures: [
    'Real-time voice translation in live calls',
    'Bilingual live captions',
    'Video meetings with screen sharing',
    'AI meeting summaries and insights',
    '61 languages and regional dialects',
  ],
  targetAudiences: [
    'Families and friends who speak different languages',
    'Small businesses with international clients',
    'Teachers, clinics, and community organizations',
    'Remote teams across countries',
  ],
  contactEmail: 'support@lalia.cloud',
};

function createSqliteMarketingDb() {
  return {
    async run(sql, params = []) {
      const result = await db.run(sql, params);
      return { changes: result.changes ?? 0 };
    },
    async get(sql, params = []) {
      return db.get(sql, params);
    },
    async all(sql, params = []) {
      return db.all(sql, params);
    },
  };
}

function firstName(row) {
  const display = String(row.display_name || '').trim();
  if (display) return display.split(/\s+/)[0];
  return 'there';
}

function userContact(row) {
  return {
    id: String(row.id),
    tenantId: TENANT_ID,
    email: String(row.email),
    firstName: firstName(row),
    name: String(row.display_name || ''),
    planTier: String(row.plan_id || row.plan_tier || 'free'),
    lifecycleState: String(row.billing_status || row.subscription_status || 'none'),
    userType: 'individual',
    marketingOptIn: true,
    unsubscribeToken: '',
  };
}

async function resolveSegmentContacts(_tenantId, segmentId, filter) {
  if (segmentId === 'support_kit_leads') {
    const rows = await db
      .all(
        `SELECT id, email, name FROM support_leads
         WHERE tenant_id = ? AND marketing_email_opt_in = 1`,
        [TENANT_ID]
      )
      .catch(() => []);
    return (rows || []).map((r) => ({
      id: `lead:${r.id}`,
      tenantId: TENANT_ID,
      email: String(r.email),
      firstName: String(r.name || '').split(' ')[0] || 'there',
      name: String(r.name || ''),
      planTier: 'lead',
      lifecycleState: 'lead',
      marketingOptIn: true,
      unsubscribeToken: '',
    }));
  }

  if (segmentId === 'org_owners') {
    const rows = await db.all(
      `SELECT u.id, u.email, u.display_name, p.id AS plan_id, s.status AS billing_status
       FROM v2_org_members m
       JOIN v2_users u ON u.id = m.user_id
       LEFT JOIN v2_org_subscriptions s ON s.org_id = m.org_id
       LEFT JOIN v2_plans p ON p.id = s.plan_id
       WHERE m.role = 'owner' AND u.email IS NOT NULL AND u.disabled_at IS NULL`
    );
    return rows.map(userContact);
  }

  if (segmentId === 'marketing_opt_in') {
    const rows = await db.all(
      `SELECT u.id, u.email, u.display_name
       FROM v2_user_communication_prefs p
       JOIN v2_users u ON u.id = p.user_id
       WHERE p.marketing_email = 1 AND u.email IS NOT NULL AND u.disabled_at IS NULL`
    );
    return rows.map((r) => ({ ...userContact(r), marketingOptIn: true }));
  }

  if (segmentId === 'custom') {
    const where = ['u.email IS NOT NULL', 'u.disabled_at IS NULL'];
    const params = [];
    const f = filter || {};
    if (f.signedUpAfter) {
      where.push('u.created_at >= ?');
      params.push(f.signedUpAfter);
    }
    if (f.signedUpBefore) {
      where.push('u.created_at <= ?');
      params.push(f.signedUpBefore);
    }
    const rows = await db.all(
      `SELECT u.id, u.email, u.display_name FROM v2_users u WHERE ${where.join(' AND ')} LIMIT 5000`,
      params
    );
    return rows.map(userContact);
  }

  return [];
}

async function listSegments() {
  const count = async (sql, params = []) => {
    try {
      const row = await db.get(sql, params);
      return Number(row?.n || 0);
    } catch {
      return 0;
    }
  };
  const [owners, optedIn, leads] = await Promise.all([
    count(
      `SELECT COUNT(*) AS n FROM v2_org_members m
       JOIN v2_users u ON u.id = m.user_id
       WHERE m.role = 'owner' AND u.email IS NOT NULL AND u.disabled_at IS NULL`
    ),
    count(
      `SELECT COUNT(*) AS n FROM v2_user_communication_prefs p
       JOIN v2_users u ON u.id = p.user_id
       WHERE p.marketing_email = 1 AND u.email IS NOT NULL AND u.disabled_at IS NULL`
    ),
    count(
      `SELECT COUNT(*) AS n FROM support_leads WHERE tenant_id = ? AND marketing_email_opt_in = 1`,
      [TENANT_ID]
    ).catch(() => 0),
  ]);
  return [
    {
      id: 'org_owners',
      label: 'Organization owners',
      description: 'Owners of Lalia workspace accounts.',
      count: owners,
    },
    {
      id: 'marketing_opt_in',
      label: 'Marketing email opt-ins',
      description: 'Users who opted into marketing email in org settings.',
      count: optedIn,
    },
    {
      id: 'support_kit_leads',
      label: 'Support leads',
      description: 'Visitors who left an email in Lalia Help and opted in.',
      count: leads,
    },
  ];
}

async function productContext() {
  return {
    tenantId: TENANT_ID,
    name: LALIA_MARKETING_BRAND.name,
    domain: LALIA_MARKETING_BRAND.domain,
    tagline: LALIA_MARKETING_BRAND.tagline,
    pricingSummary: LALIA_MARKETING_BRAND.pricingSummary,
    coreFeatures: LALIA_MARKETING_BRAND.coreFeatures,
    targetAudiences: LALIA_MARKETING_BRAND.targetAudiences,
    signupUrl: LALIA_MARKETING_BRAND.signupUrl,
  };
}

function createResendAdapter() {
  return {
    async sendEmail(m) {
      const [emailCfg, marketing] = await Promise.all([
        getEmailSettings(),
        getResolvedMarketingEmailConfig(),
      ]);
      if (!emailCfg.resendApiKey) {
        return { status: 'skipped', error: 'No Resend API key configured' };
      }
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${emailCfg.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: marketing.from,
          to: [m.to],
          subject: m.subject,
          html: m.html,
          headers: m.headers,
          tags: m.tags,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { status: 'failed', error: json?.message || `Resend HTTP ${res.status}` };
      }
      return { status: 'sent', providerMessageId: json?.id || null };
    },
    async sendBatch(messages) {
      const [emailCfg, marketing] = await Promise.all([
        getEmailSettings(),
        getResolvedMarketingEmailConfig(),
      ]);
      if (!emailCfg.resendApiKey) {
        return messages.map((m) => ({
          to: m.to,
          status: 'skipped',
          error: 'No Resend API key configured',
        }));
      }
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${emailCfg.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          messages.map((m) => ({
            from: marketing.from,
            to: [m.to],
            subject: m.subject,
            html: m.html,
            headers: m.headers,
            tags: m.tags,
          }))
        ),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return messages.map((m) => ({
          to: m.to,
          status: 'failed',
          error: json?.message || `Resend HTTP ${res.status}`,
        }));
      }
      const ids = Array.isArray(json?.data) ? json.data : [];
      return messages.map((m, i) =>
        ids[i]?.id
          ? { to: m.to, status: 'sent', providerMessageId: ids[i].id }
          : { to: m.to, status: 'failed', error: 'Missing id in batch response' }
      );
    },
  };
}

function createImageAdapter() {
  const openaiKey = process.env.OPENAI_API_KEY || process.env.TRANSLATION_API_KEY;
  const xaiKey = process.env.XAI_API_KEY || process.env.TRANSLATION_API_KEY;
  if (!openaiKey && !xaiKey) return undefined;
  return {
    async generateImage({ prompt }) {
      if (openaiKey && !String(process.env.TRANSLATION_API_PROVIDER || '').includes('xai')) {
        const res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: process.env.MARKETING_OPENAI_IMAGE_MODEL || 'gpt-image-1',
            prompt,
            size: '1536x1024',
            quality: 'medium',
          }),
          signal: AbortSignal.timeout(90_000),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error?.message || `OpenAI image HTTP ${res.status}`);
        const b64 = json?.data?.[0]?.b64_json;
        if (!b64) throw new Error('OpenAI returned no image');
        return { data: Buffer.from(b64, 'base64'), contentType: 'image/png' };
      }
      const res = await fetch('https://api.x.ai/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${xaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.MARKETING_XAI_IMAGE_MODEL || 'grok-imagine-image',
          prompt: String(prompt).slice(0, 1000),
          n: 1,
          response_format: 'b64_json',
        }),
        signal: AbortSignal.timeout(90_000),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || json?.error || `xAI image HTTP ${res.status}`);
      const b64 = json?.data?.[0]?.b64_json;
      if (!b64) throw new Error('xAI returned no image');
      return {
        data: Buffer.from(b64, 'base64'),
        contentType: String(json?.data?.[0]?.mime_type || 'image/jpeg'),
      };
    },
  };
}

let kitSingleton = null;

function getLaliaMarketingKit() {
  if (kitSingleton) return kitSingleton;

  const options = {
    tenantId: TENANT_ID,
    db: createSqliteMarketingDb(),
    brand: LALIA_MARKETING_BRAND,
    mountPath: '/marketing',
    assetBaseUrl: APP_ORIGIN,
    llmTimeoutMs: 360_000,
    llm: {
      complete: async ({ system, user, temperature }) => {
        if (!aiEnabled()) {
          throw new Error('No LLM provider configured for marketing');
        }
        // callSupportLlm uses a fixed temperature; ignore temperature for host adapter parity.
        void temperature;
        return callSupportLlm(system, user, { json: false });
      },
    },
    imageGen: createImageAdapter(),
    email: createResendAdapter(),
    codebase: createMarketingCodebaseAdapter({
      root: LIVEKIT_ROOT,
      label: 'Lalia',
      allowlist: [
        'backend/docs/support',
        'backend/lib',
        'frontend/src/components/marketing',
        'frontend/src/v2',
        'frontend/public/blog',
      ],
      maxFilesWalk: 400,
    }),
    resolveUser: async (req) => {
      const u = await resolveHostUser(req);
      if (!u) return null;
      return {
        id: u.id,
        email: u.email || undefined,
        name: u.name || undefined,
        role: u.role === 'admin' ? 'admin' : 'user',
      };
    },
    opsKeys: () => [process.env.MARKETING_FEDERATION_KEY],
    resendWebhookSecret: async () => (await getResolvedMarketingEmailConfig()).webhookSecret,
    getProductContext: productContext,
    listSegments,
    resolveSegmentContacts,
  };

  kitSingleton = createMarketingKit(options);
  return kitSingleton;
}

function loadSeedPosts() {
  const p = path.join(__dirname, 'marketingSeedPosts.json');
  try {
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    console.warn('[marketing] seed posts load failed:', e.message);
    return [];
  }
}

async function initLaliaMarketing() {
  const kit = getLaliaMarketingKit();
  await kit.ensureSchema();
  const seeds = loadSeedPosts();
  if (seeds.length) {
    const seeded = await kit.seedPosts(TENANT_ID, seeds);
    if (seeded) console.log(`[marketing] seeded ${seeded} journal posts`);
  }
  kit.startScheduler(60_000);
  return kit;
}

function marketingKitEnabled() {
  const v = String(process.env.MARKETING_KIT_ENABLED ?? 'true').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

module.exports = {
  LALIA_MARKETING_BRAND,
  getLaliaMarketingKit,
  initLaliaMarketing,
  marketingKitEnabled,
  createSqliteMarketingDb,
};
