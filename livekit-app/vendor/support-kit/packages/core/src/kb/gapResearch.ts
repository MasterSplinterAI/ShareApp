import type { BrandConfig, KnowledgeGap, KbArticle } from "@rhule/support-shared";
import type { CodebaseAdapter, DbAdapter, LlmAdapter } from "../adapters/types.js";
import { DEFAULT_TABLE_PREFIX } from "../db/migrate.js";
import { KnowledgeGapService } from "../gaps/service.js";
import { searchCuratedDocs } from "./search.js";
import { ingestCodegenArticle } from "./codegen.js";

export type GapResearchResult =
  | {
      ok: true;
      article: KbArticle;
      confidence: number;
      citedPaths: string[];
      insufficient: false;
    }
  | {
      ok: false;
      insufficient: true;
      reason: string;
      citedPaths: string[];
    };

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned) as Record<string, unknown>;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/**
 * Ops-triggered: search host codebase (+ optional docsRoot), draft a KB article.
 * Never auto-promotes — always creates/updates a draft for human review.
 */
export async function researchGapToKbDraft(input: {
  db: DbAdapter;
  tenantId: string;
  gapId: string;
  llm: LlmAdapter;
  codebase: CodebaseAdapter;
  brand: BrandConfig;
  docsRoot?: string;
  tablePrefix?: string;
}): Promise<GapResearchResult> {
  const prefix = input.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const gaps = new KnowledgeGapService(input.db, prefix);
  const gap = await gaps.getKnowledgeGap(input.tenantId, input.gapId);
  if (!gap) {
    return {
      ok: false,
      insufficient: true,
      reason: "Knowledge gap not found",
      citedPaths: [],
    };
  }

  const question = (gap.userQuestion || gap.summary || gap.docQuery || "").trim();
  if (!question) {
    return {
      ok: false,
      insufficient: true,
      reason: "Gap has no question text to research",
      citedPaths: [],
    };
  }

  const searchHits = await input.codebase.search(question, { limit: 10 });
  const docsHits = input.docsRoot
    ? searchCuratedDocs(question, { docsRoot: input.docsRoot, limit: 4 })
    : [];

  // Read top code files for deeper context
  const toRead = searchHits.slice(0, 6);
  const fileContents: Array<{ path: string; body: string }> = [];
  for (const hit of toRead) {
    const body = await input.codebase.readFile(hit.path, { maxBytes: 12_000 });
    if (body?.trim()) {
      fileContents.push({ path: hit.path, body: truncate(body, 10_000) });
    }
  }

  const corpus: string[] = [];
  if (input.codebase.label) {
    corpus.push(`Codebase: ${input.codebase.label}`);
  }
  for (const hit of searchHits) {
    corpus.push(`### Search hit: ${hit.path}\n${hit.snippet}`);
  }
  for (const f of fileContents) {
    corpus.push(`### File: ${f.path}\n\`\`\`\n${f.body}\n\`\`\``);
  }
  for (const d of docsHits) {
    corpus.push(`### Doc: ${d.source}\n${truncate(d.excerpt || "", 2000)}`);
  }

  if (corpus.length < 2) {
    return {
      ok: false,
      insufficient: true,
      reason: "No relevant code or docs found for this question",
      citedPaths: [],
    };
  }

  const system = `You are a knowledge-base writer for ${input.brand.name} support (${input.brand.supportAgentName}).
Given a user support question and excerpts from the product codebase/docs, draft a concise help article.

Rules:
- Use ONLY the provided excerpts. Do not invent Stripe keys, secrets, or unverified product behavior.
- If excerpts are insufficient, set insufficient=true and explain what is missing.
- Output ONLY valid JSON (no markdown fences):
{
  "insufficient": false,
  "title": "short help title",
  "body": "markdown article for support agents/users",
  "confidence": 0.0-1.0,
  "cited_paths": ["path1", "path2"],
  "reason": null
}
When insufficient=true: title/body may be empty; reason required.`;

  const user = [
    `User question:\n${question}`,
    gap.summary ? `Gap summary:\n${gap.summary}` : "",
    "",
    "Excerpts:",
    corpus.join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n");

  let parsed: Record<string, unknown>;
  try {
    const raw = await input.llm.complete({ system, user, temperature: 0.2 });
    parsed = parseJsonObject(raw);
  } catch (err) {
    return {
      ok: false,
      insufficient: true,
      reason: err instanceof Error ? err.message : "LLM failed to draft article",
      citedPaths: searchHits.map((h) => h.path),
    };
  }

  const insufficient = Boolean(parsed.insufficient);
  const citedPaths = Array.isArray(parsed.cited_paths)
    ? parsed.cited_paths.map((p) => String(p)).filter(Boolean)
    : searchHits.slice(0, 5).map((h) => h.path);

  if (insufficient) {
    return {
      ok: false,
      insufficient: true,
      reason: String(parsed.reason || "Insufficient codebase evidence to draft a reliable answer"),
      citedPaths,
    };
  }

  const title = String(parsed.title || "").trim() || `Help: ${question.slice(0, 80)}`;
  let body = String(parsed.body || "").trim();
  if (!body) {
    return {
      ok: false,
      insufficient: true,
      reason: "Model returned an empty article body",
      citedPaths,
    };
  }

  if (citedPaths.length) {
    body += `\n\n---\nSources:\n${citedPaths.map((p) => `- \`${p}\``).join("\n")}`;
  }

  const confidence =
    typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5;

  const article = await ingestCodegenArticle(input.db, {
    tenantId: input.tenantId,
    title,
    body,
    sourceKey: `code_research:gap:${gap.id}`,
    sourceKind: "code_research",
    path: `gap/${gap.id}`,
    tablePrefix: prefix,
  });

  // Enrich provenance with research metadata
  const provenance = JSON.stringify({
    gapId: gap.id,
    ticketId: gap.ticketId,
    confidence,
    citedPaths,
    codebase: input.codebase.label ?? null,
    researchedAt: new Date().toISOString(),
  });
  await input.db.run(
    `UPDATE ${prefix}kb_articles SET provenance_json = ?, updated_at = ? WHERE id = ?`,
    [provenance, new Date().toISOString(), article.id],
  );
  const refreshed = {
    ...article,
    provenanceJson: provenance,
  };

  return {
    ok: true,
    article: refreshed,
    confidence,
    citedPaths,
    insufficient: false,
  };
}

/**
 * When ops provides a freeform answer (or ticket thread), LLM-curate into a clean KB draft.
 */
export async function curateAnswerToKbDraft(input: {
  db: DbAdapter;
  tenantId: string;
  llm: LlmAdapter;
  brand: BrandConfig;
  title?: string;
  rawAnswer: string;
  userQuestion?: string;
  sourceKey: string;
  tablePrefix?: string;
}): Promise<KbArticle> {
  const prefix = input.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const system = `You curate support answers into clean knowledge-base articles for ${input.brand.name}.
Output ONLY valid JSON:
{ "title": "...", "body": "markdown article" }
Keep facts from the raw answer; improve structure and clarity. Do not invent new product claims.`;

  const user = [
    input.userQuestion ? `Original question:\n${input.userQuestion}` : "",
    `Raw answer from ops/support:\n${input.rawAnswer}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  let title = input.title?.trim() || "Support answer";
  let body = input.rawAnswer.trim();
  try {
    const raw = await input.llm.complete({ system, user, temperature: 0.2 });
    const parsed = parseJsonObject(raw);
    if (typeof parsed.title === "string" && parsed.title.trim()) title = parsed.title.trim();
    if (typeof parsed.body === "string" && parsed.body.trim()) body = parsed.body.trim();
  } catch {
    /* fall back to raw */
  }

  return ingestCodegenArticle(input.db, {
    tenantId: input.tenantId,
    title,
    body,
    sourceKey: input.sourceKey,
    sourceKind: "evolutionary",
    tablePrefix: prefix,
  });
}

export type { KnowledgeGap };
