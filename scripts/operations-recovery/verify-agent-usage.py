#!/usr/bin/env python3
"""Approved synthetic agent usage fixture; prints scoped aggregates, never credentials.

Direct fixture creation queues no customer projection; a backend restart may
backfill it. Cleanup uses the application's customer tombstone lifecycle and
keeps genuine provider-cost rows and their OpsHub outbox records. Deletes only
the disposable fixture's user/org/meeting and quota usage. Does not dispatch
agents or change application configuration.
"""
import argparse
import json
import subprocess
import sys
import uuid
from pathlib import Path

REMOTE = r'''
const {createRequire}=require('node:module');
const {execFileSync}=require('node:child_process');
const r=createRequire('/var/www/share-app-staging/livekit-app/backend/package.json');
const cfg=__CONFIG__;
async function main(){
 const ps=JSON.parse(execFileSync('pm2',['jlist'],{encoding:'utf8',maxBuffer:8*1024*1024})).filter(p=>p.name==='livekit-backend-staging');
 if(ps.length!==1||ps[0].pm2_env.status!=='online')throw Error('Backend not uniquely online');
 const env=ps[0].pm2_env, file=r('dotenv').parse(require('node:fs').readFileSync('/var/www/share-app-staging/livekit-app/backend/.env'));
 const value=k=>typeof env[k]==='string'?env[k]:(typeof env.env?.[k]==='string'?env.env[k]:file[k]);
 if(!value('DATABASE_URL'))throw Error('Postgres runtime URL missing');
 const client=new (r('pg').Client)({connectionString:value('DATABASE_URL')});
 await client.connect();
 const q=(s,p=[])=>client.query(s,p);
 const one=async(s,p=[])=>(await q(s,p)).rows[0];
 const count=async(s,p=[])=>Number((await one(s,p)).n);
 const {user,org,meeting,room}=cfg.fixture;
 const stt=['deepgram_stt_minute','gladia_stt_minute','openai_stt_minute','xai_stt_minute'];
 try{
  for(const k of ['SETTINGS_ENCRYPTION_KEY','JWT_SECRET_V2','JWT_SECRET'])if(value(k))process.env[k]=value(k);
  const billing=await one("SELECT stripe_secret_key,auto_charge_enabled FROM v2_platform_billing_settings WHERE id='default'");
  const key=(billing?.stripe_secret_key?r('./lib/secretCrypto').decryptSecret(billing.stripe_secret_key):null)||value('STRIPE_SECRET_KEY');
  const autocharge=billing?Boolean(billing.auto_charge_enabled):value('V2_AUTO_CHARGE_ENABLED')==='true';
  if(!String(key||'').startsWith('sk_test_')||autocharge)throw Error('Billing safety guard failed');
  if(cfg.action==='create'){
   await q('BEGIN');
   if(await count("SELECT COUNT(*) n FROM information_schema.triggers WHERE event_object_table=ANY($1::text[])",[['v2_users','v2_organizations','v2_org_subscriptions','v2_meetings']]))throw Error('Unexpected fixture table triggers');
   if(!await one("SELECT id FROM v2_plans WHERE id='free'"))throw Error('Free plan missing');
   await q("INSERT INTO v2_users(id,email,password_hash,display_name,disabled_at) VALUES($1,$2,$3,$4,to_char(timezone('utc',now()),'YYYY-MM-DD HH24:MI:SS'))",[user,user+'@synthetic.invalid','!disabled-synthetic-no-login','Synthetic usage verification']);
   await q("INSERT INTO v2_organizations(id,name,billing_status) VALUES($1,$2,'active')",[org,'Synthetic usage verification']);
   await q("INSERT INTO v2_org_subscriptions(org_id,plan_id,status,overage_auto_charge_opt_in) VALUES($1,'free','active',0)",[org]);
   await q("INSERT INTO v2_meetings(id,org_id,host_user_id,livekit_room_name,title,host_code,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)",[meeting,org,user,room,'Synthetic usage verification',require('node:crypto').randomBytes(24).toString('hex'),JSON.stringify({synthetic_usage_verification:true})]);
   await q('COMMIT');
  }
  const projection=await count('SELECT COUNT(*) n FROM ops_customer_source WHERE source_id=$1',[user]);
  const contactOutbox=await count('SELECT COUNT(*) n FROM ops_business_outbox o WHERE to_jsonb(o)::text LIKE $1',['%'+user+'%']);
  if(cfg.action==='cleanup-status'){
   const source=await one('SELECT revision,deleted,payload FROM ops_customer_source WHERE source_id=$1',[user]);
   const payload=source?JSON.parse(source.payload):null;
   const event=source?await one('SELECT status,result FROM ops_business_outbox WHERE event_id=$1',['contact:'+user+':'+source.revision]):null;
   const result=event?.result?JSON.parse(event.result):null;
   const remaining=await count('SELECT COUNT(*) n FROM v2_users WHERE id=$1',[user])+await count('SELECT COUNT(*) n FROM v2_organizations WHERE id=$1',[org])+await count('SELECT COUNT(*) n FROM v2_meetings WHERE id=$1',[meeting]);
   const cleared=source?.deleted===1&&payload?.sourceId===user&&payload?.deleted===true&&Object.keys(payload).length===2;
   const passed=remaining===0&&cleared&&event?.status==='delivered'&&result?.status==='applied';
   console.log(JSON.stringify({action:cfg.action,profile:cfg.fixture.profile,passed,remaining_fixture_rows:remaining,tombstone_payload_cleared:cleared,tombstone_outbox_status:event?.status,tombstone_result_status:result?.status,cost_rows_retained:await count('SELECT COUNT(*) n FROM meeting_cost_events WHERE meeting_id=$1',[room])}));
   return;
  }
  const exists=await one('SELECT m.id FROM v2_meetings m JOIN v2_users u ON u.id=m.host_user_id JOIN v2_org_subscriptions s ON s.org_id=m.org_id WHERE m.id=$1 AND m.org_id=$2 AND m.livekit_room_name=$3 AND u.id=$4 AND u.disabled_at IS NOT NULL AND u.email=$5 AND s.plan_id=\'free\' AND s.overage_auto_charge_opt_in=0 AND s.stripe_customer_id IS NULL AND s.stripe_subscription_id IS NULL',[meeting,org,room,user,user+'@synthetic.invalid']);
  if(!exists)throw Error('Fixture identity/safety mismatch');
  const costs=(await q('SELECT event_type,COUNT(*)::int rows,SUM(units)::float8 units,SUM(total_cost_usd)::float8 cost_usd FROM meeting_cost_events WHERE meeting_id=$1 GROUP BY event_type ORDER BY event_type',[room])).rows;
  const costAttributionMismatches=await count('SELECT COUNT(*) n FROM meeting_cost_events WHERE meeting_id=$1 AND org_id IS DISTINCT FROM $2',[room,org]);
  const usages=(await q('SELECT event_type,COUNT(*)::int rows,SUM(quantity)::float8 units FROM v2_usage_events WHERE org_id=$1 AND meeting_id=$2 GROUP BY event_type ORDER BY event_type',[org,meeting])).rows;
  const mirror=await one(`SELECT COUNT(*)::int stt_rows,COALESCE(SUM(c.units),0)::float8 stt_minutes,COUNT(u.id)::int mirrored_rows,COALESCE(SUM(u.quantity),0)::float8 mirrored_minutes,COUNT(*) FILTER(WHERE u.id IS NULL OR ABS(c.units-u.quantity)>1e-10)::int mismatch_rows FROM meeting_cost_events c LEFT JOIN v2_usage_events u ON u.org_id=$2 AND u.meeting_id=$3 AND u.idempotency_key='cost:'||$3||':'||c.id::text AND u.event_type='translation_minute' WHERE c.meeting_id=$1 AND c.event_type=ANY($4::text[]) AND c.units>0`,[room,org,meeting,stt]);
  const balance=await one(`SELECT COALESCE(s.custom_included_translation_minutes,p.included_translation_minutes)::float8 included_minutes,COALESCE((SELECT SUM(quantity) FROM v2_usage_events WHERE org_id=$1 AND event_type='translation_minute' AND created_at>=to_char(date_trunc('month',timezone('utc',now())),'YYYY-MM-DD HH24:MI:SS')),0)::float8 used_minutes FROM v2_org_subscriptions s JOIN v2_plans p ON p.id=s.plan_id WHERE s.org_id=$1`,[org]);
  balance.remaining_minutes=Math.max(0,balance.included_minutes-balance.used_minutes);
  const translation=usages.find(x=>x.event_type==='translation_minute');
  const positiveLLM=['openai_llm_input_mtok','openai_llm_output_mtok'].every(t=>costs.some(x=>x.event_type===t&&x.units>0&&x.cost_usd>0));
  const positiveSTT=costs.some(x=>stt.includes(x.event_type)&&x.units>0&&x.cost_usd>0);
  const positiveTTS=costs.some(x=>x.event_type.endsWith('_tts_char')&&x.units>0&&x.cost_usd>0);
  const passed=costAttributionMismatches===0&&mirror.stt_rows>=2&&mirror.mismatch_rows===0&&mirror.stt_rows===mirror.mirrored_rows&&Math.abs(mirror.stt_minutes-mirror.mirrored_minutes)<1e-10&&Math.abs(mirror.stt_minutes-balance.used_minutes)<1e-10&&translation?.rows===mirror.stt_rows&&positiveSTT&&positiveLLM&&(cfg.fixture.profile!=='primary'||positiveTTS);
  let cleanup=null;
  if(cfg.action==='cleanup'){
   // Bind application lifecycle helpers to this isolated process's connection;
   // avoid initDatabase() and its unrelated startup migrations.
   const convert=r('./db/sqlCompat').toPostgresSql;
   const tx={run:async(s,p=[])=>{const x=await q(convert(s),p);return {changes:x.rowCount,lastID:x.rows[0]?.id||0};},get:async(s,p=[])=>one(convert(s),p),all:async(s,p=[])=> (await q(convert(s),p)).rows};
   const adapter={...tx,isPostgres:()=>true,transaction:async work=>{await q('BEGIN');try{const out=await work(tx);await q('COMMIT');return out;}catch(e){await q('ROLLBACK');throw e;}}};
   const dbPath=r.resolve('./db/v2Database');
   require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:adapter};
   if(value('OPS_HUB_BUSINESS_ID'))process.env.OPS_HUB_BUSINESS_ID=value('OPS_HUB_BUSINESS_ID');
   const {customerMutation,queueContactTombstone}=r('./lib/opsOutbox');
   await customerMutation(async tx=>{
    if(await count('SELECT COUNT(*) n FROM v2_overage_ledger WHERE org_id=$1',[org]))throw Error('Unexpected synthetic overage ledger; inspect before cleanup');
    await queueContactTombstone(tx,user);
    await q('DELETE FROM v2_usage_events WHERE org_id=$1 AND meeting_id=$2',[org,meeting]);
    await q('DELETE FROM v2_meetings WHERE id=$1 AND org_id=$2',[meeting,org]);
    await q('DELETE FROM v2_usage_rollups WHERE org_id=$1',[org]);
    await q('DELETE FROM v2_billing_cycles WHERE org_id=$1',[org]);
    await q('DELETE FROM v2_org_subscriptions WHERE org_id=$1',[org]);
    await q('DELETE FROM v2_organizations WHERE id=$1',[org]);
    await q('DELETE FROM v2_users WHERE id=$1 AND disabled_at IS NOT NULL',[user]);
   });
   cleanup={fixture_deleted:true,cost_rows_retained:true,customer_tombstone_queued:true,prior_customer_projection_rows:projection,prior_customer_outbox_rows:contactOutbox};
  }
  console.log(JSON.stringify({action:cfg.action,verified_at:new Date().toISOString(),profile:cfg.fixture.profile,fixture:cfg.fixture,costs,usages,mirror,balance,passed,cost_attribution_mismatches:costAttributionMismatches,customer_projection_rows:projection,customer_outbox_rows:contactOutbox,billing:{stripe_mode:'test',autocharge:false},cleanup}));
 }catch(e){await q('ROLLBACK').catch(()=>{});throw e;}finally{await client.end();}
}
main().catch(e=>{console.error(JSON.stringify({failed:true,error_type:e.name,database_code:e.code,database_table:e.table,database_constraint:e.constraint,reason:/^(Backend|Billing|Postgres|Unexpected|Free|Synthetic|Fixture)/.test(e.message)?e.message:'Database operation failed; details withheld'}));process.exitCode=1;});
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('create', 'check', 'cleanup', 'cleanup-status'))
    parser.add_argument('--profile', choices=('stable', 'primary'), required=True)
    parser.add_argument('--state', type=Path, required=True)
    args = parser.parse_args()
    if args.action == 'create':
        if args.state.exists():
            state = json.loads(args.state.read_text())
            if set(state) != {'fixture'}:
                raise RuntimeError('Completed creation state already exists')
            fixture = state['fixture']
        else:
            suffix = uuid.uuid4().hex
            fixture = {'profile': args.profile, 'user': 'synthetic-usage-user-' + suffix,
                       'org': 'synthetic-usage-org-' + suffix, 'meeting': str(uuid.uuid4()),
                       'room': 'lalia-canary-usage-' + args.profile + '-' + suffix}
            args.state.write_text(json.dumps({'fixture': fixture}, indent=2) + '\n')
    else:
        fixture = json.loads(args.state.read_text())['fixture']
    if fixture['profile'] != args.profile or not fixture['user'].startswith('synthetic-usage-user-') or not fixture['org'].startswith('synthetic-usage-org-') or not fixture['room'].startswith('lalia-canary-usage-' + args.profile + '-'):
        raise RuntimeError('Unexpected synthetic fixture state')
    program = REMOTE.replace('__CONFIG__', json.dumps({'action': args.action, 'fixture': fixture}))
    result = subprocess.run(['ssh', '-i', '/Users/rhule/Downloads/AxisAlgo.pem', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes', 'ubuntu@3.16.210.84', 'node', '-'], input=program, text=True, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError('Remote fixture operation failed: ' + result.stderr[-500:])
    evidence = json.loads(result.stdout)
    state = json.loads(args.state.read_text())
    state[args.action] = evidence
    args.state.write_text(json.dumps(state, indent=2) + '\n')
    print(json.dumps(evidence))
    if args.action in ('check', 'cleanup-status') and not evidence['passed']:
        return 1
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'failed': True, 'error_type': type(error).__name__, 'reason': str(error) if isinstance(error, RuntimeError) else 'Details withheld'}), file=sys.stderr)
        sys.exit(1)
