import { TenantId, SupportUser, BrandConfig, Lead, CreateTicketInput, Ticket, TicketMessage, TicketKind, TicketStatus, ProposalType, ProposalStatus, Proposal, CreateProposalInput, KnowledgeGap, GapStatus, RecordKnowledgeGapInput, CreateLeadInput, KbArticle, KbVisibility, KbArticleStatus } from '@rhule/support-shared';
export { BrandConfig, DEFAULT_MARKETING_CONSENT_LABEL, KIT_VERSION, Lead, SupportUser, TenantId } from '@rhule/support-shared';
import * as zod from 'zod';

/**
 * Host-owned auth → kit user shape.
 * Kit never verifies tokens; host middleware runs first.
 */
type ResolveUser = (req: unknown) => SupportUser | null | Promise<SupportUser | null>;
/**
 * Minimal SQL port so Postgres (LegalAI) and SQLite (ShareApp) both work.
 * Host implements; kit never opens its own pool.
 *
 * Use `?` placeholders; adapters should translate to `$1` for Postgres if needed.
 */
interface DbAdapter {
    run(sql: string, params?: unknown[]): Promise<{
        changes: number;
    }>;
    get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
    all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}
interface LlmAdapter {
    complete(input: {
        system: string;
        user: string;
        temperature?: number;
    }): Promise<string>;
}
/** Host-provided product codebase access for gap research (LegalAI, ShareApp, …). */
interface CodebaseSearchHit {
    path: string;
    snippet: string;
    score?: number;
}
interface CodebaseAdapter {
    /** Display name in provenance, e.g. "LegalAI" or "ShareApp" */
    label?: string;
    search(query: string, opts?: {
        limit?: number;
    }): Promise<CodebaseSearchHit[]>;
    readFile(path: string, opts?: {
        maxBytes?: number;
    }): Promise<string | null>;
}
/** Thin duplicate of @rhule/support-channels OpsNotifier — keeps core independent. */
type OpsNotificationKind = "ticket_created" | "escalation" | "proposal_ready" | "user_reply" | "kb_drafts_ready";
interface OpsNotification {
    kind: OpsNotificationKind;
    title: string;
    body: string;
    adminUrl?: string;
    ticketPublicNumber?: number;
}
interface OpsNotifier {
    sendToOps(notification: OpsNotification): Promise<void>;
    notifyProposalReady?(input: {
        ticketPublicNumber: number;
        proposal: {
            id: string;
            proposalType: string;
            summary: string;
            bodyJson: string;
            confidence?: number | null;
            claimedBy?: string | null;
        };
        adminUrl?: string;
        kindLabel?: string;
    }): Promise<{
        messageId?: string;
        chatId?: string;
        ok?: boolean;
    } | void>;
}
interface EmailNotifier {
    sendToUser(input: {
        to: string;
        subject: string;
        body: string;
        ticketPublicNumber?: number;
    }): Promise<void>;
}
type GitHubAdapter$1 = {
    createIssue: (input: {
        title: string;
        body: string;
        labels?: string[];
        kind: "bug" | "feature";
        ticketPublicNumber: number;
    }) => Promise<{
        url: string;
        number?: number;
    }>;
};
interface KbIngestConfig {
    /** Allowlisted path prefixes/globs for docs ingest (informational; host enforces). */
    globs?: string[];
    /** Shared secret for CI ingest via X-Support-Ingest-Token header. */
    webhookSecret?: string;
}
/** Telegram soft-claim ops — webhook + allowlist. Credentials may be dynamic. */
type TelegramOpsRuntimeConfig$1 = {
    botToken: string;
    chatId: string;
    webhookSecret: string;
    allowedUserIds: string[];
};
type ResolveTelegramConfig$1 = () => TelegramOpsRuntimeConfig$1 | null | Promise<TelegramOpsRuntimeConfig$1 | null>;
interface CreateSupportRouterOptions {
    tenantId: TenantId | string;
    db: DbAdapter;
    resolveUser: ResolveUser;
    brand: BrandConfig;
    llm?: LlmAdapter;
    tablePrefix?: string;
    /** Markdown / docs root for curated KB (host-owned content). */
    docsRoot?: string;
    /** Optional ops channel (Telegram/Slack) — fire-and-forget from triage. */
    opsNotifier?: OpsNotifier;
    /** Base URL for admin ticket links in ops notifications. */
    adminBaseUrl?: string;
    /** Host topic allowlist (defaults in shared DEFAULT_TOPICS). */
    topics?: string[];
    sensitiveTopics?: string[];
    autoReplyMinConfidence?: number;
    github?: GitHubAdapter$1;
    email?: EmailNotifier;
    kbIngest?: KbIngestConfig;
    /**
     * Product codebase for ops-triggered KB gap research.
     * Hosts pass LegalAI / ShareApp / other allowlisted roots via createFilesystemCodebaseAdapter.
     */
    codebase?: CodebaseAdapter;
    /** Fired when a public-launcher lead is created/updated (CRM / email list). */
    onLeadCaptured?: (lead: Lead) => void | Promise<void>;
    /**
     * Telegram webhook + soft-claim. When set, mounts POST /telegram/webhook
     * (host typically mounts kit under /support → /support/telegram/webhook).
     */
    telegram?: {
        resolveConfig: ResolveTelegramConfig$1;
        /** Factory that wraps @rhule/support-channels createTelegramOpsNotifier. */
        createClient: (cfg: TelegramOpsRuntimeConfig$1) => {
            answerCallback(callbackQueryId: string, text: string): Promise<void>;
            sendForceReply(text: string, placeholder?: string): Promise<unknown>;
            sendText(text: string): Promise<unknown>;
            formatProposalMessage(input: {
                ticketPublicNumber: number;
                proposal: {
                    id: string;
                    proposalType: string;
                    summary: string;
                    bodyJson: string;
                    confidence?: number | null;
                    claimedBy?: string | null;
                };
                adminUrl?: string;
                kindLabel?: string;
                claimLabel?: string | null;
                doneLabel?: string | null;
            }): string;
            proposalKeyboard(proposal: {
                id: string;
                proposalType: string;
                claimedBy?: string | null;
            }, opts?: {
                claimedBy?: string | null;
            }): {
                inline_keyboard?: Array<Array<{
                    text: string;
                    callback_data: string;
                }>>;
            };
            editProposalMessage(input: {
                chatId: string;
                messageId: string;
                text: string;
                replyMarkup?: {
                    inline_keyboard?: Array<Array<{
                        text: string;
                        callback_data: string;
                    }>>;
                } | null;
            }): Promise<unknown>;
        };
    };
}
interface SupportRouter {
    handler: (req: unknown, res: unknown, next?: unknown) => unknown;
    meta: {
        kitVersion: string;
        tenantId: string;
        shared: string;
    };
}

