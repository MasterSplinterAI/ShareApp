import type { MarketingGenerationProfile } from "./generation.js";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type {
  AudienceSegmentInfo,
  MarketingContact,
  MarketingProductContextSnapshot,
} from "@rhule/marketing-shared";
import type { MarketingDbAdapter } from "./schema.js";

export interface CodebaseSearchHit {
  path: string;
  score: number;
  snippet: string;
}

export interface MarketingCodebaseAdapter {
  label?: string;
  search(query: string, limit?: number): Promise<CodebaseSearchHit[]>;
  readFile(relPath: string): Promise<string | null>;
}

export interface MarketingLlmAdapter {
  complete(input: {
    system: string;
    user: string;
    temperature?: number;
  }): Promise<string>;
}

export interface MarketingImageAdapter {
  /** Generates raster artwork. Returned bytes are stored by the kit and served from `<mount>/media/:id`. */
  generateImage(input: {
    prompt: string;
    targetType: "blog" | "email";
    size: "1536x1024" | "1024x1024";
  }): Promise<{ data: Buffer; contentType: string }>;
}

export interface MarketingAuthUser {
  id: string;
  email?: string;
  name?: string;
  role: "user" | "admin" | "ops";
  revision?: number;
  origin?: 'opshub' | 'host';
}

export type MarketingOperation = 'marketing.read' | 'marketing.edit' | 'marketing.publish' | 'marketing.send';

export interface MarketingOperationRequest {
  req: any;
  tenantId: string;
  method: string;
  path: string;
  body: unknown;
  action: MarketingOperation;
  resource: string;
}

export interface MarketingEmailAdapter {
  sendEmail(input: {
    to: string;
    subject: string;
    html: string;
    headers?: Record<string, string>;
    tags?: Array<{ name: string; value: string }>;
  }): Promise<{ providerMessageId?: string | null; status: "sent" | "skipped" | "failed"; error?: string }>;
  sendBatch?(
    messages: Array<{
      to: string;
      subject: string;
      html: string;
      headers?: Record<string, string>;
      tags?: Array<{ name: string; value: string }>;
    }>,
  ): Promise<Array<{ to: string; providerMessageId?: string | null; status: "sent" | "skipped" | "failed"; error?: string }>>;
}

export interface MarketingBrandConfig {
  tenantId: string;
  name: string;
  domain: string;
  tagline: string;
  brandVoice: string;
  primaryColor: string;
  accentColor: string;
  logoText?: string;
  signupUrl: string;
  pricingSummary: string;
  coreFeatures: string[];
  targetAudiences: string[];
  contactEmail?: string;
}

export interface CreateMarketingRouterOptions {
  /** Required for delivery. Without complete live authority checks campaigns pause. */
  consent?: import("./consentPolicy.js").ConsentPolicy;
  tenantId: string;
  db: MarketingDbAdapter;
  brand: MarketingBrandConfig;
  brandsByTenant?: Record<string, MarketingBrandConfig>;
  llm: MarketingLlmAdapter;
  imageGen?: MarketingImageAdapter;
  email?: MarketingEmailAdapter;
  codebase?: MarketingCodebaseAdapter;
  resolveUser?: (req: any) => Promise<MarketingAuthUser | null> | MarketingAuthUser | null;
  resolveDelegatedUser?: (request: MarketingOperationRequest) => Promise<MarketingAuthUser | null>;
  authorizeActor?: (actor: MarketingAuthUser, tenantId: string, action: MarketingOperation, resource: string) => Promise<boolean>;
  isWriteAuthority?: (tenantId: string) => Promise<boolean>;
  forwardVerifiedProviderEvent?: (tenantId: string, event: unknown) => Promise<boolean>;
  publicHeroImageUrl?: (url: string) => string;
  /** Service keys accepted via `X-Ops-Key` (ops.lalia.cloud federation). Compared in constant time. */
  opsKeys?: () => Array<string | null | undefined> | Promise<Array<string | null | undefined>>;
  getProductContext?: (tenantId: string) => Promise<Partial<MarketingProductContextSnapshot>>;
  /** Host-defined segments. `blog_subscribers` and `custom` are provided by the kit. */
  listSegments?: (tenantId: string) => Promise<AudienceSegmentInfo[]>;
  resolveSegmentContacts?: (
    tenantId: string,
    segmentId: string,
    filter?: MarketingCustomSegmentFilter | null,
  ) => Promise<MarketingContact[]>;
  /** Converts SVG studio artwork to PNG (email clients such as Gmail do not render SVG). */
  rasterizeSvg?: (svg: Buffer, width: number) => Promise<Buffer>;
  /** Path the router is mounted at, used to build media/unsubscribe URLs. Default `/marketing`. */
  mountPath?: string;
  /** Origin prefixed to stored media URLs, e.g. `https://lexit.legal`. Default: relative URLs. */
  assetBaseUrl?: string;
  /** Svix signing secret (`whsec_...`) for Resend webhooks. Unsigned webhooks are rejected. */
  resendWebhookSecret?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Per-call LLM timeout; on timeout generation falls back to templates or records an error. Default 240000. */
  llmTimeoutMs?: number;
  /** Max concurrent post generations per batch. Default 3. */
  generationConcurrency?: number;
  /**
   * Optional host writing brief (e.g. CONTENT_BRIEF.md) appended to Copilot, Blog Studio,
   * and email generation system prompts. Same pattern as Support Kit host hints.
   * Used when no tenant-specific brief is set in `contentBriefsByTenant`.
   */
  contentBrief?: string | null;
  /** Existing product template/guardrail selection. Defaults to Lalia for compatibility. */
  generationProfile?: MarketingGenerationProfile;
  generationProfilesByTenant?: Record<string, MarketingGenerationProfile | undefined>;
  /**
   * Per-tenant writing briefs (e.g. Lalia vs LexIt). Takes precedence over `contentBrief`
   * for that tenant; missing tenants fall back to `contentBrief`.
   */
  contentBriefsByTenant?: Record<string, string | null | undefined>;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export interface MarketingCustomSegmentFilter {
  userTypes?: string[];
  planTiers?: string[];
  signedUpAfter?: string;
  signedUpBefore?: string;
  hasLockedMatter?: boolean;
  emailDomain?: string;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".data",
  "vendor",
  "tmp",
  ".tmp",
]);

