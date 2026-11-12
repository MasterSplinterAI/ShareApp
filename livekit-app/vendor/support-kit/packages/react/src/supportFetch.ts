import {PendingIntents} from './pendingIntent.js';
function normalizeApiBase(v:string){return v.replace(/\/$/,'');}
function leadStorageKey(v:string){return `support-kit:leadId:${normalizeApiBase(v)}`;}
export async function supportFetch<T>(
  apiBase: string,
  path: string,
  init?: RequestInit,
  getAccessToken?: () => string | null | undefined,
  pending?: PendingIntents,
  actorScope?: string,
): Promise<T> {
  const url = `${normalizeApiBase(apiBase)}${path.startsWith("/") ? path : `/${path}`}`;
  const token = getAccessToken?.()?.trim() || null;
  let guestToken: string | undefined;
  let expiredGuestToken: string | undefined;
  try {
    const session = JSON.parse(sessionStorage.getItem(`${leadStorageKey(apiBase)}:proof`) || 'null');
    if (session && Date.parse(session.expiresAt) > Date.now()) guestToken = session.token;
    else if(session?.token)expiredGuestToken=session.token;
  } catch { /* storage unavailable */ }
  const { headers: initHeaders, ...rest } = init ?? {};
  const intentScope=JSON.stringify([apiBase,actorScope || token || guestToken || expiredGuestToken,path,rest.method,initHeaders]);
  if(!guestToken && expiredGuestToken && (pending?.has(intentScope,String(rest.body??'')) || (path.startsWith('/pending/') && pending?.ownsReceipt(path.slice('/pending/'.length)))))guestToken=expiredGuestToken;
  const intentKey=rest.method && !['GET','HEAD'].includes(rest.method.toUpperCase()) && path!=='/coach' && path!=='/guest-session' ? pending?.key(intentScope,String(rest.body??'')) : undefined;
  const res = await fetch(url, {
    credentials: "include",
    ...rest,
    headers: {
      Accept: "application/json",
      ...(intentKey ? {"Idempotency-Key":intentKey} : {}),
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(guestToken ? { "x-support-guest-token": guestToken } : {}),
      ...(initHeaders as Record<string, string> | undefined),
    },
  });
  const data = (await res.json()) as T & { error?: string };
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

