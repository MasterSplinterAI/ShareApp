import { KIT_VERSION, PACKAGE_NAME as SHARED } from "@rhule/support-shared";
import type { CreateSupportRouterOptions, SupportRouter } from "./adapters/types.js";
import { createRouter } from "./http/createRouter.js";

export type {
  CreateSupportRouterOptions,
  CodebaseAdapter,
  CodebaseSearchHit,
  DbAdapter,
  EmailNotifier,
  GitHubAdapter,
  KbIngestConfig,
  LlmAdapter,
  OpsNotification,
  OpsNotificationKind,
  OpsNotifier,
  ResolveUser,
  SupportRouter,
} from "./adapters/types.js";
export { ensureSchema, DEFAULT_TABLE_PREFIX } from "./db/migrate.js";
// createMemorySqliteAdapter lives in ./db/memorySqlite.js (dev/test only —
// not re-exported here so production bundles don't require better-sqlite3).
export { TicketStore } from "./tickets/store.js";
export { TicketService } from "./tickets/service.js";
export { ProposalStore } from "./proposals/store.js";
export { ProposalService } from "./proposals/service.js";
export { KnowledgeGapStore } from "./gaps/store.js";
export { KnowledgeGapService } from "./gaps/service.js";
export { LeadStore } from "./leads/store.js";
export { LeadService } from "./leads/service.js";
export {
  searchCuratedDocs,
  searchActiveArticles,
  formatSourcesForPrompt,
  clearDocsCache,
} from "./kb/search.js";
export {
  ingestCodegenArticle,
  promoteKbArticle,
  deprecateKbArticle,
  updateKbArticle,
  listKbArticles,
  getKbArticle,
  ingestFromChangelog,
  ingestDocsSources,
} from "./kb/codegen.js";
export type {
  IngestCodegenArticleInput,
  IngestFromChangelogOptions,
  IngestDocSource,
} from "./kb/codegen.js";
export { promoteTicketAnswerToKb } from "./kb/evolutionary.js";
export type { PromoteTicketToKbInput } from "./kb/evolutionary.js";
export { researchGapToKbDraft, curateAnswerToKbDraft } from "./kb/gapResearch.js";
export type { GapResearchResult } from "./kb/gapResearch.js";
export {
  createFilesystemCodebaseAdapter,
} from "./kb/filesystemCodebase.js";
export type { FilesystemCodebaseOptions } from "./kb/filesystemCodebase.js";
export { executeGithubFromProposal, parseBugFeatureBody } from "./github/executor.js";
export type {
  GitHubAdapter as CoreGitHubAdapter,
  GitHubIssueInput,
  GitHubIssueResult,
} from "./github/executor.js";
export type {
  KbSearchHit,
  SearchCuratedDocsOptions,
  SearchActiveArticlesOptions,
} from "./kb/search.js";
export { triageMessage } from "./agent/triage.js";
export type { TriageInput, TriageDeps, TriageResult } from "./agent/triage.js";
export { coachFeatureRequest } from "./agent/featureCoach.js";
export type {
  CoachMessage,
  CoachDraft,
  CoachPriority,
  CoachResult,
} from "./agent/featureCoach.js";
export {
  decideFromHeuristics,
  decideFromLlm,
  containsEscalationSignal,
  inferKindTopic,
  DEFAULT_HOLD_REPLY,
  DEFAULT_ESCALATION_REPLY,
} from "./agent/routing.js";
export type { LlmTriageParse, RoutingDecision } from "./agent/routing.js";
export { createHttpRouter, createRouter } from "./http/createRouter.js";
export { executeProposalAction } from "./proposals/executor.js";
export type {
  ProposalAction,
  ProposalExecutorDeps,
  ProposalExecutorResult,
  TelegramMessageEditor,
} from "./proposals/executor.js";
export {
  handleTelegramUpdate,
  verifyTelegramWebhookSecret,
} from "./telegram/webhook.js";
export type {
  TelegramOpsRuntimeConfig,
  ResolveTelegramConfig,
  TelegramWebhookDeps,
} from "./telegram/webhook.js";
export { TelegramDraftSessionStore } from "./telegram/draftSessions.js";
export type { TelegramDraftSession } from "./telegram/draftSessions.js";

export type { BrandConfig, SupportUser, TenantId, Lead } from "@rhule/support-shared";
export { KIT_VERSION, DEFAULT_MARKETING_CONSENT_LABEL } from "@rhule/support-shared";


/**
 * Host entrypoint. Mount under a path prefix, e.g. app.use("/support", router.handler).
 * Schema is ensured lazily on first request via an internal ready promise.
 */
export function createSupportRouter(options: CreateSupportRouterOptions): SupportRouter {
  const tenantId = String(options.tenantId);
  if (!tenantId) {
    throw new Error("createSupportRouter: tenantId is required");
  }
  if (!options.db) {
    throw new Error("createSupportRouter: db adapter is required");
  }
  if (!options.resolveUser) {
    throw new Error("createSupportRouter: resolveUser is required");
  }
  if (!options.brand?.name) {
    throw new Error("createSupportRouter: brand.name is required");
  }

  const router = createRouter(options);
  return {
    handler: router.handler,
    meta: { kitVersion: KIT_VERSION, tenantId, shared: SHARED },
  };
}
