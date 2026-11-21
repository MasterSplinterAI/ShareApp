import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DEFAULT_TOPICS,
  DEFAULT_MARKETING_CONSENT_LABEL,
  KIT_VERSION,
  TicketKindSchema,
  TicketStatusSchema,
} from "@quill/support-shared";
import type {
  BrandConfig,
  CreateTicketInput,
  SupportUser,
} from "@quill/support-shared";
import type {
  DurableMutationScope,
  SupportAction,
  CodebaseAdapter,
  CreateSupportRouterOptions,
  DbAdapter,
  EmailNotifier,
  GitHubAdapter,
  KbIngestConfig,
  LlmAdapter,
  OpsNotifier,
  ResolveTenant,
  ResolveUser,
  SupportRouter,
} from "../adapters/types.js";
import { ensureSchema, DEFAULT_TABLE_PREFIX } from "../db/migrate.js";
import { TicketService } from "../tickets/service.js";
import { TenantStore, CreateTenantInput, type TenantBrand } from "../tenants/store.js";
import { ProposalService } from "../proposals/service.js";
import { KnowledgeGapService } from "../gaps/service.js";
import { LeadService } from "../leads/service.js";
import { triageMessage, prepareTriage, persistPreparedTriage, type TriageDeps } from "../agent/triage.js";
import {
  PublishedKnowledgeConflict,
  deprecateKbArticle,
  getKbArticle,
  ingestDocsSources,
  ingestFromChangelog,
  listKbArticles,
  listKbRevisions,
  promoteKbArticle,
  updateKbArticle,
} from "../kb/codegen.js";
import {validateDocsSources} from "../kb/docsArtifact.js";
import { searchActiveArticles } from "../kb/search.js";
import { promoteTicketAnswerToKb } from "../kb/evolutionary.js";
import { executeProposalAction } from "../proposals/executor.js";
import {
  handleTelegramUpdate,
  verifyTelegramWebhookSecret,
} from "../telegram/webhook.js";
import { curateAnswerToKbDraft, researchGapToKbDraft } from "../kb/gapResearch.js";
import { coachFeatureRequest } from "../agent/featureCoach.js";
import { authorizeOperatorRoute } from "./authorization.js";
import { GuestSessions } from "./guestSessions.js";
import { normalizeAction } from "../proposals/executor.js";
import { createHash } from "node:crypto";

type JsonResponse = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
};

type MockRequest = {
  method: string;
  url: string;
  path?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

function parsePath(url: string): string {
  const raw = url.split("?")[0] ?? url;
  return raw.endsWith("/") && raw.length > 1 ? raw.slice(0, -1) : raw;
}

function parseQueryString(url: string): Record<string, string> {
  const qs = url.includes("?") ? url.split("?")[1]! : "";
  const params = new URLSearchParams(qs);
  const out: Record<string, string> = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}

function requireAdmin(user: SupportUser): boolean {
  return user.role === "admin" || user.role === "ops";
}

function requirePlatformAdmin(user: SupportUser): boolean {
  return user.platformAdmin === true;
}

function header(
  req: MockRequest & IncomingMessage,
  name: string,
): string | undefined {
  const headers = (req.headers ?? {}) as Record<string, string | string[] | undefined>;
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

async function isKbIngestAuthed(opts: {
  secret: string | undefined;
  token: string | undefined;
  user: SupportUser | null;
  tenantId: string;
  tenantStore: TenantStore;
}): Promise<boolean> {
  const { secret, token, user, tenantId, tenantStore } = opts;
  if (secret && token && token === secret) return true;
  if (user && requireAdmin(user)) return true;
  if (token?.trim()) {
    return tenantStore.verifyIngestToken(tenantId, token);
  }
  return false;
}

function matchRoute(
  method: string,
  path: string,
): { name: string; params: Record<string, string> } | null {
  if (method === "GET" && path === "/health") return { name: "health", params: {} };
  if (method === "GET" && path === "/config") return { name: "config", params: {} };
  if (method === "POST" && path === "/chat") return { name: "chat", params: {} };
  if (method === "POST" && path === "/coach") return { name: "coach", params: {} };
  if (method === "POST" && path === "/guest-session") return {name:"guestBootstrap",params:{}};
  if (method === "POST" && path === "/leads") return { name: "createLead", params: {} };
  if (method === "GET" && path === "/tickets") return { name: "listTickets", params: {} };
  if (method === "POST" && path === "/tickets") return { name: "createTicket", params: {} };

  const ticketReply = path.match(/^\/tickets\/([^/]+)\/messages$/);
  if (method === "POST" && ticketReply) {
    return { name: "replyTicket", params: { id: ticketReply[1]! } };
  }

  const ticketMatch = path.match(/^\/tickets\/([^/]+)$/);
  if (method === "GET" && ticketMatch) {
    return { name: "getTicket", params: { id: ticketMatch[1]! } };
  }

  if (method === "GET" && path === "/help/articles") {
    return { name: "publicHelp", params: {} };
  }

  if (method === "GET" && path === "/admin/tickets") {
    return { name: "adminListTickets", params: {} };
  }
  if (method === "GET" && path === "/admin/proposals") {
    return { name: "adminListProposals", params: {} };
  }
  if (method === "GET" && path === "/admin/kb") {
    return { name: "adminListKb", params: {} };
  }
  if (method === "GET" && path === "/admin/gaps") {
    return { name: "adminListGaps", params: {} };
  }
  if (method === "GET" && path === "/admin/leads") {
    return { name: "adminListLeads", params: {} };
  }
  if (method === "POST" && path === "/admin/kb/ingest") {
    return { name: "adminKbIngest", params: {} };
  }
  if (method === "POST" && path === "/admin/kb/ingest/website") {
    return { name: "adminKbIngestWebsite", params: {} };
  }
  if (method === "POST" && path === "/admin/kb/ingest/uploads") {
    return { name: "adminKbIngestUploads", params: {} };
  }

  if (method === "POST" && path === "/telegram/webhook") {
    return { name: "telegramWebhook", params: {} };
  }

  const adminKbPromote = path.match(/^\/admin\/kb\/([^/]+)\/promote$/);
  if (method === "POST" && adminKbPromote) {
    return { name: "adminKbPromote", params: { id: adminKbPromote[1]! } };
  }
  const adminKbDeprecate = path.match(/^\/admin\/kb\/([^/]+)\/deprecate$/);
  if (method === "POST" && adminKbDeprecate) {
    return { name: "adminKbDeprecate", params: { id: adminKbDeprecate[1]! } };
  }
  const adminKbRevisions=path.match(/^\/admin\/kb\/([^/]+)\/revisions$/);
  if(method==='GET' && adminKbRevisions)return {name:'adminKbRevisions',params:{id:adminKbRevisions[1]!}};
  const adminKbPatch = path.match(/^\/admin\/kb\/([^/]+)$/);
  if (method === "PATCH" && adminKbPatch) {
    return { name: "adminKbPatch", params: { id: adminKbPatch[1]! } };
  }
  if (method === "GET" && adminKbPatch) {
    return { name: "adminKbGet", params: { id: adminKbPatch[1]! } };
  }

  const adminGapPatch = path.match(/^\/admin\/gaps\/([^/]+)$/);
  if (method === "PATCH" && adminGapPatch) {
    return { name: "adminGapPatch", params: { id: adminGapPatch[1]! } };
  }
  const adminGapResearch = path.match(/^\/admin\/gaps\/([^/]+)\/research$/);
  if (method === "POST" && adminGapResearch) {
    return { name: "adminGapResearch", params: { id: adminGapResearch[1]! } };
  }

  const adminTicketReply = path.match(/^\/admin\/tickets\/([^/]+)\/reply$/);
  if (method === "POST" && adminTicketReply) {
    return { name: "adminReplyTicket", params: { idOrNumber: adminTicketReply[1]! } };
  }

  const adminTicketStatus = path.match(/^\/admin\/tickets\/([^/]+)\/status$/);
  if (method === "PATCH" && adminTicketStatus) {
    return { name: "adminSetTicketStatus", params: { idOrNumber: adminTicketStatus[1]! } };
  }

  const adminTicketPromoteKb = path.match(/^\/admin\/tickets\/([^/]+)\/promote-kb$/);
  if (method === "POST" && adminTicketPromoteKb) {
    return { name: "adminPromoteKb", params: { idOrNumber: adminTicketPromoteKb[1]! } };
  }

  const adminTicketDetail = path.match(/^\/admin\/tickets\/([^/]+)$/);
  if (method === "GET" && adminTicketDetail) {
    return { name: "adminGetTicket", params: { idOrNumber: adminTicketDetail[1]! } };
  }

  const adminProposalAction = path.match(/^\/admin\/proposals\/([^/]+)\/action$/);
  if (method === "POST" && adminProposalAction) {
    return { name: "adminProposalAction", params: { id: adminProposalAction[1]! } };
  }

  // Multi-tenant hosted platform: tenant-selected embed page (one-line iframe).
  if (method === "GET" && path === "/embed") {
    return { name: "embedPage", params: {} };
  }

  // Tenant registry (platform-level, admin-gated).
  if (method === "POST" && path === "/tenants") {
    return { name: "createTenant", params: {} };
  }
  if (method === "GET" && path === "/tenants") {
    return { name: "listTenants", params: {} };
  }
  const tenantById = path.match(/^\/tenants\/([^/]+)$/);
  if (tenantById) {
    if (method === "GET") {
      return { name: "getTenant", params: { id: tenantById[1]! } };
    }
    if (method === "PATCH") {
      return { name: "patchTenant", params: { id: tenantById[1]! } };
    }
    if (method === "DELETE") {
      return { name: "deleteTenant", params: { id: tenantById[1]! } };
    }
  }

  return null;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return undefined;
  return JSON.parse(raw) as unknown;
}

function createMockResponse(): {
  res: ServerResponse;
  done: Promise<JsonResponse>;
} {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: unknown;
  let resolveDone!: (value: JsonResponse) => void;

  const done = new Promise<JsonResponse>((resolve) => {
    resolveDone = resolve;
  });

  const resObj: {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    status: (code: number) => typeof resObj;
    json: (payload: unknown) => void;
    end: (payload?: string) => void;
  } = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      statusCode = code;
      resObj.statusCode = code;
      return resObj;
    },
    json(payload: unknown) {
      body = payload;
      resolveDone({ statusCode, body, headers });
    },
    end(payload?: string) {
      if (payload) {
        try {
          body = JSON.parse(payload);
        } catch {
          body = payload;
        }
      }
      resolveDone({ statusCode, body, headers });
    },
  };

  return { res: resObj as unknown as ServerResponse, done };
}