declare const DEFAULT_TABLE_PREFIX = "support_";
/**
 * Idempotent schema ensure for kit-owned tables.
 * Call once at host boot before serving traffic.
 *
 * Order matters for existing DBs: tables → column alters → indexes
 * (Postgres fails CREATE INDEX on columns that do not exist yet).
 */
declare function ensureSchema(db: DbAdapter, tablePrefix?: string): Promise<{
    tablePrefix: string;
    statements: number;
}>;

declare class TicketStore {
    private readonly db;
    private readonly tablePrefix;
    constructor(db: DbAdapter, tablePrefix?: string);
    private get t();
    private get m();
    nextPublicNumber(tenantId: string): Promise<number>;
    create(input: CreateTicketInput): Promise<{
        ticket: Ticket;
        message: TicketMessage;
    }>;
    getById(tenantId: string, id: string): Promise<Ticket | undefined>;
    getByPublicNumber(tenantId: string, publicNumber: number): Promise<Ticket | undefined>;
    listByTenant(tenantId: string, opts?: {
        limit?: number;
        kind?: TicketKind;
        topic?: string;
        status?: TicketStatus;
        userId?: string;
    }): Promise<Ticket[]>;
    listMessages(tenantId: string, ticketId: string): Promise<TicketMessage[]>;
    getMessage(tenantId: string, messageId: string): Promise<TicketMessage | undefined>;
    updateStatus(tenantId: string, ticketId: string, status: TicketStatus): Promise<Ticket | undefined>;
    updateGithubUrl(tenantId: string, ticketId: string, githubIssueUrl: string): Promise<Ticket | undefined>;
    updateAssignedTo(tenantId: string, ticketId: string, assignedTo: string | null): Promise<Ticket | undefined>;
    addMessage(input: {
        tenantId: string;
        ticketId: string;
        authorType: TicketMessage["authorType"];
        authorId?: string | null;
        body: string;
        citationJson?: string | null;
    }): Promise<TicketMessage>;
}

