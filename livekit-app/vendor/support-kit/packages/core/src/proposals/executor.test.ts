import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TenantIdSchema } from "@rhule/support-shared";
import { createMemorySqliteAdapter } from "../db/memorySqlite.js";
import { ensureSchema } from "../db/migrate.js";
import { TicketService } from "../tickets/service.js";
import { ProposalService } from "./service.js";
import { executeProposalAction } from "./executor.js";

describe("atomic proposal transition", () => {
  it("only one concurrent approve wins side effects", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tickets = new TicketService(db);
    const proposals = new ProposalService(db);
    const tenantId = TenantIdSchema.parse("legalai");

    const { ticket } = await tickets.createTicket({
      tenantId,
      body: "Need help",
      category: "how_to",
    });

    const proposal = await proposals.createProposal({
      tenantId,
      ticketId: ticket.id,
      proposalType: "reply",
      summary: "Draft",
      bodyJson: JSON.stringify({ draft_reply: "Here is how…" }),
      confidence: 0.7,
    });

    const brand = { name: "Test", supportAgentName: "Bot", agentAuthorId: "test-ai" };
    const [a, b] = await Promise.all([
      executeProposalAction(
        { tenantId, proposals, tickets, brand },
        proposal.id,
        "send_reply",
        "op-a",
      ),
      executeProposalAction(
        { tenantId, proposals, tickets, brand },
        proposal.id,
        "send_reply",
        "op-b",
      ),
    ]);

    const wins = [a, b].filter((r) => r.ok);
    const losses = [a, b].filter((r) => !r.ok);
    assert.equal(wins.length, 1);
    assert.equal(losses.length, 1);
    const loss = losses[0]!;
    assert.equal(loss.ok, false);
    if (!loss.ok) {
      assert.equal(loss.status, 409);
    }

    const msgs = await tickets.listMessages(tenantId, ticket.id);
    const agentMsgs = msgs.filter((m) => m.authorType === "assistant" || m.authorType === "staff");
    // createTicket adds user msg; only one draft should be posted by the winner
    const drafts = agentMsgs.filter((m) => m.body.includes("Here is how"));
    assert.equal(drafts.length, 1);
  });

  it("soft claim sets assignedTo without approving", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tickets = new TicketService(db);
    const proposals = new ProposalService(db);
    const tenantId = TenantIdSchema.parse("legalai");

    const { ticket } = await tickets.createTicket({
      tenantId,
      body: "Billing?",
      category: "billing",
    });
    const proposal = await proposals.createProposal({
      tenantId,
      ticketId: ticket.id,
      proposalType: "escalate",
      summary: "Escalate",
      bodyJson: JSON.stringify({ draft_reply: "Escalating" }),
    });

    const brand = { name: "Test", supportAgentName: "Bot", agentAuthorId: "test-ai" };
    const result = await executeProposalAction(
      { tenantId, proposals, tickets, brand },
      proposal.id,
      "claim",
      "@Alex",
    );
    assert.equal(result.ok, true);
    const next = await proposals.getProposal(tenantId, proposal.id);
    assert.equal(next?.claimedBy, "@Alex");
    assert.equal(next?.status, "pending_review");
    const t = await tickets.getTicket(tenantId, ticket.id);
    assert.equal(t?.assignedTo, "@Alex");
  });
});
