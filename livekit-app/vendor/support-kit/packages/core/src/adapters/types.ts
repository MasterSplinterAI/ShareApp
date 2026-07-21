import type { BrandConfig, SupportUser, TenantId } from "@rhule/support-shared";

/**
 * Host-owned auth → kit user shape.
 * Kit never verifies tokens; host middleware runs first.
 */
export type ResolveUser = (req: unknown) => SupportUser | null | Promise<SupportUser | null>;

/**
 * Minimal SQL port so Postgres (LegalAI) and SQLite (ShareApp) both work.
 * Host implements; kit never opens its own pool.
 *
 * Use `?` placeholders; adapters should translate to `$1` for Postgres if needed.
 */
export interface DbAdapter {
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface LlmAdapter {
  complete(input: {
    system: string;
    user: string;
    temperature?: number;
  }): Promise<string>;
}

/** Host-provided product codebase access for gap research (LegalAI, ShareApp, …). */
export interface CodebaseSearchHit {
  path: string;
  snippet: string;
  score?: number;
}

export interface CodebaseAdapter {
  /** Display name in provenance, e.g. "LegalAI" or "ShareApp" */
  label?: string;
  search(
    query: string,
    opts?: { limit?: number },
  ): Promise<CodebaseSearchHit[]>;
  readFile(
    path: string,
    opts?: { maxBytes?: number },
  ): Promise<string | null>;
}

/** Thin duplicate of @rhule/support-channels OpsNotifier — keeps core independent. */
export type OpsNotificationKind =
  | "ticket_created"
  | "escalation"
  | "proposal_ready"
  | "user_reply"
  | "kb_drafts_ready";

export interface OpsNotification {
  kind: OpsNotificationKind;
  title: string;
  body: string;
  adminUrl?: string;
  ticketPublicNumber?: number;
}

export interface OpsNotifier {
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
  }): Promise<{ messageId?: string; chatId?: string; ok?: boolean } | void>;
}

export interface EmailNotifier {
  sendToUser(input: {
    to: string;
    subject: string;
    body: string;
    ticketPublicNumber?: number;
  }): Promise<void>;
}

export type GitHubAdapter = {
  createIssue: (input: {
    title: string;
    body: string;
    labels?: string[];
    kind: "bug" | "feature";
    ticketPublicNumber: number;
  }) => Promise<{ url: string; number?: number }>;
};

export interface KbIngestConfig {
  /** Allowlisted path prefixes/globs for docs ingest (informational; host enforces). */
  globs?: string[];
  /** Shared secret for CI ingest via X-Support-Ingest-Token header. */
  webhookSecret?: string;
}

/** Telegram soft-claim ops — webhook + allowlist. Credentials may be dynamic. */
export type TelegramOpsRuntimeConfig = {
  botToken: string;
  chatId: string;
  webhookSecret: string;
  allowedUserIds: string[];
};

export type ResolveTelegramConfig = () =>
  | TelegramOpsRuntimeConfig
  | null
  | Promise<TelegramOpsRuntimeConfig | null>;

export interface CreateSupportRouterOptions {
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
  github?: GitHubAdapter;
  email?: EmailNotifier;
  kbIngest?: KbIngestConfig;
  /**
   * Product codebase for ops-triggered KB gap research.
   * Hosts pass LegalAI / ShareApp / other allowlisted roots via createFilesystemCodebaseAdapter.
   */
  codebase?: CodebaseAdapter;
  /**
   * Telegram webhook + soft-claim. When set, mounts POST /telegram/webhook
   * (host typically mounts kit under /support → /support/telegram/webhook).
   */
  telegram?: {
    resolveConfig: ResolveTelegramConfig;
    /** Factory that wraps @rhule/support-channels createTelegramOpsNotifier. */
    createClient: (cfg: TelegramOpsRuntimeConfig) => {
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
      proposalKeyboard(
        proposal: { id: string; proposalType: string; claimedBy?: string | null },
        opts?: { claimedBy?: string | null },
      ): { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> };
      editProposalMessage(input: {
        chatId: string;
        messageId: string;
        text: string;
        replyMarkup?: { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> } | null;
      }): Promise<unknown>;
    };
  };
}

export interface SupportRouter {
  handler: (req: unknown, res: unknown, next?: unknown) => unknown;
  meta: { kitVersion: string; tenantId: string; shared: string };
}
