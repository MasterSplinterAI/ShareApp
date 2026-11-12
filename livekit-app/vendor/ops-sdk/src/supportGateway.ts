import type { SupportForwardedUser } from './index.js';

export type SupportMode = 'local' | 'mirror' | 'proxy' | 'central';
export interface SupportGatewayConfig {
  mode?: SupportMode; baseUrl?: string | null; secretKey?: string | null; tenantSlug: string;
}
/** Supplied by trusted server registry/lease validation. A browser setting is not authority. */
export interface SupportAuthority { businessId: string; generation: string; expiresAt: number }
export interface GuestEvidence {
  tokenHash: string; issuedAt: number; expiresAt: number; encryptedToken: string;
}
export interface SupportIntent {
  receiptId: string; scope: string; businessId: string; generation: string;
  actor: SupportForwardedUser; actorType: 'customer' | 'guest';
  operation: string; key: string; payload: Record<string, unknown>; payloadHash: string;
  acceptedAt: number; acceptedUntil: number; encryptedGuestToken?: string;
  status: 'pending' | 'accepted' | 'failed'; responseStatus?: number; response?: unknown;
  automaticAttempts?:number; nextAttemptAt?:number; retryPaused?:boolean;
}
/** put must atomically insert by scope or return the existing row (never overwrite it). */
export interface SupportIntentStore {
  put(intent: SupportIntent): Promise<SupportIntent>;
  get(receiptId: string): Promise<SupportIntent | null>;
  find(scope: string): Promise<SupportIntent | null>;
  pending(businessId:string,limit:number,now?:number):Promise<SupportIntent[]>;
  claimAttempt(receiptId:string,now:number,leaseMs:number):Promise<{token:string;attempt:number}|null>;
  finishAttempt(receiptId:string,token:string,attempt:number,now:number):Promise<void>;
  update(receiptId: string, patch: Partial<SupportIntent>, fence?:{token:string;now:number}): Promise<void>;
  rememberGuest?(businessId: string, evidence: GuestEvidence): Promise<void>;
  guest?(businessId: string, tokenHash: string): Promise<GuestEvidence | null>;
}
export interface SupportGatewayOptions {
  getConfig: () => SupportGatewayConfig | Promise<SupportGatewayConfig>;
  resolveAuthority?: (businessId: string) => Promise<SupportAuthority | null>;
  resolveUser: (request: any) => SupportForwardedUser | null | Promise<SupportForwardedUser | null>;
  /** Must read current account/membership, never cached browser claims. */
  customerActive?: (businessId: string, user: SupportForwardedUser) => Promise<boolean>;
  store: SupportIntentStore;
  sealSecret?: (secret: string) => string | Promise<string>;
  openSecret?: (secret: string) => string | Promise<string>;
  fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => number;
}
export const SUPPORT_MAX_AUTOMATIC_ATTEMPTS = 64;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY = 64 * 1024;
const keyPattern = /^[A-Za-z0-9:_-]{8,128}$/;
const idPattern = '[A-Za-z0-9_-]{1,128}';
export function canonicalSupportPayload(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSupportPayload).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalSupportPayload((value as any)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function supportPayloadHash(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalSupportPayload(value)));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2,'0')).join('');
}
const header = (req: any, name: string) => typeof req.headers?.[name] === 'string' ? req.headers[name] : '';
const safeActor = (user: SupportForwardedUser): SupportForwardedUser => ({
  id: String(user.id), role: 'user',
  ...Object.fromEntries(['email','name','orgId','planLabel','contextSummary'].flatMap(k => typeof (user as any)[k] === 'string' ? [[k,(user as any)[k].slice(0,k === 'contextSummary' ? 12000 : 320)]] : [])),
});
function route(method: string, raw: string) {
  if (!raw.startsWith('/') || raw.startsWith('//') || /[%\\#]|(?:^|\/)\.\.(?:\/|$)/.test(raw)) return null;
  const [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  const keys = [...params.keys()];
  if (keys.length !== new Set(keys).size || keys.some(k => !['status','kind','q','limit'].includes(k)) || query.length > 1024) return null;
  const read = method === 'GET' && ['/health','/config','/tickets','/help/articles'].includes(path) || method === 'GET' && new RegExp(`^/tickets/${idPattern}$`).test(path);
  const durable = method === 'POST' && (['/tickets','/leads'].includes(path) || new RegExp(`^/tickets/${idPattern}/messages$`).test(path));
  const transient = method === 'POST' && ['/chat','/coach','/guest-session'].includes(path);
  const pending = method === 'GET' && new RegExp(`^/pending/${idPattern}$`).test(path);
  if (!(read || durable || transient || pending) || method === 'POST' && query) return null;
  return { path, durable, pending, operation: `${method}:${path}` };
}
function cleanBody(path: string, raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid body');
  const fields = path === '/leads' ? ['name','email','phone','marketingOptIn','source','consentText']
    : path === '/guest-session' ? ['name','email']
    : path === '/chat' ? ['message','ticketId','kind','topic','leadId']
    : path === '/coach' ? ['kind','messages']
    : path.endsWith('/messages') ? ['body']
    : ['kind','topic','subject','body','severity','priority','guestEmail','leadId'];
  const payload = Object.fromEntries(fields.filter(k => Object.hasOwn(raw,k)).map(k => [k,(raw as any)[k]]));
  if (JSON.stringify(payload).length > MAX_BODY) throw Error('Body too large');
  return payload;
}

/** Customer-only resilient gateway. No timers, workers or authority start on import. */
export function createSupportGateway(options: SupportGatewayOptions) {
  const now = options.now ?? Date.now;
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 8000, 30_000));
  async function authority() {
    const cfg = await options.getConfig();
    if (cfg.mode !== 'central' || !cfg.baseUrl || !cfg.secretKey) throw Error('Central configuration unavailable');
    const url = new URL(cfg.baseUrl);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('Invalid hub origin');
    const lease = await options.resolveAuthority?.(cfg.tenantSlug);
    if (!lease || lease.businessId !== cfg.tenantSlug || !lease.generation || lease.expiresAt <= now()) throw Error('Central authority unavailable');
    return { cfg, lease, origin: url.origin };
  }
  async function remote(auth: Awaited<ReturnType<typeof authority>>, method: string, path: string, payload?: unknown, actor?: SupportForwardedUser | null, key?: string, guestToken?: string, intent?: SupportIntent) {
    const headers: Record<string,string> = { Accept:'application/json', 'X-Ops-Key':auth.cfg.secretKey!, 'X-Ops-Tenant':auth.cfg.tenantSlug, 'x-tenant-id':auth.cfg.tenantSlug };
    if (actor) headers['X-Support-User-Json'] = Buffer.from(JSON.stringify(safeActor(actor))).toString('base64url');
    if (key) headers['Idempotency-Key'] = key;
    if (guestToken) headers['x-support-guest-token'] = guestToken;
    if (intent) headers['x-support-accepted-intent'] = Buffer.from(JSON.stringify({ businessId:intent.businessId,generation:intent.generation,operation:intent.operation,key:intent.key,payloadHash:intent.payloadHash,acceptedAt:intent.acceptedAt,acceptedUntil:intent.acceptedUntil })).toString('base64url');
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async()=>{const response = await fetchFn(auth.origin+'/api/v1/support'+path,{ method,headers,body:payload === undefined ? undefined : JSON.stringify(payload),signal:controller.signal,redirect:'error' });
          const text = await response.text();if(text.length > 1024*1024)throw Error('Response too large');
          return {status:response.status,body:JSON.parse(text)};})(),
        new Promise<never>((_, reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Support timeout'));},timeoutMs);}),
      ]);
    } finally { clearTimeout(timer); }
  }
  async function mayAccess(intent:SupportIntent,auth:Awaited<ReturnType<typeof authority>>) {
    return intent.businessId===auth.lease.businessId && intent.generation===auth.lease.generation && intent.acceptedUntil>now() &&
      (intent.actorType==='guest' || Boolean(await options.customerActive?.(intent.businessId,intent.actor)));
  }
  async function deliver(intent:SupportIntent,auth:Awaited<ReturnType<typeof authority>>,attemptToken?:string) {
    // Always report the winning durable outcome, even if this caller held an older pending snapshot.
    intent=await options.store.get(intent.receiptId)??intent;
    if(intent.status!=='pending' || !await mayAccess(intent,auth))return intent;
    let result;
    try {
      const secret=intent.encryptedGuestToken?await options.openSecret?.(intent.encryptedGuestToken):undefined;
      if(intent.actorType==='guest'&&!secret)throw Error('Guest secret unavailable');
      const [method,path]=intent.operation.split(':');
      result=await remote(auth,method,path,intent.payload,intent.actorType==='customer'?intent.actor:null,intent.key,secret,intent);
    }catch{return await options.store.get(intent.receiptId)??intent;}
    // Authentication failure says nothing about a prior ambiguous remote commit.
    if(result.status>=500 || [401,403,429].includes(result.status))return await options.store.get(intent.receiptId)??intent;
    await options.store.update(intent.receiptId,{status:result.status>=200&&result.status<300?'accepted':'failed',responseStatus:result.status,response:result.body},attemptToken?{token:attemptToken,now:now()}:undefined);
    return await options.store.get(intent.receiptId)??intent;
  }
  const publicStatus=(intent:SupportIntent,accessible=true)=>({status:intent.status,receiptId:intent.receiptId,
    ...(accessible&&intent.status==='accepted'?{result:intent.response}:{}),
    ...(intent.status==='pending'&&intent.retryPaused?{retryPaused:true}:{}),
    ...(!accessible?{accessDenied:true}:{})});
  return {
    async replay(receiptId:string,attemptToken?:string) {
      const auth=await authority();const intent=await options.store.get(receiptId);
      if(!intent)throw Error('Unknown receipt');
      const result=await deliver(intent,auth,attemptToken);return publicStatus(result,await mayAccess(result,auth));
    },
    async handler(req:any,res:any) {
      const reply=(status:number,body:unknown)=>{res.setHeader?.('Cache-Control','no-store');return res.status(status).json(body);};
      try {
        const auth=await authority();
        const method=String(req.method||'GET').toUpperCase();const raw=String(req.url||'/');const matched=route(method,raw);
        if(!matched)return reply(400,{error:'Unsupported customer support operation'});
        const resolved=await options.resolveUser(req);const actor=resolved ? safeActor(resolved) : null;
        if(actor && !await options.customerActive?.(auth.cfg.tenantSlug,actor))return reply(matched.pending?404:401,{error:'Account unavailable'});
        const guestToken=header(req,'x-support-guest-token');
        const tokenHash=guestToken ? await supportPayloadHash(guestToken) : '';
        if(matched.pending) {
          const intent=await options.store.get(matched.path.slice('/pending/'.length));
          if(!intent || intent.businessId !== auth.cfg.tenantSlug || intent.generation !== auth.lease.generation || intent.acceptedUntil <= now() ||
            (intent.actorType === 'customer' ? !actor || actor.id !== intent.actor.id || actor.orgId !== intent.actor.orgId : actor || !tokenHash || intent.actor.id !== tokenHash))return reply(404,{error:'Receipt not found'});
          if(intent.actorType === 'guest') {
            const check=await remote(auth,'POST','/guest-session/validate',{},null,undefined,guestToken);
            if(check.status!==200)return reply(404,{error:'Receipt not found'});
          }
          return reply(200,publicStatus(intent));
        }
        const payload=method === 'POST' ? cleanBody(matched.path,req.body??{}) : undefined;
        if(matched.durable) {
          const key=header(req,'idempotency-key');if(!keyPattern.test(key))return reply(400,{error:'Valid Idempotency-Key required'});
          let guest: GuestEvidence | null = null;
          if(!actor) {
            guest=tokenHash ? await options.store.guest?.(auth.cfg.tenantSlug,tokenHash)??null : null;
            if(!guest)return reply(401,{error:'Guest session proof required',code:'guest_session_required'});
          }
          const acceptedAt=now();const identity=actor??{id:tokenHash,role:'user' as const};
          const scope=JSON.stringify([auth.cfg.tenantSlug,auth.lease.generation,actor?'customer':'guest',identity.id,identity.orgId??'',matched.operation,key]);
          const payloadHash=await supportPayloadHash(payload);
          // Existing accepted proof may be replayed after its ordinary guest session expiry.
          const candidate: SupportIntent={receiptId:crypto.randomUUID(),scope,businessId:auth.cfg.tenantSlug,generation:auth.lease.generation,actor:identity,actorType:actor?'customer':'guest',operation:matched.operation,key,payload:payload!,payloadHash,acceptedAt,acceptedUntil:acceptedAt+MAX_AGE,status:'pending',...(guest?{encryptedGuestToken:guest.encryptedToken}:{})};
          const existing=await options.store.find(scope);
          if(guest && guest.expiresAt <= now() && !existing) {
            // An expired proof cannot authorize a new submission; the store must not insert it.
            return reply(401,{error:'Guest session expired',code:'guest_session_required'});
          }
          if(guest && (!options.openSecret || await options.openSecret(guest.encryptedToken)!==guestToken))throw Error('Guest proof encryption unavailable');
          const retained=existing??await options.store.put(candidate);
          if(retained.payloadHash !== payloadHash)return reply(409,{error:'Idempotency key payload conflict'});
          if(!await mayAccess(retained,auth))return reply(409,{error:"Accepted intent access expired or revoked",receiptId:retained.receiptId});
          let result:SupportIntent;
          try {result=await deliver(retained,auth);} catch {return reply(202,publicStatus(retained));}
          if(result.status === 'pending')return reply(202,publicStatus(result));
          if(result.responseStatus)return reply(result.responseStatus,result.response);
          return reply(409,{...publicStatus(result),error:'Accepted intent is no longer authorized'});
        }
        const key=header(req,'idempotency-key');
        const result=await remote(auth,method,raw,payload,actor,keyPattern.test(key)?key:undefined,guestToken||undefined);
        if(matched.path === '/guest-session' && result.status === 201) {
          const token=result.body.guestSessionToken;const expiresAt=Date.parse(result.body.guestSessionExpiresAt);
          if(typeof token !== 'string' || !Number.isFinite(expiresAt) || expiresAt <= now() || !options.sealSecret || !options.store.rememberGuest)throw Error('Guest proof storage unavailable');
          const encryptedToken=await options.sealSecret(token);if(!encryptedToken || encryptedToken===token)throw Error('Guest proof encryption unavailable');
          await options.store.rememberGuest(auth.cfg.tenantSlug,{tokenHash:await supportPayloadHash(token),issuedAt:now(),expiresAt,encryptedToken});
        }
        return reply(result.status,result.body);
      } catch {
        return reply(503,{error:'Support is temporarily unavailable. Submission could not be confirmed. Your draft is retained; retry with the same submission key.',retryable:true,code:'support_unavailable'});
      }
    },
  };
}

