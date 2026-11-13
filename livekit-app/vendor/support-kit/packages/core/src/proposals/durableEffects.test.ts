import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemorySqliteAdapter } from '../db/memorySqlite.js';
import { createHttpRouter, createMockResponse } from '../http/createRouter.js';
import { TicketService } from '../tickets/service.js';
import { ProposalService } from './service.js';
import { ensureSchema } from '../db/migrate.js';
import { executeProposalAction } from './executor.js';
const brand={name:'Test',supportAgentName:'Helper',agentAuthorId:'agent'};
const actor={id:'op',role:'ops' as const,principalType:'operator' as const};
const call=async(router:any,url:string,body:any,headers={})=>{const r=createMockResponse();await router.handler({method:'POST',url,body,headers},r.res);return r.done;};
test('durable mode fails closed without transaction adapter',async()=>{
 const db=createMemorySqliteAdapter();const router=createHttpRouter({db,tenantId:'test',brand,resolveUser:()=>actor,authorizationMode:'central',authorizeSupport:async()=>true,mutationMode:'durable'} as any);
 const response=await call(router,'/tickets',{body:'help'});
 assert.equal(response.statusCode,503);assert.equal((await db.all('SELECT * FROM support_tickets')).length,0);
});
test('losing takeover leaves claim and assignment untouched',async()=>{
 const db=createMemorySqliteAdapter();await ensureSchema(db);const tickets=new TicketService(db);const proposals=new ProposalService(db);
 const {ticket}=await tickets.createTicket({tenantId:'test' as any,body:'help'});
 const proposal=await proposals.createProposal({tenantId:'test' as any,ticketId:ticket.id,proposalType:'reply',summary:'reply',bodyJson:'{}'});
 await proposals.tryAtomicTransition('test',proposal.id,'approved','winner');
 const result=await executeProposalAction({tenantId:'test',tickets,proposals,brand},proposal.id,'take_over','loser');
 assert.equal(result.ok,false);assert.equal((await tickets.getTicket('test',ticket.id))?.assignedTo,null);assert.equal((await proposals.getProposal('test',proposal.id))?.claimedBy,null);
});
test('missing github provider does not approve proposal',async()=>{
 const db=createMemorySqliteAdapter();await ensureSchema(db);const tickets=new TicketService(db);const proposals=new ProposalService(db);
 const {ticket}=await tickets.createTicket({tenantId:'test' as any,body:'help'});
 const proposal=await proposals.createProposal({tenantId:'test' as any,ticketId:ticket.id,proposalType:'bug_fix',summary:'bug',bodyJson:'{}'});
 assert.equal((await executeProposalAction({tenantId:'test',tickets,proposals,brand},proposal.id,'approve','op')).ok,false);
 assert.equal((await proposals.getProposal('test',proposal.id))?.status,'pending_review');
});

