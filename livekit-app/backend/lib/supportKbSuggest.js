const fs = require('fs');
const path = require('path');
const db = require('../db/v2Database');
const { searchSupportDocs, DOCS_ROOT } = require('./supportKnowledge');
const { aiEnabled, callSupportLlm } = require('./supportAgent/llm');

const MAX_SNIPPETS = 16;
const MAX_SNIPPET_CHARS = 700;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'uploads', 'coverage', '__pycache__', 'translation-agent']);

const SHORT_TOKENS = new Set(['tls', 'ssl', 'api', 'faq', 'sms', 'jwt', 'sql']);

const AGENT_BOILERPLATE = [
  'give me a moment',
  'still looking into this',
  'thanks for your patience',
  'thanks for your message',
  'thanks for following up',
];

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 || SHORT_TOKENS.has(w));
}

function expandResearchTokens(tokens, question) {
  const expanded = new Set(tokens);
  const q = String(question || '').toLowerCase();
  if (/encrypt|secur|transcript|privacy|hash|password/.test(q)) {
    [
      'encrypt',
      'encryption',
      'transcript',
      'transcripts',
      'privacy',
      'bcrypt',
      'password',
      'hash',
      'transit',
      'tls',
      'https',
      'secure',
      'store_transcripts',
    ].forEach((t) => expanded.add(t));
  }
  if (/meeting|invite|guest|expir/.test(q)) {
    ['meeting', 'invite', 'guest', 'expiration', 'advanced', 'scheduled'].forEach((t) => expanded.add(t));
  }
  return [...expanded];
}

function repoRootFromBackendLib() {
  return path.resolve(__dirname, '../../..');
}

function searchRoots() {
  const root = repoRootFromBackendLib();
  const appRoot = path.resolve(__dirname, '../..');
  return [
    path.join(root, 'docs/support'),
    path.resolve(__dirname, '../docs/support'),
    path.join(appRoot, 'frontend/src'),
    path.join(root, 'livekit-app/frontend/src'),
    path.join(appRoot, 'routes'),
    path.join(appRoot, 'lib'),
    path.join(root, 'livekit-app/backend/routes'),
    path.join(root, 'livekit-app/backend/lib'),
  ].filter((dir) => fs.existsSync(dir));
}

function displayPath(file) {
  const repo = repoRootFromBackendLib();
  const rel = path.relative(repo, file).replace(/\\/g, '/');
  if (!rel.startsWith('..')) return rel;
  const appRoot = path.resolve(__dirname, '../..');
  return path.relative(appRoot, file).replace(/\\/g, '/');
}

function extractMatchingLines(content, tokens) {
  const lines = content.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const lower = lines[i].toLowerCase();
    const matchCount = tokens.filter((t) => lower.includes(t)).length;
    if (matchCount === 0) continue;
    const start = Math.max(0, i - 1);
    const end = Math.min(lines.length, i + 3);
    hits.push({
      line: i + 1,
      text: lines.slice(start, end).join('\n').trim(),
      matchCount,
    });
  }
  hits.sort((a, b) => b.matchCount - a.matchCount);
  return hits.slice(0, 4);
}

function walkSearchFiles(dir, out, depth = 0) {
  if (depth > 9 || out.length > 500) return;
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
      walkSearchFiles(full, out, depth + 1);
    } else if (/\.(jsx?|tsx?|md)$/.test(entry.name)) {
      out.push(full);
    }
  }
}

function searchCodebase(query) {
  const tokens = expandResearchTokens(tokenize(query), query);
  if (tokens.length === 0) return [];

  const snippets = [];
  const seen = new Set();
  for (const root of searchRoots()) {
    const files = [];
    walkSearchFiles(root, files);
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
      if (matchedTokens.length === 1 && tokens.length > 3) continue;

      const lineHits = extractMatchingLines(raw, matchedTokens);
      for (const hit of lineHits) {
        const key = `${file}:${hit.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
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

function isBoilerplateAgentMessage(body) {
  const lower = String(body || '').toLowerCase();
  return AGENT_BOILERPLATE.some((p) => lower.includes(p));
}

async function loadTicketResearchThread(ticketId) {
  if (!ticketId) return { userMessages: [], staffMessages: [] };
  const rows = await db.all(
    `SELECT author_type, body FROM v2_support_messages
     WHERE ticket_id = ? AND author_type IN ('user', 'staff')
     ORDER BY datetime(created_at) ASC`,
    [ticketId]
  );
  return {
    userMessages: rows.filter((r) => r.author_type === 'user').map((r) => r.body),
    staffMessages: rows.filter((r) => r.author_type === 'staff').map((r) => r.body),
  };
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

const SUGGEST_SYSTEM = `You help Lalia ops draft knowledge-base entries for docs/support/.
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
- Use ONLY facts from: user ticket messages, codebase snippets, existing KB excerpts, Privacy Policy text in snippets.
- Do NOT copy or paraphrase prior AI support agent replies — they may be wrong or vague.
- Do NOT invent UI paths, settings, or product behavior.
- Prefer faq.md for short how-to; product/*.md for security/deep topics (e.g. product/transcripts-security.md).
- For encryption questions: distinguish in transit (HTTPS/TLS, WebRTC) vs at rest; do not claim specific at-rest algorithms unless stated in Privacy Policy or code.
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

  const thread = await loadTicketResearchThread(gap.ticketId);
  const researchQuery = [question, ...thread.userMessages].join(' ');
  const docQuery = gap.docQuery || researchQuery;
  const docHits = searchSupportDocs(researchQuery, { limit: 8 });
  const codeSnippets = searchCodebase(researchQuery);
  const existingGapHits = gap.docHits?.length ? gap.docHits : docHits;

  const userPayload = [
    `Primary user question: ${question}`,
    thread.userMessages.length
      ? `Full user thread:\n${thread.userMessages.map((m, i) => `${i + 1}. ${m}`).join('\n')}`
      : null,
    gap.escalationReason ? `Why AI escalated / lacked KB: ${gap.escalationReason}` : null,
    gap.proposalType ? `Proposal type: ${gap.proposalType}` : null,
    '',
    'IMPORTANT: Ignore any prior AI agent chat replies — they are NOT authoritative.',
    '',
    'Existing KB search hits (at time of gap):',
    formatDocHits(existingGapHits),
    '',
    'Fresh KB search (expanded):',
    formatDocHits(docHits),
    '',
    'Codebase & policy snippets (read-only research):',
    formatCodeSnippets(codeSnippets),
    '',
    `Docs root on server: ${DOCS_ROOT}`,
    'Draft a new or updated KB section to close this gap. Cite concrete sources.',
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
        userMessageCount: thread.userMessages.length,
        searchRoots: searchRoots().map((r) => path.basename(r)),
      },
    },
  };
}

module.exports = {
  suggestKbEntryForGap,
  searchCodebase,
  estimateRetrievalImprovement,
  expandResearchTokens,
  loadTicketResearchThread,
};
