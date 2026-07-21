// src/index.ts
import { KIT_VERSION as KIT_VERSION2, PACKAGE_NAME as SHARED } from "@rhule/support-shared";

// src/http/createRouter.ts
import {
  DEFAULT_TOPICS as DEFAULT_TOPICS2,
  KIT_VERSION,
  TicketKindSchema,
  TicketStatusSchema
} from "@rhule/support-shared";

// src/db/schema.ts
function buildSchemaStatements(tablePrefix) {
  const p = tablePrefix;
  return [
    `
    CREATE TABLE IF NOT EXISTS ${p}tickets (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      public_number INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'support',
      topic TEXT NOT NULL DEFAULT 'other',
      category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      subject TEXT,
      severity TEXT,
      priority TEXT,
      user_id TEXT,
      org_id TEXT,
      guest_email TEXT,
      context_json TEXT,
      duplicate_of_ticket_id TEXT,
      assigned_to TEXT,
      github_issue_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT,
      UNIQUE (tenant_id, public_number)
    )
    `,
    `CREATE INDEX IF NOT EXISTS idx_${p}tickets_tenant_status ON ${p}tickets(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_${p}tickets_tenant_kind ON ${p}tickets(tenant_id, kind)`,
    `CREATE INDEX IF NOT EXISTS idx_${p}tickets_tenant_user ON ${p}tickets(tenant_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_${p}tickets_tenant_created ON ${p}tickets(tenant_id, created_at)`,
    `
    CREATE TABLE IF NOT EXISTS ${p}messages (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      author_type TEXT NOT NULL,
      author_id TEXT,
      body TEXT NOT NULL,
      attachments_json TEXT,
      citation_json TEXT,
      created_at TEXT NOT NULL
    )
    `,
    `CREATE INDEX IF NOT EXISTS idx_${p}messages_ticket ON ${p}messages(tenant_id, ticket_id)`,
    `
    CREATE TABLE IF NOT EXISTS ${p}proposals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      proposal_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_review',
      summary TEXT NOT NULL,
      body_json TEXT NOT NULL,
      confidence REAL,
      telegram_message_id TEXT,
      telegram_chat_id TEXT,
      claimed_by TEXT,
      claimed_at TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      execution_status TEXT,
      execution_ref TEXT,
      created_at TEXT NOT NULL
    )
    `,
    `CREATE INDEX IF NOT EXISTS idx_${p}proposals_ticket ON ${p}proposals(tenant_id, ticket_id)`,
    `CREATE INDEX IF NOT EXISTS idx_${p}proposals_status ON ${p}proposals(tenant_id, status)`,
    `
    CREATE TABLE IF NOT EXISTS ${p}telegram_draft_sessions (
      telegram_user_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      public_number INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS ${p}knowledge_gaps (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      public_number INTEGER,
      user_question TEXT NOT NULL,
      escalation_reason TEXT,
      doc_query TEXT,
      doc_hits_json TEXT,
      proposal_id TEXT,
      proposal_type TEXT,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      resolved_at TEXT
    )
    `,
    `CREATE INDEX IF NOT EXISTS idx_${p}gaps_status ON ${p}knowledge_gaps(tenant_id, status)`,
    `
    CREATE TABLE IF NOT EXISTS ${p}kb_articles (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      source_kind TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'agent',
      provenance_json TEXT,
      source_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, source_kind, source_key)
    )
    `,
    `CREATE INDEX IF NOT EXISTS idx_${p}kb_status ON ${p}kb_articles(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_${p}kb_visibility ON ${p}kb_articles(tenant_id, visibility)`
  ];
}
function buildAlterStatements(tablePrefix) {
  const p = tablePrefix;
  return [
    {
      table: `${p}tickets`,
      column: "kind",
      ddl: `ALTER TABLE ${p}tickets ADD COLUMN kind TEXT NOT NULL DEFAULT 'support'`
    },
    {
      table: `${p}tickets`,
      column: "topic",
      ddl: `ALTER TABLE ${p}tickets ADD COLUMN topic TEXT NOT NULL DEFAULT 'other'`
    },
    {
      table: `${p}messages`,
      column: "citation_json",
      ddl: `ALTER TABLE ${p}messages ADD COLUMN citation_json TEXT`
    },
    {
      table: `${p}kb_articles`,
      column: "visibility",
      ddl: `ALTER TABLE ${p}kb_articles ADD COLUMN visibility TEXT NOT NULL DEFAULT 'agent'`
    },
    {
      table: `${p}proposals`,
      column: "telegram_chat_id",
      ddl: `ALTER TABLE ${p}proposals ADD COLUMN telegram_chat_id TEXT`
    },
    {
      table: `${p}proposals`,
      column: "claimed_by",
      ddl: `ALTER TABLE ${p}proposals ADD COLUMN claimed_by TEXT`
    },
    {
      table: `${p}proposals`,
      column: "claimed_at",
      ddl: `ALTER TABLE ${p}proposals ADD COLUMN claimed_at TEXT`
    }
  ];
}

// src/db/migrate.ts
var DEFAULT_TABLE_PREFIX = "support_";
async function columnExists(db, table, column) {
  try {
    const rows = await db.all(
      `SELECT column_name AS name FROM information_schema.columns
       WHERE table_name = ? AND column_name = ?`,
      [table, column]
    );
    if (rows.length > 0) return true;
  } catch {
  }
  try {
    const rows = await db.all(`PRAGMA table_info(${table})`);
    if (rows.length > 0) {
      return rows.some((r) => r.name === column);
    }
  } catch {
  }
  try {
    await db.get(`SELECT ${column} FROM ${table} LIMIT 0`);
    return true;
  } catch {
    return false;
  }
}
async function runQuiet(db, sql) {
  try {
    await db.run(sql.trim());
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/no such|SQLITE_ERROR|Cannot read|null/i.test(message)) {
      console.warn(`[support-kit] ensureSchema statement failed: ${message}`);
    }
    return false;
  }
}
async function ensureSchema(db, tablePrefix = DEFAULT_TABLE_PREFIX) {
  if (!/^[a-z][a-z0-9_]*$/.test(tablePrefix)) {
    throw new Error(`ensureSchema: invalid tablePrefix "${tablePrefix}"`);
  }
  const statements = buildSchemaStatements(tablePrefix);
  const creates = statements.filter((s) => /^\s*CREATE\s+TABLE/i.test(s));
  const indexes = statements.filter((s) => /^\s*CREATE\s+INDEX/i.test(s));
  let applied = 0;
  for (const sql of creates) {
    if (await runQuiet(db, sql)) applied += 1;
  }
  for (const alter of buildAlterStatements(tablePrefix)) {
    const exists = await columnExists(db, alter.table, alter.column);
    if (!exists) {
      if (await runQuiet(db, alter.ddl)) applied += 1;
    }
  }
  for (const sql of indexes) {
    if (await runQuiet(db, sql)) applied += 1;
  }
  try {
    await db.run(`
      UPDATE ${tablePrefix}tickets SET
        kind = CASE category
          WHEN 'bug' THEN 'bug'
          WHEN 'feature' THEN 'feature'
          ELSE 'support'
        END,
        topic = CASE category
          WHEN 'billing' THEN 'billing'
          WHEN 'how_to' THEN 'how_to'
          WHEN 'feature' THEN 'product'
          WHEN 'bug' THEN 'other'
          ELSE COALESCE(NULLIF(topic, ''), 'other')
        END
      WHERE kind IS NULL OR kind = '' OR topic IS NULL OR topic = ''
    `);
    await db.run(`
      UPDATE ${tablePrefix}tickets SET kind = 'support', topic = 'billing'
      WHERE category = 'billing'
    `);
    await db.run(`
      UPDATE ${tablePrefix}tickets SET kind = 'support', topic = 'how_to'
      WHERE category = 'how_to'
    `);
    await db.run(`
      UPDATE ${tablePrefix}tickets SET kind = 'bug', topic = COALESCE(NULLIF(topic, ''), 'other')
      WHERE category = 'bug'
    `);
    await db.run(`
      UPDATE ${tablePrefix}tickets SET kind = 'feature', topic = COALESCE(NULLIF(topic, ''), 'product')
      WHERE category = 'feature'
    `);
    await db.run(`
      UPDATE ${tablePrefix}tickets SET status = 'waiting_user'
      WHERE status = 'pending_user'
    `);
  } catch {
  }
  return { tablePrefix, statements: applied };
}

// src/tickets/service.ts
import {
  CreateTicketInputSchema,
  normalizeCreateTicketInput
} from "@rhule/support-shared";

