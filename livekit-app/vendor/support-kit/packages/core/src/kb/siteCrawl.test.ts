import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { createMemorySqliteAdapter } from "../db/memorySqlite.js";
import { ensureSchema } from "../db/migrate.js";
import type { LlmAdapter } from "../adapters/types.js";
import {
  crawlSite,
  curateDocsToKb,
  curatePagesToKb,
} from "./siteCrawl.js";
import type { CrawledPage } from "./siteCrawl.js";

function mockLlm(articles: Array<{ title: string; body: string }>): LlmAdapter {
  let i = 0;
  return {
    async complete() {
      const a = articles[i % articles.length] ?? { title: "Q?", body: "A" };
      i += 1;
      return JSON.stringify({ title: a.title, body: a.body });
    },
  };
}

const HTML_PAGE = `<!doctype html><html><head><title>Pricing — DemoCo</title></head>
<body><h1>Pricing</h1><p>Plans: Free, Pro $20/mo, Team $75/mo.</p>
<a href="/pricing">Pricing</a><a href="/about">About</a><a href="/plans">Plans</a></body></html>`;
const SITEMAP = `<?xml version="1.0"?><urlset><url><loc>https://demo.co/pricing</loc></url><url><loc>https://demo.co/about</loc></url></urlset>`;
const DOC_TXT = "Pro is $20/mo, includes unlimited tickets.\nTeam is $75/mo, SSO.";

describe("kb/siteCrawl", () => {
  it("crawlSite: uses sitemap, falls back to homepage links", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url.endsWith("/sitemap.xml")) {
        return { ok: true, status: 200, text: async () => SITEMAP } as unknown as Response;
      }
      if (url === "https://demo.co/pricing" || url === "https://demo.co/about") {
        return { ok: true, status: 200, text: async () => HTML_PAGE } as unknown as Response;
      }
      return { ok: true, status: 200, text: async () => HTML_PAGE } as unknown as Response;
    }) as unknown as typeof fetch;

    const pages = await crawlSite("demo.co", { fetchImpl, maxPages: 10 });
    assert.ok(calls.includes("https://demo.co/sitemap.xml"));
    assert.equal(pages.length, 2);
    assert.ok(pages.every((p) => p.text.includes("Pricing")));
  });

  it("curatePagesToKb: writes draft curated articles keyed by crawl:<url>", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const pages: CrawledPage[] = [
      { url: "https://demo.co/pricing", title: "Pricing", text: "Pro $20/mo" },
      { url: "https://demo.co/about", title: "About", text: "We build demo products." },
    ];
    const articles = await curatePagesToKb(
      db,
      "dev",
      pages,
      mockLlm([
        { title: "How much do plans cost?", body: "Pro is $20/mo." },
        { title: "What does DemoCo do?", body: "DemoCo builds demo products." },
      ]),
    );
    assert.equal(articles.length, 2);
    for (const a of articles) {
      assert.equal(a.status, "draft");
      assert.equal(a.sourceKind, "curated");
      assert.ok(a.sourceKey!.startsWith("crawl:"));
    }
  });

  it("curateDocsToKb: writes draft curated articles keyed by upload:<name>", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const articles = await curateDocsToKb(
      db,
      "dev",
      [
        { name: "pricing.txt", content: DOC_TXT },
        { name: "empty.txt", content: "   " },
      ],
      mockLlm([{ title: "What's included in Pro?", body: "Pro ($20/mo) includes unlimited tickets." }]),
    );
    assert.equal(articles.length, 1);
    assert.equal(articles[0]!.sourceKey, "upload:pricing.txt");
    assert.equal(articles[0]!.title, "What's included in Pro?");
  });
});
