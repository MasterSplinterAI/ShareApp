import type {
  BrandConfig,
  SupportUser,
  Ticket,
  TicketMessage,
  Proposal,
  KnowledgeGap,
} from "@rhule/support-shared";
import { DEFAULT_TOPICS, SENSITIVE_TOPICS_DEFAULT } from "@rhule/support-shared";
import type { DbAdapter, LlmAdapter, OpsNotification, OpsNotifier } from "../adapters/types.js";
import { DEFAULT_TABLE_PREFIX } from "../db/migrate.js";
import { KnowledgeGapService } from "../gaps/service.js";
import { ProposalService } from "../proposals/service.js";
import { TicketService } from "../tickets/service.js";
import {
  formatSourcesForPrompt,
  searchCuratedDocs,
  type KbSearchHit,
} from "../kb/search.js";
import {
  decideFromHeuristics,
  decideFromLlm,
  type DecideOptions,
  type LlmTriageParse,
  type RoutingDecision,
} from "./routing.js";

export interface TriageInput {
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

export interface TriageDeps {
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

export type TriageResult = {
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

function buildSystemPrompt(brand: BrandConfig, topics: string[]): string {
  return `You are ${brand.supportAgentName} for ${brand.name} support triage. Output ONLY valid JSON (no markdown fences).

Classify the user message and decide routing:
- reply_in_app — confident how-to answer from knowledge base; include draft_reply in body
- propose_reply — answer needs human approval (sensitive, uncertain, or complex)
- escalate — billing disputes, legal, abuse, account compromise
- close — user confirmed resolved

When User context is provided, treat plan tier, subscription status, AI usage/budget, matter counts, and storage as ground truth for this session. You MAY answer non-sensitive account questions from that context (e.g. "what plan am I on?", "how much AI budget left?", "how many matters can I create?"). Do NOT invent Stripe invoices, card numbers, or payment methods. Escalate refunds, chargebacks, account takeover, and payment failures.

In draft_reply, use normal Markdown: hyphen bullets ("- item"), **bold** for labels, short paragraphs. Do not use leading ". " as bullets.

JSON shape:
{
  "route": "reply_in_app|propose_reply|escalate|close",
  "kind": "support|bug|feature",
  "topic": "${topics.join("|")}",
  "proposal_type": "reply|escalate|bug_fix|feature",
  "summary": "one line for ops",
  "confidence": 0.0-1.0,
  "body": { "draft_reply": "customer-facing reply", "sources": ["doc paths"], "escalation_reason": null }
}

Never invent product features not in the knowledge base. If unsure, use propose_reply with a helpful draft_reply.
When user context (plan/role) is provided, tailor draft_reply to that plan — never claim a different plan.`;
}

function formatReply(draft: string, brand: BrandConfig): string {
  const trimmed = draft.trim();
  if (!trimmed) return `— ${brand.supportAgentName}`;
  if (trimmed.includes(brand.supportAgentName)) return trimmed;
  return `${trimmed}\n\n— ${brand.supportAgentName}`;
}

function appendUserContext(parts: string[], user: SupportUser): void {
  if (user.contextSummary?.trim()) {
    parts.push(
      "",
      "User context (tailor answers — do not invent a different plan or role):",
      user.contextSummary.trim(),
    );
  }
}

function buildAdminTicketUrl(
  adminBaseUrl: string | undefined,
  publicNumber: number,
): string | undefined {
  if (!adminBaseUrl) return undefined;
  const base = adminBaseUrl.trim().replace(/\/$/, "");
  return `${base}?ticket=${publicNumber}`;
}

function notifyOps(deps: TriageDeps, notification: OpsNotification): void {
  if (!deps.opsNotifier) return;
  deps.opsNotifier.sendToOps(notification).catch(() => {
    /* fire-and-forget */
  });
}

function parseLlmJson(raw: string): LlmTriageParse {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned) as LlmTriageParse;
}

function decideOpts(deps: TriageDeps): DecideOptions {
  const opts: DecideOptions = {
    topicAllowlist: deps.topics ?? [...DEFAULT_TOPICS],
    sensitiveTopics: deps.sensitiveTopics ?? [...SENSITIVE_TOPICS_DEFAULT],
  };
  if (deps.autoReplyMinConfidence !== undefined) {
    opts.autoReplyMinConfidence = deps.autoReplyMinConfidence;
  }
  return opts;
}

async function callLlm(
  llm: LlmAdapter,
  brand: BrandConfig,
  message: string,
  docHits: KbSearchHit[],
  user: SupportUser,
  topics: string[],
): Promise<LlmTriageParse | null> {
  try {
    const parts = [
      "Knowledge base excerpts:",
      formatSourcesForPrompt(docHits),
      "",
      "User message:",
      message,
    ];
    appendUserContext(parts, user);
    const raw = await llm.complete({
      system: buildSystemPrompt(brand, topics),
      user: parts.join("\n"),
      temperature: 0.2,
    });
    return parseLlmJson(raw);
  } catch {
    return null;
  }
}

async function resolveDecision(
  deps: TriageDeps,
  message: string,
  docHits: KbSearchHit[],
  user: SupportUser,
  forced?: { kind?: TriageInput["kind"]; topic?: string },
): Promise<RoutingDecision> {
  const opts = decideOpts(deps);
  let decision: RoutingDecision;
  if (deps.llm) {
    const parsed = await callLlm(
      deps.llm,
      deps.brand,
      message,
      docHits,
      user,
      opts.topicAllowlist ?? [...DEFAULT_TOPICS],
    );
    decision = parsed
      ? decideFromLlm(parsed, message, docHits, opts)
      : decideFromHeuristics(message, docHits, opts);
  } else {
    decision = decideFromHeuristics(message, docHits, opts);
  }

  if (forced?.kind) {
    decision = { ...decision, kind: forced.kind };
    if (forced.kind === "bug") {
      decision.action = "propose";
      decision.proposalType = "bug_fix";
    } else if (forced.kind === "feature") {
      decision.action = "propose";
      decision.proposalType = "feature";
    }
  }
  if (forced?.topic) {
    decision = { ...decision, topic: forced.topic };
  }
  return decision;
}

function citationsJson(docHits: KbSearchHit[]): string {
  return JSON.stringify(
    docHits.map((h) => ({ source: h.source, title: h.title, score: h.score })),
  );
}

/**
 * Triage a user chat message. Always creates (or continues) an auditable ticket.
 */
export async function triageMessage(
  deps: TriageDeps,
  input: TriageInput,
): Promise<TriageResult> {
  const prefix = deps.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const docHits = deps.docsRoot
    ? searchCuratedDocs(input.message, { docsRoot: deps.docsRoot, limit: 5 })
    : [];

  const decision = await resolveDecision(deps, input.message, docHits, input.user, {
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.topic ? { topic: input.topic } : {}),
  });