declare class TicketService {
    private readonly store;
    constructor(db: DbAdapter, tablePrefix?: string);
    createTicket(raw: CreateTicketInput): Promise<{
        ticket: Ticket;
        message: TicketMessage;
    }>;
    listTickets(tenantId: string, opts?: {
        limit?: number;
        kind?: TicketKind;
        topic?: string;
        status?: TicketStatus;
        userId?: string;
    }): Promise<{
        kind: "support" | "bug" | "feature";
        topic: string;
        category: "bug" | "feature" | "billing" | "how_to" | "other";
        status: "open" | "ai_working" | "pending_ops" | "waiting_user" | "escalated" | "resolved" | "closed" | "pending_user";
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        publicNumber: number;
        createdAt: string;
        updatedAt: string;
        subject?: string | null | undefined;
        severity?: string | null | undefined;
        priority?: string | null | undefined;
        userId?: string | null | undefined;
        orgId?: string | null | undefined;
        guestEmail?: string | null | undefined;
        contextJson?: string | null | undefined;
        duplicateOfTicketId?: string | null | undefined;
        assignedTo?: string | null | undefined;
        githubIssueUrl?: string | null | undefined;
        closedAt?: string | null | undefined;
    }[]>;
    getTicket(tenantId: string, id: string): Promise<{
        kind: "support" | "bug" | "feature";
        topic: string;
        category: "bug" | "feature" | "billing" | "how_to" | "other";
        status: "open" | "ai_working" | "pending_ops" | "waiting_user" | "escalated" | "resolved" | "closed" | "pending_user";
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        publicNumber: number;
        createdAt: string;
        updatedAt: string;
        subject?: string | null | undefined;
        severity?: string | null | undefined;
        priority?: string | null | undefined;
        userId?: string | null | undefined;
        orgId?: string | null | undefined;
        guestEmail?: string | null | undefined;
        contextJson?: string | null | undefined;
        duplicateOfTicketId?: string | null | undefined;
        assignedTo?: string | null | undefined;
        githubIssueUrl?: string | null | undefined;
        closedAt?: string | null | undefined;
    } | undefined>;
    getTicketByPublicNumber(tenantId: string, publicNumber: number): Promise<{
        kind: "support" | "bug" | "feature";
        topic: string;
        category: "bug" | "feature" | "billing" | "how_to" | "other";
        status: "open" | "ai_working" | "pending_ops" | "waiting_user" | "escalated" | "resolved" | "closed" | "pending_user";
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        publicNumber: number;
        createdAt: string;
        updatedAt: string;
        subject?: string | null | undefined;
        severity?: string | null | undefined;
        priority?: string | null | undefined;
        userId?: string | null | undefined;
        orgId?: string | null | undefined;
        guestEmail?: string | null | undefined;
        contextJson?: string | null | undefined;
        duplicateOfTicketId?: string | null | undefined;
        assignedTo?: string | null | undefined;
        githubIssueUrl?: string | null | undefined;
        closedAt?: string | null | undefined;
    } | undefined>;
    getTicketByIdOrNumber(tenantId: string, idOrNumber: string): Promise<{
        kind: "support" | "bug" | "feature";
        topic: string;
        category: "bug" | "feature" | "billing" | "how_to" | "other";
        status: "open" | "ai_working" | "pending_ops" | "waiting_user" | "escalated" | "resolved" | "closed" | "pending_user";
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        publicNumber: number;
        createdAt: string;
        updatedAt: string;
        subject?: string | null | undefined;
        severity?: string | null | undefined;
        priority?: string | null | undefined;
        userId?: string | null | undefined;
        orgId?: string | null | undefined;
        guestEmail?: string | null | undefined;
        contextJson?: string | null | undefined;
        duplicateOfTicketId?: string | null | undefined;
        assignedTo?: string | null | undefined;
        githubIssueUrl?: string | null | undefined;
        closedAt?: string | null | undefined;
    } | undefined>;
    listMessages(tenantId: string, ticketId: string): Promise<{
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        createdAt: string;
        ticketId: string;
        authorType: "agent" | "user" | "assistant" | "staff" | "system" | "ops";
        body: string;
        authorId?: string | null | undefined;
        attachmentsJson?: string | null | undefined;
        citationJson?: string | null | undefined;
    }[]>;
    setStatus(tenantId: string, ticketId: string, status: TicketStatus): Promise<{
        kind: "support" | "bug" | "feature";
        topic: string;
        category: "bug" | "feature" | "billing" | "how_to" | "other";
        status: "open" | "ai_working" | "pending_ops" | "waiting_user" | "escalated" | "resolved" | "closed" | "pending_user";
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        publicNumber: number;
        createdAt: string;
        updatedAt: string;
        subject?: string | null | undefined;
        severity?: string | null | undefined;
        priority?: string | null | undefined;
        userId?: string | null | undefined;
        orgId?: string | null | undefined;
        guestEmail?: string | null | undefined;
        contextJson?: string | null | undefined;
        duplicateOfTicketId?: string | null | undefined;
        assignedTo?: string | null | undefined;
        githubIssueUrl?: string | null | undefined;
        closedAt?: string | null | undefined;
    } | undefined>;
    setGithubIssueUrl(tenantId: string, ticketId: string, url: string): Promise<{
        kind: "support" | "bug" | "feature";
        topic: string;
        category: "bug" | "feature" | "billing" | "how_to" | "other";
        status: "open" | "ai_working" | "pending_ops" | "waiting_user" | "escalated" | "resolved" | "closed" | "pending_user";
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        publicNumber: number;
        createdAt: string;
        updatedAt: string;
        subject?: string | null | undefined;
        severity?: string | null | undefined;
        priority?: string | null | undefined;
        userId?: string | null | undefined;
        orgId?: string | null | undefined;
        guestEmail?: string | null | undefined;
        contextJson?: string | null | undefined;
        duplicateOfTicketId?: string | null | undefined;
        assignedTo?: string | null | undefined;
        githubIssueUrl?: string | null | undefined;
        closedAt?: string | null | undefined;
    } | undefined>;
    setAssignedTo(tenantId: string, ticketId: string, assignedTo: string | null): Promise<{
        kind: "support" | "bug" | "feature";
        topic: string;
        category: "bug" | "feature" | "billing" | "how_to" | "other";
        status: "open" | "ai_working" | "pending_ops" | "waiting_user" | "escalated" | "resolved" | "closed" | "pending_user";
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        publicNumber: number;
        createdAt: string;
        updatedAt: string;
        subject?: string | null | undefined;
        severity?: string | null | undefined;
        priority?: string | null | undefined;
        userId?: string | null | undefined;
        orgId?: string | null | undefined;
        guestEmail?: string | null | undefined;
        contextJson?: string | null | undefined;
        duplicateOfTicketId?: string | null | undefined;
        assignedTo?: string | null | undefined;
        githubIssueUrl?: string | null | undefined;
        closedAt?: string | null | undefined;
    } | undefined>;
    addMessage(tenantId: string, ticketId: string, body: string, opts?: {
        authorType?: TicketMessage["authorType"];
        authorId?: string;
        citationJson?: string | null;
    }): Promise<{
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        createdAt: string;
        ticketId: string;
        authorType: "agent" | "user" | "assistant" | "staff" | "system" | "ops";
        body: string;
        authorId?: string | null | undefined;
        attachmentsJson?: string | null | undefined;
        citationJson?: string | null | undefined;
    }>;
}

declare class ProposalStore {
    private readonly db;
    private readonly tablePrefix;
    constructor(db: DbAdapter, tablePrefix?: string);
    private get p();
    create(input: {
        tenantId: string;
        ticketId: string;
        proposalType: ProposalType;
        summary: string;
        bodyJson: string;
        confidence?: number | null;
        status?: ProposalStatus;
    }): Promise<Proposal>;
    getById(tenantId: string, id: string): Promise<Proposal | undefined>;
    listByTenant(tenantId: string, opts?: {
        status?: ProposalStatus;
        limit?: number;
    }): Promise<Proposal[]>;
    listForTicket(tenantId: string, ticketId: string): Promise<Proposal[]>;
    getActivePendingForTicket(tenantId: string, ticketId: string): Promise<Proposal | undefined>;
    updateStatus(tenantId: string, id: string, status: ProposalStatus, fields?: {
        reviewedBy?: string | null;
        reviewedAt?: string | null;
        telegramMessageId?: string | null;
        telegramChatId?: string | null;
        claimedBy?: string | null;
        claimedAt?: string | null;
        executionStatus?: string | null;
        executionRef?: string | null;
    }): Promise<Proposal | undefined>;
    /**
     * Atomic transition: only succeeds if current status is in `fromStatuses`.
     * Returns updated proposal or undefined if lost the race.
     */
    tryAtomicTransition(tenantId: string, id: string, fromStatuses: ProposalStatus[], nextStatus: ProposalStatus, fields: {
        reviewedBy: string;
        reviewedAt: string;
        executionStatus?: string | null;
        executionRef?: string | null;
    }): Promise<Proposal | undefined>;
    setTelegramMeta(tenantId: string, id: string, meta: {
        telegramMessageId: string;
        telegramChatId: string;
    }): Promise<Proposal | undefined>;
    setClaim(tenantId: string, id: string, claimedBy: string | null): Promise<Proposal | undefined>;
}

