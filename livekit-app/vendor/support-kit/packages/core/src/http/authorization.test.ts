import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSupportRouter } from '../index.js';
import { createMemorySqliteAdapter } from '../db/memorySqlite.js';
import { ensureSchema } from '../db/migrate.js';
import { TicketService } from '../tickets/service.js';
import { ProposalService } from '../proposals/service.js';
import { ingestCodegenArticle, promoteKbArticle } from '../kb/codegen.js';
import { createMockResponse } from './createRouter.js';

const brand = { name: 'Fixture', supportAgentName: 'Help', agentAuthorId: 'ai' };
async function fixture(grants: string[] = [], overrides: Record<string, unknown> = {}) {
  const db = createMemorySqliteAdapter(); await ensureSchema(db);
  let actor: any = { id: 'operator', role: 'ops', principalType: 'operator' };
  const calls: any[] = [];
  const router = createSupportRouter({ tenantId: 'a', db, brand, authorizationMode: 'central',
    resolveUser: () => actor, authorizeSupport: async (input: any) => { calls.push(input); return input.businessId === 'a' && grants.includes(input.action); },
    resolveTenant: (_: unknown, id: string) => ['a','b'].includes(id) ? { tenantId: id, brand } : null,
    ...overrides } as any);
  const request = async (url: string, method = 'GET', body?: any, headers?: any) => {
    const {res,done}=createMockResponse(); await router.handler({url,method,body,headers},res); return done;
  };
  const tickets = new TicketService(db); const proposals = new ProposalService(db);
  return { db, request, calls, tickets, proposals, setActor: (value: any) => {actor=value;} };
}

test('central mode requires an explicit hook and trusted operator identity', async () => {
  const missing = await fixture([], {authorizeSupport: undefined});
  assert.equal((await missing.request('/admin/tickets')).statusCode,403);
  const f=await fixture(['support.read']); f.setActor({id:'product-admin',role:'admin'});
  assert.equal((await f.request('/admin/tickets')).statusCode,403);
  f.setActor({id:'staff',role:'user',principalType:'operator'});
  assert.equal((await f.request('/admin/tickets')).statusCode,200);
});

test('concrete business and conflicting selectors cannot bypass per-action authorization', async () => {
  const f=await fixture(['support.read']);
  assert.equal((await f.request('/admin/tickets?tenant=b')).statusCode,403);
  assert.equal((await f.request('/admin/tickets?tenant=a','GET',undefined,{'x-tenant-id':'b'})).statusCode,403);
  assert.equal((await f.request('/admin/tickets?tenant=unknown')).statusCode,403);
  const {ticket}=await f.tickets.createTicket({tenantId:'a' as any,userId:'customer',body:'help'});
  assert.equal((await f.request(`/admin/tickets/${ticket.id}/reply`,'POST',{body:'reply'})).statusCode,403);
  assert.equal((await f.tickets.listMessages('a',ticket.id)).length,1);
  const {ticket:other}=await f.tickets.createTicket({tenantId:'b' as any,userId:'customer',body:'secret'});
  assert.equal((await f.request(`/admin/tickets/${other.id}?tenant=a`)).statusCode,404);
});

test('proposal permissions follow semantic aliases and stored type, before effects', async () => {
  const f=await fixture(['support.read','support.manage']);
  const {ticket}=await f.tickets.createTicket({tenantId:'a' as any,userId:'customer',body:'help'});
  for (const action of ['approve','send_reply','edit_send','need_info','send','issue','approve_backlog']) {
    const p=await f.proposals.createProposal({tenantId:'a' as any,ticketId:ticket.id,proposalType:'reply',summary:'reply',bodyJson:'{"draft_reply":"secret reply"}'});
    assert.equal((await f.request(`/admin/proposals/${p.id}/action`,'POST',{action})).statusCode,403,action);
    assert.equal((await f.proposals.getProposal('a',p.id))?.status,'pending_review');
  }
  const p=await f.proposals.createProposal({tenantId:'a' as any,ticketId:ticket.id,proposalType:'reply',summary:'reply',bodyJson:'{}'});
  assert.equal((await f.request(`/admin/proposals/${p.id}/action`,'POST',{action:'unknown'})).statusCode,403);
  assert.equal((await f.request(`/admin/proposals/${p.id}/action`,'POST',{action:'assign_me'})).statusCode,403);
  assert.equal((await f.tickets.listMessages('a',ticket.id)).length,1);
});