export interface HttpRouterContext {
  mutationMode?: CreateSupportRouterOptions['mutationMode'];
  durableMutations?: CreateSupportRouterOptions['durableMutations'];
  listDeliveries?: CreateSupportRouterOptions['listDeliveries'];
  effects?: DurableMutationScope;
  preparedTriage?: Awaited<ReturnType<typeof prepareTriage>>;
  authorizationMode?: CreateSupportRouterOptions['authorizationMode'];
  authorizeSupport?: CreateSupportRouterOptions['authorizeSupport'];
  tenantId: string;
  db: DbAdapter;
  resolveUser: ResolveUser;
  brand: BrandConfig;
  llm?: LlmAdapter;
  tablePrefix?: string;
  docsRoot?: string;
  opsNotifier?: OpsNotifier;
  adminBaseUrl?: string;
  topics?: string[];
  sensitiveTopics?: string[];
  autoReplyMinConfidence?: number;
  github?: GitHubAdapter;
  email?: EmailNotifier;
  kbIngest?: KbIngestConfig;
  telegram?: CreateSupportRouterOptions["telegram"];
  codebase?: CodebaseAdapter;
  onLeadCaptured?: CreateSupportRouterOptions["onLeadCaptured"];
  trackBackground?: CreateSupportRouterOptions["trackBackground"];
  resolveTenant?: ResolveTenant;
}

function notifyEmail(
  email: EmailNotifier | undefined,
  ticket: {
    guestEmail?: string | null | undefined;
    publicNumber: number;
    contextJson?: string | null | undefined;
  },
  body: string,
  brandName: string,
): void {
  if (!email) return;
  let to = ticket.guestEmail ?? undefined;
  if (!to && ticket.contextJson) {
    try {
      const ctx = JSON.parse(ticket.contextJson) as { email?: string | null };
      to = ctx.email ?? undefined;
    } catch {
      /* ignore */
    }
  }
  if (!to) return;
  email
    .sendToUser({
      to,
      subject: `${brandName} support — ticket #${ticket.publicNumber}`,
      body,
      ticketPublicNumber: ticket.publicNumber,
    })
    .catch(() => {});
}

/**
 * Express-compatible support HTTP surface.
 */
