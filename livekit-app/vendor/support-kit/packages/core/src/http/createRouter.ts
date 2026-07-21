import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DEFAULT_TOPICS,
  KIT_VERSION,
  TicketKindSchema,
  TicketStatusSchema,
} from "@rhule/support-shared";
import type {
  BrandConfig,
  CreateTicketInput,
  SupportUser,
} from "@rhule/support-shared";
import type {
  CodebaseAdapter,
  CreateSupportRouterOptions,
  DbAdapter,
  EmailNotifier,
  GitHubAdapter,
  KbIngestConfig,
  LlmAdapter,
  OpsNotifier,
  ResolveUser,
  SupportRouter,
} from "../adapters/types.js";
import { ensureSchema, DEFAULT_TABLE_PREFIX } from "../db/migrate.js";
import { TicketService } from "../tickets/service.js";
import { ProposalService } from "../proposals/service.js";
import { KnowledgeGapService } from "../gaps/service.js";
import { triageMessage, type TriageDeps } from "../agent/triage.js";
import {
  deprecateKbArticle,
  getKbArticle,
  ingestDocsSources,
  ingestFromChangelog,
  listKbArticles,
  promoteKbArticle,
  updateKbArticle,
} from "../kb/codegen.js";
import { promoteTicketAnswerToKb } from "../kb/evolutionary.js";
import { executeProposalAction } from "../proposals/executor.js";
import {
  handleTelegramUpdate,
  verifyTelegramWebhookSecret,
} from "../telegram/webhook.js";
import { curateAnswerToKbDraft, researchGapToKbDraft } from "../kb/gapResearch.js";
import { coachFeatureRequest } from "../agent/featureCoach.js";

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

