// src/telegram.ts
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function kindEmoji(kind) {
  if (kind === "ticket_created") return "\u{1F198}";
  if (kind === "proposal_ready") return "\u{1F916}";
  if (kind === "user_reply") return "\u{1F4E9}";
  if (kind === "escalation") return "\u26A0\uFE0F";
  if (kind === "kb_drafts_ready") return "\u{1F4DA}";
  return "\u{1F4E2}";
}
function formatTelegramOpsMessage(notification) {
  const num = notification.ticketPublicNumber;
  const emoji = kindEmoji(notification.kind);
  const lines = [];
  if (num != null) {
    lines.push(`${emoji} <b>${escapeHtml(notification.title)}</b> \u2014 ticket #${num}`);
  } else {
    lines.push(`${emoji} <b>${escapeHtml(notification.title)}</b>`);
  }
  if (notification.body) {
    const body = notification.body.slice(0, 3500);
    lines.push(escapeHtml(body) + (notification.body.length > 3500 ? "\u2026" : ""));
  }
  if (notification.adminUrl) {
    lines.push(`<a href="${escapeHtml(notification.adminUrl)}">Open in admin</a>`);
  }
  return lines.join("\n");
}
function proposalTypeLabel(proposalType) {
  if (proposalType === "bug_fix" || proposalType === "github_issue") return "Bug triage";
  if (proposalType === "feature") return "Feature backlog";
  if (proposalType === "reply") return "CS reply approval";
  if (proposalType === "escalate") return "Escalation";
  return proposalType;
}
function proposalPreviewSnippet(proposal) {
  let b = {};
  try {
    b = JSON.parse(proposal.bodyJson);
  } catch {
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
function getDraftSeedForProposal(proposal) {
  let b = {};
  try {
    b = JSON.parse(proposal.bodyJson);
  } catch {
  }
  return String(
    b.draft_reply || b.user_update || b.need_info_message || proposalPreviewSnippet(proposal) || ""
  );
}
function buildProposalKeyboard(proposal, opts) {
  const id = proposal.id;
  const claimed = opts?.claimedBy ?? proposal.claimedBy;
  const claimRow = claimed ? [
    { text: "\u{1F504} Steal claim", callback_data: `prop:${id}:steal` },
    { text: "\u{1F513} Release", callback_data: `prop:${id}:release` }
  ] : [{ text: "\u270B Claim", callback_data: `prop:${id}:claim` }];
  let actionRows = [];
  const type = proposal.proposalType;
  if (type === "bug_fix" || type === "github_issue") {
    actionRows = [
      [
        { text: "\u2705 Approve \u2192 GitHub", callback_data: `prop:${id}:approve` },
        { text: "\u274C Reject", callback_data: `prop:${id}:reject` }
      ],
      [{ text: "\u{1F4AC} Need info", callback_data: `prop:${id}:need_info` }]
    ];
  } else if (type === "feature") {
    actionRows = [
      [
        { text: "\u2705 Approve GitHub", callback_data: `prop:${id}:approve` },
        { text: "\u274C Reject", callback_data: `prop:${id}:reject` }
      ],
      [{ text: "\u{1F4AC} Need info", callback_data: `prop:${id}:need_info` }]
    ];
  } else if (type === "escalate") {
    actionRows = [
      [
        { text: "\u2705 Send draft", callback_data: `prop:${id}:send_reply` },
        { text: "\u{1F464} Take over", callback_data: `prop:${id}:take_over` }
      ],
      [
        { text: "\u270F\uFE0F Edit draft", callback_data: `prop:${id}:draft_reply` },
        { text: "\u274C Dismiss", callback_data: `prop:${id}:reject` }
      ]
    ];
  } else {
    actionRows = [
      [
        { text: "\u2705 Send draft", callback_data: `prop:${id}:send_reply` },
        { text: "\u270F\uFE0F Edit draft", callback_data: `prop:${id}:draft_reply` }
      ],
      [
        { text: "\u{1F464} Take over", callback_data: `prop:${id}:take_over` },
        { text: "\u274C Reject", callback_data: `prop:${id}:reject` }
      ]
    ];
  }
  return { inline_keyboard: [claimRow, ...actionRows] };
}
function formatProposalReadyMessage(input) {
  const conf = typeof input.proposal.confidence === "number" ? `
<b>Confidence:</b> ${Math.round(input.proposal.confidence * 100)}%` : "";
  const draft = proposalPreviewSnippet(input.proposal);
  const typeLabel = proposalTypeLabel(input.proposal.proposalType);
  const lines = [
    `\u{1F916} <b>AI proposal</b> \u2014 ticket #${input.ticketPublicNumber}`,
    input.kindLabel ? `<b>Kind:</b> ${escapeHtml(input.kindLabel)} \xB7 <b>Action:</b> ${escapeHtml(typeLabel)}` : `<b>Action:</b> ${escapeHtml(typeLabel)}`,
    `<b>Summary:</b> ${escapeHtml(input.proposal.summary)}${conf}`
  ];
  if (input.claimLabel) {
    lines.push(`\u{1F512} <b>${escapeHtml(input.claimLabel)}</b>`);
  }
  if (input.doneLabel) {
    lines.push(`\u2705 <b>${escapeHtml(input.doneLabel)}</b>`);
  }
  if (draft && !input.doneLabel) {
    lines.push(
      `
${escapeHtml(String(draft).slice(0, 600))}${String(draft).length > 600 ? "\u2026" : ""}`
    );
  }
  if (input.adminUrl) {
    lines.push(`
<a href="${escapeHtml(input.adminUrl)}">Open in admin</a>`);
  }
  return lines.filter(Boolean).join("\n");
}
async function defaultTelegramFetch(url, init) {
  const g = globalThis;
  if (!g.fetch) {
    throw new Error("createTelegramOpsNotifier: fetch unavailable; pass fetchImpl");
  }
  return g.fetch(url, init);
}
async function parseTelegramResult(res, chatId) {
  const raw = await res.text().catch(() => "");
  if (!res.ok) {
    return { ok: false, error: `Telegram API ${res.status}: ${raw.slice(0, 300)}` };
  }
  try {
    const data = JSON.parse(raw);
    const mid = data.result?.message_id;
    if (mid != null) {
      return { ok: true, messageId: String(mid), chatId };
    }
    return { ok: true, chatId };
  } catch {
    return { ok: true, chatId };
  }
}
function createTelegramOpsNotifier(options) {
  const fetchFn = options.fetchImpl ?? defaultTelegramFetch;
  const api = (method) => `https://api.telegram.org/bot${options.botToken}/${method}`;
  async function sendMessage(text, replyMarkup, chatId = options.chatId) {
    const payload = {
      chat_id: chatId,
      text: text.slice(0, 4096),
      parse_mode: "HTML",
      disable_web_page_preview: true
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    const res = await fetchFn(api("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return parseTelegramResult(res, chatId);
  }
  const client = {
    async sendToOps(notification) {
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
    async notifyProposalReady(input) {
      const text = formatProposalReadyMessage(input);
      const keyboard = input.doneLabel ? null : buildProposalKeyboard(input.proposal, {
        claimedBy: input.proposal.claimedBy ?? null
      });
      return sendMessage(text, keyboard);
    },
    async editProposalMessage(input) {
      const payload = {
        chat_id: input.chatId,
        message_id: Number(input.messageId),
        text: input.text.slice(0, 4096),
        parse_mode: "HTML",
        disable_web_page_preview: true
      };
      if (input.replyMarkup === null) {
        payload.reply_markup = { inline_keyboard: [] };
      } else if (input.replyMarkup) {
        payload.reply_markup = input.replyMarkup;
      }
      const res = await fetchFn(api("editMessageText"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      return parseTelegramResult(res, input.chatId);
    },
    async answerCallback(callbackQueryId, text) {
      await fetchFn(api("answerCallbackQuery"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text: String(text || "").slice(0, 200),
          show_alert: false
        })
      });
    },
    async sendForceReply(text, placeholder = "Your reply to the user\u2026") {
      return sendMessage(text, {
        force_reply: true,
        input_field_placeholder: placeholder
      });
    },
    async sendText(text, replyMarkup) {
      return sendMessage(text, replyMarkup ?? null);
    }
  };
  return client;
}

// src/index.ts
function createNoopOpsNotifier() {
  return {
    async sendToOps() {
    }
  };
}
export {
  buildProposalKeyboard,
  createNoopOpsNotifier,
  createTelegramOpsNotifier,
  escapeHtml,
  formatProposalReadyMessage,
  formatTelegramOpsMessage,
  getDraftSeedForProposal
};
