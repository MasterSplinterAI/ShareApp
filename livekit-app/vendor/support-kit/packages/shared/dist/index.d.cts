import { z } from 'zod';

/** Hard tenant boundary — required on every persisted row. */
declare const TenantIdSchema: z.ZodBranded<z.ZodString, "TenantId">;
type TenantId = z.infer<typeof TenantIdSchema>;
/** Workstream — fixed by the kit across all hosts. */
declare const TicketKindSchema: z.ZodEnum<["support", "bug", "feature"]>;
type TicketKind = z.infer<typeof TicketKindSchema>;
/** Default topic allowlist; hosts may extend via config. */
declare const DEFAULT_TOPICS: readonly ["billing", "account", "how_to", "product", "access", "other"];
declare const TicketTopicSchema: z.ZodString;
type TicketTopic = z.infer<typeof TicketTopicSchema>;
declare const BugSeveritySchema: z.ZodEnum<["low", "medium", "high", "critical"]>;
type BugSeverity = z.infer<typeof BugSeveritySchema>;
declare const FeaturePrioritySchema: z.ZodEnum<["nice_to_have", "important", "critical"]>;
type FeaturePriority = z.infer<typeof FeaturePrioritySchema>;
declare const TicketStatusSchema: z.ZodEnum<["open", "ai_working", "pending_ops", "waiting_user", "escalated", "resolved", "closed", "pending_user"]>;
type TicketStatus = z.infer<typeof TicketStatusSchema>;
/**
 * @deprecated Flat category — prefer kind + topic.
 * Kept for one-release read/compat mapping.
 */
declare const TicketCategorySchema: z.ZodEnum<["bug", "how_to", "billing", "feature", "other"]>;
type TicketCategory = z.infer<typeof TicketCategorySchema>;
declare const KbArticleStatusSchema: z.ZodEnum<["draft", "active", "deprecated"]>;
type KbArticleStatus = z.infer<typeof KbArticleStatusSchema>;
declare const KbSourceKindSchema: z.ZodEnum<["curated", "evolutionary", "codegen", "code_research"]>;
type KbSourceKind = z.infer<typeof KbSourceKindSchema>;
/** Who can see an active KB article. */
declare const KbVisibilitySchema: z.ZodEnum<["public", "agent", "internal"]>;
type KbVisibility = z.infer<typeof KbVisibilitySchema>;
declare const ProposalStatusSchema: z.ZodEnum<["pending_review", "approved", "rejected", "needs_info", "executed"]>;
type ProposalStatus = z.infer<typeof ProposalStatusSchema>;
declare const ProposalTypeSchema: z.ZodEnum<["reply", "escalate", "bug_fix", "feature", "kb_article", "github_issue", "other"]>;
type ProposalType = z.infer<typeof ProposalTypeSchema>;
declare const GapStatusSchema: z.ZodEnum<["open", "resolved", "dismissed"]>;
type GapStatus = z.infer<typeof GapStatusSchema>;
declare const SENSITIVE_TOPICS_DEFAULT: readonly ["billing", "access"];
/** Map legacy flat category → kind + topic. */
declare function mapCategoryToKindTopic(category: TicketCategory): {
    kind: TicketKind;
    topic: string;
};
/** Derive a legacy category from kind+topic for older callers. */
declare function mapKindTopicToCategory(kind: TicketKind, topic: string): TicketCategory;
declare function normalizeTicketStatus(status: string): TicketStatus;

