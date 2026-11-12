const {getSupportRecoveryDatabase,closeSupportRecoveryDatabase}=require('./supportRecoveryDatabase');
const {createSupportRecoveryGateway}=require('@rhule/ops-sdk');
const {hostSupportAuthority,legacySupportFence,fenceSupportAdapter,supportAuthorityHttp}=require('./supportAuthority');
/**
 * ShareApp host wiring for @quill/support-kit.
 * Thin adapters only — tickets/KB/agent live in the kit.
 */
const path = require('path');
const {createShareAppPending}=require('./supportPending');
const {createSupportReplayPump}=require('@rhule/ops-sdk');
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
} = require('@quill/support-core');
const { createTelegramOpsNotifier } = require('@quill/support-channels');
const {
  createOpsSupportProxyMiddleware,
  getOpsHubConfig,
  syncContact,
  syncCuratedDocsToOpsHub,
  backfillLaliaStateToOpsHub,
  syncSupportHistoryToOpsHub,
} = require('./opsHubClient');

const LIVEKIT_ROOT = path.join(__dirname, '../..');
const DOCS_ROOT = path.join(__dirname, '../docs/support');

function createSqliteSupportDb() {
  return {
    async run(sql, params = []) {
      legacySupportFence.assertLease();
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

function createPending(trusted={}) {
  return createShareAppPending({db:{...db,...require('./supportRecoveryDatabase').getSupportAcceptanceStore().sql},verifyToken,...trusted,describeUser:async(user,orgId)=>{
    let planLabel='member';
    if(orgId){const ent=await getOrgEntitlements(orgId);planLabel=ent?.planName||ent?.planId||planLabel;}
    return {planLabel,contextSummary:await buildContextSummary(user,orgId,'user')};
  }});
}
async function resolveUser(req){const user=await createPending().resolveUser(req);return user?{...user,role:isSuperadminEmail(user.email)?'admin':'user'}:null;}

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
function createShareAppSupportRouter(trusted={resolveAuthority:hostSupportAuthority.resolveAuthority}) {
  const pending={...createPending(trusted),authorizeTransfer:hostSupportAuthority.authorizeTransfer,withAcceptance:hostSupportAuthority.withAcceptance};
  const recovery=createSupportRecoveryGateway({...pending,businessId:'lalia',db:{transaction:work=>getSupportRecoveryDatabase().transaction(work)},state:()=>hostSupportAuthority.read(),resolveUser});
  const replay=createSupportReplayPump({...pending,resolveUser,getConfig:hostSupportAuthority.config});
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
    opsNotifier: fenceSupportAdapter(createOpsNotifier()),
    trackBackground:legacySupportFence.track,
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
    onLeadCaptured: async (lead) => {
      await syncContact({
        externalUserId: `lead:${lead.id}`,
        email: lead.email,
        name: lead.name,
        phone: lead.phone || undefined,
        planTier: 'free',
        lifecycleState: 'lead_only',
        marketingOptIn: Boolean(lead.marketingEmailOptIn),
        source: `support_lead:${lead.source || 'public_launcher'}`,
        consentText: lead.consentText || undefined,
      });
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

  for(const key of ['email','llm','github'])if(options[key])options[key]=fenceSupportAdapter(options[key]);
  if(options.onLeadCaptured){const capture=options.onLeadCaptured;options.onLeadCaptured=lead=>legacySupportFence.effect(async()=>capture(lead));}
  if(options.telegram){const create=options.telegram.createClient;options.telegram.createClient=cfg=>fenceSupportAdapter(create(cfg));}
  const localRouter = createSupportRouter(options);
  const proxiedHandler = createOpsSupportProxyMiddleware({
    resolveUser,
    localHandler: (req, res, next) => legacySupportFence.run(()=>localRouter.handler(req,res,next)),
    db,
    central:pending,
  });
  return {
    ...localRouter,
    pending,
    startReplay:()=>{if(!trusted.resolveAuthority)return()=>{};replay.start();recovery.startReplay();return()=>{replay.stop();recovery.stopReplay();};},
    stopReplay:()=>{replay.stop();recovery.stopReplay();void closeSupportRecoveryDatabase();},
    handler:async(req,res,next)=>{try{if(await supportAuthorityHttp(req,res))return;const state=await hostSupportAuthority.read();if(state.state==='recovery')return await recovery.handler(req,res);return await proxiedHandler(req,res,next);}catch{if(!res.headersSent)res.status(503).json({error:'Support authority unavailable',retryable:true});}},
  };
}

function supportKitEnabled() {
  // Default on — FE uses @quill/support-react against /api/v2/support.
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
  if((await hostSupportAuthority.read()).state!=='unmanaged'){await createPending().ensureSchema();return {central:true};}
  const { ensureSchema, seedCuratedDocs } = require('@quill/support-core');
  const supportDb = createSqliteSupportDb();
  return legacySupportFence.run(async()=>{
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
  });
}
