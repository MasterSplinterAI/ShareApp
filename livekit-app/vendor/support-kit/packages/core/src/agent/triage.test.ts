import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, beforeEach } from "node:test";
import { TenantIdSchema } from "@rhule/support-shared";
import type { LlmAdapter, OpsNotification, OpsNotifier } from "../adapters/types.js";
import { createMemorySqliteAdapter } from "../db/memorySqlite.js";
import { ensureSchema } from "../db/migrate.js";
import { clearDocsCache } from "../kb/search.js";
import { triageMessage } from "./triage.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../kb/fixtures",
);

const brand = {
  name: "TestApp",
  supportAgentName: "Test Support",
  agentAuthorId: "test-ai",
};

function mockLlm(response: object): LlmAdapter {
  return {
    async complete() {
      return JSON.stringify(response);
    },
  };
}

describe("triageMessage", () => {
  beforeEach(() => {
    clearDocsCache();
  });

  it("how_to with good KB always creates ticket + auto-replies (mock LLM)", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tenantId = TenantIdSchema.parse("legalai");

    const result = await triageMessage(
      {
        db,
        brand,
        docsRoot: fixturesDir,
        llm: mockLlm({
          route: "reply_in_app",
          kind: "support",
          topic: "how_to",
          confidence: 0.9,
          summary: "Upload docs",
          body: {
            draft_reply: "Open Documents and click Upload.",
            sources: ["getting-started.md"],
          },
        }),
      },
      {
        tenantId,
        user: { id: "u1", role: "user" },
        message: "How do I upload a document?",
      },
    );

    assert.equal(result.action, "auto_reply");
    assert.equal(result.autoReplied, true);
    assert.equal(result.ticket.kind, "support");
    assert.ok(["waiting_user", "resolved"].includes(result.ticket.status));
    assert.match(result.reply, /Upload|document/i);
    assert.equal(result.proposal, undefined);

    const rows = await db.all("SELECT id FROM support_tickets WHERE tenant_id = ?", [tenantId]);
    assert.equal(rows.length, 1);
  });

  it("billing topic escalates even with confident draft (sensitive)", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tenantId = TenantIdSchema.parse("legalai");

    const result = await triageMessage(
      {
        db,
        brand,
        docsRoot: fixturesDir,
        llm: mockLlm({
          route: "reply_in_app",
          kind: "support",
          topic: "billing",
          confidence: 0.95,
          summary: "Refund",
          body: { draft_reply: "Go to Settings → Billing." },
        }),
      },
      {
        tenantId,
        user: { id: "u1b", role: "user" },
        message: "How do I request a billing refund?",
      },
    );

    assert.equal(result.action, "ticket");
    assert.equal(result.autoReplied, false);
    assert.equal(result.ticket.status, "escalated");
    assert.equal(result.proposal?.proposalType, "escalate");
  });

  it("logged-in user with contextSummary gets auto_reply on routine billing/plan questions", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tenantId = TenantIdSchema.parse("lalia");

    const result = await triageMessage(
      {
        db,
        brand,
        llm: mockLlm({
          route: "reply_in_app",
          kind: "support",
          topic: "billing",
          confidence: 0.9,
          summary: "Plan and renewal info",
          body: {
            draft_reply: "You are on the **Starter** plan ($49/month) with 1,850 meeting minutes remaining.",
          },
        }),
      },
      {
        tenantId,
        user: {
          id: "u1-billing",
          role: "user",
          planLabel: "Starter",
          contextSummary: "- Plan: Starter ($49/month)\n- Meeting minutes remaining: 1850",
        },
        message: "What plan am I on and how many minutes do I have left on my bill?",
      },
    );

    assert.equal(result.action, "auto_reply");
    assert.equal(result.autoReplied, true);
    assert.match(result.reply, /Starter/);
    assert.equal(result.proposal, undefined);
  });

  it("low confidence bug routes to ticket + bug_fix proposal + gap", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tenantId = TenantIdSchema.parse("legalai");

    const result = await triageMessage(
      {
        db,
        brand,
        docsRoot: fixturesDir,
        llm: mockLlm({
          route: "propose_reply",
          kind: "bug",
          topic: "other",
          confidence: 0.3,
          summary: "App crash on login",
          body: {
            draft_reply: "Sorry about the crash — our team is investigating.",
          },
        }),
      },
      {
        tenantId,
        user: { id: "u2", role: "user" },
        message: "The app crashes when I try to log in",
      },
    );

    assert.equal(result.action, "ticket");
    assert.equal(result.ticket.kind, "bug");
    assert.equal(result.ticket.status, "pending_ops");
    assert.equal(result.proposal?.proposalType, "bug_fix");
    assert.equal(result.proposal?.status, "pending_review");
    assert.ok(result.gap);
    assert.match(result.reply, /Test Support/);
  });

  it("falls back to heuristics when no LLM and KB score is high", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tenantId = TenantIdSchema.parse("legalai");

    const result = await triageMessage(
      {
        db,
        brand,
        docsRoot: fixturesDir,
      },
      {
        tenantId,
        user: { id: "u3", role: "user" },
        message: "How do I upload files to my matter?",
      },
    );

    assert.equal(result.action, "auto_reply");
    assert.equal(result.autoReplied, true);
    assert.ok(result.ticket);
  });

  it("falls back to heuristics for bug without LLM", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tenantId = TenantIdSchema.parse("legalai");

    const result = await triageMessage(
      {
        db,
        brand,
        docsRoot: fixturesDir,
      },
      {
        tenantId,
        user: { id: "u4", role: "user" },
        message: "The app has a bug and crashes on startup",
      },
    );

    assert.equal(result.action, "ticket");
    assert.equal(result.ticket.kind, "bug");
    assert.equal(result.proposal?.proposalType, "bug_fix");
  });

  it("fires opsNotifier for ticket_created and proposal_ready (fire-and-forget)", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tenantId = TenantIdSchema.parse("legalai");
    const sent: OpsNotification[] = [];

    const opsNotifier: OpsNotifier = {
      async sendToOps(notification) {
        sent.push(notification);
      },
    };

    await triageMessage(
      {
        db,
        brand,
        docsRoot: fixturesDir,
        opsNotifier,
        adminBaseUrl: "https://app.example/admin/support",
      },
      {
        tenantId,
        user: { id: "u5", role: "user" },
        message: "The app has a bug and crashes on startup",
      },
    );

    assert.equal(sent.length, 2);
    assert.equal(sent[0]?.kind, "ticket_created");
    assert.equal(sent[1]?.kind, "proposal_ready");
    assert.equal(sent[0]?.ticketPublicNumber, sent[1]?.ticketPublicNumber);
    assert.match(sent[0]?.adminUrl ?? "", /ticket=\d+/);
  });

  it("does not notify ops on auto-reply", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tenantId = TenantIdSchema.parse("legalai");
    const sent: OpsNotification[] = [];

    await triageMessage(
      {
        db,
        brand,
        docsRoot: fixturesDir,
        opsNotifier: {
          async sendToOps(n) {
            sent.push(n);
          },
        },
        llm: mockLlm({
          route: "reply_in_app",
          kind: "support",
          topic: "how_to",
          confidence: 0.95,
          summary: "OK",
          body: { draft_reply: "Here is how." },
        }),
      },
      {
        tenantId,
        user: { id: "u6", role: "user" },
        message: "How do I change my password in settings?",
      },
    );

    assert.equal(sent.length, 0);
  });
});

