import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TenantIdSchema } from "@quill/support-shared";
import { createMemorySqliteAdapter } from "../db/memorySqlite.js";
import { ensureSchema } from "../db/migrate.js";
import { searchActiveArticles } from "./search.js";
import {
  ingestCodegenArticle,
  ingestFromChangelog,
  promoteKbArticle,
} from "./codegen.js";

describe("codegen KB ingestion", () => {
  it("excludes draft from searchActiveArticles until promoted", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tenantId = TenantIdSchema.parse("legalai");

    const draft = await ingestCodegenArticle(db, {
      tenantId,
      title: "Deploy notes",
      body: "New billing refund flow deployed",
      sourceKey: "docs/deploy-notes.md",
      gitSha: "abc123",
      path: "docs/deploy-notes.md",
    });

    assert.equal(draft.status, "draft");
    assert.equal(draft.sourceKind, "codegen");

    const beforePromote = await searchActiveArticles(db, tenantId, {
      query: "billing refund",
    });
    assert.equal(beforePromote.length, 0);

    const active = await promoteKbArticle(db, tenantId, draft.id);
    assert.equal(active.status, "active");

    const afterPromote = await searchActiveArticles(db, tenantId, {
      query: "billing refund",
    });
    assert.equal(afterPromote.length, 1);
    assert.equal(afterPromote[0]?.id, draft.id);
    assert.equal(afterPromote[0]?.title, "Deploy notes");
  });

  it("upserts by tenant_id + source_kind + source_key", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tenantId = TenantIdSchema.parse("legalai");

    const first = await ingestCodegenArticle(db, {
      tenantId,
      title: "v1",
      body: "first body",
      sourceKey: "changelog:release-1",
    });

    const second = await ingestCodegenArticle(db, {
      tenantId,
      title: "v2",
      body: "updated body with billing refund",
      sourceKey: "changelog:release-1",
      gitSha: "def456",
    });

    assert.equal(second.id, first.id);
    assert.equal(second.title, "v2");
    assert.equal(second.body, "updated body with billing refund");
    assert.equal(second.status, "draft");

    const rows = await db.all(
      `SELECT id FROM support_kb_articles WHERE tenant_id = ? AND source_key = ?`,
      [tenantId, "changelog:release-1"],
    );
    assert.equal(rows.length, 1);
  });

  it("ingestFromChangelog splits ## sections into draft articles", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tenantId = TenantIdSchema.parse("legalai");

    const changelog = `# Changelog

## Billing improvements
Added refund workflow.

## Login fixes
Fixed crash on startup.
`;

    const articles = await ingestFromChangelog(db, tenantId, changelog, {
      gitSha: "sha1",
    });

    assert.equal(articles.length, 2);
    assert.equal(articles[0]?.sourceKey, "changelog:billing-improvements");
    assert.equal(articles[1]?.sourceKey, "changelog:login-fixes");
    assert.equal(articles.every((a) => a.status === "draft"), true);

    const active = await searchActiveArticles(db, tenantId);
    assert.equal(active.length, 0);
  });
});

describe('immutable publication revisions', () => {
  it('keeps the approved snapshot when imports and editors create later drafts', async () => {
    const db = createMemorySqliteAdapter(); await ensureSchema(db);
    const first = await ingestCodegenArticle(db, {tenantId:'legalai',title:'Approved',body:'approved refund policy',sourceKey:'policy',visibility:'public'});
    const published = await promoteKbArticle(db,'legalai',first.id,undefined,{revisionId:first.revisionId});
    const imported = await ingestCodegenArticle(db, {tenantId:'legalai',title:'Unreviewed',body:'unreviewed secret policy',sourceKey:'policy',visibility:'internal',preserveActive:true});
    assert.notEqual(imported.revisionId,first.revisionId);
    assert.equal(imported.publishedRevisionId,published.revisionId);
    assert.equal((await searchActiveArticles(db,'legalai',{publicAudience:true}))[0]?.body,'approved refund policy');
    const {updateKbArticle}=await import('./codegen.js');
    const edited=await updateKbArticle(db,'legalai',first.id,{body:'edited secret'});
    assert.notEqual(edited.revisionId,imported.revisionId);
    assert.equal((await db.get<any>('SELECT body FROM support_kb_revisions WHERE id=?',[imported.revisionId]))?.body,'unreviewed secret policy');
    assert.equal((await searchActiveArticles(db,'legalai',{publicAudience:true}))[0]?.body,'approved refund policy');
  });
  it('rejects stale reviewed revisions and publication pointers, and deprecates without deleting history', async()=>{
    const db=createMemorySqliteAdapter(); await ensureSchema(db);
    const a=await ingestCodegenArticle(db,{tenantId:'legalai',title:'A',body:'refund A',sourceKey:'a',visibility:'public'});
    const b=await ingestCodegenArticle(db,{tenantId:'legalai',title:'B',body:'refund B',sourceKey:'a',visibility:'public'});
    await assert.rejects(()=>promoteKbArticle(db,'legalai',a.id,undefined,{revisionId:a.revisionId}),/revision|changed/i);
    const active=await promoteKbArticle(db,'legalai',a.id,undefined,{revisionId:b.revisionId,expectedPublishedRevisionId:null});
    await assert.rejects(()=>promoteKbArticle(db,'legalai',a.id,undefined,{revisionId:b.revisionId,expectedPublishedRevisionId:null}),/revision|changed/i);
    const {deprecateKbArticle}=await import('./codegen.js');
    await deprecateKbArticle(db,'legalai',a.id);
    assert.equal((await searchActiveArticles(db,'legalai')).length,0);
    assert.equal((await db.get<any>('SELECT count(*) AS n FROM support_kb_revisions WHERE article_id=?',[a.id]))?.n,2);
    assert.equal(active.publishedRevisionId,b.revisionId);
  });
  it('backfills legacy approved content idempotently with provenance',async()=>{
    const db=createMemorySqliteAdapter();await ensureSchema(db);
    await db.run("INSERT INTO support_kb_articles(id,tenant_id,title,body,status,source_kind,visibility,created_at,updated_at) VALUES('old','legalai','Old','approved old','active','curated','public','2020','2020')");
    await ensureSchema(db);await ensureSchema(db);
    const row=await db.get<any>('SELECT * FROM support_kb_articles WHERE id=?',['old']);
    assert.equal(row.published_revision_id,'legacy:old');
    assert.equal((await db.get<any>('SELECT count(*) AS n FROM support_kb_revisions WHERE article_id=?',['old']))?.n,1);
    assert.equal((await searchActiveArticles(db,'legalai',{publicAudience:true}))[0]?.body,'approved old');
  });
});

