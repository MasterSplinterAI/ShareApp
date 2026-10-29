/**
 * ShareApp host wiring for @rhule/support-kit.
 * Thin adapters only — tickets/KB/agent live in the kit.
 */
const path = require('path');
const db = require('../db/v2Database');
const { verifyToken } = require('./authAdapter');
const { isSuperadminEmail } = require('./v2Superadmin');
const { getOrgEntitlements } = require('./v2Entitlements');
const { buildUserContextSnapshot, formatUserContextForPrompt } = require('./supportUserContext');
const { aiEnabled, callSupportLlm } = require('./supportAgent/llm');
const { sendEmail } = require('./mailer');
const { githubConfigured } = require('./githubIssues');
const {
  createSupportRouter,
  createFilesystemCodebaseAdapter,
} = require('@rhule/support-core');
const { createTelegramOpsNotifier } = require('@rhule/support-channels');

const LIVEKIT_ROOT = path.join(__dirname, '../..');
const DOCS_ROOT = path.join(__dirname, '../docs/support');

function createSqliteSupportDb() {
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

function parseAllowedTelegramUserIds() {
  return String(process.env.SUPPORT_TELEGRAM_ALLOWED_USER_IDS || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveTelegramConfig() {
  const botToken = String(process.env.SUPPORT_TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(process.env.SUPPORT_TELEGRAM_CHAT_ID || '').trim();
  if (!botToken || !chatId) return null;
  return {
    botToken,
    chatId,
    webhookSecret: String(process.env.SUPPORT_TELEGRAM_WEBHOOK_SECRET || '').trim(),
    allowedUserIds: parseAllowedTelegramUserIds(),
  };
}

function adminBaseUrl() {
  const base = (
    process.env.PUBLIC_FRONTEND_BASE_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:5174'
  )
    .trim()
    .replace(/\/$/, '');
  return `${base}/v2/app/admin/support`;
}

async function buildContextSummary(user, orgId, role) {
  try {
    const snapshot = await buildUserContextSnapshot({
      userId: user.id,
      orgId,
      email: user.email,
    });
    const formatted = formatUserContextForPrompt(snapshot);
    return [
      formatted,
      '- Product: Lalia (ShareApp) — meetings, live captions/translation, org billing.',
      '- Escalate refunds, chargebacks, and payment-method changes to human ops.',
    ].join('\n');
  } catch {
    return [
      `- Role: ${role}`,
      `- Email: ${user.email || 'unknown'}`,
      `- Product: Lalia (ShareApp) — meetings, live captions/translation, org billing.`,
      '- Escalate refunds, chargebacks, and payment-method changes to human ops.',
    ].join('\n');
  }
}

async function resolveUser(req) {
  const header = req?.headers?.authorization || '';
  const m = String(header).match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  let payload;
  try {
    payload = verifyToken(m[1]);
  } catch {
    return null;
  }
  if (!payload?.sub) return null;

  const user = await db.get(
    `SELECT id, email, display_name FROM v2_users WHERE id = ?`,
    [payload.sub]
  );
  if (!user) return null;

  const isAdmin = isSuperadminEmail(user.email);
  let orgId = payload.orgId || undefined;
  if (!orgId) {
    try {
      const mem = await db.get(
        `SELECT org_id FROM v2_org_members WHERE user_id = ? LIMIT 1`,
        [user.id]
      );
      if (mem?.org_id) orgId = mem.org_id;
    } catch {
      /* ignore */
    }
  }
  const role = isAdmin ? 'admin' : 'user';
  let planLabel = role === 'admin' ? 'platform admin' : 'member';
  try {
    if (orgId) {
      const ent = await getOrgEntitlements(orgId);
      if (ent?.planName || ent?.planId) {
        planLabel = ent.planName || ent.planId;
      }
    }
  } catch {
    /* ignore */
  }

  const contextSummary = await buildContextSummary(user, orgId, role);
  const out = {
    id: user.id,
    role,
    planLabel,
    contextSummary,
  };
  if (user.email) out.email = user.email;
  if (user.display_name) out.name = user.display_name;
  if (orgId) out.orgId = orgId;
  return out;
}

function createOpsNotifier() {
  return {
    async sendToOps(notification) {
      const cfg = resolveTelegramConfig();
      if (!cfg) return;
      const enriched = { ...notification };
      if (enriched.ticketPublicNumber != null && !enriched.adminUrl) {
        enriched.adminUrl = `${adminBaseUrl()}?ticket=${enriched.ticketPublicNumber}`;
      }
      const notifier = createTelegramOpsNotifier({
        botToken: cfg.botToken,
        chatId: cfg.chatId,
      });
      await notifier.sendToOps(enriched);
    },
    async notifyProposalReady(input) {
      const cfg = resolveTelegramConfig();
      if (!cfg) return { ok: false };
      const notifier = createTelegramOpsNotifier({
        botToken: cfg.botToken,
        chatId: cfg.chatId,
      });
      const adminUrl =
        input.adminUrl ||
        (input.ticketPublicNumber != null
          ? `${adminBaseUrl()}?ticket=${input.ticketPublicNumber}`
          : undefined);
      if (!cfg.webhookSecret || !cfg.allowedUserIds.length) {
        await notifier.sendToOps({
          kind: 'proposal_ready',
          title: `AI proposal — ticket #${input.ticketPublicNumber}`,
          body: [
            input.proposal.summary,
            '',
            '⚠️ Claim / Approve buttons inactive — set SUPPORT_TELEGRAM_WEBHOOK_SECRET and SUPPORT_TELEGRAM_ALLOWED_USER_IDS.',
          ].join('\n'),
          ticketPublicNumber: input.ticketPublicNumber,
          ...(adminUrl ? { adminUrl } : {}),
        });
        return { ok: true };
      }
      return notifier.notifyProposalReady({
        ...input,
        ...(adminUrl ? { adminUrl } : {}),
      });
    },
  };
}

function createGithubAdapter() {
  if (!githubConfigured()) return undefined;
  const axios = require('axios');
  const raw = String(process.env.GITHUB_REPO || '').trim();
  const m = raw.match(/^([^/]+)\/([^/]+)$/);
  if (!m) return undefined;
  const owner = m[1];
  const repo = m[2].replace(/\.git$/, '');

  return {
    async createIssue({ title, body, labels, kind, ticketPublicNumber }) {
      const defaultLabels =
        kind === 'bug' ? ['bug', 'from-support'] : ['enhancement', 'from-support'];
      const res = await axios.post(
        `https://api.github.com/repos/${owner}/${repo}/issues`,
        {
          title: String(title).slice(0, 256),
          body: [
            body || '',
            '',
            `Ticket: #${ticketPublicNumber}`,
            `Admin: ${adminBaseUrl()}?ticket=${ticketPublicNumber}`,
            '',
            '_Created from Lalia support-kit._',
          ].join('\n'),
          labels: labels?.length ? labels : defaultLabels,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          timeout: 20000,
        }
      );
      return { url: res.data.html_url, number: res.data.number };
    },
  };
}

/**
 * @returns {{ handler: Function, meta: object }}
 */
function createShareAppSupportRouter() {
  const frontendBase = (
    process.env.PUBLIC_FRONTEND_BASE_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:5174'
  )
    .trim()
    .replace(/\/$/, '');

  const options = {
    tenantId: 'lalia',
    db: createSqliteSupportDb(),
    brand: {
      name: 'Lalia',
      supportAgentName: 'Lalia Help',
      agentAuthorId: 'lalia-support-ai',
      featureCoachSystemHint:
        'Lalia is a live meeting product with real-time captions and translation, guest invites, org billing, and admin tools. Prefer concrete UX/workflow improvements over speculative platform rewrites.',
      signupUrl: `${frontendBase}/v2/signup`,
    },
    docsRoot: DOCS_ROOT,
    adminBaseUrl: adminBaseUrl(),
    opsNotifier: createOpsNotifier(),
    resolveUser,
    codebase: createFilesystemCodebaseAdapter({
      root: LIVEKIT_ROOT,
      label: 'ShareApp',
      allowlist: [
        'backend/docs/support',
        'backend/lib',
        'backend/routes',
        'frontend/src',
      ],
    }),
    email: {
      async sendToUser({ to, subject, body }) {
        await sendEmail({ to, subject, text: body });
      },
    },
    telegram: {
      resolveConfig: resolveTelegramConfig,
      createClient: (cfg) =>
        createTelegramOpsNotifier({
          botToken: cfg.botToken,
          chatId: cfg.chatId,
        }),
    },
  };

  const github = createGithubAdapter();
  if (github) options.github = github;

  if (aiEnabled()) {
    options.llm = {
      complete: async ({ system, user }) =>
        callSupportLlm(system, user, { json: false }),
    };
  }

  if (process.env.SUPPORT_KB_INGEST_TOKEN) {
    options.kbIngest = {
      webhookSecret: process.env.SUPPORT_KB_INGEST_TOKEN,
    };
  }

  return createSupportRouter(options);
}

function supportKitEnabled() {
  // Default on — FE uses @rhule/support-react against /api/v2/support.
  // Set SUPPORT_KIT_ENABLED=false only with a matching FE rollback to legacy HelpPanel.
  const v = String(process.env.SUPPORT_KIT_ENABLED ?? 'true').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

module.exports = {
  createShareAppSupportRouter,
  supportKitEnabled,
  createSqliteSupportDb,
  resolveUser,
  ensureSupportSchema,
};

async function ensureSupportSchema() {
  const { ensureSchema, seedCuratedDocs } = require('@rhule/support-core');
  const supportDb = createSqliteSupportDb();
  const result = await ensureSchema(supportDb);
  console.log(
    `[support] schema ensured (prefix=${result.tablePrefix}, applied=${result.statements})`
  );
  if ( typeof seedCuratedDocs === 'function') {
    try {
      const seeded = await seedCuratedDocs(supportDb, 'lalia', DOCS_ROOT);
      console.log(
        `[support] curated docs seeded (ingested=${seeded.ingested}, promoted=${seeded.promoted})`
      );
    } catch (e) {
      console.warn('[support] seedCuratedDocs skipped:', e.message);
    }
  }
  return result;
}
