import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createFileSqliteAdapter } from "./fileSqlite.js";
import { ensureSchema } from "./migrate.js";

describe("createFileSqliteAdapter", () => {
  it("persists rows to a file and reloads them after reopen", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "support-kit-sqlite-"));
    const dbPath = path.join(dir, "support.db");

    const first = createFileSqliteAdapter(dbPath);
    await ensureSchema(first, "support_");
    await first.run(
      `INSERT INTO support_tickets (
        id, tenant_id, public_number, category, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'open', ?, ?)`,
      ["t-demo", "demo", 1, "support", "2026-08-23T00:00:00.000Z", "2026-08-23T00:00:00.000Z"],
    );
    first.close();

    assert.equal(fs.existsSync(dbPath), true);
    assert.notEqual(fs.statSync(dbPath).size, 0);

    const second = createFileSqliteAdapter(dbPath);
    const row = await second.get<{ tenant_id: string }>(
      `SELECT tenant_id FROM support_tickets WHERE id = ?`,
      ["t-demo"],
    );
    assert.equal(row?.tenant_id, "demo");
    second.close();
  });

  it("rejects :memory: so the harness cannot silently go ephemeral", () => {
    assert.throws(() => createFileSqliteAdapter(":memory:"), /file/i);
  });
});

import {createMemorySqliteAdapter} from './memorySqlite.js';
for(const kind of ['file','memory'])it(`${kind} SQLite keeps independent operations outside a pending transaction`,async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'support-consent-isolation-'));
 const db=kind==='file'?createFileSqliteAdapter(path.join(dir,'test.sqlite')):createMemorySqliteAdapter();
 await db.run('CREATE TABLE fixture(id TEXT PRIMARY KEY)');
 let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),gate=new Promise<void>(r=>release=r);
 const tx=db.transaction!(async bound=>{assert.equal(bound.transaction,undefined);await bound.run('INSERT INTO fixture VALUES(?)',['inside']);enter();await gate;throw Error('rollback fixture');});
 const rejected=assert.rejects(tx,/rollback fixture/);await entered;
 let completed=false;const external=db.run('INSERT INTO fixture VALUES(?)',['outside']).then(()=>{completed=true;});
 let readCompleted=false;const reader=db.all('SELECT id FROM fixture ORDER BY id').then(rows=>{readCompleted=true;return rows;});
 await new Promise(r=>setImmediate(r));const early=completed||readCompleted;release();await rejected;await external;
 assert.equal(early,false,'unbound reads/writes must wait for the transaction to finish');
 assert.deepEqual(await reader,[{id:'outside'}]);assert.deepEqual(await db.all('SELECT id FROM fixture'),[{id:'outside'}]);
 await db.transaction!(async bound=>{await assert.rejects(db.run('INSERT INTO fixture VALUES(?)',['wrong-facade']),/bound transaction/);await bound.run('INSERT INTO fixture VALUES(?)',['bound']);});
 if('close' in db)(db as ReturnType<typeof createFileSqliteAdapter>).close();fs.rmSync(dir,{recursive:true,force:true});
});