declare class ProposalService {
    private readonly store;
    constructor(db: DbAdapter, tablePrefix?: string);
    /** Expose store for executor / webhook soft-claim helpers. */
    getStore(): ProposalStore;
    createProposal(raw: CreateProposalInput): Promise<Proposal>;
    getProposal(tenantId: string, id: string): Promise<{
        status: "pending_review" | "approved" | "rejected" | "needs_info" | "executed";
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        createdAt: string;
        ticketId: string;
        proposalType: "feature" | "other" | "reply" | "escalate" | "bug_fix" | "kb_article" | "github_issue";
        summary: string;
        bodyJson: string;
        confidence?: number | null | undefined;
        telegramMessageId?: string | null | undefined;
        telegramChatId?: string | null | undefined;
        claimedBy?: string | null | undefined;
        claimedAt?: string | null | undefined;
        reviewedBy?: string | null | undefined;
        reviewedAt?: string | null | undefined;
        executionStatus?: string | null | undefined;
        executionRef?: string | null | undefined;
    } | undefined>;
    listProposals(tenantId: string, opts?: {
        status?: ProposalStatus;
        limit?: number;
    }): Promise<{
        status: "pending_review" | "approved" | "rejected" | "needs_info" | "executed";
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        createdAt: string;
        ticketId: string;
        proposalType: "feature" | "other" | "reply" | "escalate" | "bug_fix" | "kb_article" | "github_issue";
        summary: string;
        bodyJson: string;
        confidence?: number | null | undefined;
        telegramMessageId?: string | null | undefined;
        telegramChatId?: string | null | undefined;
        claimedBy?: string | null | undefined;
        claimedAt?: string | null | undefined;
        reviewedBy?: string | null | undefined;
        reviewedAt?: string | null | undefined;
        executionStatus?: string | null | undefined;
        executionRef?: string | null | undefined;
    }[]>;
    listProposalsForTicket(tenantId: string, ticketId: string): Promise<{
        status: "pending_review" | "approved" | "rejected" | "needs_info" | "executed";
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        createdAt: string;
        ticketId: string;
        proposalType: "feature" | "other" | "reply" | "escalate" | "bug_fix" | "kb_article" | "github_issue";
        summary: string;
        bodyJson: string;
        confidence?: number | null | undefined;
        telegramMessageId?: string | null | undefined;
        telegramChatId?: string | null | undefined;
        claimedBy?: string | null | undefined;
        claimedAt?: string | null | undefined;
        reviewedBy?: string | null | undefined;
        reviewedAt?: string | null | undefined;
        executionStatus?: string | null | undefined;
        executionRef?: string | null | undefined;
    }[]>;
    getActivePendingForTicket(tenantId: string, ticketId: string): Promise<{
        status: "pending_review" | "approved" | "rejected" | "needs_info" | "executed";
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        createdAt: string;
        ticketId: string;
        proposalType: "feature" | "other" | "reply" | "escalate" | "bug_fix" | "kb_article" | "github_issue";
        summary: string;
        bodyJson: string;
        confidence?: number | null | undefined;
        telegramMessageId?: string | null | undefined;
        telegramChatId?: string | null | undefined;
        claimedBy?: string | null | undefined;
        claimedAt?: string | null | undefined;
        reviewedBy?: string | null | undefined;
        reviewedAt?: string | null | undefined;
        executionStatus?: string | null | undefined;
        executionRef?: string | null | undefined;
    } | undefined>;
    setTelegramMeta(tenantId: string, id: string, meta: {
        telegramMessageId: string;
        telegramChatId: string;
    }): Promise<{
        status: "pending_review" | "approved" | "rejected" | "needs_info" | "executed";
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        createdAt: string;
        ticketId: string;
        proposalType: "feature" | "other" | "reply" | "escalate" | "bug_fix" | "kb_article" | "github_issue";
        summary: string;
        bodyJson: string;
        confidence?: number | null | undefined;
        telegramMessageId?: string | null | undefined;
        telegramChatId?: string | null | undefined;
        claimedBy?: string | null | undefined;
        claimedAt?: string | null | undefined;
        reviewedBy?: string | null | undefined;
        reviewedAt?: string | null | undefined;
        executionStatus?: string | null | undefined;
        executionRef?: string | null | undefined;
    } | undefined>;
    setClaim(tenantId: string, id: string, claimedBy: string | null): Promise<{
        status: "pending_review" | "approved" | "rejected" | "needs_info" | "executed";
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        createdAt: string;
        ticketId: string;
        proposalType: "feature" | "other" | "reply" | "escalate" | "bug_fix" | "kb_article" | "github_issue";
        summary: string;
        bodyJson: string;
        confidence?: number | null | undefined;
        telegramMessageId?: string | null | undefined;
        telegramChatId?: string | null | undefined;
        claimedBy?: string | null | undefined;
        claimedAt?: string | null | undefined;
        reviewedBy?: string | null | undefined;
        reviewedAt?: string | null | undefined;
        executionStatus?: string | null | undefined;
        executionRef?: string | null | undefined;
    } | undefined>;
    /**
     * Atomic approve/reject/needs_info. Returns undefined if another reviewer won.
     */
    tryAtomicTransition(tenantId: string, id: string, nextStatus: "approved" | "rejected" | "needs_info", reviewedBy: string, extra?: {
        executionStatus?: string | null;
        executionRef?: string | null;
    }): Promise<Proposal | undefined>;
    approveProposal(tenantId: string, id: string, reviewedBy: string): Promise<Proposal>;
    rejectProposal(tenantId: string, id: string, reviewedBy: string): Promise<Proposal>;
    markNeedsInfo(tenantId: string, id: string, reviewedBy: string): Promise<Proposal>;
    /** Non-atomic path kept for tests that expect throw on invalid status. */
    transitionReviewUnchecked(tenantId: string, id: string, nextStatus: "approved" | "rejected" | "needs_info", reviewedBy: string): Promise<Proposal>;
}