// src/tickets/store.ts
import { randomUUID } from "crypto";
import {
  mapKindTopicToCategory,
  normalizeAuthorType,
  normalizeTicketStatus
} from "@rhule/support-shared";
function mapTicket(row) {
  const kind = row.kind ?? "support";
  const topic = row.topic ?? "other";
  const category = row.category ?? mapKindTopicToCategory(kind, topic);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    publicNumber: row.public_number,
    kind,
    topic,
    category,
    status: normalizeTicketStatus(row.status),
    subject: row.subject,
    severity: row.severity,
    priority: row.priority,
    userId: row.user_id,
    orgId: row.org_id,
    guestEmail: row.guest_email,
    contextJson: row.context_json,
    duplicateOfTicketId: row.duplicate_of_ticket_id,
    assignedTo: row.assigned_to,
    githubIssueUrl: row.github_issue_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at
  };
}
function mapMessage(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ticketId: row.ticket_id,
    authorType: row.author_type,
    authorId: row.author_id,
    body: row.body,
    attachmentsJson: row.attachments_json,
    citationJson: row.citation_json,
    createdAt: row.created_at
  };
}
var TicketStore = class {
  constructor(db, tablePrefix = DEFAULT_TABLE_PREFIX) {
    this.db = db;
    this.tablePrefix = tablePrefix;
  }
  db;
  tablePrefix;
  get t() {
    return `${this.tablePrefix}tickets`;
  }
  get m() {
    return `${this.tablePrefix}messages`;
  }
  async nextPublicNumber(tenantId) {
    const row = await this.db.get(
      `SELECT MAX(public_number) AS max FROM ${this.t} WHERE tenant_id = ?`,
      [tenantId]
    );
    return (row?.max ?? 0) + 1;
  }
  async create(input) {
    const tenantId = String(input.tenantId);
    const id = randomUUID();
    const messageId = randomUUID();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const publicNumber = await this.nextPublicNumber(tenantId);
    const kind = input.kind ?? "support";
    const topic = input.topic ?? "other";
    const category = input.category ?? mapKindTopicToCategory(kind, topic);
    const status = input.status ?? "open";
    await this.db.run(
      `INSERT INTO ${this.t} (
        id, tenant_id, public_number, kind, topic, category, status, subject, severity, priority,
        user_id, org_id, guest_email, context_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        tenantId,
        publicNumber,
        kind,
        topic,
        category,
        status,
        input.subject ?? null,
        input.severity ?? null,
        input.priority ?? null,
        input.userId ?? null,
        input.orgId ?? null,
        input.guestEmail ?? null,
        input.contextJson ?? null,
        now,
        now
      ]
    );
    await this.db.run(
      `INSERT INTO ${this.m} (
        id, tenant_id, ticket_id, author_type, author_id, body, created_at
      ) VALUES (?, ?, ?, 'user', ?, ?, ?)`,
      [messageId, tenantId, id, input.userId ?? null, input.body, now]
    );
    const ticket = await this.getById(tenantId, id);
    const message = await this.getMessage(tenantId, messageId);
    if (!ticket || !message) {
      throw new Error("TicketStore.create: failed to reload row");
    }
    return { ticket, message };
  }
  async getById(tenantId, id) {
    const row = await this.db.get(
      `SELECT * FROM ${this.t} WHERE tenant_id = ? AND id = ?`,
      [tenantId, id]
    );
    return row ? mapTicket(row) : void 0;
  }
  async getByPublicNumber(tenantId, publicNumber) {
    const row = await this.db.get(
      `SELECT * FROM ${this.t} WHERE tenant_id = ? AND public_number = ?`,
      [tenantId, publicNumber]
    );
    return row ? mapTicket(row) : void 0;
  }
  async listByTenant(tenantId, opts) {
    const limit = opts?.limit ?? 50;
    const clauses = ["tenant_id = ?"];
    const params = [tenantId];
    if (opts?.kind) {
      clauses.push("kind = ?");
      params.push(opts.kind);
    }
    if (opts?.topic) {
      clauses.push("topic = ?");
      params.push(opts.topic);
    }
    if (opts?.status) {
      clauses.push("status = ?");
      params.push(opts.status);
    }
    if (opts?.userId) {
      clauses.push("user_id = ?");
      params.push(opts.userId);
    }
    params.push(limit);
    const rows = await this.db.all(
      `SELECT * FROM ${this.t} WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
      params
    );
    return rows.map(mapTicket);
  }
  async listMessages(tenantId, ticketId) {
    const rows = await this.db.all(
      `SELECT * FROM ${this.m} WHERE tenant_id = ? AND ticket_id = ? ORDER BY created_at ASC`,
      [tenantId, ticketId]
    );
    return rows.map(mapMessage);
  }
  async getMessage(tenantId, messageId) {
    const row = await this.db.get(
      `SELECT * FROM ${this.m} WHERE tenant_id = ? AND id = ?`,
      [tenantId, messageId]
    );
    return row ? mapMessage(row) : void 0;
  }
  async updateStatus(tenantId, ticketId, status) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const normalized = normalizeTicketStatus(status);
    const closedAt = normalized === "closed" || normalized === "resolved" ? now : null;
    await this.db.run(
      `UPDATE ${this.t}
       SET status = ?, updated_at = ?, closed_at = COALESCE(?, closed_at)
       WHERE tenant_id = ? AND id = ?`,
      [normalized, now, closedAt, tenantId, ticketId]
    );
    return this.getById(tenantId, ticketId);
  }
  async updateGithubUrl(tenantId, ticketId, githubIssueUrl) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await this.db.run(
      `UPDATE ${this.t} SET github_issue_url = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`,
      [githubIssueUrl, now, tenantId, ticketId]
    );
    return this.getById(tenantId, ticketId);
  }
  async updateAssignedTo(tenantId, ticketId, assignedTo) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await this.db.run(
      `UPDATE ${this.t} SET assigned_to = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`,
      [assignedTo, now, tenantId, ticketId]
    );
    return this.getById(tenantId, ticketId);
  }
  async addMessage(input) {
    const id = randomUUID();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const authorType = normalizeAuthorType(input.authorType);
    await this.db.run(
      `INSERT INTO ${this.m} (
        id, tenant_id, ticket_id, author_type, author_id, body, citation_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.tenantId,
        input.ticketId,
        authorType,
        input.authorId ?? null,
        input.body,
        input.citationJson ?? null,
        now
      ]
    );
    await this.db.run(
      `UPDATE ${this.t} SET updated_at = ? WHERE tenant_id = ? AND id = ?`,
      [now, input.tenantId, input.ticketId]
    );
    const msg = await this.getMessage(input.tenantId, id);
    if (!msg) throw new Error("TicketStore.addMessage: failed to reload");
    return msg;
  }
};

// src/tickets/service.ts
var TicketService = class {
  store;
  constructor(db, tablePrefix = DEFAULT_TABLE_PREFIX) {
    this.store = new TicketStore(db, tablePrefix);
  }
  async createTicket(raw) {
    const input = normalizeCreateTicketInput(CreateTicketInputSchema.parse(raw));
    return this.store.create(input);
  }
  listTickets(tenantId, opts) {
    if (typeof opts === "number") {
      return this.store.listByTenant(tenantId, { limit: opts });
    }
    return this.store.listByTenant(tenantId, opts);
  }
  getTicket(tenantId, id) {
    return this.store.getById(tenantId, id);
  }
  getTicketByPublicNumber(tenantId, publicNumber) {
    return this.store.getByPublicNumber(tenantId, publicNumber);
  }
  async getTicketByIdOrNumber(tenantId, idOrNumber) {
    if (idOrNumber.includes("-")) {
      return this.store.getById(tenantId, idOrNumber);
    }
    const n = Number.parseInt(idOrNumber, 10);
    if (!Number.isFinite(n) || n <= 0) return void 0;
    return this.store.getByPublicNumber(tenantId, n);
  }
  listMessages(tenantId, ticketId) {
    return this.store.listMessages(tenantId, ticketId);
  }
  setStatus(tenantId, ticketId, status) {
    return this.store.updateStatus(tenantId, ticketId, status);
  }
  setGithubIssueUrl(tenantId, ticketId, url) {
    return this.store.updateGithubUrl(tenantId, ticketId, url);
  }
  setAssignedTo(tenantId, ticketId, assignedTo) {
    return this.store.updateAssignedTo(tenantId, ticketId, assignedTo);
  }
  addMessage(tenantId, ticketId, body, opts) {
    return this.store.addMessage({
      tenantId,
      ticketId,
      body,
      authorType: opts?.authorType ?? "user",
      authorId: opts?.authorId ?? null,
      citationJson: opts?.citationJson ?? null
    });
  }
};

// src/proposals/service.ts
import {
  CreateProposalInputSchema
} from "@rhule/support-shared";

// src/proposals/store.ts
import { randomUUID as randomUUID2 } from "crypto";
function mapProposal(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ticketId: row.ticket_id,
    proposalType: row.proposal_type,
    status: row.status,
    summary: row.summary,
    bodyJson: row.body_json,
    confidence: row.confidence,
    telegramMessageId: row.telegram_message_id,
    telegramChatId: row.telegram_chat_id,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    executionStatus: row.execution_status,
    executionRef: row.execution_ref,
    createdAt: row.created_at
  };
}
var ProposalStore = class {
  constructor(db, tablePrefix = DEFAULT_TABLE_PREFIX) {
    this.db = db;
    this.tablePrefix = tablePrefix;
  }
  db;
  tablePrefix;
  get p() {
    return `${this.tablePrefix}proposals`;
  }
  async create(input) {
    const id = randomUUID2();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const status = input.status ?? "pending_review";
    await this.db.run(
      `INSERT INTO ${this.p} (
        id, tenant_id, ticket_id, proposal_type, status, summary, body_json, confidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.tenantId,
        input.ticketId,
        input.proposalType,
        status,
        input.summary,
        input.bodyJson,
        input.confidence ?? null,
        now
      ]
    );
    const proposal = await this.getById(input.tenantId, id);
    if (!proposal) {
      throw new Error("ProposalStore.create: failed to reload row");
    }
    return proposal;
  }
  async getById(tenantId, id) {
    const row = await this.db.get(
      `SELECT * FROM ${this.p} WHERE tenant_id = ? AND id = ?`,
      [tenantId, id]
    );
    return row ? mapProposal(row) : void 0;
  }
  async listByTenant(tenantId, opts) {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    const params = [tenantId];
    let where = "WHERE tenant_id = ?";
    if (opts?.status) {
      where += " AND status = ?";
      params.push(opts.status);
    }
    params.push(limit);
    const rows = await this.db.all(
      `SELECT * FROM ${this.p} ${where} ORDER BY created_at DESC LIMIT ?`,
      params
    );
    return rows.map(mapProposal);
  }
  async listForTicket(tenantId, ticketId) {
    const rows = await this.db.all(
      `SELECT * FROM ${this.p} WHERE tenant_id = ? AND ticket_id = ? ORDER BY created_at DESC`,
      [tenantId, ticketId]
    );
    return rows.map(mapProposal);
  }
  async getActivePendingForTicket(tenantId, ticketId) {
    const row = await this.db.get(
      `SELECT * FROM ${this.p}
       WHERE tenant_id = ? AND ticket_id = ? AND status = 'pending_review'
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId, ticketId]
    );
    return row ? mapProposal(row) : void 0;
  }
  async updateStatus(tenantId, id, status, fields) {
    const sets = ["status = ?"];
    const params = [status];
    if (fields?.reviewedBy !== void 0) {
      sets.push("reviewed_by = ?");
      params.push(fields.reviewedBy);
    }
    if (fields?.reviewedAt !== void 0) {
      sets.push("reviewed_at = ?");
      params.push(fields.reviewedAt);
    }
    if (fields?.telegramMessageId !== void 0) {
      sets.push("telegram_message_id = ?");
      params.push(fields.telegramMessageId);
    }
    if (fields?.telegramChatId !== void 0) {
      sets.push("telegram_chat_id = ?");
      params.push(fields.telegramChatId);
    }
    if (fields?.claimedBy !== void 0) {
      sets.push("claimed_by = ?");
      params.push(fields.claimedBy);
    }
    if (fields?.claimedAt !== void 0) {
      sets.push("claimed_at = ?");
      params.push(fields.claimedAt);
    }
    if (fields?.executionStatus !== void 0) {
      sets.push("execution_status = ?");
      params.push(fields.executionStatus);
    }
    if (fields?.executionRef !== void 0) {
      sets.push("execution_ref = ?");
      params.push(fields.executionRef);
    }
    params.push(tenantId, id);
    await this.db.run(
      `UPDATE ${this.p} SET ${sets.join(", ")} WHERE tenant_id = ? AND id = ?`,
      params
    );
    return this.getById(tenantId, id);
  }
  /**
   * Atomic transition: only succeeds if current status is in `fromStatuses`.
   * Returns updated proposal or undefined if lost the race.
   */
  async tryAtomicTransition(tenantId, id, fromStatuses, nextStatus, fields) {
    if (fromStatuses.length === 0) return void 0;
    const placeholders = fromStatuses.map(() => "?").join(", ");
    const result = await this.db.run(
      `UPDATE ${this.p}
       SET status = ?, reviewed_by = ?, reviewed_at = ?,
           execution_status = COALESCE(?, execution_status),
           execution_ref = COALESCE(?, execution_ref)
       WHERE tenant_id = ? AND id = ? AND status IN (${placeholders})`,
      [
        nextStatus,
        fields.reviewedBy,
        fields.reviewedAt,
        fields.executionStatus ?? null,
        fields.executionRef ?? null,
        tenantId,
        id,
        ...fromStatuses
      ]
    );
    if ((result.changes ?? 0) < 1) return void 0;
    return this.getById(tenantId, id);
  }
  async setTelegramMeta(tenantId, id, meta) {
    await this.db.run(
      `UPDATE ${this.p}
       SET telegram_message_id = ?, telegram_chat_id = ?
       WHERE tenant_id = ? AND id = ?`,
      [meta.telegramMessageId, meta.telegramChatId, tenantId, id]
    );
    return this.getById(tenantId, id);
  }
  async setClaim(tenantId, id, claimedBy) {
    const now = claimedBy ? (/* @__PURE__ */ new Date()).toISOString() : null;
    await this.db.run(
      `UPDATE ${this.p} SET claimed_by = ?, claimed_at = ? WHERE tenant_id = ? AND id = ?`,
      [claimedBy, now, tenantId, id]
    );
    return this.getById(tenantId, id);
  }
};

// src/proposals/service.ts
var REVIEWABLE_STATUSES = /* @__PURE__ */ new Set(["pending_review", "needs_info"]);
var ATOMIC_FROM = ["pending_review", "needs_info"];
var ProposalService = class {
  store;
  constructor(db, tablePrefix = DEFAULT_TABLE_PREFIX) {
    this.store = new ProposalStore(db, tablePrefix);
  }
  /** Expose store for executor / webhook soft-claim helpers. */
  getStore() {
    return this.store;
  }
  async createProposal(raw) {
    const input = CreateProposalInputSchema.parse(raw);
    const createInput = {
      tenantId: String(input.tenantId),
      ticketId: input.ticketId,
      proposalType: input.proposalType,
      summary: input.summary,
      bodyJson: input.bodyJson
    };
    if (input.confidence !== void 0) {
      createInput.confidence = input.confidence;
    }
    return this.store.create(createInput);
  }
  getProposal(tenantId, id) {
    return this.store.getById(tenantId, id);
  }
  listProposals(tenantId, opts) {
    return this.store.listByTenant(tenantId, opts);
  }
  listProposalsForTicket(tenantId, ticketId) {
    return this.store.listForTicket(tenantId, ticketId);
  }
  getActivePendingForTicket(tenantId, ticketId) {
    return this.store.getActivePendingForTicket(tenantId, ticketId);
  }
  setTelegramMeta(tenantId, id, meta) {
    return this.store.setTelegramMeta(tenantId, id, meta);
  }
  setClaim(tenantId, id, claimedBy) {
    return this.store.setClaim(tenantId, id, claimedBy);
  }
  /**
   * Atomic approve/reject/needs_info. Returns undefined if another reviewer won.
   */
  async tryAtomicTransition(tenantId, id, nextStatus, reviewedBy, extra) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    return this.store.tryAtomicTransition(tenantId, id, ATOMIC_FROM, nextStatus, {
      reviewedBy,
      reviewedAt: now,
      executionStatus: extra?.executionStatus ?? "done",
      executionRef: extra?.executionRef ?? null
    });
  }
  async approveProposal(tenantId, id, reviewedBy) {
    const updated = await this.tryAtomicTransition(tenantId, id, "approved", reviewedBy);
    if (!updated) {
      const existing = await this.store.getById(tenantId, id);
      if (!existing) throw new Error(`ProposalService: proposal not found (${id})`);
      throw new Error(
        `ProposalService: already handled by ${existing.reviewedBy ?? existing.status}`
      );
    }
    return updated;
  }
  async rejectProposal(tenantId, id, reviewedBy) {
    const updated = await this.tryAtomicTransition(tenantId, id, "rejected", reviewedBy);
    if (!updated) {
      const existing = await this.store.getById(tenantId, id);
      if (!existing) throw new Error(`ProposalService: proposal not found (${id})`);
      throw new Error(
        `ProposalService: already handled by ${existing.reviewedBy ?? existing.status}`
      );
    }
    return updated;
  }
  async markNeedsInfo(tenantId, id, reviewedBy) {
    const updated = await this.tryAtomicTransition(tenantId, id, "needs_info", reviewedBy);
    if (!updated) {
      const existing = await this.store.getById(tenantId, id);
      if (!existing) throw new Error(`ProposalService: proposal not found (${id})`);
      throw new Error(
        `ProposalService: already handled by ${existing.reviewedBy ?? existing.status}`
      );
    }
    return updated;
  }
  /** Non-atomic path kept for tests that expect throw on invalid status. */
  async transitionReviewUnchecked(tenantId, id, nextStatus, reviewedBy) {
    const existing = await this.store.getById(tenantId, id);
    if (!existing) {
      throw new Error(`ProposalService: proposal not found (${id})`);
    }
    if (!REVIEWABLE_STATUSES.has(existing.status)) {
      throw new Error(
        `ProposalService: cannot transition from "${existing.status}" to "${nextStatus}"`
      );
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const updated = await this.store.updateStatus(tenantId, id, nextStatus, {
      reviewedBy,
      reviewedAt: now
    });
    if (!updated) {
      throw new Error(`ProposalService: failed to update proposal (${id})`);
    }
    return updated;
  }
};

// src/gaps/service.ts
import {
  GapStatusSchema,
  RecordKnowledgeGapInputSchema
} from "@rhule/support-shared";

// src/gaps/store.ts
import { randomUUID as randomUUID3 } from "crypto";
function mapGap(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ticketId: row.ticket_id,
    publicNumber: row.public_number,
    userQuestion: row.user_question,
    escalationReason: row.escalation_reason,
    docQuery: row.doc_query,
    docHitsJson: row.doc_hits_json,
    proposalId: row.proposal_id,
    proposalType: row.proposal_type,
    summary: row.summary,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at
  };
}
var KnowledgeGapStore = class {
  constructor(db, tablePrefix = DEFAULT_TABLE_PREFIX) {
    this.db = db;
    this.tablePrefix = tablePrefix;
  }
  db;
  tablePrefix;
  get g() {
    return `${this.tablePrefix}knowledge_gaps`;
  }
  get t() {
    return `${this.tablePrefix}tickets`;
  }
  get m() {
    return `${this.tablePrefix}messages`;
  }
  async getLastUserQuestion(tenantId, ticketId) {
    const row = await this.db.get(
      `SELECT body FROM ${this.m}
       WHERE tenant_id = ? AND ticket_id = ? AND author_type = 'user'
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId, ticketId]
    );
    return row?.body ?? null;
  }
  async record(input) {
    const ticket = await this.db.get(
      `SELECT public_number FROM ${this.t} WHERE tenant_id = ? AND id = ?`,
      [input.tenantId, input.ticketId]
    );
    const lastQuestion = await this.getLastUserQuestion(input.tenantId, input.ticketId);
    const userQuestion = String(
      input.userQuestion ?? lastQuestion ?? input.summary ?? ""
    ).slice(0, 4e3);
    const id = randomUUID3();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await this.db.run(
      `INSERT INTO ${this.g} (
        id, tenant_id, ticket_id, public_number, user_question, escalation_reason,
        doc_query, doc_hits_json, proposal_id, proposal_type, summary, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      [
        id,
        input.tenantId,
        input.ticketId,
        ticket?.public_number ?? null,
        userQuestion,
        input.escalationReason ? String(input.escalationReason).slice(0, 2e3) : null,
        input.docQuery ? String(input.docQuery).slice(0, 2e3) : null,
        input.docHitsJson ?? "[]",
        input.proposalId ?? null,
        input.proposalType ?? null,
        input.summary ? String(input.summary).slice(0, 500) : null,
        now
      ]
    );
    const gap = await this.getById(input.tenantId, id);
    if (!gap) {
      throw new Error("KnowledgeGapStore.record: failed to reload row");
    }
    return gap;
  }
  async getById(tenantId, id) {
    const row = await this.db.get(
      `SELECT * FROM ${this.g} WHERE tenant_id = ? AND id = ?`,
      [tenantId, id]
    );
    return row ? mapGap(row) : void 0;
  }
  async listByTenant(tenantId, opts) {
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
    const params = [tenantId];
    let where = "WHERE tenant_id = ?";
    if (opts?.status) {
      where += " AND status = ?";
      params.push(opts.status);
    }
    params.push(limit);
    const rows = await this.db.all(
      `SELECT * FROM ${this.g} ${where} ORDER BY created_at DESC LIMIT ?`,
      params
    );
    return rows.map(mapGap);
  }
  async updateStatus(tenantId, id, status) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const resolvedAt = status === "resolved" || status === "dismissed" ? now : null;
    await this.db.run(
      `UPDATE ${this.g} SET status = ?, resolved_at = ? WHERE tenant_id = ? AND id = ?`,
      [status, resolvedAt, tenantId, id]
    );
    return this.getById(tenantId, id);
  }
};

// src/gaps/service.ts
var KnowledgeGapService = class {
  store;
  constructor(db, tablePrefix = DEFAULT_TABLE_PREFIX) {
    this.store = new KnowledgeGapStore(db, tablePrefix);
  }
  async recordKnowledgeGap(raw) {
    const input = RecordKnowledgeGapInputSchema.parse(raw);
    const recordInput = {
      tenantId: String(input.tenantId),
      ticketId: input.ticketId
    };
    if (input.proposalId !== void 0) recordInput.proposalId = input.proposalId;
    if (input.proposalType !== void 0) recordInput.proposalType = input.proposalType;
    if (input.summary !== void 0) recordInput.summary = input.summary;
    if (input.escalationReason !== void 0) recordInput.escalationReason = input.escalationReason;
    if (input.docQuery !== void 0) recordInput.docQuery = input.docQuery;
    if (input.docHitsJson !== void 0) recordInput.docHitsJson = input.docHitsJson;
    if (input.userQuestion !== void 0) recordInput.userQuestion = input.userQuestion;
    return this.store.record(recordInput);
  }
  getKnowledgeGap(tenantId, id) {
    return this.store.getById(tenantId, id);
  }
  listKnowledgeGaps(tenantId, opts) {
    return this.store.listByTenant(tenantId, opts);
  }
  patchKnowledgeGap(tenantId, id, status) {
    const parsed = GapStatusSchema.parse(status);
    return this.store.updateStatus(tenantId, id, parsed);
  }
};

// src/agent/triage.ts
import { DEFAULT_TOPICS, SENSITIVE_TOPICS_DEFAULT as SENSITIVE_TOPICS_DEFAULT2 } from "@rhule/support-shared";

// src/kb/search.ts
import fs from "fs";
import path from "path";
var DEFAULT_CACHE_TTL_MS = 5 * 60 * 1e3;
var DEFAULT_LIMIT = 5;
var DEFAULT_FALLBACK_SOURCES = ["faq.md"];
var chunkCache = null;
function tokenize(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
}
function walkMarkdown(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdown(full));
    } else if (entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}
function loadChunks(docsRoot, cacheTtlMs) {
  const now = Date.now();
  if (chunkCache && chunkCache.docsRoot === docsRoot && chunkCache.chunks.length > 0 && now - chunkCache.loadedAt < cacheTtlMs) {
    return chunkCache.chunks;
  }
  const chunks = [];
  for (const file of walkMarkdown(docsRoot)) {
    const rel = path.relative(docsRoot, file).replace(/\\/g, "/");
    const raw = fs.readFileSync(file, "utf8");
    const sections = raw.split(/\n(?=#{1,3}\s)/);
    for (const section of sections) {
      const trimmed = section.trim();
      if (trimmed.length < 40) continue;
      chunks.push({
        source: rel,
        title: (trimmed.match(/^#{1,3}\s+(.+)/)?.[1] || rel).trim(),
        body: trimmed.slice(0, 4e3),
        tokens: new Set(tokenize(trimmed))
      });
    }
  }
  chunkCache = { docsRoot, loadedAt: now, chunks };
  return chunks;
}
function scoreChunk(chunk, queryTokens) {
  let score = 0;
  const lowerTitle = chunk.title.toLowerCase();
  for (const t of queryTokens) {
    if (chunk.tokens.has(t)) score += 1;
    if (lowerTitle.includes(t)) score += 2;
  }
  return score;
}
function rankChunks(chunks, queryTokens, limit) {
  return chunks.map((chunk) => ({ chunk, score: scoreChunk(chunk, queryTokens) })).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(({ chunk, score }) => ({
    source: chunk.source,
    title: chunk.title,
    excerpt: chunk.body.slice(0, 1200),
    score
  }));
}
function fallbackHits(chunks, limit, fallbackSources) {
  const preferred = chunks.filter(
    (c) => fallbackSources.some((src) => c.source.includes(src))
  );
  const pool = preferred.length ? preferred : chunks;
  return pool.slice(0, limit).map((chunk) => ({
    source: chunk.source,
    title: chunk.title,
    excerpt: chunk.body.slice(0, 1200),
    score: 0
  }));
}
function searchCuratedDocs(query, options) {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const fallbackSources = options.fallbackSources ?? DEFAULT_FALLBACK_SOURCES;
  const chunks = loadChunks(options.docsRoot, cacheTtlMs);
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return fallbackHits(chunks, limit, fallbackSources);
  }
  const ranked = rankChunks(chunks, queryTokens, limit);
  if (ranked.length > 0) return ranked;
  const longTokens = queryTokens.filter((t) => t.length > 4);
  if (longTokens.length > 0) {
    const retry = rankChunks(chunks, longTokens, limit);
    if (retry.length > 0) return retry;
  }
  return fallbackHits(chunks, limit, fallbackSources);
}
function formatSourcesForPrompt(hits) {
  if (!hits.length) return "No matching support docs found.";
  return hits.map(
    (h, i) => `[${i + 1}] ${h.source} \u2014 ${h.title}
${h.excerpt}${h.excerpt.length >= 1200 ? "\u2026" : ""}`
  ).join("\n\n---\n\n");
}
function clearDocsCache() {
  chunkCache = null;
}
function mapKbArticle(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    body: row.body,
    status: row.status,
    sourceKind: row.source_kind,
    visibility: row.visibility ?? "agent",
    provenanceJson: row.provenance_json,
    sourceKey: row.source_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function scoreArticle(article, queryTokens) {
  if (queryTokens.length === 0) return 0;
  const titleTokens = new Set(tokenize(article.title));
  const bodyTokens = new Set(tokenize(article.body));
  let score = 0;
  const lowerTitle = article.title.toLowerCase();
  for (const t of queryTokens) {
    if (titleTokens.has(t)) score += 3;
    if (bodyTokens.has(t)) score += 1;
    if (lowerTitle.includes(t)) score += 2;
  }
  return score;
}
async function searchActiveArticles(db, tenantId, options) {
  const prefix = options?.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const table = `${prefix}kb_articles`;
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
  const rows = await db.all(
    `SELECT * FROM ${table} WHERE tenant_id = ? AND status = 'active' ORDER BY updated_at DESC`,
    [tenantId]
  );
  const articles = rows.map(mapKbArticle);
  const queryTokens = tokenize(options?.query ?? "");
  if (queryTokens.length === 0) {
    return articles.slice(0, limit);
  }
  return articles.map((article) => ({ article, score: scoreArticle(article, queryTokens) })).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((r) => r.article);
}

// src/agent/routing.ts
import { SENSITIVE_TOPICS_DEFAULT } from "@rhule/support-shared";
var ESCALATION_KEYWORDS = [
  "chargeback",
  "billing dispute",
  "invoice dispute",
  "lawyer",
  "legal action",
  "delete my data",
  "gdpr",
  "subpoena",
  "harassment",
  "account hacked"
];
var BUG_KEYWORDS = ["bug", "broken", "crash", "error", "not working", "failed"];
var HOW_TO_KEYWORDS = ["how", "where", "what is", "how do", "how can", "help me"];
var FEATURE_KEYWORDS = ["feature", "request", "would be nice", "add support for", "wishlist"];
var DEFAULT_HOLD_REPLY = "Thanks for your patience \u2014 I'm still looking into this. If I can't resolve it here, a teammate will follow up in this same chat.";
var DEFAULT_ESCALATION_REPLY = "I've shared this with our team for a closer look. You'll see updates here \u2014 we typically respond within one business day.";
var KB_SCORE_THRESHOLD = 2;
var MIN_CONFIDENCE_WITH_KB = 0.65;
var MIN_CONFIDENCE_NO_KB = 0.85;
var HIGH_CONFIDENCE = 0.92;
function containsEscalationSignal(text) {
  const lower = String(text || "").toLowerCase();
  return ESCALATION_KEYWORDS.some((keyword) => lower.includes(keyword));
}
function looksLikeHowTo(message) {
  const lower = message.toLowerCase();
  return HOW_TO_KEYWORDS.some((k) => lower.includes(k));
}
function inferKindTopic(message, topicAllowlist = [...SENSITIVE_TOPICS_DEFAULT, "how_to", "product", "account", "other"]) {
  const lower = message.toLowerCase();
  if (BUG_KEYWORDS.some((k) => lower.includes(k))) {
    return { kind: "bug", topic: "other" };
  }
  if (FEATURE_KEYWORDS.some((k) => lower.includes(k))) {
    return { kind: "feature", topic: "product" };
  }
  let topic = "other";
  if (lower.includes("bill") || lower.includes("invoice") || lower.includes("payment") || lower.includes("refund")) {
    topic = "billing";
  } else if (lower.includes("login") || lower.includes("password") || lower.includes("access") || lower.includes("permission")) {
    topic = "access";
  } else if (looksLikeHowTo(message)) {
    topic = "how_to";
  } else if (lower.includes("account") || lower.includes("plan") || lower.includes("upgrade")) {
    topic = "account";
  }
  if (!topicAllowlist.includes(topic)) topic = "other";
  return { kind: "support", topic };
}
function minConfidence(docHits) {
  return docHits.length > 0 ? MIN_CONFIDENCE_WITH_KB : MIN_CONFIDENCE_NO_KB;
}
function topKbScore(hits) {
  return hits.length > 0 ? Math.max(...hits.map((h) => h.score)) : 0;
}
function extractDraft(parsed) {
  const body = parsed.body && typeof parsed.body === "object" ? parsed.body : {};
  return String(body.draft_reply || "").trim();
}
function inferRoute(parsed) {
  if (parsed.route) return parsed.route;
  if (parsed.proposal_type === "escalation" || parsed.proposal_type === "escalate") return "escalate";
  return "propose_reply";
}
function isSensitiveTopic(topic, sensitiveTopics) {
  return sensitiveTopics.includes(topic);
}
function decideFromLlm(parsed, message, docHits, opts = {}) {
  const sensitive = opts.sensitiveTopics ?? [...SENSITIVE_TOPICS_DEFAULT];
  const allowlist = opts.topicAllowlist;
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  const route = inferRoute(parsed);
  const draft = extractDraft(parsed);
  const inferred = inferKindTopic(message, allowlist);
  const kind = parsed.kind ?? inferred.kind;
  let topic = parsed.topic ?? inferred.topic;
  if (allowlist && !allowlist.includes(topic)) topic = "other";
  if (kind === "bug") {
    return {
      action: "propose",
      kind: "bug",
      topic,
      proposalType: "bug_fix",
      confidence,
      summary: parsed.summary || "Bug report",
      draftReply: draft || DEFAULT_HOLD_REPLY,
      recordGap: true
    };
  }
  if (kind === "feature") {
    return {
      action: "propose",
      kind: "feature",
      topic: topic === "other" ? "product" : topic,
      proposalType: "feature",
      confidence,
      summary: parsed.summary || "Feature request",
      draftReply: draft || DEFAULT_HOLD_REPLY,
      recordGap: false
    };
  }
  if (containsEscalationSignal(message) || containsEscalationSignal(parsed.body?.escalation_reason ?? "")) {
    return {
      action: "escalate",
      kind: "support",
      topic,
      proposalType: "escalate",
      confidence,
      summary: parsed.summary || "Escalation requested",
      draftReply: draft || DEFAULT_ESCALATION_REPLY,
      recordGap: true
    };
  }
  if (route === "close") {
    return {
      action: "auto_reply",
      kind: "support",
      topic,
      proposalType: "reply",
      confidence,
      summary: parsed.summary || "Resolved",
      draftReply: draft || "Glad that helped! Let us know if anything else comes up.",
      recordGap: false,
      resolveAfterReply: true
    };
  }
  if (route === "escalate" || isSensitiveTopic(topic, sensitive)) {
    return {
      action: "escalate",
      kind: "support",
      topic,
      proposalType: "escalate",
      confidence,
      summary: parsed.summary || (isSensitiveTopic(topic, sensitive) ? `Sensitive topic: ${topic}` : "Escalation"),
      draftReply: draft || DEFAULT_ESCALATION_REPLY,
      recordGap: true
    };
  }
  const threshold = opts.autoReplyMinConfidence ?? minConfidence(docHits);
  if (route === "reply_in_app" && draft && confidence >= threshold && (docHits.length > 0 || confidence >= HIGH_CONFIDENCE)) {
    return {
      action: "auto_reply",
      kind: "support",
      topic,
      proposalType: "reply",
      confidence,
      summary: parsed.summary || "KB answer",
      draftReply: draft,
      recordGap: false
    };
  }
  if (route === "propose_reply" && draft && confidence >= threshold && docHits.length > 0 && topic === "how_to") {
    return {
      action: "auto_reply",
      kind: "support",
      topic,
      proposalType: "reply",
      confidence,
      summary: parsed.summary || "KB answer",
      draftReply: draft,
      recordGap: false
    };
  }
  return {
    action: "propose",
    kind: "support",
    topic,
    proposalType: "reply",
    confidence,
    summary: parsed.summary || "Needs human review",
    draftReply: draft || DEFAULT_HOLD_REPLY,
    recordGap: docHits.length === 0 || confidence < MIN_CONFIDENCE_WITH_KB
  };
}
function decideFromHeuristics(message, docHits, opts = {}) {
  const sensitive = opts.sensitiveTopics ?? [...SENSITIVE_TOPICS_DEFAULT];
  const { kind, topic } = inferKindTopic(message, opts.topicAllowlist);
  const topScore = topKbScore(docHits);
  if (kind === "bug") {
    return {
      action: "propose",
      kind: "bug",
      topic,
      proposalType: "bug_fix",
      confidence: 0.4,
      summary: "Bug report",
      draftReply: DEFAULT_HOLD_REPLY,
      recordGap: true
    };
  }
  if (kind === "feature") {
    return {
      action: "propose",
      kind: "feature",
      topic,
      proposalType: "feature",
      confidence: 0.4,
      summary: "Feature request",
      draftReply: DEFAULT_HOLD_REPLY,
      recordGap: false
    };
  }
  if (containsEscalationSignal(message) || isSensitiveTopic(topic, sensitive)) {
    return {
      action: "escalate",
      kind: "support",
      topic: topic === "other" && containsEscalationSignal(message) ? "billing" : topic,
      proposalType: "escalate",
      confidence: 0.5,
      summary: "Escalation keyword or sensitive topic",
      draftReply: DEFAULT_ESCALATION_REPLY,
      recordGap: true
    };
  }
  if (looksLikeHowTo(message) && topScore >= KB_SCORE_THRESHOLD) {
    const excerpt = docHits[0]?.excerpt ?? "";
    return {
      action: "auto_reply",
      kind: "support",
      topic: topic === "other" ? "how_to" : topic,
      proposalType: "reply",
      confidence: Math.min(0.7 + topScore * 0.05, 0.95),
      summary: "KB heuristic match",
      draftReply: excerpt.slice(0, 800) || DEFAULT_HOLD_REPLY,
      recordGap: false
    };
  }
  if (topScore < KB_SCORE_THRESHOLD) {
    return {
      action: "propose",
      kind: "support",
      topic,
      proposalType: "reply",
      confidence: topScore > 0 ? 0.4 : 0.2,
      summary: "Low KB confidence",
      draftReply: DEFAULT_HOLD_REPLY,
      recordGap: true
    };
  }
  return {
    action: "propose",
    kind: "support",
    topic,
    proposalType: "reply",
    confidence: 0.5,
    summary: "Default triage",
    draftReply: DEFAULT_HOLD_REPLY,
    recordGap: false
  };
}

// src/agent/triage.ts
function buildSystemPrompt(brand, topics) {
  return `You are ${brand.supportAgentName} for ${brand.name} support triage. Output ONLY valid JSON (no markdown fences).

Classify the user message and decide routing:
- reply_in_app \u2014 confident how-to answer from knowledge base; include draft_reply in body
- propose_reply \u2014 answer needs human approval (sensitive, uncertain, or complex)
- escalate \u2014 billing disputes, legal, abuse, account compromise
- close \u2014 user confirmed resolved

When User context is provided, treat plan tier, subscription status, AI usage/budget, matter counts, and storage as ground truth for this session. You MAY answer non-sensitive account questions from that context (e.g. "what plan am I on?", "how much AI budget left?", "how many matters can I create?"). Do NOT invent Stripe invoices, card numbers, or payment methods. Escalate refunds, chargebacks, account takeover, and payment failures.

In draft_reply, use normal Markdown: hyphen bullets ("- item"), **bold** for labels, short paragraphs. Do not use leading ". " as bullets.

JSON shape:
{
  "route": "reply_in_app|propose_reply|escalate|close",
  "kind": "support|bug|feature",
  "topic": "${topics.join("|")}",
  "proposal_type": "reply|escalate|bug_fix|feature",
  "summary": "one line for ops",
  "confidence": 0.0-1.0,
  "body": { "draft_reply": "customer-facing reply", "sources": ["doc paths"], "escalation_reason": null }
}

Never invent product features not in the knowledge base. If unsure, use propose_reply with a helpful draft_reply.
When user context (plan/role) is provided, tailor draft_reply to that plan \u2014 never claim a different plan.`;
}
function formatReply(draft, brand) {
  const trimmed = draft.trim();
  if (!trimmed) return `\u2014 ${brand.supportAgentName}`;
  if (trimmed.includes(brand.supportAgentName)) return trimmed;
  return `${trimmed}

\u2014 ${brand.supportAgentName}`;
}
function appendUserContext(parts, user) {
  if (user.contextSummary?.trim()) {
    parts.push(
      "",
      "User context (tailor answers \u2014 do not invent a different plan or role):",
      user.contextSummary.trim()
    );
  }
}
function buildAdminTicketUrl(adminBaseUrl, publicNumber) {
  if (!adminBaseUrl) return void 0;
  const base = adminBaseUrl.trim().replace(/\/$/, "");
  return `${base}?ticket=${publicNumber}`;
}
function notifyOps(deps, notification) {
  if (!deps.opsNotifier) return;
  deps.opsNotifier.sendToOps(notification).catch(() => {
  });
}
function parseLlmJson(raw) {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned);
}
function decideOpts(deps) {
  const opts = {
    topicAllowlist: deps.topics ?? [...DEFAULT_TOPICS],
    sensitiveTopics: deps.sensitiveTopics ?? [...SENSITIVE_TOPICS_DEFAULT2]
  };
  if (deps.autoReplyMinConfidence !== void 0) {
    opts.autoReplyMinConfidence = deps.autoReplyMinConfidence;
  }
  return opts;
}
async function callLlm(llm, brand, message, docHits, user, topics) {
  try {
    const parts = [
      "Knowledge base excerpts:",
      formatSourcesForPrompt(docHits),
      "",
      "User message:",
      message
    ];
    appendUserContext(parts, user);
    const raw = await llm.complete({
      system: buildSystemPrompt(brand, topics),
      user: parts.join("\n"),
      temperature: 0.2
    });
    return parseLlmJson(raw);
  } catch {
    return null;
  }
}
async function resolveDecision(deps, message, docHits, user, forced) {
  const opts = decideOpts(deps);
  let decision;
  if (deps.llm) {
    const parsed = await callLlm(
      deps.llm,
      deps.brand,
      message,
      docHits,
      user,
      opts.topicAllowlist ?? [...DEFAULT_TOPICS]
    );
    decision = parsed ? decideFromLlm(parsed, message, docHits, opts) : decideFromHeuristics(message, docHits, opts);
  } else {
    decision = decideFromHeuristics(message, docHits, opts);
  }
  if (forced?.kind) {
    decision = { ...decision, kind: forced.kind };
    if (forced.kind === "bug") {
      decision.action = "propose";
      decision.proposalType = "bug_fix";
    } else if (forced.kind === "feature") {
      decision.action = "propose";
      decision.proposalType = "feature";
    }
  }
  if (forced?.topic) {
    decision = { ...decision, topic: forced.topic };
  }
  return decision;
}
function citationsJson(docHits) {
  return JSON.stringify(
    docHits.map((h) => ({ source: h.source, title: h.title, score: h.score }))
  );
}
async function triageMessage(deps, input) {
  const prefix = deps.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const docHits = deps.docsRoot ? searchCuratedDocs(input.message, { docsRoot: deps.docsRoot, limit: 5 }) : [];
  const decision = await resolveDecision(deps, input.message, docHits, input.user, {
    ...input.kind ? { kind: input.kind } : {},
    ...input.topic ? { topic: input.topic } : {}
  });
  const tickets = new TicketService(deps.db, prefix);
  const proposals = new ProposalService(deps.db, prefix);
  const gaps = new KnowledgeGapService(deps.db, prefix);
  const initialStatus = decision.action === "auto_reply" ? decision.resolveAfterReply ? "resolved" : "waiting_user" : decision.action === "escalate" ? "escalated" : "pending_ops";
  const createInput = {
    tenantId: input.tenantId,
    kind: decision.kind,
    topic: decision.topic,
    body: input.message,
    userId: input.user.id,
    subject: input.message.slice(0, 200),
    status: "ai_working",
    contextJson: JSON.stringify({
      planLabel: input.user.planLabel ?? null,
      contextSummary: input.user.contextSummary ?? null,
      email: input.user.email ?? null,
      role: input.user.role
    })
  };
  if (input.user.orgId) createInput.orgId = input.user.orgId;
  const { ticket, message: userMessage } = await tickets.createTicket(createInput);
  const autoReplied = decision.action === "auto_reply";
  const citationJson = docHits.length > 0 ? citationsJson(docHits) : null;
  const agentMessage = await tickets.addMessage(
    input.tenantId,
    ticket.id,
    decision.draftReply,
    {
      authorType: "assistant",
      authorId: deps.brand.agentAuthorId,
      citationJson
    }
  );
  await tickets.setStatus(input.tenantId, ticket.id, initialStatus);
  let proposal;
  if (!autoReplied) {
    const bodyJson = JSON.stringify({
      draft_reply: decision.draftReply,
      sources: docHits.map((h) => h.source),
      user_intent: input.message.slice(0, 500),
      kind: decision.kind,
      topic: decision.topic
    });
    proposal = await proposals.createProposal({
      tenantId: input.tenantId,
      ticketId: ticket.id,
      proposalType: decision.proposalType,
      summary: decision.summary,
      bodyJson,
      confidence: decision.confidence
    });
  }
  let gap;
  if (decision.recordGap) {
    gap = await gaps.recordKnowledgeGap({
      tenantId: input.tenantId,
      ticketId: ticket.id,
      proposalId: proposal?.id,
      proposalType: decision.proposalType,
      summary: decision.summary,
      docQuery: input.message,
      docHitsJson: JSON.stringify(docHits),
      userQuestion: input.message
    });
  }
  const updated = await tickets.getTicket(input.tenantId, ticket.id);
  const adminUrl = buildAdminTicketUrl(deps.adminBaseUrl, ticket.publicNumber);
  if (!autoReplied) {
    const ticketNotification = {
      kind: decision.action === "escalate" ? "escalation" : "ticket_created",
      title: `${decision.kind} ticket #${ticket.publicNumber}`,
      body: decision.summary || input.message.slice(0, 500),
      ticketPublicNumber: ticket.publicNumber
    };
    if (adminUrl) ticketNotification.adminUrl = adminUrl;
    notifyOps(deps, ticketNotification);
    if (proposal) {
      const proposalNotification = {
        kind: "proposal_ready",
        title: `AI proposal \u2014 ticket #${ticket.publicNumber}`,
        body: proposal.summary,
        ticketPublicNumber: ticket.publicNumber
      };
      if (adminUrl) proposalNotification.adminUrl = adminUrl;
      if (deps.opsNotifier?.notifyProposalReady) {
        deps.opsNotifier.notifyProposalReady({
          ticketPublicNumber: ticket.publicNumber,
          proposal: {
            id: proposal.id,
            proposalType: proposal.proposalType,
            summary: proposal.summary,
            bodyJson: proposal.bodyJson,
            confidence: proposal.confidence ?? null,
            claimedBy: proposal.claimedBy ?? null
          },
          kindLabel: decision.kind,
          ...adminUrl ? { adminUrl } : {}
        }).then(async (result2) => {
          if (result2?.messageId) {
            await proposals.setTelegramMeta(input.tenantId, proposal.id, {
              telegramMessageId: result2.messageId,
              telegramChatId: result2.chatId ?? ""
            });
          }
        }).catch(() => {
        });
      } else {
        notifyOps(deps, proposalNotification);
      }
    }
  }
  const result = {
    action: "ticket",
    reply: formatReply(decision.draftReply, deps.brand),
    ticket: updated ?? ticket,
    message: userMessage,
    agentMessage,
    confidence: decision.confidence,
    autoReplied,
    sources: docHits
  };
  if (proposal) result.proposal = proposal;
  if (gap) result.gap = gap;
  return result;
}