test('knowledge grants allow immutable draft edits but publication remains independent', async () => {
  const f=await fixture(['knowledge.read','knowledge.edit']);
  assert.equal((await f.request('/admin/kb')).statusCode,200);
  assert.equal((await f.request('/admin/tickets')).statusCode,403);
  const article=await ingestCodegenArticle(f.db,{tenantId:'a',title:'Draft',body:'Body',sourceKey:'test'});
  assert.equal((await f.request(`/admin/kb/${article.id}`,'PATCH',{title:'Edited'})).statusCode,200);
  await promoteKbArticle(f.db,'a',article.id);
  assert.equal((await f.request(`/admin/kb/${article.id}`,'PATCH',{title:'Published change'})).statusCode,200);
  assert.equal((await f.db.get<any>('SELECT title FROM support_kb_articles WHERE id=?',[article.id]))?.title,'Edited');
  assert.equal((await f.request(`/admin/kb/${article.id}/deprecate`,'POST')).statusCode,403);
});

test('customer ownership ignores app-admin role, body userId and organization', async () => {
  const f=await fixture(['support.read']); f.setActor({id:'alice',role:'admin',principalType:'customer'});
  const created=await f.request('/tickets','POST',{body:'mine',userId:'bob',orgId:'forged'});
  const t=(created.body as any).ticket; assert.equal(t.userId,'alice'); assert.equal(t.orgId,null);
  const {ticket}=await f.tickets.createTicket({tenantId:'a' as any,userId:'bob',body:'private'});
  assert.equal((await f.request(`/tickets/${ticket.id}`)).statusCode,403);
  assert.equal((await f.request(`/tickets/${ticket.id}/messages`,'POST',{body:'forged'})).statusCode,403);
  assert.deepEqual(((await f.request('/tickets')).body as any).tickets.map((x:any)=>x.id),[t.id]);
});

test('guest session proof, not lead/email identity, owns public tickets', async () => {
  const f=await fixture(); f.setActor(null);
  const first=await f.request('/leads','POST',{name:'Guest',email:'same@example.com'});
  const second=await f.request('/leads','POST',{name:'Other',email:'same@example.com'});
  const a=first.body as any,b=second.body as any;
  assert.ok(a.guestSessionToken && b.guestSessionToken); assert.notEqual(a.guestSessionToken,b.guestSessionToken);
  assert.equal((await f.request('/chat','POST',{message:'help',leadId:a.leadId})).statusCode,401);
  const chat=await f.request('/chat','POST',{message:'help',leadId:a.leadId},{'x-support-guest-token':a.guestSessionToken});
  assert.equal(chat.statusCode,200); const t=(chat.body as any).ticket;
  assert.equal((await f.request(`/tickets/${t.id}`)).statusCode,401);
  assert.equal((await f.request(`/tickets/${t.id}`,'GET',undefined,{'x-support-guest-token':b.guestSessionToken})).statusCode,403);
  assert.equal((await f.request(`/tickets/${t.id}`,'GET',undefined,{'x-support-guest-token':a.guestSessionToken})).statusCode,200);
  assert.equal((await f.request(`/tickets/${t.id}?tenant=b`,'GET',undefined,{'x-support-guest-token':a.guestSessionToken})).statusCode,401);
  const rows=await f.db.all<any>('SELECT * FROM support_guest_sessions');
  assert.ok(!JSON.stringify(rows).includes(a.guestSessionToken));
  await f.db.run('UPDATE support_guest_sessions SET expires_at = ?', ['2000-01-01T00:00:00.000Z']);
  assert.equal((await f.request(`/tickets/${t.id}`,'GET',undefined,{'x-support-guest-token':a.guestSessionToken})).statusCode,401);
});

test('central Telegram secret and allowlist alone grant no operator authority', async () => {
  let calls=0;
  const f=await fixture(['support.manage'],{telegram:{resolveConfig:async()=>{calls++;return {botToken:'fixture',chatId:'1',webhookSecret:'fixture',allowedUserIds:['1']};},createClient:()=>{throw new Error('must not call Telegram');}}});
  const out=await f.request('/telegram/webhook','POST',{callback_query:{id:'1',from:{id:1},data:'approve:guess'}},{'x-telegram-bot-api-secret-token':'fixture'});
  assert.equal(out.statusCode,403); assert.equal(calls,0);
});