describe("triageMessage SQLite KB", () => {
  async function insertArticle(
    db: ReturnType<typeof createMemorySqliteAdapter>,
    tenantId: string,
    opts: { id: string; title: string; body: string; status: string },
  ) {
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO support_kb_articles (
        id, tenant_id, title, body, status, source_kind, visibility, source_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        opts.id,
        tenantId,
        opts.title,
        opts.body,
        opts.status,
        "curated",
        "public",
        `docs:${opts.id}`,
        now,
        now,
      ],
    );
  }

  it("answers a how-to from published SQLite KB without docsRoot", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tenantId = TenantIdSchema.parse("legalai");
    await insertArticle(db, tenantId, {
      id: "kb-reset",
      title: "Reset your password",
      body: "Use the forgot-password link on the login page to reset your password.",
      status: "active",
    });

    const result = await triageMessage(
      { db, brand },
      {
        tenantId,
        user: { id: "kb-u1", role: "user" },
        message: "How do I reset my password?",
      },
    );

    assert.equal(result.action, "auto_reply");
    assert.equal(result.autoReplied, true);
    assert.equal(result.proposal, undefined);
    assert.match(result.reply, /forgot-password/i);
    assert.ok(["waiting_user", "resolved"].includes(result.ticket.status));
    assert.ok(result.sources.some((s) => /password/i.test(s.title) || /forgot-password/i.test(s.excerpt)));
  });

  it("uses the published KB body even when an LLM is configured", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tenantId = TenantIdSchema.parse("legalai");
    await insertArticle(db, tenantId, {
      id: "kb-reset-llm",
      title: "Reset your password",
      body: "Use the forgot-password link on the login page to reset your password.",
      status: "active",
    });

    const result = await triageMessage(
      {
        db,
        brand,
        llm: mockLlm({
          route: "propose_reply",
          kind: "support",
          topic: "other",
          confidence: 0.4,
          summary: "Unsure",
          body: { draft_reply: "I am just a stub and should not win." },
        }),
      },
      {
        tenantId,
        user: { id: "kb-u2", role: "user" },
        message: "How do I reset my password?",
      },
    );

    assert.equal(result.action, "auto_reply");
    assert.match(result.reply, /forgot-password/i);
    assert.doesNotMatch(result.reply, /just a stub/i);
  });

  it("does not auto-reply from draft KB articles", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tenantId = TenantIdSchema.parse("legalai");
    await insertArticle(db, tenantId, {
      id: "kb-draft",
      title: "Upload a document",
      body: "Open Documents and click Upload to add a file to your matter.",
      status: "draft",
    });

    const result = await triageMessage(
      { db, brand },
      {
        tenantId,
        user: { id: "kb-u3", role: "user" },
        message: "How do I upload a document?",
      },
    );

    assert.equal(result.action, "ticket");
    assert.equal(result.autoReplied, false);
    assert.equal(result.ticket.status, "pending_ops");
  });

  it("opens a ticket when no published KB article matches", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tenantId = TenantIdSchema.parse("legalai");
    await insertArticle(db, tenantId, {
      id: "kb-unrelated",
      title: "Office hours",
      body: "The downtown office is open weekdays from nine to five.",
      status: "active",
    });

    const result = await triageMessage(
      { db, brand },
      {
        tenantId,
        user: { id: "kb-u4", role: "user" },
        message: "How do I export a matter as a zip archive?",
      },
    );

    assert.equal(result.action, "ticket");
    assert.equal(result.autoReplied, false);
    assert.equal(result.ticket.status, "pending_ops");
  });
});
