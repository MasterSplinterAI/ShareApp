import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TenantIdSchema } from "@rhule/support-shared";
import { createMemorySqliteAdapter } from "../db/memorySqlite.js";
import { ensureSchema } from "../db/migrate.js";
import { TicketService } from "../tickets/service.js";
import { KnowledgeGapService } from "./service.js";

describe("KnowledgeGapService tenant isolation", () => {
  it("creates and lists gaps scoped by tenantId", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tickets = new TicketService(db);
    const gaps = new KnowledgeGapService(db);

    const a = TenantIdSchema.parse("legalai");
    const b = TenantIdSchema.parse("shareapp");

    const { ticket: ticketA } = await tickets.createTicket({
      tenantId: a,
      body: "How do I file a motion?",
      category: "how_to",
    });
    const { ticket: ticketB } = await tickets.createTicket({
      tenantId: b,
      body: "Share link broken",
      category: "bug",
    });

    const gapA = await gaps.recordKnowledgeGap({
      tenantId: a,
      ticketId: ticketA.id,
      proposalType: "kb_article",
      summary: "Missing motion docs",
      escalationReason: "low_kb_confidence",
      docQuery: "file motion",
    });
    await gaps.recordKnowledgeGap({
      tenantId: b,
      ticketId: ticketB.id,
      proposalType: "other",
      summary: "Share export docs missing",
    });

    assert.equal(gapA.tenantId, "legalai");
    assert.equal(gapA.status, "open");
    assert.equal(gapA.publicNumber, 1);
    assert.equal(gapA.userQuestion, "How do I file a motion?");

    const legalGaps = await gaps.listKnowledgeGaps("legalai");
    const shareGaps = await gaps.listKnowledgeGaps("shareapp");

    assert.equal(legalGaps.length, 1);
    assert.equal(shareGaps.length, 1);
    assert.equal(legalGaps[0]?.summary, "Missing motion docs");
    assert.equal(shareGaps[0]?.summary, "Share export docs missing");

    const leaked = await gaps.getKnowledgeGap("legalai", shareGaps[0]!.id);
    assert.equal(leaked, undefined);
  });

  it("resolves gaps and sets resolvedAt", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tickets = new TicketService(db);
    const gaps = new KnowledgeGapService(db);
    const tenantId = TenantIdSchema.parse("legalai");

    const { ticket } = await tickets.createTicket({
      tenantId,
      body: "Unknown feature",
      category: "how_to",
    });

    const gap = await gaps.recordKnowledgeGap({
      tenantId,
      ticketId: ticket.id,
      summary: "No docs",
    });

    const resolved = await gaps.patchKnowledgeGap(tenantId, gap.id, "resolved");
    assert.equal(resolved?.status, "resolved");
    assert.ok(resolved?.resolvedAt);
  });
});