test('draft promotion cannot publish via a truthy non-boolean activate value', async () => {
  const f=await fixture(['support.read','knowledge.read','knowledge.edit']);
  const {ticket}=await f.tickets.createTicket({tenantId:'a' as any,userId:'customer',body:'question'});
  await f.tickets.addMessage('a',ticket.id,'answer',{authorType:'staff',authorId:'staff'});
  assert.equal((await f.request(`/admin/tickets/${ticket.id}/promote-kb`,'POST',{activate:'yes'})).statusCode,403);
});

test('public central chat never passes internal knowledge to the model', async () => {
  let prompt='';
  const f=await fixture([],{llm:{complete:async(input:any)=>{prompt+=input.system+input.user;return JSON.stringify({route:'reply_in_app',kind:'support',topic:'other',confidence:0.99,summary:'help',body:{draft_reply:'public answer'}});}}});
  const article=await ingestCodegenArticle(f.db,{tenantId:'a',title:'Super secret internal help',body:'INTERNAL_CANARY private operation',sourceKey:'internal',visibility:'internal'});
  await promoteKbArticle(f.db,'a',article.id,undefined,{visibility:'internal'});
  f.setActor({id:'customer',role:'admin',principalType:'customer'});
  assert.equal((await f.request('/chat','POST',{message:'Super secret internal help'})).statusCode,200);
  assert.ok(!prompt.includes('INTERNAL_CANARY'));
});

test('read and assign aliases succeed without management and reply-only cannot create GitHub issues', async () => {
  const f=await fixture(['support.read','support.assign']);
  const {ticket}=await f.tickets.createTicket({tenantId:'a' as any,userId:'customer',body:'help'});
  for(const action of ['claim','steal_claim','release']) {
    const p=await f.proposals.createProposal({tenantId:'a' as any,ticketId:ticket.id,proposalType:'reply',summary:'help',bodyJson:'{}'});
    assert.equal((await f.request(`/admin/proposals/${p.id}/action`,'POST',{action})).statusCode,200,action);
  }
  const takeover=await f.proposals.createProposal({tenantId:'a' as any,ticketId:ticket.id,proposalType:'reply',summary:'help',bodyJson:'{}'});
  assert.equal((await f.request(`/admin/proposals/${takeover.id}/action`,'POST',{action:'assign_me'})).statusCode,403);
  assert.equal((await f.proposals.getProposal('a',takeover.id))?.claimedBy,null);
  const g=await fixture(['support.read','support.reply']);
  const {ticket:t}=await g.tickets.createTicket({tenantId:'a' as any,userId:'customer',body:'bug'});
  const p=await g.proposals.createProposal({tenantId:'a' as any,ticketId:t.id,proposalType:'bug_fix',summary:'bug',bodyJson:'{}'});
  assert.equal((await g.request(`/admin/proposals/${p.id}/action`,'POST',{action:'approve'})).statusCode,403);
});


test('central registry also fails closed without a configured authorization hook', async () => {
  const f=await fixture([],{authorizeSupport:undefined});
  f.setActor({id:'owner',role:'admin',platformAdmin:true,principalType:'operator'});
  assert.equal((await f.request('/tenants','POST',{name:'Unauthorized registry'})).statusCode,403);
});

test('central config advertises proof requirement for legacy cached guest recovery', async () => {
  const f=await fixture(); f.setActor(null);
  assert.equal(((await f.request('/config')).body as any).guestSessionRequired,true);
});

test('mutation capabilities never substitute for reading existing records',async()=>{
  const f=await fixture(['support.assign','support.manage','knowledge.edit']);
  const {ticket}=await f.tickets.createTicket({tenantId:'a' as any,userId:'customer',body:'PRIVATE_TICKET',contextJson:'PRIVATE_CONTEXT'});
  const p=await f.proposals.createProposal({tenantId:'a' as any,ticketId:ticket.id,proposalType:'reply',summary:'private',bodyJson:'{"draft_reply":"PRIVATE_PROPOSAL"}'});
  for(const action of ['claim','release','reject']) {
    const response=await f.request(`/admin/proposals/${p.id}/action`,'POST',{action});
    assert.equal(response.statusCode,403);assert.ok(!JSON.stringify(response.body).includes('PRIVATE_'));
  }
  assert.equal((await f.proposals.getProposal('a',p.id))?.status,'pending_review');
  assert.equal((await f.proposals.getProposal('a',p.id))?.claimedBy,null);
  await f.db.run("UPDATE support_proposals SET status='approved' WHERE id=?",[p.id]);
  const conflict=await f.request(`/admin/proposals/${p.id}/action`,'POST',{action:'reject'});
  assert.equal(conflict.statusCode,403);assert.ok(!JSON.stringify(conflict.body).includes('PRIVATE_'));
  const article=await ingestCodegenArticle(f.db,{tenantId:'a',title:'private',body:'PRIVATE_KB',sourceKey:'private'});
  const patch=await f.request(`/admin/kb/${article.id}`,'PATCH',{});
  assert.equal(patch.statusCode,403);assert.ok(!JSON.stringify(patch.body).includes('PRIVATE_'));
});