declare const MessageAuthorTypeSchema: z.ZodEnum<["user", "assistant", "staff", "system", "agent", "ops"]>;
type MessageAuthorType = z.infer<typeof MessageAuthorTypeSchema>;
declare function normalizeAuthorType(authorType: MessageAuthorType): "user" | "assistant" | "staff" | "system";
declare const TicketSchema: z.ZodEffects<z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodBranded<z.ZodString, "TenantId">;
    publicNumber: z.ZodNumber;
    kind: z.ZodOptional<z.ZodEnum<["support", "bug", "feature"]>>;
    topic: z.ZodOptional<z.ZodString>;
    /** @deprecated use kind + topic */
    category: z.ZodOptional<z.ZodEnum<["bug", "how_to", "billing", "feature", "other"]>>;
    status: z.ZodEnum<["open", "ai_working", "pending_ops", "waiting_user", "escalated", "resolved", "closed", "pending_user"]>;
    subject: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    severity: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodEnum<["low", "medium", "high", "critical"]>, z.ZodString]>>>;
    priority: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodEnum<["nice_to_have", "important", "critical"]>, z.ZodString]>>>;
    userId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    orgId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    guestEmail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    contextJson: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    duplicateOfTicketId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    assignedTo: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    githubIssueUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    closedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    status: "open" | "ai_working" | "pending_ops" | "waiting_user" | "escalated" | "resolved" | "closed" | "pending_user";
    id: string;
    tenantId: string & z.BRAND<"TenantId">;
    publicNumber: number;
    createdAt: string;
    updatedAt: string;
    kind?: "support" | "bug" | "feature" | undefined;
    topic?: string | undefined;
    category?: "bug" | "feature" | "billing" | "how_to" | "other" | undefined;
    subject?: string | null | undefined;
    severity?: string | null | undefined;
    priority?: string | null | undefined;
    userId?: string | null | undefined;
    orgId?: string | null | undefined;
    guestEmail?: string | null | undefined;
    contextJson?: string | null | undefined;
    duplicateOfTicketId?: string | null | undefined;
    assignedTo?: string | null | undefined;
    githubIssueUrl?: string | null | undefined;
    closedAt?: string | null | undefined;
}, {
    status: "open" | "ai_working" | "pending_ops" | "waiting_user" | "escalated" | "resolved" | "closed" | "pending_user";
    id: string;
    tenantId: string;
    publicNumber: number;
    createdAt: string;
    updatedAt: string;
    kind?: "support" | "bug" | "feature" | undefined;
    topic?: string | undefined;
    category?: "bug" | "feature" | "billing" | "how_to" | "other" | undefined;
    subject?: string | null | undefined;
    severity?: string | null | undefined;
    priority?: string | null | undefined;
    userId?: string | null | undefined;
    orgId?: string | null | undefined;
    guestEmail?: string | null | undefined;
    contextJson?: string | null | undefined;
    duplicateOfTicketId?: string | null | undefined;
    assignedTo?: string | null | undefined;
    githubIssueUrl?: string | null | undefined;
    closedAt?: string | null | undefined;
}>, {
    kind: "support" | "bug" | "feature";
    topic: string;
    category: "bug" | "feature" | "billing" | "how_to" | "other";
    status: "open" | "ai_working" | "pending_ops" | "waiting_user" | "escalated" | "resolved" | "closed" | "pending_user";
    id: string;
    tenantId: string & z.BRAND<"TenantId">;
    publicNumber: number;
    createdAt: string;
    updatedAt: string;
    subject?: string | null | undefined;
    severity?: string | null | undefined;
    priority?: string | null | undefined;
    userId?: string | null | undefined;
    orgId?: string | null | undefined;
    guestEmail?: string | null | undefined;
    contextJson?: string | null | undefined;
    duplicateOfTicketId?: string | null | undefined;
    assignedTo?: string | null | undefined;
    githubIssueUrl?: string | null | undefined;
    closedAt?: string | null | undefined;
}, {
    status: "open" | "ai_working" | "pending_ops" | "waiting_user" | "escalated" | "resolved" | "closed" | "pending_user";
    id: string;
    tenantId: string;
    publicNumber: number;
    createdAt: string;
    updatedAt: string;
    kind?: "support" | "bug" | "feature" | undefined;
    topic?: string | undefined;
    category?: "bug" | "feature" | "billing" | "how_to" | "other" | undefined;
    subject?: string | null | undefined;
    severity?: string | null | undefined;
    priority?: string | null | undefined;
    userId?: string | null | undefined;
    orgId?: string | null | undefined;
    guestEmail?: string | null | undefined;
    contextJson?: string | null | undefined;
    duplicateOfTicketId?: string | null | undefined;
    assignedTo?: string | null | undefined;
    githubIssueUrl?: string | null | undefined;
    closedAt?: string | null | undefined;
}>;
type Ticket = z.infer<typeof TicketSchema>;
declare const TicketMessageSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodBranded<z.ZodString, "TenantId">;
    ticketId: z.ZodString;
    authorType: z.ZodEnum<["user", "assistant", "staff", "system", "agent", "ops"]>;
    authorId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    body: z.ZodString;
    attachmentsJson: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    /** KB sources used for this message (JSON array of {source, title?}). */
    citationJson: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    tenantId: string & z.BRAND<"TenantId">;
    createdAt: string;
    ticketId: string;
    authorType: "agent" | "user" | "assistant" | "staff" | "system" | "ops";
    body: string;
    authorId?: string | null | undefined;
    attachmentsJson?: string | null | undefined;
    citationJson?: string | null | undefined;
}, {
    id: string;
    tenantId: string;
    createdAt: string;
    ticketId: string;
    authorType: "agent" | "user" | "assistant" | "staff" | "system" | "ops";
    body: string;
    authorId?: string | null | undefined;
    attachmentsJson?: string | null | undefined;
    citationJson?: string | null | undefined;
}>;
type TicketMessage = z.infer<typeof TicketMessageSchema>;
declare const CreateTicketInputSchema: z.ZodObject<{
    tenantId: z.ZodBranded<z.ZodString, "TenantId">;
    kind: z.ZodOptional<z.ZodEnum<["support", "bug", "feature"]>>;
    topic: z.ZodOptional<z.ZodString>;
    /** @deprecated use kind + topic */
    category: z.ZodOptional<z.ZodEnum<["bug", "how_to", "billing", "feature", "other"]>>;
    subject: z.ZodOptional<z.ZodString>;
    body: z.ZodString;
    userId: z.ZodOptional<z.ZodString>;
    orgId: z.ZodOptional<z.ZodString>;
    guestEmail: z.ZodOptional<z.ZodString>;
    severity: z.ZodOptional<z.ZodString>;
    priority: z.ZodOptional<z.ZodString>;
    contextJson: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["open", "ai_working", "pending_ops", "waiting_user", "escalated", "resolved", "closed", "pending_user"]>>;
}, "strip", z.ZodTypeAny, {
    tenantId: string & z.BRAND<"TenantId">;
    body: string;
    status?: "open" | "ai_working" | "pending_ops" | "waiting_user" | "escalated" | "resolved" | "closed" | "pending_user" | undefined;
    kind?: "support" | "bug" | "feature" | undefined;
    topic?: string | undefined;
    category?: "bug" | "feature" | "billing" | "how_to" | "other" | undefined;
    subject?: string | undefined;
    severity?: string | undefined;
    priority?: string | undefined;
    userId?: string | undefined;
    orgId?: string | undefined;
    guestEmail?: string | undefined;
    contextJson?: string | undefined;
}, {
    tenantId: string;
    body: string;
    status?: "open" | "ai_working" | "pending_ops" | "waiting_user" | "escalated" | "resolved" | "closed" | "pending_user" | undefined;
    kind?: "support" | "bug" | "feature" | undefined;
    topic?: string | undefined;
    category?: "bug" | "feature" | "billing" | "how_to" | "other" | undefined;
    subject?: string | undefined;
    severity?: string | undefined;
    priority?: string | undefined;
    userId?: string | undefined;
    orgId?: string | undefined;
    guestEmail?: string | undefined;
    contextJson?: string | undefined;
}>;
type CreateTicketInput = z.infer<typeof CreateTicketInputSchema>;
/** Normalize create input to kind + topic + legacy category. */
declare function normalizeCreateTicketInput(input: CreateTicketInput): CreateTicketInput & {
    kind: TicketKind;
    topic: string;
    category: TicketCategory;
};