declare class KnowledgeGapStore {
    private readonly db;
    private readonly tablePrefix;
    constructor(db: DbAdapter, tablePrefix?: string);
    private get g();
    private get t();
    private get m();
    getLastUserQuestion(tenantId: string, ticketId: string): Promise<string | null>;
    record(input: {
        tenantId: string;
        ticketId: string;
        proposalId?: string | null;
        proposalType?: ProposalType | null;
        summary?: string | null;
        escalationReason?: string | null;
        docQuery?: string | null;
        docHitsJson?: string | null;
        userQuestion?: string | null;
    }): Promise<KnowledgeGap>;
    getById(tenantId: string, id: string): Promise<KnowledgeGap | undefined>;
    listByTenant(tenantId: string, opts?: {
        status?: GapStatus;
        limit?: number;
    }): Promise<KnowledgeGap[]>;
    updateStatus(tenantId: string, id: string, status: GapStatus): Promise<KnowledgeGap | undefined>;
}

declare class KnowledgeGapService {
    private readonly store;
    constructor(db: DbAdapter, tablePrefix?: string);
    recordKnowledgeGap(raw: RecordKnowledgeGapInput): Promise<KnowledgeGap>;
    getKnowledgeGap(tenantId: string, id: string): Promise<{
        status: "open" | "resolved" | "dismissed";
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        createdAt: string;
        ticketId: string;
        userQuestion: string;
        publicNumber?: number | null | undefined;
        proposalType?: "feature" | "other" | "reply" | "escalate" | "bug_fix" | "kb_article" | "github_issue" | null | undefined;
        summary?: string | null | undefined;
        escalationReason?: string | null | undefined;
        docQuery?: string | null | undefined;
        docHitsJson?: string | null | undefined;
        proposalId?: string | null | undefined;
        resolvedAt?: string | null | undefined;
    } | undefined>;
    listKnowledgeGaps(tenantId: string, opts?: {
        status?: GapStatus;
        limit?: number;
    }): Promise<{
        status: "open" | "resolved" | "dismissed";
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        createdAt: string;
        ticketId: string;
        userQuestion: string;
        publicNumber?: number | null | undefined;
        proposalType?: "feature" | "other" | "reply" | "escalate" | "bug_fix" | "kb_article" | "github_issue" | null | undefined;
        summary?: string | null | undefined;
        escalationReason?: string | null | undefined;
        docQuery?: string | null | undefined;
        docHitsJson?: string | null | undefined;
        proposalId?: string | null | undefined;
        resolvedAt?: string | null | undefined;
    }[]>;
    patchKnowledgeGap(tenantId: string, id: string, status: GapStatus): Promise<{
        status: "open" | "resolved" | "dismissed";
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        createdAt: string;
        ticketId: string;
        userQuestion: string;
        publicNumber?: number | null | undefined;
        proposalType?: "feature" | "other" | "reply" | "escalate" | "bug_fix" | "kb_article" | "github_issue" | null | undefined;
        summary?: string | null | undefined;
        escalationReason?: string | null | undefined;
        docQuery?: string | null | undefined;
        docHitsJson?: string | null | undefined;
        proposalId?: string | null | undefined;
        resolvedAt?: string | null | undefined;
    } | undefined>;
}

declare class LeadStore {
    private readonly db;
    private readonly tablePrefix;
    constructor(db: DbAdapter, tablePrefix?: string);
    private get t();
    getById(tenantId: string, id: string): Promise<Lead | undefined>;
    getByEmail(tenantId: string, email: string): Promise<Lead | undefined>;
    /**
     * Insert or update by (tenant_id, email). Re-submitting the gate refreshes
     * name/phone/consent so ops always see the latest opt-in state.
     */
    upsert(input: CreateLeadInput & {
        marketingEmailOptIn: boolean;
        marketingSmsOptIn: boolean;
    }): Promise<Lead>;
    list(tenantId: string, opts?: {
        marketingOnly?: boolean;
        limit?: number;
    }): Promise<Lead[]>;
}

declare class LeadService {
    private readonly store;
    constructor(db: DbAdapter, tablePrefix?: string);
    getById(tenantId: string, id: string): Promise<{
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        createdAt: string;
        updatedAt: string;
        email: string;
        name: string;
        marketingEmailOptIn: boolean;
        marketingSmsOptIn: boolean;
        source: string;
        phone?: string | null | undefined;
        consentText?: string | null | undefined;
        consentAt?: string | null | undefined;
        ipHash?: string | null | undefined;
        userAgent?: string | null | undefined;
    } | undefined>;
    getByEmail(tenantId: string, email: string): Promise<{
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        createdAt: string;
        updatedAt: string;
        email: string;
        name: string;
        marketingEmailOptIn: boolean;
        marketingSmsOptIn: boolean;
        source: string;
        phone?: string | null | undefined;
        consentText?: string | null | undefined;
        consentAt?: string | null | undefined;
        ipHash?: string | null | undefined;
        userAgent?: string | null | undefined;
    } | undefined>;
    list(tenantId: string, opts?: {
        marketingOnly?: boolean;
        limit?: number;
    }): Promise<{
        id: string;
        tenantId: string & zod.BRAND<"TenantId">;
        createdAt: string;
        updatedAt: string;
        email: string;
        name: string;
        marketingEmailOptIn: boolean;
        marketingSmsOptIn: boolean;
        source: string;
        phone?: string | null | undefined;
        consentText?: string | null | undefined;
        consentAt?: string | null | undefined;
        ipHash?: string | null | undefined;
        userAgent?: string | null | undefined;
    }[]>;
    upsertLead(raw: CreateLeadInput): Promise<Lead>;
}

