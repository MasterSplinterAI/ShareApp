import fs from "node:fs";
import path from "node:path";
import type { KbArticle } from "@rhule/support-shared";
import type { DbAdapter } from "../adapters/types.js";
import { DEFAULT_TABLE_PREFIX } from "../db/migrate.js";

export interface KbSearchHit {
  source: string;
  title: string;
  excerpt: string;
  score: number;
}

export interface SearchCuratedDocsOptions {
  /** Host-owned markdown root (injected; no hardcoded product paths). */
  docsRoot: string;
  limit?: number;
  cacheTtlMs?: number;
  /** Relative paths preferred when query has no token matches (e.g. `faq.md`). */
  fallbackSources?: string[];
}

type DocChunk = {
  source: string;
  title: string;
  body: string;
  tokens: Set<string>;
};

type ChunkCache = {
  docsRoot: string;
  loadedAt: number;
  chunks: DocChunk[];
};

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LIMIT = 5;
const DEFAULT_FALLBACK_SOURCES = ["faq.md"];

let chunkCache: ChunkCache | null = null;

function tokenize(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function walkMarkdown(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdown(full));
    } else if (entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

function loadChunks(docsRoot: string, cacheTtlMs: number): DocChunk[] {
  const now = Date.now();
  if (
    chunkCache &&
    chunkCache.docsRoot === docsRoot &&
    chunkCache.chunks.length > 0 &&
    now - chunkCache.loadedAt < cacheTtlMs
  ) {
    return chunkCache.chunks;
  }

  const chunks: DocChunk[] = [];
  for (const file of walkMarkdown(docsRoot)) {
    const rel = path.relative(docsRoot, file).replace(/\\/g, "/");
    const raw = fs.readFileSync(file, "utf8");
    const sections = raw.split(/\n(?=#{1,3}\s)/);
    for (const section of sections) {
      const trimmed = section.trim();
      if (trimmed.length < 40) continue;
      chunks.push({
        source: rel,
        title: (trimmed.match(/^#{1,3}\s+(.+)/)?.[1] || rel).trim(),
        body: trimmed.slice(0, 4000),
        tokens: new Set(tokenize(trimmed)),
      });
    }
  }

  chunkCache = { docsRoot, loadedAt: now, chunks };
  return chunks;
}

function scoreChunk(chunk: DocChunk, queryTokens: string[]): number {
  let score = 0;
  const lowerTitle = chunk.title.toLowerCase();
  for (const t of queryTokens) {
    if (chunk.tokens.has(t)) score += 1;
    if (lowerTitle.includes(t)) score += 2;
  }
  return score;
}

function rankChunks(chunks: DocChunk[], queryTokens: string[], limit: number): KbSearchHit[] {
  return chunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, queryTokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ chunk, score }) => ({
      source: chunk.source,
      title: chunk.title,
      excerpt: chunk.body.slice(0, 1200),
      score,
    }));
}

function fallbackHits(
  chunks: DocChunk[],
  limit: number,
  fallbackSources: string[],
): KbSearchHit[] {
  const preferred = chunks.filter((c) =>
    fallbackSources.some((src) => c.source.includes(src)),
  );
  const pool = preferred.length ? preferred : chunks;
  return pool.slice(0, limit).map((chunk) => ({
    source: chunk.source,
    title: chunk.title,
    excerpt: chunk.body.slice(0, 1200),
    score: 0,
  }));
}

/**
 * Keyword search over host markdown under `docsRoot`.
 * No vector DB — token overlap scoring with heading-aware chunking.
 */
export function searchCuratedDocs(
  query: string,
  options: SearchCuratedDocsOptions,
): KbSearchHit[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const fallbackSources = options.fallbackSources ?? DEFAULT_FALLBACK_SOURCES;
  const chunks = loadChunks(options.docsRoot, cacheTtlMs);

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return fallbackHits(chunks, limit, fallbackSources);
  }

  const ranked = rankChunks(chunks, queryTokens, limit);
  if (ranked.length > 0) return ranked;

  const longTokens = queryTokens.filter((t) => t.length > 4);
  if (longTokens.length > 0) {
    const retry = rankChunks(chunks, longTokens, limit);
    if (retry.length > 0) return retry;
  }

  return fallbackHits(chunks, limit, fallbackSources);
}

export function formatSourcesForPrompt(hits: KbSearchHit[]): string {
  if (!hits.length) return "No matching support docs found.";
  return hits
    .map(
      (h, i) =>
        `[${i + 1}] ${h.source} — ${h.title}\n${h.excerpt}${h.excerpt.length >= 1200 ? "…" : ""}`,
    )
    .join("\n\n---\n\n");
}

/** Reset in-memory chunk cache (tests). */
export function clearDocsCache(): void {
  chunkCache = null;
}

type KbArticleRow = {
  id: string;
  tenant_id: string;
  title: string;
  body: string;
  status: string;
  source_kind: string;
  visibility: string | null;
  provenance_json: string | null;
  source_key: string | null;
  created_at: string;
  updated_at: string;
};

function mapKbArticle(row: KbArticleRow): KbArticle {
  return {
    id: row.id,
    tenantId: row.tenant_id as KbArticle["tenantId"],
    title: row.title,
    body: row.body,
    status: row.status as KbArticle["status"],
    sourceKind: row.source_kind as KbArticle["sourceKind"],
    visibility: (row.visibility as KbArticle["visibility"]) ?? "agent",
    provenanceJson: row.provenance_json,
    sourceKey: row.source_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function scoreArticle(article: KbArticle, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const titleTokens = new Set(tokenize(article.title));
  const bodyTokens = new Set(tokenize(article.body));
  let score = 0;
  const lowerTitle = article.title.toLowerCase();
  for (const t of queryTokens) {
    if (titleTokens.has(t)) score += 3;
    if (bodyTokens.has(t)) score += 1;
    if (lowerTitle.includes(t)) score += 2;
  }
  return score;
}

export interface SearchActiveArticlesOptions {
  query?: string;
  limit?: number;
  tablePrefix?: string;
}

/**
 * Returns only `active` kb_articles for a tenant (excludes draft/codegen drafts).
 * Optional keyword ranking when `query` is provided.
 */
export async function searchActiveArticles(
  db: DbAdapter,
  tenantId: string,
  options?: SearchActiveArticlesOptions,
): Promise<KbArticle[]> {
  const prefix = options?.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const table = `${prefix}kb_articles`;
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);

  const rows = await db.all<KbArticleRow>(
    `SELECT * FROM ${table} WHERE tenant_id = ? AND status = 'active' ORDER BY updated_at DESC`,
    [tenantId],
  );
  const articles = rows.map(mapKbArticle);

  const queryTokens = tokenize(options?.query ?? "");
  if (queryTokens.length === 0) {
    return articles.slice(0, limit);
  }

  return articles
    .map((article) => ({ article, score: scoreArticle(article, queryTokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.article);
}
