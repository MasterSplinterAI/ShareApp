import type { KbArticle } from "@rhule/support-shared";
import type { DbAdapter, LlmAdapter } from "../adapters/types.js";
import { ingestCodegenArticle } from "./codegen.js";
import type { IngestCodegenArticleInput } from "./codegen.js";

/** One crawled page, reduced to plain text for LLM curation. */
export interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

export interface SiteCrawlOptions {
  /** Max pages to crawl (default 25). */
  maxPages?: number;
  /** Injected fetch for tests / custom transports. */
  fetchImpl?: typeof fetch;
}

interface FetchResult {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

function safeFetch(
  fetchImpl: typeof fetch,
  url: string,
): Promise<FetchResult> {
  return fetchImpl(url, { redirect: "follow" })
    .then((res) => ({
      ok: res.ok,
      status: res.status,
      text: () => res.text(),
    }))
    .catch(() => ({ ok: false, status: 0, text: async () => "" }));
}

function normalizeBase(url: string): string {
  const u = url.trim();
  if (!u) throw new Error("crawlSite: url is required");
  const withProto = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  return withProto.replace(/\/+$/, "");
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1]!.replace(/\s+/g, " ").trim() : "";
}

function extractLinks(html: string, base: string): string[] {
  const origin = new URL(base).origin;
  const out: string[] = [];
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"']+)["']/gi)) {
    const href = m[1]!;
    if (/^#|^javascript:|^mailto:|^tel:/i.test(href)) continue;
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      continue;
    }
    if (abs.origin !== origin) continue;
    if (!/^https?:$/i.test(abs.protocol)) continue;
    out.push(abs.href);
  }
  // dedupe, keep order
  return [...new Set(out)];
}

function htmlToText(html: string): string {
  let t = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  t = t
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  return t.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}

/**
 * Crawl a site's public pages: sitemap first, fall back to link-crawling
 * the homepage. Returns reduced text for LLM curation.
 */
export async function crawlSite(
  baseUrl: string,
  opts: SiteCrawlOptions = {},
): Promise<CrawledPage[]> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch ?? fetch);
  const base = normalizeBase(baseUrl);
  const maxPages = opts.maxPages ?? 25;

  let urls: string[] = [];
  const sm = await safeFetch(fetchImpl, `${base}/sitemap.xml`);
  if (sm.ok) {
    const xml = await sm.text();
    urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!);
  }
  if (urls.length === 0) {
    const home = await safeFetch(fetchImpl, base);
    if (home.ok) {
      urls = extractLinks(await home.text(), base);
    }
  }
  urls = [...new Set(urls)].slice(0, maxPages);

  const pages: CrawledPage[] = [];
  for (const u of urls) {
    const res = await safeFetch(fetchImpl, u);
    if (!res.ok) continue;
    const html = await res.text();
    pages.push({
      url: u,
      title: extractTitle(html) || u,
      text: htmlToText(html).slice(0, 20000),
    });
  }
  return pages;
}

const CURATION_SYSTEM = `You are the support knowledge-base curator. Given raw page text, produce ONE support KB article: a concise Q&A.
Rules:
- Stay factual; never invent features or policies not present in the source.
- Body: 1-3 short paragraphs answering the question the page is about.
- Respond ONLY with JSON: {"title": "...", "body": "..."}`;

function parseCurationJson(raw: string): { title: string; body: string } | null {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const tryParse = (text: string): { title: string; body: string } | null => {
    try {
      const parsed = JSON.parse(text) as { title?: unknown; body?: unknown };
      if (typeof parsed.title !== "string" || typeof parsed.body !== "string") return null;
      return { title: parsed.title, body: parsed.body };
    } catch {
      return null;
    }
  };
  const direct = tryParse(cleaned);
  if (direct) return direct;
  // Fallback: model sometimes wraps JSON in prose or truncates it;
  // grab the first balanced-ish {...} block.
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    const extracted = tryParse(m[0]);
    if (extracted) return extracted;
  }
  return null;
}

interface CurationOptions {
  tablePrefix?: string;
}

async function curateSource(
  db: DbAdapter,
  tenantId: string,
  sourceLabel: string,
  content: string,
  llm: LlmAdapter,
  sourceKey: string,
  path: string,
  opts: CurationOptions,
): Promise<KbArticle | null> {
  const raw = await llm.complete({
    system: CURATION_SYSTEM,
    user: `Source: ${sourceLabel}\n\nContent:\n${content.slice(0, 8000)}`,
    temperature: 0.2,
  });
  const curated = parseCurationJson(raw);
  if (!curated) return null;
  const input: IngestCodegenArticleInput = {
    tenantId,
    title: curated.title,
    body: curated.body,
    sourceKey,
    path,
    sourceKind: "curated",
  };
  if (opts.tablePrefix !== undefined) input.tablePrefix = opts.tablePrefix;
  return ingestCodegenArticle(db, input);
}

/** Curate crawled pages into draft KB articles (source_key = crawl:<url>). */
export async function curatePagesToKb(
  db: DbAdapter,
  tenantId: string,
  pages: CrawledPage[],
  llm: LlmAdapter,
  opts: CurationOptions = {},
): Promise<KbArticle[]> {
  const articles: KbArticle[] = [];
  for (const p of pages) {
    const article = await curateSource(
      db,
      tenantId,
      p.url,
      p.text,
      llm,
      `crawl:${p.url}`,
      p.url,
      opts,
    );
    if (article) articles.push(article);
  }
  return articles;
}

/** An uploaded doc for manual KB ingest (user-provided content). */
export interface UploadedDoc {
  name: string;
  content: string;
}

/** Curate uploaded docs into draft KB articles (source_key = upload:<name>). */
export async function curateDocsToKb(
  db: DbAdapter,
  tenantId: string,
  docs: UploadedDoc[],
  llm: LlmAdapter,
  opts: CurationOptions = {},
): Promise<KbArticle[]> {
  const articles: KbArticle[] = [];
  for (const d of docs) {
    if (!d.content?.trim()) continue;
    const article = await curateSource(
      db,
      tenantId,
      `Uploaded file: ${d.name}`,
      d.content,
      llm,
      `upload:${d.name}`,
      d.name,
      opts,
    );
    if (article) articles.push(article);
  }
  return articles;
}
