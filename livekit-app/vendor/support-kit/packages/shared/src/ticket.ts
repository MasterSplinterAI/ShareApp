import { z } from "zod";
import {
  BugSeveritySchema,
  FeaturePrioritySchema,
  TicketCategorySchema,
  TicketKindSchema,
  TicketStatusSchema,
  TicketTopicSchema,
  TenantIdSchema,
  mapCategoryToKindTopic,
  mapKindTopicToCategory,
  type TicketCategory,
  type TicketKind,
} from "./enums.js";

export const MessageAuthorTypeSchema = z.enum([
  "user",
  "assistant",
  "staff",
  "system",
  /** @deprecated use assistant */
  "agent",
  /** @deprecated use staff */
  "ops",
]);
export type MessageAuthorType = z.infer<typeof MessageAuthorTypeSchema>;

export function normalizeAuthorType(
  authorType: MessageAuthorType,
): "user" | "assistant" | "staff" | "system" {
  if (authorType === "agent") return "assistant";
  if (authorType === "ops") return "staff";
  return authorType;
}

export const TicketSchema = z
  .object({
    id: z.string().min(1),
    tenantId: TenantIdSchema,
    publicNumber: z.number().int().positive(),
    kind: TicketKindSchema.optional(),
    topic: TicketTopicSchema.optional(),
    /** @deprecated use kind + topic */
    category: TicketCategorySchema.optional(),
    status: TicketStatusSchema,
    subject: z.string().nullable().optional(),
    severity: BugSeveritySchema.or(z.string()).nullable().optional(),
    priority: FeaturePrioritySchema.or(z.string()).nullable().optional(),
    userId: z.string().nullable().optional(),
    orgId: z.string().nullable().optional(),
    guestEmail: z.string().email().nullable().optional(),
    contextJson: z.string().nullable().optional(),
    duplicateOfTicketId: z.string().nullable().optional(),
    assignedTo: z.string().nullable().optional(),
    githubIssueUrl: z.string().url().nullable().optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    closedAt: z.string().nullable().optional(),
  })
  .transform((t) => {
    const kind =
      t.kind ??
      (t.category ? mapCategoryToKindTopic(t.category).kind : "support");
    const topic =
      t.topic ??
      (t.category ? mapCategoryToKindTopic(t.category).topic : "other");
    const category = t.category ?? mapKindTopicToCategory(kind, topic);
    return { ...t, kind, topic, category };
  });
export type Ticket = z.infer<typeof TicketSchema>;

export const TicketMessageSchema = z.object({
  id: z.string().min(1),
  tenantId: TenantIdSchema,
  ticketId: z.string().min(1),
  authorType: MessageAuthorTypeSchema,
  authorId: z.string().nullable().optional(),
  body: z.string().min(1),
  attachmentsJson: z.string().nullable().optional(),
  /** KB sources used for this message (JSON array of {source, title?}). */
  citationJson: z.string().nullable().optional(),
  createdAt: z.string().min(1),
});
export type TicketMessage = z.infer<typeof TicketMessageSchema>;

export const CreateTicketInputSchema = z.object({
  tenantId: TenantIdSchema,
  kind: TicketKindSchema.optional(),
  topic: TicketTopicSchema.optional(),
  /** @deprecated use kind + topic */
  category: TicketCategorySchema.optional(),
  subject: z.string().optional(),
  body: z.string().min(1),
  userId: z.string().optional(),
  orgId: z.string().optional(),
  guestEmail: z.string().email().optional(),
  severity: z.string().optional(),
  priority: z.string().optional(),
  contextJson: z.string().optional(),
  status: TicketStatusSchema.optional(),
});
export type CreateTicketInput = z.infer<typeof CreateTicketInputSchema>;

/** Normalize create input to kind + topic + legacy category. */
export function normalizeCreateTicketInput(input: CreateTicketInput): CreateTicketInput & {
  kind: TicketKind;
  topic: string;
  category: TicketCategory;
} {
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
