"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  BrandConfigSchema: () => BrandConfigSchema,
  BugSeveritySchema: () => BugSeveritySchema,
  CreateLeadInputSchema: () => CreateLeadInputSchema,
  CreateProposalInputSchema: () => CreateProposalInputSchema,
  CreateTicketInputSchema: () => CreateTicketInputSchema,
  DEFAULT_MARKETING_CONSENT_LABEL: () => DEFAULT_MARKETING_CONSENT_LABEL,
  DEFAULT_TOPICS: () => DEFAULT_TOPICS,
  FeaturePrioritySchema: () => FeaturePrioritySchema,
  GapStatusSchema: () => GapStatusSchema,
  KIT_VERSION: () => KIT_VERSION,
  KbArticleSchema: () => KbArticleSchema,
  KbArticleStatusSchema: () => KbArticleStatusSchema,
  KbSourceKindSchema: () => KbSourceKindSchema,
  KbVisibilitySchema: () => KbVisibilitySchema,
  KnowledgeGapSchema: () => KnowledgeGapSchema,
  LeadSchema: () => LeadSchema,
  MessageAuthorTypeSchema: () => MessageAuthorTypeSchema,
  PACKAGE_NAME: () => PACKAGE_NAME,
  ProposalSchema: () => ProposalSchema,
  ProposalStatusSchema: () => ProposalStatusSchema,
  ProposalTypeSchema: () => ProposalTypeSchema,
  RecordKnowledgeGapInputSchema: () => RecordKnowledgeGapInputSchema,
  SENSITIVE_TOPICS_DEFAULT: () => SENSITIVE_TOPICS_DEFAULT,
  SupportUserSchema: () => SupportUserSchema,
  TenantIdSchema: () => TenantIdSchema,
  TicketCategorySchema: () => TicketCategorySchema,
  TicketKindSchema: () => TicketKindSchema,
  TicketMessageSchema: () => TicketMessageSchema,
  TicketSchema: () => TicketSchema,
  TicketStatusSchema: () => TicketStatusSchema,
  TicketTopicSchema: () => TicketTopicSchema,
  mapCategoryToKindTopic: () => mapCategoryToKindTopic,
  mapKindTopicToCategory: () => mapKindTopicToCategory,
  normalizeAuthorType: () => normalizeAuthorType,
  normalizeCreateTicketInput: () => normalizeCreateTicketInput,
  normalizeTicketStatus: () => normalizeTicketStatus
});
module.exports = __toCommonJS(index_exports);