it('complete document snapshots mark missing sources for review without unpublishing',async()=>{
  const {ingestDocsSources}=await import('./codegen.js');
  const db=createMemorySqliteAdapter();await ensureSchema(db);
  const [a,b]=await ingestDocsSources(db,'legalai',[{path:'nested/a.md',body:'A'},{path:'nested/b.md',body:'B'}],{gitSha:'rev-1'});
  await promoteKbArticle(db,'legalai',a!.id);await promoteKbArticle(db,'legalai',b!.id);
  await ingestDocsSources(db,'legalai',[{path:'nested/a.md',body:'new A'}],{gitSha:'rev-2',completeSnapshot:true});
  const row=await db.get<any>('SELECT * FROM support_kb_articles WHERE id=?',[b!.id]);
  assert.equal(row.removal_candidate,1);assert.equal(row.status,'active');
  assert.equal((await searchActiveArticles(db,'legalai')).length,2);
  await assert.rejects(()=>promoteKbArticle(db,'legalai',b!.id),/revision/i);
  assert.equal((await db.get<any>('SELECT source_revision FROM support_kb_revisions WHERE id=?',[a!.revisionId]))?.source_revision,'rev-1');
});
it('identical sync is idempotent and prior reviewed drafts remain selectable',async()=>{
  const {listKbRevisions,updateKbArticle}=await import('./codegen.js');
  const db=createMemorySqliteAdapter();await ensureSchema(db);
  const input={tenantId:'legalai',title:'Source',body:'source body',sourceKey:'repeat',gitSha:'sha'};
  const first=await ingestCodegenArticle(db,input);const repeat=await ingestCodegenArticle(db,input);
  assert.equal(repeat.revisionId,first.revisionId);assert.equal(repeat.publicationVersion,first.publicationVersion);
  const edited=await updateKbArticle(db,'legalai',first.id,{body:'operator draft'});
  const imported=await ingestCodegenArticle(db,{...input,body:'new imported',gitSha:'sha2'});
  const history=await listKbRevisions(db,'legalai',first.id);assert.equal(history.length,3);
  assert.ok(history.some(r=>r.revisionId===edited.revisionId&&r.body==='operator draft'));
  const published=await promoteKbArticle(db,'legalai',first.id,undefined,{revisionId:edited.revisionId,expectedDraftRevisionId:imported.revisionId,expectedPublishedRevisionId:null});
  assert.equal(published.publishedRevisionId,edited.revisionId);assert.equal(published.revisionId,imported.revisionId);
  assert.equal((await searchActiveArticles(db,'legalai'))[0]?.body,'operator draft');
});
it('repeated source sync preserves an operator draft and concurrent deprecation defeats stale promotion',async()=>{
  const {updateKbArticle,deprecateKbArticle,listKbRevisions}=await import('./codegen.js');
  const db=createMemorySqliteAdapter();await ensureSchema(db);
  const input={tenantId:'legalai',title:'Source',body:'source content',sourceKey:'stable',gitSha:'sha'};
  const first=await ingestCodegenArticle(db,input);await promoteKbArticle(db,'legalai',first.id);
  const edit=await updateKbArticle(db,'legalai',first.id,{body:'operator content'});
  const sync=await ingestCodegenArticle(db,input);assert.equal(sync.revisionId,edit.revisionId);assert.equal((await listKbRevisions(db,'legalai',first.id)).length,2);
  const get=db.get.bind(db);let armed=true;
  db.get=async<T>(sql:string,params?:unknown[]):Promise<T|undefined>=>{
    const row=await get<T>(sql,params);
    if(armed&&sql.includes('SELECT * FROM support_kb_revisions WHERE id=? AND article_id=? AND tenant_id=?')){armed=false;await deprecateKbArticle(db,'legalai',first.id);}
    return row;
  };
  await assert.rejects(()=>promoteKbArticle(db,'legalai',first.id,undefined,{revisionId:edit.revisionId}),/revision/i);
  assert.equal((await searchActiveArticles(db,'legalai')).length,0);
});
