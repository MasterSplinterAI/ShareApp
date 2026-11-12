import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TenantIdSchema } from "@quill/support-shared";
import { createMemorySqliteAdapter } from "../db/memorySqlite.js";
import { ensureSchema } from "../db/migrate.js";
import { TicketService } from "./service.js";

describe("TicketStore tenant isolation", () => {
  it("lists only tickets for the requested tenant", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tickets = new TicketService(db);

    const a = TenantIdSchema.parse("legalai");
    const b = TenantIdSchema.parse("shareapp");

    await tickets.createTicket({
      tenantId: a,
      body: "Legal help",
      category: "how_to",
      userId: "u1",
    });
    await tickets.createTicket({
      tenantId: b,
      body: "Share help",
      category: "bug",
      userId: "u2",
    });

    const legal = await tickets.listTickets("legalai");
    const share = await tickets.listTickets("shareapp");

    assert.equal(legal.length, 1);
    assert.equal(share.length, 1);
    assert.equal(legal[0]?.tenantId, "legalai");
    assert.equal(share[0]?.tenantId, "shareapp");

    const leaked = await tickets.getTicket("legalai", share[0]!.id);
    assert.equal(leaked, undefined);
  });

  it("creates initial user message and increments public_number per tenant", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tickets = new TicketService(db);
    const tenantId = TenantIdSchema.parse("legalai");

    const first = await tickets.createTicket({
      tenantId,
      body: "First",
      category: "other",
    });
    const second = await tickets.createTicket({
      tenantId,
      body: "Second",
      category: "other",
    });

    assert.equal(first.ticket.publicNumber, 1);
    assert.equal(second.ticket.publicNumber, 2);

    const messages = await tickets.listMessages(tenantId, first.ticket.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.body, "First");
  });
});

it("all is a concrete tenant, never an aggregation bypass, even for colliding public numbers", async () => {
 const db=createMemorySqliteAdapter();await ensureSchema(db);const service=new TicketService(db);
 const a=await service.createTicket({tenantId:TenantIdSchema.parse("a"),body:"A"});const b=await service.createTicket({tenantId:TenantIdSchema.parse("b"),body:"B"});
 assert.equal(a.ticket.publicNumber,b.ticket.publicNumber);
 assert.deepEqual(await service.listTickets("all"),[]);
 assert.equal(await service.getTicket("all",a.ticket.id),undefined);
 assert.equal(await service.getTicket("all",String(a.ticket.publicNumber)),undefined);
 assert.deepEqual(await service.listMessages("all",a.ticket.id),[]);
 assert.equal(await service.setStatus("all",a.ticket.id,"closed"),undefined);
 assert.equal((await service.getTicket("a",a.ticket.id))?.status,a.ticket.status);
});
