import { z } from "zod";
import { TenantIdSchema } from "./enums.js";

export const DEFAULT_MARKETING_CONSENT_LABEL =
  "I agree to receive product updates and marketing messages by email (and by SMS if I provided a phone number). I can unsubscribe anytime.";

export const LeadSchema = z.object({
  id: z.string().min(1),
  tenantId: TenantIdSchema,
  email: z.string().email(),
  name: z.string().min(1),
  phone: z.string().nullable().optional(),
  marketingEmailOptIn: z.boolean(),
  marketingSmsOptIn: z.boolean(),
  source: z.string().min(1),
  consentText: z.string().nullable().optional(),
  consentAt: z.string().nullable().optional(),
  ipHash: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type Lead = z.infer<typeof LeadSchema>;

export const CreateLeadInputSchema = z.object({
  tenantId: TenantIdSchema,
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  phone: z.string().max(40).optional(),
  /** Master marketing opt-in (email; SMS only if phone present). */
  marketingOptIn: z.boolean().default(false),
  source: z.string().min(1).max(80).default("public_launcher"),
  consentText: z.string().max(2000).optional(),
  ipHash: z.string().max(128).optional(),
  userAgent: z.string().max(512).optional(),
});
export type CreateLeadInput = z.infer<typeof CreateLeadInputSchema>;