declare const ProposalSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodBranded<z.ZodString, "TenantId">;
    ticketId: z.ZodString;
    proposalType: z.ZodEnum<["reply", "escalate", "bug_fix", "feature", "kb_article", "github_issue", "other"]>;
    status: z.ZodEnum<["pending_review", "approved", "rejected", "needs_info", "executed"]>;
    summary: z.ZodString;
    bodyJson: z.ZodString;
    confidence: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    telegramMessageId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    telegramChatId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    claimedBy: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    claimedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    reviewedBy: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    reviewedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    executionStatus: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    executionRef: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "pending_review" | "approved" | "rejected" | "needs_info" | "executed";
    id: string;
    tenantId: string & z.BRAND<"TenantId">;
    createdAt: string;
    ticketId: string;
    proposalType: "feature" | "other" | "reply" | "escalate" | "bug_fix" | "kb_article" | "github_issue";
    summary: string;
    bodyJson: string;
    confidence?: number | null | undefined;
    telegramMessageId?: string | null | undefined;
    telegramChatId?: string | null | undefined;
    claimedBy?: string | null | undefined;
    claimedAt?: string | null | undefined;
    reviewedBy?: string | null | undefined;
    reviewedAt?: string | null | undefined;
    executionStatus?: string | null | undefined;
    executionRef?: string | null | undefined;
}, {
    status: "pending_review" | "approved" | "rejected" | "needs_info" | "executed";
    id: string;
    tenantId: string;
    createdAt: string;
    ticketId: string;
    proposalType: "feature" | "other" | "reply" | "escalate" | "bug_fix" | "kb_article" | "github_issue";
    summary: string;
    bodyJson: string;
    confidence?: number | null | undefined;
    telegramMessageId?: string | null | undefined;
    telegramChatId?: string | null | undefined;
    claimedBy?: string | null | undefined;
    claimedAt?: string | null | undefined;
    reviewedBy?: string | null | undefined;
    reviewedAt?: string | null | undefined;
    executionStatus?: string | null | undefined;
    executionRef?: string | null | undefined;
}>;
type Proposal = z.infer<typeof ProposalSchema>;
declare const KnowledgeGapSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodBranded<z.ZodString, "TenantId">;
    ticketId: z.ZodString;
    publicNumber: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    userQuestion: z.ZodString;
    escalationReason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    docQuery: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    docHitsJson: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    proposalId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    proposalType: z.ZodOptional<z.ZodNullable<z.ZodEnum<["reply", "escalate", "bug_fix", "feature", "kb_article", "github_issue", "other"]>>>;
    summary: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodEnum<["open", "resolved", "dismissed"]>;
    createdAt: z.ZodString;
    resolvedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    status: "open" | "resolved" | "dismissed";
    id: string;
    tenantId: string & z.BRAND<"TenantId">;
    createdAt: string;
    ticketId: string;
    userQuestion: string;
    publicNumber?: number | null | undefined;
    proposalType?: "feature" | "other" | "reply" | "escalate" | "bug_fix" | "kb_article" | "github_issue" | null | undefined;
    summary?: string | null | undefined;
    escalationReason?: string | null | undefined;
    docQuery?: string | null | undefined;
    docHitsJson?: string | null | undefined;
    proposalId?: string | null | undefined;
    resolvedAt?: string | null | undefined;
}, {
    status: "open" | "resolved" | "dismissed";
    id: string;
    tenantId: string;
    createdAt: string;
    ticketId: string;
    userQuestion: string;
    publicNumber?: number | null | undefined;
    proposalType?: "feature" | "other" | "reply" | "escalate" | "bug_fix" | "kb_article" | "github_issue" | null | undefined;
    summary?: string | null | undefined;
    escalationReason?: string | null | undefined;
    docQuery?: string | null | undefined;
    docHitsJson?: string | null | undefined;
    proposalId?: string | null | undefined;
    resolvedAt?: string | null | undefined;
}>;
type KnowledgeGap = z.infer<typeof KnowledgeGapSchema>;
declare const CreateProposalInputSchema: z.ZodObject<{
    tenantId: z.ZodBranded<z.ZodString, "TenantId">;
    ticketId: z.ZodString;
    proposalType: z.ZodEnum<["reply", "escalate", "bug_fix", "feature", "kb_article", "github_issue", "other"]>;
    summary: z.ZodString;
    bodyJson: z.ZodString;
    confidence: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    tenantId: string & z.BRAND<"TenantId">;
    ticketId: string;
    proposalType: "feature" | "other" | "reply" | "escalate" | "bug_fix" | "kb_article" | "github_issue";
    summary: string;
    bodyJson: string;
    confidence?: number | undefined;
}, {
    tenantId: string;
    ticketId: string;
    proposalType: "feature" | "other" | "reply" | "escalate" | "bug_fix" | "kb_article" | "github_issue";
    summary: string;
    bodyJson: string;
    confidence?: number | undefined;
}>;
type CreateProposalInput = z.infer<typeof CreateProposalInputSchema>;
declare const RecordKnowledgeGapInputSchema: z.ZodObject<{
    tenantId: z.ZodBranded<z.ZodString, "TenantId">;
    ticketId: z.ZodString;
    proposalId: z.ZodOptional<z.ZodString>;
    proposalType: z.ZodOptional<z.ZodEnum<["reply", "escalate", "bug_fix", "feature", "kb_article", "github_issue", "other"]>>;
    summary: z.ZodOptional<z.ZodString>;
    escalationReason: z.ZodOptional<z.ZodString>;
    docQuery: z.ZodOptional<z.ZodString>;
    docHitsJson: z.ZodOptional<z.ZodString>;
    userQuestion: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    tenantId: string & z.BRAND<"TenantId">;
    ticketId: string;
    proposalType?: "feature" | "other" | "reply" | "escalate" | "bug_fix" | "kb_article" | "github_issue" | undefined;
    summary?: string | undefined;
    userQuestion?: string | undefined;
    escalationReason?: string | undefined;
    docQuery?: string | undefined;
    docHitsJson?: string | undefined;
    proposalId?: string | undefined;
}, {
    tenantId: string;
    ticketId: string;
    proposalType?: "feature" | "other" | "reply" | "escalate" | "bug_fix" | "kb_article" | "github_issue" | undefined;
    summary?: string | undefined;
    userQuestion?: string | undefined;
    escalationReason?: string | undefined;
    docQuery?: string | undefined;
    docHitsJson?: string | undefined;
    proposalId?: string | undefined;
}>;
type RecordKnowledgeGapInput = z.infer<typeof RecordKnowledgeGapInputSchema>;

