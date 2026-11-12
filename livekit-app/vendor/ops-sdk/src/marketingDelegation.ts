import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const MARKETING_ACTIONS = ['marketing.read', 'marketing.edit', 'marketing.publish', 'marketing.send'] as const;
export type MarketingAction = (typeof MARKETING_ACTIONS)[number];

export interface MarketingOperator {
  id: string;
  revision: number;
  email?: string;
}

export interface MarketingDelegationRequest {
  businessId: string;
  audience: string;
  action: MarketingAction;
  resource: string;
  method: string;
  path: string;
  body?: unknown;
}

interface MarketingDelegation {
  version: 1;
  actor: MarketingOperator;
  businessId: string;
  audience: string;
  action: MarketingAction;
  resource: string;
  requestHash: string;
  expiresAt: number;
  nonce: string;
}

const lifetimeMs = 30_000;

function requestHash(request: MarketingDelegationRequest): string {
  return createHash('sha256').update(JSON.stringify([
    request.method.toUpperCase(), request.path, request.body ?? {},
  ])).digest('hex');
}

function signature(secret: string, payload: string): Buffer {
  return createHmac('sha256', secret).update('opshub-marketing-v1.').update(payload).digest();
}

export function verifyMarketingCredential(expected: string | undefined, received: unknown): boolean {
  if (!expected || typeof received !== 'string' || received.length > 512) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(expected), digest(received));
}

export function signMarketingDelegation(request: MarketingDelegationRequest, actor: MarketingOperator, secret: string): string {
  if (secret.length < 32) throw new Error('Marketing delegation requires a signing secret of at least 32 characters');
  const payload: MarketingDelegation = {
    version: 1,
    actor,
    businessId: request.businessId,
    audience: request.audience,
    action: request.action,
    resource: request.resource,
    requestHash: requestHash(request),
    expiresAt: Date.now() + lifetimeMs,
    nonce: randomUUID(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${signature(secret, encoded).toString('base64url')}`;
}

/** Verify before atomically claiming the nonce in the receiving host's database. */
export function verifyMarketingDelegation(token: unknown, request: MarketingDelegationRequest, secret: string | undefined): MarketingDelegation | null {
  if (!secret || secret.length < 32 || typeof token !== 'string' || token.length > 4096) return null;
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;
  const [, encoded, proof] = match;
  const signed = Buffer.from(proof, 'base64url');
  if (signed.length !== 32 || !timingSafeEqual(signed, signature(secret, encoded))) return null;
  try {
    const claim = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as MarketingDelegation;
    const now = Date.now();
    if (claim.version !== 1 || claim.businessId !== request.businessId || claim.audience !== request.audience ||
        claim.action !== request.action || claim.resource !== request.resource || claim.requestHash !== requestHash(request) ||
        !MARKETING_ACTIONS.includes(claim.action) || !Number.isSafeInteger(claim.expiresAt) ||
        claim.expiresAt <= now || claim.expiresAt > now + lifetimeMs + 5_000 ||
        !/^[a-f0-9-]{36}$/.test(claim.nonce) || typeof claim.actor?.id !== 'string' || !claim.actor.id ||
        !Number.isSafeInteger(claim.actor.revision) || claim.actor.revision < 0 ||
        (claim.actor.email !== undefined && typeof claim.actor.email !== 'string')) return null;
    return claim;
  } catch {
    return null;
  }
}
