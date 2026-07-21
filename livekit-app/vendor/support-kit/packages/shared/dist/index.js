// src/enums.ts
import { z } from "zod";
var TenantIdSchema = z.string().min(1).brand();
var TicketKindSchema = z.enum(["support", "bug", "feature"]);
var DEFAULT_TOPICS = [
  "billing",
  "account",
  "how_to",
  "product",
  "access",
  "other"
];
var TicketTopicSchema = z.string().min(1);
var BugSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
var FeaturePrioritySchema = z.enum([
  "nice_to_have",
  "important",
  "critical"
]);
var TicketStatusSchema = z.enum([
  "open",
  "ai_working",
  "pending_ops",
  "waiting_user",
  "escalated",
  "resolved",
  "closed",
  /** @deprecated use waiting_user */
  "pending_user"
]);
var TicketCategorySchema = z.enum([
  "bug",
  "how_to",
  "billing",
  "feature",
  "other"
]);
var KbArticleStatusSchema = z.enum([
  "draft",
  "active",
  "deprecated"
]);
var KbSourceKindSchema = z.enum([
  "curated",
  "evolutionary",
  "codegen",
  /** Draft from ops-triggered codebase research of a knowledge gap */
  "code_research"
]);
var KbVisibilitySchema = z.enum(["public", "agent", "internal"]);
var ProposalStatusSchema = z.enum([
  "pending_review",
  "approved",
  "rejected",
  "needs_info",
  "executed"
]);
var ProposalTypeSchema = z.enum([
  "reply",
  "escalate",
  "bug_fix",
  "feature",
  "kb_article",
  /** @deprecated use bug_fix / feature */
  "github_issue",
  /** @deprecated */
  "other"
]);
var GapStatusSchema = z.enum(["open", "resolved", "dismissed"]);
var SENSITIVE_TOPICS_DEFAULT = ["billing", "access"];
function mapCategoryToKindTopic(category) {
  switch (category) {
    case "bug":
      return { kind: "bug", topic: "other" };
    case "feature":
      return { kind: "feature", topic: "product" };
    case "billing":
      return { kind: "support", topic: "billing" };
    case "how_to":
      return { kind: "support", topic: "how_to" };
    case "other":
    default:
      return { kind: "support", topic: "other" };
  }
}
function mapKindTopicToCategory(kind, topic) {
  if (kind === "bug") return "bug";
  if (kind === "feature") return "feature";
  if (topic === "billing") return "billing";
  if (topic === "how_to") return "how_to";
  return "other";
}
function normalizeTicketStatus(status) {
  if (status === "pending_user") return "waiting_user";
  return TicketStatusSchema.parse(status);
}

