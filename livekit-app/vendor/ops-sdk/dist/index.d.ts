import { type SupportGatewayOptions } from './supportGateway.js';
export * from './supportGateway.js';
export type OpsBusinessUnit = "legalai" | "lalia" | "metalarb" | "shared_corporate" | (string & {});
export type StripeBillingEventType = "charge.succeeded" | "invoice.paid" | "charge.refunded" | "charge.dispute.created" | "payout.paid";
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
    lifecycleState?: "lead_only" | "trial_active" | "trial_expiring_3d" | "active_paid" | "power_user" | "churned" | "comp";
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
    idempotencyKey?: string;
    guestSessionToken?: string;
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
    idempotencyKey?: string;
    guestSessionToken?: string;
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
export declare function encodeSupportUserHeader(user: SupportForwardedUser): string;
export declare function decodeSupportUserHeader(encoded: string): SupportForwardedUser | null;
export declare class OpsHubClient {
    private readonly baseUrl;
    private readonly tenantSlug;
    private readonly secretKey?;
    private readonly publicKey?;
    private readonly fetchFn;
    private pendingSupport;
    constructor(config: OpsHubClientConfig);
    getBaseUrl(): string;
    getTenantSlug(): OpsBusinessUnit;
    private request;
    ingestBillingEvent(event: BillingEventIngestInput): Promise<{
        ok: boolean;
        idempotentReplay: boolean;
        journalEntry: {
            id: string;
            entryNumber: string;
            businessUnitId: string;
        };
    }>;
    ingestCogs(event: CogsIngestInput): Promise<{
        ok: boolean;
        idempotentReplay: boolean;
        journalEntry: {
            id: string;
            entryNumber: string;
            businessUnitId: string;
        };
    }>;
    syncContact(contact: ContactSyncInput): Promise<{
        ok: boolean;
        contact: {
            id: string;
            email: string;
            unsubscribeToken: string;
            marketingOptIn: boolean;
        };
    }>;
    sendHeartbeat(heartbeat?: HeartbeatInput): Promise<{
        ok: boolean;
        recordedAt: string;
    }>;
    getAnnouncements(tenantSlug?: string): Promise<{
        ok: boolean;
        announcements: PublicAnnouncement[];
    }>;
    getCmsContents(contentType?: "blog_post" | "help_article" | "changelog" | "legal_doc", tenantSlug?: string): Promise<{
        ok: boolean;
        contents: PublicCmsEntry[];
    }>;
    captureLead(input: {
        email: string;
        name: string;
        phone?: string;
        marketingOptIn?: boolean;
        source?: string;
    }, tenantSlug?: string): Promise<{
        ok: boolean;
        contactId: string;
    }>;
    /**
     * Create a support ticket in the Central Ops Hub (runs AI triage + Knowledge Gap + Telegram Ops notification).
     */
    createSupportTicket(input: CreateSupportTicketSdkInput): Promise<{
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
        message: {
            id: string;
            body: string;
            authorType: string;
            createdAt: string;
        };
        triage?: unknown;
    }>;
    /**
     * Send a follow-up message on an existing support ticket in Ops Hub.
     */
    sendSupportMessage(ticketId: string, input: SendSupportMessageSdkInput): Promise<{
        ok: boolean;
        message: {
            id: string;
            ticketId: string;
            body: string;
            authorType: string;
            createdAt: string;
        };
        triage?: unknown;
    }>;
    /**
     * List support tickets for the authenticated user (or all tenant tickets if user.role === 'admin').
     */
    listSupportTickets(opts?: {
        user?: SupportForwardedUser | null;
        status?: string;
        kind?: string;
    }): Promise<{
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
    }>;
    /**
     * Fetch public Help Center KB articles for a connected app tenant.
     */
    getHelpArticles(tenantSlug?: string): Promise<{
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
    }>;
    /**
     * Push or sync app-local markdown documentation / KB articles into Ops Hub's central Support KB.
     */
    syncKbArticles(articles: SyncKbArticleSdkInput[], tenantSlug?: string): Promise<{
        ok: boolean;
        syncedCount: number;
        articles: Array<{
            id: string;
            title: string;
            status: string;
            visibility: string;
        }>;
    }>;
    /**
     * Bulk import / upsert support tickets, messages, AI triage proposals, knowledge gaps, and leads
     * from a connected app's database into Ops Hub's central support tables.
     */
    importSupportSnapshot(payload: SupportBulkImportPayload): Promise<{
        ok: boolean;
        tenantId: string;
        imported: {
            tickets: number;
            messages: number;
            proposals: number;
            gaps: number;
            leads: number;
        };
    }>;
    /**
     * Helper returning props/URLs for embedding or mounting `<SupportLauncher />` / `<SupportOpsConsole />`.
     */
    getSupportWidgetProps(opts?: {
        localApiBase?: string;
    }): OpsSupportWidgetConfig;
}
export declare function createOpsHubClient(config: OpsHubClientConfig): OpsHubClient;
export interface OpsSupportProxyOptions {
    central?: Omit<SupportGatewayOptions, "getConfig" | "resolveUser" | "fetchImpl">;
    /** Dynamic or static config resolver so runtime DB settings take effect without restart */
    getConfig: () => Promise<{
        baseUrl?: string | null;
        secretKey?: string | null;
        publicKey?: string | null;
        tenantSlug: OpsBusinessUnit;
        mode?: "proxy" | "mirror" | "local" | "central";
    }> | {
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
export declare function createOpsSupportProxy(options: OpsSupportProxyOptions): (req: any, res: any, next?: any) => Promise<any>;
/**
 * Compute an HMAC-SHA256 signature header (`t=<unix>,v1=<hex>`) using Web Crypto API
 * (works in Node 20+, Edge runtimes, and modern browsers).
 */
export declare function signOpsWebhookPayload(rawBody: string, signingSecret: string, timestampSec?: number): Promise<string>;
export declare function verifyOpsWebhookSignature(rawBody: string, signatureHeader: string, signingSecret: string, toleranceSec?: number): Promise<boolean>;
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
export declare function createOpsMarketingFederationProxy(options: OpsMarketingFederationOptions): (req: any, res: any, next?: any) => Promise<unknown>;
