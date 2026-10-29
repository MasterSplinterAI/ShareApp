import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, beforeEach } from "node:test";
import { TenantIdSchema } from "@rhule/support-shared";
import type { LlmAdapter } from "../adapters/types.js";
import { createMemorySqliteAdapter } from "../db/memorySqlite.js";
import { ensureSchema } from "../db/migrate.js";
import { clearDocsCache } from "../kb/search.js";
import { createSupportRouter } from "../index.js";
import { createMockResponse } from "./createRouter.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../kb/fixtures",
);

const tenantId = TenantIdSchema.parse("legalai");
const brand = { name: "TestApp", supportAgentName: "Test Support", agentAuthorId: "test-ai" };

function mockLlm(response: object): LlmAdapter {
  return {
    async complete() {
      return JSON.stringify(response);
    },
  };
}

describe("createSupportRouter HTTP API", () => {
  beforeEach(() => {
    clearDocsCache();
  });

  it("GET /health returns ok without auth", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => null,
    });

    const { res, done } = createMockResponse();
    await router.handler({ method: "GET", url: "/health" }, res);
    const out = await done;

    assert.equal(out.statusCode, 200);
    assert.equal((out.body as { ok: boolean }).ok, true);
    assert.equal((out.body as { brand: string }).brand, "TestApp");
  });

  it("POST /chat requires auth", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => null,
    });

    const { res, done } = createMockResponse();
    await router.handler(
      { method: "POST", url: "/chat", body: { message: "hello" } },
      res,
    );
    const out = await done;

    assert.equal(out.statusCode, 401);
  });

  it("POST /chat auto-replies when KB matches (docsRoot)", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      docsRoot: fixturesDir,
      llm: mockLlm({
        route: "reply_in_app",
        kind: "support",
        topic: "how_to",
        confidence: 0.9,
        summary: "Upload help",
        body: { draft_reply: "Open Documents and click Upload." },
      }),
      resolveUser: () => ({ id: "u1", role: "user" }),
    });

    const { res, done } = createMockResponse();
    await router.handler(
      {
        method: "POST",
        url: "/chat",
        body: { message: "How do I upload a document?" },
      },
      res,
    );
    const out = await done;

    assert.equal(out.statusCode, 200);
    assert.equal((out.body as { action: string }).action, "auto_reply");
    assert.equal((out.body as { autoReplied: boolean }).autoReplied, true);
    assert.ok((out.body as { ticket: { publicNumber: number } }).ticket.publicNumber);
  });

  it("GET /tickets lists user tickets", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => ({ id: "u1", role: "user" }),
    });

    const createRes = createMockResponse();
    await router.handler(
      { method: "POST", url: "/tickets", body: { body: "Need help" } },
      createRes.res,
    );
    await createRes.done;

    const { res, done } = createMockResponse();
    await router.handler({ method: "GET", url: "/tickets" }, res);
    const out = await done;

    assert.equal(out.statusCode, 200);
    const tickets = (out.body as { tickets: unknown[] }).tickets;
    assert.equal(tickets.length, 1);
  });

  it("GET /tickets/:id returns ticket and messages", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => ({ id: "u1", role: "user" }),
    });

    const createRes = createMockResponse();
    await router.handler(
      { method: "POST", url: "/tickets", body: { body: "Ticket body" } },
      createRes.res,
    );
    const created = await createRes.done;
    const ticketId = (created.body as { ticket: { id: string } }).ticket.id;

    const { res, done } = createMockResponse();
    await router.handler({ method: "GET", url: `/tickets/${ticketId}` }, res);
    const out = await done;

    assert.equal(out.statusCode, 200);
    assert.equal((out.body as { ticket: { id: string } }).ticket.id, ticketId);
    assert.equal((out.body as { messages: unknown[] }).messages.length, 1);
  });

  it("returns 404 for unknown routes", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => ({ id: "u1", role: "user" }),
    });

    const { res, done } = createMockResponse();
    await router.handler({ method: "GET", url: "/unknown" }, res);
    const out = await done;

    assert.equal(out.statusCode, 404);
  });

