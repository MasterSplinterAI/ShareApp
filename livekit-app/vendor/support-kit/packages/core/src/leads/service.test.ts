import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TenantIdSchema } from "@quill/support-shared";
import { createMemorySqliteAdapter } from "../db/memorySqlite.js";
import { ensureSchema } from "../db/migrate.js";
import { LeadService } from "./service.js";

describe("LeadService", () => {
  it("upserts lead and sets SMS opt-in only when phone + marketing", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const leads = new LeadService(db);
    const tenantId = TenantIdSchema.parse("dev");

    const a = await leads.upsertLead({
      tenantId,
      name: "Alex",
      email: "Alex@Example.com",
      marketingOptIn: true,
      source: "public_launcher",
      consentText: "I agree…",
    });
    assert.equal(a.email, "alex@example.com");
    assert.equal(a.marketingEmailOptIn, true);
    assert.equal(a.marketingSmsOptIn, false);

    const b = await leads.upsertLead({
      tenantId,
      name: "Alex R",
      email: "alex@example.com",
      phone: "+1 555 0100",
      marketingOptIn: true,
      source: "public_launcher",
      consentText: "I agree…",
    });
    assert.equal(b.id, a.id);
    assert.equal(b.name, "Alex R");
    assert.equal(b.phone, "+1 555 0100");
    assert.equal(b.marketingSmsOptIn, true);

    const listed = await leads.list(tenantId, { marketingOnly: true });
    assert.equal(listed.length, 1);
  });

  it("requires valid email via schema", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const leads = new LeadService(db);
    await assert.rejects(
      () =>
        leads.upsertLead({
          tenantId: TenantIdSchema.parse("dev"),
          name: "X",
          email: "not-an-email",
          source: "public_launcher",
          marketingOptIn: false,
        }),
    );
  });
});

describe('immutable consent intake',()=>{
 it('keeps an acknowledged opt-out after a later lead overwrite, with separate channels',async()=>{
  const db=createMemorySqliteAdapter();await ensureSchema(db);const leads=new LeadService(db);
  const input={tenantId:TenantIdSchema.parse('dev'),name:'Alex',email:'alex@example.test',source:'public_launcher',consentText:'Email and optional SMS'};
  await leads.upsertLead({...input,marketingOptIn:false});
  await leads.upsertLead({...input,marketingOptIn:true});
  const history=await db.all<any>('SELECT * FROM support_lead_consent_events WHERE email=? ORDER BY revision,channel',['alex@example.test']);
  assert.equal(history.length,4);assert.equal(history.filter(e=>e.channel==='email'&&e.granted===0).length,1);
  assert.equal(history.filter(e=>e.channel==='sms'&&e.granted===1).length,0);
  assert.equal(history[2].revision,2);assert.equal(history[2].consent_text,input.consentText);
 });
});

it('schema restart does not manufacture new consent from an imported lead snapshot',async()=>{
 const db=createMemorySqliteAdapter();await ensureSchema(db);
 await db.run("INSERT INTO support_leads(id,tenant_id,email,name,source,marketing_email_opt_in,marketing_sms_opt_in,created_at,updated_at) VALUES('copied','dev','copy@example.test','Copied','public_launcher',0,0,'2020','2020')");
 await ensureSchema(db);assert.equal((await db.all('SELECT * FROM support_lead_consent_events')).length,0);
});
