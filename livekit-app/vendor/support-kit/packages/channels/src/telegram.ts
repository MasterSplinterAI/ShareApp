import type { OpsNotification, OpsNotifier } from "./index.js";

export type TelegramFetch = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json?: () => Promise<unknown> }>;

export interface TelegramOpsNotifierOptions {
  botToken: string;
  chatId: string;
  fetchImpl?: TelegramFetch;
}

export type TelegramInlineButton = { text: string; callback_data: string };
export type TelegramReplyMarkup = {
  inline_keyboard?: TelegramInlineButton[][];
  force_reply?: boolean;
  input_field_placeholder?: string;
};

export interface ProposalReadyNotifyInput {
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
}

export interface TelegramSendResult {
  ok: boolean;
  messageId?: string;
  chatId?: string;
  skipped?: boolean;
  error?: string;
}

export interface TelegramOpsClient extends OpsNotifier {
  notifyProposalReady(input: ProposalReadyNotifyInput): Promise<TelegramSendResult>;
  editProposalMessage(input: {
    chatId: string;
    messageId: string;
    text: string;
    replyMarkup?: TelegramReplyMarkup | null;
  }): Promise<TelegramSendResult>;
  answerCallback(callbackQueryId: string, text: string): Promise<void>;
  sendForceReply(text: string, placeholder?: string): Promise<TelegramSendResult>;
  sendText(text: string, replyMarkup?: TelegramReplyMarkup | null): Promise<TelegramSendResult>;
  formatProposalMessage(input: ProposalReadyNotifyInput): string;
  proposalKeyboard(
    proposal: { id: string; proposalType: string; claimedBy?: string | null },
    opts?: { claimedBy?: string | null },
  ): TelegramReplyMarkup;
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function kindEmoji(kind: OpsNotification["kind"]): string {
  if (kind === "ticket_created") return "🆘";
  if (kind === "proposal_ready") return "🤖";
  if (kind === "user_reply") return "📩";
  if (kind === "escalation") return "⚠️";
  if (kind === "kb_drafts_ready") return "📚";
  return "📢";
}

/** Format OpsNotification as Telegram HTML (mirrors ShareApp telegramSupport.js). */
export function formatTelegramOpsMessage(notification: OpsNotification): string {
  const num = notification.ticketPublicNumber;
  const emoji = kindEmoji(notification.kind);
  const lines: string[] = [];

  if (num != null) {
    lines.push(`${emoji} <b>${escapeHtml(notification.title)}</b> — ticket #${num}`);
  } else {
    lines.push(`${emoji} <b>${escapeHtml(notification.title)}</b>`);
  }

  if (notification.body) {
    const body = notification.body.slice(0, 3500);
    lines.push(escapeHtml(body) + (notification.body.length > 3500 ? "…" : ""));
  }

  if (notification.adminUrl) {
    lines.push(`<a href="${escapeHtml(notification.adminUrl)}">Open in admin</a>`);
  }

  return lines.join("\n");
}

function proposalTypeLabel(proposalType: string): string {
  if (proposalType === "bug_fix" || proposalType === "github_issue") return "Bug triage";
  if (proposalType === "feature") return "Feature backlog";
  if (proposalType === "reply") return "CS reply approval";
  if (proposalType === "escalate") return "Escalation";
  return proposalType;
}

function proposalPreviewSnippet(proposal: { proposalType: string; bodyJson: string }): string {
  let b: Record<string, unknown> = {};
  try {
    b = JSON.parse(proposal.bodyJson) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  if (proposal.proposalType === "feature") {
    return String(b.problem_statement || b.proposed_mvp || b.backlog_recommendation || "");
  }
  if (proposal.proposalType === "bug_fix" || proposal.proposalType === "github_issue") {
    return String(b.github_issue_title || b.root_cause_hypothesis || b.user_intent || "");
  }
  if (proposal.proposalType === "escalate") {
    return String(b.draft_reply || b.reason || b.escalation_reason || "");
  }
  return String(b.draft_reply || b.github_issue_title || b.problem_statement || "");
}

export function getDraftSeedForProposal(proposal: {
  proposalType: string;
  bodyJson: string;
}): string {
  let b: Record<string, unknown> = {};
  try {
    b = JSON.parse(proposal.bodyJson) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return String(
    b.draft_reply ||
      b.user_update ||
      b.need_info_message ||
      proposalPreviewSnippet(proposal) ||
      "",
  );
}

export function buildProposalKeyboard(
  proposal: { id: string; proposalType: string; claimedBy?: string | null },
  opts?: { claimedBy?: string | null },
): TelegramReplyMarkup {
  const id = proposal.id;
  const claimed = opts?.claimedBy ?? proposal.claimedBy;
  const claimRow: TelegramInlineButton[] = claimed
    ? [
        { text: "🔄 Steal claim", callback_data: `prop:${id}:steal` },
        { text: "🔓 Release", callback_data: `prop:${id}:release` },
      ]
    : [{ text: "✋ Claim", callback_data: `prop:${id}:claim` }];

  let actionRows: TelegramInlineButton[][] = [];
  const type = proposal.proposalType;

  if (type === "bug_fix" || type === "github_issue") {
    actionRows = [
      [
        { text: "✅ Approve → GitHub", callback_data: `prop:${id}:approve` },
        { text: "❌ Reject", callback_data: `prop:${id}:reject` },
      ],
      [{ text: "💬 Need info", callback_data: `prop:${id}:need_info` }],
    ];
  } else if (type === "feature") {
    actionRows = [
      [
        { text: "✅ Approve GitHub", callback_data: `prop:${id}:approve` },
        { text: "❌ Reject", callback_data: `prop:${id}:reject` },
      ],
      [{ text: "💬 Need info", callback_data: `prop:${id}:need_info` }],
    ];
  } else if (type === "escalate") {
    actionRows = [
      [
        { text: "✅ Send draft", callback_data: `prop:${id}:send_reply` },
        { text: "👤 Take over", callback_data: `prop:${id}:take_over` },
      ],
      [
        { text: "✏️ Edit draft", callback_data: `prop:${id}:draft_reply` },
        { text: "❌ Dismiss", callback_data: `prop:${id}:reject` },
      ],
    ];
  } else {
    // reply (default)
    actionRows = [
      [
        { text: "✅ Send draft", callback_data: `prop:${id}:send_reply` },
        { text: "✏️ Edit draft", callback_data: `prop:${id}:draft_reply` },
      ],
      [
        { text: "👤 Take over", callback_data: `prop:${id}:take_over` },
        { text: "❌ Reject", callback_data: `prop:${id}:reject` },
      ],
    ];
  }

  return { inline_keyboard: [claimRow, ...actionRows] };
}

export function formatProposalReadyMessage(input: ProposalReadyNotifyInput): string {
  const conf =
    typeof input.proposal.confidence === "number"
      ? `\n<b>Confidence:</b> ${Math.round(input.proposal.confidence * 100)}%`
      : "";
  const draft = proposalPreviewSnippet(input.proposal);
  const typeLabel = proposalTypeLabel(input.proposal.proposalType);
  const lines = [
    `🤖 <b>AI proposal</b> — ticket #${input.ticketPublicNumber}`,
    input.kindLabel
      ? `<b>Kind:</b> ${escapeHtml(input.kindLabel)} · <b>Action:</b> ${escapeHtml(typeLabel)}`
      : `<b>Action:</b> ${escapeHtml(typeLabel)}`,
    `<b>Summary:</b> ${escapeHtml(input.proposal.summary)}${conf}`,
  ];
  if (input.claimLabel) {
    lines.push(`🔒 <b>${escapeHtml(input.claimLabel)}</b>`);
  }
  if (input.doneLabel) {
    lines.push(`✅ <b>${escapeHtml(input.doneLabel)}</b>`);
  }
  if (draft && !input.doneLabel) {
    lines.push(
      `\n${escapeHtml(String(draft).slice(0, 600))}${String(draft).length > 600 ? "…" : ""}`,
    );
  }
  if (input.adminUrl) {
    lines.push(`\n<a href="${escapeHtml(input.adminUrl)}">Open in admin</a>`);
  }
  return lines.filter(Boolean).join("\n");
}

async function defaultTelegramFetch(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }> {
  const g = globalThis as {
    fetch?: (
      u: string,
      i?: { method?: string; headers?: Record<string, string>; body?: string },
    ) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;
  };
  if (!g.fetch) {
    throw new Error("createTelegramOpsNotifier: fetch unavailable; pass fetchImpl");
  }
  return g.fetch(url, init);
}

async function parseTelegramResult(
  res: { ok: boolean; status: number; text(): Promise<string> },
  chatId: string,
): Promise<TelegramSendResult> {
  const raw = await res.text().catch(() => "");
  if (!res.ok) {
    return { ok: false, error: `Telegram API ${res.status}: ${raw.slice(0, 300)}` };
  }
  try {
    const data = JSON.parse(raw) as { result?: { message_id?: number } };
    const mid = data.result?.message_id;
    if (mid != null) {
      return { ok: true, messageId: String(mid), chatId };
    }
    return { ok: true, chatId };
  } catch {
    return { ok: true, chatId };
  }
}

export function createTelegramOpsNotifier(
  options: TelegramOpsNotifierOptions,
): TelegramOpsClient {
  const fetchFn: TelegramFetch = options.fetchImpl ?? defaultTelegramFetch;
  const api = (method: string) => `https://api.telegram.org/bot${options.botToken}/${method}`;

  async function sendMessage(
    text: string,
    replyMarkup?: TelegramReplyMarkup | null,
    chatId = options.chatId,
  ): Promise<TelegramSendResult> {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: text.slice(0, 4096),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    const res = await fetchFn(api("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return parseTelegramResult(res, chatId);
  }

  const client: TelegramOpsClient = {
    async sendToOps(notification: OpsNotification): Promise<void> {
      // kb_drafts_ready and simple alerts: text only (no claim keyboard)
      const text = formatTelegramOpsMessage(notification).slice(0, 4096);
      const result = await sendMessage(text);
      if (!result.ok) {
        throw new Error(result.error || "Telegram sendMessage failed");
      }
    },

    formatProposalMessage(input) {
      return formatProposalReadyMessage(input);
    },

    proposalKeyboard(proposal, opts) {
      return buildProposalKeyboard(proposal, opts);
    },

    async notifyProposalReady(input): Promise<TelegramSendResult> {
      const text = formatProposalReadyMessage(input);
      const keyboard = input.doneLabel
        ? null
        : buildProposalKeyboard(input.proposal, {
            claimedBy: input.proposal.claimedBy ?? null,
          });
      return sendMessage(text, keyboard);
    },

    async editProposalMessage(input): Promise<TelegramSendResult> {
      const payload: Record<string, unknown> = {
        chat_id: input.chatId,
        message_id: Number(input.messageId),
        text: input.text.slice(0, 4096),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      };
      if (input.replyMarkup === null) {
        payload.reply_markup = { inline_keyboard: [] };
      } else if (input.replyMarkup) {
        payload.reply_markup = input.replyMarkup;
      }
      const res = await fetchFn(api("editMessageText"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return parseTelegramResult(res, input.chatId);
    },

    async answerCallback(callbackQueryId, text): Promise<void> {
      await fetchFn(api("answerCallbackQuery"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text: String(text || "").slice(0, 200),
          show_alert: false,
        }),
      });
    },

    async sendForceReply(text, placeholder = "Your reply to the user…"): Promise<TelegramSendResult> {
      return sendMessage(text, {
        force_reply: true,
        input_field_placeholder: placeholder,
      });
    },

    async sendText(text, replyMarkup): Promise<TelegramSendResult> {
      return sendMessage(text, replyMarkup ?? null);
    },
  };

  return client;
}

export { escapeHtml };
