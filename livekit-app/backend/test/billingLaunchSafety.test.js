require('./supportIsolation').prepareSupportTest();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db/v2Database');
const settings = require('../lib/v2StripeSettings');
let stripe;
settings.getStripeSettings = async () => ({ stripeEnabled: true, secretKey: 'sk_test_mock', autoChargeEnabled: false, webhookSecret: 'whsec_billing_test' });
settings.getStripeClient = () => stripe;
const sync = require('../lib/v2StripeSubscriptionSync');
const { assertCanCreateMeeting } = require('../lib/v2Entitlements');
const { settlePendingOverageForOrgCycle } = require('../lib/v2OverageSettlement');
const router = require('../routes/v2/billing');
require('../lib/opsHubClient').forwardStripeWebhookToOpsHub = async () => {};
const { handleV2BillingWebhook } = require('../routes/v2/billingWebhook');
const checkout = router.stack.find(r => r.route?.path === '/checkout').route.stack.at(-1).handle;

before(async () => {
  await db.initDatabase();
  for (const plan of ['starter', 'pro']) await db.run('UPDATE v2_plans SET stripe_price_id=? WHERE id=?', [`price_${plan}`, plan]);
});
after(()=>db.close());
async function seed(plan = 'free') {
  const org = db.uuid();
  await db.run("INSERT INTO v2_organizations (id,name,billing_status) VALUES (?,?,'active')", [org,'Test']);
  await db.run("INSERT INTO v2_org_subscriptions (org_id,plan_id,status,stripe_customer_id) VALUES (?,?,'active',?)",[org,plan,`cus_${org}`]);
  return org;
}
function subscription(org, status='active', plan='starter') {
  return {id:`sub_${org}`, customer:`cus_${org}`, status, metadata:{org_id:org,plan_id:'starter'}, items:{data:[{price:{id:`price_${plan}`}}]}};
}
async function row(org) { return db.get('SELECT * FROM v2_org_subscriptions WHERE org_id=?',[org]); }
async function invokeCheckout(org, planId='starter') {
  let result;
  const res = { statusCode:200, status(code) { this.statusCode=code; return this; }, json(body) { result={status:this.statusCode,body}; return this; } };
  await checkout({v2Auth:{orgId:org,role:'owner',email:'test@example.com'},body:{planId}},res);
  return result;
}

test('unpaid checkout does not grant a paid plan',async()=>{
 const org=await seed();
 stripe={subscriptions:{retrieve:async()=>subscription(org,'incomplete')}};
 await sync.applyCheckoutSessionToOrg({customer:`cus_${org}`,subscription:`sub_${org}`,metadata:{org_id:org,plan_id:'pro'},payment_status:'unpaid'});
 assert.equal((await row(org)).plan_id,'free');
 assert.equal((await assertCanCreateMeeting(org)).ok,true);
});
test('subscription price determines entitlement instead of stale metadata',async()=>{
 const org=await seed(); await sync.applyStripeSubscriptionToOrg(subscription(org,'active','pro'));
 assert.equal((await row(org)).plan_id,'pro');
});
test('terminal cancellation restores usable Free',async()=>{
 const org=await seed('starter'); await sync.applyStripeSubscriptionToOrg(subscription(org,'canceled'));
 assert.equal((await row(org)).plan_id,'free');
 assert.equal((await assertCanCreateMeeting(org)).ok,true);
});
test('late subscription snapshot is reconciled to current canceled state',async()=>{
 const org=await seed('starter');
 stripe={subscriptions:{retrieve:async()=>subscription(org,'canceled')}};
 await sync.reconcileStripeSubscriptionEvent(subscription(org,'active'));
 assert.equal((await row(org)).plan_id,'free');
});
test('late paid checkout cannot resurrect a canceled subscription',async()=>{
 const org=await seed('starter');
 stripe={subscriptions:{retrieve:async()=>subscription(org,'canceled')}};
 await sync.applyCheckoutSessionToOrg({customer:`cus_${org}`,subscription:`sub_${org}`,metadata:{org_id:org,plan_id:'starter'},payment_status:'paid'});
 assert.equal((await row(org)).plan_id,'free');
});
test('existing paid subscription prevents a second checkout subscription',async()=>{
 const org=await seed('starter'); let created=0;
 stripe={subscriptions:{list:async()=>({data:[subscription(org)]})},checkout:{sessions:{create:async()=>{created++;return {id:'cs_new',url:'https://example.com'};},list:async()=>({data:[]})}}};
 const result=await invokeCheckout(org,'pro');
 assert.equal(result.status,409); assert.equal(created,0);
});
test('parallel repeated checkout requests reuse one session with idempotency',async()=>{
 const org=await seed(); let created=0; let sessions=[]; let options;
 stripe={subscriptions:{list:async()=>({data:[]})},checkout:{sessions:{list:async()=>({data:sessions}),create:async(params,opts)=>{created++;options=opts; const session={id:'cs_single',url:'https://example.com',status:'open',metadata:params.metadata};sessions=[session];return session;}}}};
 const results=await Promise.all([invokeCheckout(org),invokeCheckout(org)]);
 assert.equal(created,1); assert.ok(options?.idempotencyKey);
 assert.equal(results[0].body.sessionId,results[1].body.sessionId);
});
test('platform autocharge off does not freeze an open-cycle ledger',async()=>{
 const org=await seed('starter'); const cycle=db.uuid();
 await db.run('INSERT INTO v2_billing_cycles (id,org_id,period_start,period_end) VALUES (?,?,?,?)',[cycle,org,'2020-01-01T00:00:00Z','2099-01-01T00:00:00Z']);
 await db.run("INSERT INTO v2_usage_events (id,org_id,event_type,quantity,unit) VALUES (?,?,'meeting_participant_minute',2500,'minute')",[db.uuid(),org]);
 await settlePendingOverageForOrgCycle(org,cycle);
 assert.equal((await db.all('SELECT * FROM v2_overage_ledger WHERE org_id=?',[org])).length,0);
});