// src/kb/codegen.ts
import { randomUUID as randomUUID4 } from "crypto";
function mapKbArticle2(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    body: row.body,
    status: row.status,
    sourceKind: row.source_kind,
    visibility: row.visibility ?? "agent",
    provenanceJson: row.provenance_json,
    sourceKey: row.source_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
async function ingestCodegenArticle(db, input) {
  const prefix = input.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const table = `${prefix}kb_articles`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const sourceKind = input.sourceKind ?? "codegen";
  const visibility = input.visibility ?? "agent";
  const provenanceJson = JSON.stringify({
    gitSha: input.gitSha ?? null,
    path: input.path ?? null,
    ingestedAt: now
  });
  const existing = await db.get(
    `SELECT * FROM ${table} WHERE tenant_id = ? AND source_kind = ? AND source_key = ?`,
    [input.tenantId, sourceKind, input.sourceKey]
  );
  if (existing) {
    await db.run(
      `UPDATE ${table}
       SET title = ?, body = ?, status = 'draft', visibility = ?, provenance_json = ?, updated_at = ?
       WHERE id = ?`,
      [input.title, input.body, visibility, provenanceJson, now, existing.id]
    );
    const row2 = await db.get(`SELECT * FROM ${table} WHERE id = ?`, [existing.id]);
    if (!row2) throw new Error("ingestCodegenArticle: upsert failed");
    return mapKbArticle2(row2);
  }
  const id = randomUUID4();
  await db.run(
    `INSERT INTO ${table} (
      id, tenant_id, title, body, status, source_kind, visibility, provenance_json, source_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.tenantId,
      input.title,
      input.body,
      sourceKind,
      visibility,
      provenanceJson,
      input.sourceKey,
      now,
      now
    ]
  );
  const row = await db.get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (!row) throw new Error("ingestCodegenArticle: insert failed");
  return mapKbArticle2(row);
}
async function promoteKbArticle(db, tenantId, id, tablePrefix, opts) {
  const prefix = tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const table = `${prefix}kb_articles`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existing = await db.get(
    `SELECT * FROM ${table} WHERE tenant_id = ? AND id = ?`,
    [tenantId, id]
  );
  if (!existing) {
    throw new Error(`promoteKbArticle: article not found (${id})`);
  }
  if (opts?.visibility) {
    await db.run(
      `UPDATE ${table} SET status = 'active', visibility = ?, updated_at = ? WHERE id = ?`,
      [opts.visibility, now, id]
    );
  } else {
    await db.run(
      `UPDATE ${table} SET status = 'active', updated_at = ? WHERE id = ?`,
      [now, id]
    );
  }
  const row = await db.get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (!row) throw new Error("promoteKbArticle: update failed");
  return mapKbArticle2(row);
}
async function deprecateKbArticle(db, tenantId, id, tablePrefix) {
  const prefix = tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const table = `${prefix}kb_articles`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await db.run(
    `UPDATE ${table} SET status = 'deprecated', updated_at = ? WHERE tenant_id = ? AND id = ?`,
    [now, tenantId, id]
  );
  const row = await db.get(
    `SELECT * FROM ${table} WHERE tenant_id = ? AND id = ?`,
    [tenantId, id]
  );
  if (!row) throw new Error(`deprecateKbArticle: article not found (${id})`);
  return mapKbArticle2(row);
}
async function updateKbArticle(db, tenantId, id, patch, tablePrefix) {
  const prefix = tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const table = `${prefix}kb_articles`;
  const existing = await db.get(
    `SELECT * FROM ${table} WHERE tenant_id = ? AND id = ?`,
    [tenantId, id]
  );
  if (!existing) throw new Error(`updateKbArticle: not found (${id})`);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await db.run(
    `UPDATE ${table} SET title = ?, body = ?, visibility = ?, updated_at = ? WHERE id = ?`,
    [
      patch.title ?? existing.title,
      patch.body ?? existing.body,
      patch.visibility ?? existing.visibility ?? "agent",
      now,
      id
    ]
  );
  const row = await db.get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (!row) throw new Error("updateKbArticle: reload failed");
  return mapKbArticle2(row);
}
async function listKbArticles(db, tenantId, opts) {
  const prefix = opts?.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const table = `${prefix}kb_articles`;
  const limit = opts?.limit ?? 100;
  const clauses = ["tenant_id = ?"];
  const params = [tenantId];
  if (opts?.status) {
    clauses.push("status = ?");
    params.push(opts.status);
  }
  if (opts?.sourceKind) {
    clauses.push("source_kind = ?");
    params.push(opts.sourceKind);
  }
  params.push(limit);
  const rows = await db.all(
    `SELECT * FROM ${table} WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`,
    params
  );
  return rows.map(mapKbArticle2);
}
async function getKbArticle(db, tenantId, id, tablePrefix) {
  const prefix = tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const row = await db.get(
    `SELECT * FROM ${prefix}kb_articles WHERE tenant_id = ? AND id = ?`,
    [tenantId, id]
  );
  return row ? mapKbArticle2(row) : void 0;
}
function slugifyHeading(heading) {
  return heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
async function ingestFromChangelog(db, tenantId, changelogText, opts) {
  const sections = changelogText.split(/\n(?=##\s)/);
  const articles = [];
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^##\s+(.+?)(?:\n|$)/);
    if (!match) continue;
    const heading = match[1].trim();
    const sourceKey = `changelog:${slugifyHeading(heading)}`;
    const ingestInput = {
      tenantId,
      title: heading,
      body: trimmed,
      sourceKey
    };
    if (opts?.gitSha) ingestInput.gitSha = opts.gitSha;
    if (opts?.tablePrefix) ingestInput.tablePrefix = opts.tablePrefix;
    const article = await ingestCodegenArticle(db, ingestInput);
    articles.push(article);
  }
  return articles;
}
async function ingestDocsSources(db, tenantId, sources, opts) {
  const articles = [];
  for (const src of sources) {
    const sourceKey = `docs:${src.path.replace(/^\/+/, "")}`;
    const title = src.title ?? src.path.split("/").pop()?.replace(/\.md$/i, "") ?? src.path;
    const ingestInput = {
      tenantId,
      title,
      body: src.body,
      sourceKey,
      path: src.path
    };
    if (opts?.gitSha) ingestInput.gitSha = opts.gitSha;
    if (opts?.tablePrefix) ingestInput.tablePrefix = opts.tablePrefix;
    articles.push(await ingestCodegenArticle(db, ingestInput));
  }
  return articles;
}

// src/kb/evolutionary.ts
async function promoteTicketAnswerToKb(db, input) {
  const prefix = input.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const tickets = new TicketService(db, prefix);
  const ticket = await tickets.getTicket(input.tenantId, input.ticketId);
  if (!ticket) throw new Error(`promoteTicketAnswerToKb: ticket not found (${input.ticketId})`);
  const messages = await tickets.listMessages(input.tenantId, ticket.id);
  const staffOrAssistant = [...messages].reverse().find((m) => m.authorType === "assistant" || m.authorType === "staff" || m.authorType === "agent" || m.authorType === "ops");
  const title = input.title?.trim() || ticket.subject?.trim() || `Ticket #${ticket.publicNumber}`;
  const body = input.body?.trim() || staffOrAssistant?.body || messages.map((m) => `**${m.authorType}:** ${m.body}`).join("\n\n");
  const article = await ingestCodegenArticle(db, {
    tenantId: input.tenantId,
    title,
    body,
    sourceKey: `evolutionary:ticket:${ticket.id}`,
    sourceKind: "evolutionary",
    path: `ticket/${ticket.publicNumber}`,
    tablePrefix: prefix
  });
  if (input.activate) {
    return promoteKbArticle(db, input.tenantId, article.id, prefix);
  }
  return article;
}

// src/github/executor.ts
function parseBugFeatureBody(bodyJson) {
  try {
    return JSON.parse(bodyJson);
  } catch {
    return {};
  }
}
async function executeGithubFromProposal(github, opts) {
  const parsed = parseBugFeatureBody(opts.bodyJson);
  const kind = opts.proposalType === "feature" ? "feature" : "bug";
  const title = parsed.github_title?.trim() || parsed.title?.trim() || opts.summary || `${kind} from support #${opts.ticketPublicNumber}`;
  const body = parsed.github_body?.trim() || parsed.draft_reply?.trim() || `${opts.summary}

_From support ticket #${opts.ticketPublicNumber}_`;
  return github.createIssue({
    title,
    body,
    kind,
    ticketPublicNumber: opts.ticketPublicNumber,
    labels: kind === "bug" ? ["bug", "from-support"] : ["enhancement", "from-support"]
  });
}

// src/proposals/executor.ts
function parseProposalBody(bodyJson) {
  try {
    return JSON.parse(bodyJson);
  } catch {
    return {};
  }
}
function normalizeAction(action) {
  const a = String(action || "").toLowerCase();
  if (a === "approve" || a === "issue" || a === "approve_backlog") return "approve";
  if (a === "send_reply" || a === "send") return "send_reply";
  if (a === "edit_send") return "edit_send";
  if (a === "reject" || a === "dismiss") return "reject";
  if (a === "need_info") return "need_info";
  if (a === "take_over" || a === "assign_me") return "take_over";
  if (a === "claim") return "claim";
  if (a === "steal" || a === "steal_claim") return "steal";
  if (a === "release") return "release";
  return null;
}
function notifyEmail(email, ticket, body, brandName) {
  if (!email) return;
  let to = ticket.guestEmail ?? void 0;
  if (!to && ticket.contextJson) {
    try {
      const ctx = JSON.parse(ticket.contextJson);
      to = ctx.email ?? void 0;
    } catch {
    }
  }
  if (!to) return;
  email.sendToUser({
    to,
    subject: `${brandName} support \u2014 ticket #${ticket.publicNumber}`,
    body,
    ticketPublicNumber: ticket.publicNumber
  }).catch(() => {
  });
}
function adminTicketUrl(adminBaseUrl, publicNumber) {
  if (!adminBaseUrl) return void 0;
  const base = adminBaseUrl.trim().replace(/\/$/, "");
  return `${base}?ticket=${publicNumber}`;
}
function alreadyHandled(existing) {
  const out = {
    ok: false,
    status: 409,
    error: `Already handled by ${existing?.reviewedBy ?? existing?.status ?? "another op"}`
  };
  if (existing) out.proposal = existing;
  if (existing?.reviewedBy != null) out.handledBy = existing.reviewedBy;
  return out;
}
async function refreshTelegramMessage(deps, proposal, ticket, opts) {
  if (!deps.telegram) return;
  const chatId = proposal.telegramChatId;
  const messageId = proposal.telegramMessageId;
  if (!chatId || !messageId) return;
  const proposalView = {
    id: proposal.id,
    proposalType: proposal.proposalType,
    summary: proposal.summary,
    bodyJson: proposal.bodyJson,
    confidence: proposal.confidence ?? null,
    claimedBy: proposal.claimedBy ?? null
  };
  const adminUrl = adminTicketUrl(deps.adminBaseUrl, ticket.publicNumber);
  const text = deps.telegram.formatProposalMessage({
    ticketPublicNumber: ticket.publicNumber,
    proposal: proposalView,
    ...adminUrl ? { adminUrl } : {},
    claimLabel: opts.claimLabel ?? null,
    doneLabel: opts.doneLabel ?? null
  });
  const replyMarkup = opts.clearKeyboard || opts.doneLabel ? null : deps.telegram.proposalKeyboard(proposalView, {
    claimedBy: proposalView.claimedBy
  });
  try {
    await deps.telegram.editProposalMessage({
      chatId,
      messageId,
      text,
      replyMarkup
    });
  } catch {
  }
}
async function softClaim(deps, proposal, ticket, reviewer, mode) {
  const claimed = await deps.proposals.setClaim(deps.tenantId, proposal.id, reviewer);
  await deps.tickets.setAssignedTo(deps.tenantId, ticket.id, reviewer);
  const next = claimed ?? await deps.proposals.getProposal(deps.tenantId, proposal.id);
  const label = reviewer.startsWith("@") ? reviewer : reviewer.replace(/^telegram:/, "@");
  await refreshTelegramMessage(deps, next, ticket, {
    claimLabel: `Claimed by ${label}`
  });
  return {
    ok: true,
    result: mode === "steal" ? "stolen" : "claimed",
    proposal: next,
    ticket,
    doneLabel: mode === "steal" ? `Stolen by ${label}` : `Claimed by ${label}`
  };
}
async function executeProposalAction(deps, proposalId, actionRaw, reviewerId, opts) {
  const act = normalizeAction(actionRaw);
  if (!act) {
    return { ok: false, status: 400, error: `Invalid action: ${actionRaw}` };
  }
  const proposal = await deps.proposals.getProposal(deps.tenantId, proposalId);
  if (!proposal) {
    return { ok: false, status: 404, error: "Proposal not found" };
  }
  let ticket = await deps.tickets.getTicket(deps.tenantId, proposal.ticketId);
  if (!ticket) {
    return { ok: false, status: 404, error: "Ticket not found" };
  }
  const reviewer = String(reviewerId || "unknown");
  if (act === "claim" || act === "steal") {
    return softClaim(deps, proposal, ticket, reviewer, act === "steal" ? "steal" : "claim");
  }
  if (act === "release") {
    if (proposal.claimedBy && proposal.claimedBy !== reviewer) {
    }
    const cleared = await deps.proposals.setClaim(deps.tenantId, proposal.id, null);
    await deps.tickets.setAssignedTo(deps.tenantId, ticket.id, null);
    const next = cleared ?? proposal;
    await refreshTelegramMessage(deps, { ...next, claimedBy: null }, ticket, {
      claimLabel: null
    });
    return {
      ok: true,
      result: "released",
      proposal: next,
      ticket,
      doneLabel: "Claim released"
    };
  }
  if (act === "take_over") {
    await deps.proposals.setClaim(deps.tenantId, proposal.id, reviewer);
    await deps.tickets.setAssignedTo(deps.tenantId, ticket.id, reviewer);
    const rejected = await deps.proposals.tryAtomicTransition(
      deps.tenantId,
      proposal.id,
      "rejected",
      reviewer
    );
    if (!rejected) {
      const existing = await deps.proposals.getProposal(deps.tenantId, proposal.id);
      return alreadyHandled(existing);
    }
    const next = await deps.tickets.setStatus(deps.tenantId, ticket.id, "escalated");
    if (next) ticket = next;
    const label2 = reviewer.replace(/^telegram:/, "@");
    await refreshTelegramMessage(deps, rejected, ticket, {
      doneLabel: `Done by ${label2} \u2014 took over`,
      clearKeyboard: true
    });
    return {
      ok: true,
      result: "escalated",
      proposal: rejected,
      ticket,
      doneLabel: `Took over by ${label2}`
    };
  }
  if (act === "reject") {
    const rejected = await deps.proposals.tryAtomicTransition(
      deps.tenantId,
      proposal.id,
      "rejected",
      reviewer
    );
    if (!rejected) {
      const existing = await deps.proposals.getProposal(deps.tenantId, proposal.id);
      return alreadyHandled(existing);
    }
    const label2 = reviewer.replace(/^telegram:/, "@");
    await refreshTelegramMessage(deps, rejected, ticket, {
      doneLabel: `Done by ${label2} \u2014 rejected`,
      clearKeyboard: true
    });
    return {
      ok: true,
      result: "rejected",
      proposal: rejected,
      ticket,
      doneLabel: `Rejected by ${label2}`
    };
  }
  if (act === "need_info") {
    const prompt = String(opts?.needInfoMessage ?? "").trim() || parseProposalBody(proposal.bodyJson).need_info_message || parseProposalBody(proposal.bodyJson).need_info_prompt || "Could you share a bit more detail so we can help?";
    const marked = await deps.proposals.tryAtomicTransition(
      deps.tenantId,
      proposal.id,
      "needs_info",
      reviewer
    );
    if (!marked) {
      const existing = await deps.proposals.getProposal(deps.tenantId, proposal.id);
      return alreadyHandled(existing);
    }
    const message2 = await deps.tickets.addMessage(deps.tenantId, proposal.ticketId, prompt, {
      authorType: "staff",
      authorId: reviewer
    });
    const next = await deps.tickets.setStatus(deps.tenantId, proposal.ticketId, "waiting_user");
    if (next) ticket = next;
    notifyEmail(deps.email, ticket, prompt, deps.brand.name);
    const label2 = reviewer.replace(/^telegram:/, "@");
    await refreshTelegramMessage(deps, marked, ticket, {
      doneLabel: `Done by ${label2} \u2014 asked for info`,
      clearKeyboard: true
    });
    return {
      ok: true,
      result: "needs_info",
      proposal: marked,
      ticket,
      message: message2,
      doneLabel: `Need info by ${label2}`
    };
  }
  const editedReply = String(opts?.draftReply ?? "").trim();
  const approved = await deps.proposals.tryAtomicTransition(
    deps.tenantId,
    proposal.id,
    "approved",
    reviewer
  );
  if (!approved) {
    const existing = await deps.proposals.getProposal(deps.tenantId, proposal.id);
    return alreadyHandled(existing);
  }
  const label = reviewer.replace(/^telegram:/, "@");
  let message;
  const type = proposal.proposalType;
  if (type === "bug_fix" || type === "feature" || type === "github_issue") {
    if (!deps.github) {
      return {
        ok: false,
        status: 400,
        error: "GitHub adapter not configured for bug/feature approval",
        proposal: approved
      };
    }
    const gh = await executeGithubFromProposal(deps.github, {
      proposalType: type,
      bodyJson: proposal.bodyJson,
      summary: proposal.summary,
      ticketPublicNumber: ticket.publicNumber
    });
    ticket = await deps.tickets.setGithubIssueUrl(deps.tenantId, ticket.id, gh.url) ?? ticket;
    const userUpdate = editedReply || parseProposalBody(proposal.bodyJson).draft_reply || `We've logged this as ${gh.url}. We'll update you here.`;
    message = await deps.tickets.addMessage(deps.tenantId, proposal.ticketId, userUpdate, {
      authorType: "staff",
      authorId: reviewer
    });
    const nextStatus = type === "feature" ? "open" : "waiting_user";
    const next = await deps.tickets.setStatus(deps.tenantId, proposal.ticketId, nextStatus);
    if (next) ticket = next;
    notifyEmail(deps.email, ticket, userUpdate, deps.brand.name);
    await refreshTelegramMessage(deps, approved, ticket, {
      doneLabel: `Done by ${label} \u2014 GitHub ${gh.url}`,
      clearKeyboard: true
    });
    return {
      ok: true,
      result: "github_issue",
      proposal: approved,
      ticket,
      message,
      doneLabel: `Approved by ${label} \u2014 GitHub issue`
    };
  }
  const parsed = parseProposalBody(proposal.bodyJson);
  const draft = editedReply || parsed.draft_reply?.trim();
  if (draft) {
    message = await deps.tickets.addMessage(deps.tenantId, proposal.ticketId, draft, {
      authorType: "assistant",
      authorId: deps.brand.agentAuthorId ?? "support-ai"
    });
    const next = await deps.tickets.setStatus(deps.tenantId, proposal.ticketId, "waiting_user");
    if (next) ticket = next;
    notifyEmail(deps.email, ticket, draft, deps.brand.name);
  }
  await refreshTelegramMessage(deps, approved, ticket, {
    doneLabel: draft ? `Done by ${label} \u2014 reply sent` : `Done by ${label} \u2014 approved`,
    clearKeyboard: true
  });
  return {
    ok: true,
    result: draft ? "reply_sent" : "approved",
    proposal: approved,
    ticket,
    message,
    doneLabel: draft ? `Reply sent by ${label}` : `Approved by ${label}`
  };
}

// src/telegram/draftSessions.ts
var DEFAULT_TTL_MS = 30 * 60 * 1e3;
function mapRow(row) {
  return {
    telegramUserId: row.telegram_user_id,
    tenantId: row.tenant_id,
    proposalId: row.proposal_id,
    ticketId: row.ticket_id,
    publicNumber: Number(row.public_number),
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}
var TelegramDraftSessionStore = class {
  constructor(db, tablePrefix = DEFAULT_TABLE_PREFIX) {
    this.db = db;
    this.tablePrefix = tablePrefix;
  }
  db;
  tablePrefix;
  get t() {
    return `${this.tablePrefix}telegram_draft_sessions`;
  }
  async start(telegramUserId, input) {
    const now = /* @__PURE__ */ new Date();
    const expires = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_TTL_MS));
    const createdAt = now.toISOString();
    const expiresAt = expires.toISOString();
    await this.db.run(`DELETE FROM ${this.t} WHERE telegram_user_id = ?`, [String(telegramUserId)]);
    await this.db.run(
      `INSERT INTO ${this.t} (
        telegram_user_id, tenant_id, proposal_id, ticket_id, public_number, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        String(telegramUserId),
        input.tenantId,
        input.proposalId,
        input.ticketId,
        input.publicNumber,
        createdAt,
        expiresAt
      ]
    );
    return {
      telegramUserId: String(telegramUserId),
      tenantId: input.tenantId,
      proposalId: input.proposalId,
      ticketId: input.ticketId,
      publicNumber: input.publicNumber,
      createdAt,
      expiresAt
    };
  }
  async get(telegramUserId) {
    const row = await this.db.get(
      `SELECT * FROM ${this.t} WHERE telegram_user_id = ?`,
      [String(telegramUserId)]
    );
    if (!row) return void 0;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await this.clear(telegramUserId);
      return void 0;
    }
    return mapRow(row);
  }
  async clear(telegramUserId) {
    await this.db.run(`DELETE FROM ${this.t} WHERE telegram_user_id = ?`, [
      String(telegramUserId)
    ]);
  }
};

// src/telegram/webhook.ts
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function parseCallbackData(data) {
  if (!data || !data.startsWith("prop:")) return null;
  const parts = data.split(":");
  if (parts.length < 3) return null;
  return { proposalId: parts[1], action: parts.slice(2).join(":") };
}
function reviewerLabel(from) {
  if (from?.username) return `@${from.username}`;
  if (from?.first_name) return from.first_name;
  return `telegram:${from?.id ?? "unknown"}`;
}
function isAllowed(cfg, userId) {
  if (userId == null) return false;
  if (!cfg.allowedUserIds.length) return false;
  return cfg.allowedUserIds.includes(String(userId));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
function verifyTelegramWebhookSecret(headerSecret, expected) {
  const got = String(headerSecret || "").trim();
  const want = String(expected || "").trim();
  if (!want || !got) return false;
  return timingSafeEqual(got, want);
}
async function getDraftSeed(bodyJson, proposalType) {
  try {
    const b = JSON.parse(bodyJson);
    return String(
      b.draft_reply || b.user_update || b.need_info_message || b.user_intent || b.problem_statement || ""
    );
  } catch {
    return proposalType;
  }
}
async function startDraftReply(deps, cfg, api, proposalId, telegramUserId, from, callbackQueryId) {
  const tablePrefix = deps.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const proposals = new ProposalService(deps.db, tablePrefix);
  const tickets = new TicketService(deps.db, tablePrefix);
  const drafts = new TelegramDraftSessionStore(deps.db, tablePrefix);
  const proposal = await proposals.getProposal(deps.tenantId, proposalId);
  if (!proposal || proposal.status !== "pending_review" && proposal.status !== "needs_info") {
    await api.answerCallback(callbackQueryId, proposal ? `Already ${proposal.status}` : "Not found");
    return;
  }
  const ticket = await tickets.getTicket(deps.tenantId, proposal.ticketId);
  if (!ticket) {
    await api.answerCallback(callbackQueryId, "Ticket not found");
    return;
  }
  const reviewer = reviewerLabel(from);
  await proposals.setClaim(deps.tenantId, proposal.id, reviewer);
  await tickets.setAssignedTo(deps.tenantId, ticket.id, reviewer);
  const claimed = await proposals.getProposal(deps.tenantId, proposal.id) ?? proposal;
  if (claimed.telegramMessageId && claimed.telegramChatId) {
    const proposalView = {
      id: claimed.id,
      proposalType: claimed.proposalType,
      summary: claimed.summary,
      bodyJson: claimed.bodyJson,
      confidence: claimed.confidence ?? null,
      claimedBy: reviewer
    };
    await api.editProposalMessage({
      chatId: claimed.telegramChatId,
      messageId: claimed.telegramMessageId,
      text: api.formatProposalMessage({
        ticketPublicNumber: ticket.publicNumber,
        proposal: proposalView,
        claimLabel: `Claimed by ${reviewer}`
      }),
      replyMarkup: api.proposalKeyboard(proposalView, { claimedBy: reviewer })
    });
  }
  await drafts.start(String(telegramUserId), {
    tenantId: deps.tenantId,
    proposalId: proposal.id,
    ticketId: ticket.id,
    publicNumber: ticket.publicNumber
  });
  const seed = await getDraftSeed(proposal.bodyJson, proposal.proposalType);
  const conf = typeof proposal.confidence === "number" ? `
<b>AI confidence:</b> ${Math.round(proposal.confidence * 100)}%` : "";
  const lines = [
    `\u270F\uFE0F <b>Draft reply</b> \u2014 ticket #${ticket.publicNumber}${conf}`,
    "Reply to this chat with the message the user should see.",
    seed ? `
<b>AI starting point:</b>
${escapeHtml(String(seed).slice(0, 1200))}${String(seed).length > 1200 ? "\u2026" : ""}` : "\nWrite your reply from scratch.",
    "\nSend /cancel to abort."
  ];
  await api.sendForceReply(lines.join("\n"));
  await api.answerCallback(callbackQueryId, "Reply in chat with your draft");
}
async function submitDraft(deps, cfg, api, telegramUserId, from, text) {
  const tablePrefix = deps.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const drafts = new TelegramDraftSessionStore(deps.db, tablePrefix);
  const session = await drafts.get(String(telegramUserId));
  if (!session) return;
  const body = text.trim();
  if (!body) {
    await api.sendText("Reply cannot be empty. Send your message or /cancel.");
    return;
  }
  const proposals = new ProposalService(deps.db, tablePrefix);
  const tickets = new TicketService(deps.db, tablePrefix);
  const reviewer = reviewerLabel(from);
  const result = await executeProposalAction(
    {
      tenantId: deps.tenantId,
      proposals,
      tickets,
      brand: deps.brand,
      telegram: api,
      ...deps.github ? { github: deps.github } : {},
      ...deps.email ? { email: deps.email } : {},
      ...deps.adminBaseUrl ? { adminBaseUrl: deps.adminBaseUrl } : {}
    },
    session.proposalId,
    "edit_send",
    reviewer,
    { draftReply: body }
  );
  await drafts.clear(String(telegramUserId));
  if (!result.ok) {
    await api.sendText(`Could not send reply: ${escapeHtml(result.error)}`);
    return;
  }
  await api.sendText(
    `\u2705 <b>Reply sent</b> to ticket #${session.publicNumber}
${escapeHtml(body.slice(0, 500))}${body.length > 500 ? "\u2026" : ""}`
  );
}
async function cancelDraft(deps, api, telegramUserId, from) {
  const tablePrefix = deps.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const drafts = new TelegramDraftSessionStore(deps.db, tablePrefix);
  const session = await drafts.get(String(telegramUserId));
  if (!session) {
    await api.sendText("No draft in progress.");
    return;
  }
  const proposals = new ProposalService(deps.db, tablePrefix);
  const tickets = new TicketService(deps.db, tablePrefix);
  const proposal = await proposals.getProposal(deps.tenantId, session.proposalId);
  const reviewer = reviewerLabel(from);
  if (proposal?.claimedBy === reviewer || proposal?.claimedBy === `telegram:${telegramUserId}`) {
    await proposals.setClaim(deps.tenantId, session.proposalId, null);
    await tickets.setAssignedTo(deps.tenantId, session.ticketId, null);
    if (proposal.telegramMessageId && proposal.telegramChatId) {
      const ticket = await tickets.getTicket(deps.tenantId, session.ticketId);
      if (ticket) {
        const cleared = {
          id: proposal.id,
          proposalType: proposal.proposalType,
          summary: proposal.summary,
          bodyJson: proposal.bodyJson,
          confidence: proposal.confidence ?? null,
          claimedBy: null
        };
        await api.editProposalMessage({
          chatId: proposal.telegramChatId,
          messageId: proposal.telegramMessageId,
          text: api.formatProposalMessage({
            ticketPublicNumber: ticket.publicNumber,
            proposal: cleared
          }),
          replyMarkup: api.proposalKeyboard(cleared, { claimedBy: null })
        });
      }
    }
  }
  await drafts.clear(String(telegramUserId));
  await api.sendText(`Draft cancelled for ticket #${session.publicNumber}.`);
}
async function handleTelegramUpdate(deps, update) {
  const cfg = await deps.resolveTelegram();
  if (!cfg?.botToken || !cfg.webhookSecret || !cfg.allowedUserIds.length) {
    return { ok: false, handled: false, error: "Telegram ops not configured" };
  }
  const api = deps.createTelegramApi(cfg);
  const tablePrefix = deps.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  if (update.message) {
    const fromId2 = update.message.from?.id;
    if (!isAllowed(cfg, fromId2)) {
      return { ok: false, handled: false, error: "Unauthorized Telegram user" };
    }
    const text = update.message.text?.trim();
    if (!text) return { ok: true, handled: false };
    if (text === "/cancel" || text.toLowerCase() === "cancel") {
      await cancelDraft(deps, api, fromId2, update.message.from);
      return { ok: true, handled: true };
    }
    const drafts2 = new TelegramDraftSessionStore(deps.db, tablePrefix);
    const session = await drafts2.get(String(fromId2));
    if (!session) return { ok: true, handled: false };
    await submitDraft(deps, cfg, api, fromId2, update.message.from, text);
    return { ok: true, handled: true };
  }
  const cb = update.callback_query;
  if (!cb) return { ok: true, handled: false };
  const fromId = cb.from?.id;
  if (!isAllowed(cfg, fromId)) {
    await api.answerCallback(cb.id, "Not authorized");
    return { ok: false, handled: true, error: "Unauthorized Telegram user" };
  }
  const parsed = parseCallbackData(cb.data);
  if (!parsed) {
    await api.answerCallback(cb.id, "Unknown action");
    return { ok: false, handled: true, error: "Invalid callback_data" };
  }
  if (parsed.action === "draft_reply") {
    await startDraftReply(deps, cfg, api, parsed.proposalId, fromId, cb.from, cb.id);
    return { ok: true, handled: true };
  }
  const drafts = new TelegramDraftSessionStore(deps.db, tablePrefix);
  await drafts.clear(String(fromId));
  const proposals = new ProposalService(deps.db, tablePrefix);
  const tickets = new TicketService(deps.db, tablePrefix);
  const reviewer = reviewerLabel(cb.from);
  const result = await executeProposalAction(
    {
      tenantId: deps.tenantId,
      proposals,
      tickets,
      brand: deps.brand,
      telegram: api,
      ...deps.github ? { github: deps.github } : {},
      ...deps.email ? { email: deps.email } : {},
      ...deps.adminBaseUrl ? { adminBaseUrl: deps.adminBaseUrl } : {}
    },
    parsed.proposalId,
    parsed.action,
    reviewer
  );
  if (!result.ok) {
    await api.answerCallback(cb.id, result.error.slice(0, 200));
    return { ok: false, handled: true, error: result.error };
  }
  await api.answerCallback(cb.id, result.doneLabel.slice(0, 200));
  return { ok: true, handled: true };
}

// src/kb/gapResearch.ts
function parseJsonObject(raw) {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned);
}
function truncate(s, max) {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\u2026`;
}
async function researchGapToKbDraft(input) {
  const prefix = input.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const gaps = new KnowledgeGapService(input.db, prefix);
  const gap = await gaps.getKnowledgeGap(input.tenantId, input.gapId);
  if (!gap) {
    return {
      ok: false,
      insufficient: true,
      reason: "Knowledge gap not found",
      citedPaths: []
    };
  }
  const question = (gap.userQuestion || gap.summary || gap.docQuery || "").trim();
  if (!question) {
    return {
      ok: false,
      insufficient: true,
      reason: "Gap has no question text to research",
      citedPaths: []
    };
  }
  const searchHits = await input.codebase.search(question, { limit: 10 });
  const docsHits = input.docsRoot ? searchCuratedDocs(question, { docsRoot: input.docsRoot, limit: 4 }) : [];
  const toRead = searchHits.slice(0, 6);
  const fileContents = [];
  for (const hit of toRead) {
    const body2 = await input.codebase.readFile(hit.path, { maxBytes: 12e3 });
    if (body2?.trim()) {
      fileContents.push({ path: hit.path, body: truncate(body2, 1e4) });
    }
  }
  const corpus = [];
  if (input.codebase.label) {
    corpus.push(`Codebase: ${input.codebase.label}`);
  }
  for (const hit of searchHits) {
    corpus.push(`### Search hit: ${hit.path}
${hit.snippet}`);
  }
  for (const f of fileContents) {
    corpus.push(`### File: ${f.path}
\`\`\`
${f.body}
\`\`\``);
  }
  for (const d of docsHits) {
    corpus.push(`### Doc: ${d.source}
${truncate(d.excerpt || "", 2e3)}`);
  }
  if (corpus.length < 2) {
    return {
      ok: false,
      insufficient: true,
      reason: "No relevant code or docs found for this question",
      citedPaths: []
    };
  }
  const system = `You are a knowledge-base writer for ${input.brand.name} support (${input.brand.supportAgentName}).
Given a user support question and excerpts from the product codebase/docs, draft a concise help article.

Rules:
- Use ONLY the provided excerpts. Do not invent Stripe keys, secrets, or unverified product behavior.
- If excerpts are insufficient, set insufficient=true and explain what is missing.
- Output ONLY valid JSON (no markdown fences):
{
  "insufficient": false,
  "title": "short help title",
  "body": "markdown article for support agents/users",
  "confidence": 0.0-1.0,
  "cited_paths": ["path1", "path2"],
  "reason": null
}
When insufficient=true: title/body may be empty; reason required.`;
  const user = [
    `User question:
${question}`,
    gap.summary ? `Gap summary:
${gap.summary}` : "",
    "",
    "Excerpts:",
    corpus.join("\n\n")
  ].filter(Boolean).join("\n");
  let parsed;
  try {
    const raw = await input.llm.complete({ system, user, temperature: 0.2 });
    parsed = parseJsonObject(raw);
  } catch (err) {
    return {
      ok: false,
      insufficient: true,
      reason: err instanceof Error ? err.message : "LLM failed to draft article",
      citedPaths: searchHits.map((h) => h.path)
    };
  }
  const insufficient = Boolean(parsed.insufficient);
  const citedPaths = Array.isArray(parsed.cited_paths) ? parsed.cited_paths.map((p) => String(p)).filter(Boolean) : searchHits.slice(0, 5).map((h) => h.path);
  if (insufficient) {
    return {
      ok: false,
      insufficient: true,
      reason: String(parsed.reason || "Insufficient codebase evidence to draft a reliable answer"),
      citedPaths
    };
  }
  const title = String(parsed.title || "").trim() || `Help: ${question.slice(0, 80)}`;
  let body = String(parsed.body || "").trim();
  if (!body) {
    return {
      ok: false,
      insufficient: true,
      reason: "Model returned an empty article body",
      citedPaths
    };
  }
  if (citedPaths.length) {
    body += `

---
Sources:
${citedPaths.map((p) => `- \`${p}\``).join("\n")}`;
  }
  const confidence = typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence) ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5;
  const article = await ingestCodegenArticle(input.db, {
    tenantId: input.tenantId,
    title,
    body,
    sourceKey: `code_research:gap:${gap.id}`,
    sourceKind: "code_research",
    path: `gap/${gap.id}`,
    tablePrefix: prefix
  });
  const provenance = JSON.stringify({
    gapId: gap.id,
    ticketId: gap.ticketId,
    confidence,
    citedPaths,
    codebase: input.codebase.label ?? null,
    researchedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  await input.db.run(
    `UPDATE ${prefix}kb_articles SET provenance_json = ?, updated_at = ? WHERE id = ?`,
    [provenance, (/* @__PURE__ */ new Date()).toISOString(), article.id]
  );
  const refreshed = {
    ...article,
    provenanceJson: provenance
  };
  return {
    ok: true,
    article: refreshed,
    confidence,
    citedPaths,
    insufficient: false
  };
}
async function curateAnswerToKbDraft(input) {
  const prefix = input.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const system = `You curate support answers into clean knowledge-base articles for ${input.brand.name}.
