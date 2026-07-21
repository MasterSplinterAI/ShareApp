import { z } from "zod";

/** Hard tenant boundary — required on every persisted row. */
export const TenantIdSchema = z.string().min(1).brand<"TenantId">();
export type TenantId = z.infer<typeof TenantIdSchema>;

/** Workstream — fixed by the kit across all hosts. */
export const TicketKindSchema = z.enum(["support", "bug", "feature"]);
export type TicketKind = z.infer<typeof TicketKindSchema>;

/** Default topic allowlist; hosts may extend via config. */
export const DEFAULT_TOPICS = [
  "billing",
  "account",
  "how_to",
  "product",
  "access",
  "other",
] as const;

export const TicketTopicSchema = z.string().min(1);
export type TicketTopic = z.infer<typeof TicketTopicSchema>;

export const BugSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export type BugSeverity = z.infer<typeof BugSeveritySchema>;

export const FeaturePrioritySchema = z.enum([
  "nice_to_have",
  "important",
  "critical",
]);
export type FeaturePriority = z.infer<typeof FeaturePrioritySchema>;

export const TicketStatusSchema = z.enum([
  "open",
  "ai_working",
  "pending_ops",
  "waiting_user",
  "escalated",
  "resolved",
  "closed",
  /** @deprecated use waiting_user */
  "pending_user",
]);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

/**
 * @deprecated Flat category — prefer kind + topic.
 * Kept for one-release read/compat mapping.
 */
export const TicketCategorySchema = z.enum([
  "bug",
  "how_to",
  "billing",
  "feature",
  "other",
]);
export type TicketCategory = z.infer<typeof TicketCategorySchema>;

export const KbArticleStatusSchema = z.enum([
  "draft",
  "active",
  "deprecated",
]);
export type KbArticleStatus = z.infer<typeof KbArticleStatusSchema>;

export const KbSourceKindSchema = z.enum([
  "curated",
  "evolutionary",
  "codegen",
  /** Draft from ops-triggered codebase research of a knowledge gap */
  "code_research",
]);
export type KbSourceKind = z.infer<typeof KbSourceKindSchema>;

/** Who can see an active KB article. */
export const KbVisibilitySchema = z.enum(["public", "agent", "internal"]);
export type KbVisibility = z.infer<typeof KbVisibilitySchema>;

export const ProposalStatusSchema = z.enum([
  "pending_review",
  "approved",
  "rejected",
  "needs_info",
  "executed",
]);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

export const ProposalTypeSchema = z.enum([
  "reply",
  "escalate",
  "bug_fix",
  "feature",
  "kb_article",
  /** @deprecated use bug_fix / feature */
  "github_issue",
  /** @deprecated */
  "other",
]);
export type ProposalType = z.infer<typeof ProposalTypeSchema>;

export const GapStatusSchema = z.enum(["open", "resolved", "dismissed"]);
export type GapStatus = z.infer<typeof GapStatusSchema>;

export const SENSITIVE_TOPICS_DEFAULT = ["billing", "access"] as const;

/** Map legacy flat category → kind + topic. */
export function mapCategoryToKindTopic(category: TicketCategory): {
  kind: TicketKind;
  topic: string;
} {
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

/** Derive a legacy category from kind+topic for older callers. */
export function mapKindTopicToCategory(
  kind: TicketKind,
  topic: string,
): TicketCategory {
  if (kind === "bug") return "bug";
  if (kind === "feature") return "feature";
  if (topic === "billing") return "billing";
  if (topic === "how_to") return "how_to";
  return "other";
}

export function normalizeTicketStatus(status: string): TicketStatus {
  if (status === "pending_user") return "waiting_user";
  return TicketStatusSchema.parse(status);
}