test('unpaid delayed checkout does not grant access even if subscription is active',async()=>{
 const org=await seed();
 stripe={subscriptions:{retrieve:async()=>subscription(org,'active','pro')}};
 await sync.applyCheckoutSessionToOrg({customer:`cus_${org}`,subscription:`sub_${org}`,payment_status:'unpaid'});
 assert.equal((await row(org)).plan_id,'free');
});
test('concurrent snapshot reconciliation fetches current state after prior write completes',async()=>{
 const org=await seed('starter'); let calls=0; let unblock, fetched;
 const firstFetch = new Promise(resolve=>{fetched=resolve;});
 const firstResult = new Promise(resolve=>{unblock=resolve;});
 stripe={subscriptions:{retrieve:async()=>{calls++; fetched(); return calls===1 ? firstResult : subscription(org,'canceled');}}};
 const first=sync.reconcileStripeSubscriptionEvent(subscription(org));
 await firstFetch;
 const second=sync.reconcileStripeSubscriptionEvent(subscription(org));
 const inFlightCalls=calls;
 unblock(subscription(org));
 await Promise.all([first,second]);
 assert.equal(inFlightCalls,1);
 assert.equal((await row(org)).plan_id,'free');
});
test('disabled platform prevents persisting a dry-run ledger',async()=>{
 const org=await seed('starter'); const cycle=db.uuid();
 await db.run('INSERT INTO v2_billing_cycles (id,org_id,period_start,period_end) VALUES (?,?,?,?)',[cycle,org,'2020-01-01T00:00:00Z','2099-01-01T00:00:00Z']);
 const handler=router.stack.find(r=>r.route?.path==='/settle-dry-run').route.stack.at(-1).handle;
 let code=200;
 await handler({v2Auth:{orgId:org,role:'owner'},body:{cycleId:cycle,persistLedger:true}}, {status(c){code=c;return this;},json(){return this;}});
 assert.equal(code,409);
});

test('launch checkout explicitly uses cards to avoid delayed-payment provisioning',async()=>{
 const org=await seed(); let params;
 stripe={subscriptions:{list:async()=>({data:[]})},checkout:{sessions:{list:async()=>({data:[]}),create:async(p)=>{params=p;return {id:'cs_card',url:'https://example.com'};}}}};
 await invokeCheckout(org);
 assert.deepEqual(params.payment_method_types,['card']);
});

