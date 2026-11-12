"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../vendor/ops-sdk/src/index.ts
var index_exports = {};
__export(index_exports, {
  OpsHubClient: () => OpsHubClient,
  SUPPORT_PENDING_SCHEMA: () => SUPPORT_PENDING_SCHEMA,
  canonicalSupportPayload: () => canonicalSupportPayload,
  createOpsHubClient: () => createOpsHubClient,
  createOpsMarketingFederationProxy: () => createOpsMarketingFederationProxy,
  createOpsSupportProxy: () => createOpsSupportProxy,
  createSqlSupportIntentStore: () => createSqlSupportIntentStore,
  createSupportGateway: () => createSupportGateway,
  createSupportReplayPump: () => createSupportReplayPump,
  decodeSupportUserHeader: () => decodeSupportUserHeader,
  encodeSupportUserHeader: () => encodeSupportUserHeader,
  signOpsWebhookPayload: () => signOpsWebhookPayload,
  supportPayloadHash: () => supportPayloadHash,
  verifyOpsWebhookSignature: () => verifyOpsWebhookSignature
});
module.exports = __toCommonJS(index_exports);

// ../vendor/ops-sdk/src/supportGateway.ts
var MAX_AGE = 7 * 24 * 60 * 60 * 1e3;
var MAX_BODY = 64 * 1024;
var keyPattern = /^[A-Za-z0-9:_-]{8,128}$/;
var idPattern = "[A-Za-z0-9_-]{1,128}";
function canonicalSupportPayload(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalSupportPayload).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalSupportPayload(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
async function supportPayloadHash(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalSupportPayload(value)));
  return Array.from(new Uint8Array(bytes), (x) => x.toString(16).padStart(2, "0")).join("");
}
var header = (req, name) => typeof req.headers?.[name] === "string" ? req.headers[name] : "";
var safeActor = (user) => ({
  id: String(user.id),
  role: "user",
  ...Object.fromEntries(["email", "name", "orgId", "planLabel", "contextSummary"].flatMap((k) => typeof user[k] === "string" ? [[k, user[k].slice(0, k === "contextSummary" ? 12e3 : 320)]] : []))
});
function route(method, raw) {
  if (!raw.startsWith("/") || raw.startsWith("//") || /[%\\#]|(?:^|\/)\.\.(?:\/|$)/.test(raw)) return null;
  const [path, query = ""] = raw.split("?");
  const params = new URLSearchParams(query);
  const keys = [...params.keys()];
  if (keys.length !== new Set(keys).size || keys.some((k) => !["status", "kind", "q", "limit"].includes(k)) || query.length > 1024) return null;
  const read = method === "GET" && ["/health", "/config", "/tickets", "/help/articles"].includes(path) || method === "GET" && new RegExp(`^/tickets/${idPattern}$`).test(path);
  const durable = method === "POST" && (["/tickets", "/leads"].includes(path) || new RegExp(`^/tickets/${idPattern}/messages$`).test(path));
  const transient = method === "POST" && ["/chat", "/coach", "/guest-session"].includes(path);
  const pending = method === "GET" && new RegExp(`^/pending/${idPattern}$`).test(path);
  if (!(read || durable || transient || pending) || method === "POST" && query) return null;
  return { path, durable, pending, operation: `${method}:${path}` };
}
function cleanBody(path, raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("Invalid body");
  const fields = path === "/leads" ? ["name", "email", "phone", "marketingOptIn", "source", "consentText"] : path === "/guest-session" ? ["name", "email"] : path === "/chat" ? ["message", "ticketId", "kind", "topic", "leadId"] : path === "/coach" ? ["kind", "messages"] : path.endsWith("/messages") ? ["body"] : ["kind", "topic", "subject", "body", "severity", "priority", "guestEmail", "leadId"];
  const payload = Object.fromEntries(fields.filter((k) => Object.hasOwn(raw, k)).map((k) => [k, raw[k]]));
  if (JSON.stringify(payload).length > MAX_BODY) throw Error("Body too large");
  return payload;
}
function createSupportGateway(options) {
  const now = options.now ?? Date.now;
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 8e3, 3e4));
  async function authority() {
    const cfg = await options.getConfig();
    if (cfg.mode !== "central" || !cfg.baseUrl || !cfg.secretKey) throw Error("Central configuration unavailable");
    const url = new URL(cfg.baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw Error("Invalid hub origin");
    const lease = await options.resolveAuthority?.(cfg.tenantSlug);
    if (!lease || lease.businessId !== cfg.tenantSlug || !lease.generation || lease.expiresAt <= now()) throw Error("Central authority unavailable");
    return { cfg, lease, origin: url.origin };
  }
  async function remote(auth, method, path, payload, actor, key, guestToken, intent) {
    const headers = { Accept: "application/json", "X-Ops-Key": auth.cfg.secretKey, "X-Ops-Tenant": auth.cfg.tenantSlug, "x-tenant-id": auth.cfg.tenantSlug };
    if (actor) headers["X-Support-User-Json"] = Buffer.from(JSON.stringify(safeActor(actor))).toString("base64url");
    if (key) headers["Idempotency-Key"] = key;
    if (guestToken) headers["x-support-guest-token"] = guestToken;
    if (intent) headers["x-support-accepted-intent"] = Buffer.from(JSON.stringify({ businessId: intent.businessId, generation: intent.generation, operation: intent.operation, key: intent.key, payloadHash: intent.payloadHash, acceptedAt: intent.acceptedAt, acceptedUntil: intent.acceptedUntil })).toString("base64url");
    if (payload !== void 0) headers["Content-Type"] = "application/json";
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchFn(auth.origin + "/api/v1/support" + path, { method, headers, body: payload === void 0 ? void 0 : JSON.stringify(payload), signal: controller.signal, redirect: "error" });
          const text = await response.text();
          if (text.length > 1024 * 1024) throw Error("Response too large");
          return { status: response.status, body: JSON.parse(text) };
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(Error("Support timeout"));
          }, timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function deliver(intent, auth) {
    const valid = intent.businessId === auth.lease.businessId && intent.generation === auth.lease.generation && intent.acceptedUntil > now() && (intent.actorType === "guest" || await options.customerActive?.(intent.businessId, intent.actor));
    if (!valid) {
      await options.store.update(intent.receiptId, { status: "failed" });
      return { ...intent, status: "failed" };
    }
    if (intent.status !== "pending") return intent;
    let result;
    try {
      const secret = intent.encryptedGuestToken ? await options.openSecret?.(intent.encryptedGuestToken) : void 0;
      if (intent.actorType === "guest" && !secret) throw Error("Guest secret unavailable");
      const [method, path] = intent.operation.split(":");
      result = await remote(auth, method, path, intent.payload, intent.actorType === "customer" ? intent.actor : null, intent.key, secret, intent);
    } catch {
      return intent;
    }
    if (result.status >= 500 || result.status === 429) return intent;
    const updated = { ...intent, status: result.status >= 200 && result.status < 300 ? "accepted" : "failed", responseStatus: result.status, response: result.body };
    await options.store.update(intent.receiptId, { status: updated.status, responseStatus: updated.responseStatus, response: updated.response });
    return await options.store.get(intent.receiptId) ?? updated;
  }
  const publicStatus = (intent) => ({ status: intent.status, receiptId: intent.receiptId, ...intent.status === "accepted" ? { result: intent.response } : {} });
  return {
    async replay(receiptId) {
      const auth = await authority();
      const intent = await options.store.get(receiptId);
      if (!intent) throw Error("Unknown receipt");
      return publicStatus(await deliver(intent, auth));
    },
    async handler(req, res) {
      const reply = (status, body) => {
        res.setHeader?.("Cache-Control", "no-store");
        return res.status(status).json(body);
      };
      try {
        const auth = await authority();
        const method = String(req.method || "GET").toUpperCase();
        const raw = String(req.url || "/");
        const matched = route(method, raw);
        if (!matched) return reply(400, { error: "Unsupported customer support operation" });
        const resolved = await options.resolveUser(req);
        const actor = resolved ? safeActor(resolved) : null;
        if (actor && !await options.customerActive?.(auth.cfg.tenantSlug, actor)) return reply(matched.pending ? 404 : 401, { error: "Account unavailable" });
        const guestToken = header(req, "x-support-guest-token");
        const tokenHash = guestToken ? await supportPayloadHash(guestToken) : "";
        if (matched.pending) {
          const intent = await options.store.get(matched.path.slice("/pending/".length));
          if (!intent || intent.businessId !== auth.cfg.tenantSlug || intent.generation !== auth.lease.generation || intent.acceptedUntil <= now() || (intent.actorType === "customer" ? !actor || actor.id !== intent.actor.id || actor.orgId !== intent.actor.orgId : actor || !tokenHash || intent.actor.id !== tokenHash)) return reply(404, { error: "Receipt not found" });
          if (intent.actorType === "guest") {
            const check = await remote(auth, "POST", "/guest-session/validate", {}, null, void 0, guestToken);
            if (check.status !== 200) return reply(404, { error: "Receipt not found" });
          }
          return reply(200, publicStatus(intent));
        }
        const payload = method === "POST" ? cleanBody(matched.path, req.body ?? {}) : void 0;
        if (matched.durable) {
          const key2 = header(req, "idempotency-key");
          if (!keyPattern.test(key2)) return reply(400, { error: "Valid Idempotency-Key required" });
          let guest = null;
          if (!actor) {
            guest = tokenHash ? await options.store.guest?.(auth.cfg.tenantSlug, tokenHash) ?? null : null;
            if (!guest) return reply(401, { error: "Guest session proof required", code: "guest_session_required" });
          }
          const acceptedAt = now();
          const identity = actor ?? { id: tokenHash, role: "user" };
          const scope = JSON.stringify([auth.cfg.tenantSlug, auth.lease.generation, actor ? "customer" : "guest", identity.id, identity.orgId ?? "", matched.operation, key2]);
          const payloadHash = await supportPayloadHash(payload);
          const candidate = { receiptId: crypto.randomUUID(), scope, businessId: auth.cfg.tenantSlug, generation: auth.lease.generation, actor: identity, actorType: actor ? "customer" : "guest", operation: matched.operation, key: key2, payload, payloadHash, acceptedAt, acceptedUntil: acceptedAt + MAX_AGE, status: "pending", ...guest ? { encryptedGuestToken: guest.encryptedToken } : {} };
          const existing = await options.store.find(scope);
          if (guest && guest.expiresAt <= now() && !existing) {
            return reply(401, { error: "Guest session expired", code: "guest_session_required" });
          }
          if (guest && (!options.openSecret || await options.openSecret(guest.encryptedToken) !== guestToken)) throw Error("Guest proof encryption unavailable");
          const retained = existing ?? await options.store.put(candidate);
          if (retained.payloadHash !== payloadHash) return reply(409, { error: "Idempotency key payload conflict" });
          let result2;
          try {
            result2 = await deliver(retained, auth);
          } catch {
            return reply(202, publicStatus(retained));
          }
          if (result2.status === "pending") return reply(202, publicStatus(result2));
          if (result2.responseStatus) return reply(result2.responseStatus, result2.response);
          return reply(409, { ...publicStatus(result2), error: "Accepted intent is no longer authorized" });
        }
        const key = header(req, "idempotency-key");
        const result = await remote(auth, method, raw, payload, actor, keyPattern.test(key) ? key : void 0, guestToken || void 0);
        if (matched.path === "/guest-session" && result.status === 201) {
          const token = result.body.guestSessionToken;
          const expiresAt = Date.parse(result.body.guestSessionExpiresAt);
          if (typeof token !== "string" || !Number.isFinite(expiresAt) || expiresAt <= now() || !options.sealSecret || !options.store.rememberGuest) throw Error("Guest proof storage unavailable");
          const encryptedToken = await options.sealSecret(token);
          if (!encryptedToken || encryptedToken === token) throw Error("Guest proof encryption unavailable");
          await options.store.rememberGuest(auth.cfg.tenantSlug, { tokenHash: await supportPayloadHash(token), issuedAt: now(), expiresAt, encryptedToken });
        }
        return reply(result.status, result.body);
      } catch {
        return reply(503, { error: "Support is temporarily unavailable. Submission could not be confirmed. Your draft is retained; retry with the same submission key.", retryable: true, code: "support_unavailable" });
      }
    }
  };
}
var SUPPORT_PENDING_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ops_support_pending (receipt_id TEXT PRIMARY KEY, business_id TEXT NOT NULL, scope TEXT NOT NULL UNIQUE, record_json TEXT NOT NULL, encrypted_secret TEXT, status TEXT NOT NULL, response_status INTEGER, response_json TEXT)`,
  `CREATE TABLE IF NOT EXISTS ops_support_guest_evidence (business_id TEXT NOT NULL, token_hash TEXT NOT NULL, issued_at BIGINT NOT NULL, expires_at BIGINT NOT NULL, encrypted_secret TEXT NOT NULL, PRIMARY KEY(business_id,token_hash))`
];
function createSqlSupportIntentStore(sql) {
  const decode = (row) => row ? { ...JSON.parse(row.record_json), ...row.encrypted_secret ? { encryptedGuestToken: row.encrypted_secret } : {}, status: row.status, ...row.response_status ? { responseStatus: row.response_status, response: JSON.parse(row.response_json) } : {} } : null;
  const find = async (scope) => decode(await sql.get("SELECT * FROM ops_support_pending WHERE scope=?", [scope]));
  return {
    find,
    async pending(businessId, limit) {
      const rows = await sql.all("SELECT * FROM ops_support_pending WHERE business_id=? AND status='pending' ORDER BY receipt_id LIMIT ?", [businessId, Math.max(1, Math.min(50, Math.floor(limit)))]);
      return rows.map(decode);
    },
    get: async (id) => decode(await sql.get("SELECT * FROM ops_support_pending WHERE receipt_id=?", [id])),
    async put(intent) {
      const { encryptedGuestToken, ...record } = intent;
      await sql.run("INSERT INTO ops_support_pending(receipt_id,business_id,scope,record_json,encrypted_secret,status) VALUES(?,?,?,?,?,?) ON CONFLICT(scope) DO NOTHING", [intent.receiptId, intent.businessId, intent.scope, JSON.stringify(record), encryptedGuestToken ?? null, "pending"]);
      const saved = await find(intent.scope);
      if (!saved) throw Error("Intent persistence failed");
      return saved;
    },
    async update(id, patch) {
      if (!["accepted", "failed"].includes(patch.status ?? "")) throw Error("Invalid intent transition");
      await sql.run("UPDATE ops_support_pending SET status=?,response_status=?,response_json=? WHERE receipt_id=? AND status='pending'", [patch.status, patch.responseStatus ?? null, patch.response === void 0 ? null : JSON.stringify(patch.response), id]);
    },
    async rememberGuest(b, e) {
      await sql.run("INSERT INTO ops_support_guest_evidence(business_id,token_hash,issued_at,expires_at,encrypted_secret) VALUES(?,?,?,?,?) ON CONFLICT(business_id,token_hash) DO NOTHING", [b, e.tokenHash, e.issuedAt, e.expiresAt, e.encryptedToken]);
    },
    async guest(b, h) {
      const row = await sql.get("SELECT * FROM ops_support_guest_evidence WHERE business_id=? AND token_hash=?", [b, h]);
      return row ? { tokenHash: h, issuedAt: Number(row.issued_at), expiresAt: Number(row.expires_at), encryptedToken: row.encrypted_secret } : null;
    }
  };
}
function createSupportReplayPump(options) {
  const gateway = createSupportGateway(options);
  let timer;
  let stopped = true;
  let running;
  const runOnce = () => running ?? (running = (async () => {
    const cfg = await options.getConfig();
    if (cfg.mode !== "central") return;
    const authority = await options.resolveAuthority?.(cfg.tenantSlug);
    if (!authority || authority.businessId !== cfg.tenantSlug || authority.expiresAt <= (options.now ?? Date.now)()) return;
    for (const intent of await options.store.pending(cfg.tenantSlug, Math.max(1, Math.min(options.batchSize ?? 20, 50)))) await gateway.replay(intent.receiptId);
  })().finally(() => {
    running = void 0;
  }));
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
  };
  return { runOnce, stop, start() {
    if (!stopped) return stop;
    stopped = false;
    const tick = async () => {
      try {
        await runOnce();
      } catch {
      } finally {
        if (!stopped) {
          timer = setTimeout(tick, Math.max(1e3, options.intervalMs ?? 5e3));
          timer.unref?.();
        }
      }
    };
    void tick();
    return stop;
  } };
}

// ../vendor/ops-sdk/src/index.ts
function encodeSupportUserHeader(user) {
  const json = JSON.stringify(user);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(json, "utf8").toString("base64url");
  }
  return btoa(encodeURIComponent(json));
}
function decodeSupportUserHeader(encoded) {
  try {
    if (typeof Buffer !== "undefined") {
      const raw = Buffer.from(encoded, "base64url").toString("utf8");
      return JSON.parse(raw);
    }
    return JSON.parse(decodeURIComponent(atob(encoded)));
  } catch {
    return null;
  }
}
var OpsHubClient = class {
  baseUrl;
  tenantSlug;
  secretKey;
  publicKey;
  fetchFn;
  pendingSupport = /* @__PURE__ */ new Map();
  constructor(config) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.tenantSlug = config.tenantSlug;
    this.secretKey = config.secretKey;
    this.publicKey = config.publicKey;
    this.fetchFn = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }
  getBaseUrl() {
    return this.baseUrl;
  }
  getTenantSlug() {
    return this.tenantSlug;
  }
  async request(path, init) {
    const key = init.authMode === "secret" ? this.secretKey : this.publicKey ?? this.secretKey;
    const tenant = init.tenantOverride || String(this.tenantSlug);
    const durable = init.method === "POST" && /^\/api\/v1\/support\/tickets(?:\/[^/]+\/messages)?$/.test(path);
    const scope = JSON.stringify([tenant, init.forwardedUser?.id, init.guestSessionToken, path]);
    const body = String(init.body ?? "");
    const previous = this.pendingSupport.get(scope);
    const intentKey = durable ? init.idempotencyKey ?? (previous?.body === body ? previous.key : globalThis.crypto.randomUUID()) : void 0;
    if (intentKey) this.pendingSupport.set(scope, { body, key: intentKey });
    const headers = {
      Accept: "application/json",
      ...intentKey ? { "Idempotency-Key": intentKey } : {},
      ...init.guestSessionToken ? { "x-support-guest-token": init.guestSessionToken } : {},
      "X-Ops-Tenant": tenant,
      "x-tenant-id": tenant,
      ...init.body ? { "Content-Type": "application/json" } : {},
      ...key ? { Authorization: `Bearer ${key}`, "X-Ops-Key": key } : {},
      ...init.forwardedUser ? { "X-Support-User-Json": encodeSupportUserHeader(init.forwardedUser) } : {},
      ...init.headers ?? {}
    };
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      ...init,
      headers
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || data.message || `OpsHub request failed (${res.status})`);
    }
    if (intentKey && this.pendingSupport.get(scope)?.key === intentKey) this.pendingSupport.delete(scope);
    return data;
  }
  // ==================== 1. GL BILLING & COGS INGESTION ====================
  async ingestBillingEvent(event) {
    return this.request("/api/v1/ingest/billing-event", {
      method: "POST",
      authMode: "secret",
      body: JSON.stringify({
        businessUnitId: this.tenantSlug,
        ...event
      })
    });
  }
  async ingestCogs(event) {
    return this.request("/api/v1/ingest/cogs", {
      method: "POST",
      authMode: "secret",
      body: JSON.stringify({
        businessUnitId: this.tenantSlug,
        ...event
      })
    });
  }
  // ==================== 2. LIFECYCLE CRM & HEARTBEAT ====================
  async syncContact(contact) {
    return this.request("/api/v1/ingest/contact", {
      method: "POST",
      authMode: "secret",
      body: JSON.stringify({
        tenantId: this.tenantSlug,
        ...contact
      })
    });
  }
  async sendHeartbeat(heartbeat = {}) {
    return this.request("/api/v1/ingest/heartbeat", {
      method: "POST",
      authMode: "secret",
      body: JSON.stringify({
        tenantId: this.tenantSlug,
        ...heartbeat
      })
    });
  }
  // ==================== 3. HEADLESS CMS & ANNOUNCEMENTS ====================
  async getAnnouncements(tenantSlug = this.tenantSlug) {
    return this.request(
      `/api/v1/public/cms/${encodeURIComponent(tenantSlug)}/announcements`,
      { method: "GET", authMode: "public", tenantOverride: tenantSlug }
    );
  }
  async getCmsContents(contentType, tenantSlug = this.tenantSlug) {
    const qs = contentType ? `?type=${encodeURIComponent(contentType)}` : "";
    return this.request(
      `/api/v1/public/cms/${encodeURIComponent(tenantSlug)}/contents${qs}`,
      { method: "GET", authMode: "public", tenantOverride: tenantSlug }
    );
  }
  async captureLead(input, tenantSlug = this.tenantSlug) {
    return this.request(
      `/api/v1/public/cms/${encodeURIComponent(tenantSlug)}/leads`,
      {
        method: "POST",
        authMode: "public",
        tenantOverride: tenantSlug,
        body: JSON.stringify(input)
      }
    );
  }
  // ==================== 4. UNIFIED SUPPORT-KIT METHODS ====================
  /**
   * Create a support ticket in the Central Ops Hub (runs AI triage + Knowledge Gap + Telegram Ops notification).
   */
  async createSupportTicket(input) {
    const forwardedUser = input.user ? {
      ...input.user,
      ...input.contextSummary ? { contextSummary: input.contextSummary } : {}
    } : void 0;
    return this.request("/api/v1/support/tickets", {
      method: "POST",
      authMode: this.secretKey ? "secret" : "public",
      forwardedUser,
      idempotencyKey: input.idempotencyKey,
      guestSessionToken: input.guestSessionToken,
      body: JSON.stringify({
        kind: input.kind ?? "support",
        topic: input.topic ?? "other",
        subject: input.subject,
        body: input.body,
        severity: input.severity,
        guestEmail: input.guestEmail ?? input.user?.email,
        contextSummary: input.contextSummary ?? input.user?.contextSummary
      })
    });
  }
  /**
   * Send a follow-up message on an existing support ticket in Ops Hub.
   */
  async sendSupportMessage(ticketId, input) {
    return this.request(`/api/v1/support/tickets/${encodeURIComponent(ticketId)}/messages`, {
      method: "POST",
      authMode: this.secretKey ? "secret" : "public",
      forwardedUser: input.user,
      idempotencyKey: input.idempotencyKey,
      guestSessionToken: input.guestSessionToken,
      body: JSON.stringify({
        body: input.body
      })
    });
  }
  /**
   * List support tickets for the authenticated user (or all tenant tickets if user.role === 'admin').
   */
  async listSupportTickets(opts) {
    const qsParams = new URLSearchParams();
    if (opts?.status) qsParams.set("status", opts.status);
    if (opts?.kind) qsParams.set("kind", opts.kind);
    const qs = qsParams.toString() ? `?${qsParams.toString()}` : "";
    const endpoint = `/api/v1/support/tickets${qs}`;
    return this.request(endpoint, {
      method: "GET",
      authMode: this.secretKey ? "secret" : "public",
      forwardedUser: opts?.user
    });
  }
  /**
   * Fetch public Help Center KB articles for a connected app tenant.
   */
  async getHelpArticles(tenantSlug = this.tenantSlug) {
    return this.request("/api/v1/support/help/articles", {
      method: "GET",
      authMode: "public",
      tenantOverride: tenantSlug
    });
  }
  /**
   * Push or sync app-local markdown documentation / KB articles into Ops Hub's central Support KB.
   */
  async syncKbArticles(articles, tenantSlug = this.tenantSlug) {
    return this.request("/api/v1/support/kb/sync", {
      method: "POST",
      authMode: "secret",
      tenantOverride: tenantSlug,
      body: JSON.stringify({
        tenantId: tenantSlug,
        articles
      })
    });
  }
  /**
   * Bulk import / upsert support tickets, messages, AI triage proposals, knowledge gaps, and leads
   * from a connected app's database into Ops Hub's central support tables.
   */
  async importSupportSnapshot(payload) {
    const tenantSlug = payload.tenantId || this.tenantSlug;
    return this.request("/api/v1/support/import", {
      method: "POST",
      authMode: "secret",
      tenantOverride: String(tenantSlug),
      body: JSON.stringify({
        ...payload,
        tenantId: tenantSlug
      })
    });
  }
  /**
   * Helper returning props/URLs for embedding or mounting `<SupportLauncher />` / `<SupportOpsConsole />`.
   */
  getSupportWidgetProps(opts) {
    return {
      apiBase: opts?.localApiBase || `${this.baseUrl}/api/v1/support`,
      tenantSlug: this.tenantSlug,
      publicKey: this.publicKey,
      embedUrl: `${this.baseUrl}/api/v1/support/embed?tenant=${encodeURIComponent(String(this.tenantSlug))}`
    };
  }
};
function createOpsHubClient(config) {
  return new OpsHubClient(config);
}
function createOpsSupportProxy(options) {
  const fetchFn = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  return async function opsSupportProxyMiddleware(req, res, next) {
    let cfg = null;
    try {
      cfg = await options.getConfig();
    } catch {
      return res.status(503).json({ error: "Support configuration unavailable", retryable: true });
    }
    if (cfg.mode === "central") {
      if (!options.central || !options.resolveUser) return res.status(503).json({ error: "Central support authority unavailable", retryable: true });
      return createSupportGateway({ ...options.central, getConfig: () => cfg, resolveUser: options.resolveUser, fetchImpl: options.fetchImpl }).handler(req, res);
    }
    const baseUrl = cfg?.baseUrl?.trim().replace(/\/$/, "");
    const secretKey = cfg?.secretKey?.trim();
    const tenantSlug = cfg?.tenantSlug || "legalai";
    const mode = cfg?.mode || "mirror";
    if (!baseUrl || !secretKey || mode === "local") {
      return options.localHandler(req, res, next);
    }
    const pathAndQuery = String(req.url || req.path || "/");
    const method = String(req.method || "GET").toUpperCase();
    if (mode === "proxy") {
      try {
        const user = options.resolveUser ? await options.resolveUser(req) : null;
        const targetUrl = `${baseUrl}/api/v1/support${pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`}`;
        const headers = {
          Accept: "application/json",
          Authorization: `Bearer ${secretKey}`,
          "X-Ops-Key": secretKey,
          "X-Ops-Tenant": String(tenantSlug),
          "x-tenant-id": String(tenantSlug),
          ...user ? { "X-Support-User-Json": encodeSupportUserHeader(user) } : {},
          ...typeof req.headers?.["idempotency-key"] === "string" ? { "Idempotency-Key": req.headers["idempotency-key"] } : {},
          ...typeof req.headers?.["x-support-guest-token"] === "string" ? { "x-support-guest-token": req.headers["x-support-guest-token"] } : {}
        };
        let bodyPayload;
        if (method !== "GET" && method !== "HEAD" && req.body !== void 0) {
          headers["Content-Type"] = "application/json";
          bodyPayload = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        }
        const upstream = await fetchFn(targetUrl, {
          method,
          headers,
          body: bodyPayload
        });
        const contentType = upstream.headers.get("content-type") || "application/json";
        const text = await upstream.text();
        res.status(upstream.status).setHeader("Content-Type", contentType).send(text);
        return;
      } catch {
        return options.localHandler(req, res, next);
      }
    }
    if (method === "POST" || method === "PATCH") {
      res?.on?.("finish", () => {
        if (options.onMirrorSync) {
          void Promise.resolve(options.onMirrorSync()).catch(() => {
          });
          return;
        }
        if (method === "POST" && (pathAndQuery.startsWith("/tickets") || pathAndQuery.startsWith("/leads") || pathAndQuery.startsWith("/chat"))) {
          void (async () => {
            try {
              const user = options.resolveUser ? await options.resolveUser(req) : null;
              const targetUrl = `${baseUrl}/api/v1/support${pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`}`;
              await fetchFn(targetUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${secretKey}`,
                  "X-Ops-Key": secretKey,
                  "X-Ops-Tenant": String(tenantSlug),
                  "x-tenant-id": String(tenantSlug),
                  ...user ? { "X-Support-User-Json": encodeSupportUserHeader(user) } : {}
                },
                body: typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {})
              });
            } catch {
            }
          })();
        }
      });
    }
    return options.localHandler(req, res, next);
  };
}
async function signOpsWebhookPayload(rawBody, signingSecret, timestampSec = Math.floor(Date.now() / 1e3)) {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    enc.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${timestampSec}.${rawBody}`)
  );
  const hex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestampSec},v1=${hex}`;
}
async function verifyOpsWebhookSignature(rawBody, signatureHeader, signingSecret, toleranceSec = 300) {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((kv) => {
      const [k, v] = kv.trim().split("=");
      return [k, v];
    })
  );
  const ts = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(ts) || !v1) return false;
  const nowSec = Math.floor(Date.now() / 1e3);
  if (Math.abs(nowSec - ts) > toleranceSec) return false;
  const expected = await signOpsWebhookPayload(rawBody, signingSecret, ts);
  return expected === `t=${ts},v1=${v1}`;
}
function createOpsMarketingFederationProxy(options) {
  const fetchFn = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 12e4;
  return async function opsMarketingFederation(req, res, next) {
    const rawUrl = String(req.url || "/");
    const match = rawUrl.match(/^\/t\/([a-z0-9_-]+)(\/[^?]*)?(\?.*)?$/i);
    if (!match || match[1].toLowerCase() === "all") return options.localHandler(req, res, next);
    const tenantId = match[1].toLowerCase();
    let remote = null;
    try {
      remote = await options.resolveRemote(tenantId);
    } catch {
      remote = null;
    }
    if (!remote?.baseUrl || !remote.key) return options.localHandler(req, res, next);
    const method = String(req.method || "GET").toUpperCase();
    const target = `${remote.baseUrl.replace(/\/$/, "")}${match[2] || "/"}${match[3] || ""}`;
    const actorEmail = options.resolveActorEmail ? await options.resolveActorEmail(req) : null;
    const headers = {
      Accept: String(req.headers?.accept || "application/json"),
      "X-Ops-Key": remote.key,
      "X-Ops-Tenant": tenantId,
      ...actorEmail ? { "X-Marketing-Actor-Email": String(actorEmail) } : {}
    };
    let body;
    if (method !== "GET" && method !== "HEAD") {
      headers["Content-Type"] = "application/json";
      body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const upstream = await fetchFn(target, { method, headers, body, signal: controller.signal });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(buf);
    } catch (err) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: `Marketing app for ${tenantId} is unreachable (${String(err?.message || err).slice(0, 120)})` }));
    } finally {
      clearTimeout(timer);
    }
  };
}
