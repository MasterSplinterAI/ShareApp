import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureMarketingSchema, type MarketingDbAdapter } from './schema.js';
import {
  activateMarketingAuthority, applyMarketingProjection, captureMarketingProjection,
  ensureMarketingAuthority, exportMarketingPage, freezeMarketingAuthority,
  importMarketingPage, marketingInventory, MARKETING_HISTORY_TABLES, readMarketingAuthority,
  runMarketingTransfer, startMarketingCache,
} from './authorityTransfer.js';

function fixture() {
  const database = new DatabaseSync(':memory:');
  const db: MarketingDbAdapter = {
    async run(sql, params = []) { return { changes: Number(database.prepare(sql).run(...params as any[]).changes) }; },
    async get<T>(sql: string, params: unknown[] = []) { return database.prepare(sql).get(...params as any[]) as T | undefined; },
    async all<T>(sql: string, params: unknown[] = []) { return database.prepare(sql).all(...params as any[]) as T[]; },
    async transaction<T>(work: (tx: MarketingDbAdapter) => Promise<T>) {
      database.exec('BEGIN');
      try { const result = await work(db); database.exec('COMMIT'); return result; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
  };
  return { db, close: () => database.close() };
}

async function copy(source: MarketingDbAdapter, target: MarketingDbAdapter, generation: number) {
  const counts = {} as Record<string,number>;
  for (const table of MARKETING_HISTORY_TABLES) {
    let cursor = '', pages = 0;
    for (;;) {
      const page = await exportMarketingPage(source,'lalia',generation,table,cursor);
      await importMarketingPage(target,'lalia',generation,table,page.rows);
      await importMarketingPage(target,'lalia',generation,table,page.rows);
      pages++;
      if (!page.next) break;
      cursor = page.next;
    }
    counts[table] = pages;
  }
  return counts;
}

test('marketing pages reconcile idempotently, keep one writer and reverse an unchanged handoff', async t => {
  const app = fixture(), hub = fixture();
  t.after(() => { app.close(); hub.close(); });
  await ensureMarketingSchema(app.db); await ensureMarketingSchema(hub.db);
  await ensureMarketingAuthority(app.db,'lalia','legacy');
  await ensureMarketingAuthority(hub.db,'lalia','frozen');
  for (let i = 0; i < 51; i++) {
    await app.db.run("INSERT INTO mkt_posts(id,tenant_id,slug,title,status,created_at,updated_at) VALUES (?,'lalia',?,?,'published','2026-01-01','2026-01-01')", [`post-${i}`,`article-${i}`,`Article ${i}`]);
  }
  await app.db.run("INSERT INTO mkt_campaigns(id,tenant_id,name,segment_id,subject,body_html,status,created_at,updated_at) VALUES ('campaign','lalia','Campaign','blog_subscribers','Fixture','','scheduled','2026-01-01','2026-01-01')");
  await freezeMarketingAuthority(app.db,'lalia',1);
  await assert.rejects(exportMarketingPage(app.db,'lalia',2,'mkt_posts',''),/Reconcile scheduled/);
  await app.db.run("UPDATE mkt_campaigns SET status='sent' WHERE id='campaign'");
  await app.db.run("INSERT INTO mkt_campaign_recipients(id,campaign_id,tenant_id,email,status,provider_message_id,created_at,updated_at) VALUES ('recipient','campaign','lalia','fixture@example.test','sent','provider-fixture','2026-01-01','2026-01-01')");
  const inventory = await marketingInventory(app.db,'lalia');
  await assert.rejects(activateMarketingAuthority(app.db,'lalia',2,'legacy',inventory),/wrong authority role/);
  await assert.rejects(activateMarketingAuthority(hub.db,'lalia',2,'central',inventory),/reconciliation failed/);
  assert.equal((await copy(app.db,hub.db,2)).mkt_posts,2);
  const existing = (await exportMarketingPage(app.db,'lalia',2,'mkt_posts','')).rows[0];
  await assert.rejects(importMarketingPage(hub.db,'lalia',2,'mkt_posts',[{...existing,title:'Conflicting title'}]),/history conflict/);
  await activateMarketingAuthority(hub.db,'lalia',2,'central',inventory);
  await startMarketingCache(app.db,'lalia',2);
  const snapshot = await captureMarketingProjection(hub.db,'lalia');
  assert.equal(await applyMarketingProjection(app.db,'lalia',snapshot),true);
  assert.equal(await applyMarketingProjection(app.db,'lalia',snapshot),false);
  assert.equal((await readMarketingAuthority(app.db,'lalia'))?.mode,'cache');
  assert.equal((await readMarketingAuthority(hub.db,'lalia'))?.mode,'central');
  await freezeMarketingAuthority(hub.db,'lalia',2);
  await freezeMarketingAuthority(app.db,'lalia',2);
  await copy(hub.db,app.db,3);
  await activateMarketingAuthority(app.db,'lalia',3,'legacy',inventory);
  await runMarketingTransfer(hub.db,'lalia','central',{action:'standby',businessId:'lalia',generation:3});
  assert.equal((await readMarketingAuthority(app.db,'lalia'))?.mode,'legacy');
  assert.equal((await readMarketingAuthority(hub.db,'lalia'))?.mode,'frozen');
});

test('a newer cache snapshot removes an unpublished post and rejects old generations', async t => {
  const app = fixture(), hub = fixture();
  t.after(() => { app.close(); hub.close(); });
  await ensureMarketingSchema(app.db); await ensureMarketingSchema(hub.db);
  await ensureMarketingAuthority(app.db,'lalia','legacy');
  await ensureMarketingAuthority(hub.db,'lalia','frozen');
  await app.db.run("INSERT INTO mkt_posts(id,tenant_id,slug,title,status,created_at,updated_at) VALUES ('post','lalia','original-url','Article','published','2026-01-01','2026-01-01')");
  await freezeMarketingAuthority(app.db,'lalia',1);
  await copy(app.db,hub.db,2);
  await activateMarketingAuthority(hub.db,'lalia',2,'central',await marketingInventory(app.db,'lalia'));
  await startMarketingCache(app.db,'lalia',2);
  const original = await captureMarketingProjection(hub.db,'lalia');
  await applyMarketingProjection(app.db,'lalia',original);
  assert.equal(original.posts[0].slug,'original-url');
  await hub.db.run("UPDATE mkt_posts SET status='approved' WHERE id='post'");
  const removed = await captureMarketingProjection(hub.db,'lalia');
  assert.equal(removed.revision,original.revision+1);
  assert.equal(await applyMarketingProjection(app.db,'lalia',removed),true);
  assert.equal(await applyMarketingProjection(app.db,'lalia',original),false);
  assert.equal(await applyMarketingProjection(app.db,'lalia',{...original,generation:1,revision:999}),false);
  assert.equal((await app.db.get<{status:string}>("SELECT status FROM mkt_posts WHERE id='post'"))?.status,'approved');
});
