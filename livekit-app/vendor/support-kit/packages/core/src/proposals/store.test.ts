import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TenantIdSchema } from "@rhule/support-shared";
import { createMemorySqliteAdapter } from "../db/memorySqlite.js";
import { ensureSchema } from "../db/migrate.js";
import { TicketService } from "../tickets/service.js";
import { ProposalService } from "./service.js";

describe("ProposalService status machine", () => {
  it("transitions pending_review to approved or rejected", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tickets = new TicketService(db);
    const proposals = new ProposalService(db);
    const tenantId = TenantIdSchema.parse("legalai");

    const { ticket } = await tickets.createTicket({
      tenantId,
      body: "How do I export?",
      category: "how_to",
    });

    const proposal = await proposals.createProposal({
      tenantId,
      ticketId: ticket.id,
      proposalType: "reply",
      summary: "Suggested reply",
      bodyJson: JSON.stringify({ reply: "See docs" }),
      confidence: 0.85,
    });

    assert.equal(proposal.status, "pending_review");

    const approved = await proposals.approveProposal(tenantId, proposal.id, "ops-1");
    assert.equal(approved.status, "approved");
    assert.equal(approved.reviewedBy, "ops-1");
    assert.ok(approved.reviewedAt);

    const { ticket: ticket2 } = await tickets.createTicket({
      tenantId,
      body: "Another question",
      category: "how_to",
    });
    const toReject = await proposals.createProposal({
      tenantId,
      ticketId: ticket2.id,
      proposalType: "reply",
      summary: "Bad reply",
      bodyJson: "{}",
    });

    const rejected = await proposals.rejectProposal(tenantId, toReject.id, "ops-2");
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.reviewedBy, "ops-2");
    assert.ok(rejected.reviewedAt);
  });

  it("rejects invalid status transitions", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tickets = new TicketService(db);
    const proposals = new ProposalService(db);
    const tenantId = TenantIdSchema.parse("legalai");

    const { ticket } = await tickets.createTicket({
      tenantId,
      body: "Help",
      category: "other",
    });

    const proposal = await proposals.createProposal({
      tenantId,
      ticketId: ticket.id,
      proposalType: "reply",
      summary: "Reply",
      bodyJson: "{}",
    });

    await proposals.approveProposal(tenantId, proposal.id, "ops-1");

    await assert.rejects(
      () => proposals.rejectProposal(tenantId, proposal.id, "ops-2"),
      /already handled|cannot transition/,
    );
  });

  it("scopes proposals by tenantId", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tickets = new TicketService(db);
    const proposals = new ProposalService(db);

    const a = TenantIdSchema.parse("legalai");
    const b = TenantIdSchema.parse("shareapp");

    const { ticket: ticketA } = await tickets.createTicket({
      tenantId: a,
      body: "A",
      category: "other",
    });
    const { ticket: ticketB } = await tickets.createTicket({
      tenantId: b,
      body: "B",
      category: "other",
    });

    await proposals.createProposal({
      tenantId: a,
      ticketId: ticketA.id,
      proposalType: "reply",
      summary: "A proposal",
      bodyJson: "{}",
    });
    await proposals.createProposal({
      tenantId: b,
      ticketId: ticketB.id,
      proposalType: "reply",
      summary: "B proposal",
      bodyJson: "{}",
    });

    const legal = await proposals.listProposals("legalai");
    const share = await proposals.listProposals("shareapp");

    assert.equal(legal.length, 1);
    assert.equal(share.length, 1);
    assert.equal(legal[0]?.summary, "A proposal");
    assert.equal(share[0]?.summary, "B proposal");
  });
});