// src/ticket.ts
import { z as z2 } from "zod";
var MessageAuthorTypeSchema = z2.enum([
  "user",
  "assistant",
  "staff",
  "system",
  /** @deprecated use assistant */
  "agent",
  /** @deprecated use staff */
  "ops"
]);
function normalizeAuthorType(authorType) {
  if (authorType === "agent") return "assistant";
  if (authorType === "ops") return "staff";
  return authorType;
}
var TicketSchema = z2.object({
  id: z2.string().min(1),
  tenantId: TenantIdSchema,
  publicNumber: z2.number().int().positive(),
  kind: TicketKindSchema.optional(),
  topic: TicketTopicSchema.optional(),
  /** @deprecated use kind + topic */
  category: TicketCategorySchema.optional(),
  status: TicketStatusSchema,
  subject: z2.string().nullable().optional(),
  severity: BugSeveritySchema.or(z2.string()).nullable().optional(),
  priority: FeaturePrioritySchema.or(z2.string()).nullable().optional(),
  userId: z2.string().nullable().optional(),
  orgId: z2.string().nullable().optional(),
  guestEmail: z2.string().email().nullable().optional(),
  contextJson: z2.string().nullable().optional(),
  duplicateOfTicketId: z2.string().nullable().optional(),
  assignedTo: z2.string().nullable().optional(),
  githubIssueUrl: z2.string().url().nullable().optional(),
  createdAt: z2.string().min(1),
  updatedAt: z2.string().min(1),
  closedAt: z2.string().nullable().optional()
}).transform((t) => {
  const kind = t.kind ?? (t.category ? mapCategoryToKindTopic(t.category).kind : "support");
  const topic = t.topic ?? (t.category ? mapCategoryToKindTopic(t.category).topic : "other");
  const category = t.category ?? mapKindTopicToCategory(kind, topic);
  return { ...t, kind, topic, category };
});
var TicketMessageSchema = z2.object({
  id: z2.string().min(1),
  tenantId: TenantIdSchema,
  ticketId: z2.string().min(1),
  authorType: MessageAuthorTypeSchema,
  authorId: z2.string().nullable().optional(),
  body: z2.string().min(1),
  attachmentsJson: z2.string().nullable().optional(),
  /** KB sources used for this message (JSON array of {source, title?}). */
  citationJson: z2.string().nullable().optional(),
  createdAt: z2.string().min(1)
});
var CreateTicketInputSchema = z2.object({
  tenantId: TenantIdSchema,
  kind: TicketKindSchema.optional(),
  topic: TicketTopicSchema.optional(),
  /** @deprecated use kind + topic */
  category: TicketCategorySchema.optional(),
  subject: z2.string().optional(),
  body: z2.string().min(1),
  userId: z2.string().optional(),
  orgId: z2.string().optional(),
  guestEmail: z2.string().email().optional(),
  severity: z2.string().optional(),
  priority: z2.string().optional(),
  contextJson: z2.string().optional(),
  status: TicketStatusSchema.optional()
});
function normalizeCreateTicketInput(input) {
  let kind = input.kind;
  let topic = input.topic;
  if (!kind || !topic) {
    if (input.category) {
      const mapped = mapCategoryToKindTopic(input.category);
      kind = kind ?? mapped.kind;
      topic = topic ?? mapped.topic;
    } else {
      kind = kind ?? "support";
      topic = topic ?? "other";
    }
  }
  const category = input.category ?? mapKindTopicToCategory(kind, topic);
  return { ...input, kind, topic, category };
}

// src/proposal.ts
import { z as z3 } from "zod";
var ProposalSchema = z3.object({
  id: z3.string().min(1),
  tenantId: TenantIdSchema,
  ticketId: z3.string().min(1),
  proposalType: ProposalTypeSchema,
  status: ProposalStatusSchema,
  summary: z3.string().min(1),
  bodyJson: z3.string().min(1),
  confidence: z3.number().min(0).max(1).nullable().optional(),
  telegramMessageId: z3.string().nullable().optional(),
  telegramChatId: z3.string().nullable().optional(),
  claimedBy: z3.string().nullable().optional(),
  claimedAt: z3.string().nullable().optional(),
  reviewedBy: z3.string().nullable().optional(),
  reviewedAt: z3.string().nullable().optional(),
  executionStatus: z3.string().nullable().optional(),
  executionRef: z3.string().nullable().optional(),
  createdAt: z3.string().min(1)
});
var KnowledgeGapSchema = z3.object({
  id: z3.string().min(1),
  tenantId: TenantIdSchema,
  ticketId: z3.string().min(1),
  publicNumber: z3.number().int().positive().nullable().optional(),
  userQuestion: z3.string().min(1),
  escalationReason: z3.string().nullable().optional(),
  docQuery: z3.string().nullable().optional(),
  docHitsJson: z3.string().nullable().optional(),
  proposalId: z3.string().nullable().optional(),
  proposalType: ProposalTypeSchema.nullable().optional(),
  summary: z3.string().nullable().optional(),
  status: GapStatusSchema,
  createdAt: z3.string().min(1),
  resolvedAt: z3.string().nullable().optional()
});
var CreateProposalInputSchema = z3.object({
  tenantId: TenantIdSchema,
  ticketId: z3.string().min(1),
  proposalType: ProposalTypeSchema,
  summary: z3.string().min(1),
  bodyJson: z3.string().min(1),
  confidence: z3.number().min(0).max(1).optional()
});
var RecordKnowledgeGapInputSchema = z3.object({
  tenantId: TenantIdSchema,
  ticketId: z3.string().min(1),
  proposalId: z3.string().optional(),
  proposalType: ProposalTypeSchema.optional(),
  summary: z3.string().optional(),
  escalationReason: z3.string().optional(),
  docQuery: z3.string().optional(),
  docHitsJson: z3.string().optional(),
  userQuestion: z3.string().optional()
});