async function deliver(event, signatureOverride) {
  const body=Buffer.from(JSON.stringify({created:1234567890,livemode:false,...event}));
  const timestamp=Math.floor(Date.now()/1000);
  const signature=require('crypto').createHmac('sha256','whsec_billing_test').update(`${timestamp}.`).update(body).digest('hex');
  let response;
  const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){response={status:this.statusCode,body:value};return this;}};
  await handleV2BillingWebhook({body,headers:{'stripe-signature':signatureOverride || `t=${timestamp},v1=${signature}`}},res);
  return response;
}
test('signed late webhook reads current state and repeated delivery is deduplicated',async()=>{
 const org=await seed('starter'); let reads=0;
 stripe={subscriptions:{retrieve:async()=>{reads++;return subscription(org,'canceled');}}};
 const event={id:`evt_${db.uuid()}`,type:'customer.subscription.updated',data:{object:subscription(org)}};
 assert.equal((await deliver(event)).status,200);
 assert.equal((await row(org)).plan_id,'free');
 assert.equal((await deliver(event)).body.duplicate,true);
 assert.equal(reads,1);
});
test('invalid webhook signature cannot change entitlement',async()=>{
 const org=await seed(); let reads=0;
 stripe={subscriptions:{retrieve:async()=>{reads++;return subscription(org);}}};
 const event={id:`evt_${db.uuid()}`,type:'customer.subscription.updated',data:{object:subscription(org)}};
 assert.equal((await deliver(event,'t=1,v1=bad')).status,400);
 assert.equal((await row(org)).plan_id,'free');
 assert.equal(reads,0);
});
test('Stripe retrieval failure leaves webhook retryable, then successfully provisions',async()=>{
 const org=await seed(); let reads=0;
 stripe={subscriptions:{retrieve:async()=>{if(++reads===1)throw new Error('simulated Stripe outage');return subscription(org);}}};
 const event={id:`evt_${db.uuid()}`,type:'customer.subscription.created',data:{object:subscription(org)}};
 assert.equal((await deliver(event)).status,200);
 assert.equal((await row(org)).plan_id,'free');
 assert.equal((await db.get('SELECT status FROM ops_verified_stripe_receipts WHERE id=?',[event.id])).status,'pending');
 await db.run('UPDATE ops_verified_stripe_receipts SET next_attempt_at=0 WHERE id=?',[event.id]);
 const {createStripeReceiptWorker}=require('../lib/opsOutbox');
 await createStripeReceiptWorker(require('../routes/v2/billingWebhook').processStripeEvent).drain();
 assert.equal((await row(org)).plan_id,'starter');
});
test('checkout event replay waits for payment before applying authoritative plan',async()=>{
 const org=await seed();
 const { processStripeEvent } = require('../routes/v2/billingWebhook');
 stripe={subscriptions:{retrieve:async()=>subscription(org,'active','pro')}};
 const session={subscription:`sub_${org}`,payment_status:'unpaid',metadata:{org_id:org,plan_id:'starter'}};
 await processStripeEvent({type:'checkout.session.completed',data:{object:session}});
 assert.equal((await row(org)).plan_id,'free');
 await processStripeEvent({type:'checkout.session.async_payment_succeeded',data:{object:{...session,payment_status:'paid'}}});
 assert.equal((await row(org)).plan_id,'pro');
});

test('changing plan expires only an unpaid open checkout and uses a new retry key',async()=>{
 const org=await seed(); const expired=[]; let options;
 const prior={id:'cs_previous',status:'open',payment_status:'unpaid',metadata:{plan_id:'starter'}};
 stripe={subscriptions:{list:async()=>({data:[]})},checkout:{sessions:{
  list:async()=>({data:[prior]}),
  expire:async(id)=>{expired.push(id);return {...prior,status:'expired'};},
  create:async(params,opts)=>{options=opts;return {id:'cs_replacement',url:'https://example.com'};}
 }}};
 const result=await invokeCheckout(org,'pro');
 assert.equal(result.status,200);
 assert.deepEqual(expired,['cs_previous']);
 assert.ok(options.idempotencyKey.endsWith('cs_previous'));
 assert.equal(result.body.sessionId,'cs_replacement');
});

for (const atPeriodEnd of [true, false]) {
 test(`resume clears ${atPeriodEnd ? 'period-end' : 'custom-date'} cancellation with one Stripe parameter`,async()=>{
  const org=await seed('starter');
  await db.run('UPDATE v2_org_subscriptions SET stripe_subscription_id=? WHERE org_id=?',[`sub_${org}`,org]);
  let current={...subscription(org),cancel_at_period_end:atPeriodEnd,cancel_at:2000000000};
  let sent;
  stripe={subscriptions:{
   retrieve:async()=>current,
   update:async(id,params)=>{
    sent=params;
    if ('cancel_at_period_end' in params && 'cancel_at' in params) throw new Error('Received both cancel_at_period_end and cancel_at parameters');
    current={...current,cancel_at_period_end:false,cancel_at:null};return current;
   }
  }};
  const handler=router.stack.find(r=>r.route?.path==='/resume').route.stack.at(-1).handle;
  let code=200;
  await handler({v2Auth:{orgId:org,role:'owner'},body:{}},{status(c){code=c;return this;},json(){return this;}});
  assert.equal(code,200);
  assert.deepEqual(sent,atPeriodEnd ? {cancel_at_period_end:false} : {cancel_at:''});
  assert.equal((await row(org)).cancel_at_period_end,0);
 });
}
