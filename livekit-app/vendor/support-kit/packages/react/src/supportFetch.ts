import {PendingIntents} from './pendingIntent.js';
function normalizeApiBase(v:string){return v.replace(/\/$/,'');}
function leadStorageKey(v:string){return `support-kit:leadId:${normalizeApiBase(v)}`;}
function requestScope(apiBase:string,path:string,init:RequestInit|undefined,token:string|null,actorScope?:string) {
  return JSON.stringify([normalizeApiBase(apiBase),actorScope||token||null,path,init?.method,init?.headers]);
}
export function hasRetainedSupportIntent(apiBase:string,path:string,init:RequestInit,pending:PendingIntents,getAccessToken?:()=>string|null|undefined,actorScope?:string) {
  return pending.has(requestScope(apiBase,path,init,getAccessToken?.()?.trim()||null,actorScope),String(init.body??''));
}
export async function supportFetch<T>(
  apiBase: string,
  path: string,
  init?: RequestInit,
  getAccessToken?: () => string | null | undefined,
  pending?: PendingIntents,
  actorScope?: string,
  guestOnly = false,
): Promise<T> {
  const url = `${normalizeApiBase(apiBase)}${path.startsWith("/") ? path : `/${path}`}`;
  if(guestOnly)actorScope=undefined;
  const token = guestOnly?null:getAccessToken?.()?.trim() || null;
  const requiresCustomer=Boolean(actorScope||token);
  let guestToken: string | undefined;
  try {
    const session = JSON.parse(sessionStorage.getItem(`${leadStorageKey(apiBase)}:proof`) || 'null');
    if (session && Date.parse(session.expiresAt) > Date.now()) guestToken = session.token;
  } catch { /* storage unavailable */ }
  const { headers: initHeaders, ...rest } = init ?? {};
  const extraHeaders=Object.fromEntries(new Headers(initHeaders));
  if(requiresCustomer)delete extraHeaders['x-support-guest-token'];
  if(guestOnly){delete extraHeaders.authorization;delete extraHeaders['x-support-require-customer'];}
  const intentScope=requestScope(apiBase,path,init,token,actorScope);
  const body=String(rest.body??'');
  const retained=pending?.retained(intentScope,body);
  if(retained)guestToken=retained.guestToken;
  else if(path.startsWith('/pending/'))guestToken=pending?.receiptProof(path.slice('/pending/'.length));
  if(requiresCustomer)guestToken=undefined;
  const intentKey=rest.method && !['GET','HEAD'].includes(rest.method.toUpperCase()) && path!=='/coach' && path!=='/guest-session' ? pending?.key(intentScope,body,guestToken) : undefined;
  const res = await fetch(url, {
    ...rest,
    credentials: guestOnly?"omit":rest.credentials??"include",
    headers: {
      Accept: "application/json",
      ...(intentKey ? {"Idempotency-Key":intentKey} : {}),
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(guestToken ? { "x-support-guest-token": guestToken } : {}),
      ...extraHeaders,
      ...(requiresCustomer ? {"x-support-require-customer":"1"} : {}),
    },
  });
  const data = (await res.json()) as T & { error?: string };
  if(rest.signal?.aborted)throw new DOMException("Support client scope changed","AbortError");
  if (!res.ok) {
    const message =
      typeof data === "object" && data && "error" in data && data.error
        ? String(data.error)
        : `Request failed (${res.status})`;
    throw Object.assign(new Error(message), {code:(data as {code?:string}).code});
  }
  if(intentKey) pending?.settle(intentScope,intentKey,res.status,data);
  return data;
}