// src/kb.ts
import { z as z4 } from "zod";
var KbArticleSchema = z4.object({
  id: z4.string().min(1),
  tenantId: TenantIdSchema,
  title: z4.string().min(1),
  body: z4.string().min(1),
  status: KbArticleStatusSchema,
  sourceKind: KbSourceKindSchema,
  /** public | agent | internal — default agent */
  visibility: KbVisibilitySchema.default("agent"),
  /** Provenance for codegen: git SHA, file path, etc. */
  provenanceJson: z4.string().nullable().optional(),
  /** Stable key for upsert (e.g. codegen path or curated slug). */
  sourceKey: z4.string().nullable().optional(),
  createdAt: z4.string().min(1),
  updatedAt: z4.string().min(1)
});

// src/user.ts
import { z as z5 } from "zod";
var SupportUserSchema = z5.object({
  id: z5.string().min(1),
  email: z5.string().email().optional(),
  name: z5.string().optional(),
  role: z5.enum(["user", "admin", "ops"]).default("user"),
  orgId: z5.string().optional(),
  /** Short plan/access label for UI (e.g. "Pro · trial"). */
  planLabel: z5.string().optional(),
  /**
   * Host-built snapshot for the agent (plan, limits, role).
   * Injected into triage prompts — do not invent different plan details.
   */
  contextSummary: z5.string().optional()
});
var BrandConfigSchema = z5.object({
  name: z5.string().min(1),
  accentColor: z5.string().optional(),
  logoUrl: z5.string().url().optional(),
  supportAgentName: z5.string().default("Support"),
  agentAuthorId: z5.string().default("support-ai"),
  /**
   * Optional host hint appended to the feature-request coach system prompt
   * (product vocabulary, audiences, out-of-scope topics). Keep generic hosts empty.
   */
  featureCoachSystemHint: z5.string().max(4e3).optional()
});

// src/index.ts
var PACKAGE_NAME = "@rhule/support-shared";
var KIT_VERSION = "0.1.0";
export {
  BrandConfigSchema,
  BugSeveritySchema,
  CreateProposalInputSchema,
  CreateTicketInputSchema,
  DEFAULT_TOPICS,
  FeaturePrioritySchema,
  GapStatusSchema,
  KIT_VERSION,
  KbArticleSchema,
  KbArticleStatusSchema,
  KbSourceKindSchema,
  KbVisibilitySchema,
  KnowledgeGapSchema,
  MessageAuthorTypeSchema,
  PACKAGE_NAME,
  ProposalSchema,
  ProposalStatusSchema,
  ProposalTypeSchema,
  RecordKnowledgeGapInputSchema,
  SENSITIVE_TOPICS_DEFAULT,
  SupportUserSchema,
  TenantIdSchema,
  TicketCategorySchema,
  TicketKindSchema,
  TicketMessageSchema,
  TicketSchema,
  TicketStatusSchema,
  TicketTopicSchema,
  mapCategoryToKindTopic,
  mapKindTopicToCategory,
  normalizeAuthorType,
  normalizeCreateTicketInput,
  normalizeTicketStatus
};