declare const KbArticleSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodBranded<z.ZodString, "TenantId">;
    title: z.ZodString;
    body: z.ZodString;
    status: z.ZodEnum<["draft", "active", "deprecated"]>;
    sourceKind: z.ZodEnum<["curated", "evolutionary", "codegen", "code_research"]>;
    /** public | agent | internal — default agent */
    visibility: z.ZodDefault<z.ZodEnum<["public", "agent", "internal"]>>;
    /** Provenance for codegen: git SHA, file path, etc. */
    provenanceJson: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    /** Stable key for upsert (e.g. codegen path or curated slug). */
    sourceKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "draft" | "active" | "deprecated";
    id: string;
    tenantId: string & z.BRAND<"TenantId">;
    createdAt: string;
    updatedAt: string;
    body: string;
    title: string;
    sourceKind: "curated" | "evolutionary" | "codegen" | "code_research";
    visibility: "public" | "agent" | "internal";
    provenanceJson?: string | null | undefined;
    sourceKey?: string | null | undefined;
}, {
    status: "draft" | "active" | "deprecated";
    id: string;
    tenantId: string;
    createdAt: string;
    updatedAt: string;
    body: string;
    title: string;
    sourceKind: "curated" | "evolutionary" | "codegen" | "code_research";
    visibility?: "public" | "agent" | "internal" | undefined;
    provenanceJson?: string | null | undefined;
    sourceKey?: string | null | undefined;
}>;
type KbArticle = z.infer<typeof KbArticleSchema>;