export function createHttpRouter(baseCtx: HttpRouterContext): SupportRouter {
  const tablePrefix = baseCtx.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const topics = baseCtx.topics ?? [...DEFAULT_TOPICS];
  // A host may construct its dormant local router after central enrollment.
  // Start schema writes only inside an invoked handler's authority fence.
  let ready: ReturnType<typeof ensureSchema> | undefined;
  const ensureReady = async () => {
    try {
      const result = await (ready ??= ensureSchema(baseCtx.db, tablePrefix));
      if (result.statements === 0) ready = undefined;
      return result;
    } catch (error) {
      ready = undefined;
      throw error;
    }
  };
  const tenantStore = new TenantStore(baseCtx.db, tablePrefix);
  const central = baseCtx.authorizationMode === 'central';
  const guestSessions = new GuestSessions(baseCtx.db, tablePrefix);
  let guestSchemaReady: Promise<void> | undefined;

  const dispatch = async (req: unknown, res: unknown, _next?: unknown, transactionContext?: HttpRouterContext) => {
    await ensureReady();

    const r = req as MockRequest & IncomingMessage;
    const response = res as ServerResponse & {
      status?: (n: number) => { json: (b: unknown) => void };
      json?: (b: unknown) => void;
    };

    const method = String(r.method ?? "GET").toUpperCase();
    const path = parsePath(String(r.url ?? r.path ?? "/"));
    const route = matchRoute(method, path);

    const finish = (status: number, body: unknown) => {
      if (typeof response.status === "function" && typeof response.json === "function") {
        response.status(status).json(body);
        return;
      }
      sendJson(response, status, body);
    };

    // Per-request tenant resolution (multi-tenant hosted platform).
    // A `?tenant=` query param or `x-tenant-id` header selects the tenant;
    // the host's resolveTenant hook maps it to that tenant's id + brand.
    // Every downstream `ctx.tenantId` / `ctx.brand` reference uses the
    // per-request override when a tenant resolves, else the default tenant.
    const queryTenant = parseQueryString(String(r.url ?? r.path ?? "/")).tenant;
    const headerTenant = header(r, "x-tenant-id");
    const requestedTenantId = queryTenant ?? headerTenant;
    // Internal redispatch already carries the authorized, resolved business.
    // Re-resolving through the host here may acquire a second pool connection.
    const resolved = transactionContext
      ? { tenantId: transactionContext.tenantId, brand: transactionContext.brand }
      : baseCtx.resolveTenant && requestedTenantId
        ? await baseCtx.resolveTenant(req, requestedTenantId)
        : null;
    if ((central || baseCtx.authorizeSupport) && (
      (queryTenant && headerTenant && queryTenant !== headerTenant) ||
      (requestedTenantId && requestedTenantId !== baseCtx.tenantId && !resolved) ||
      (resolved?.tenantId ?? baseCtx.tenantId) === 'all'
    )) { finish(403, {ok:false,error:'Invalid business scope'}); return; }
    let ctx: HttpRouterContext = transactionContext ?? (resolved
      ? { ...baseCtx, ...resolved }
      : {...baseCtx});
    if(central && resolved && !transactionContext){
      // A missing tenant adapter means unavailable, never fallback to another
      // business's globally configured provider or documentation source.
      for(const key of ['llm','codebase','email','opsNotifier','github'] as const)
        if(!resolved[key])delete ctx[key];
      delete ctx.docsRoot;
    }
    const requiredActions = new Set<SupportAction>();
    if(ctx.authorizeSupport) { const authorize=ctx.authorizeSupport; ctx={...ctx,authorizeSupport:async input=>{const allowed=await authorize(input);if(allowed)requiredActions.add(input.action);return allowed;}};}

    if (!route) {
      finish(404, { ok: false, error: "Not found" });
      return;
    }

    if (route.name === "health") {
      finish(200, {
        ok: true,
        kit: "support-kit",
        tenantId: ctx.tenantId,
        brand: ctx.brand.name,
      });
      return;
    }

    // Multi-tenant embed page: self-contained drop-in widget (one-line iframe).
    if (route.name === "embedPage") {
      const { buildEmbedPage } = await import("./embedPage.js");
      const html = buildEmbedPage(ctx.brand,ctx.mutationMode==='durable');
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(html);
      return;
    }

    if (central) {
      try { await (guestSchemaReady ??= guestSessions.ensureSchema()); }
      catch { guestSchemaReady = undefined; finish(503,{ok:false,error:'Guest ownership schema unavailable'}); return; }
    }
    if (route.name.startsWith('admin') && (central || ctx.authorizeSupport)) {
      if (r.body === undefined && typeof r.on === 'function') r.body = await readJsonBody(r);
      const body = (r.body ?? {}) as Record<string,unknown>;
      if (['tenant','tenantId','businessId'].some(key => body[key] != null && body[key] !== ctx.tenantId)) {
        finish(403,{ok:false,error:'Conflicting business scope'}); return;
      }
      const status = await authorizeOperatorRoute({actor:await ctx.resolveUser(req),businessId:ctx.tenantId,
        route:route.name,...(route.params.id ?? route.params.idOrNumber ? {id:route.params.id ?? route.params.idOrNumber} : {}),
        body,db:ctx.db,tablePrefix,central,...(ctx.authorizeSupport?{authorizeSupport:ctx.authorizeSupport}:{})});
      if (status !== 200) { finish(status,{ok:false,error:status === 404?'Resource not found':'Forbidden'}); return; }
    }
    if (central && route.name === 'telegramWebhook') {
      // Secret/Telegram allowlist proves transport, not an OpsHub operator grant.
      finish(403,{ok:false,error:'Central Telegram operator mapping is not configured'}); return;
    }

    // Tenant registry (platform-level, admin-gated).
    if (
      route.name === "createTenant" ||
      route.name === "listTenants" ||
      route.name === "getTenant" ||
      route.name === "patchTenant" ||
      route.name === "deleteTenant"
    ) {
      const user = await ctx.resolveUser(req);
      if (!user || !requireAdmin(user)) {
        finish(401, { ok: false, error: "Unauthorized" });
        return;
      }
      if (central && (!ctx.authorizeSupport || user.principalType !== 'operator')) {
        finish(403,{ok:false,error:'Forbidden'}); return;
      }
      const mutating =
        route.name === "createTenant" ||
        route.name === "patchTenant" ||
        route.name === "deleteTenant";
      if ((mutating || central) && !requirePlatformAdmin(user)) {
        finish(403, { ok: false, error: "Forbidden" });
        return;
      }
      if (route.name === "createTenant") {
        const body = (r.body !== undefined
          ? r.body
          : await readJsonBody(r as IncomingMessage)) as {
          name?: string;
          domain?: string;
          ingestToken?: string;
          brand?: {
            name?: string;
            accent?: string;
            supportAgentName?: string;
            signupUrl?: string;
            contactEmail?: string;
          };
        };
        if (!body?.name?.trim()) {
          finish(400, { ok: false, error: "name is required" });
          return;
        }
        const createInput: CreateTenantInput = { name: body.name };
        if (body.domain !== undefined) createInput.domain = body.domain;
        if (body.ingestToken !== undefined) createInput.ingestToken = body.ingestToken;
        if (body.brand !== undefined) {
          createInput.brand = {
            name: body.brand.name?.trim() || body.name.trim(),
            ...(body.brand.accent !== undefined ? { accent: body.brand.accent } : {}),
            ...(body.brand.supportAgentName !== undefined
              ? { supportAgentName: body.brand.supportAgentName }
              : {}),
            ...(body.brand.signupUrl !== undefined ? { signupUrl: body.brand.signupUrl } : {}),
            ...(body.brand.contactEmail !== undefined
              ? { contactEmail: body.brand.contactEmail }
              : {}),
          };
        }
        const { tenant, ingestToken } = await tenantStore.create(createInput);
        finish(201, { ok: true, tenant, ingestToken });
        return;
      }
      if (route.name === "listTenants") {
        const tenants = await tenantStore.list();
        finish(200, { ok: true, tenants });
        return;
      }
      if (route.name === "getTenant") {
        const t = await tenantStore.getById(route.params.id!);
        if (!t) {
          finish(404, { ok: false, error: "Tenant not found" });
          return;
        }
        finish(200, { ok: true, tenant: t });
        return;
      }
      if (route.name === "patchTenant") {
        const body = (r.body !== undefined
          ? r.body
          : await readJsonBody(r as IncomingMessage)) as {
          name?: string;
          domain?: string | null;
          brand?: {
            name?: string;
            accent?: string;
            supportAgentName?: string;
            signupUrl?: string;
            contactEmail?: string;
          } | null;
        };
        const patch: {
          name?: string;
          domain?: string | null;
          brand?: TenantBrand | null;
        } = {};
        if (body?.name !== undefined) patch.name = body.name;
        if (body?.domain !== undefined) patch.domain = body.domain;
        if (body?.brand !== undefined) {
          if (body.brand === null) {
            patch.brand = null;
          } else {
            const brandPatch: TenantBrand = {
              name: body.brand.name?.trim() || "",
            };
            if (body.brand.accent !== undefined) brandPatch.accent = body.brand.accent;
            if (body.brand.supportAgentName !== undefined) {
              brandPatch.supportAgentName = body.brand.supportAgentName;
            }
            if (body.brand.signupUrl !== undefined) brandPatch.signupUrl = body.brand.signupUrl;
            if (body.brand.contactEmail !== undefined) {
              brandPatch.contactEmail = body.brand.contactEmail;
            }
            patch.brand = brandPatch;
          }
        }
        try {
          const updated = await tenantStore.update(route.params.id!, patch);
          finish(200, { ok: true, tenant: updated });
        } catch {
          finish(404, { ok: false, error: "Tenant not found" });
        }
        return;
      }
      if (route.name === "deleteTenant") {
        const deleted = await tenantStore.remove(route.params.id!);
        if (!deleted) {
          finish(404, { ok: false, error: "Tenant not found" });
          return;
        }
        finish(200, { ok: true });
        return;
      }
    }

    // Telegram Bot webhook — secret token + allowlist; 200 immediately, process async
    if (route.name === "telegramWebhook") {
      if (!ctx.telegram) {
        finish(404, { ok: false, error: "Telegram webhook not configured" });
        return;
      }
      const cfg = await ctx.telegram.resolveConfig();
      if (!cfg?.webhookSecret || !cfg.allowedUserIds.length) {
        finish(503, { ok: false, error: "Telegram webhook not ready" });
        return;
      }
      const secretHeader = header(r, "x-telegram-bot-api-secret-token");
      if (!verifyTelegramWebhookSecret(secretHeader, cfg.webhookSecret)) {
        finish(401, { ok: false, error: "Unauthorized" });
        return;
      }

      const body =
        r.body !== undefined
          ? r.body
          : await readJsonBody(r as IncomingMessage);

      finish(200, { ok: true });

      const webhookDeps = {
        tenantId: ctx.tenantId,
        db: ctx.db,
        brand: ctx.brand,
        tablePrefix,
        resolveTelegram: ctx.telegram.resolveConfig,
        createTelegramApi: ctx.telegram.createClient,
        ...(ctx.github ? { github: ctx.github } : {}),
        ...(ctx.email ? { email: ctx.email } : {}),
        ...(ctx.opsNotifier ? { opsNotifier: ctx.opsNotifier } : {}),
        ...(ctx.adminBaseUrl ? { adminBaseUrl: ctx.adminBaseUrl } : {}),
      };
      const background = handleTelegramUpdate(webhookDeps, body as never);
      ctx.trackBackground?.(background);
      void background.catch((err) => {
        console.error("[support-kit] telegram webhook error:", err);
      });
      return;
    }

    // CI ingest may use deploy token instead of session user
    if (route.name === "adminKbIngest") {
      const secret = ctx.kbIngest?.webhookSecret;
      const token = header(r, "x-support-ingest-token");
      const user = await ctx.resolveUser(req);
      const authed = await isKbIngestAuthed({
        secret,
        token,
        user,
        tenantId: ctx.tenantId,
        tenantStore,
      });
      if (!authed && !ctx.authorizeSupport) {
        finish(401, { ok: false, error: "Unauthorized" });
        return;
      }

      const body = (r.body !== undefined
        ? r.body
        : await readJsonBody(r as IncomingMessage)) as {
        gitSha?: string;
        sourceRevision?:string;
        completeSnapshot?:boolean;
        changelog?: string;
        sources?: Array<{ path: string; title?: string; body: string }>;
      };

      if(body?.sources)try {validateDocsSources(body.sources);} catch(error){finish(400,{ok:false,error:error instanceof Error?error.message:'Invalid docs artifact'});return;}
      const articles = [];
      if (body?.changelog) {
        const changelogOpts: { gitSha?: string; tablePrefix: string; preserveActive:boolean } = { tablePrefix,preserveActive:central };
        if (body.gitSha) changelogOpts.gitSha = body.gitSha;
        articles.push(
          ...(await ingestFromChangelog(ctx.db, ctx.tenantId, body.changelog, changelogOpts)),
        );
      }
      if (body?.sources && (body.sources.length || body.completeSnapshot===true)) {
        const docsOpts: { gitSha?: string; sourceRevision?:string; completeSnapshot?:boolean; tablePrefix: string; preserveActive:boolean } = { tablePrefix,preserveActive:central };
        if(body.sourceRevision)docsOpts.sourceRevision=body.sourceRevision;
        if(body.completeSnapshot===true)docsOpts.completeSnapshot=true;
        if (body.gitSha) docsOpts.gitSha = body.gitSha;
        articles.push(
          ...(await ingestDocsSources(ctx.db, ctx.tenantId, body.sources, docsOpts)),
        );
      }

      if (articles.length > 0 && ctx.opsNotifier) {
        ctx.opsNotifier
          .sendToOps({
            kind: "kb_drafts_ready",
            title: `${articles.length} KB draft(s) from ${body.gitSha ?? "ingest"}`,
            body: articles.map((a) => a.title).slice(0, 8).join(", "),
          })
          .catch(() => {});
      }

      finish(200, { ok: true, articles, count: articles.length });
      return;
    }

    // Website crawl → LLM-curated KB drafts
    if (route.name === "adminKbIngestWebsite") {
      if (central) { finish(503,{ok:false,error:"Central website crawling unavailable until a bounded safe transport is configured"}); return; }
      const secret = ctx.kbIngest?.webhookSecret;
      const token = header(r, "x-support-ingest-token");
      const user = await ctx.resolveUser(req);
      const authed = await isKbIngestAuthed({
        secret,
        token,
        user,
        tenantId: ctx.tenantId,
        tenantStore,
      });
      if (!authed && !ctx.authorizeSupport) {
        finish(401, { ok: false, error: "Unauthorized" });
        return;
      }

      const body = (r.body !== undefined
        ? r.body
        : await readJsonBody(r as IncomingMessage)) as {
        url: string;
        maxPages?: number;
        gitSha?: string;
      };
      if (!body?.url) {
        finish(400, { ok: false, error: "url is required" });
        return;
      }
      if (!ctx.llm) {
        finish(503, { ok: false, error: "LLM adapter not configured" });
        return;
      }
      const { crawlSite, curatePagesToKb } = await import("../kb/siteCrawl.js");
      const pages = await crawlSite(body.url, {
        maxPages: body.maxPages ?? 25,
      });
      const articles = await curatePagesToKb(
        ctx.db,
        ctx.tenantId,
        pages,
        ctx.llm,
        { tablePrefix,preserveActive:central },
      );
      if (articles.length > 0 && ctx.opsNotifier) {
        ctx.opsNotifier
          .sendToOps({
            kind: "kb_drafts_ready",
            title: `${articles.length} KB draft(s) crawled from ${body.url}`,
            body: articles.map((a) => a.title).slice(0, 8).join(", "),
          })
          .catch(() => {});
      }
      finish(200, { ok: true, articles, count: articles.length, pagesCrawled: pages.length });
      return;
    }

    // Doc uploads → LLM-curated KB drafts
    if (route.name === "adminKbIngestUploads") {
      const secret = ctx.kbIngest?.webhookSecret;
      const token = header(r, "x-support-ingest-token");
      const user = await ctx.resolveUser(req);
      const authed = await isKbIngestAuthed({
        secret,
        token,
        user,
        tenantId: ctx.tenantId,
        tenantStore,
      });
      if (!authed && !ctx.authorizeSupport) {
        finish(401, { ok: false, error: "Unauthorized" });
        return;
      }
      if (!ctx.llm) {
        finish(503, { ok: false, error: "LLM adapter not configured" });
        return;
      }
      const body = (r.body !== undefined
        ? r.body
        : await readJsonBody(r as IncomingMessage)) as {
        docs?: Array<{ name: string; content: string }>;
      };
      const docs = (body?.docs ?? []).filter((d) => d.content?.trim());
      if (docs.length === 0) {
        finish(400, { ok: false, error: "docs[] with non-empty content is required" });
        return;
      }
      const { curateDocsToKb } = await import("../kb/siteCrawl.js");
      const articles = await curateDocsToKb(
        ctx.db,
        ctx.tenantId,
        docs,
        ctx.llm,
        { tablePrefix,preserveActive:central },
      );
      if (articles.length > 0 && ctx.opsNotifier) {
        ctx.opsNotifier
          .sendToOps({
            kind: "kb_drafts_ready",
            title: `${articles.length} KB draft(s) from uploaded docs`,
            body: articles.map((a) => a.title).slice(0, 8).join(", "),
          })
          .catch(() => {});
      }
      finish(200, { ok: true, articles, count: articles.length });
      return;
    }

    const hostUser = await ctx.resolveUser(req);
    const user = hostUser ?? (central ? await guestSessions.resolve(ctx.tenantId, header(r,'x-support-guest-token')) : null);
    const durableRoutes = ['chat','createTicket','replyTicket','createLead','adminReplyTicket','adminSetTicketStatus','adminProposalAction'];
    if(ctx.mutationMode === 'durable' && durableRoutes.includes(route.name) && !transactionContext) {
      if(!ctx.durableMutations) { finish(503,{ok:false,error:'Durable mutation adapter unavailable'});return; }
      if(!user) {finish(401,{ok:false,error:'Guest session proof required',code:'guest_session_required'});return;}
      if(route.name === 'replyTicket') {
        const owned=await new TicketService(ctx.db,tablePrefix).getTicket(ctx.tenantId,route.params.id!);
        if(!owned || owned.userId!==user.id) {finish(403,{ok:false,error:'Forbidden'});return;}
      }
      const key=header(r,'idempotency-key');
      if(!key || !/^[A-Za-z0-9:_-]{8,128}$/.test(key)) {finish(400,{ok:false,error:'Valid Idempotency-Key required'});return;}
      if(r.body===undefined && typeof r.on==='function') r.body=await readJsonBody(r);
      const result=await ctx.durableMutations.run({businessId:ctx.tenantId,actor:user,operation:`${method}:${path}`,key,payload:r.body??null,requiredActions:[...requiredActions]},async (scope,prepared)=>{
        if(!scope?.db || !scope.enqueue || !scope.preflight) return {statusCode:503,body:{ok:false,error:'Durable transaction hooks unavailable'}};
        const capture=createMockResponse();
        await dispatch(req,capture.res,undefined,{...ctx,db:scope.db,effects:scope,...(prepared?{preparedTriage:prepared as Awaited<ReturnType<typeof prepareTriage>>}:{}),resolveUser:()=>user});
        const buffered=await capture.done;
        return {statusCode:buffered.statusCode,body:buffered.body};
      },['replyTicket','chat'].includes(route.name)?db=>prepareTriage({...ctx,db,publicAudience:central},{tenantId:ctx.tenantId,user,message:String((r.body as Record<string,unknown>)?.[route.name==='chat'?'message':'body']??'').trim(),...(route.name==='replyTicket'?{existingTicketId:route.params.id!}:{}),...(user.email?{guestEmail:user.email}:{}),...(TicketKindSchema.safeParse((r.body as any)?.kind).success?{kind:(r.body as any).kind}:{}),...((r.body as any)?.topic?{topic:String((r.body as any).topic)}:{})}):undefined);
      finish(result.statusCode,result.body);return;
    }
    const tickets = new TicketService(ctx.db, tablePrefix);
    const proposals = new ProposalService(ctx.db, tablePrefix);
    const gaps = new KnowledgeGapService(ctx.db, tablePrefix);
    const leads = new LeadService(ctx.db, tablePrefix);

    const readBody = async (): Promise<unknown> => {
      if (r.body !== undefined) return r.body;
      if (typeof (r as IncomingMessage).on === "function") {
        return readJsonBody(r as IncomingMessage);
      }
      return undefined;
    };

    try {
      // Public: brand/topics + whether LLM coach is available
      if (route.name === "config") {
        finish(200, {
          ok: true,
          topics,
          kinds: ["support", "bug", "feature"],
          brand: ctx.brand,
          coachEnabled: Boolean(ctx.llm),
          guestTickets: true,
          publicLeads: true,
          guestSessionRequired: central,
          guestBootstrapRequired: ctx.mutationMode === 'durable',
          defaultMarketingConsentLabel: DEFAULT_MARKETING_CONSENT_LABEL,
        });
        return;
      }

      if (route.name === "publicHelp") {
        const articles = await searchActiveArticles(ctx.db, ctx.tenantId, {
          publicAudience: true,
          tablePrefix,
          limit: 100,
        });
        finish(200, {
          ok: true,
          articles: articles.filter((a) => a.visibility === "public"),
        });
        return;
      }

      if(route.name === 'guestBootstrap') {
        if(!central || ctx.mutationMode!=='durable') {finish(404,{ok:false,error:'Not found'});return;}
        const body=await readBody() as {email?:string;name?:string};
        const email=String(body?.email??'').trim().toLowerCase();
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {finish(400,{ok:false,error:'Valid email required'});return;}
        const session=await guestSessions.create(ctx.tenantId,email,String(body.name??'').slice(0,200));
        finish(201,{ok:true,guestSessionToken:session.token,guestSessionExpiresAt:session.expiresAt});return;
      }
      // Public contact gate — name + email (+ optional phone + marketing consent)
      if (route.name === "createLead") {
        const body = await readBody();
        const name = String((body as { name?: string })?.name ?? "").trim();
        const email = String((body as { email?: string })?.email ?? "").trim();
        const phoneRaw = String((body as { phone?: string })?.phone ?? "").trim();
        const marketingOptIn = Boolean((body as { marketingOptIn?: boolean })?.marketingOptIn);
        const source =
          String((body as { source?: string })?.source ?? "public_launcher").trim() ||
          "public_launcher";
        const consentText =
          String((body as { consentText?: string })?.consentText ?? "").trim() ||
          ctx.brand.marketingConsentLabel ||
          DEFAULT_MARKETING_CONSENT_LABEL;

        if (!name || name.length < 1) {
          finish(400, { ok: false, error: "name is required" });
          return;
        }
        if (!email) {
          finish(400, { ok: false, error: "email is required" });
          return;
        }

        const ua = header(r, "user-agent")?.slice(0, 512);
        const fwd = header(r, "x-forwarded-for")?.split(",")[0]?.trim();
        const ipHash = fwd
          ? createHash("sha256").update(fwd).digest("hex").slice(0, 32)
          : undefined;

        try {
          const lead = await leads.upsertLead({
            tenantId: ctx.tenantId as never,
            name,
            email: ctx.mutationMode==='durable' ? user!.email! : email,
            marketingOptIn,
            source,
            consentText,
            ...(phoneRaw ? { phone: phoneRaw } : {}),
            ...(ipHash ? { ipHash } : {}),
            ...(ua ? { userAgent: ua } : {}),
          });
          if (ctx.effects) await ctx.effects.enqueue({type:'support.lead',payload:{lead}});
          else if (ctx.onLeadCaptured) {
            void Promise.resolve(ctx.onLeadCaptured(lead)).catch(() => {});
          }
          const session = central && ctx.mutationMode!=='durable' ? await guestSessions.create(ctx.tenantId,email,name) : null;
          finish(201, { ok: true, leadId: lead.id, ...(central ? {} : {lead}),
            ...(session ? {guestSessionToken:session.token,guestSessionExpiresAt:session.expiresAt} : {}) });
          return;
        } catch (err) {
          finish(400, {
            ok: false,
            error: err instanceof Error ? err.message : "Invalid lead",
          });
          return;
        }
      }

      // Feature coach — optional auth; works without llm (fallback mode)
      if (route.name === "coach") {
        const body = await readBody();
        const kind = String((body as { kind?: string })?.kind ?? "feature_request");
        if (kind !== "feature_request" && kind !== "feature") {
          finish(400, { ok: false, error: "Only feature coaching is supported" });
          return;
        }
        const rawMessages = Array.isArray((body as { messages?: unknown })?.messages)
          ? ((body as { messages: Array<{ role?: string; body?: string }> }).messages)
          : [];
        const messages = rawMessages
          .map((m) => ({
            role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
            body: String(m.body ?? ""),
          }))
          .filter((m) => m.body.trim());

        const coachInput: Parameters<typeof coachFeatureRequest>[0] = {
          messages,
          brand: ctx.brand,
        };
        if (ctx.llm) coachInput.llm = ctx.llm;
        if (user?.contextSummary) coachInput.userContextSummary = user.contextSummary;

        const result = await coachFeatureRequest(coachInput);
        finish(200, {
          ok: result.ok,
          reply: result.reply,
          readyToSubmit: result.readyToSubmit,
          draft: result.draft,
          mode: result.mode,
          ...(result.error ? { error: result.error } : {}),
        });
        return;
      }

      // Guest ticket create: allow unauthenticated POST /tickets with guestEmail
      if (route.name === "createTicket" && !user) {
        const body = await readBody();
        const input = body as Partial<CreateTicketInput> & { kind?: string; topic?: string };
        const ticketBody = String(input.body ?? "").trim();
        const guestEmail = String(input.guestEmail ?? "").trim();
        if (!ticketBody) {
          finish(400, { ok: false, error: "body is required" });
          return;
        }
        if (!guestEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) {
          finish(401, {
            ok: false,
            error: "Sign in or provide guestEmail to create a ticket",
          });
          return;
        }
        const kindParsed = TicketKindSchema.safeParse(input.kind ?? "support");
        const session = central ? await guestSessions.create(ctx.tenantId,guestEmail) : null;
        const created = await tickets.createTicket({
          tenantId: ctx.tenantId as CreateTicketInput["tenantId"],
          body: ticketBody,
          kind: kindParsed.success ? kindParsed.data : "support",
          topic: input.topic ?? "other",
          subject: input.subject,
          userId: session?.ownerId ?? `guest:${guestEmail}`,
          guestEmail,
          severity: input.severity,
          priority: input.priority,
          contextJson: input.contextJson,
          status: "pending_ops",
        });

        if (created.ticket.kind === "bug" || created.ticket.kind === "feature") {
          await proposals.createProposal({
            tenantId: ctx.tenantId as never,
            ticketId: created.ticket.id,
            proposalType: created.ticket.kind === "bug" ? "bug_fix" : "feature",
            summary: created.ticket.subject || `${created.ticket.kind} ticket`,
            bodyJson: JSON.stringify({
              draft_reply:
                "Thanks — we've logged this and will follow up in this thread.",
              github_title: created.ticket.subject,
              github_body: ticketBody,
              kind: created.ticket.kind,
              severity: created.ticket.severity,
              priority: created.ticket.priority,
            }),
            confidence: 0.5,
          });
        }

        finish(201, { ok: true, ...created, ...(session ? {guestSessionToken:session.token,guestSessionExpiresAt:session.expiresAt} : {}) });
        return;
      }

      // Public chat after contact gate: require leadId when no session user
      if (route.name === "chat" && !user && central) {
        finish(401,{ok:false,error:'Guest session proof required',code:'guest_session_required'}); return;
      }
      if (route.name === "chat" && !user) {
        const body = await readBody();
        const message = String((body as { message?: string })?.message ?? "").trim();
        const leadId = String((body as { leadId?: string })?.leadId ?? "").trim();
        if (!message) {
          finish(400, { ok: false, error: "message is required" });
          return;
        }
        if (!leadId) {
          finish(401, {
            ok: false,
            error: "Sign in or complete the contact form (leadId required)",
          });
          return;
        }
        const lead = await leads.getById(ctx.tenantId, leadId);
        if (!lead) {
          finish(401, { ok: false, error: "Invalid or expired contact session" });
          return;
        }
        const guestUser: SupportUser = {
          id: `lead:${lead.id}`,
          email: lead.email,
          name: lead.name,
          role: "user",
          contextSummary: `Public visitor (lead). Name: ${lead.name}. Email: ${lead.email}. No account context — answer from public product FAQ only. Do not invent account/plan/billing details.`,
        };
        const triageDeps: TriageDeps = {
          db: ctx.db,
          brand: ctx.brand,
          tablePrefix,
          topics,
          publicAudience: true,
        };
        if (ctx.llm) triageDeps.llm = ctx.llm;
        if (ctx.docsRoot) triageDeps.docsRoot = ctx.docsRoot;
        if (ctx.opsNotifier) triageDeps.opsNotifier = ctx.opsNotifier;
        if (ctx.adminBaseUrl) triageDeps.adminBaseUrl = ctx.adminBaseUrl;

        const result = await triageMessage(triageDeps, {
          tenantId: ctx.tenantId,
          user: guestUser,
          message,
          kind: "support",
          guestEmail: lead.email,
          leadContext: {
            leadId: lead.id,
            name: lead.name,
            phone: lead.phone ?? null,
            marketingOptIn: lead.marketingEmailOptIn,
          },
        });
        finish(200, { ok: true, ...result });
        return;
      }

      if (!user) {
        finish(401, { ok: false, error: "Unauthorized" });
        return;
      }

      if (route.name === "chat") {
        const body = await readBody();
        const message = String((body as { message?: string })?.message ?? "").trim();
        if (!message) {
          finish(400, { ok: false, error: "message is required" });
          return;
        }
        const kindRaw = (body as { kind?: string })?.kind;
        const kindParsed = kindRaw ? TicketKindSchema.safeParse(kindRaw) : null;
        const topic = String((body as { topic?: string })?.topic ?? "").trim() || undefined;

        const triageDeps: TriageDeps = {
          db: ctx.db,
          brand: ctx.brand,
          tablePrefix,
          topics,
          ...(central ? {publicAudience:true} : {}),
        };
        if (ctx.llm) triageDeps.llm = ctx.llm;
        if (ctx.docsRoot) triageDeps.docsRoot = ctx.docsRoot;
        if (ctx.opsNotifier) triageDeps.opsNotifier = ctx.opsNotifier;
        if (ctx.adminBaseUrl) triageDeps.adminBaseUrl = ctx.adminBaseUrl;
        if (ctx.sensitiveTopics) triageDeps.sensitiveTopics = ctx.sensitiveTopics;
        if (ctx.autoReplyMinConfidence !== undefined) {
          triageDeps.autoReplyMinConfidence = ctx.autoReplyMinConfidence;
        }

        const triageInput = {
          tenantId:ctx.tenantId,user,message,
          ...(user.email?{guestEmail:user.email}:{}),
          ...(kindParsed?.success?{kind:kindParsed.data}:{}),...(topic?{topic}:{}),
        };
        const result=ctx.effects && ctx.preparedTriage
          ? await persistPreparedTriage({...triageDeps,effects:ctx.effects},triageInput,ctx.preparedTriage)
          : await triageMessage(triageDeps,triageInput);

        finish(200, { ok: true, ...result });
        return;
      }

      if (route.name === "listTickets") {
        const list = await tickets.listTickets(ctx.tenantId, { limit: 100, ...(!central && requireAdmin(user) ? {} : { userId: user.id }) });
        const scoped =
          !central && (user.role === "admin" || user.role === "ops")
            ? list
            : list.filter((t) => t.userId === user.id);
        finish(200, { ok: true, tickets: scoped });
        return;
      }

      if (route.name === "createTicket") {
        const body = await readBody();
        const input = body as Partial<CreateTicketInput> & { kind?: string; topic?: string };
        const ticketBody = String(input.body ?? "").trim();
        if (!ticketBody) {
          finish(400, { ok: false, error: "body is required" });
          return;
        }
        const kindParsed = TicketKindSchema.safeParse(input.kind ?? "support");
        const created = await tickets.createTicket({
          tenantId: ctx.tenantId as CreateTicketInput["tenantId"],
          body: ticketBody,
          kind: kindParsed.success ? kindParsed.data : "support",
          topic: input.topic ?? "other",
          subject: input.subject,
          userId: user.id,
          orgId: central ? user.orgId : user.orgId ?? input.orgId,
          guestEmail: central ? user.email : input.guestEmail,
          severity: input.severity,
          priority: input.priority,
          contextJson: input.contextJson,
          status: "pending_ops",
        });

        if (created.ticket.kind === "bug" || created.ticket.kind === "feature") {
          await proposals.createProposal({
            tenantId: ctx.tenantId as never,
            ticketId: created.ticket.id,
            proposalType: created.ticket.kind === "bug" ? "bug_fix" : "feature",
            summary: created.ticket.subject || `${created.ticket.kind} ticket`,
            bodyJson: JSON.stringify({
              draft_reply:
                "Thanks — we've logged this and will follow up in this thread.",
              github_title: created.ticket.subject,
              github_body: ticketBody,
              kind: created.ticket.kind,
              severity: created.ticket.severity,
              priority: created.ticket.priority,
            }),
            confidence: 0.5,
          });
        }

        if(ctx.effects) await ctx.effects.enqueue({type:'support.ops',ticketId:created.ticket.id,payload:{kind:'ticket_created',title:`Ticket #${created.ticket.publicNumber}`,body:ticketBody}});
        finish(201, { ok: true, ...created });
        return;
      }

      if (route.name === "replyTicket") {
        const ticket = await tickets.getTicket(ctx.tenantId, route.params.id!);
        if (!ticket) {
          finish(404, { ok: false, error: "Ticket not found" });
          return;
        }
        if ((central || (user.role !== "admin" && user.role !== "ops")) && ticket.userId !== user.id) {
          finish(403, { ok: false, error: "Forbidden" });
          return;
        }
        if (ticket.status === "closed") {
          finish(400, { ok: false, error: "Ticket is closed" });
          return;
        }
        const body = await readBody();
        const replyBody = String((body as { body?: string })?.body ?? "").trim();
        if (!replyBody) {
          finish(400, { ok: false, error: "body is required" });
          return;
        }
        if(ctx.effects && ctx.preparedTriage) {
          const result=await persistPreparedTriage({...ctx,publicAudience:central},{tenantId:ctx.tenantId,user,message:replyBody,existingTicketId:ticket.id},ctx.preparedTriage);
          finish(200,{ok:true,...result});return;
        }
        // Run AI triage on follow-up user messages so the user always gets an
        // assistant reply in the thread (auto-reply from KB/context or escalation acknowledgment)
        const triageDeps: TriageDeps = {
          db: ctx.db,
          brand: ctx.brand,
          tablePrefix,
          topics,
          ...(central ? {publicAudience:true} : {}),
        };
        if (ctx.llm) triageDeps.llm = ctx.llm;
        if (ctx.docsRoot) triageDeps.docsRoot = ctx.docsRoot;
        if (ctx.opsNotifier) triageDeps.opsNotifier = ctx.opsNotifier;
        if (ctx.adminBaseUrl) triageDeps.adminBaseUrl = ctx.adminBaseUrl;
        if (ctx.sensitiveTopics) triageDeps.sensitiveTopics = ctx.sensitiveTopics;
        if (ctx.autoReplyMinConfidence !== undefined) {
          triageDeps.autoReplyMinConfidence = ctx.autoReplyMinConfidence;
        }

        const result = await triageMessage(triageDeps, {
          tenantId: ctx.tenantId,
          user,
          message: replyBody,
          existingTicketId: ticket.id,
        });

        finish(200, {
          ok: true,
          ticket: result.ticket,
          message: result.message,
          agentMessage: result.agentMessage,
          reply: result.reply,
          autoReplied: result.autoReplied,
        });
        return;
      }

      if (route.name === "getTicket") {
        const ticket = await tickets.getTicket(ctx.tenantId, route.params.id!);
        if (!ticket) {
          finish(404, { ok: false, error: "Ticket not found" });
          return;
        }
        if ((central || (user.role !== "admin" && user.role !== "ops")) && ticket.userId !== user.id) {
          finish(403, { ok: false, error: "Forbidden" });
          return;
        }
        const messages = await tickets.listMessages(ctx.tenantId, ticket.id);
        finish(200, { ok: true, ticket, messages });
        return;
      }

      if (route.name.startsWith("admin")) {
        if (!ctx.authorizeSupport && !requireAdmin(user)) {
          finish(403, { ok: false, error: "Forbidden" });
          return;
        }

        if (route.name === "adminListTickets") {
          const query = parseQueryString(String(r.url ?? ""));
          const statusFilter = query.status?.trim() || undefined;
          const kindFilter = query.kind?.trim() || undefined;
          const topicFilter = query.topic?.trim() || undefined;
          const allTickets = await tickets.listTickets(ctx.tenantId, { limit: 200 });
          const pendingProposals = await proposals.listProposals(ctx.tenantId, {
            status: "pending_review",
            limit: 500,
          });
          const ticketIdsWithPending = new Set(pendingProposals.map((p) => p.ticketId));

          const counts = {
            open: 0,
            ai_working: 0,
            pending_ops: 0,
            waiting_user: 0,
            pending_user: 0,
            escalated: 0,
            resolved: 0,
            closed: 0,
            pending_review_proposals: pendingProposals.length,
            support: 0,
            bug: 0,
            feature: 0,
          };
          for (const t of allTickets) {
            const key = String(t.status);
            if (Object.prototype.hasOwnProperty.call(counts, key)) {
              const cur = (counts as Record<string, number>)[key] ?? 0;
              (counts as Record<string, number>)[key] = cur + 1;
            }
            if (t.kind === "support") counts.support += 1;
            if (t.kind === "bug") counts.bug += 1;
            if (t.kind === "feature") counts.feature += 1;
          }

          let scoped = allTickets;
          if (statusFilter === "pending_review" || statusFilter === "attention") {
            scoped = allTickets.filter(
              (t) =>
                t.status === "pending_ops" ||
                t.status === "escalated" ||
                ticketIdsWithPending.has(t.id),
            );
          } else if (statusFilter) {
            scoped = allTickets.filter((t) => t.status === statusFilter);
          }
          if (kindFilter) scoped = scoped.filter((t) => t.kind === kindFilter);
          if (topicFilter) scoped = scoped.filter((t) => t.topic === topicFilter);

          // Urgency: escalated + critical bugs first
          scoped = [...scoped].sort((a, b) => {
            const score = (t: typeof a) => {
              let s = 0;
              if (t.status === "escalated") s += 100;
              if (t.kind === "bug" && t.severity === "critical") s += 80;
              if (t.kind === "bug" && t.severity === "high") s += 50;
              if (ticketIdsWithPending.has(t.id)) s += 20;
              if (t.status === "pending_ops") s += 10;
              return s;
            };
            return score(b) - score(a);
          });

          const enriched = scoped.map((t) => ({
            ...t,
            hasPendingProposal: ticketIdsWithPending.has(t.id),
          }));

          finish(200, { ok: true, tickets: enriched, counts });
          return;
        }

        if (route.name === "adminGetTicket") {
          const ticket = await tickets.getTicketByIdOrNumber(
            ctx.tenantId,
            route.params.idOrNumber!,
          );
          if (!ticket) {
            finish(404, { ok: false, error: "Ticket not found" });
            return;
          }
          const messages = await tickets.listMessages(ctx.tenantId, ticket.id);
          const ticketProposals = await proposals.listProposalsForTicket(
            ctx.tenantId,
            ticket.id,
          );
          finish(200, { ok: true, ticket, messages, proposals: ticketProposals, ...(ctx.listDeliveries ? {deliveries:await ctx.listDeliveries(ctx.tenantId,ticket.id,user)} : {}) });
          return;
        }

        if (route.name === "adminReplyTicket") {
          const ticket = await tickets.getTicketByIdOrNumber(
            ctx.tenantId,
            route.params.idOrNumber!,
          );
          if (!ticket) {
            finish(404, { ok: false, error: "Ticket not found" });
            return;
          }
          const body = await readBody();
          const replyBody = String((body as { body?: string })?.body ?? "").trim();
          if (!replyBody) {
            finish(400, { ok: false, error: "body is required" });
            return;
          }

          const message = await tickets.addMessage(ctx.tenantId, ticket.id, replyBody, {
            authorType: "staff",
            authorId: user.id,
          });

          let updated = ticket;
          if (
            ticket.status === "pending_ops" ||
            ticket.status === "open" ||
            ticket.status === "escalated" ||
            ticket.status === "ai_working"
          ) {
            const next = await tickets.setStatus(ctx.tenantId, ticket.id, "waiting_user");
            if (next) updated = next;
          }

          if(ctx.effects) await ctx.effects.enqueue({type:'support.email',ticketId:ticket.id,payload:{body:replyBody,subject:`${ctx.brand.name} support — ticket #${ticket.publicNumber}`}});
          else notifyEmail(ctx.email, updated, replyBody, ctx.brand.name);
          finish(200, { ok: true, ticket: updated, message });
          return;
        }

        if (route.name === "adminSetTicketStatus") {
          const ticket = await tickets.getTicketByIdOrNumber(
            ctx.tenantId,
            route.params.idOrNumber!,
          );
          if (!ticket) {
            finish(404, { ok: false, error: "Ticket not found" });
            return;
          }
          const body = await readBody();
          const parsed = TicketStatusSchema.safeParse((body as { status?: string })?.status);
          if (!parsed.success) {
            finish(400, { ok: false, error: "Invalid status" });
            return;
          }
          const updated = await tickets.setStatus(ctx.tenantId, ticket.id, parsed.data);
          finish(200, { ok: true, ticket: updated });
          return;
        }

        if (route.name === "adminPromoteKb") {
          const ticket = await tickets.getTicketByIdOrNumber(
            ctx.tenantId,
            route.params.idOrNumber!,
          );
          if (!ticket) {
            finish(404, { ok: false, error: "Ticket not found" });
            return;
          }
          const body = await readBody();
          const activate = Boolean((body as { activate?: boolean })?.activate);
          if (central && activate) { finish(400,{ok:false,error:"Create a draft first, then publish its exact reviewed revision"}); return; }
          const title = String((body as { title?: string })?.title ?? "").trim();
          let articleBody = String((body as { body?: string })?.body ?? "").trim();
          const curate = (body as { curate?: boolean })?.curate !== false;

          // Default: AI-curate staff/assistant answer into a clean KB draft
          if (!articleBody && ctx.llm && curate) {
            const messages = await tickets.listMessages(ctx.tenantId, ticket.id);
            const answer = [...messages]
              .reverse()
              .find(
                (m) =>
                  m.authorType === "assistant" ||
                  m.authorType === "staff" ||
                  m.authorType === "agent" ||
                  m.authorType === "ops",
              );
            const userQ = messages.find((m) => m.authorType === "user");
            if (answer?.body) {
              const curated = await curateAnswerToKbDraft({
                db: ctx.db,
                tenantId: ctx.tenantId,
                llm: ctx.llm,
                brand: ctx.brand,
                rawAnswer: answer.body,
                sourceKey: `evolutionary:ticket:${ticket.id}`,
                preserveActive:central,
                tablePrefix,
                ...(title ? { title } : {}),
                ...(userQ?.body ? { userQuestion: userQ.body } : {}),
              });
              if (activate) {
                const promoted = await promoteKbArticle(
                  ctx.db,
                  ctx.tenantId,
                  curated.id,
                  tablePrefix,
                  {revisionId:curated.ingestedRevisionId,expectedDraftRevisionId:curated.revisionId,expectedPublishedRevisionId:curated.publishedRevisionId??null},
                );
                finish(200, { ok: true, article: promoted, curated: true });
                return;
              }
              finish(200, { ok: true, article: curated, curated: true });
              return;
            }
          }

          const promoteInput: {
            tenantId: string;
            ticketId: string;
            tablePrefix: string;
            activate: boolean;
            preserveActive: boolean;
            title?: string;
            body?: string;
          } = {
            tenantId: ctx.tenantId,
            ticketId: ticket.id,
            tablePrefix,
            activate,
            preserveActive:central,
          };
          if (title) promoteInput.title = title;
          if (articleBody) promoteInput.body = articleBody;
          const article = await promoteTicketAnswerToKb(ctx.db, promoteInput);
          finish(200, { ok: true, article, curated: false });
          return;
        }

        if (route.name === "adminListProposals") {
          const query = parseQueryString(String(r.url ?? ""));
          const status = (query.status?.trim() || "pending_review") as
            | "pending_review"
            | "approved"
            | "rejected"
            | "needs_info"
            | "executed";
          const list = await proposals.listProposals(ctx.tenantId, { status, limit: 100 });
          finish(200, { ok: true, proposals: list });
          return;
        }

        if (route.name === "adminListKb") {
          const query = parseQueryString(String(r.url ?? ""));
          const status = query.status as "draft" | "active" | "deprecated" | undefined;
          const sourceKind = query.sourceKind?.trim() || undefined;
          const listOpts: {
            tablePrefix: string;
            limit: number;
            status?: "draft" | "active" | "deprecated";
            sourceKind?: string;
          } = { tablePrefix, limit: 200 };
          if (status) listOpts.status = status;
          if (sourceKind) listOpts.sourceKind = sourceKind;
          const articles = await listKbArticles(ctx.db, ctx.tenantId, listOpts);
          finish(200, { ok: true, articles });
          return;
        }

        if (route.name === "adminKbRevisions") {
          finish(200,{ok:true,revisions:await listKbRevisions(ctx.db,ctx.tenantId,route.params.id!,tablePrefix)});return;
        }
        if (route.name === "adminKbGet") {
          const article = await getKbArticle(ctx.db, ctx.tenantId, route.params.id!, tablePrefix);
          if (!article) {
            finish(404, { ok: false, error: "Article not found" });
            return;
          }
          finish(200, { ok: true, article });
          return;
        }

        if (route.name === "adminKbPromote") {
          const body = await readBody();
          const visibility = (body as { visibility?: "public" | "agent" | "internal" })
            ?.visibility;
          const review=body as {revisionId?:string;expectedPublishedRevisionId?:string|null;expectedDraftRevisionId?:string|null};
          if(central && (!review?.revisionId || !Object.prototype.hasOwnProperty.call(review,'expectedPublishedRevisionId'))) {
            finish(400,{ok:false,error:"Reviewed revisionId and expectedPublishedRevisionId are required"}); return;
          }
          const article = await promoteKbArticle(ctx.db,ctx.tenantId,route.params.id!,tablePrefix,{
            ...(visibility?{visibility}:{}),...(review?.revisionId?{revisionId:review.revisionId}:{}),
            ...(review && 'expectedPublishedRevisionId' in review?{expectedPublishedRevisionId:review.expectedPublishedRevisionId}:{}),
            ...(review && 'expectedDraftRevisionId' in review?{expectedDraftRevisionId:review.expectedDraftRevisionId}:{}),
          });
          finish(200, { ok: true, article });
          return;
        }

        if (route.name === "adminKbDeprecate") {
          const review=await readBody() as {expectedPublishedRevisionId?:string|null;publicationVersion?:number}|undefined;
          if(central && (!review || !Object.prototype.hasOwnProperty.call(review,'expectedPublishedRevisionId') || typeof review.publicationVersion!=='number')) {
            finish(400,{ok:false,error:"Publication pointer and version are required"}); return;
          }
          const article = await deprecateKbArticle(
            ctx.db,
            ctx.tenantId,
            route.params.id!,
            tablePrefix,
            review,
          );
          finish(200, { ok: true, article });
          return;
        }

        if (route.name === "adminKbPatch") {
          const body = await readBody();
          const patch: {
            title?: string;
            body?: string;
            visibility?: "public" | "agent" | "internal";
          } = {};
          const title = (body as { title?: string })?.title;
          const articleBody = (body as { body?: string })?.body;
          const visibility = (body as { visibility?: "public" | "agent" | "internal" })
            ?.visibility;
          if (title !== undefined) patch.title = title;
          if (articleBody !== undefined) patch.body = articleBody;
          if (visibility !== undefined) patch.visibility = visibility;
          const article = await updateKbArticle(
            ctx.db,
            ctx.tenantId,
            route.params.id!,
            patch as { title?: string; body?: string; visibility?: "public" | "agent" | "internal" },
            tablePrefix,
            {preserveActive:central && !await ctx.authorizeSupport?.({actor:user,businessId:ctx.tenantId,action:'knowledge.publish',resource:{type:'kb_articles',id:route.params.id!}}).catch(()=>false)},
          );
          finish(200, { ok: true, article });
          return;
        }

        if (route.name === "adminListGaps") {
          const list = await gaps.listKnowledgeGaps(ctx.tenantId, {
            status: "open",
            limit: 100,
          });
          finish(200, { ok: true, gaps: list });
          return;
        }

        if (route.name === "adminListLeads") {
          const q = parseQueryString(String(r.url ?? ""));
          const marketingOnly =
            q.marketing === "1" || q.marketing === "true" || q.optIn === "1";
          const list = await leads.list(ctx.tenantId, {
            marketingOnly,
            limit: 200,
          });
          finish(200, { ok: true, leads: list });
          return;
        }

        if (route.name === "adminGapPatch") {
          const body = await readBody();
          const status = String((body as { status?: string })?.status ?? "").trim();
          if (!["resolved", "dismissed", "open"].includes(status)) {
            finish(400, { ok: false, error: "Invalid status" });
            return;
          }
          const gap = await gaps.patchKnowledgeGap(
            ctx.tenantId,
            route.params.id!,
            status as "resolved" | "dismissed" | "open",
          );
          finish(200, { ok: true, gap });
          return;
        }

        if (route.name === "adminGapResearch") {
          if (!ctx.llm) {
            finish(400, { ok: false, error: "LLM not configured for gap research" });
            return;
          }
          if (!ctx.codebase) {
            finish(400, {
              ok: false,
              error: "Codebase adapter not configured (host must pass codebase)",
            });
            return;
          }
          const result = await researchGapToKbDraft({
            db: ctx.db,
            tenantId: ctx.tenantId,
            gapId: route.params.id!,
            preserveActive:central,
            llm: ctx.llm,
            codebase: ctx.codebase,
            brand: ctx.brand,
            tablePrefix,
            ...(ctx.docsRoot ? { docsRoot: ctx.docsRoot } : {}),
          });
          if (!result.ok) {
            finish(422, {
              ok: false,
              insufficient: true,
              error: result.reason,
              citedPaths: result.citedPaths,
            });
            return;
          }
          if (ctx.opsNotifier) {
            ctx.opsNotifier
              .sendToOps({
                kind: "kb_drafts_ready",
                title: `KB draft from codebase research`,
                body: result.article.title,
              })
              .catch(() => {});
          }
          finish(200, {
            ok: true,
            article: result.article,
            confidence: result.confidence,
            citedPaths: result.citedPaths,
          });
          return;
        }

        if (route.name === "adminProposalAction") {
          const body = await readBody();
          const action = normalizeAction(String((body as { action?: string })?.action ?? "").trim()) ?? "";
          const allowed = [
            "approve",
            "reject",
            "send_reply",
            "take_over",
            "need_info",
            "edit_send",
            "claim",
            "steal",
            "release",
          ];
          if (!allowed.includes(action)) {
            finish(400, { ok: false, error: "Invalid action" });
            return;
          }

          const telegramEditor =
            ctx.telegram != null
              ? await (async () => {
                  const cfg = await ctx.telegram!.resolveConfig();
                  if (!cfg) return undefined;
                  return ctx.telegram!.createClient(cfg);
                })()
              : undefined;

          const result = await executeProposalAction(
            {
              tenantId: ctx.tenantId,
              proposals,
              tickets,
              brand: ctx.brand,
              ...(ctx.effects ? {effects:ctx.effects} : {}),
              ...(ctx.github ? { github: ctx.github } : {}),
              ...(ctx.email ? { email: ctx.email } : {}),
              ...(telegramEditor ? { telegram: telegramEditor } : {}),
              ...(ctx.adminBaseUrl ? { adminBaseUrl: ctx.adminBaseUrl } : {}),
            },
            route.params.id!,
            action,
            user.id,
            {
              draftReply: String((body as { draft_reply?: string })?.draft_reply ?? ""),
              needInfoMessage: String((body as { message?: string })?.message ?? ""),
            },
          );

          if (!result.ok) {
            finish(result.status, {
              ok: false,
              error: result.error,
              handledBy: result.handledBy,
              proposal: result.proposal,
            });
            return;
          }

          finish(200, {
            ok: true,
            proposal: result.proposal,
            ticket: result.ticket,
            message: result.message,
            result: result.result,
            tookOver: result.result === "escalated",
          });
          return;
        }
      }
    } catch (err) {
      if(err instanceof PublishedKnowledgeConflict) throw err;
      const message = err instanceof Error ? err.message : "Internal error";
      finish(500, { ok: false, error: message });
    }
  };

  const handler: SupportRouter['handler'] = async (req,res,next) => {
    try { return await dispatch(req,res,next); }
    catch(error) {
      if(!(error instanceof PublishedKnowledgeConflict)) throw error;
      const response=res as ServerResponse & {status?:(status:number)=>{json:(body:unknown)=>void}};
      const payload={ok:false,error:error.message};
      if(response.status) response.status(409).json(payload);
      else sendJson(response,409,payload);
    }
  };
  return {
    handler,
    meta: {
      kitVersion: KIT_VERSION,
      tenantId: String(baseCtx.tenantId),
      shared: "@quill/support-shared",
    },
  };
}