const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".md",
  ".mdx",
  ".json",
  ".css",
]);

function isTextFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 && TEXT_EXT.has(lower.slice(dot));
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .slice(0, 12);
}

function walkAllowlistedFiles(
  absDir: string,
  out: string[],
  maxFiles: number,
): void {
  if (out.length >= maxFiles) return;
  let entries: string[];
  try {
    entries = readdirSync(absDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (out.length >= maxFiles) return;
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(absDir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkAllowlistedFiles(abs, out, maxFiles);
    } else if (st.isFile() && isTextFile(abs) && st.size > 0 && st.size < 350_000) {
      out.push(abs);
    }
  }
}

export function createMarketingCodebaseAdapter(opts: {
  root: string;
  allowlist: string[];
  label?: string;
  maxFilesWalk?: number;
}): MarketingCodebaseAdapter {
  const rootAbs = resolve(opts.root);
  const maxFiles = opts.maxFilesWalk ?? 350;

  return {
    label: opts.label || "Host Codebase",
    async search(query: string, limit = 6): Promise<CodebaseSearchHit[]> {
      const tokens = tokenize(query);
      if (tokens.length === 0) return [];
      const files: string[] = [];
      for (const rel of opts.allowlist) {
        const abs = resolve(rootAbs, rel);
        if (!abs.startsWith(rootAbs)) continue;
        if (!existsSync(abs)) continue;
        let st;
        try {
          st = statSync(abs);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          walkAllowlistedFiles(abs, files, maxFiles);
        } else if (st.isFile()) {
          files.push(abs);
        }
      }

      const hits: CodebaseSearchHit[] = [];
      for (const f of files) {
        let content: string;
        try {
          content = readFileSync(f, "utf8");
        } catch {
          continue;
        }
        const lower = content.toLowerCase();
        let score = 0;
        let bestIdx = -1;
        for (const t of tokens) {
          let idx = lower.indexOf(t);
          let count = 0;
          while (idx !== -1 && count < 6) {
            score += 1;
            if (bestIdx < 0) bestIdx = idx;
            count += 1;
            idx = lower.indexOf(t, idx + t.length);
          }
        }
        if (score > 0) {
          const start = Math.max(0, bestIdx - 100);
          const snippet = content.slice(start, start + 380).replace(/\s+/g, " ").trim();
          hits.push({
            path: relative(rootAbs, f).split(sep).join("/"),
            score,
            snippet,
          });
        }
      }
      hits.sort((a, b) => b.score - a.score);
      return hits.slice(0, limit);
    },
    async readFile(relPath: string): Promise<string | null> {
      const abs = resolve(rootAbs, relPath);
      if (!abs.startsWith(rootAbs + sep) && abs !== rootAbs) return null;
      if (!existsSync(abs)) return null;
      try {
        return readFileSync(abs, "utf8").slice(0, 24_000);
      } catch {
        return null;
      }
    },
  };
}