declare const SupportUserSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    role: z.ZodDefault<z.ZodEnum<["user", "admin", "ops"]>>;
    orgId: z.ZodOptional<z.ZodString>;
    /** Short plan/access label for UI (e.g. "Pro · trial"). */
    planLabel: z.ZodOptional<z.ZodString>;
    /**
     * Host-built snapshot for the agent (plan, limits, role).
     * Injected into triage prompts — do not invent different plan details.
     */
    contextSummary: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    role: "user" | "ops" | "admin";
    orgId?: string | undefined;
    email?: string | undefined;
    name?: string | undefined;
    planLabel?: string | undefined;
    contextSummary?: string | undefined;
}, {
    id: string;
    orgId?: string | undefined;
    email?: string | undefined;
    name?: string | undefined;
    role?: "user" | "ops" | "admin" | undefined;
    planLabel?: string | undefined;
    contextSummary?: string | undefined;
}>;
type SupportUser = z.infer<typeof SupportUserSchema>;
declare const BrandConfigSchema: z.ZodObject<{
    name: z.ZodString;
    accentColor: z.ZodOptional<z.ZodString>;
    logoUrl: z.ZodOptional<z.ZodString>;
    supportAgentName: z.ZodDefault<z.ZodString>;
    agentAuthorId: z.ZodDefault<z.ZodString>;
    /**
     * Optional host hint appended to the feature-request coach system prompt
     * (product vocabulary, audiences, out-of-scope topics). Keep generic hosts empty.
     */
    featureCoachSystemHint: z.ZodOptional<z.ZodString>;
    /** Public launcher signup CTA. */
    signupUrl: z.ZodOptional<z.ZodString>;
    /** Public contact email display. */
    contactEmail: z.ZodOptional<z.ZodString>;
    /** Override marketing consent checkbox copy (stored on lead for audit). */
    marketingConsentLabel: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    supportAgentName: string;
    agentAuthorId: string;
    accentColor?: string | undefined;
    logoUrl?: string | undefined;
    featureCoachSystemHint?: string | undefined;
    signupUrl?: string | undefined;
    contactEmail?: string | undefined;
    marketingConsentLabel?: string | undefined;
}, {
    name: string;
    accentColor?: string | undefined;
    logoUrl?: string | undefined;
    supportAgentName?: string | undefined;
    agentAuthorId?: string | undefined;
    featureCoachSystemHint?: string | undefined;
    signupUrl?: string | undefined;
    contactEmail?: string | undefined;
    marketingConsentLabel?: string | undefined;
}>;
type BrandConfig = z.infer<typeof BrandConfigSchema>;