test('central draft ingestion and ticket promotion preserve existing active articles',async()=>{
  const f=await fixture(['support.read','knowledge.read','knowledge.edit']);
  const active=await ingestCodegenArticle(f.db,{tenantId:'a',title:'Published',body:'PUBLISHED_ORIGINAL',sourceKey:'docs:same.md'});
  await promoteKbArticle(f.db,'a',active.id);
  const ingest=await f.request('/admin/kb/ingest','POST',{sources:[{path:'same.md',body:'replacement'}]});
  assert.equal(ingest.statusCode,200);
  const {ticket}=await f.tickets.createTicket({tenantId:'a' as any,userId:'customer',body:'question'});
  const answer=await ingestCodegenArticle(f.db,{tenantId:'a',title:'Published answer',body:'PUBLISHED_ANSWER',sourceKey:`evolutionary:ticket:${ticket.id}`,sourceKind:'evolutionary'});
  await promoteKbArticle(f.db,'a',answer.id);
  assert.equal((await f.request(`/admin/tickets/${ticket.id}/promote-kb`,'POST',{body:'replacement'})).statusCode,200);
  const rows=await f.db.all<any>('SELECT body,status FROM support_kb_articles WHERE id IN (?,?)',[active.id,answer.id]);
  assert.deepEqual(rows.map(r=>r.status),['active','active']);
  assert.ok(rows.every(r=>r.body.startsWith('PUBLISHED_')));
});

test('central draft PATCH cannot overwrite a concurrently published article',async()=>{
  const f=await fixture(['knowledge.read','knowledge.edit']);
  const article=await ingestCodegenArticle(f.db,{tenantId:'a',title:'Draft',body:'ORIGINAL',sourceKey:'patch-race'});
  const get=f.db.get.bind(f.db);let reads=0;
  f.db.get=async <T>(sql:string,params?:unknown[]):Promise<T|undefined>=>{
    const result=await get<T>(sql,params);
    if(sql.includes('SELECT * FROM support_kb_operator_articles') && ++reads===1)
      await promoteKbArticle(f.db,'a',article.id);
    return result;
  };
  assert.equal((await f.request(`/admin/kb/${article.id}`,'PATCH',{body:'FORBIDDEN_RACE'})).statusCode,409);
  const row=await f.db.get<any>('SELECT body,status FROM support_kb_articles WHERE id=?',[article.id]);
  assert.equal(row.body,'ORIGINAL');assert.equal(row.status,'active');
});

test('draft ingest conditional update preserves a concurrent publication',async()=>{
  const f=await fixture();const article=await ingestCodegenArticle(f.db,{tenantId:'a',title:'Draft',body:'ORIGINAL',sourceKey:'ingest-race'});
  const get=f.db.get.bind(f.db);let armed=true;
  f.db.get=async <T>(sql:string,params?:unknown[]):Promise<T|undefined>=>{
    const row=await get<T>(sql,params);
    if(armed && sql.includes('source_kind=? AND source_key=?')) {armed=false;await promoteKbArticle(f.db,'a',article.id);}
    return row;
  };
  await assert.rejects(ingestCodegenArticle(f.db,{tenantId:'a',title:'Changed',body:'FORBIDDEN_RACE',sourceKey:'ingest-race',preserveActive:true} as any),/revision/i);
  const row=await f.db.get<any>('SELECT body,status FROM support_kb_articles WHERE id=?',[article.id]);
  assert.equal(row.body,'ORIGINAL');assert.equal(row.status,'active');
});

