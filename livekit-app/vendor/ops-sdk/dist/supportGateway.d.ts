import type { SupportForwardedUser } from './index.js';
export type SupportMode = 'local' | 'mirror' | 'proxy' | 'central';
export interface SupportGatewayConfig {
    mode?: SupportMode;
    baseUrl?: string | null;
    secretKey?: string | null;
    tenantSlug: string;
}
/** Supplied by trusted server registry/lease validation. A browser setting is not authority. */
export interface SupportAuthority {
    businessId: string;
    generation: string;
    expiresAt: number;
}
export interface GuestEvidence {
    tokenHash: string;
    issuedAt: number;
    expiresAt: number;
    encryptedToken: string;
}
export interface SupportIntent {
    receiptId: string;
    scope: string;
    businessId: string;
    generation: string;
    actor: SupportForwardedUser;
    actorType: 'customer' | 'guest';
    operation: string;
    key: string;
    payload: Record<string, unknown>;
    payloadHash: string;
    acceptedAt: number;
    acceptedUntil: number;
    encryptedGuestToken?: string;
    status: 'pending' | 'accepted' | 'failed';
    responseStatus?: number;
    response?: unknown;
}
/** put must atomically insert by scope or return the existing row (never overwrite it). */
export interface SupportIntentStore {
    put(intent: SupportIntent): Promise<SupportIntent>;
    get(receiptId: string): Promise<SupportIntent | null>;
    find(scope: string): Promise<SupportIntent | null>;
    pending(businessId: string, limit: number): Promise<SupportIntent[]>;
    update(receiptId: string, patch: Partial<SupportIntent>): Promise<void>;
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
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => number;
}
export declare function canonicalSupportPayload(value: unknown): string;
export declare function supportPayloadHash(value: unknown): Promise<string>;
/** Customer-only resilient gateway. No timers, workers or authority start on import. */
export declare function createSupportGateway(options: SupportGatewayOptions): {
    replay(receiptId: string): Promise<{
        result?: unknown;
        status: "pending" | "accepted" | "failed";
        receiptId: string;
    }>;
    handler(req: any, res: any): Promise<any>;
};
export interface SupportSql {
    run(sql: string, params?: unknown[]): Promise<unknown>;
    get(sql: string, params?: unknown[]): Promise<any>;
    all(sql: string, params?: unknown[]): Promise<any[]>;
}
export declare const SUPPORT_PENDING_SCHEMA: string[];
/** Each transition is one atomic SQL statement; no shared SQLite transaction can capture other work. */
export declare function createSqlSupportIntentStore(sql: SupportSql): SupportIntentStore;
/** Explicit lifecycle: construction/import starts no work; start is server-only and authority-gated. */
export declare function createSupportReplayPump(options: SupportGatewayOptions & {
    intervalMs?: number;
    batchSize?: number;
}): {
    runOnce: () => Promise<void>;
    stop: () => void;
    start(): () => void;
};