function fixtureAdapter(db:any) {
 const receipts=new Map<string,{payload:string;result:any}>();let tail=Promise.resolve();
 return {receipts,run:async(input:any,execute:any,prepare?:(db:ReturnType<typeof createMemorySqliteAdapter>)=>Promise<unknown>)=>{
   const previous=tail;let release!:()=>void;tail=new Promise<void>(r=>release=r);await previous;
   const key=JSON.stringify([input.businessId,input.actor.principalType,input.actor.id,input.operation,input.key]);
   try {
     const old=receipts.get(key);const payload=JSON.stringify(input.payload);
     if(old)return old.payload===payload?old.result:{statusCode:409,body:{error:'Idempotency conflict'}};
     const prepared=await prepare?.(db);
     await db.run('BEGIN');
     try {
       const result=await execute({db,preflight:async()=>false,enqueue:async(effect:any)=>{await db.run('INSERT INTO effects(body) VALUES (?)',[JSON.stringify(effect)]);}},prepared);
       if(result.statusCode>=400){await db.run('ROLLBACK');return result;}
       await db.run('COMMIT');receipts.set(key,{payload,result});return result;
     }catch(error){await db.run('ROLLBACK');throw error;}
   }finally{release();}
 }};
}
test('durable initial guest ticket retries preserve owner and never store bearer proof',async()=>{
 const db=createMemorySqliteAdapter();await db.run('CREATE TABLE effects(body TEXT)');const adapter=fixtureAdapter(db);
 const router=createHttpRouter({db,tenantId:'test',brand,resolveUser:()=>null,authorizationMode:'central',mutationMode:'durable',durableMutations:adapter});
 const bootstrap=await call(router,'/guest-session',{email:'guest@test.local',name:'Guest'});assert.equal(bootstrap.statusCode,201);
 const token=(bootstrap.body as any).guestSessionToken;const headers={'x-support-guest-token':token,'idempotency-key':'initial-ticket'};
 const body={body:'help',guestEmail:'attacker@test.local',contextJson:'{"email":"attacker@test.local"}'};
 const [a,b]=await Promise.all([call(router,'/tickets',body,headers),call(router,'/tickets',body,headers)]);
 assert.equal(a.statusCode,201);assert.deepEqual(a,b);assert.equal((a.body as any).ticket.guestEmail,'guest@test.local');
 assert.equal((await db.all('SELECT * FROM support_tickets')).length,1);
 assert.ok(!JSON.stringify([...adapter.receipts]).includes(token));
 assert.equal((await call(router,'/tickets',{body:'changed'},headers)).statusCode,409);
 assert.equal((await db.all('SELECT * FROM effects')).length,1);
});
test('durable response error rolls back actual ticket and message rows',async()=>{
 const db=createMemorySqliteAdapter();await db.run('CREATE TABLE effects(body TEXT)');const adapter=fixtureAdapter(db);
 const router=createHttpRouter({db,tenantId:'test',brand,resolveUser:()=>actor,authorizationMode:'central',authorizeSupport:async()=>true,mutationMode:'durable',durableMutations:{run:(input,execute)=>adapter.run(input,async (scope:any)=>execute({...scope,enqueue:async()=>{throw Error('queue unavailable');}}))}});
 const created=await call(router,'/tickets',{body:'help'},{'idempotency-key':'create-rollback'});
 assert.equal(created.statusCode,500);assert.equal((await db.all('SELECT * FROM support_tickets')).length,0);assert.equal((await db.all('SELECT * FROM support_messages')).length,0);
});
test('durable followup preserves AI history and replay does not generate again',async()=>{
 const db=createMemorySqliteAdapter();await db.run('CREATE TABLE effects(body TEXT)');const adapter=fixtureAdapter(db);let calls=0;
 const customer={id:'customer',role:'user' as const,principalType:'customer' as const,email:'customer@test.local'};
 const router=createHttpRouter({db,tenantId:'test',brand,resolveUser:()=>customer,authorizationMode:'central',mutationMode:'durable',durableMutations:adapter,llm:{complete:async input=>{calls++;assert.match(input.user,/first question/);return JSON.stringify({route:'propose_reply',summary:'Follow up',body:{draft_reply:'AI followup'},confidence:.5});}}});
 const first=await call(router,'/tickets',{body:'first question'},{'idempotency-key':'first-message'});const id=(first.body as any).ticket.id;
 const a=await call(router,`/tickets/${id}/messages`,{body:'followup'},{'idempotency-key':'followup-message'});
 const b=await call(router,`/tickets/${id}/messages`,{body:'followup'},{'idempotency-key':'followup-message'});
 assert.equal(a.statusCode,200);assert.equal(calls,1);assert.deepEqual(a,b);assert.match((a.body as any).reply,/AI followup/);
});
test('initial chat receipt serializes concurrent AI generation and all history writes',async()=>{
 const db=createMemorySqliteAdapter();await db.run('CREATE TABLE effects(body TEXT)');const adapter=fixtureAdapter(db);let calls=0;
 const router=createHttpRouter({db,tenantId:'test',brand,resolveUser:()=>({id:'chat-user',role:'user',principalType:'customer'}),authorizationMode:'central',mutationMode:'durable',durableMutations:adapter,llm:{complete:async()=>{calls++;return JSON.stringify({route:'propose_reply',summary:'Initial chat',body:{draft_reply:'Initial answer'},confidence:.5});}}});
 const headers={'idempotency-key':'initial-chat-key'};
 const [a,b]=await Promise.all([call(router,'/chat',{message:'initial question'},headers),call(router,'/chat',{message:'initial question'},headers)]);
 assert.equal(a.statusCode,200);assert.deepEqual(a,b);assert.equal(calls,1);assert.equal((await db.all('SELECT * FROM support_tickets')).length,1);assert.equal((await db.all('SELECT * FROM support_messages')).length,2);
});
test('durable Telegram edit rolls back with proposal and never invokes provider inside transaction', async () => {
 const db=createMemorySqliteAdapter();await ensureSchema(db);await db.run('CREATE TABLE effects(body TEXT)');
 const tickets=new TicketService(db),proposals=new ProposalService(db);
 const {ticket}=await tickets.createTicket({tenantId:'test' as any,body:'help'});
 const proposal=await proposals.createProposal({tenantId:'test' as any,ticketId:ticket.id,proposalType:'reply',summary:'reply',bodyJson:'{}'});
 await proposals.setTelegramMeta('test',proposal.id,{telegramChatId:'trusted-chat',telegramMessageId:'stored-message'});
 let providerCalls=0;
 const telegram={formatProposalMessage:()=> 'Proposal rejected',proposalKeyboard:()=>({}),editProposalMessage:async()=>{providerCalls++;throw Error('provider unavailable');}};
 const effects={db,preflight:async()=>false,enqueue:async(effect:any)=>{await db.run('INSERT INTO effects(body) VALUES (?)',[JSON.stringify(effect)]);}};
 const deps={tenantId:'test',tickets,proposals,brand,telegram,effects};
 await db.run('BEGIN');
 try {assert.equal((await executeProposalAction(deps,proposal.id,'reject','op')).ok,true);}
 finally {await db.run('ROLLBACK');}
 assert.equal((await proposals.getProposal('test',proposal.id))?.status,'pending_review');
 assert.equal((await db.all('SELECT * FROM effects')).length,0);
 assert.equal(providerCalls,0);
 await db.run('BEGIN');
 assert.equal((await executeProposalAction(deps,proposal.id,'reject','op')).ok,true);
 await db.run('COMMIT');
 const queued=JSON.parse((await db.get<{body:string}>('SELECT body FROM effects'))!.body);
 assert.equal(queued.type,'support.ops');assert.equal(queued.ticketId,ticket.id);
 assert.deepEqual(queued.payload,{kind:'telegram_edit',proposalId:proposal.id,chatId:'trusted-chat',messageId:'stored-message',text:'Proposal rejected',replyMarkup:null});
 assert.equal(providerCalls,0);
 await assert.rejects(telegram.editProposalMessage(),/provider unavailable/);
 assert.equal((await proposals.getProposal('test',proposal.id))?.status,'rejected');
 const legacy=await proposals.createProposal({tenantId:'test' as any,ticketId:ticket.id,proposalType:'reply',summary:'legacy',bodyJson:'{}'});
 await proposals.setTelegramMeta('test',legacy.id,{telegramChatId:'trusted-chat',telegramMessageId:'legacy-message'});
 assert.equal((await executeProposalAction({tenantId:'test',tickets,proposals,brand,telegram},legacy.id,'reject','op')).ok,true);
 assert.equal(providerCalls,2);
 assert.equal((await db.all('SELECT * FROM effects')).length,1);
});
test('durable preparation uses held database and internal dispatch reuses resolved tenant', async () => {
 const db=createMemorySqliteAdapter();await db.run('CREATE TABLE effects(body TEXT)');
 let held=false,resolutions=0;
 const baseDb={run:async(sql:string,params?:unknown[])=>{assert.equal(held,false,'global DB inside durable operation');return db.run(sql,params);},get:async<T>(sql:string,params?:unknown[])=>{assert.equal(held,false,'global DB inside durable operation');return db.get<T>(sql,params);},all:async<T>(sql:string,params?:unknown[])=>{assert.equal(held,false,'global DB inside durable operation');return db.all<T>(sql,params);}};
 const adapter=fixtureAdapter(db);
 const router=createHttpRouter({db:baseDb,tenantId:'default',brand,resolveUser:()=>({id:'scoped-customer',role:'user',principalType:'customer'}),resolveTenant:async(_req,tenantId)=>{assert.equal(held,false,'tenant was already resolved before receipt transaction');resolutions++;return {tenantId,brand};},authorizationMode:'central',mutationMode:'durable',durableMutations:{run:async(input,execute,prepare)=>{held=true;try{return await adapter.run(input,execute,prepare);}finally{held=false;}}}});
 const warm=createMockResponse();await router.handler({method:'GET',url:'/config?tenant=test'},warm.res);await warm.done;resolutions=0;
 const result=await call(router,'/chat?tenant=test',{message:'scope-bound question'},{'idempotency-key':'bound-prepare'});
 assert.equal(result.statusCode,200);assert.equal(resolutions,1);
 const mismatch=await call(router,'/chat?tenant=test',{message:'forged scope'},{'x-tenant-id':'other','idempotency-key':'bound-mismatch'});
 assert.equal(mismatch.statusCode,403);
});
test('durable GitHub payload retains the reviewed customer reply for completion',async()=>{
 const db=createMemorySqliteAdapter();await ensureSchema(db);const tickets=new TicketService(db),proposals=new ProposalService(db);
 const {ticket}=await tickets.createTicket({tenantId:'test' as any,body:'bug'});
 const proposal=await proposals.createProposal({tenantId:'test' as any,ticketId:ticket.id,proposalType:'bug_fix',summary:'bug',bodyJson:JSON.stringify({draft_reply:'original',title:'Bug',body:'Details'})});
 const queued:any[]=[];
 const result=await executeProposalAction({tenantId:'test',tickets,proposals,brand,effects:{db,preflight:async()=>true,enqueue:async effect=>{queued.push(effect);}}},proposal.id,'approve','op',{draftReply:'Reviewed reply'});
 assert.equal(result.ok,true);assert.equal(queued.find(e=>e.type==='support.github')?.payload.draftReply,'Reviewed reply');
});
test('per-business runtime resolves once and retains proposal identity in notification jobs',async()=>{
 const db=createMemorySqliteAdapter();await db.run('CREATE TABLE effects(body TEXT)');const adapter=fixtureAdapter(db);
 let held=false,resolutions=0,calls=0;
 const router=createHttpRouter({db,tenantId:'default',brand,resolveUser:()=>({id:'tenant-user',role:'user',principalType:'customer'}),authorizationMode:'central',mutationMode:'durable',
   resolveTenant:async()=>{assert.equal(held,false);resolutions++;return {tenantId:'business',brand:{...brand,name:'Business'},llm:{complete:async(input:{system:string})=>{calls++;assert.equal(held,true);assert.match(input.system,/Business/);return JSON.stringify({route:'propose_reply',summary:'Tenant answer',body:{draft_reply:'Resolved tenant LLM'},confidence:.5});}}};},
   durableMutations:{run:async(input,execute,prepare)=>{held=true;try{return await adapter.run(input,execute,prepare);}finally{held=false;}}}});
 const result=await call(router,'/chat?tenant=business',{message:'help'},{'idempotency-key':'tenant-runtime'});
 assert.equal(result.statusCode,200);assert.equal(resolutions,1);assert.equal(calls,1);
 const jobs=(await db.all<{body:string}>('SELECT body FROM effects')).map(row=>JSON.parse(row.body));
 const proposal=await db.get<{id:string}>('SELECT id FROM support_proposals WHERE tenant_id=?',['business']);
 assert.equal(jobs.find(job=>job.payload.kind==='proposal_ready')?.payload.proposalId,proposal?.id);
});