// src/enums.ts
var import_zod = require("zod");
var TenantIdSchema = import_zod.z.string().min(1).brand();
var TicketKindSchema = import_zod.z.enum(["support", "bug", "feature"]);
var DEFAULT_TOPICS = [
  "billing",
  "account",
  "how_to",
  "product",
  "access",
  "other"
];
var TicketTopicSchema = import_zod.z.string().min(1);
var BugSeveritySchema = import_zod.z.enum(["low", "medium", "high", "critical"]);
var FeaturePrioritySchema = import_zod.z.enum([
  "nice_to_have",
  "important",
  "critical"
]);
var TicketStatusSchema = import_zod.z.enum([
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
var TicketCategorySchema = import_zod.z.enum([
  "bug",
  "how_to",
  "billing",
  "feature",
  "other"
]);
var KbArticleStatusSchema = import_zod.z.enum([
  "draft",
  "active",
  "deprecated"
]);
var KbSourceKindSchema = import_zod.z.enum([
  "curated",
  "evolutionary",
  "codegen",
  /** Draft from ops-triggered codebase research of a knowledge gap */
  "code_research"
]);
var KbVisibilitySchema = import_zod.z.enum(["public", "agent", "internal"]);
var ProposalStatusSchema = import_zod.z.enum([
  "pending_review",
  "approved",
  "rejected",
  "needs_info",
  "executed"
]);
var ProposalTypeSchema = import_zod.z.enum([
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
var GapStatusSchema = import_zod.z.enum(["open", "resolved", "dismissed"]);
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
var import_zod2 = require("zod");
var MessageAuthorTypeSchema = import_zod2.z.enum([
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
var TicketSchema = import_zod2.z.object({
  id: import_zod2.z.string().min(1),
  tenantId: TenantIdSchema,
  publicNumber: import_zod2.z.number().int().positive(),
  kind: TicketKindSchema.optional(),
  topic: TicketTopicSchema.optional(),
  /** @deprecated use kind + topic */
  category: TicketCategorySchema.optional(),
  status: TicketStatusSchema,
  subject: import_zod2.z.string().nullable().optional(),
  severity: BugSeveritySchema.or(import_zod2.z.string()).nullable().optional(),
  priority: FeaturePrioritySchema.or(import_zod2.z.string()).nullable().optional(),
  userId: import_zod2.z.string().nullable().optional(),
  orgId: import_zod2.z.string().nullable().optional(),
  guestEmail: import_zod2.z.string().email().nullable().optional(),
  contextJson: import_zod2.z.string().nullable().optional(),
  duplicateOfTicketId: import_zod2.z.string().nullable().optional(),
  assignedTo: import_zod2.z.string().nullable().optional(),
  githubIssueUrl: import_zod2.z.string().url().nullable().optional(),
  createdAt: import_zod2.z.string().min(1),
  updatedAt: import_zod2.z.string().min(1),
  closedAt: import_zod2.z.string().nullable().optional()
}).transform((t) => {
  const kind = t.kind ?? (t.category ? mapCategoryToKindTopic(t.category).kind : "support");
  const topic = t.topic ?? (t.category ? mapCategoryToKindTopic(t.category).topic : "other");
  const category = t.category ?? mapKindTopicToCategory(kind, topic);
  return { ...t, kind, topic, category };
});
var TicketMessageSchema = import_zod2.z.object({
  id: import_zod2.z.string().min(1),
  tenantId: TenantIdSchema,
  ticketId: import_zod2.z.string().min(1),
  authorType: MessageAuthorTypeSchema,
  authorId: import_zod2.z.string().nullable().optional(),
  body: import_zod2.z.string().min(1),
  attachmentsJson: import_zod2.z.string().nullable().optional(),
  /** KB sources used for this message (JSON array of {source, title?}). */
  citationJson: import_zod2.z.string().nullable().optional(),
  createdAt: import_zod2.z.string().min(1)
});
var CreateTicketInputSchema = import_zod2.z.object({
  tenantId: TenantIdSchema,
  kind: TicketKindSchema.optional(),
  topic: TicketTopicSchema.optional(),
  /** @deprecated use kind + topic */
  category: TicketCategorySchema.optional(),
  subject: import_zod2.z.string().optional(),
  body: import_zod2.z.string().min(1),
  userId: import_zod2.z.string().optional(),
  orgId: import_zod2.z.string().optional(),
  guestEmail: import_zod2.z.string().email().optional(),
  severity: import_zod2.z.string().optional(),
  priority: import_zod2.z.string().optional(),
  contextJson: import_zod2.z.string().optional(),
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
var import_zod3 = require("zod");
var ProposalSchema = import_zod3.z.object({
  id: import_zod3.z.string().min(1),
  tenantId: TenantIdSchema,
  ticketId: import_zod3.z.string().min(1),
  proposalType: ProposalTypeSchema,
  status: ProposalStatusSchema,
  summary: import_zod3.z.string().min(1),
  bodyJson: import_zod3.z.string().min(1),
  confidence: import_zod3.z.number().min(0).max(1).nullable().optional(),
  telegramMessageId: import_zod3.z.string().nullable().optional(),
  telegramChatId: import_zod3.z.string().nullable().optional(),
  claimedBy: import_zod3.z.string().nullable().optional(),
  claimedAt: import_zod3.z.string().nullable().optional(),
  reviewedBy: import_zod3.z.string().nullable().optional(),
  reviewedAt: import_zod3.z.string().nullable().optional(),
  executionStatus: import_zod3.z.string().nullable().optional(),
  executionRef: import_zod3.z.string().nullable().optional(),
  createdAt: import_zod3.z.string().min(1)
});
var KnowledgeGapSchema = import_zod3.z.object({
  id: import_zod3.z.string().min(1),
  tenantId: TenantIdSchema,
  ticketId: import_zod3.z.string().min(1),
  publicNumber: import_zod3.z.number().int().positive().nullable().optional(),
  userQuestion: import_zod3.z.string().min(1),
  escalationReason: import_zod3.z.string().nullable().optional(),
  docQuery: import_zod3.z.string().nullable().optional(),
  docHitsJson: import_zod3.z.string().nullable().optional(),
  proposalId: import_zod3.z.string().nullable().optional(),
  proposalType: ProposalTypeSchema.nullable().optional(),
  summary: import_zod3.z.string().nullable().optional(),
  status: GapStatusSchema,
  createdAt: import_zod3.z.string().min(1),
  resolvedAt: import_zod3.z.string().nullable().optional()
});
var CreateProposalInputSchema = import_zod3.z.object({
  tenantId: TenantIdSchema,
  ticketId: import_zod3.z.string().min(1),
  proposalType: ProposalTypeSchema,
  summary: import_zod3.z.string().min(1),
  bodyJson: import_zod3.z.string().min(1),
  confidence: import_zod3.z.number().min(0).max(1).optional()
});
var RecordKnowledgeGapInputSchema = import_zod3.z.object({
  tenantId: TenantIdSchema,
  ticketId: import_zod3.z.string().min(1),
  proposalId: import_zod3.z.string().optional(),
  proposalType: ProposalTypeSchema.optional(),
  summary: import_zod3.z.string().optional(),
  escalationReason: import_zod3.z.string().optional(),
  docQuery: import_zod3.z.string().optional(),
  docHitsJson: import_zod3.z.string().optional(),
  userQuestion: import_zod3.z.string().optional()
});

// src/kb.ts
var import_zod4 = require("zod");
var KbArticleSchema = import_zod4.z.object({
  id: import_zod4.z.string().min(1),
  tenantId: TenantIdSchema,
  title: import_zod4.z.string().min(1),
  body: import_zod4.z.string().min(1),
  status: KbArticleStatusSchema,
  sourceKind: KbSourceKindSchema,
  /** public | agent | internal — default agent */
  visibility: KbVisibilitySchema.default("agent"),
  /** Provenance for codegen: git SHA, file path, etc. */
  provenanceJson: import_zod4.z.string().nullable().optional(),
  /** Stable key for upsert (e.g. codegen path or curated slug). */
  sourceKey: import_zod4.z.string().nullable().optional(),
  createdAt: import_zod4.z.string().min(1),
  updatedAt: import_zod4.z.string().min(1)
});

// src/user.ts
var import_zod5 = require("zod");
var SupportUserSchema = import_zod5.z.object({
  id: import_zod5.z.string().min(1),
  email: import_zod5.z.string().email().optional(),
  name: import_zod5.z.string().optional(),
  role: import_zod5.z.enum(["user", "admin", "ops"]).default("user"),
  orgId: import_zod5.z.string().optional(),
  /** Short plan/access label for UI (e.g. "Pro · trial"). */
  planLabel: import_zod5.z.string().optional(),
  /**
   * Host-built snapshot for the agent (plan, limits, role).
   * Injected into triage prompts — do not invent different plan details.
   */
  contextSummary: import_zod5.z.string().optional()
});
var BrandConfigSchema = import_zod5.z.object({
  name: import_zod5.z.string().min(1),
  accentColor: import_zod5.z.string().optional(),
  logoUrl: import_zod5.z.string().url().optional(),
  supportAgentName: import_zod5.z.string().default("Support"),
  agentAuthorId: import_zod5.z.string().default("support-ai"),
  /**
   * Optional host hint appended to the feature-request coach system prompt
   * (product vocabulary, audiences, out-of-scope topics). Keep generic hosts empty.
   */
  featureCoachSystemHint: import_zod5.z.string().max(4e3).optional(),
  /** Public launcher signup CTA. */
  signupUrl: import_zod5.z.string().optional(),
  /** Public contact email display. */
  contactEmail: import_zod5.z.string().email().optional(),
  /** Override marketing consent checkbox copy (stored on lead for audit). */
  marketingConsentLabel: import_zod5.z.string().max(2e3).optional()
});

// src/lead.ts
var import_zod6 = require("zod");
var DEFAULT_MARKETING_CONSENT_LABEL = "I agree to receive product updates and marketing messages by email (and by SMS if I provided a phone number). I can unsubscribe anytime.";
var LeadSchema = import_zod6.z.object({
  id: import_zod6.z.string().min(1),
  tenantId: TenantIdSchema,
  email: import_zod6.z.string().email(),
  name: import_zod6.z.string().min(1),
  phone: import_zod6.z.string().nullable().optional(),
  marketingEmailOptIn: import_zod6.z.boolean(),
  marketingSmsOptIn: import_zod6.z.boolean(),
  source: import_zod6.z.string().min(1),
  consentText: import_zod6.z.string().nullable().optional(),
  consentAt: import_zod6.z.string().nullable().optional(),
  ipHash: import_zod6.z.string().nullable().optional(),
  userAgent: import_zod6.z.string().nullable().optional(),
  createdAt: import_zod6.z.string().min(1),
  updatedAt: import_zod6.z.string().min(1)
});
var CreateLeadInputSchema = import_zod6.z.object({
  tenantId: TenantIdSchema,
  name: import_zod6.z.string().min(1).max(200),
  email: import_zod6.z.string().email().max(320),
  phone: import_zod6.z.string().max(40).optional(),
  /** Master marketing opt-in (email; SMS only if phone present). */
  marketingOptIn: import_zod6.z.boolean().default(false),
  source: import_zod6.z.string().min(1).max(80).default("public_launcher"),
  consentText: import_zod6.z.string().max(2e3).optional(),
  ipHash: import_zod6.z.string().max(128).optional(),
  userAgent: import_zod6.z.string().max(512).optional()
});

// src/index.ts
var PACKAGE_NAME = "@rhule/support-shared";
var KIT_VERSION = "0.1.0";
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BrandConfigSchema,
  BugSeveritySchema,
  CreateLeadInputSchema,
  CreateProposalInputSchema,
  CreateTicketInputSchema,
  DEFAULT_MARKETING_CONSENT_LABEL,
  DEFAULT_TOPICS,
  FeaturePrioritySchema,
  GapStatusSchema,
  KIT_VERSION,
  KbArticleSchema,
  KbArticleStatusSchema,
  KbSourceKindSchema,
  KbVisibilitySchema,
  KnowledgeGapSchema,
  LeadSchema,
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
});