export interface SupportSql {run(sql:string,params?:unknown[]):Promise<unknown>;get(sql:string,params?:unknown[]):Promise<any>;all(sql:string,params?:unknown[]):Promise<any[]>}
export const SUPPORT_PENDING_SCHEMA = [
 `CREATE TABLE IF NOT EXISTS ops_support_pending (receipt_id TEXT PRIMARY KEY, business_id TEXT NOT NULL, scope TEXT NOT NULL UNIQUE, record_json TEXT NOT NULL, encrypted_secret TEXT, status TEXT NOT NULL, response_status INTEGER, response_json TEXT)`,
 `CREATE TABLE IF NOT EXISTS ops_support_retry (receipt_id TEXT PRIMARY KEY, attempts INTEGER NOT NULL, next_attempt_at BIGINT NOT NULL, lease_token TEXT, lease_until BIGINT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS ops_support_guest_evidence (business_id TEXT NOT NULL, token_hash TEXT NOT NULL, issued_at BIGINT NOT NULL, expires_at BIGINT NOT NULL, encrypted_secret TEXT NOT NULL, PRIMARY KEY(business_id,token_hash))`,
];
/** Each transition is one atomic SQL statement; no shared SQLite transaction can capture other work. */
export function createSqlSupportIntentStore(sql:SupportSql):SupportIntentStore {
 const decode=(row:any):SupportIntent|null=>row?{...JSON.parse(row.record_json),...(row.encrypted_secret?{encryptedGuestToken:row.encrypted_secret}:{}),status:row.status,
  automaticAttempts:Number(row.attempts??0),nextAttemptAt:Number(row.next_attempt_at??0),retryPaused:row.status==='pending'&&Number(row.attempts??0)>=SUPPORT_MAX_AUTOMATIC_ATTEMPTS,
  ...(row.response_status?{responseStatus:row.response_status,response:JSON.parse(row.response_json)}:{})}:null;
 const select='SELECT p.*,r.attempts,r.next_attempt_at FROM ops_support_pending p LEFT JOIN ops_support_retry r ON r.receipt_id=p.receipt_id';
 const find=async(scope:string)=>decode(await sql.get(select+' WHERE p.scope=?',[scope]));
 return {
  find,
  async pending(businessId,limit,now=Date.now()) {
   const rows=await sql.all(select+" WHERE p.business_id=? AND p.status='pending' AND COALESCE(r.next_attempt_at,0)<=? AND COALESCE(r.lease_until,0)<=? AND COALESCE(r.attempts,0)<? ORDER BY COALESCE(r.next_attempt_at,0),COALESCE(r.attempts,0),p.receipt_id LIMIT ?",[businessId,now,now,SUPPORT_MAX_AUTOMATIC_ATTEMPTS,Math.max(1,Math.min(50,Math.floor(limit)))]);
   return rows.map(decode) as SupportIntent[];
  },
  get:async(id)=>decode(await sql.get(select+' WHERE p.receipt_id=?',[id])),
  async claimAttempt(id,now,leaseMs) {
   const token=crypto.randomUUID();
   // A missing scheduling row is reconstructed atomically from the accepted intent, including after a crash.
   const row=await sql.get(`INSERT INTO ops_support_retry(receipt_id,attempts,next_attempt_at,lease_token,lease_until)
    SELECT receipt_id,1,?,?,? FROM ops_support_pending WHERE receipt_id=? AND status='pending'
    ON CONFLICT(receipt_id) DO UPDATE SET attempts=ops_support_retry.attempts+1,lease_token=excluded.lease_token,lease_until=excluded.lease_until
    WHERE ops_support_retry.lease_until<=? AND ops_support_retry.next_attempt_at<=? AND ops_support_retry.attempts<?
    RETURNING lease_token,attempts`,[now,token,now+leaseMs,id,now,now,SUPPORT_MAX_AUTOMATIC_ATTEMPTS]);
   return row?{token:row.lease_token,attempt:Number(row.attempts)}:null;
  },
  async finishAttempt(id,token,attempt,now) {
   const delay=Math.min(3600000,5000*2**Math.min(attempt-1,20));
   await sql.run('UPDATE ops_support_retry SET next_attempt_at=?,lease_token=NULL,lease_until=0 WHERE receipt_id=? AND lease_token=? AND lease_until>?',[now+delay,id,token,now]);
  },
  async put(intent) {
   const {encryptedGuestToken,...record}=intent;
   await sql.run('INSERT INTO ops_support_pending(receipt_id,business_id,scope,record_json,encrypted_secret,status) VALUES(?,?,?,?,?,?) ON CONFLICT(scope) DO NOTHING',[intent.receiptId,intent.businessId,intent.scope,JSON.stringify(record),encryptedGuestToken??null,'pending']);
   const saved=await find(intent.scope);if(!saved)throw Error('Intent persistence failed');return saved;
  },
  async update(id,patch,fence) {
   // Timeout has no write. Terminal results cannot be overwritten by another concurrent attempt.
   if(!['accepted','failed'].includes(patch.status??''))throw Error('Invalid intent transition');
   await sql.run("UPDATE ops_support_pending SET status=?,response_status=?,response_json=? WHERE receipt_id=? AND status='pending'"+
    (fence?" AND EXISTS(SELECT 1 FROM ops_support_retry r WHERE r.receipt_id=ops_support_pending.receipt_id AND r.lease_token=? AND r.lease_until>?)":""),
    [patch.status,patch.responseStatus??null,patch.response===undefined?null:JSON.stringify(patch.response),id,...(fence?[fence.token,fence.now]:[])]);
  },
  async rememberGuest(b,e) {await sql.run('INSERT INTO ops_support_guest_evidence(business_id,token_hash,issued_at,expires_at,encrypted_secret) VALUES(?,?,?,?,?) ON CONFLICT(business_id,token_hash) DO NOTHING',[b,e.tokenHash,e.issuedAt,e.expiresAt,e.encryptedToken]);},
  async guest(b,h) {const row=await sql.get('SELECT * FROM ops_support_guest_evidence WHERE business_id=? AND token_hash=?',[b,h]);return row?{tokenHash:h,issuedAt:Number(row.issued_at),expiresAt:Number(row.expires_at),encryptedToken:row.encrypted_secret}:null;},
 };
}

