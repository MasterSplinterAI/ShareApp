import type { BrandConfig } from "@rhule/support-shared";
import type {
  EmailNotifier,
  GitHubAdapter,
  OpsNotifier,
} from "../adapters/types.js";
import type { DbAdapter } from "../adapters/types.js";
import { DEFAULT_TABLE_PREFIX } from "../db/migrate.js";
import { ProposalService } from "../proposals/service.js";
import { TicketService } from "../tickets/service.js";
import {
  executeProposalAction,
  type TelegramMessageEditor,
} from "../proposals/executor.js";
import { TelegramDraftSessionStore } from "./draftSessions.js";

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

type TelegramApi = {
  answerCallback(callbackQueryId: string, text: string): Promise<void>;
  sendForceReply(text: string, placeholder?: string): Promise<unknown>;
  sendText(text: string): Promise<unknown>;
  formatProposalMessage: TelegramMessageEditor["formatProposalMessage"];
  proposalKeyboard: TelegramMessageEditor["proposalKeyboard"];
  editProposalMessage: TelegramMessageEditor["editProposalMessage"];
};

export type TelegramWebhookDeps = {
  tenantId: string;
  db: DbAdapter;
  brand: BrandConfig;
  tablePrefix?: string;
  resolveTelegram: ResolveTelegramConfig;
  /** Build Telegram API client from credentials (host/channels). */
  createTelegramApi: (cfg: TelegramOpsRuntimeConfig) => TelegramApi;
  github?: GitHubAdapter;
  email?: EmailNotifier;
  opsNotifier?: OpsNotifier;
  adminBaseUrl?: string;
};

