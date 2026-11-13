import type { BusinessEvent, BusinessEventReceipt } from './events.js';
export * from './events.js';
export * from './marketingDelegation.js';
import { createSupportGateway, type SupportGatewayOptions } from './supportGateway.js';
export * from './supportGateway.js';
export type OpsBusinessUnit = "legalai" | "lalia" | "metalarb" | "shared_corporate" | (string & {});

export type StripeBillingEventType =
  | "charge.succeeded"
  | "invoice.paid"
  | "charge.refunded"
  | "charge.dispute.created"
  | "payout.paid";

export type OpsEnvironment = "live" | "test";

export interface BillingEventIngestInput {
  /** Unique Stripe event ID (e.g., evt_1Pxyz...) for idempotent GL posting */
  externalEventId: string;
  /** Connected app / business unit slug */
  businessUnitId?: OpsBusinessUnit;
  /** Stripe event.livemode flag (true = live, false = test/sandbox) */
  livemode?: boolean;
  /** Explicit environment override ('live' | 'test') */
  environment?: OpsEnvironment;
  /** Stripe event type */
  eventType: StripeBillingEventType;
  /** Revenue category for charge/invoice events */
  revenueStream?: "subscription" | "usage_topup" | "annual_deferred";
  /** Gross amount in USD */
  grossAmountUsd: number;
  /** Stripe processing fee in USD (2.9% + $0.30) */
  stripeFeeUsd?: number;
  /** Sales tax / VAT collected via Stripe automatic_tax in USD */
  taxAmountUsd?: number;
  /** Tax jurisdiction code (e.g. "US-NY", "US-TX", "EU-VAT") */
  taxJurisdiction?: string;
  /** Dispute fee in USD (defaults to $15.00 on charge.dispute.created) */
  disputeFeeUsd?: number;
  /** Customer email or org identifier */
  customerEmail?: string;
  customerId?: string;
  description?: string;
  occurredAt?: string;
}

export interface CogsIngestInput {
  /** Unique daily or per-event idempotency key (e.g. "cogs:legalai:2026-11-06:ai") */
  externalEventId: string;
  businessUnitId?: OpsBusinessUnit;
  /** True for live production spend, false for test/sandbox spend */
  livemode?: boolean;
  /** Explicit environment override ('live' | 'test') */
  environment?: OpsEnvironment;
  /** Maps to 5020 (ai_inference), 5030 (media_stt), or 5040 (cloud_hosting) */
  cogsCategory: "ai_inference" | "media_stt" | "cloud_hosting";
  /** Credit account: 1060 Prepaid AI/Cloud Credits, 2100 Accounts Payable, or 1000 Operating Bank */
  creditAccountNumber?: "1060" | "2100" | "1000";
  amountUsd: number;
  provider?: string;
  description?: string;
  occurredAt?: string;
}

export interface ContactSyncInput {
  tenantId?: OpsBusinessUnit;
  externalUserId?: string;
  email: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  phone?: string;
  planTier?: string;
  lifecycleState?:
    | "lead_only"
    | "trial_active"
    | "trial_expiring_3d"
    | "active_paid"
    | "power_user"
    | "churned"
    | "comp";
  marketingOptIn?: boolean;
  productUpdatesOptIn?: boolean;
  source?: string;
  consentText?: string;
  metadata?: Record<string, unknown>;
}

export interface HeartbeatInput {
  tenantId?: OpsBusinessUnit;
  environment?: OpsEnvironment;
  status?: "up" | "degraded" | "down";
  latencyMs?: number;
  activeUsersDau?: number;
  activeUsersMau?: number;
  activeOrgs?: number;
  paidOrgs?: number;
  trialOrgs?: number;
  compOrgs?: number;
  mrrCents?: number;
  openRouterBalanceUsd?: number;
  version?: string;
}