  const tickets = new TicketService(deps.db, prefix);
  const proposals = new ProposalService(deps.db, prefix);
  const gaps = new KnowledgeGapService(deps.db, prefix);

  const initialStatus =
    decision.action === "auto_reply"
      ? decision.resolveAfterReply
        ? "resolved"
        : "waiting_user"
      : decision.action === "escalate"
        ? "escalated"
        : "pending_ops";

  const createInput: Parameters<TicketService["createTicket"]>[0] = {
    tenantId: input.tenantId as never,
    kind: decision.kind,
    topic: decision.topic,
    body: input.message,
    userId: input.user.id,
    subject: input.message.slice(0, 200),
    status: "ai_working",
    contextJson: JSON.stringify({
      planLabel: input.user.planLabel ?? null,
      contextSummary: input.user.contextSummary ?? null,
      email: input.user.email ?? input.guestEmail ?? null,
      role: input.user.role,
      publicAudience: Boolean(deps.publicAudience),
      ...(input.leadContext
        ? {
            leadId: input.leadContext.leadId,
            name: input.leadContext.name,
            phone: input.leadContext.phone ?? null,
            marketingOptIn: Boolean(input.leadContext.marketingOptIn),
          }
        : {}),
    }),
  };
  if (input.user.orgId) createInput.orgId = input.user.orgId;
  if (input.guestEmail) createInput.guestEmail = input.guestEmail;