/** Alias used by createSupportRouter in index.ts */
export function createRouter(options: CreateSupportRouterOptions): SupportRouter {
  const ctx: HttpRouterContext = {
    tenantId: String(options.tenantId),
    db: options.db,
    resolveUser: options.resolveUser,
    brand: options.brand,
  };
  if (options.listDeliveries) ctx.listDeliveries=options.listDeliveries;
  if (options.mutationMode) ctx.mutationMode=options.mutationMode;
  if (options.durableMutations) ctx.durableMutations=options.durableMutations;
  if (options.authorizationMode) ctx.authorizationMode = options.authorizationMode;
  if (options.authorizeSupport) ctx.authorizeSupport = options.authorizeSupport;
  if (options.llm) ctx.llm = options.llm;
  if (options.tablePrefix) ctx.tablePrefix = options.tablePrefix;
  if (options.docsRoot) ctx.docsRoot = options.docsRoot;
  if (options.opsNotifier) ctx.opsNotifier = options.opsNotifier;
  if (options.adminBaseUrl) ctx.adminBaseUrl = options.adminBaseUrl;
  if (options.topics) ctx.topics = options.topics;
  if (options.sensitiveTopics) ctx.sensitiveTopics = options.sensitiveTopics;
  if (options.autoReplyMinConfidence !== undefined) {
    ctx.autoReplyMinConfidence = options.autoReplyMinConfidence;
  }
  if (options.github) ctx.github = options.github;
  if (options.email) ctx.email = options.email;
  if (options.kbIngest) ctx.kbIngest = options.kbIngest;
  if (options.telegram) ctx.telegram = options.telegram;
  if (options.codebase) ctx.codebase = options.codebase;
  if (options.onLeadCaptured) ctx.onLeadCaptured = options.onLeadCaptured;
  if (options.trackBackground) ctx.trackBackground = options.trackBackground;
  if (options.resolveTenant) ctx.resolveTenant = options.resolveTenant;
  return createHttpRouter(ctx);
}

export { createMockResponse };