declare const DEFAULT_MARKETING_CONSENT_LABEL = "I agree to receive product updates and marketing messages by email (and by SMS if I provided a phone number). I can unsubscribe anytime.";
declare const LeadSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodBranded<z.ZodString, "TenantId">;
    email: z.ZodString;
    name: z.ZodString;
    phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    marketingEmailOptIn: z.ZodBoolean;
    marketingSmsOptIn: z.ZodBoolean;
    source: z.ZodString;
    consentText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    consentAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    ipHash: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    userAgent: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    tenantId: string & z.BRAND<"TenantId">;
    createdAt: string;
    updatedAt: string;
    email: string;
    name: string;
    marketingEmailOptIn: boolean;
    marketingSmsOptIn: boolean;
    source: string;
    phone?: string | null | undefined;
    consentText?: string | null | undefined;
    consentAt?: string | null | undefined;
    ipHash?: string | null | undefined;
    userAgent?: string | null | undefined;
}, {
    id: string;
    tenantId: string;
    createdAt: string;
    updatedAt: string;
    email: string;
    name: string;
    marketingEmailOptIn: boolean;
    marketingSmsOptIn: boolean;
    source: string;
    phone?: string | null | undefined;
    consentText?: string | null | undefined;
    consentAt?: string | null | undefined;
    ipHash?: string | null | undefined;
    userAgent?: string | null | undefined;
}>;
type Lead = z.infer<typeof LeadSchema>;
declare const CreateLeadInputSchema: z.ZodObject<{
    tenantId: z.ZodBranded<z.ZodString, "TenantId">;
    name: z.ZodString;
    email: z.ZodString;
    phone: z.ZodOptional<z.ZodString>;
    /** Master marketing opt-in (email; SMS only if phone present). */
    marketingOptIn: z.ZodDefault<z.ZodBoolean>;
    source: z.ZodDefault<z.ZodString>;
    consentText: z.ZodOptional<z.ZodString>;
    ipHash: z.ZodOptional<z.ZodString>;
    userAgent: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    tenantId: string & z.BRAND<"TenantId">;
    email: string;
    name: string;
    source: string;
    marketingOptIn: boolean;
    phone?: string | undefined;
    consentText?: string | undefined;
    ipHash?: string | undefined;
    userAgent?: string | undefined;
}, {
    tenantId: string;
    email: string;
    name: string;
    phone?: string | undefined;
    source?: string | undefined;
    consentText?: string | undefined;
    ipHash?: string | undefined;
    userAgent?: string | undefined;
    marketingOptIn?: boolean | undefined;
}>;
type CreateLeadInput = z.infer<typeof CreateLeadInputSchema>;