/** Explicit lifecycle: construction/import starts no work; start is server-only and authority-gated. */
export function createSupportReplayPump(options:SupportGatewayOptions & {intervalMs?:number;batchSize?:number}) {
 const gateway=createSupportGateway(options);let timer:ReturnType<typeof setTimeout>|undefined;let stopped=true;let running:Promise<void>|undefined;
 const runOnce=()=>running??(running=(async()=>{
  const cfg=await options.getConfig();if(cfg.mode!=='central')return;
  const authority=await options.resolveAuthority?.(cfg.tenantSlug);
  if(!authority||authority.businessId!==cfg.tenantSlug||authority.expiresAt<=(options.now??Date.now)())return;
  const clock=options.now??Date.now;
  for(const intent of await options.store.pending(cfg.tenantSlug,Math.max(1,Math.min(options.batchSize??20,50)),clock())) {
   const attempt=await options.store.claimAttempt(intent.receiptId,clock(),35000);
   if(!attempt)continue;
   try{await gateway.replay(intent.receiptId,attempt.token);}
   finally{await options.store.finishAttempt(intent.receiptId,attempt.token,attempt.attempt,clock());}
  }
 })().finally(()=>{running=undefined;}));
 const stop=()=>{stopped=true;clearTimeout(timer);};
 return {runOnce,stop,start(){if(!stopped)return stop;stopped=false;
  const tick=async()=>{try{await runOnce();}catch{/* Retry only after rechecking authority; no local fallback. */}finally{if(!stopped){timer=setTimeout(tick,Math.max(1000,options.intervalMs??5000));timer.unref?.();}}};
  void tick();return stop;
 }};
}