export interface PublicAnnouncement {
  id: string;
  tenantId: string;
  slug: string;
  title: string;
  summary: string | null;
  bodyMarkdown: string;
  bannerLevel: "info" | "warning" | "critical";
  ctaLabel: string | null;
  ctaUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

export interface PublicCmsEntry {
  id: string;
  tenantId: string;
  contentType: "blog_post" | "help_article" | "changelog" | "announcement_banner" | "legal_doc";
  slug: string;
  title: string;
  summary: string | null;
  bodyMarkdown: string;
  policyVersion: string | null;
  effectiveDate: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  authorName: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

export interface SupportForwardedUser {
  id: string;
  email?: string;
  name?: string;
  role?: "user" | "admin" | "ops";
  orgId?: string;
  planLabel?: string;
  contextSummary?: string;
}

export interface CreateSupportTicketSdkInput {
  idempotencyKey?:string;
  guestSessionToken?:string;
  kind?: "support" | "bug" | "feature";
  topic?: string;
  subject?: string;
  body: string;
  severity?: string;
  guestEmail?: string;
  contextSummary?: string;
  user?: SupportForwardedUser | null;
}

export interface SendSupportMessageSdkInput {
  idempotencyKey?:string;
  guestSessionToken?:string;
  body: string;
  authorType?: "user" | "staff" | "assistant";
  user?: SupportForwardedUser | null;
}

export interface SyncKbArticleSdkInput {
  title: string;
  body: string;
  sourceKey: string;
  path?: string;
  gitSha?: string;
  visibility?: "public" | "agent" | "internal";
  promote?: boolean;
}

export interface SupportBulkImportPayload {
  tenantId?: OpsBusinessUnit;
  tickets?: Array<Record<string, unknown>>;
  messages?: Array<Record<string, unknown>>;
  proposals?: Array<Record<string, unknown>>;
  gaps?: Array<Record<string, unknown>>;
  leads?: Array<Record<string, unknown>>;
}

export interface OpsSupportWidgetConfig {
  /** API base path mounted on the host app (default: "/support") or direct ops-hub URL */
  apiBase: string;
  tenantSlug: OpsBusinessUnit;
  publicKey?: string;
  embedUrl?: string;
}

export interface OpsHubClientConfig {
  /** Base URL of the Central Ops Hub (e.g. "https://ops.lalia.cloud" or "http://127.0.0.1:5300") */
  baseUrl: string;
  /** Default tenant slug (e.g. "legalai", "lalia", "metalarb") */
  tenantSlug: OpsBusinessUnit;
  /** Secret server-to-server key: sk_live_<slug>_... */
  secretKey?: string;
  /** Public browser-safe key: pk_live_<slug>_... */
  publicKey?: string;
  /** Optional custom fetch implementation */
  fetchImpl?: typeof fetch;
}

export function encodeSupportUserHeader(user: SupportForwardedUser): string {
  const json = JSON.stringify(user);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(json, "utf8").toString("base64url");
  }
  return btoa(encodeURIComponent(json));
}

export function decodeSupportUserHeader(encoded: string): SupportForwardedUser | null {
  try {
    if (typeof Buffer !== "undefined") {
      const raw = Buffer.from(encoded, "base64url").toString("utf8");
      return JSON.parse(raw) as SupportForwardedUser;
    }
    return JSON.parse(decodeURIComponent(atob(encoded))) as SupportForwardedUser;
  } catch {
    return null;
  }
}

export class OpsHubClient {
  private readonly baseUrl: string;
  private readonly tenantSlug: OpsBusinessUnit;
  private readonly secretKey?: string;
  private readonly publicKey?: string;
  private readonly fetchFn: typeof fetch;
  private pendingSupport=new Map<string,{body:string;key:string}>();