function header(
  req: MockRequest & IncomingMessage,
  name: string,
): string | undefined {
  const headers = (req.headers ?? {}) as Record<string, string | string[] | undefined>;
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

function matchRoute(
  method: string,
  path: string,
): { name: string; params: Record<string, string> } | null {
  if (method === "GET" && path === "/health") return { name: "health", params: {} };
  if (method === "GET" && path === "/config") return { name: "config", params: {} };
  if (method === "POST" && path === "/chat") return { name: "chat", params: {} };
  if (method === "POST" && path === "/coach") return { name: "coach", params: {} };
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
  if (method === "POST" && path === "/admin/kb/ingest") {
    return { name: "adminKbIngest", params: {} };
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
export function createHttpRouter(ctx: HttpRouterContext): SupportRouter {
  const tablePrefix = ctx.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const topics = ctx.topics ?? [...DEFAULT_TOPICS];
  const ready = ensureSchema(ctx.db, tablePrefix);

  const handler = async (req: unknown, res: unknown, _next?: unknown) => {
    await ready;

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
      void handleTelegramUpdate(webhookDeps, body as never).catch((err) => {
        console.error("[support-kit] telegram webhook error:", err);
      });
      return;
    }

    // CI ingest may use deploy token instead of session user
    if (route.name === "adminKbIngest") {
      const secret = ctx.kbIngest?.webhookSecret;
      const token = header(r, "x-support-ingest-token");
      const user = await ctx.resolveUser(req);
      const authed =
        (secret && token && token === secret) || (user && requireAdmin(user));
      if (!authed) {
        finish(401, { ok: false, error: "Unauthorized" });
        return;
      }

      const body = (r.body !== undefined
        ? r.body
        : await readJsonBody(r as IncomingMessage)) as {
        gitSha?: string;
        changelog?: string;
        sources?: Array<{ path: string; title?: string; body: string }>;
      };

      const articles = [];
      if (body?.changelog) {
        const changelogOpts: { gitSha?: string; tablePrefix: string } = { tablePrefix };
        if (body.gitSha) changelogOpts.gitSha = body.gitSha;
        articles.push(
          ...(await ingestFromChangelog(ctx.db, ctx.tenantId, body.changelog, changelogOpts)),
        );
      }
      if (body?.sources?.length) {
        const docsOpts: { gitSha?: string; tablePrefix: string } = { tablePrefix };
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

    const user = await ctx.resolveUser(req);
    const tickets = new TicketService(ctx.db, tablePrefix);
    const proposals = new ProposalService(ctx.db, tablePrefix);
    const gaps = new KnowledgeGapService(ctx.db, tablePrefix);

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
        });
        return;
      }

      if (route.name === "publicHelp") {
        const articles = await listKbArticles(ctx.db, ctx.tenantId, {
          status: "active",
          tablePrefix,
          limit: 100,
        });
        finish(200, {
          ok: true,
          articles: articles.filter((a) => a.visibility === "public"),
        });
        return;
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
        const created = await tickets.createTicket({
          tenantId: ctx.tenantId as CreateTicketInput["tenantId"],
          body: ticketBody,
          kind: kindParsed.success ? kindParsed.data : "support",
          topic: input.topic ?? "other",
          subject: input.subject,
          userId: `guest:${guestEmail}`,
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

        finish(201, { ok: true, ...created });
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
          message,
          ...(kindParsed?.success ? { kind: kindParsed.data } : {}),
          ...(topic ? { topic } : {}),
        });

        finish(200, { ok: true, ...result });
        return;
      }

      if (route.name === "listTickets") {
        const list = await tickets.listTickets(ctx.tenantId, { limit: 100 });
        const scoped =
          user.role === "admin" || user.role === "ops"
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
          orgId: user.orgId ?? input.orgId,
          guestEmail: input.guestEmail,
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

        finish(201, { ok: true, ...created });
        return;
      }

      if (route.name === "replyTicket") {
        const ticket = await tickets.getTicket(ctx.tenantId, route.params.id!);
        if (!ticket) {
          finish(404, { ok: false, error: "Ticket not found" });
          return;
        }
        if (user.role !== "admin" && user.role !== "ops" && ticket.userId !== user.id) {
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
        const message = await tickets.addMessage(ctx.tenantId, ticket.id, replyBody, {
          authorType: "user",
          authorId: user.id,
        });
        let updated = ticket;
        if (
          ticket.status === "waiting_user" ||
          ticket.status === "pending_user" ||
          ticket.status === "resolved"
        ) {
          const next = await tickets.setStatus(ctx.tenantId, ticket.id, "pending_ops");
          if (next) updated = next;
        }

        if (
          (updated.status === "escalated" || updated.status === "pending_ops") &&
          ctx.opsNotifier
        ) {
          ctx.opsNotifier
            .sendToOps({
              kind: "user_reply",
              title: `User reply — ticket #${ticket.publicNumber}`,
              body: replyBody.slice(0, 500),
              ticketPublicNumber: ticket.publicNumber,
            })
            .catch(() => {});
        }

        finish(200, { ok: true, ticket: updated, message });
        return;
      }

      if (route.name === "getTicket") {
        const ticket = await tickets.getTicket(ctx.tenantId, route.params.id!);
        if (!ticket) {
          finish(404, { ok: false, error: "Ticket not found" });
          return;
        }
        if (user.role !== "admin" && user.role !== "ops" && ticket.userId !== user.id) {
          finish(403, { ok: false, error: "Forbidden" });
          return;
        }
        const messages = await tickets.listMessages(ctx.tenantId, ticket.id);
        finish(200, { ok: true, ticket, messages });
        return;
      }

      if (route.name.startsWith("admin")) {
        if (!requireAdmin(user)) {
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
          finish(200, { ok: true, ticket, messages, proposals: ticketProposals });
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

          notifyEmail(ctx.email, updated, replyBody, ctx.brand.name);
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
            title?: string;
            body?: string;
          } = {
            tenantId: ctx.tenantId,
            ticketId: ticket.id,
            tablePrefix,
            activate,
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
          const article = await promoteKbArticle(
            ctx.db,
            ctx.tenantId,
            route.params.id!,
            tablePrefix,
            visibility ? { visibility } : undefined,
          );
          finish(200, { ok: true, article });
          return;
        }

        if (route.name === "adminKbDeprecate") {
          const article = await deprecateKbArticle(
            ctx.db,
            ctx.tenantId,
            route.params.id!,
            tablePrefix,
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
          const action = String((body as { action?: string })?.action ?? "").trim();
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
      const message = err instanceof Error ? err.message : "Internal error";
      finish(500, { ok: false, error: message });
    }
  };

  return {
    handler,
    meta: {
      kitVersion: KIT_VERSION,
      tenantId: String(ctx.tenantId),
      shared: "@rhule/support-shared",
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
  return createHttpRouter(ctx);
}

export { createMockResponse };
