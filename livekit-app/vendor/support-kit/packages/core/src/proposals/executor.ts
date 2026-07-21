import type { Proposal, ProposalType, Ticket } from "@rhule/support-shared";
import type { BrandConfig } from "@rhule/support-shared";
import type {
  EmailNotifier,
  GitHubAdapter,
} from "../adapters/types.js";
import { executeGithubFromProposal } from "../github/executor.js";
import { ProposalService } from "./service.js";
import { TicketService } from "../tickets/service.js";

export type ProposalAction =
  | "claim"
  | "steal"
  | "release"
  | "approve"
  | "send_reply"
  | "edit_send"
  | "reject"
  | "take_over"
  | "need_info";

export type ProposalExecutorResult =
  | {
      ok: true;
      result:
        | "claimed"
        | "stolen"
        | "released"
        | "reply_sent"
        | "github_issue"
        | "rejected"
        | "needs_info"
        | "escalated"
        | "approved";
      proposal: Proposal;
      ticket?: Ticket;
      message?: unknown;
      doneLabel: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
      proposal?: Proposal | null | undefined;
      handledBy?: string | null | undefined;
    };

export interface TelegramMessageEditor {
  editProposalMessage(input: {
    chatId: string;
    messageId: string;
    text: string;
    replyMarkup?: { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> } | null;
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
  proposalKeyboard(
    proposal: { id: string; proposalType: string; claimedBy?: string | null },
    opts?: { claimedBy?: string | null },
  ): { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> };
}

export interface ProposalExecutorDeps {
  tenantId: string;
  proposals: ProposalService;
  tickets: TicketService;
  brand: BrandConfig;
  github?: GitHubAdapter;
  email?: EmailNotifier;
  telegram?: TelegramMessageEditor;
  adminBaseUrl?: string;
}

function parseProposalBody(bodyJson: string): {
  draft_reply?: string;
  need_info_prompt?: string;
  need_info_message?: string;
} {
  try {
    return JSON.parse(bodyJson) as {
      draft_reply?: string;
      need_info_prompt?: string;
      need_info_message?: string;
    };
  } catch {
    return {};
  }
}

function normalizeAction(action: string): ProposalAction | null {
  const a = String(action || "").toLowerCase();
  if (a === "approve" || a === "issue" || a === "approve_backlog") return "approve";
  if (a === "send_reply" || a === "send") return "send_reply";
  if (a === "edit_send") return "edit_send";
  if (a === "reject" || a === "dismiss") return "reject";
  if (a === "need_info") return "need_info";
  if (a === "take_over" || a === "assign_me") return "take_over";
  if (a === "claim") return "claim";
  if (a === "steal" || a === "steal_claim") return "steal";
  if (a === "release") return "release";
  return null;
}

function notifyEmail(
  email: EmailNotifier | undefined,
  ticket: Ticket,
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

function adminTicketUrl(adminBaseUrl: string | undefined, publicNumber: number): string | undefined {
  if (!adminBaseUrl) return undefined;
  const base = adminBaseUrl.trim().replace(/\/$/, "");
  return `${base}?ticket=${publicNumber}`;
}

function alreadyHandled(existing: Proposal | undefined): ProposalExecutorResult {
  const out: ProposalExecutorResult = {
    ok: false,
    status: 409,
    error: `Already handled by ${existing?.reviewedBy ?? existing?.status ?? "another op"}`,
  };
  if (existing) out.proposal = existing;
  if (existing?.reviewedBy != null) out.handledBy = existing.reviewedBy;
  return out;
}

async function refreshTelegramMessage(
  deps: ProposalExecutorDeps,
  proposal: Proposal,
  ticket: Ticket,
  opts: { claimLabel?: string | null; doneLabel?: string | null; clearKeyboard?: boolean },
): Promise<void> {
  if (!deps.telegram) return;
  const chatId = proposal.telegramChatId;
  const messageId = proposal.telegramMessageId;
  if (!chatId || !messageId) return;

  const proposalView = {
    id: proposal.id,
    proposalType: proposal.proposalType,
    summary: proposal.summary,
    bodyJson: proposal.bodyJson,
    confidence: proposal.confidence ?? null,
    claimedBy: proposal.claimedBy ?? null,
  };

  const adminUrl = adminTicketUrl(deps.adminBaseUrl, ticket.publicNumber);
  const text = deps.telegram.formatProposalMessage({
    ticketPublicNumber: ticket.publicNumber,
    proposal: proposalView,
    ...(adminUrl ? { adminUrl } : {}),
    claimLabel: opts.claimLabel ?? null,
    doneLabel: opts.doneLabel ?? null,
  });

  const replyMarkup =
    opts.clearKeyboard || opts.doneLabel
      ? null
      : deps.telegram.proposalKeyboard(proposalView, {
          claimedBy: proposalView.claimedBy,
        });

  try {
    await deps.telegram.editProposalMessage({
      chatId,
      messageId,
      text,
      replyMarkup,
    });
  } catch {
    /* best-effort edit */
  }
}

async function softClaim(
  deps: ProposalExecutorDeps,
  proposal: Proposal,
  ticket: Ticket,
  reviewer: string,
  mode: "claim" | "steal",
): Promise<ProposalExecutorResult> {
  const claimed = await deps.proposals.setClaim(deps.tenantId, proposal.id, reviewer);
  await deps.tickets.setAssignedTo(deps.tenantId, ticket.id, reviewer);
  const next = claimed ?? (await deps.proposals.getProposal(deps.tenantId, proposal.id))!;
  const label = reviewer.startsWith("@") ? reviewer : reviewer.replace(/^telegram:/, "@");
  await refreshTelegramMessage(deps, next, ticket, {
    claimLabel: `Claimed by ${label}`,
  });
  return {
    ok: true,
    result: mode === "steal" ? "stolen" : "claimed",
    proposal: next,
    ticket,
    doneLabel: mode === "steal" ? `Stolen by ${label}` : `Claimed by ${label}`,
  };
}

/**
 * Shared proposal action executor for admin UI + Telegram webhook.
 * Side-effect actions use atomic status transition so only one winner runs.
 */
export async function executeProposalAction(
  deps: ProposalExecutorDeps,
  proposalId: string,
  actionRaw: string,
  reviewerId: string,
  opts?: { draftReply?: string; needInfoMessage?: string },
): Promise<ProposalExecutorResult> {
  const act = normalizeAction(actionRaw);
  if (!act) {
    return { ok: false, status: 400, error: `Invalid action: ${actionRaw}` };
  }

  const proposal = await deps.proposals.getProposal(deps.tenantId, proposalId);
  if (!proposal) {
    return { ok: false, status: 404, error: "Proposal not found" };
  }

  let ticket = await deps.tickets.getTicket(deps.tenantId, proposal.ticketId);
  if (!ticket) {
    return { ok: false, status: 404, error: "Ticket not found" };
  }

  const reviewer = String(reviewerId || "unknown");

  if (act === "claim" || act === "steal") {
    return softClaim(deps, proposal, ticket, reviewer, act === "steal" ? "steal" : "claim");
  }

  if (act === "release") {
    if (proposal.claimedBy && proposal.claimedBy !== reviewer) {
      // allowlisted override: still allow release from any ops actor
    }
    const cleared = await deps.proposals.setClaim(deps.tenantId, proposal.id, null);
    await deps.tickets.setAssignedTo(deps.tenantId, ticket.id, null);
    const next = cleared ?? proposal;
    await refreshTelegramMessage(deps, { ...next, claimedBy: null }, ticket, {
      claimLabel: null,
    });
    return {
      ok: true,
      result: "released",
      proposal: next,
      ticket,
      doneLabel: "Claim released",
    };
  }

  // Take over: soft-claim + reject proposal + escalate ticket (atomic reject)
  if (act === "take_over") {
    await deps.proposals.setClaim(deps.tenantId, proposal.id, reviewer);
    await deps.tickets.setAssignedTo(deps.tenantId, ticket.id, reviewer);
    const rejected = await deps.proposals.tryAtomicTransition(
      deps.tenantId,
      proposal.id,
      "rejected",
      reviewer,
    );
    if (!rejected) {
      const existing = await deps.proposals.getProposal(deps.tenantId, proposal.id);
      return alreadyHandled(existing);
    }
    const next = await deps.tickets.setStatus(deps.tenantId, ticket.id, "escalated");
    if (next) ticket = next;
    const label = reviewer.replace(/^telegram:/, "@");
    await refreshTelegramMessage(deps, rejected, ticket, {
      doneLabel: `Done by ${label} — took over`,
      clearKeyboard: true,
    });
    return {
      ok: true,
      result: "escalated",
      proposal: rejected,
      ticket,
      doneLabel: `Took over by ${label}`,
    };
  }

  if (act === "reject") {
    const rejected = await deps.proposals.tryAtomicTransition(
      deps.tenantId,
      proposal.id,
      "rejected",
      reviewer,
    );
    if (!rejected) {
      const existing = await deps.proposals.getProposal(deps.tenantId, proposal.id);
      return alreadyHandled(existing);
    }
    const label = reviewer.replace(/^telegram:/, "@");
    await refreshTelegramMessage(deps, rejected, ticket, {
      doneLabel: `Done by ${label} — rejected`,
      clearKeyboard: true,
    });
    return {
      ok: true,
      result: "rejected",
      proposal: rejected,
      ticket,
      doneLabel: `Rejected by ${label}`,
    };
  }

  if (act === "need_info") {
    const prompt =
      String(opts?.needInfoMessage ?? "").trim() ||
      parseProposalBody(proposal.bodyJson).need_info_message ||
      parseProposalBody(proposal.bodyJson).need_info_prompt ||
      "Could you share a bit more detail so we can help?";

    const marked = await deps.proposals.tryAtomicTransition(
      deps.tenantId,
      proposal.id,
      "needs_info",
      reviewer,
    );
    if (!marked) {
      const existing = await deps.proposals.getProposal(deps.tenantId, proposal.id);
      return alreadyHandled(existing);
    }

    const message = await deps.tickets.addMessage(deps.tenantId, proposal.ticketId, prompt, {
      authorType: "staff",
      authorId: reviewer,
    });
    const next = await deps.tickets.setStatus(deps.tenantId, proposal.ticketId, "waiting_user");
    if (next) ticket = next;
    notifyEmail(deps.email, ticket, prompt, deps.brand.name);
    const label = reviewer.replace(/^telegram:/, "@");
    await refreshTelegramMessage(deps, marked, ticket, {
      doneLabel: `Done by ${label} — asked for info`,
      clearKeyboard: true,
    });
    return {
      ok: true,
      result: "needs_info",
      proposal: marked,
      ticket,
      message,
      doneLabel: `Need info by ${label}`,
    };
  }

  // approve / send_reply / edit_send
  const editedReply = String(opts?.draftReply ?? "").trim();
  const approved = await deps.proposals.tryAtomicTransition(
    deps.tenantId,
    proposal.id,
    "approved",
    reviewer,
  );
  if (!approved) {
    const existing = await deps.proposals.getProposal(deps.tenantId, proposal.id);
    return alreadyHandled(existing);
  }

  const label = reviewer.replace(/^telegram:/, "@");
  let message;
  const type = proposal.proposalType as ProposalType;

  if (type === "bug_fix" || type === "feature" || type === "github_issue") {
    if (!deps.github) {
      return {
        ok: false,
        status: 400,
        error: "GitHub adapter not configured for bug/feature approval",
        proposal: approved,
      };
    }
    const gh = await executeGithubFromProposal(deps.github, {
      proposalType: type,
      bodyJson: proposal.bodyJson,
      summary: proposal.summary,
      ticketPublicNumber: ticket.publicNumber,
    });
    ticket = (await deps.tickets.setGithubIssueUrl(deps.tenantId, ticket.id, gh.url)) ?? ticket;
    const userUpdate =
      editedReply ||
      parseProposalBody(proposal.bodyJson).draft_reply ||
      `We've logged this as ${gh.url}. We'll update you here.`;
    message = await deps.tickets.addMessage(deps.tenantId, proposal.ticketId, userUpdate, {
      authorType: "staff",
      authorId: reviewer,
    });
    const nextStatus = type === "feature" ? "open" : "waiting_user";
    const next = await deps.tickets.setStatus(deps.tenantId, proposal.ticketId, nextStatus);
    if (next) ticket = next;
    notifyEmail(deps.email, ticket, userUpdate, deps.brand.name);
    await refreshTelegramMessage(deps, approved, ticket, {
      doneLabel: `Done by ${label} — GitHub ${gh.url}`,
      clearKeyboard: true,
    });
    return {
      ok: true,
      result: "github_issue",
      proposal: approved,
      ticket,
      message,
      doneLabel: `Approved by ${label} — GitHub issue`,
    };
  }

  const parsed = parseProposalBody(proposal.bodyJson);
  const draft = editedReply || parsed.draft_reply?.trim();
  if (draft) {
    message = await deps.tickets.addMessage(deps.tenantId, proposal.ticketId, draft, {
      authorType: "assistant",
      authorId: deps.brand.agentAuthorId ?? "support-ai",
    });
    const next = await deps.tickets.setStatus(deps.tenantId, proposal.ticketId, "waiting_user");
    if (next) ticket = next;
    notifyEmail(deps.email, ticket, draft, deps.brand.name);
  }

  await refreshTelegramMessage(deps, approved, ticket, {
    doneLabel: draft
      ? `Done by ${label} — reply sent`
      : `Done by ${label} — approved`,
    clearKeyboard: true,
  });

  return {
    ok: true,
    result: draft ? "reply_sent" : "approved",
    proposal: approved,
    ticket,
    message,
    doneLabel: draft ? `Reply sent by ${label}` : `Approved by ${label}`,
  };
}
