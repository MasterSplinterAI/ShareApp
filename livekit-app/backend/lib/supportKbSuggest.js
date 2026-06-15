const fs = require('fs');
const path = require('path');
const { searchSupportDocs, DOCS_ROOT } = require('./supportKnowledge');
const { aiEnabled, callSupportLlm } = require('./supportAgent/llm');

const MAX_SNIPPETS = 12;
const MAX_SNIPPET_CHARS = 600;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'uploads', 'coverage', '__pycache__']);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

function repoRootFromBackendLib() {
  return path.resolve(__dirname, '../../..');
}

function searchRoots() {
  const root = repoRootFromBackendLib();
  return [
    path.join(root, 'docs/support'),
    path.resolve(__dirname, '../docs/support'),
    path.join(root, 'livekit-app/frontend/src'),
    path.join(root, 'livekit-app/backend/routes'),
    path.join(root, 'livekit-app/backend/lib'),
  ].filter((dir) => fs.existsSync(dir));
}

function displayPath(file) {
  const repo = repoRootFromBackendLib();
  const rel = path.relative(repo, file).replace(/\\/g, '/');
  return rel.startsWith('..') ? file : rel;
}

function extractMatchingLines(content, tokens) {
  const lines = content.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const lower = lines[i].toLowerCase();
    const matchCount = tokens.filter((t) => lower.includes(t)).length;
    if (matchCount === 0) continue;
    const start = Math.max(0, i - 1);
    const end = Math.min(lines.length, i + 2);
    hits.push({
      line: i + 1,
      text: lines.slice(start, end).join('\n').trim(),
      matchCount,
    });
  }
  hits.sort((a, b) => b.matchCount - a.matchCount);
  return hits.slice(0, 3);
}

function walkSearchFiles(dir, root, out, depth = 0) {
  if (depth > 8 || out.length > 400) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSearchFiles(full, root, out, depth + 1);
    } else if (/\.(jsx?|tsx?|md)$/.test(entry.name)) {
      out.push(full);
    }
  }
}

function searchCodebase(query) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const snippets = [];
  const roots = searchRoots();
  for (const root of roots) {
    const files = [];
    walkSearchFiles(root, root, files);
    for (const file of files) {
      if (snippets.length >= MAX_SNIPPETS) break;
      let raw;
      try {
        raw = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const lower = raw.toLowerCase();
      const matchedTokens = tokens.filter((t) => lower.includes(t));
      if (matchedTokens.length === 0) continue;
      if (matchedTokens.length === 1 && tokens.length > 2) continue;

      const lineHits = extractMatchingLines(raw, matchedTokens);
      for (const hit of lineHits) {
        snippets.push({
          path: displayPath(file),
          line: hit.line,
          excerpt: hit.text.slice(0, MAX_SNIPPET_CHARS),
          matchedTokens,
        });
        if (snippets.length >= MAX_SNIPPETS) break;
      }
    }
  }
  return snippets;
}

function formatDocHits(hits) {
  if (!hits?.length) return 'No matching support docs.';
  return hits
    .map(
      (h, i) =>
        `[${i + 1}] ${h.source} — ${h.title} (score ${h.score})\n${h.excerpt?.slice(0, 800) || ''}`
    )
    .join('\n\n---\n\n');
}

function formatCodeSnippets(snippets) {
  if (!snippets.length) return 'No codebase snippets matched.';
  return snippets
    .map((s) => `${s.path}:${s.line}\n${s.excerpt}`)
    .join('\n\n---\n\n');
}

function estimateRetrievalImprovement(question, draftMarkdown) {
  const before = searchSupportDocs(question, { limit: 3 });
  const beforeTop = before[0]?.score || 0;
  const probe = `${question}\n${String(draftMarkdown || '').slice(0, 500)}`;
  const after = searchSupportDocs(probe, { limit: 3 });
  const afterTop = after[0]?.score || 0;
  return {
    beforeTopScore: beforeTop,
    afterTopScore: afterTop,
    wouldLikelyMatch: afterTop > beforeTop || afterTop >= 2,
    topSourcesAfter: after.map((h) => h.source),
  };
}

const SUGGEST_SYSTEM = `You help Parley ops draft knowledge-base entries for docs/support/.
Output ONLY valid JSON:
{
  "target_file": "faq.md or product/meetings.md etc — relative to docs/support/",
  "section_title": "## Short question-style heading",
  "draft_markdown": "Full markdown section starting with ## heading",
  "confidence": 0.0-1.0,
  "rationale": "Why this answers the user question",
  "sources": ["docs/support/... or code path:line", ...]
}

Rules:
- Use only facts supported by the provided doc excerpts and code snippets.
- Do NOT invent UI paths, settings, or product behavior.
- Prefer faq.md for short how-to answers; use product/*.md for deep feature docs.
- Match existing doc tone: numbered steps, bold UI labels, honest limits (e.g. invite expiration not on create form).
- If evidence is insufficient, set confidence below 0.5 and say what is still unknown in rationale.`;

async function suggestKbEntryForGap(gap) {
  if (!gap) return { ok: false, status: 404, error: 'Gap not found' };

  const question = gap.userQuestion || gap.summary || gap.docQuery || '';
  if (!question.trim()) {
    return { ok: false, status: 400, error: 'Gap has no question text' };
  }

  if (!aiEnabled()) {
    return { ok: false, status: 503, error: 'AI not configured for KB suggestions' };
  }

  const docQuery = gap.docQuery || question;
  const docHits = searchSupportDocs(docQuery, { limit: 6 });
  const codeSnippets = searchCodebase(question);
  const existingGapHits = gap.docHits?.length ? gap.docHits : docHits;

  const userPayload = [
    `User question: ${question}`,
    gap.summary ? `AI summary: ${gap.summary}` : null,
    gap.escalationReason ? `Escalation reason: ${gap.escalationReason}` : null,
    gap.proposalType ? `Proposal type: ${gap.proposalType}` : null,
    '',
    'Existing KB search hits:',
    formatDocHits(existingGapHits),
    '',
    'Fresh KB search:',
    formatDocHits(docHits),
    '',
    'Codebase snippets (read-only research):',
    formatCodeSnippets(codeSnippets),
    '',
    `Docs root on server: ${DOCS_ROOT}`,
    'Draft a new or updated KB section to close this gap.',
  ]
    .filter(Boolean)
    .join('\n');

  let parsed;
  try {
    parsed = await callSupportLlm(SUGGEST_SYSTEM, userPayload);
  } catch (e) {
    return { ok: false, status: 502, error: e.message || 'LLM failed' };
  }

  const draft = String(parsed.draft_markdown || '').trim();
  const retrieval = estimateRetrievalImprovement(question, draft);

  return {
    ok: true,
    suggestion: {
      targetFile: String(parsed.target_file || 'faq.md').replace(/^docs\/support\//, ''),
      sectionTitle: String(parsed.section_title || '').slice(0, 200),
      draftMarkdown: draft.slice(0, 8000),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
      rationale: String(parsed.rationale || '').slice(0, 2000),
      sources: Array.isArray(parsed.sources) ? parsed.sources.slice(0, 10).map(String) : [],
      retrieval,
      researched: {
        docHitCount: docHits.length,
        codeSnippetCount: codeSnippets.length,
      },
    },
  };
}

module.exports = {
  suggestKbEntryForGap,
  searchCodebase,
  estimateRetrievalImprovement,
};