interface KbSearchHit {
    source: string;
    title: string;
    excerpt: string;
    score: number;
}
interface SearchCuratedDocsOptions {
    /** Host-owned markdown root (injected; no hardcoded product paths). */
    docsRoot: string;
    limit?: number;
    cacheTtlMs?: number;
    /** Relative paths preferred when query has no token matches (e.g. `faq.md`). */
    fallbackSources?: string[];
}
/**
 * Keyword search over host markdown under `docsRoot`.
 * No vector DB — token overlap scoring with heading-aware chunking.
 */
declare function searchCuratedDocs(query: string, options: SearchCuratedDocsOptions): KbSearchHit[];
declare function formatSourcesForPrompt(hits: KbSearchHit[]): string;
/** Reset in-memory chunk cache (tests). */
declare function clearDocsCache(): void;
interface SearchActiveArticlesOptions {
    query?: string;
    limit?: number;
    tablePrefix?: string;
}
/**
 * Returns only `active` kb_articles for a tenant (excludes draft/codegen drafts).
 * Optional keyword ranking when `query` is provided.
 */
declare function searchActiveArticles(db: DbAdapter, tenantId: string, options?: SearchActiveArticlesOptions): Promise<KbArticle[]>;

interface IngestCodegenArticleInput {
    tenantId: string;
    title: string;
    body: string;
    sourceKey: string;
    gitSha?: string;
    path?: string;
    visibility?: KbVisibility;
    tablePrefix?: string;
    sourceKind?: "codegen" | "evolutionary" | "curated" | "code_research";
}
/**
 * Ingest a codegen-sourced KB article as draft. Upserts on (tenant_id, source_kind, source_key).
 */
declare function ingestCodegenArticle(db: DbAdapter, input: IngestCodegenArticleInput): Promise<KbArticle>;
declare function promoteKbArticle(db: DbAdapter, tenantId: string, id: string, tablePrefix?: string, opts?: {
    visibility?: KbVisibility;
}): Promise<KbArticle>;
declare function deprecateKbArticle(db: DbAdapter, tenantId: string, id: string, tablePrefix?: string): Promise<KbArticle>;
declare function updateKbArticle(db: DbAdapter, tenantId: string, id: string, patch: {
    title?: string;
    body?: string;
    visibility?: KbVisibility;
}, tablePrefix?: string): Promise<KbArticle>;
declare function listKbArticles(db: DbAdapter, tenantId: string, opts?: {
    status?: KbArticleStatus;
    sourceKind?: string;
    limit?: number;
    tablePrefix?: string;
}): Promise<KbArticle[]>;
declare function getKbArticle(db: DbAdapter, tenantId: string, id: string, tablePrefix?: string): Promise<KbArticle | undefined>;
interface IngestFromChangelogOptions {
    gitSha?: string;
    tablePrefix?: string;
}
declare function ingestFromChangelog(db: DbAdapter, tenantId: string, changelogText: string, opts?: IngestFromChangelogOptions): Promise<KbArticle[]>;
interface IngestDocSource {
    path: string;
    title?: string;
    body: string;
}
/**
 * Upsert support-doc markdown paths as draft codegen articles.
 */
declare function ingestDocsSources(db: DbAdapter, tenantId: string, sources: IngestDocSource[], opts?: {
    gitSha?: string;
    tablePrefix?: string;
}): Promise<KbArticle[]>;

interface PromoteTicketToKbInput {
    tenantId: string;
    ticketId: string;
    title?: string;
    body?: string;
    /** If true, promote immediately to active (ops already reviewed). Default draft. */
    activate?: boolean;
    tablePrefix?: string;
}
/**
 * Create an evolutionary KB draft from a resolved support ticket thread.
 */
declare function promoteTicketAnswerToKb(db: DbAdapter, input: PromoteTicketToKbInput): Promise<KbArticle>;

type GapResearchResult = {
    ok: true;
    article: KbArticle;
    confidence: number;
    citedPaths: string[];
    insufficient: false;
} | {
    ok: false;
    insufficient: true;
    reason: string;
    citedPaths: string[];
};
/**
 * Ops-triggered: search host codebase (+ optional docsRoot), draft a KB article.
 * Never auto-promotes — always creates/updates a draft for human review.
 */
declare function researchGapToKbDraft(input: {
    db: DbAdapter;
    tenantId: string;
    gapId: string;
    llm: LlmAdapter;
    codebase: CodebaseAdapter;
    brand: BrandConfig;
    docsRoot?: string;
    tablePrefix?: string;
}): Promise<GapResearchResult>;
/**
 * When ops provides a freeform answer (or ticket thread), LLM-curate into a clean KB draft.
 */
declare function curateAnswerToKbDraft(input: {
    db: DbAdapter;
    tenantId: string;
    llm: LlmAdapter;
    brand: BrandConfig;
    title?: string;
    rawAnswer: string;
    userQuestion?: string;
    sourceKey: string;
    tablePrefix?: string;
}): Promise<KbArticle>;

interface FilesystemCodebaseOptions {
    /** Absolute repo / app root */
    root: string;
    /** Relative allowlisted directories (e.g. docs/support, server, client/src) */
    allowlist: string[];
    label?: string;
    skipDirs?: string[];
    maxFilesWalk?: number;
}
/**
 * Host helper: search/read under allowlisted directories of a local codebase.
 * Safe for LegalAI, ShareApp, or any future host — pass different roots/allowlists.
 */
declare function createFilesystemCodebaseAdapter(options: FilesystemCodebaseOptions): CodebaseAdapter;

/**
 * Host-injected GitHub issue creator for bug/feature proposal approval.
 */
interface GitHubIssueInput {
    title: string;
    body: string;
    labels?: string[];
    kind: "bug" | "feature";
    ticketPublicNumber: number;
}
interface GitHubIssueResult {
    url: string;
    number?: number;
}
type GitHubAdapter = {
    createIssue: (input: GitHubIssueInput) => Promise<GitHubIssueResult>;
};
declare function parseBugFeatureBody(bodyJson: string): {
    draft_reply?: string;
    github_title?: string;
    github_body?: string;
    title?: string;
    summary?: string;
};
declare function executeGithubFromProposal(github: GitHubAdapter, opts: {
    proposalType: string;
    bodyJson: string;
    summary: string;
    ticketPublicNumber: number;
}): Promise<GitHubIssueResult>;

