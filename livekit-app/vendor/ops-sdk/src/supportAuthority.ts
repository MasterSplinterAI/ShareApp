import type {createSupportAcceptanceStore} from './supportAcceptance.js';
class AuthorityTransportUnavailable extends Error {}
import {supportIntentEvidence,type SupportIntent,type SupportGatewayConfig} from './supportGateway.js';
export interface HostSupportAuthority {businessId:string;generation:string;state:'unmanaged'|'legacy'|'frozen'|'central'|'central_frozen'|'recovery'|'recovery_frozen';expiresAt:number;revision:number;freezeId?:string|null;acceptanceClosed?:boolean;restoreId?:string}
/** Persisted latch prevents config removal, old generation replay or a host flag from resurrecting a writer. */
export interface SupportAuthorityLatch {revision:number;origin:string;legacyDisabled:boolean}
export function createSupportAuthorityClient(options:{businessId:string;getConfig:()=>Promise<SupportGatewayConfig>|SupportGatewayConfig;readLatch:()=>Promise<number|SupportAuthorityLatch|null>;writeLatch:(revision:number,details:{origin:string;legacyDisabled:boolean})=>Promise<void>;fetchImpl?:typeof fetch;acceptance?:ReturnType<typeof createSupportAcceptanceStore>}){
 const transport=options.fetchImpl??fetch;
 async function rpc(body?:unknown){
  const cfg=await options.getConfig();if(cfg.businessId&&cfg.businessId!==options.businessId)throw Error('Configured support identity changed');const latch=await options.readLatch();
  if(!cfg.baseUrl||!cfg.secretKey){if(latch!==null||cfg.mode==='central')throw Error('Enrolled support authority unavailable');return {businessId:options.businessId,state:'unmanaged',generation:'0',revision:0,expiresAt:Date.now()+30000};}
  const known=typeof latch==='number'?{revision:latch,origin:'',legacyDisabled:true}:latch;
  const url=new URL(cfg.baseUrl);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Invalid authority origin');
  if(known?.origin&&known.origin!==url.origin)throw Error('Known support authority origin cannot be changed');
  let response:Response;try{response=await transport(url.origin+'/api/v1/support/authority',{method:body?'POST':'GET',headers:{'X-Ops-Key':cfg.secretKey,'X-Ops-Tenant':options.businessId,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(5000)});}catch{throw new AuthorityTransportUnavailable('Authority transport unavailable');}
  if(response.status>=500)throw new AuthorityTransportUnavailable('Authority transport unavailable');
  if([401,403].includes(response.status))await options.acceptance?.invalidate(options.businessId);
  if(!response.ok)throw Error('Support authority unavailable');const value=await response.json();if(value.businessId!==options.businessId)throw Error('Wrong business authority');
  if(value.state){if(!['unmanaged','legacy','frozen','central','central_frozen','recovery','recovery_frozen'].includes(value.state)||!Number.isSafeInteger(value.revision)||!Number.isFinite(value.expiresAt)||value.expiresAt<=Date.now())throw Error('Invalid authority state');if(value.state==='unmanaged'&&known!==null||known&&value.revision<known.revision||known?.legacyDisabled&&value.state==='legacy')throw Error('Support authority rollback refused');if(value.state!=='unmanaged')await options.writeLatch(value.revision,{origin:url.origin,legacyDisabled:Boolean(known?.legacyDisabled||!['unmanaged','legacy'].includes(value.state))});}
  return value;
 }
 async function read():Promise<HostSupportAuthority>{
  let value:HostSupportAuthority;try{value=await rpc();}catch(error){if(!(error instanceof AuthorityTransportUnavailable)||!options.acceptance)throw error;const cfg=await options.getConfig();if(!cfg.baseUrl||!cfg.secretKey)throw error;const cached=await options.acceptance.cached(options.businessId,new URL(cfg.baseUrl).origin);if(!cached)throw error;return cached;}
  if(options.acceptance&&['frozen','central','central_frozen','recovery'].includes(value.state)&&!value.acceptanceClosed){const cfg=await options.getConfig();await options.acceptance.establish(value,new URL(cfg.baseUrl!).origin,()=>rpc({action:'acquire-intent',generation:value.generation}),id=>rpc({action:'release',id,outcome:'complete'}));}
  return value;
 }
 return {
  read,
  async config(){const cfg=await options.getConfig(),authority=await read();return {...cfg,businessId:options.businessId,tenantSlug:options.businessId,mode:authority.state==='unmanaged'?cfg.mode:['legacy','recovery'].includes(authority.state)?'local' as const:'central' as const};},
  async resolveAuthority(businessId:string){if(businessId!==options.businessId)return null;const row=await read();return !row.acceptanceClosed&&['frozen','central','central_frozen'].includes(row.state)?{businessId,generation:row.generation,expiresAt:row.expiresAt}:null;},
  async acquire(){const row=await read();if(row.state==='unmanaged')return {id:null,expiresAt:Date.now()+30000};if(row.state!=='legacy')throw Error('Legacy authority fenced');return rpc({action:'acquire'});},
  async release(id:string|null,outcome:'complete'|'unknown'){if(id)await rpc({action:'release',id,outcome});},
  async withAcceptance<T>(businessId:string,generation:string,persist:()=>Promise<T>):Promise<T>{
   if(businessId!==options.businessId||!options.acceptance)throw Error('Local acceptance fence required');return options.acceptance.run(businessId,generation,persist);
  },
  async sealAcceptance(freezeId:string){
   if(!options.acceptance)throw Error('Source acceptance fence required');const authority:HostSupportAuthority=await rpc();if(!['frozen','central_frozen','recovery_frozen'].includes(authority.state)||authority.freezeId!==freezeId)throw Error('Matching frozen authority required');
   const cfg=await options.getConfig();const grant=await options.acceptance.seal(authority,new URL(cfg.baseUrl!).origin);if(grant)await rpc({action:'release',id:grant.id,outcome:'complete'});return {businessId:options.businessId,generation:authority.generation,freezeId,sealed:true};
  },
  async authorizeTransfer(intent:SupportIntent,generation:string){const value=await rpc({action:'transfer-check',generation,evidence:supportIntentEvidence(intent),status:intent.status});return value.authorized===true;},
 };
}
type Lease={id:string|null;expiresAt:number};
type Scope={lease:Lease;tasks:Promise<unknown>[];closed:boolean};
/** Host supplies AsyncLocalStorage; no process-global counters or cross-request mutable scope. */
export function createLegacySupportFence(options:{context:{getStore():Scope|undefined;run<T>(store:Scope,callback:()=>T):T};acquire:()=>Promise<Lease>;release:(id:string|null,outcome:'complete'|'unknown')=>Promise<unknown>;now?:()=>number}){
 const now=options.now??Date.now;
 const assertLease=()=>{const scope=options.context.getStore();if(!scope||scope.closed||scope.lease.expiresAt<=now())throw Error('Legacy write lease unavailable or expired');return scope;};
 function track(task:Promise<unknown>){const scope=assertLease();scope.tasks.push(task);void task.catch(()=>{});}
 async function run<T>(operation:()=>Promise<T>):Promise<T>{
  const lease=await options.acquire();if(lease.expiresAt<=now())throw Error('Legacy lease expired');
  const scope:Scope={lease,tasks:[],closed:false};let outcome:'complete'|'unknown'='complete';
  try{return await options.context.run(scope,async()=>{let result:T|undefined,error:unknown;try{result=await operation();}catch(e){error=e;}
   // Children can register more children while earlier work is settling. Drain until stable.
   for(let i=0;i<scope.tasks.length;i++){try{await scope.tasks[i];}catch(e){error??=e;}}
   if(error)throw error;return result as T;
  });}catch(e){outcome='unknown';throw e;}finally{scope.closed=true;await options.release(lease.id,outcome);}
 }
 function effect<T>(operation:()=>Promise<T>):Promise<T>{assertLease();const task=run(operation);track(task);return task;}
 return {run,track,assertLease,effect};
}