  constructor(config: OpsHubClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.tenantSlug = config.tenantSlug;
    this.secretKey = config.secretKey;
    this.publicKey = config.publicKey;
    this.fetchFn = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getTenantSlug(): OpsBusinessUnit {
    return this.tenantSlug;
  }

  private async request<T>(
    path: string,
    init: RequestInit & {
      authMode: "secret" | "public";
      forwardedUser?: SupportForwardedUser | null;
      tenantOverride?: string;
      idempotencyKey?:string;
      guestSessionToken?:string;
    },
  ): Promise<T> {
    const key = init.authMode === "secret" ? this.secretKey : (this.publicKey ?? this.secretKey);
    const tenant = init.tenantOverride || String(this.tenantSlug);
    const durable=init.method==='POST' && /^\/api\/v1\/support\/tickets(?:\/[^/]+\/messages)?$/.test(path);
    const scope=JSON.stringify([tenant,init.forwardedUser?.id,init.guestSessionToken,path]);
    const body=String(init.body??'');
    const previous=this.pendingSupport.get(scope);
    const intentKey=durable?(init.idempotencyKey??(previous?.body===body?previous.key:globalThis.crypto.randomUUID())):undefined;
    if(intentKey)this.pendingSupport.set(scope,{body,key:intentKey});
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(intentKey?{"Idempotency-Key":intentKey}:{}),
      ...(init.guestSessionToken?{"x-support-guest-token":init.guestSessionToken}:{}),
      "X-Ops-Tenant": tenant,
      "x-tenant-id": tenant,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { Authorization: `Bearer ${key}`, "X-Ops-Key": key } : {}),
      ...(init.forwardedUser
        ? { "X-Support-User-Json": encodeSupportUserHeader(init.forwardedUser) }
        : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    };

    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
    const data = (await res.json()) as T & { error?: string; message?: string };
    if (!res.ok) {
      throw new Error(data.error || data.message || `OpsHub request failed (${res.status})`);
    }
    if(intentKey && this.pendingSupport.get(scope)?.key===intentKey)this.pendingSupport.delete(scope);
    return data;
  }

  // ==================== 1. GL BILLING & COGS INGESTION ====================

  async ingestBillingEvent(event: BillingEventIngestInput) {
    return this.request<{
      ok: boolean;
      idempotentReplay: boolean;
      journalEntry: { id: string; entryNumber: string; businessUnitId: string };
    }>("/api/v1/ingest/billing-event", {
      method: "POST",
      authMode: "secret",
      body: JSON.stringify({
        businessUnitId: this.tenantSlug,
        ...event,
      }),
    });
  }

  async ingestCogs(event: CogsIngestInput) {
    return this.request<{
      ok: boolean;
      idempotentReplay: boolean;
      journalEntry: { id: string; entryNumber: string; businessUnitId: string };
    }>("/api/v1/ingest/cogs", {
      method: "POST",
      authMode: "secret",
      body: JSON.stringify({
        businessUnitId: this.tenantSlug,
        ...event,
      }),
    });
  }

  // ==================== 2. LIFECYCLE CRM & HEARTBEAT ====================

  async syncContact(contact: ContactSyncInput) {
    return this.request<{
      ok: boolean;
      contact: { id: string; email: string; unsubscribeToken: string; marketingOptIn: boolean };
    }>("/api/v1/ingest/contact", {
      method: "POST",
      authMode: "secret",
      body: JSON.stringify({
        tenantId: this.tenantSlug,
        ...contact,
      }),
    });
  }

  async sendBusinessEvent(event: BusinessEvent): Promise<BusinessEventReceipt> {
    return this.request<BusinessEventReceipt>("/api/v1/ingest/events", {
      method: "POST", authMode: "secret", body: JSON.stringify(event),
    });
  }

  async sendHeartbeat(heartbeat: HeartbeatInput = {}) {
    return this.request<{ ok: boolean; recordedAt: string }>("/api/v1/ingest/heartbeat", {
      method: "POST",
      authMode: "secret",
      body: JSON.stringify({
        tenantId: this.tenantSlug,
        ...heartbeat,
      }),
    });
  }

  // ==================== 3. HEADLESS CMS & ANNOUNCEMENTS ====================

  async getAnnouncements(tenantSlug: string = this.tenantSlug) {
    return this.request<{ ok: boolean; announcements: PublicAnnouncement[] }>(
      `/api/v1/public/cms/${encodeURIComponent(tenantSlug)}/announcements`,
      { method: "GET", authMode: "public", tenantOverride: tenantSlug },
    );
  }

  async getCmsContents(
    contentType?: "blog_post" | "help_article" | "changelog" | "legal_doc",
    tenantSlug: string = this.tenantSlug,
  ) {
    const qs = contentType ? `?type=${encodeURIComponent(contentType)}` : "";
    return this.request<{ ok: boolean; contents: PublicCmsEntry[] }>(
      `/api/v1/public/cms/${encodeURIComponent(tenantSlug)}/contents${qs}`,
      { method: "GET", authMode: "public", tenantOverride: tenantSlug },
    );
  }