test('central upload and AI ticket curation also preserve active source collisions',async()=>{
  const f=await fixture(['support.read','knowledge.read','knowledge.edit'],{llm:{complete:async()=>JSON.stringify({title:'Replacement',body:'replacement'})}});
  const upload=await ingestCodegenArticle(f.db,{tenantId:'a',title:'Published upload',body:'ORIGINAL',sourceKey:'upload:same.txt',sourceKind:'curated'});
  await promoteKbArticle(f.db,'a',upload.id);
  assert.equal((await f.request('/admin/kb/ingest/uploads','POST',{docs:[{name:'same.txt',content:'replacement'}]})).statusCode,200);
  const {ticket}=await f.tickets.createTicket({tenantId:'a' as any,userId:'customer',body:'question'});
  await f.tickets.addMessage('a',ticket.id,'answer',{authorType:'staff',authorId:'operator'});
  const answer=await ingestCodegenArticle(f.db,{tenantId:'a',title:'Published answer',body:'ORIGINAL',sourceKey:`evolutionary:ticket:${ticket.id}`,sourceKind:'evolutionary'});
  await promoteKbArticle(f.db,'a',answer.id);
  assert.equal((await f.request(`/admin/tickets/${ticket.id}/promote-kb`,'POST',{})).statusCode,200);
  const rows=await f.db.all<any>('SELECT body,status FROM support_kb_articles WHERE id IN (?,?)',[upload.id,answer.id]);
  assert.ok(rows.every(row=>row.status==='active'&&row.body==='ORIGINAL'));
});

test('central publishing requires exact reviewed revision and public help remains approved after draft edits',async()=>{
  const f=await fixture(['knowledge.read','knowledge.edit','knowledge.publish']);
  const a=await ingestCodegenArticle(f.db,{tenantId:'a',title:'Approved',body:'PUBLIC_APPROVED',visibility:'public',sourceKey:'review'});
  assert.equal((await f.request(`/admin/kb/${a.id}/promote`,'POST',{})).statusCode,400);
  assert.equal((await f.request(`/admin/kb/${a.id}/promote`,'POST',{revisionId:a.revisionId,expectedPublishedRevisionId:null})).statusCode,200);
  await f.request(`/admin/kb/${a.id}`,'PATCH',{body:'PRIVATE_DRAFT',visibility:'internal'});
  const help=await f.request('/help/articles');assert.ok(JSON.stringify(help.body).includes('PUBLIC_APPROVED'));assert.ok(!JSON.stringify(help.body).includes('PRIVATE_DRAFT'));
  assert.equal((await f.request(`/admin/kb/${a.id}/promote`,'POST',{revisionId:a.revisionId,expectedPublishedRevisionId:a.revisionId})).statusCode,409);
});
test('central crawling and automatic ticket activation are unavailable',async()=>{
  const f=await fixture(['support.read','knowledge.read','knowledge.edit','knowledge.publish'],{llm:{complete:async()=>{throw new Error('Must not call');}}});
  assert.equal((await f.request('/admin/kb/ingest/website','POST',{url:'https://example.test'})).statusCode,503);
  const {ticket}=await f.tickets.createTicket({tenantId:'a' as any,userId:'customer',body:'question'});
  assert.equal((await f.request(`/admin/tickets/${ticket.id}/promote-kb`,'POST',{activate:true,body:'answer'})).statusCode,400);
});
test('central tenants never inherit another business provider when their adapter is unavailable',async()=>{
 let providerCalls=0;
 const f=await fixture([],{llm:{complete:async()=>{providerCalls++;throw Error('wrong business provider');}}});
 const response=await f.request('/config?tenant=a');
 assert.equal((response.body as any).coachEnabled,false);assert.equal(providerCalls,0);
});
test('revision history is knowledge-read scoped and cannot cross businesses',async()=>{
 const f=await fixture(['knowledge.read']);
 const a=await ingestCodegenArticle(f.db,{tenantId:'a',title:'A',body:'a revision',sourceKey:'history'});
 const b=await ingestCodegenArticle(f.db,{tenantId:'b',title:'B',body:'private b',sourceKey:'history'});
 const result=await f.request(`/admin/kb/${a.id}/revisions`);assert.equal(result.statusCode,200);assert.equal((result.body as any).revisions[0].revisionId,a.revisionId);
 assert.equal((await f.request(`/admin/kb/${b.id}/revisions`)).statusCode,404);
 const denied=await fixture(['knowledge.edit']);assert.equal((await denied.request(`/admin/kb/${a.id}/revisions`)).statusCode,403);
});
