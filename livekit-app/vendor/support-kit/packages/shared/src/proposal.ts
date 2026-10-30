import { z } from "zod";
import {
  GapStatusSchema,
  ProposalStatusSchema,
  ProposalTypeSchema,
  TenantIdSchema,
} from "./enums.js";

export const ProposalSchema = z.object({
  id: z.string().min(1),
  tenantId: TenantIdSchema,
  ticketId: z.string().min(1),
  proposalType: ProposalTypeSchema,
  status: ProposalStatusSchema,
  summary: z.string().min(1),
  bodyJson: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable().optional(),
  telegramMessageId: z.string().nullable().optional(),
  telegramChatId: z.string().nullable().optional(),
  claimedBy: z.string().nullable().optional(),
  claimedAt: z.string().nullable().optional(),
  reviewedBy: z.string().nullable().optional(),
  reviewedAt: z.string().nullable().optional(),
  executionStatus: z.string().nullable().optional(),
  executionRef: z.string().nullable().optional(),
  createdAt: z.string().min(1),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const KnowledgeGapSchema = z.object({
  id: z.string().min(1),
  tenantId: TenantIdSchema,
  ticketId: z.string().min(1),
  publicNumber: z.number().int().positive().nullable().optional(),
  userQuestion: z.string().min(1),
  escalationReason: z.string().nullable().optional(),
  docQuery: z.string().nullable().optional(),
  docHitsJson: z.string().nullable().optional(),
  proposalId: z.string().nullable().optional(),
  proposalType: ProposalTypeSchema.nullable().optional(),
  summary: z.string().nullable().optional(),
  status: GapStatusSchema,
  createdAt: z.string().min(1),
  resolvedAt: z.string().nullable().optional(),
});
export type KnowledgeGap = z.infer<typeof KnowledgeGapSchema>;

export const CreateProposalInputSchema = z.object({
  tenantId: TenantIdSchema,
  ticketId: z.string().min(1),
  proposalType: ProposalTypeSchema,
  summary: z.string().min(1),
  bodyJson: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});
export type CreateProposalInput = z.infer<typeof CreateProposalInputSchema>;

export const RecordKnowledgeGapInputSchema = z.object({
  tenantId: TenantIdSchema,
  ticketId: z.string().min(1),
  proposalId: z.string().optional(),
  proposalType: ProposalTypeSchema.optional(),
  summary: z.string().optional(),
  escalationReason: z.string().optional(),
  docQuery: z.string().optional(),
  docHitsJson: z.string().optional(),
  userQuestion: z.string().optional(),
});
export type RecordKnowledgeGapInput = z.infer<typeof RecordKnowledgeGapInputSchema>;
