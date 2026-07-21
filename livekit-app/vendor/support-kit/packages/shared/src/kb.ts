import { z } from "zod";
import {
  KbArticleStatusSchema,
  KbSourceKindSchema,
  KbVisibilitySchema,
  TenantIdSchema,
} from "./enums.js";

export const KbArticleSchema = z.object({
  id: z.string().min(1),
  tenantId: TenantIdSchema,
  title: z.string().min(1),
  body: z.string().min(1),
  status: KbArticleStatusSchema,
  sourceKind: KbSourceKindSchema,
  /** public | agent | internal — default agent */
  visibility: KbVisibilitySchema.default("agent"),
  /** Provenance for codegen: git SHA, file path, etc. */
  provenanceJson: z.string().nullable().optional(),
  /** Stable key for upsert (e.g. codegen path or curated slug). */
  sourceKey: z.string().nullable().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type KbArticle = z.infer<typeof KbArticleSchema>;