  const { ticket, message: userMessage } = await tickets.createTicket(createInput);

  const autoReplied = decision.action === "auto_reply";
  const citationJson = docHits.length > 0 ? citationsJson(docHits) : null;

  const agentMessage = await tickets.addMessage(
    input.tenantId,
    ticket.id,
    decision.draftReply,
    {
      authorType: "assistant",
      authorId: deps.brand.agentAuthorId,
      citationJson,
    },
  );

  await tickets.setStatus(input.tenantId, ticket.id, initialStatus);

  let proposal: Proposal | undefined;
  if (!autoReplied) {
    const bodyJson = JSON.stringify({
      draft_reply: decision.draftReply,
      sources: docHits.map((h) => h.source),
      user_intent: input.message.slice(0, 500),
      kind: decision.kind,
      topic: decision.topic,
    });

    proposal = await proposals.createProposal({
      tenantId: input.tenantId as never,
      ticketId: ticket.id,
      proposalType: decision.proposalType,
      summary: decision.summary,
      bodyJson,
      confidence: decision.confidence,
    });
  }

  let gap: KnowledgeGap | undefined;
  if (decision.recordGap) {
    gap = await gaps.recordKnowledgeGap({
      tenantId: input.tenantId as never,
      ticketId: ticket.id,
      proposalId: proposal?.id,
      proposalType: decision.proposalType,
      summary: decision.summary,
      docQuery: input.message,
      docHitsJson: JSON.stringify(docHits),
      userQuestion: input.message,
    });
  }

  const updated = await tickets.getTicket(input.tenantId, ticket.id);
  const adminUrl = buildAdminTicketUrl(deps.adminBaseUrl, ticket.publicNumber);

  // Suppress noisy new-ticket notify when AI auto-handled support
  if (!autoReplied) {
    const ticketNotification: OpsNotification = {
      kind: decision.action === "escalate" ? "escalation" : "ticket_created",
      title: `${decision.kind} ticket #${ticket.publicNumber}`,
      body: decision.summary || input.message.slice(0, 500),
      ticketPublicNumber: ticket.publicNumber,
    };
    if (adminUrl) ticketNotification.adminUrl = adminUrl;
    notifyOps(deps, ticketNotification);

  if (proposal) {
      const proposalNotification: OpsNotification = {
        kind: "proposal_ready",
        title: `AI proposal — ticket #${ticket.publicNumber}`,
        body: proposal.summary,
        ticketPublicNumber: ticket.publicNumber,
      };
      if (adminUrl) proposalNotification.adminUrl = adminUrl;

      if (deps.opsNotifier?.notifyProposalReady) {
        deps.opsNotifier
          .notifyProposalReady({
            ticketPublicNumber: ticket.publicNumber,
            proposal: {
              id: proposal.id,
              proposalType: proposal.proposalType,
              summary: proposal.summary,
              bodyJson: proposal.bodyJson,
              confidence: proposal.confidence ?? null,
              claimedBy: proposal.claimedBy ?? null,
            },
            kindLabel: decision.kind,
            ...(adminUrl ? { adminUrl } : {}),
          })
          .then(async (result) => {
            if (result?.messageId) {
              await proposals.setTelegramMeta(input.tenantId, proposal.id, {
                telegramMessageId: result.messageId,
                telegramChatId: result.chatId ?? "",
              });
            }
          })
          .catch(() => {
            /* fire-and-forget */
          });
      } else {
        notifyOps(deps, proposalNotification);
      }
    }
  }

  const result: TriageResult = {
    action: "ticket",
    reply: formatReply(decision.draftReply, deps.brand),
    ticket: updated ?? ticket,
    message: userMessage,
    agentMessage,
    confidence: decision.confidence,
    autoReplied,
    sources: docHits,
  };
  if (proposal) result.proposal = proposal;
  if (gap) result.gap = gap;
  return result;
}