  async captureLead(
    input: { email: string; name: string; phone?: string; marketingOptIn?: boolean; source?: string },
    tenantSlug: string = this.tenantSlug,
  ) {
    return this.request<{ ok: boolean; contactId: string }>(
      `/api/v1/public/cms/${encodeURIComponent(tenantSlug)}/leads`,
      {
        method: "POST",
        authMode: "public",
        tenantOverride: tenantSlug,
        body: JSON.stringify(input),
      },
    );
  }

  // ==================== 4. UNIFIED SUPPORT-KIT METHODS ====================

  /**
   * Create a support ticket in the Central Ops Hub (runs AI triage + Knowledge Gap + Telegram Ops notification).
   */
  async createSupportTicket(input: CreateSupportTicketSdkInput) {
    const forwardedUser = input.user
      ? {
          ...input.user,
          ...(input.contextSummary ? { contextSummary: input.contextSummary } : {}),
        }
      : undefined;
    return this.request<{
      ok: boolean;
      ticket: {
        id: string;
        tenantId: string;
        publicNumber: number;
        kind: string;
        topic: string;
        status: string;
        subject: string | null;
        createdAt: string;
      };
      message: { id: string; body: string; authorType: string; createdAt: string };
      triage?: unknown;
    }>("/api/v1/support/tickets", {
      method: "POST",
      authMode: this.secretKey ? "secret" : "public",
      forwardedUser,
      idempotencyKey: input.idempotencyKey,
      guestSessionToken: input.guestSessionToken,
      body: JSON.stringify({
        kind: input.kind ?? "support",
        topic: input.topic ?? "other",
        subject: input.subject,
        body: input.body,
        severity: input.severity,
        guestEmail: input.guestEmail ?? input.user?.email,
        contextSummary: input.contextSummary ?? input.user?.contextSummary,
      }),
    });
  }

  /**
   * Send a follow-up message on an existing support ticket in Ops Hub.
   */
  async sendSupportMessage(ticketId: string, input: SendSupportMessageSdkInput) {
    return this.request<{
      ok: boolean;
      message: { id: string; ticketId: string; body: string; authorType: string; createdAt: string };
      triage?: unknown;
    }>(`/api/v1/support/tickets/${encodeURIComponent(ticketId)}/messages`, {
      method: "POST",
      authMode: this.secretKey ? "secret" : "public",
      forwardedUser: input.user,
      idempotencyKey:input.idempotencyKey,
      guestSessionToken:input.guestSessionToken,
      body: JSON.stringify({
        body: input.body,
      }),
    });
  }

  /**
   * List support tickets for the authenticated user (or all tenant tickets if user.role === 'admin').
   */
  async listSupportTickets(opts?: { user?: SupportForwardedUser | null; status?: string; kind?: string }) {
    const qsParams = new URLSearchParams();
    if (opts?.status) qsParams.set("status", opts.status);
    if (opts?.kind) qsParams.set("kind", opts.kind);
    const qs = qsParams.toString() ? `?${qsParams.toString()}` : "";
    const endpoint = `/api/v1/support/tickets${qs}`;
    return this.request<{
      ok: boolean;
      tickets: Array<{
        id: string;
        tenantId: string;
        publicNumber: number;
        kind: string;
        topic: string;
        status: string;
        subject: string | null;
        createdAt: string;
      }>;
      counts?: Record<string, number>;
    }>(endpoint, {
      method: "GET",
      authMode: this.secretKey ? "secret" : "public",
      forwardedUser: opts?.user,
    });
  }

  /**
   * Fetch public Help Center KB articles for a connected app tenant.
   */
  async getHelpArticles(tenantSlug: string = this.tenantSlug) {
    return this.request<{
      ok: boolean;
      articles: Array<{
        id: string;
        tenantId: string;
        title: string;
        body: string;
        status: string;
        visibility: string;
        updatedAt: string;
      }>;
    }>("/api/v1/support/help/articles", {
      method: "GET",
      authMode: "public",
      tenantOverride: tenantSlug,
    });
  }

