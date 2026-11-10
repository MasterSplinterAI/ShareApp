// src/index.ts
import { z } from "zod";
var MARKETING_KIT_VERSION = "0.1.0";
var PostStatusSchema = z.enum([
  "idea",
  "generating",
  "draft",
  "approved",
  "scheduled",
  "published",
  "archived"
]);
var ArtworkModeSchema = z.enum(["ai_illustration", "studio_card"]);
var ArtworkStatusSchema = z.enum(["draft", "approved", "generating"]);
var EmailLayoutSchema = z.enum(["editorial", "spotlight", "minimal"]);
export {
  ArtworkModeSchema,
  ArtworkStatusSchema,
  EmailLayoutSchema,
  MARKETING_KIT_VERSION,
  PostStatusSchema
};