Output ONLY valid JSON:
{ "title": "...", "body": "markdown article" }
Keep facts from the raw answer; improve structure and clarity. Do not invent new product claims.`;
  const user = [
    input.userQuestion ? `Original question:
${input.userQuestion}` : "",
    `Raw answer from ops/support:
${input.rawAnswer}`
  ].filter(Boolean).join("\n\n");
  let title = input.title?.trim() || "Support answer";
  let body = input.rawAnswer.trim();
  try {
    const raw = await input.llm.complete({ system, user, temperature: 0.2 });
    const parsed = parseJsonObject(raw);
    if (typeof parsed.title === "string" && parsed.title.trim()) title = parsed.title.trim();
    if (typeof parsed.body === "string" && parsed.body.trim()) body = parsed.body.trim();
  } catch {
  }
  return ingestCodegenArticle(input.db, {
    tenantId: input.tenantId,
    title,
    body,
    sourceKey: input.sourceKey,
    sourceKind: "evolutionary",
    tablePrefix: prefix
  });
}

// src/agent/featureCoach.ts
var PRIORITIES = /* @__PURE__ */ new Set([
  "nice_to_have",
  "important",
  "critical"
]);
function buildSystemPrompt2(brand) {
  const agent = brand.supportAgentName || "Support";
  const hint = brand.featureCoachSystemHint?.trim();
  return `You help users refine ${brand.name} feature requests before formal submission.
