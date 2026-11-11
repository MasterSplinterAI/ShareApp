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
  ArtworkModeSchema: () => ArtworkModeSchema,
  ArtworkStatusSchema: () => ArtworkStatusSchema,
  EmailLayoutSchema: () => EmailLayoutSchema,
  MARKETING_KIT_VERSION: () => MARKETING_KIT_VERSION,
  PostStatusSchema: () => PostStatusSchema
});
module.exports = __toCommonJS(index_exports);
var import_zod = require("zod");
var MARKETING_KIT_VERSION = "0.1.0";
var PostStatusSchema = import_zod.z.enum([
  "idea",
  "generating",
  "draft",
  "approved",
  "scheduled",
  "published",
  "archived"
]);
var ArtworkModeSchema = import_zod.z.enum(["ai_illustration", "studio_card"]);
var ArtworkStatusSchema = import_zod.z.enum(["draft", "approved", "generating"]);
var EmailLayoutSchema = import_zod.z.enum(["editorial", "spotlight", "minimal"]);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ArtworkModeSchema,
  ArtworkStatusSchema,
  EmailLayoutSchema,
  MARKETING_KIT_VERSION,
  PostStatusSchema
});