interface TriageInput {
    tenantId: string;
    user: SupportUser;
    message: string;
    /** Optional explicit kind from launcher home picker. */
    kind?: "support" | "bug" | "feature";
    topic?: string;
    guestEmail?: string;
    leadContext?: {
        leadId: string;
        name: string;
        phone?: string | null;
        marketingOptIn?: boolean;
    };
}
interface TriageDeps {
    db: DbAdapter;
    brand: BrandConfig;
    llm?: LlmAdapter;
    docsRoot?: string;
    tablePrefix?: string;
    opsNotifier?: OpsNotifier;
    adminBaseUrl?: string;
    topics?: string[];
    sensitiveTopics?: string[];
    autoReplyMinConfidence?: number;
    /** Public home launcher — answer from product FAQ only; no account claims. */
    publicAudience?: boolean;
}
type TriageResult = {
    action: "ticket";
    reply: string;
    ticket: Ticket;
    message: TicketMessage;
    agentMessage: TicketMessage;
    proposal?: Proposal;
    gap?: KnowledgeGap;
    confidence: number;
    autoReplied: boolean;
    sources: KbSearchHit[];
};
/**
 * Triage a user chat message. Always creates (or continues) an auditable ticket.
 */
declare function triageMessage(deps: TriageDeps, input: TriageInput): Promise<TriageResult>;

type CoachMessage = {
    role: "user" | "assistant";
    body: string;
};
type CoachPriority = "nice_to_have" | "important" | "critical";
type CoachDraft = {
    problem: string;
    solution: string;
    priority: CoachPriority;
    subject: string;
};
type CoachResult = {
    ok: boolean;
    reply: string;
    readyToSubmit: boolean;
    draft: CoachDraft;
    mode: "llm" | "fallback";
    error?: string;
};
/**
 * Multi-turn feature-request coach. Uses host LLM when configured;
 * otherwise returns a deterministic fallback so the UI can still collect a draft.
 */
declare function coachFeatureRequest(input: {
    messages: CoachMessage[];
    brand: BrandConfig;
    llm?: LlmAdapter;
    userContextSummary?: string;
}): Promise<CoachResult>;

type AgentRoute = "reply_in_app" | "propose_reply" | "escalate" | "close";
interface LlmTriageParse {
    route?: AgentRoute;
    kind?: TicketKind;
    topic?: string;
    /** @deprecated */
    category?: string;
    proposal_type?: string;
    summary?: string;
    confidence?: number;
    body?: {
        draft_reply?: string;
        sources?: string[];
        escalation_reason?: string | null;
        reason?: string;
    };
}
interface RoutingDecision {
    /** Always creates a ticket; auto means reply is sent without ops gate. */
    action: "auto_reply" | "propose" | "escalate";
    kind: TicketKind;
    topic: string;
    proposalType: ProposalType;
    confidence: number;
    summary: string;
    draftReply: string;
    recordGap: boolean;
    resolveAfterReply?: boolean;
}
declare const DEFAULT_HOLD_REPLY = "Thanks for your patience \u2014 I'm still looking into this. If I can't resolve it here, a teammate will follow up in this same chat.";
declare const DEFAULT_ESCALATION_REPLY = "I've shared this with our team for a closer look. You'll see updates here \u2014 we typically respond within one business day.";
declare function containsEscalationSignal(text: string): boolean;
declare function inferKindTopic(message: string, topicAllowlist?: string[]): {
    kind: TicketKind;
    topic: string;
};
interface DecideOptions {
    topicAllowlist?: string[];
    sensitiveTopics?: string[];
    autoReplyMinConfidence?: number;
}
declare function decideFromLlm(parsed: LlmTriageParse, message: string, docHits: KbSearchHit[], opts?: DecideOptions): RoutingDecision;
declare function decideFromHeuristics(message: string, docHits: KbSearchHit[], opts?: DecideOptions): RoutingDecision;

interface HttpRouterContext {
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
    github?: GitHubAdapter$1;
    email?: EmailNotifier;
    kbIngest?: KbIngestConfig;
    telegram?: CreateSupportRouterOptions["telegram"];
    codebase?: CodebaseAdapter;
    onLeadCaptured?: CreateSupportRouterOptions["onLeadCaptured"];
}
/**
 * Express-compatible support HTTP surface.
 */
declare function createHttpRouter(ctx: HttpRouterContext): SupportRouter;
/** Alias used by createSupportRouter in index.ts */
declare function createRouter(options: CreateSupportRouterOptions): SupportRouter;

type ProposalAction = "claim" | "steal" | "release" | "approve" | "send_reply" | "edit_send" | "reject" | "take_over" | "need_info";
type ProposalExecutorResult = {
    ok: true;
    result: "claimed" | "stolen" | "released" | "reply_sent" | "github_issue" | "rejected" | "needs_info" | "escalated" | "approved";
    proposal: Proposal;
    ticket?: Ticket;
    message?: unknown;
    doneLabel: string;
} | {
    ok: false;
    status: number;
    error: string;
    proposal?: Proposal | null | undefined;
    handledBy?: string | null | undefined;
};
interface TelegramMessageEditor {
    editProposalMessage(input: {
        chatId: string;
        messageId: string;
        text: string;
        replyMarkup?: {
            inline_keyboard?: Array<Array<{
                text: string;
                callback_data: string;
            }>>;
        } | null;
    }): Promise<unknown>;
    formatProposalMessage(input: {
        ticketPublicNumber: number;
        proposal: {
            id: string;
            proposalType: string;
            summary: string;
            bodyJson: string;
            confidence?: number | null;
            claimedBy?: string | null;
        };
        adminUrl?: string;
        claimLabel?: string | null;
        doneLabel?: string | null;
    }): string;
    proposalKeyboard(proposal: {
        id: string;
        proposalType: string;
        claimedBy?: string | null;
    }, opts?: {
        claimedBy?: string | null;
    }): {
        inline_keyboard?: Array<Array<{
            text: string;
            callback_data: string;
        }>>;
    };
}
interface ProposalExecutorDeps {
    tenantId: string;
    proposals: ProposalService;
    tickets: TicketService;
    brand: BrandConfig;
    github?: GitHubAdapter$1;
    email?: EmailNotifier;
    telegram?: TelegramMessageEditor;
    adminBaseUrl?: string;
}
/**
 * Shared proposal action executor for admin UI + Telegram webhook.
 * Side-effect actions use atomic status transition so only one winner runs.
 */