  /**
   * Push or sync app-local markdown documentation / KB articles into Ops Hub's central Support KB.
   */
  async syncKbArticles(articles: SyncKbArticleSdkInput[], tenantSlug: string = this.tenantSlug) {
    return this.request<{
      ok: boolean;
      syncedCount: number;
      articles: Array<{ id: string; title: string; status: string; visibility: string }>;
    }>("/api/v1/support/kb/sync", {
      method: "POST",
      authMode: "secret",
      tenantOverride: tenantSlug,
      body: JSON.stringify({
        tenantId: tenantSlug,
        articles,
      }),
    });
  }

  /**
   * Bulk import / upsert support tickets, messages, AI triage proposals, knowledge gaps, and leads
   * from a connected app's database into Ops Hub's central support tables.
   */
  async importSupportSnapshot(payload: SupportBulkImportPayload) {
    const tenantSlug = payload.tenantId || this.tenantSlug;
    return this.request<{
      ok: boolean;
      tenantId: string;
      imported: {
        tickets: number;
        messages: number;
        proposals: number;
        gaps: number;
        leads: number;
      };
    }>("/api/v1/support/import", {
      method: "POST",
      authMode: "secret",
      tenantOverride: String(tenantSlug),
      body: JSON.stringify({
        ...payload,
        tenantId: tenantSlug,
      }),
    });
  }