type TelegramUpdate = {
  message?: {
    from?: { id?: number; username?: string; first_name?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from?: { id?: number; username?: string; first_name?: string };
    data?: string;
  };
};

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseCallbackData(data: string | undefined): { proposalId: string; action: string } | null {
  if (!data || !data.startsWith("prop:")) return null;
  const parts = data.split(":");
  if (parts.length < 3) return null;
  return { proposalId: parts[1]!, action: parts.slice(2).join(":") };
}

function reviewerLabel(from: { id?: number; username?: string; first_name?: string } | undefined): string {
  if (from?.username) return `@${from.username}`;
  if (from?.first_name) return from.first_name;
  return `telegram:${from?.id ?? "unknown"}`;
}

function isAllowed(cfg: TelegramOpsRuntimeConfig, userId: number | undefined): boolean {
  if (userId == null) return false;
  if (!cfg.allowedUserIds.length) return false;
  return cfg.allowedUserIds.includes(String(userId));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function verifyTelegramWebhookSecret(
  headerSecret: string | undefined,
  expected: string,
): boolean {
  const got = String(headerSecret || "").trim();
  const want = String(expected || "").trim();
  if (!want || !got) return false;
  return timingSafeEqual(got, want);
}

async function getDraftSeed(bodyJson: string, proposalType: string): Promise<string> {
  try {
    const b = JSON.parse(bodyJson) as Record<string, unknown>;
    return String(
      b.draft_reply ||
        b.user_update ||
        b.need_info_message ||
        b.user_intent ||
        b.problem_statement ||
        "",
    );
  } catch {
    return proposalType;
  }
}

async function startDraftReply(
  deps: TelegramWebhookDeps,
  cfg: TelegramOpsRuntimeConfig,
  api: TelegramApi,
  proposalId: string,
  telegramUserId: number,
  from: { id?: number; username?: string; first_name?: string } | undefined,
  callbackQueryId: string,
): Promise<void> {
  const tablePrefix = deps.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const proposals = new ProposalService(deps.db, tablePrefix);
  const tickets = new TicketService(deps.db, tablePrefix);
  const drafts = new TelegramDraftSessionStore(deps.db, tablePrefix);

  const proposal = await proposals.getProposal(deps.tenantId, proposalId);
  if (!proposal || (proposal.status !== "pending_review" && proposal.status !== "needs_info")) {
    await api.answerCallback(callbackQueryId, proposal ? `Already ${proposal.status}` : "Not found");
    return;
  }

  const ticket = await tickets.getTicket(deps.tenantId, proposal.ticketId);
  if (!ticket) {
    await api.answerCallback(callbackQueryId, "Ticket not found");
    return;
  }

  const reviewer = reviewerLabel(from);
  await proposals.setClaim(deps.tenantId, proposal.id, reviewer);
  await tickets.setAssignedTo(deps.tenantId, ticket.id, reviewer);

  const claimed = (await proposals.getProposal(deps.tenantId, proposal.id)) ?? proposal;
  if (claimed.telegramMessageId && claimed.telegramChatId) {
    const proposalView = {
      id: claimed.id,
      proposalType: claimed.proposalType,
      summary: claimed.summary,
      bodyJson: claimed.bodyJson,
      confidence: claimed.confidence ?? null,
      claimedBy: reviewer,
    };
    await api.editProposalMessage({
      chatId: claimed.telegramChatId,
      messageId: claimed.telegramMessageId,
      text: api.formatProposalMessage({
        ticketPublicNumber: ticket.publicNumber,
        proposal: proposalView,
        claimLabel: `Claimed by ${reviewer}`,
      }),
      replyMarkup: api.proposalKeyboard(proposalView, { claimedBy: reviewer }),
    });
  }

  await drafts.start(String(telegramUserId), {
    tenantId: deps.tenantId,
    proposalId: proposal.id,
    ticketId: ticket.id,
    publicNumber: ticket.publicNumber,
  });

  const seed = await getDraftSeed(proposal.bodyJson, proposal.proposalType);
  const conf =
    typeof proposal.confidence === "number"
      ? `\n<b>AI confidence:</b> ${Math.round(proposal.confidence * 100)}%`
      : "";
  const lines = [
    `✏️ <b>Draft reply</b> — ticket #${ticket.publicNumber}${conf}`,
    "Reply to this chat with the message the user should see.",
    seed
      ? `\n<b>AI starting point:</b>\n${escapeHtml(String(seed).slice(0, 1200))}${String(seed).length > 1200 ? "…" : ""}`
      : "\nWrite your reply from scratch.",
    "\nSend /cancel to abort.",
  ];

  await api.sendForceReply(lines.join("\n"));
  await api.answerCallback(callbackQueryId, "Reply in chat with your draft");
}

async function submitDraft(
  deps: TelegramWebhookDeps,
  cfg: TelegramOpsRuntimeConfig,
  api: TelegramApi,
  telegramUserId: number,
  from: { id?: number; username?: string; first_name?: string } | undefined,
  text: string,
): Promise<void> {
  const tablePrefix = deps.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const drafts = new TelegramDraftSessionStore(deps.db, tablePrefix);
  const session = await drafts.get(String(telegramUserId));
  if (!session) return;

  const body = text.trim();
  if (!body) {
    await api.sendText("Reply cannot be empty. Send your message or /cancel.");
    return;
  }

  const proposals = new ProposalService(deps.db, tablePrefix);
  const tickets = new TicketService(deps.db, tablePrefix);
  const reviewer = reviewerLabel(from);

  const result = await executeProposalAction(
    {
      tenantId: deps.tenantId,
      proposals,
      tickets,
      brand: deps.brand,
      telegram: api,
      ...(deps.github ? { github: deps.github } : {}),
      ...(deps.email ? { email: deps.email } : {}),
      ...(deps.adminBaseUrl ? { adminBaseUrl: deps.adminBaseUrl } : {}),
    },
    session.proposalId,
    "edit_send",
    reviewer,
    { draftReply: body },
  );

  await drafts.clear(String(telegramUserId));

  if (!result.ok) {
    await api.sendText(`Could not send reply: ${escapeHtml(result.error)}`);
    return;
  }

  await api.sendText(
    `✅ <b>Reply sent</b> to ticket #${session.publicNumber}\n${escapeHtml(body.slice(0, 500))}${body.length > 500 ? "…" : ""}`,
  );
}

async function cancelDraft(
  deps: TelegramWebhookDeps,
  api: TelegramApi,
  telegramUserId: number,
  from: { id?: number; username?: string; first_name?: string } | undefined,
): Promise<void> {
  const tablePrefix = deps.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const drafts = new TelegramDraftSessionStore(deps.db, tablePrefix);
  const session = await drafts.get(String(telegramUserId));
  if (!session) {
    await api.sendText("No draft in progress.");
    return;
  }

  const proposals = new ProposalService(deps.db, tablePrefix);
  const tickets = new TicketService(deps.db, tablePrefix);
  const proposal = await proposals.getProposal(deps.tenantId, session.proposalId);
  const reviewer = reviewerLabel(from);

  // Soft-unclaim if they only claimed for draft
  if (proposal?.claimedBy === reviewer || proposal?.claimedBy === `telegram:${telegramUserId}`) {
    await proposals.setClaim(deps.tenantId, session.proposalId, null);
    await tickets.setAssignedTo(deps.tenantId, session.ticketId, null);
    if (proposal.telegramMessageId && proposal.telegramChatId) {
      const ticket = await tickets.getTicket(deps.tenantId, session.ticketId);
      if (ticket) {
        const cleared = {
          id: proposal.id,
          proposalType: proposal.proposalType,
          summary: proposal.summary,
          bodyJson: proposal.bodyJson,
          confidence: proposal.confidence ?? null,
          claimedBy: null as string | null,
        };
        await api.editProposalMessage({
          chatId: proposal.telegramChatId,
          messageId: proposal.telegramMessageId,
          text: api.formatProposalMessage({
            ticketPublicNumber: ticket.publicNumber,
            proposal: cleared,
          }),
          replyMarkup: api.proposalKeyboard(cleared, { claimedBy: null }),
        });
      }
    }
  }

  await drafts.clear(String(telegramUserId));
  await api.sendText(`Draft cancelled for ticket #${session.publicNumber}.`);
}

/**
 * Process a Telegram Bot API update (callback or message).
 * Caller should verify webhook secret and respond 200 before awaiting this.
 */
export async function handleTelegramUpdate(
  deps: TelegramWebhookDeps,
  update: TelegramUpdate,
): Promise<{ ok: boolean; handled: boolean; error?: string }> {
  const cfg = await deps.resolveTelegram();
  if (!cfg?.botToken || !cfg.webhookSecret || !cfg.allowedUserIds.length) {
    return { ok: false, handled: false, error: "Telegram ops not configured" };
  }

  const api = deps.createTelegramApi(cfg);
  const tablePrefix = deps.tablePrefix ?? DEFAULT_TABLE_PREFIX;

  if (update.message) {
    const fromId = update.message.from?.id;
    if (!isAllowed(cfg, fromId)) {
      return { ok: false, handled: false, error: "Unauthorized Telegram user" };
    }
    const text = update.message.text?.trim();
    if (!text) return { ok: true, handled: false };

    if (text === "/cancel" || text.toLowerCase() === "cancel") {
      await cancelDraft(deps, api, fromId!, update.message.from);
      return { ok: true, handled: true };
    }

    const drafts = new TelegramDraftSessionStore(deps.db, tablePrefix);
    const session = await drafts.get(String(fromId));
    if (!session) return { ok: true, handled: false };

    await submitDraft(deps, cfg, api, fromId!, update.message.from, text);
    return { ok: true, handled: true };
  }

  const cb = update.callback_query;
  if (!cb) return { ok: true, handled: false };

  const fromId = cb.from?.id;
  if (!isAllowed(cfg, fromId)) {
    await api.answerCallback(cb.id, "Not authorized");
    return { ok: false, handled: true, error: "Unauthorized Telegram user" };
  }

  const parsed = parseCallbackData(cb.data);
  if (!parsed) {
    await api.answerCallback(cb.id, "Unknown action");
    return { ok: false, handled: true, error: "Invalid callback_data" };
  }

  if (parsed.action === "draft_reply") {
    await startDraftReply(deps, cfg, api, parsed.proposalId, fromId!, cb.from, cb.id);
    return { ok: true, handled: true };
  }

  const drafts = new TelegramDraftSessionStore(deps.db, tablePrefix);
  await drafts.clear(String(fromId));

  const proposals = new ProposalService(deps.db, tablePrefix);
  const tickets = new TicketService(deps.db, tablePrefix);
  const reviewer = reviewerLabel(cb.from);

  const result = await executeProposalAction(
    {
      tenantId: deps.tenantId,
      proposals,
      tickets,
      brand: deps.brand,
      telegram: api,
      ...(deps.github ? { github: deps.github } : {}),
      ...(deps.email ? { email: deps.email } : {}),
      ...(deps.adminBaseUrl ? { adminBaseUrl: deps.adminBaseUrl } : {}),
    },
    parsed.proposalId,
    parsed.action,
    reviewer,
  );

  if (!result.ok) {
    await api.answerCallback(cb.id, result.error.slice(0, 200));
    return { ok: false, handled: true, error: result.error };
  }

  await api.answerCallback(cb.id, result.doneLabel.slice(0, 200));
  return { ok: true, handled: true };
}
