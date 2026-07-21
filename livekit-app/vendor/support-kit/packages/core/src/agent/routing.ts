import type { KbSearchHit } from "../kb/search.js";
import type { ProposalType, TicketKind } from "@rhule/support-shared";
import { SENSITIVE_TOPICS_DEFAULT } from "@rhule/support-shared";

export type AgentRoute = "reply_in_app" | "propose_reply" | "escalate" | "close";

export interface LlmTriageParse {
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

export interface RoutingDecision {
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

const ESCALATION_KEYWORDS = [
  "chargeback",
  "billing dispute",
  "invoice dispute",
  "lawyer",
  "legal action",
  "delete my data",
  "gdpr",
  "subpoena",
  "harassment",
  "account hacked",
];

const BUG_KEYWORDS = ["bug", "broken", "crash", "error", "not working", "failed"];
const HOW_TO_KEYWORDS = ["how", "where", "what is", "how do", "how can", "help me"];
const FEATURE_KEYWORDS = ["feature", "request", "would be nice", "add support for", "wishlist"];

export const DEFAULT_HOLD_REPLY =
  "Thanks for your patience — I'm still looking into this. If I can't resolve it here, a teammate will follow up in this same chat.";

export const DEFAULT_ESCALATION_REPLY =
  "I've shared this with our team for a closer look. You'll see updates here — we typically respond within one business day.";

const KB_SCORE_THRESHOLD = 2;
const MIN_CONFIDENCE_WITH_KB = 0.65;
const MIN_CONFIDENCE_NO_KB = 0.85;
const HIGH_CONFIDENCE = 0.92;

export function containsEscalationSignal(text: string): boolean {
  const lower = String(text || "").toLowerCase();
  return ESCALATION_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function looksLikeHowTo(message: string): boolean {
  const lower = message.toLowerCase();
  return HOW_TO_KEYWORDS.some((k) => lower.includes(k));
}

export function inferKindTopic(
  message: string,
  topicAllowlist: string[] = [...SENSITIVE_TOPICS_DEFAULT, "how_to", "product", "account", "other"],
): { kind: TicketKind; topic: string } {
  const lower = message.toLowerCase();
  if (BUG_KEYWORDS.some((k) => lower.includes(k))) {
    return { kind: "bug", topic: "other" };
  }
  if (FEATURE_KEYWORDS.some((k) => lower.includes(k))) {
    return { kind: "feature", topic: "product" };
  }
  let topic = "other";
  if (lower.includes("bill") || lower.includes("invoice") || lower.includes("payment") || lower.includes("refund")) {
    topic = "billing";
  } else if (lower.includes("login") || lower.includes("password") || lower.includes("access") || lower.includes("permission")) {
    topic = "access";
  } else if (looksLikeHowTo(message)) {
    topic = "how_to";
  } else if (lower.includes("account") || lower.includes("plan") || lower.includes("upgrade")) {
    topic = "account";
  }
  if (!topicAllowlist.includes(topic)) topic = "other";
  return { kind: "support", topic };
}

/** @deprecated use inferKindTopic */
export function inferCategory(message: string): string {
  const { kind, topic } = inferKindTopic(message);
  if (kind === "bug") return "bug";
  if (kind === "feature") return "feature";
  if (topic === "billing") return "billing";
  if (topic === "how_to") return "how_to";
  return "other";
}

function minConfidence(docHits: KbSearchHit[]): number {
  return docHits.length > 0 ? MIN_CONFIDENCE_WITH_KB : MIN_CONFIDENCE_NO_KB;
}

function topKbScore(hits: KbSearchHit[]): number {
  return hits.length > 0 ? Math.max(...hits.map((h) => h.score)) : 0;
}

function extractDraft(parsed: LlmTriageParse): string {
  const body = parsed.body && typeof parsed.body === "object" ? parsed.body : {};
  return String(body.draft_reply || "").trim();
}

function inferRoute(parsed: LlmTriageParse): AgentRoute {
  if (parsed.route) return parsed.route;
  if (parsed.proposal_type === "escalation" || parsed.proposal_type === "escalate") return "escalate";
  return "propose_reply";
}

function isSensitiveTopic(topic: string, sensitiveTopics: string[]): boolean {
  return sensitiveTopics.includes(topic);
}

export interface DecideOptions {
  topicAllowlist?: string[];
  sensitiveTopics?: string[];
  autoReplyMinConfidence?: number;
}

export function decideFromLlm(
  parsed: LlmTriageParse,
  message: string,
  docHits: KbSearchHit[],
  opts: DecideOptions = {},
): RoutingDecision {
  const sensitive = opts.sensitiveTopics ?? [...SENSITIVE_TOPICS_DEFAULT];
  const allowlist = opts.topicAllowlist;
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  const route = inferRoute(parsed);
  const draft = extractDraft(parsed);
  const inferred = inferKindTopic(message, allowlist);
  const kind = parsed.kind ?? inferred.kind;
  let topic = parsed.topic ?? inferred.topic;
  if (allowlist && !allowlist.includes(topic)) topic = "other";

  if (kind === "bug") {
    return {
      action: "propose",
      kind: "bug",
      topic,
      proposalType: "bug_fix",
      confidence,
      summary: parsed.summary || "Bug report",
      draftReply: draft || DEFAULT_HOLD_REPLY,
      recordGap: true,
    };
  }

  if (kind === "feature") {
    return {
      action: "propose",
      kind: "feature",
      topic: topic === "other" ? "product" : topic,
      proposalType: "feature",
      confidence,
      summary: parsed.summary || "Feature request",
      draftReply: draft || DEFAULT_HOLD_REPLY,
      recordGap: false,
    };
  }

  if (containsEscalationSignal(message) || containsEscalationSignal(parsed.body?.escalation_reason ?? "")) {
    return {
      action: "escalate",
      kind: "support",
      topic,
      proposalType: "escalate",
      confidence,
      summary: parsed.summary || "Escalation requested",
      draftReply: draft || DEFAULT_ESCALATION_REPLY,
      recordGap: true,
    };
  }

  if (route === "close") {
    return {
      action: "auto_reply",
      kind: "support",
      topic,
      proposalType: "reply",
      confidence,
      summary: parsed.summary || "Resolved",
      draftReply: draft || "Glad that helped! Let us know if anything else comes up.",
      recordGap: false,
      resolveAfterReply: true,
    };
  }

  if (route === "escalate" || isSensitiveTopic(topic, sensitive)) {
    return {
      action: "escalate",
      kind: "support",
      topic,
      proposalType: "escalate",
      confidence,
      summary: parsed.summary || (isSensitiveTopic(topic, sensitive) ? `Sensitive topic: ${topic}` : "Escalation"),
      draftReply: draft || DEFAULT_ESCALATION_REPLY,
      recordGap: true,
    };
  }

  const threshold = opts.autoReplyMinConfidence ?? minConfidence(docHits);
  if (
    route === "reply_in_app" &&
    draft &&
    confidence >= threshold &&
    (docHits.length > 0 || confidence >= HIGH_CONFIDENCE)
  ) {
    return {
      action: "auto_reply",
      kind: "support",
      topic,
      proposalType: "reply",
      confidence,
      summary: parsed.summary || "KB answer",
      draftReply: draft,
      recordGap: false,
    };
  }

  if (
    route === "propose_reply" &&
    draft &&
    confidence >= threshold &&
    docHits.length > 0 &&
    topic === "how_to"
  ) {
    return {
      action: "auto_reply",
      kind: "support",
      topic,
      proposalType: "reply",
      confidence,
      summary: parsed.summary || "KB answer",
      draftReply: draft,
      recordGap: false,
    };
  }

  return {
    action: "propose",
    kind: "support",
    topic,
    proposalType: "reply",
    confidence,
    summary: parsed.summary || "Needs human review",
    draftReply: draft || DEFAULT_HOLD_REPLY,
    recordGap: docHits.length === 0 || confidence < MIN_CONFIDENCE_WITH_KB,
  };
}

export function decideFromHeuristics(
  message: string,
  docHits: KbSearchHit[],
  opts: DecideOptions = {},
): RoutingDecision {
  const sensitive = opts.sensitiveTopics ?? [...SENSITIVE_TOPICS_DEFAULT];
  const { kind, topic } = inferKindTopic(message, opts.topicAllowlist);
  const topScore = topKbScore(docHits);

  if (kind === "bug") {
    return {
      action: "propose",
      kind: "bug",
      topic,
      proposalType: "bug_fix",
      confidence: 0.4,
      summary: "Bug report",
      draftReply: DEFAULT_HOLD_REPLY,
      recordGap: true,
    };
  }

  if (kind === "feature") {
    return {
      action: "propose",
      kind: "feature",
      topic,
      proposalType: "feature",
      confidence: 0.4,
      summary: "Feature request",
      draftReply: DEFAULT_HOLD_REPLY,
      recordGap: false,
    };
  }

  if (containsEscalationSignal(message) || isSensitiveTopic(topic, sensitive)) {
    return {
      action: "escalate",
      kind: "support",
      topic: topic === "other" && containsEscalationSignal(message) ? "billing" : topic,
      proposalType: "escalate",
      confidence: 0.5,
      summary: "Escalation keyword or sensitive topic",
      draftReply: DEFAULT_ESCALATION_REPLY,
      recordGap: true,
    };
  }

  if (looksLikeHowTo(message) && topScore >= KB_SCORE_THRESHOLD) {
    const excerpt = docHits[0]?.excerpt ?? "";
    return {
      action: "auto_reply",
      kind: "support",
      topic: topic === "other" ? "how_to" : topic,
      proposalType: "reply",
      confidence: Math.min(0.7 + topScore * 0.05, 0.95),
      summary: "KB heuristic match",
      draftReply: excerpt.slice(0, 800) || DEFAULT_HOLD_REPLY,
      recordGap: false,
    };
  }

  if (topScore < KB_SCORE_THRESHOLD) {
    return {
      action: "propose",
      kind: "support",
      topic,
      proposalType: "reply",
      confidence: topScore > 0 ? 0.4 : 0.2,
      summary: "Low KB confidence",
      draftReply: DEFAULT_HOLD_REPLY,
      recordGap: true,
    };
  }

  return {
    action: "propose",
    kind: "support",
    topic,
    proposalType: "reply",
    confidence: 0.5,
    summary: "Default triage",
    draftReply: DEFAULT_HOLD_REPLY,
    recordGap: false,
  };
}