it("POST /chat auto-replies from published SQLite KB without docsRoot", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO support_kb_articles (
        id, tenant_id, title, body, status, source_kind, visibility, source_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "kb-chat-reset",
        tenantId,
        "Reset your password",
        "Use the forgot-password link on the login page to reset your password.",
        "active",
        "curated",
        "public",
        "docs:reset.md",
        now,
        now,
      ],
    );

    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => ({ id: "u-kb", role: "user" }),
    });

    const { res, done } = createMockResponse();
    await router.handler(
      {
        method: "POST",
        url: "/chat",
        body: { message: "How do I reset my password?" },
      },
      res,
    );
    const out = await done;

    assert.equal(out.statusCode, 200);
    assert.equal((out.body as { action: string }).action, "auto_reply");
    assert.equal((out.body as { autoReplied: boolean }).autoReplied, true);
    assert.match(String((out.body as { reply?: string }).reply), /forgot-password/i);
    assert.ok((out.body as { ticket: { publicNumber: number } }).ticket.publicNumber);
  });

  it("POST /admin/kb/ingest/website requires auth", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => null,
      llm: mockLlm({}),
    });

    const { res, done } = createMockResponse();
    await router.handler(
      { method: "POST", url: "/admin/kb/ingest/website", body: { url: "https://demo.co" } },
      res,
    );
    const out = await done;
    assert.equal(out.statusCode, 401);
  });

  it("POST /admin/kb/ingest/website curates crawled pages into KB drafts", async () => {
    const db = createMemorySqliteAdapter();
    const llm = {
      async complete() {
        return JSON.stringify({
          title: "How much do plans cost?",
          body: "Pro is $20/mo; Team is $75/mo.",
        });
      },
    };
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => ({ id: "admin1", role: "admin" }),
      llm,
      kbIngest: { webhookSecret: "s3cret" },
    });

    // Hermetic: serve a fake site on a local port (homepage links to 2 pages).
    const { createServer } = await import("node:http");
    const pages = ["/pricing", "/about"];
    const server = createServer((req, res) => {
      if (req.url === "/sitemap.xml") {
        res.statusCode = 404;
        res.end("<html><body>Nope</body></html>");
        return;
      }
      if (req.url === "/" || req.url === "/") {
        res.end(
          `<!doctype html><html><head><title>DemoCo</title></head><body>` +
            `<h1>DemoCo</h1><p>About us</p>` +
            pages.map((p) => `<a href="${p}">${p}</a>`).join("") +
            `</body></html>`,
        );
        return;
      }
      const page = pages.includes(req.url ?? "") ? req.url : null;
      res.end(
        `<!doctype html><html><head><title>${page} — DemoCo</title></head>` +
        `<body><h1>${page}</h1><p>Content about ${page}.</p></body></html>`,
      );
    });
    const port = await new Promise<number>((resolve, reject) => {
      const onListen = (p: number) => resolve(p);
      server.once("listening", () => onListen((server.address() as { port: number }).port));
      server.on("error", reject);
      server.listen(0, "127.0.0.1");
    });
    const base = `http://127.0.0.1:${port}`;

    const { res, done } = createMockResponse();
    await router.handler(
      {
        method: "POST",
        url: "/admin/kb/ingest/website",
        body: { url: base, maxPages: 5 },
        headers: { "x-support-ingest-token": "s3cret" },
      },
      res,
    );
    const out = await done;
    server.close();

    assert.equal(out.statusCode, 200);
    const body = out.body as { ok: boolean; count: number; pagesCrawled: number; articles: Array<{ sourceKey: string }> };
    assert.equal(body.ok, true);
    assert.equal(body.pagesCrawled, 2);
    assert.equal(body.count, 2);
    assert.equal(body.articles![0]!.sourceKey, "crawl:http://127.0.0.1:" + port + "/pricing");
  });

  it("POST /admin/kb/ingest/uploads curates uploaded docs into KB drafts", async () => {
    const db = createMemorySqliteAdapter();
    const llm = {
      async complete() {
        return JSON.stringify({
          title: "What's included in Pro?",
          body: "Pro ($20/mo) includes unlimited tickets.",
        });
      },
    };
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => ({ id: "admin1", role: "admin" }),
      llm,
      kbIngest: { webhookSecret: "s3cret" },
    });

    const { res, done } = createMockResponse();
    await router.handler(
      {
        method: "POST",
        url: "/admin/kb/ingest/uploads",
        body: { docs: [{ name: "pricing.txt", content: "Pro is $20/mo, includes unlimited tickets." }] },
        headers: { "x-support-ingest-token": "s3cret" },
      },
      res,
    );
    const out = await done;

    assert.equal(out.statusCode, 200);
    const body = out.body as { ok: boolean; count: number; articles: Array<{ sourceKey: string }> };
    assert.equal(body.ok, true);
    assert.equal(body.count, 1);
    assert.equal(body.articles![0]!.sourceKey, "upload:pricing.txt");
  });

  it("GET /embed serves the self-contained embed page (text/html)", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => null,
    });

    const { res, done } = createMockResponse();
    await router.handler({ method: "GET", url: "/embed" }, res);
    const out = await done;

    assert.equal(out.statusCode, 200);
    assert.match(
      String(out.headers["content-type"]),
      /text\/html/,
    );
    const html = String(out.body);
    assert.ok(html.includes("<!doctype html>"));
    assert.ok(html.includes("TestApp")); // brand name in the embed header
    assert.ok(html.includes("Support")); // agent name
  });

  it("GET /embed uses the per-request tenant brand when resolveTenant resolves", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => null,
      resolveTenant: (_req, requested) =>
        requested === "acme"
          ? { tenantId: "acme", brand: { name: "Acme Corp", supportAgentName: "Acme Assist", agentAuthorId: "u1" } }
          : null,
    });

    const { res, done } = createMockResponse();
    await router.handler({ method: "GET", url: "/embed?tenant=acme" }, res);
    const out = await done;

    assert.equal(out.statusCode, 200);
    const html = String(out.body);
    assert.ok(html.includes("Acme Corp"));
    assert.ok(html.includes("Acme Assist"));
  });

  it("tenant registry: admin CRUD via /tenants", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => ({ id: "admin1", role: "admin" }),
    });

    // create
    let { res, done } = createMockResponse();
    await router.handler(
      { method: "POST", url: "/tenants", body: { name: "Acme Corp", domain: "acme.co" } },
      res,
    );
    let out = await done;
    assert.equal(out.statusCode, 201);
    const created = out.body as {
      ok: boolean;
      tenant: { id: string; name: string; domain: string | null };
      ingestToken: string;
    };
    assert.equal(created.ok, true);
    assert.equal(created.tenant.name, "Acme Corp");
    assert.equal(created.tenant.domain, "acme.co");
    assert.ok(created.ingestToken.length > 0);
    const tid = created.tenant.id;

    // list
    ({ res, done } = createMockResponse());
    await router.handler({ method: "GET", url: "/tenants" }, res);
    out = await done;
    assert.equal(out.statusCode, 200);
    const listed = out.body as { tenants: Array<{ name: string }> };
    assert.equal(listed.tenants.length, 1);
    assert.equal(listed.tenants[0]!.name, "Acme Corp");

    // get by id
    ({ res, done } = createMockResponse());
    await router.handler({ method: "GET", url: `/tenants/${tid}` }, res);
    out = await done;
    assert.equal(out.statusCode, 200);
    assert.equal((out.body as { tenant: { id: string } }).tenant.id, tid);

    // patch
    ({ res, done } = createMockResponse());
    await router.handler(
      { method: "PATCH", url: `/tenants/${tid}`, body: { name: "Acme Industries" } },
      res,
    );
    out = await done;
    assert.equal(out.statusCode, 200);
    assert.equal((out.body as { tenant: { name: string } }).tenant.name, "Acme Industries");

    // delete
    ({ res, done } = createMockResponse());
    await router.handler({ method: "DELETE", url: `/tenants/${tid}` }, res);
    out = await done;
    assert.equal(out.statusCode, 200);
    assert.equal((out.body as { ok: boolean }).ok, true);
  });

  it("tenant registry requires admin", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => null,
    });

    const { res, done } = createMockResponse();
    await router.handler({ method: "POST", url: "/tenants", body: { name: "X" } }, res);
    const out = await done;
    assert.equal(out.statusCode, 401);
  });

  it("POST /chat resolves the per-request tenant (brand + data isolation)", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      llm: mockLlm({
        route: "reply_in_app",
        kind: "support",
        topic: "how_to",
        confidence: 0.9,
        summary: "Upload help",
        body: { draft_reply: "Open Documents and click Upload." },
      }),
      resolveUser: () => ({ id: "u1", role: "user" }),
      resolveTenant: (_req, requested) =>
        requested === "acme"
          ? { tenantId: "acme", brand: { name: "Acme Corp", supportAgentName: "Acme Assist", agentAuthorId: "u1" } }
          : null,
    });

    // Seed a KB article for the acme tenant so the resolved tenant's KB is visible.
    const { ingestCodegenArticle } = await import("../kb/codegen.js");
    await ingestCodegenArticle(
      db,
      {
        tenantId: "acme",
        title: "Acme FAQ",
        body: "Acme Corp answers.",
        sourceKey: "curated:acme-faq",
        tablePrefix: "support_",
      },
    );

    const { res, done } = createMockResponse();
    await router.handler(
      {
        method: "POST",
        url: "/chat",
        body: { message: "How do I upload a document?" },
        headers: { "x-tenant-id": "acme" },
      },
      res,
    );
    const out = await done;

    assert.equal(out.statusCode, 200);
    assert.equal((out.body as { action: string }).action, "ticket");
    // The ticket was created under the acme tenant, not the default.
    const rows = await db.all<{ tenant_id: string; status: string }>(
      "SELECT tenant_id, status FROM support_tickets",
    );
    const acmeTicket = rows.find((r) => r.tenant_id === "acme");
    assert.ok(acmeTicket, "expected a ticket under tenant 'acme'");
  });
});