You are ${agent}. Be concise and friendly.
Output ONLY valid JSON (no markdown fences):
{
  "reply": "friendly chat message to the user (1-3 short paragraphs max)",
  "ready_to_submit": false,
  "draft": {
    "problem": "clear problem statement",
    "solution": "proposed solution or empty string",
    "priority": "nice_to_have|important|critical",
    "subject": "short title"
  }
}

Ask clarifying questions: who is affected, current workaround, expected outcome, priority.
Set ready_to_submit true only when the problem is specific enough for engineering review.
Keep draft fields updated as the conversation progresses.${hint ? `

Host product guidance:
${hint}` : ""}`;
}
function formatCoachThread(messages) {
  return messages.map((m) => `${m.role === "user" ? "User" : "Coach"}: ${m.body}`).join("\n\n");
}
function normalizePriority(raw) {
  const v = String(raw ?? "");
  return PRIORITIES.has(v) ? v : "nice_to_have";
}
function parseLlmJson2(raw) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("Coach LLM returned non-JSON");
  }
}
function fallbackFromMessages(messages) {
  const userTexts = messages.filter((m) => m.role === "user").map((m) => m.body.trim()).filter(Boolean);
  const problem = userTexts.join("\n\n") || "";
  const ready = userTexts.length >= 1;
  return {
    ok: true,
    mode: "fallback",
    reply: ready ? "Thanks \u2014 review the draft below and submit when it looks right, or add more detail." : "Describe the problem you want solved and any ideas you have \u2014 when you are ready, submit the request.",
    readyToSubmit: ready,
    draft: {
      problem,
      solution: "",
      priority: "nice_to_have",
      subject: problem.slice(0, 120)
    }
  };
}
async function coachFeatureRequest(input) {
  const messages = (input.messages ?? []).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    body: String(m.body ?? "").trim().slice(0, 4e3)
  })).filter((m) => m.body.length > 0).slice(-24);
  if (!input.llm) {
    return fallbackFromMessages(messages);
  }
  let system = buildSystemPrompt2(input.brand);
  if (input.userContextSummary?.trim()) {
    system += `