  /**
   * Helper returning props/URLs for embedding or mounting `<SupportLauncher />` / `<SupportOpsConsole />`.
   */
  getSupportWidgetProps(opts?: { localApiBase?: string }): OpsSupportWidgetConfig {
    return {
      apiBase: opts?.localApiBase || `${this.baseUrl}/api/v1/support`,
      tenantSlug: this.tenantSlug,
      publicKey: this.publicKey,
      embedUrl: `${this.baseUrl}/api/v1/support/embed?tenant=${encodeURIComponent(String(this.tenantSlug))}`,
    };
  }
}

export function createOpsHubClient(config: OpsHubClientConfig): OpsHubClient {
  return new OpsHubClient(config);
}

export interface OpsSupportProxyOptions {
  central?: Omit<SupportGatewayOptions, "getConfig" | "resolveUser" | "fetchImpl">;
  /** Dynamic or static config resolver so runtime DB settings take effect without restart */
  getConfig: () =>
    | Promise<{
        baseUrl?: string | null;
        secretKey?: string | null;
        publicKey?: string | null;
        tenantSlug: OpsBusinessUnit;
        mode?: "proxy" | "mirror" | "local" | "central";
      }>
    | {
        baseUrl?: string | null;
        secretKey?: string | null;
        publicKey?: string | null;
        tenantSlug: OpsBusinessUnit;
        mode?: "proxy" | "mirror" | "local" | "central";
      };
  /** Resolve the host app's logged-in user and rich contextSummary */
  resolveUser?: (req: any) => Promise<SupportForwardedUser | null> | SupportForwardedUser | null;
  /** Local @rhule/support-core handler used as fallback or primary in mirror mode */
  localHandler: (req: any, res: any, next?: any) => unknown;
  /** Optional post-mutation hook in mirror mode to sync the local DB snapshot (tickets, messages, proposals, gaps, leads) to Ops Hub */
  onMirrorSync?: () => Promise<unknown> | unknown;
  /** Optional custom fetch implementation */
  fetchImpl?: typeof fetch;
}

/**
 * Express middleware that connects a host app's `/support/*` mount to `ops-hub`:
 * - In `"proxy"` mode (when `baseUrl` + `secretKey` are configured), forwards `/support/*`
 *   to `${baseUrl}/api/v1/support/*` with `X-Ops-Key`, `X-Ops-Tenant`, and `X-Support-User-Json`
 *   (falling back transparently to `localHandler` if `ops-hub` is unreachable).
 * - In `"mirror"` mode (default when `baseUrl` + `secretKey` are configured), serves locally
 *   AND asynchronously mirrors ticket creations, replies, and leads to `ops-hub` so the Central
 *   Support Console always has every ticket and lead without introducing network latency.
 */
export function createOpsSupportProxy(options: OpsSupportProxyOptions) {
  const fetchFn = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  return async function opsSupportProxyMiddleware(req: any, res: any, next?: any) {
    let cfg: Awaited<ReturnType<OpsSupportProxyOptions["getConfig"]>> | null = null;
    try {
      cfg = await options.getConfig();
    } catch {
      return res.status(503).json({error:"Support configuration unavailable",retryable:true});
    }

    if (cfg.mode === "central") {
      if (!options.central || !options.resolveUser) return res.status(503).json({error:"Central support authority unavailable",retryable:true});
      return createSupportGateway({...options.central,getConfig:()=>cfg!,resolveUser:options.resolveUser,fetchImpl:options.fetchImpl}).handler(req,res);
    }

    const baseUrl = cfg?.baseUrl?.trim().replace(/\/$/, "");
    const secretKey = cfg?.secretKey?.trim();
    const tenantSlug = cfg?.tenantSlug || "legalai";
    const mode = cfg?.mode || "mirror";

    if (!baseUrl || !secretKey || mode === "local") {
      return options.localHandler(req, res, next);
    }

    const pathAndQuery = String(req.url || req.path || "/");
    const method = String(req.method || "GET").toUpperCase();

    if (mode === "proxy") {
      try {
        const user = options.resolveUser ? await options.resolveUser(req) : null;
        const targetUrl = `${baseUrl}/api/v1/support${pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`}`;
        const headers: Record<string, string> = {
          Accept: "application/json",
          Authorization: `Bearer ${secretKey}`,
          "X-Ops-Key": secretKey,
          "X-Ops-Tenant": String(tenantSlug),
          "x-tenant-id": String(tenantSlug),
          ...(user ? { "X-Support-User-Json": encodeSupportUserHeader(user) } : {}),
          ...(typeof req.headers?.["idempotency-key"]==="string"?{"Idempotency-Key":req.headers["idempotency-key"]}:{}),
          ...(typeof req.headers?.["x-support-guest-token"]==="string"?{"x-support-guest-token":req.headers["x-support-guest-token"]}:{}),
        };
        let bodyPayload: string | undefined;
        if (method !== "GET" && method !== "HEAD" && req.body !== undefined) {
          headers["Content-Type"] = "application/json";
          bodyPayload = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        }

        const upstream = await fetchFn(targetUrl, {
          method,
          headers,
          body: bodyPayload,
        });

        const contentType = upstream.headers.get("content-type") || "application/json";
        const text = await upstream.text();
        res.status(upstream.status).setHeader("Content-Type", contentType).send(text);
        return;
      } catch {
        // Graceful fallback to local support-kit DB if ops-hub is unreachable
        return options.localHandler(req, res, next);
      }
    }

    // Mirror mode: serve immediately from localHandler (which runs local AI triage, creates tickets,
    // messages, proposals, knowledge gaps, and leads), then sync the resulting state to Ops Hub
    // as soon as the response finishes!
    if (method === "POST" || method === "PATCH") {
      res?.on?.("finish", () => {
        if (options.onMirrorSync) {
          void Promise.resolve(options.onMirrorSync()).catch(() => {});
          return;
        }
        if (
          method === "POST" &&
          (pathAndQuery.startsWith("/tickets") ||
            pathAndQuery.startsWith("/leads") ||
            pathAndQuery.startsWith("/chat"))
        ) {
          void (async () => {
            try {
              const user = options.resolveUser ? await options.resolveUser(req) : null;
              const targetUrl = `${baseUrl}/api/v1/support${pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`}`;
              await fetchFn(targetUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${secretKey}`,
                  "X-Ops-Key": secretKey,
                  "X-Ops-Tenant": String(tenantSlug),
                  "x-tenant-id": String(tenantSlug),
                  ...(user ? { "X-Support-User-Json": encodeSupportUserHeader(user) } : {}),
                },
                body: typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}),
              });
            } catch {
              // non-blocking mirror
            }
          })();
        }
      });
    }

    return options.localHandler(req, res, next);
  };
}

/**
 * Compute an HMAC-SHA256 signature header (`t=<unix>,v1=<hex>`) using Web Crypto API
 * (works in Node 20+, Edge runtimes, and modern browsers).
 */
export async function signOpsWebhookPayload(
  rawBody: string,
  signingSecret: string,
  timestampSec: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    enc.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${timestampSec}.${rawBody}`),
  );
  const hex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestampSec},v1=${hex}`;
}

export async function verifyOpsWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  signingSecret: string,
  toleranceSec = 300,
): Promise<boolean> {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((kv) => {
      const [k, v] = kv.trim().split("=");
      return [k, v];
    }),
  );
  const ts = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(ts) || !v1) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > toleranceSec) return false;
  const expected = await signOpsWebhookPayload(rawBody, signingSecret, ts);
  return expected === `t=${ts},v1=${v1}`;
}

export interface OpsMarketingRemoteTenant {
  /** Base URL of the app's marketing-kit mount, e.g. `https://lexit.legal/marketing`. */
  baseUrl: string;
  /** Shared federation key the app accepts in `X-Ops-Key` (its `MARKETING_FEDERATION_KEY`). */
  key: string;
}

export interface OpsMarketingFederationOptions {
  /** Return the remote app for a tenant, or null to serve that tenant from `localHandler`. */
  resolveRemote: (tenantId: string) => OpsMarketingRemoteTenant | null | Promise<OpsMarketingRemoteTenant | null>;
  /** Local @rhule/marketing-core handler (multi-tenant, `/t/:tenant/*`). */
  localHandler: (req: any, res: any, next?: any) => unknown;
  /** Email of the signed-in ops operator; forwarded so test sends reach them. */
  resolveActorEmail?: (req: any) => string | null | undefined | Promise<string | null | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Middleware for ops.lalia.cloud that federates `/t/:tenant/*` marketing requests:
 * tenants whose app runs its own marketing-kit (e.g. LexIt) are proxied to that app so the
 * app stays the system of record for its blog and campaigns; other tenants are served locally.
 * Public routes (media, unsubscribe, webhooks) and `/t/all/*` always use the local handler.
 */
export function createOpsMarketingFederationProxy(options: OpsMarketingFederationOptions) {
  const fetchFn = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 120_000;

  return async function opsMarketingFederation(req: any, res: any, next?: any) {
    const rawUrl = String(req.url || "/");
    const match = rawUrl.match(/^\/t\/([a-z0-9_-]+)(\/[^?]*)?(\?.*)?$/i);
    if (!match || match[1].toLowerCase() === "all") return options.localHandler(req, res, next);

    const tenantId = match[1].toLowerCase();
    let remote: OpsMarketingRemoteTenant | null = null;
    try {
      remote = await options.resolveRemote(tenantId);
    } catch {
      remote = null;
    }
    if (!remote?.baseUrl || !remote.key) return options.localHandler(req, res, next);

    const method = String(req.method || "GET").toUpperCase();
    const target = `${remote.baseUrl.replace(/\/$/, "")}${match[2] || "/"}${match[3] || ""}`;
    const actorEmail = options.resolveActorEmail ? await options.resolveActorEmail(req) : null;
    const headers: Record<string, string> = {
      Accept: String(req.headers?.accept || "application/json"),
      "X-Ops-Key": remote.key,
      "X-Ops-Tenant": tenantId,
      ...(actorEmail ? { "X-Marketing-Actor-Email": String(actorEmail) } : {}),
    };
    let body: string | undefined;
    if (method !== "GET" && method !== "HEAD") {
      headers["Content-Type"] = "application/json";
      body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const upstream = await fetchFn(target, { method, headers, body, signal: controller.signal });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(buf);
    } catch (err: any) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: `Marketing app for ${tenantId} is unreachable (${String(err?.message || err).slice(0, 120)})` }));
    } finally {
      clearTimeout(timer);
    }
  };
}

export * from './supportHistory.js';
export * from './supportAuthority.js';
export * from './supportRestore.js';
export * from './supportRecoveryGateway.js';

export * from './supportAcceptance.js';

export * from './supportIdentity.js';

export * from './eventOutbox.js';

export * from './seoSchema.js';
export * from './seoSchemaHost.js';
