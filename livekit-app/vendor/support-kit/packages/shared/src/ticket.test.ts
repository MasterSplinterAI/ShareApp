import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CreateTicketInputSchema,
  KbArticleSchema,
  KbVisibilitySchema,
  ProposalSchema,
  TenantIdSchema,
  TicketKindSchema,
  TicketMessageSchema,
  TicketSchema,
  TicketStatusSchema,
  mapCategoryToKindTopic,
} from "./index.js";

describe("TicketStatusSchema", () => {
  it('parses "open"', () => {
    assert.equal(TicketStatusSchema.parse("open"), "open");
  });

  it("parses waiting_user and escalated", () => {
    assert.equal(TicketStatusSchema.parse("waiting_user"), "waiting_user");
    assert.equal(TicketStatusSchema.parse("escalated"), "escalated");
  });

  it("rejects unknown status", () => {
    assert.throws(() => TicketStatusSchema.parse("bogus"));
  });
});

describe("TicketKindSchema", () => {
  it("parses support bug feature", () => {
    assert.equal(TicketKindSchema.parse("support"), "support");
    assert.equal(TicketKindSchema.parse("bug"), "bug");
    assert.equal(TicketKindSchema.parse("feature"), "feature");
  });
});

describe("mapCategoryToKindTopic", () => {
  it("maps billing to support/billing", () => {
    assert.deepEqual(mapCategoryToKindTopic("billing"), {
      kind: "support",
      topic: "billing",
    });
  });
});

describe("domain schemas require tenantId", () => {
  const tenantId = TenantIdSchema.parse("legalai");
  const now = new Date().toISOString();

  it("parses Ticket with kind+topic", () => {
    const ticket = TicketSchema.parse({
      id: "t1",
      tenantId,
      publicNumber: 1,
      kind: "support",
      topic: "how_to",
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    assert.equal(ticket.kind, "support");
    assert.equal(ticket.topic, "how_to");
    assert.equal(ticket.category, "how_to");
  });

  it("derives kind+topic from legacy category", () => {
    const ticket = TicketSchema.parse({
      id: "t1",
      tenantId,
      publicNumber: 1,
      category: "billing",
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    assert.equal(ticket.kind, "support");
    assert.equal(ticket.topic, "billing");
  });

  it("parses TicketMessage with citationJson", () => {
    const msg = TicketMessageSchema.parse({
      id: "m1",
      tenantId,
      ticketId: "t1",
      authorType: "assistant",
      body: "Help?",
      citationJson: '[{"source":"faq.md"}]',
      createdAt: now,
    });
    assert.equal(msg.body, "Help?");
    assert.ok(msg.citationJson);
  });

  it("parses Proposal", () => {
    const p = ProposalSchema.parse({
      id: "p1",
      tenantId,
      ticketId: "t1",
      proposalType: "reply",
      status: "pending_review",
      summary: "Suggested reply",
      bodyJson: "{}",
      createdAt: now,
    });
    assert.equal(p.status, "pending_review");
  });

  it("parses KbArticle with visibility", () => {
    const a = KbArticleSchema.parse({
      id: "a1",
      tenantId,
      title: "Deploy notes",
      body: "…",
      status: "draft",
      sourceKind: "codegen",
      visibility: "agent",
      sourceKey: "CHANGELOG.md",
      createdAt: now,
      updatedAt: now,
    });
    assert.equal(a.status, "draft");
    assert.equal(a.visibility, "agent");
    assert.equal(KbVisibilitySchema.parse("public"), "public");
  });

  it("parses CreateTicketInput with kind", () => {
    const input = CreateTicketInputSchema.parse({
      tenantId,
      body: "Something broke",
      kind: "bug",
      topic: "other",
      severity: "high",
    });
    assert.equal(input.kind, "bug");
  });
});