User context (host-provided, treat as ground truth):
${input.userContextSummary.trim().slice(0, 4e3)}`;
  }
  try {
    const raw = await input.llm.complete({
      system,
      user: `Conversation so far:
${formatCoachThread(messages) || "(empty)"}

Respond as JSON.`,
      temperature: 0.3
    });
    const parsed = parseLlmJson2(raw);
    const draftObj = parsed.draft && typeof parsed.draft === "object" ? parsed.draft : {};
    const problem = String(draftObj.problem ?? "").slice(0, 4e3);
    const solution = String(draftObj.solution ?? "").slice(0, 4e3);
    const subject = String(draftObj.subject || problem || "Feature request").slice(
      0,
      200
    );
    const reply = String(
      parsed.reply || "Tell me more about the problem you want to solve."
    ).slice(0, 4e3);
    return {
      ok: true,
      mode: "llm",
      reply,
      readyToSubmit: Boolean(parsed.ready_to_submit),
      draft: {
        problem,
        solution,
        priority: normalizePriority(draftObj.priority),
        subject
      }
    };
  } catch (err) {
    const fb = fallbackFromMessages(messages);
    return {
      ...fb,
      ok: false,
      error: err instanceof Error ? err.message : "Coach unavailable",
      reply: "I couldn't reach the AI coach just now. You can still describe the problem and submit \u2014 or try again."
    };
  }
}

// src/http/createRouter.ts
function parsePath(url) {
  const raw = url.split("?")[0] ?? url;
  return raw.endsWith("/") && raw.length > 1 ? raw.slice(0, -1) : raw;
}
function parseQueryString(url) {
  const qs = url.includes("?") ? url.split("?")[1] : "";
  const params = new URLSearchParams(qs);
  const out = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}
function requireAdmin(user) {
  return user.role === "admin" || user.role === "ops";
}
function header(req, name) {
  const headers = req.headers ?? {};
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}
function matchRoute(method, path2) {
  if (method === "GET" && path2 === "/health") return { name: "health", params: {} };
  if (method === "GET" && path2 === "/config") return { name: "config", params: {} };
  if (method === "POST" && path2 === "/chat") return { name: "chat", params: {} };
  if (method === "POST" && path2 === "/coach") return { name: "coach", params: {} };
  if (method === "GET" && path2 === "/tickets") return { name: "listTickets", params: {} };
  if (method === "POST" && path2 === "/tickets") return { name: "createTicket", params: {} };
  const ticketReply = path2.match(/^\/tickets\/([^/]+)\/messages$/);
  if (method === "POST" && ticketReply) {
    return { name: "replyTicket", params: { id: ticketReply[1] } };
  }
  const ticketMatch = path2.match(/^\/tickets\/([^/]+)$/);
  if (method === "GET" && ticketMatch) {
    return { name: "getTicket", params: { id: ticketMatch[1] } };
  }
  if (method === "GET" && path2 === "/help/articles") {
    return { name: "publicHelp", params: {} };
  }
  if (method === "GET" && path2 === "/admin/tickets") {
    return { name: "adminListTickets", params: {} };
  }
  if (method === "GET" && path2 === "/admin/proposals") {
    return { name: "adminListProposals", params: {} };
  }
  if (method === "GET" && path2 === "/admin/kb") {
    return { name: "adminListKb", params: {} };
  }
  if (method === "GET" && path2 === "/admin/gaps") {
    return { name: "adminListGaps", params: {} };
  }
  if (method === "POST" && path2 === "/admin/kb/ingest") {
    return { name: "adminKbIngest", params: {} };
  }
  if (method === "POST" && path2 === "/telegram/webhook") {
    return { name: "telegramWebhook", params: {} };
  }
  const adminKbPromote = path2.match(/^\/admin\/kb\/([^/]+)\/promote$/);
  if (method === "POST" && adminKbPromote) {
    return { name: "adminKbPromote", params: { id: adminKbPromote[1] } };
  }
  const adminKbDeprecate = path2.match(/^\/admin\/kb\/([^/]+)\/deprecate$/);
  if (method === "POST" && adminKbDeprecate) {
    return { name: "adminKbDeprecate", params: { id: adminKbDeprecate[1] } };
  }
  const adminKbPatch = path2.match(/^\/admin\/kb\/([^/]+)$/);
  if (method === "PATCH" && adminKbPatch) {
    return { name: "adminKbPatch", params: { id: adminKbPatch[1] } };
  }
  if (method === "GET" && adminKbPatch) {
    return { name: "adminKbGet", params: { id: adminKbPatch[1] } };
  }
  const adminGapPatch = path2.match(/^\/admin\/gaps\/([^/]+)$/);
  if (method === "PATCH" && adminGapPatch) {
    return { name: "adminGapPatch", params: { id: adminGapPatch[1] } };
  }
  const adminGapResearch = path2.match(/^\/admin\/gaps\/([^/]+)\/research$/);
  if (method === "POST" && adminGapResearch) {
    return { name: "adminGapResearch", params: { id: adminGapResearch[1] } };
  }
  const adminTicketReply = path2.match(/^\/admin\/tickets\/([^/]+)\/reply$/);
  if (method === "POST" && adminTicketReply) {
    return { name: "adminReplyTicket", params: { idOrNumber: adminTicketReply[1] } };
  }
  const adminTicketStatus = path2.match(/^\/admin\/tickets\/([^/]+)\/status$/);
  if (method === "PATCH" && adminTicketStatus) {
    return { name: "adminSetTicketStatus", params: { idOrNumber: adminTicketStatus[1] } };
  }
  const adminTicketPromoteKb = path2.match(/^\/admin\/tickets\/([^/]+)\/promote-kb$/);
  if (method === "POST" && adminTicketPromoteKb) {
    return { name: "adminPromoteKb", params: { idOrNumber: adminTicketPromoteKb[1] } };
  }
  const adminTicketDetail = path2.match(/^\/admin\/tickets\/([^/]+)$/);
  if (method === "GET" && adminTicketDetail) {
    return { name: "adminGetTicket", params: { idOrNumber: adminTicketDetail[1] } };
  }
  const adminProposalAction = path2.match(/^\/admin\/proposals\/([^/]+)\/action$/);
  if (method === "POST" && adminProposalAction) {
    return { name: "adminProposalAction", params: { id: adminProposalAction[1] } };
  }
  return null;
}
function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(payload);
}
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return void 0;
  return JSON.parse(raw);
}
function notifyEmail2(email, ticket, body, brandName) {
  if (!email) return;
  let to = ticket.guestEmail ?? void 0;
  if (!to && ticket.contextJson) {
    try {
      const ctx = JSON.parse(ticket.contextJson);
      to = ctx.email ?? void 0;
    } catch {
    }
  }
  if (!to) return;
  email.sendToUser({
    to,
    subject: `${brandName} support \u2014 ticket #${ticket.publicNumber}`,
    body,
    ticketPublicNumber: ticket.publicNumber
  }).catch(() => {
  });
}
function createHttpRouter(ctx) {
  const tablePrefix = ctx.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const topics = ctx.topics ?? [...DEFAULT_TOPICS2];
  let ready = null;
  const ensureReady = () => {
    if (!ready) ready = ensureSchema(ctx.db, tablePrefix);
    return ready;
  };
  const handler = async (req, res, _next) => {
    await ensureReady();
    const r = req;
    const response = res;
    const method = String(r.method ?? "GET").toUpperCase();
    const path2 = parsePath(String(r.url ?? r.path ?? "/"));
    const route = matchRoute(method, path2);
    const finish = (status, body) => {
      if (typeof response.status === "function" && typeof response.json === "function") {
        response.status(status).json(body);
        return;
      }
      sendJson(response, status, body);
    };
    if (!route) {
      finish(404, { ok: false, error: "Not found" });
      return;
    }
    if (route.name === "health") {
      finish(200, {
        ok: true,
        kit: "support-kit",
        tenantId: ctx.tenantId,
        brand: ctx.brand.name
      });
      return;
    }
    if (route.name === "telegramWebhook") {
      if (!ctx.telegram) {
        finish(404, { ok: false, error: "Telegram webhook not configured" });
        return;
      }
      const cfg = await ctx.telegram.resolveConfig();
      if (!cfg?.webhookSecret || !cfg.allowedUserIds.length) {
        finish(503, { ok: false, error: "Telegram webhook not ready" });
        return;
      }
      const secretHeader = header(r, "x-telegram-bot-api-secret-token");
      if (!verifyTelegramWebhookSecret(secretHeader, cfg.webhookSecret)) {
        finish(401, { ok: false, error: "Unauthorized" });
        return;
      }
      const body = r.body !== void 0 ? r.body : await readJsonBody(r);
      finish(200, { ok: true });
      const webhookDeps = {
        tenantId: ctx.tenantId,
        db: ctx.db,
        brand: ctx.brand,
        tablePrefix,
        resolveTelegram: ctx.telegram.resolveConfig,
        createTelegramApi: ctx.telegram.createClient,
        ...ctx.github ? { github: ctx.github } : {},
        ...ctx.email ? { email: ctx.email } : {},
        ...ctx.opsNotifier ? { opsNotifier: ctx.opsNotifier } : {},
        ...ctx.adminBaseUrl ? { adminBaseUrl: ctx.adminBaseUrl } : {}
      };
      void handleTelegramUpdate(webhookDeps, body).catch((err) => {
        console.error("[support-kit] telegram webhook error:", err);
      });
      return;
    }
    if (route.name === "adminKbIngest") {
      const secret = ctx.kbIngest?.webhookSecret;
      const token = header(r, "x-support-ingest-token");
      const user2 = await ctx.resolveUser(req);
      const authed = secret && token && token === secret || user2 && requireAdmin(user2);
      if (!authed) {
        finish(401, { ok: false, error: "Unauthorized" });
        return;
      }
      const body = r.body !== void 0 ? r.body : await readJsonBody(r);
      const articles = [];
      if (body?.changelog) {
        const changelogOpts = { tablePrefix };
        if (body.gitSha) changelogOpts.gitSha = body.gitSha;
        articles.push(
          ...await ingestFromChangelog(ctx.db, ctx.tenantId, body.changelog, changelogOpts)
        );
      }
      if (body?.sources?.length) {
        const docsOpts = { tablePrefix };
        if (body.gitSha) docsOpts.gitSha = body.gitSha;
        articles.push(
          ...await ingestDocsSources(ctx.db, ctx.tenantId, body.sources, docsOpts)
        );
      }
      if (articles.length > 0 && ctx.opsNotifier) {
        ctx.opsNotifier.sendToOps({
          kind: "kb_drafts_ready",
          title: `${articles.length} KB draft(s) from ${body.gitSha ?? "ingest"}`,
          body: articles.map((a) => a.title).slice(0, 8).join(", ")
        }).catch(() => {
        });
      }
      finish(200, { ok: true, articles, count: articles.length });
      return;
    }
    const user = await ctx.resolveUser(req);
    const tickets = new TicketService(ctx.db, tablePrefix);
    const proposals = new ProposalService(ctx.db, tablePrefix);
    const gaps = new KnowledgeGapService(ctx.db, tablePrefix);
    const readBody = async () => {
      if (r.body !== void 0) return r.body;
      if (typeof r.on === "function") {
        return readJsonBody(r);
      }
      return void 0;
    };
    try {
      if (route.name === "config") {
        finish(200, {
          ok: true,
          topics,
          kinds: ["support", "bug", "feature"],
          brand: ctx.brand,
          coachEnabled: Boolean(ctx.llm),
          guestTickets: true
        });
        return;
      }
      if (route.name === "publicHelp") {
        const articles = await listKbArticles(ctx.db, ctx.tenantId, {
          status: "active",
          tablePrefix,
          limit: 100
        });
        finish(200, {
          ok: true,
          articles: articles.filter((a) => a.visibility === "public")
        });
        return;
      }
      if (route.name === "coach") {
        const body = await readBody();
        const kind = String(body?.kind ?? "feature_request");
        if (kind !== "feature_request" && kind !== "feature") {
          finish(400, { ok: false, error: "Only feature coaching is supported" });
          return;
        }
        const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
        const messages = rawMessages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          body: String(m.body ?? "")
        })).filter((m) => m.body.trim());
        const coachInput = {
          messages,
          brand: ctx.brand
        };
        if (ctx.llm) coachInput.llm = ctx.llm;
        if (user?.contextSummary) coachInput.userContextSummary = user.contextSummary;
        const result = await coachFeatureRequest(coachInput);
        finish(200, {
          ok: result.ok,
          reply: result.reply,
          readyToSubmit: result.readyToSubmit,
          draft: result.draft,
          mode: result.mode,
          ...result.error ? { error: result.error } : {}
        });
        return;
      }
      if (route.name === "createTicket" && !user) {
        const body = await readBody();
        const input = body;
        const ticketBody = String(input.body ?? "").trim();
        const guestEmail = String(input.guestEmail ?? "").trim();
        if (!ticketBody) {
          finish(400, { ok: false, error: "body is required" });
          return;
        }
        if (!guestEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) {
          finish(401, {
            ok: false,
            error: "Sign in or provide guestEmail to create a ticket"
          });
          return;
        }
        const kindParsed = TicketKindSchema.safeParse(input.kind ?? "support");
        const created = await tickets.createTicket({
          tenantId: ctx.tenantId,
          body: ticketBody,
          kind: kindParsed.success ? kindParsed.data : "support",
          topic: input.topic ?? "other",
          subject: input.subject,
          userId: `guest:${guestEmail}`,
          guestEmail,
          severity: input.severity,
          priority: input.priority,
          contextJson: input.contextJson,
          status: "pending_ops"
        });
        if (created.ticket.kind === "bug" || created.ticket.kind === "feature") {
          await proposals.createProposal({
            tenantId: ctx.tenantId,
            ticketId: created.ticket.id,
            proposalType: created.ticket.kind === "bug" ? "bug_fix" : "feature",
            summary: created.ticket.subject || `${created.ticket.kind} ticket`,
            bodyJson: JSON.stringify({
              draft_reply: "Thanks \u2014 we've logged this and will follow up in this thread.",
              github_title: created.ticket.subject,
              github_body: ticketBody,
              kind: created.ticket.kind,
              severity: created.ticket.severity,
              priority: created.ticket.priority
            }),
            confidence: 0.5
          });
        }
        finish(201, { ok: true, ...created });
        return;
      }
      if (!user) {
        finish(401, { ok: false, error: "Unauthorized" });
        return;
      }
      if (route.name === "chat") {
        const body = await readBody();
        const message = String(body?.message ?? "").trim();
        if (!message) {
          finish(400, { ok: false, error: "message is required" });
          return;
        }
        const kindRaw = body?.kind;
        const kindParsed = kindRaw ? TicketKindSchema.safeParse(kindRaw) : null;
        const topic = String(body?.topic ?? "").trim() || void 0;
        const triageDeps = {
          db: ctx.db,
          brand: ctx.brand,
          tablePrefix,
          topics
        };
        if (ctx.llm) triageDeps.llm = ctx.llm;
        if (ctx.docsRoot) triageDeps.docsRoot = ctx.docsRoot;
        if (ctx.opsNotifier) triageDeps.opsNotifier = ctx.opsNotifier;
        if (ctx.adminBaseUrl) triageDeps.adminBaseUrl = ctx.adminBaseUrl;
        if (ctx.sensitiveTopics) triageDeps.sensitiveTopics = ctx.sensitiveTopics;
        if (ctx.autoReplyMinConfidence !== void 0) {
          triageDeps.autoReplyMinConfidence = ctx.autoReplyMinConfidence;
        }
        const result = await triageMessage(triageDeps, {
          tenantId: ctx.tenantId,
          user,
          message,
          ...kindParsed?.success ? { kind: kindParsed.data } : {},
          ...topic ? { topic } : {}
        });
        finish(200, { ok: true, ...result });
        return;
      }
      if (route.name === "listTickets") {
        const list = await tickets.listTickets(ctx.tenantId, { limit: 100 });
        const scoped = user.role === "admin" || user.role === "ops" ? list : list.filter((t) => t.userId === user.id);
        finish(200, { ok: true, tickets: scoped });
        return;
      }
      if (route.name === "createTicket") {
        const body = await readBody();
        const input = body;
        const ticketBody = String(input.body ?? "").trim();
        if (!ticketBody) {
          finish(400, { ok: false, error: "body is required" });
          return;
        }
        const kindParsed = TicketKindSchema.safeParse(input.kind ?? "support");
        const created = await tickets.createTicket({
          tenantId: ctx.tenantId,
          body: ticketBody,
          kind: kindParsed.success ? kindParsed.data : "support",
          topic: input.topic ?? "other",
          subject: input.subject,
          userId: user.id,
          orgId: user.orgId ?? input.orgId,
          guestEmail: input.guestEmail,
          severity: input.severity,
          priority: input.priority,
          contextJson: input.contextJson,
          status: "pending_ops"
        });
        if (created.ticket.kind === "bug" || created.ticket.kind === "feature") {
          await proposals.createProposal({
            tenantId: ctx.tenantId,
            ticketId: created.ticket.id,
            proposalType: created.ticket.kind === "bug" ? "bug_fix" : "feature",
            summary: created.ticket.subject || `${created.ticket.kind} ticket`,
            bodyJson: JSON.stringify({
              draft_reply: "Thanks \u2014 we've logged this and will follow up in this thread.",
              github_title: created.ticket.subject,
              github_body: ticketBody,
              kind: created.ticket.kind,
              severity: created.ticket.severity,
              priority: created.ticket.priority
            }),
            confidence: 0.5
          });
        }
        finish(201, { ok: true, ...created });
        return;
      }
      if (route.name === "replyTicket") {
        const ticket = await tickets.getTicket(ctx.tenantId, route.params.id);
        if (!ticket) {
          finish(404, { ok: false, error: "Ticket not found" });
          return;
        }
        if (user.role !== "admin" && user.role !== "ops" && ticket.userId !== user.id) {
          finish(403, { ok: false, error: "Forbidden" });
          return;
        }
        if (ticket.status === "closed") {
          finish(400, { ok: false, error: "Ticket is closed" });
          return;
        }
        const body = await readBody();
        const replyBody = String(body?.body ?? "").trim();
        if (!replyBody) {
          finish(400, { ok: false, error: "body is required" });
          return;
        }
        const message = await tickets.addMessage(ctx.tenantId, ticket.id, replyBody, {
          authorType: "user",
          authorId: user.id
        });
        let updated = ticket;
        if (ticket.status === "waiting_user" || ticket.status === "pending_user" || ticket.status === "resolved") {
          const next = await tickets.setStatus(ctx.tenantId, ticket.id, "pending_ops");
          if (next) updated = next;
        }
        if ((updated.status === "escalated" || updated.status === "pending_ops") && ctx.opsNotifier) {
          ctx.opsNotifier.sendToOps({
            kind: "user_reply",
            title: `User reply \u2014 ticket #${ticket.publicNumber}`,
            body: replyBody.slice(0, 500),
            ticketPublicNumber: ticket.publicNumber
          }).catch(() => {
          });
        }
        finish(200, { ok: true, ticket: updated, message });
        return;
      }
      if (route.name === "getTicket") {
        const ticket = await tickets.getTicket(ctx.tenantId, route.params.id);
        if (!ticket) {
          finish(404, { ok: false, error: "Ticket not found" });
          return;
        }
        if (user.role !== "admin" && user.role !== "ops" && ticket.userId !== user.id) {
          finish(403, { ok: false, error: "Forbidden" });
          return;
        }
        const messages = await tickets.listMessages(ctx.tenantId, ticket.id);
        finish(200, { ok: true, ticket, messages });
        return;
      }
      if (route.name.startsWith("admin")) {
        if (!requireAdmin(user)) {
          finish(403, { ok: false, error: "Forbidden" });
          return;
        }
        if (route.name === "adminListTickets") {
          const query = parseQueryString(String(r.url ?? ""));
          const statusFilter = query.status?.trim() || void 0;
          const kindFilter = query.kind?.trim() || void 0;
          const topicFilter = query.topic?.trim() || void 0;
          const allTickets = await tickets.listTickets(ctx.tenantId, { limit: 200 });
          const pendingProposals = await proposals.listProposals(ctx.tenantId, {
            status: "pending_review",
            limit: 500
          });
          const ticketIdsWithPending = new Set(pendingProposals.map((p) => p.ticketId));
          const counts = {
            open: 0,
            ai_working: 0,
            pending_ops: 0,
            waiting_user: 0,
            pending_user: 0,
            escalated: 0,
            resolved: 0,
            closed: 0,
            pending_review_proposals: pendingProposals.length,
            support: 0,
            bug: 0,
            feature: 0
          };
          for (const t of allTickets) {
            const key = String(t.status);
            if (Object.prototype.hasOwnProperty.call(counts, key)) {
              const cur = counts[key] ?? 0;
              counts[key] = cur + 1;
            }
            if (t.kind === "support") counts.support += 1;
            if (t.kind === "bug") counts.bug += 1;
            if (t.kind === "feature") counts.feature += 1;
          }
          let scoped = allTickets;
          if (statusFilter === "pending_review" || statusFilter === "attention") {
            scoped = allTickets.filter(
              (t) => t.status === "pending_ops" || t.status === "escalated" || ticketIdsWithPending.has(t.id)
            );
          } else if (statusFilter) {
            scoped = allTickets.filter((t) => t.status === statusFilter);
          }
          if (kindFilter) scoped = scoped.filter((t) => t.kind === kindFilter);
          if (topicFilter) scoped = scoped.filter((t) => t.topic === topicFilter);
          scoped = [...scoped].sort((a, b) => {
            const score = (t) => {
              let s = 0;
              if (t.status === "escalated") s += 100;
              if (t.kind === "bug" && t.severity === "critical") s += 80;
              if (t.kind === "bug" && t.severity === "high") s += 50;
              if (ticketIdsWithPending.has(t.id)) s += 20;
              if (t.status === "pending_ops") s += 10;
              return s;
            };
            return score(b) - score(a);
          });
          const enriched = scoped.map((t) => ({
            ...t,
            hasPendingProposal: ticketIdsWithPending.has(t.id)
          }));
          finish(200, { ok: true, tickets: enriched, counts });
          return;
        }
        if (route.name === "adminGetTicket") {
          const ticket = await tickets.getTicketByIdOrNumber(
            ctx.tenantId,
            route.params.idOrNumber
          );
          if (!ticket) {
            finish(404, { ok: false, error: "Ticket not found" });
            return;
          }
          const messages = await tickets.listMessages(ctx.tenantId, ticket.id);
          const ticketProposals = await proposals.listProposalsForTicket(
            ctx.tenantId,
            ticket.id
          );
          finish(200, { ok: true, ticket, messages, proposals: ticketProposals });
          return;
        }
        if (route.name === "adminReplyTicket") {
          const ticket = await tickets.getTicketByIdOrNumber(
            ctx.tenantId,
            route.params.idOrNumber
          );
          if (!ticket) {
            finish(404, { ok: false, error: "Ticket not found" });
            return;
          }
          const body = await readBody();
          const replyBody = String(body?.body ?? "").trim();
          if (!replyBody) {
            finish(400, { ok: false, error: "body is required" });
            return;
          }
          const message = await tickets.addMessage(ctx.tenantId, ticket.id, replyBody, {
            authorType: "staff",
            authorId: user.id
          });
          let updated = ticket;
          if (ticket.status === "pending_ops" || ticket.status === "open" || ticket.status === "escalated" || ticket.status === "ai_working") {
            const next = await tickets.setStatus(ctx.tenantId, ticket.id, "waiting_user");
            if (next) updated = next;
          }
          notifyEmail2(ctx.email, updated, replyBody, ctx.brand.name);
          finish(200, { ok: true, ticket: updated, message });
          return;
        }
        if (route.name === "adminSetTicketStatus") {
          const ticket = await tickets.getTicketByIdOrNumber(
            ctx.tenantId,
            route.params.idOrNumber
          );
          if (!ticket) {
            finish(404, { ok: false, error: "Ticket not found" });
            return;
          }
          const body = await readBody();
          const parsed = TicketStatusSchema.safeParse(body?.status);
          if (!parsed.success) {
            finish(400, { ok: false, error: "Invalid status" });
            return;
          }
          const updated = await tickets.setStatus(ctx.tenantId, ticket.id, parsed.data);
          finish(200, { ok: true, ticket: updated });
          return;
        }
        if (route.name === "adminPromoteKb") {
          const ticket = await tickets.getTicketByIdOrNumber(
            ctx.tenantId,
            route.params.idOrNumber
          );
          if (!ticket) {
            finish(404, { ok: false, error: "Ticket not found" });
            return;
          }
          const body = await readBody();
          const activate = Boolean(body?.activate);
          const title = String(body?.title ?? "").trim();
          let articleBody = String(body?.body ?? "").trim();
          const curate = body?.curate !== false;
          if (!articleBody && ctx.llm && curate) {
            const messages = await tickets.listMessages(ctx.tenantId, ticket.id);
            const answer = [...messages].reverse().find(
              (m) => m.authorType === "assistant" || m.authorType === "staff" || m.authorType === "agent" || m.authorType === "ops"
            );
            const userQ = messages.find((m) => m.authorType === "user");
            if (answer?.body) {
              const curated = await curateAnswerToKbDraft({
                db: ctx.db,
                tenantId: ctx.tenantId,
                llm: ctx.llm,
                brand: ctx.brand,
                rawAnswer: answer.body,
                sourceKey: `evolutionary:ticket:${ticket.id}`,
                tablePrefix,
                ...title ? { title } : {},
                ...userQ?.body ? { userQuestion: userQ.body } : {}
              });
              if (activate) {
                const promoted = await promoteKbArticle(
                  ctx.db,
                  ctx.tenantId,
                  curated.id,
                  tablePrefix
                );
                finish(200, { ok: true, article: promoted, curated: true });
                return;
              }
              finish(200, { ok: true, article: curated, curated: true });
              return;
            }
          }
          const promoteInput = {
            tenantId: ctx.tenantId,
            ticketId: ticket.id,
            tablePrefix,
            activate
          };
          if (title) promoteInput.title = title;
          if (articleBody) promoteInput.body = articleBody;
          const article = await promoteTicketAnswerToKb(ctx.db, promoteInput);
          finish(200, { ok: true, article, curated: false });
          return;
        }
        if (route.name === "adminListProposals") {
          const query = parseQueryString(String(r.url ?? ""));
          const status = query.status?.trim() || "pending_review";
          const list = await proposals.listProposals(ctx.tenantId, { status, limit: 100 });
          finish(200, { ok: true, proposals: list });
          return;
        }
        if (route.name === "adminListKb") {
          const query = parseQueryString(String(r.url ?? ""));
          const status = query.status;
          const sourceKind = query.sourceKind?.trim() || void 0;
          const listOpts = { tablePrefix, limit: 200 };
          if (status) listOpts.status = status;
          if (sourceKind) listOpts.sourceKind = sourceKind;
          const articles = await listKbArticles(ctx.db, ctx.tenantId, listOpts);
          finish(200, { ok: true, articles });
          return;
        }
        if (route.name === "adminKbGet") {
          const article = await getKbArticle(ctx.db, ctx.tenantId, route.params.id, tablePrefix);
          if (!article) {
            finish(404, { ok: false, error: "Article not found" });
            return;
          }
          finish(200, { ok: true, article });
          return;
        }
        if (route.name === "adminKbPromote") {
          const body = await readBody();
          const visibility = body?.visibility;
          const article = await promoteKbArticle(
            ctx.db,
            ctx.tenantId,
            route.params.id,
            tablePrefix,
            visibility ? { visibility } : void 0
          );
          finish(200, { ok: true, article });
          return;
        }
        if (route.name === "adminKbDeprecate") {
          const article = await deprecateKbArticle(
            ctx.db,
            ctx.tenantId,
            route.params.id,
            tablePrefix
          );
          finish(200, { ok: true, article });
          return;
        }
        if (route.name === "adminKbPatch") {
          const body = await readBody();
          const patch = {};
          const title = body?.title;
          const articleBody = body?.body;
          const visibility = body?.visibility;
          if (title !== void 0) patch.title = title;
          if (articleBody !== void 0) patch.body = articleBody;
          if (visibility !== void 0) patch.visibility = visibility;
          const article = await updateKbArticle(
            ctx.db,
            ctx.tenantId,
            route.params.id,
            patch,
            tablePrefix
          );
          finish(200, { ok: true, article });
          return;
        }
        if (route.name === "adminListGaps") {
          const list = await gaps.listKnowledgeGaps(ctx.tenantId, {
            status: "open",
            limit: 100
          });
          finish(200, { ok: true, gaps: list });
          return;
        }
        if (route.name === "adminGapPatch") {
          const body = await readBody();
          const status = String(body?.status ?? "").trim();
          if (!["resolved", "dismissed", "open"].includes(status)) {
            finish(400, { ok: false, error: "Invalid status" });
            return;
          }
          const gap = await gaps.patchKnowledgeGap(
            ctx.tenantId,
            route.params.id,
            status
          );
          finish(200, { ok: true, gap });
          return;
        }
        if (route.name === "adminGapResearch") {
          if (!ctx.llm) {
            finish(400, { ok: false, error: "LLM not configured for gap research" });
            return;
          }
          if (!ctx.codebase) {
            finish(400, {
              ok: false,
              error: "Codebase adapter not configured (host must pass codebase)"
            });
            return;
          }
          const result = await researchGapToKbDraft({
            db: ctx.db,
            tenantId: ctx.tenantId,
            gapId: route.params.id,
            llm: ctx.llm,
            codebase: ctx.codebase,
            brand: ctx.brand,
            tablePrefix,
            ...ctx.docsRoot ? { docsRoot: ctx.docsRoot } : {}
          });
          if (!result.ok) {
            finish(422, {
              ok: false,
              insufficient: true,
              error: result.reason,
              citedPaths: result.citedPaths
            });
            return;
          }
          if (ctx.opsNotifier) {
            ctx.opsNotifier.sendToOps({
              kind: "kb_drafts_ready",
              title: `KB draft from codebase research`,
              body: result.article.title
            }).catch(() => {
            });
          }
          finish(200, {
            ok: true,
            article: result.article,
            confidence: result.confidence,
            citedPaths: result.citedPaths
          });
          return;
        }
        if (route.name === "adminProposalAction") {
          const body = await readBody();
          const action = String(body?.action ?? "").trim();
          const allowed = [
            "approve",
            "reject",
            "send_reply",
            "take_over",
            "need_info",
            "edit_send",
            "claim",
            "steal",
            "release"
          ];
          if (!allowed.includes(action)) {
            finish(400, { ok: false, error: "Invalid action" });
            return;
          }
          const telegramEditor = ctx.telegram != null ? await (async () => {
            const cfg = await ctx.telegram.resolveConfig();
            if (!cfg) return void 0;
            return ctx.telegram.createClient(cfg);
          })() : void 0;
          const result = await executeProposalAction(
            {
              tenantId: ctx.tenantId,
              proposals,
              tickets,
              brand: ctx.brand,
              ...ctx.github ? { github: ctx.github } : {},
              ...ctx.email ? { email: ctx.email } : {},
              ...telegramEditor ? { telegram: telegramEditor } : {},
              ...ctx.adminBaseUrl ? { adminBaseUrl: ctx.adminBaseUrl } : {}
            },
            route.params.id,
            action,
            user.id,
            {
              draftReply: String(body?.draft_reply ?? ""),
              needInfoMessage: String(body?.message ?? "")
            }
          );
          if (!result.ok) {
            finish(result.status, {
              ok: false,
              error: result.error,
              handledBy: result.handledBy,
              proposal: result.proposal
            });
            return;
          }
          finish(200, {
            ok: true,
            proposal: result.proposal,
            ticket: result.ticket,
            message: result.message,
            result: result.result,
            tookOver: result.result === "escalated"
          });
          return;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      finish(500, { ok: false, error: message });
    }
  };
  return {
    handler,
    meta: {
      kitVersion: KIT_VERSION,
      tenantId: String(ctx.tenantId),
      shared: "@rhule/support-shared"
    }
  };
}
function createRouter(options) {
  const ctx = {
    tenantId: String(options.tenantId),
    db: options.db,
    resolveUser: options.resolveUser,
    brand: options.brand
  };
  if (options.llm) ctx.llm = options.llm;
  if (options.tablePrefix) ctx.tablePrefix = options.tablePrefix;
  if (options.docsRoot) ctx.docsRoot = options.docsRoot;
  if (options.opsNotifier) ctx.opsNotifier = options.opsNotifier;
  if (options.adminBaseUrl) ctx.adminBaseUrl = options.adminBaseUrl;
  if (options.topics) ctx.topics = options.topics;
  if (options.sensitiveTopics) ctx.sensitiveTopics = options.sensitiveTopics;
  if (options.autoReplyMinConfidence !== void 0) {
    ctx.autoReplyMinConfidence = options.autoReplyMinConfidence;
  }
  if (options.github) ctx.github = options.github;
  if (options.email) ctx.email = options.email;
  if (options.kbIngest) ctx.kbIngest = options.kbIngest;
  if (options.telegram) ctx.telegram = options.telegram;
  if (options.codebase) ctx.codebase = options.codebase;
  return createHttpRouter(ctx);
}