declare function executeProposalAction(deps: ProposalExecutorDeps, proposalId: string, actionRaw: string, reviewerId: string, opts?: {
    draftReply?: string;
    needInfoMessage?: string;
}): Promise<ProposalExecutorResult>;

type TelegramOpsRuntimeConfig = {
    botToken: string;
    chatId: string;
    webhookSecret: string;
    allowedUserIds: string[];
};
type ResolveTelegramConfig = () => TelegramOpsRuntimeConfig | null | Promise<TelegramOpsRuntimeConfig | null>;
type TelegramApi = {
    answerCallback(callbackQueryId: string, text: string): Promise<void>;
    sendForceReply(text: string, placeholder?: string): Promise<unknown>;
    sendText(text: string): Promise<unknown>;
    formatProposalMessage: TelegramMessageEditor["formatProposalMessage"];
    proposalKeyboard: TelegramMessageEditor["proposalKeyboard"];
    editProposalMessage: TelegramMessageEditor["editProposalMessage"];
};
type TelegramWebhookDeps = {
    tenantId: string;
    db: DbAdapter;
    brand: BrandConfig;
    tablePrefix?: string;
    resolveTelegram: ResolveTelegramConfig;
    /** Build Telegram API client from credentials (host/channels). */
    createTelegramApi: (cfg: TelegramOpsRuntimeConfig) => TelegramApi;
    github?: GitHubAdapter$1;
    email?: EmailNotifier;
    opsNotifier?: OpsNotifier;
    adminBaseUrl?: string;
};
type TelegramUpdate = {
    message?: {
        from?: {
            id?: number;
            username?: string;
            first_name?: string;
        };
        text?: string;
    };
    callback_query?: {
        id: string;
        from?: {
            id?: number;
            username?: string;
            first_name?: string;
        };
        data?: string;
    };
};
declare function verifyTelegramWebhookSecret(headerSecret: string | undefined, expected: string): boolean;
/**
 * Process a Telegram Bot API update (callback or message).
 * Caller should verify webhook secret and respond 200 before awaiting this.
 */
declare function handleTelegramUpdate(deps: TelegramWebhookDeps, update: TelegramUpdate): Promise<{
    ok: boolean;
    handled: boolean;
    error?: string;
}>;

type TelegramDraftSession = {
    telegramUserId: string;
    tenantId: string;
    proposalId: string;
    ticketId: string;
    publicNumber: number;
    createdAt: string;
    expiresAt: string;
};
declare class TelegramDraftSessionStore {
    private readonly db;
    private readonly tablePrefix;
    constructor(db: DbAdapter, tablePrefix?: string);
    private get t();
    start(telegramUserId: string, input: {
        tenantId: string;
        proposalId: string;
        ticketId: string;
        publicNumber: number;
        ttlMs?: number;
    }): Promise<TelegramDraftSession>;
    get(telegramUserId: string): Promise<TelegramDraftSession | undefined>;
    clear(telegramUserId: string): Promise<void>;
}

/**
 * Host entrypoint. Mount under a path prefix, e.g. app.use("/support", router.handler).
 * Schema is ensured lazily on first request via an internal ready promise.
 */
declare function createSupportRouter(options: CreateSupportRouterOptions): SupportRouter;

export { type CoachDraft, type CoachMessage, type CoachPriority, type CoachResult, type CodebaseAdapter, type CodebaseSearchHit, type GitHubAdapter as CoreGitHubAdapter, type CreateSupportRouterOptions, DEFAULT_ESCALATION_REPLY, DEFAULT_HOLD_REPLY, DEFAULT_TABLE_PREFIX, type DbAdapter, type EmailNotifier, type FilesystemCodebaseOptions, type GapResearchResult, type GitHubAdapter$1 as GitHubAdapter, type GitHubIssueInput, type GitHubIssueResult, type IngestCodegenArticleInput, type IngestDocSource, type IngestFromChangelogOptions, type KbIngestConfig, type KbSearchHit, KnowledgeGapService, KnowledgeGapStore, LeadService, LeadStore, type LlmAdapter, type LlmTriageParse, type OpsNotification, type OpsNotificationKind, type OpsNotifier, type PromoteTicketToKbInput, type ProposalAction, type ProposalExecutorDeps, type ProposalExecutorResult, ProposalService, ProposalStore, type ResolveTelegramConfig, type ResolveUser, type RoutingDecision, type SearchActiveArticlesOptions, type SearchCuratedDocsOptions, type SupportRouter, type TelegramDraftSession, TelegramDraftSessionStore, type TelegramMessageEditor, type TelegramOpsRuntimeConfig, type TelegramWebhookDeps, TicketService, TicketStore, type TriageDeps, type TriageInput, type TriageResult, clearDocsCache, coachFeatureRequest, containsEscalationSignal, createFilesystemCodebaseAdapter, createHttpRouter, createRouter, createSupportRouter, curateAnswerToKbDraft, decideFromHeuristics, decideFromLlm, deprecateKbArticle, ensureSchema, executeGithubFromProposal, executeProposalAction, formatSourcesForPrompt, getKbArticle, handleTelegramUpdate, inferKindTopic, ingestCodegenArticle, ingestDocsSources, ingestFromChangelog, listKbArticles, parseBugFeatureBody, promoteKbArticle, promoteTicketAnswerToKb, researchGapToKbDraft, searchActiveArticles, searchCuratedDocs, triageMessage, updateKbArticle, verifyTelegramWebhookSecret };
