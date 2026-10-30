const fs = require('fs');
const path = require('path');

const DOCS_CANDIDATES = [
  path.resolve(__dirname, '../docs/support'),
  path.resolve(__dirname, '../../../docs/support'),
];

function resolveDocsRoot() {
  for (const candidate of DOCS_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return DOCS_CANDIDATES[0];
}

const DOCS_ROOT = resolveDocsRoot();
let cache = { loadedAt: 0, chunks: [] };
const CACHE_TTL_MS = 5 * 60 * 1000;

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function walkMarkdown(dir, base = dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkMarkdown(full, base));
    else if (entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

function loadChunks() {
  const now = Date.now();
  if (cache.chunks.length && now - cache.loadedAt < CACHE_TTL_MS) return cache.chunks;

  const chunks = [];
  for (const file of walkMarkdown(DOCS_ROOT)) {
    const rel = path.relative(DOCS_ROOT, file).replace(/\\/g, '/');
    const raw = fs.readFileSync(file, 'utf8');
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
  cache = { loadedAt: now, chunks };
  return chunks;
}

function expandQueryTokens(queryTokens) {
  const expanded = new Set(queryTokens);
  const text = queryTokens.join(' ');
  if (/\bexpir|expire|expiry|expiration\b/.test(text) || (text.includes('meeting') && text.includes('link'))) {
    ['expire', 'expiration', 'expiry', 'invite', 'scheduled', 'meeting', 'archived', 'advanced'].forEach((t) =>
      expanded.add(t)
    );
  }
  if (text.includes('schedule') || text.includes('scheduled')) {
    expanded.add('meeting');
    expanded.add('scheduled');
  }
  return [...expanded];
}

function scoreChunk(chunk, queryTokens) {
  let score = 0;
  for (const t of queryTokens) {
    if (chunk.tokens.has(t)) score += 1;
  }
  const lowerTitle = chunk.title.toLowerCase();
  const lowerBody = chunk.body.toLowerCase();
  if (queryTokens.some((t) => t.startsWith('expir')) && lowerBody.includes('advanced invites')) score += 4;
  if (queryTokens.some((t) => t.startsWith('expir')) && lowerBody.includes('not on the create-meeting')) score += 6;
  if (queryTokens.includes('meeting') && lowerTitle.includes('expiration')) score += 3;
  return score;
}

function searchSupportDocs(query, { limit = 5 } = {}) {
  const queryTokens = expandQueryTokens(tokenize(query));
  if (queryTokens.length === 0) return fallbackHits(limit);

  const ranked = loadChunks()
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, queryTokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (ranked.length > 0) {
    return ranked.map(({ chunk, score }) => ({
      source: chunk.source,
      title: chunk.title,
      excerpt: chunk.body.slice(0, 1200),
      score,
    }));
  }

  const questionTokens = queryTokens.filter((t) => t.length > 4);
  if (questionTokens.length > 0) {
    const retry = loadChunks()
      .map((chunk) => ({ chunk, score: scoreChunk(chunk, questionTokens) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    if (retry.length > 0) {
      return retry.map(({ chunk, score }) => ({
        source: chunk.source,
        title: chunk.title,
        excerpt: chunk.body.slice(0, 1200),
        score,
      }));
    }
  }

  return fallbackHits(limit);
}

function fallbackHits(limit) {
  const preferred = loadChunks().filter(
    (c) => c.source.includes('faq.md') || c.source.includes('account-settings')
  );
  const pool = preferred.length ? preferred : loadChunks();
  return pool.slice(0, limit).map((chunk) => ({
    source: chunk.source,
    title: chunk.title,
    excerpt: chunk.body.slice(0, 1200),
    score: 0,
  }));
}

function formatSourcesForPrompt(hits) {
  if (!hits.length) return 'No matching support docs found.';
  return hits
    .map(
      (h, i) =>
        `[${i + 1}] ${h.source} — ${h.title}\n${h.excerpt}${h.excerpt.length >= 1200 ? '…' : ''}`
    )
    .join('\n\n---\n\n');
}

module.exports = {
  searchSupportDocs,
  formatSourcesForPrompt,
  DOCS_ROOT,
};