// src/kb/filesystemCodebase.ts
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve, sep } from "path";
var DEFAULT_SKIP_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".data",
  "vendor",
  ".turbo",
  "tmp",
  ".tmp"
]);
var TEXT_EXT = /* @__PURE__ */ new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".md",
  ".mdx",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".css",
  ".sql",
  ".txt"
]);
function isTextPath(path2) {
  const lower = path2.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_EXT.has(lower.slice(dot));
}
function tokenize2(query) {
  return query.toLowerCase().split(/[^a-z0-9_]+/g).map((t) => t.trim()).filter((t) => t.length >= 3).slice(0, 12);
}
function walkFiles(absDir, root, skip, out, maxFiles) {
  if (out.length >= maxFiles) return;
  let entries;
  try {
    entries = readdirSync(absDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (out.length >= maxFiles) return;
    if (skip.has(name)) continue;
    const abs = join(absDir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkFiles(abs, root, skip, out, maxFiles);
    } else if (st.isFile() && isTextPath(abs) && st.size > 0 && st.size < 5e5) {
      out.push(abs);
    }
  }
}
function scoreFile(content, tokens) {
  const lower = content.toLowerCase();
  let score = 0;
  let bestIdx = -1;
  for (const t of tokens) {
    let idx = lower.indexOf(t);
    let count = 0;
    while (idx !== -1 && count < 8) {
      score += 1;
      if (bestIdx < 0) bestIdx = idx;
      count += 1;
      idx = lower.indexOf(t, idx + t.length);
    }
  }
  if (score === 0) return { score: 0, snippet: "" };
  const start = Math.max(0, bestIdx - 120);
  const snippet = content.slice(start, start + 420).replace(/\s+/g, " ").trim();
  return { score, snippet };
}
function createFilesystemCodebaseAdapter(options) {
  const root = resolve(options.root);
  const allowAbs = options.allowlist.map((p) => resolve(root, p));
  const skip = /* @__PURE__ */ new Set([...options.skipDirs ?? [], ...DEFAULT_SKIP_DIRS]);
  const maxFiles = options.maxFilesWalk ?? 2500;
  function isAllowed2(absPath) {
    const resolved = resolve(absPath);
    if (!resolved.startsWith(root + sep) && resolved !== root) return false;
    return allowAbs.some((a) => resolved === a || resolved.startsWith(a + sep));
  }
  return {
    ...options.label ? { label: options.label } : {},
    async search(query, opts) {
      const limit = Math.min(Math.max(opts?.limit ?? 10, 1), 30);
      const tokens = tokenize2(query);
      if (!tokens.length) return [];
      const files = [];
      for (const dir of allowAbs) {
        if (!existsSync(dir)) continue;
        const st = statSync(dir);
        if (st.isFile()) {
          if (isTextPath(dir)) files.push(dir);
          continue;
        }
        walkFiles(dir, root, skip, files, maxFiles);
      }
      const hits = [];
      for (const abs of files) {
        let content;
        try {
          content = readFileSync(abs, "utf8");
        } catch {
          continue;
        }
        const { score, snippet } = scoreFile(content, tokens);
        if (score <= 0 || !snippet) continue;
        const rel = relative(root, abs).split(sep).join("/");
        hits.push({ path: rel, snippet, score, _score: score });
      }
      hits.sort((a, b) => b._score - a._score);
      return hits.slice(0, limit).map(({ path: path2, snippet, _score }) => ({
        path: path2,
        snippet,
        score: _score
      }));
    },
    async readFile(path2, opts) {
      const abs = resolve(root, path2);
      if (!isAllowed2(abs)) return null;
      if (!existsSync(abs)) return null;
      try {
        const st = statSync(abs);
        if (!st.isFile()) return null;
        const max = opts?.maxBytes ?? 2e4;
        if (st.size <= max) {
          return readFileSync(abs, "utf8");
        }
        const chunks = [];
        const fd = createReadStream(abs, { start: 0, end: max - 1 });
        await new Promise((resolveP, reject) => {
          fd.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          fd.on("end", () => resolveP());
          fd.on("error", reject);
        });
        return Buffer.concat(chunks).toString("utf8");
      } catch {
        return null;
      }
    }
  };
}

// src/index.ts
function createSupportRouter(options) {
  const tenantId = String(options.tenantId);
  if (!tenantId) {
    throw new Error("createSupportRouter: tenantId is required");
  }
  if (!options.db) {
    throw new Error("createSupportRouter: db adapter is required");
  }
  if (!options.resolveUser) {
    throw new Error("createSupportRouter: resolveUser is required");
  }
  if (!options.brand?.name) {
    throw new Error("createSupportRouter: brand.name is required");
  }
  const router = createRouter(options);
  return {
    handler: router.handler,
    meta: { kitVersion: KIT_VERSION2, tenantId, shared: SHARED }
  };
}
export {
  DEFAULT_ESCALATION_REPLY,
  DEFAULT_HOLD_REPLY,
  DEFAULT_TABLE_PREFIX,
  KIT_VERSION2 as KIT_VERSION,
  KnowledgeGapService,
  KnowledgeGapStore,
  ProposalService,
  ProposalStore,
  TelegramDraftSessionStore,
  TicketService,
  TicketStore,
  clearDocsCache,
  coachFeatureRequest,
  containsEscalationSignal,
  createFilesystemCodebaseAdapter,
  createHttpRouter,
  createRouter,
  createSupportRouter,
  curateAnswerToKbDraft,
  decideFromHeuristics,
  decideFromLlm,
  deprecateKbArticle,
  ensureSchema,
  executeGithubFromProposal,
  executeProposalAction,
  formatSourcesForPrompt,
  getKbArticle,
  handleTelegramUpdate,
  inferKindTopic,
  ingestCodegenArticle,
  ingestDocsSources,
  ingestFromChangelog,
  listKbArticles,
  parseBugFeatureBody,
  promoteKbArticle,
  promoteTicketAnswerToKb,
  researchGapToKbDraft,
  searchActiveArticles,
  searchCuratedDocs,
  triageMessage,
  updateKbArticle,
  verifyTelegramWebhookSecret
};
