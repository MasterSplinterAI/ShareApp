import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { CodebaseAdapter, CodebaseSearchHit } from "../adapters/types.js";

const DEFAULT_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".data",
  "vendor",
  ".turbo",
  "tmp",
  ".tmp",
]);

const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".md",
  ".mdx",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".css",
  ".sql",
  ".txt",
]);

export interface FilesystemCodebaseOptions {
  /** Absolute repo / app root */
  root: string;
  /** Relative allowlisted directories (e.g. docs/support, server, client/src) */
  allowlist: string[];
  label?: string;
  skipDirs?: string[];
  maxFilesWalk?: number;
}

function isTextPath(path: string): boolean {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_EXT.has(lower.slice(dot));
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .slice(0, 12);
}

function walkFiles(
  absDir: string,
  root: string,
  skip: Set<string>,
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
    if (skip.has(name)) continue;
    const abs = join(absDir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkFiles(abs, root, skip, out, maxFiles);
    } else if (st.isFile() && isTextPath(abs) && st.size > 0 && st.size < 500_000) {
      out.push(abs);
    }
  }
}

function scoreFile(content: string, tokens: string[]): { score: number; snippet: string } {
  const lower = content.toLowerCase();
  let score = 0;
  let bestIdx = -1;
  for (const t of tokens) {
    let idx = lower.indexOf(t);
    let count = 0;
    while (idx !== -1 && count < 8) {
      score += 1;
      if (bestIdx < 0) bestIdx = idx;
      count += 1;
      idx = lower.indexOf(t, idx + t.length);
    }
  }
  if (score === 0) return { score: 0, snippet: "" };
  const start = Math.max(0, bestIdx - 120);
  const snippet = content.slice(start, start + 420).replace(/\s+/g, " ").trim();
  return { score, snippet };
}

/**
 * Host helper: search/read under allowlisted directories of a local codebase.
 * Safe for LegalAI, ShareApp, or any future host — pass different roots/allowlists.
 */
export function createFilesystemCodebaseAdapter(
  options: FilesystemCodebaseOptions,
): CodebaseAdapter {
  const root = resolve(options.root);
  const allowAbs = options.allowlist.map((p) => resolve(root, p));
  const skip = new Set([...(options.skipDirs ?? []), ...DEFAULT_SKIP_DIRS]);
  const maxFiles = options.maxFilesWalk ?? 2500;

  function isAllowed(absPath: string): boolean {
    const resolved = resolve(absPath);
    if (!resolved.startsWith(root + sep) && resolved !== root) return false;
    return allowAbs.some((a) => resolved === a || resolved.startsWith(a + sep));
  }

  return {
    ...(options.label ? { label: options.label } : {}),
    async search(query, opts) {
      const limit = Math.min(Math.max(opts?.limit ?? 10, 1), 30);
      const tokens = tokenize(query);
      if (!tokens.length) return [];

      const files: string[] = [];
      for (const dir of allowAbs) {
        if (!existsSync(dir)) continue;
        const st = statSync(dir);
        if (st.isFile()) {
          if (isTextPath(dir)) files.push(dir);
          continue;
        }
        walkFiles(dir, root, skip, files, maxFiles);
      }

      const hits: Array<CodebaseSearchHit & { _score: number }> = [];
      for (const abs of files) {
        let content: string;
        try {
          content = readFileSync(abs, "utf8");
        } catch {
          continue;
        }
        const { score, snippet } = scoreFile(content, tokens);
        if (score <= 0 || !snippet) continue;
        const rel = relative(root, abs).split(sep).join("/");
        hits.push({ path: rel, snippet, score, _score: score });
      }

      hits.sort((a, b) => b._score - a._score);
      return hits.slice(0, limit).map(({ path, snippet, _score }) => ({
        path,
        snippet,
        score: _score,
      }));
    },

    async readFile(path, opts) {
      const abs = resolve(root, path);
      if (!isAllowed(abs)) return null;
      if (!existsSync(abs)) return null;
      try {
        const st = statSync(abs);
        if (!st.isFile()) return null;
        const max = opts?.maxBytes ?? 20_000;
        if (st.size <= max) {
          return readFileSync(abs, "utf8");
        }
        const chunks: Buffer[] = [];
        const fd = createReadStream(abs, { start: 0, end: max - 1 });
        await new Promise<void>((resolveP, reject) => {
          fd.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          fd.on("end", () => resolveP());
          fd.on("error", reject);
        });
        return Buffer.concat(chunks).toString("utf8");
      } catch {
        return null;
      }
    },
  };
}