declare const PACKAGE_NAME: "@rhule/support-shared";
declare const KIT_VERSION: "0.1.0";

export { type BrandConfig, BrandConfigSchema, type BugSeverity, BugSeveritySchema, type CreateLeadInput, CreateLeadInputSchema, type CreateProposalInput, CreateProposalInputSchema, type CreateTicketInput, CreateTicketInputSchema, DEFAULT_MARKETING_CONSENT_LABEL, DEFAULT_TOPICS, type FeaturePriority, FeaturePrioritySchema, type GapStatus, GapStatusSchema, KIT_VERSION, type KbArticle, KbArticleSchema, type KbArticleStatus, KbArticleStatusSchema, type KbSourceKind, KbSourceKindSchema, type KbVisibility, KbVisibilitySchema, type KnowledgeGap, KnowledgeGapSchema, type Lead, LeadSchema, type MessageAuthorType, MessageAuthorTypeSchema, PACKAGE_NAME, type Proposal, ProposalSchema, type ProposalStatus, ProposalStatusSchema, type ProposalType, ProposalTypeSchema, type RecordKnowledgeGapInput, RecordKnowledgeGapInputSchema, SENSITIVE_TOPICS_DEFAULT, type SupportUser, SupportUserSchema, type TenantId, TenantIdSchema, type Ticket, type TicketCategory, TicketCategorySchema, type TicketKind, TicketKindSchema, type TicketMessage, TicketMessageSchema, TicketSchema, type TicketStatus, TicketStatusSchema, type TicketTopic, TicketTopicSchema, mapCategoryToKindTopic, mapKindTopicToCategory, normalizeAuthorType, normalizeCreateTicketInput, normalizeTicketStatus };
