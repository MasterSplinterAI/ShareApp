import { z } from "zod";

export const SupportUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email().optional(),
  name: z.string().optional(),
  role: z.enum(["user", "admin", "ops"]).default("user"),
  orgId: z.string().optional(),
  /** Short plan/access label for UI (e.g. "Pro · trial"). */
  planLabel: z.string().optional(),
  /**
   * Host-built snapshot for the agent (plan, limits, role).
   * Injected into triage prompts — do not invent different plan details.
   */
  contextSummary: z.string().optional(),
});
export type SupportUser = z.infer<typeof SupportUserSchema>;

export const BrandConfigSchema = z.object({
  name: z.string().min(1),
  accentColor: z.string().optional(),
  logoUrl: z.string().url().optional(),
  supportAgentName: z.string().default("Support"),
  agentAuthorId: z.string().default("support-ai"),
  /**
   * Optional host hint appended to the feature-request coach system prompt
   * (product vocabulary, audiences, out-of-scope topics). Keep generic hosts empty.
   */
  featureCoachSystemHint: z.string().max(4000).optional(),
  /** Public launcher signup CTA. */
  signupUrl: z.string().optional(),
  /** Public contact email display. */
  contactEmail: z.string().email().optional(),
  /** Override marketing consent checkbox copy (stored on lead for audit). */
  marketingConsentLabel: z.string().max(2000).optional(),
});
export type BrandConfig = z.infer<typeof BrandConfigSchema>;
