import { randomUUID } from "node:crypto";
import type {
  CreateTicketInput,
  Ticket,
  TicketKind,
  TicketMessage,
  TicketStatus,
} from "@rhule/support-shared";
import {
  mapKindTopicToCategory,
  normalizeAuthorType,
  normalizeTicketStatus,
} from "@rhule/support-shared";
import type { DbAdapter } from "../adapters/types.js";
import { DEFAULT_TABLE_PREFIX } from "../db/migrate.js";

type TicketRow = {
  id: string;
  tenant_id: string;
  public_number: number;
  kind: string | null;
  topic: string | null;
  category: string;
  status: string;
  subject: string | null;
  severity: string | null;
  priority: string | null;
  user_id: string | null;
  org_id: string | null;
  guest_email: string | null;
  context_json: string | null;
  duplicate_of_ticket_id: string | null;
  assigned_to: string | null;
  github_issue_url: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

type MessageRow = {
  id: string;
  tenant_id: string;
  ticket_id: string;
  author_type: string;
  author_id: string | null;
  body: string;
  attachments_json: string | null;
  citation_json: string | null;
  created_at: string;
};

function mapTicket(row: TicketRow): Ticket {
  const kind = (row.kind ?? "support") as TicketKind;
  const topic = row.topic ?? "other";
  const category =
    (row.category as Ticket["category"]) ?? mapKindTopicToCategory(kind, topic);
  return {
    id: row.id,
    tenantId: row.tenant_id as Ticket["tenantId"],
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
    closedAt: row.closed_at,
  };
}

function mapMessage(row: MessageRow): TicketMessage {
  return {
    id: row.id,
    tenantId: row.tenant_id as TicketMessage["tenantId"],
    ticketId: row.ticket_id,
    authorType: row.author_type as TicketMessage["authorType"],
    authorId: row.author_id,
    body: row.body,
    attachmentsJson: row.attachments_json,
    citationJson: row.citation_json,
    createdAt: row.created_at,
  };
}

export class TicketStore {
  constructor(
    private readonly db: DbAdapter,
    private readonly tablePrefix: string = DEFAULT_TABLE_PREFIX,
  ) {}

  private get t() {
    return `${this.tablePrefix}tickets`;
  }

  private get m() {
    return `${this.tablePrefix}messages`;
  }

  async nextPublicNumber(tenantId: string): Promise<number> {
    const row = await this.db.get<{ max: number | null }>(
      `SELECT MAX(public_number) AS max FROM ${this.t} WHERE tenant_id = ?`,
      [tenantId],
    );
    return (row?.max ?? 0) + 1;
  }

  async create(input: CreateTicketInput): Promise<{ ticket: Ticket; message: TicketMessage }> {
    const tenantId = String(input.tenantId);
    const id = randomUUID();
    const messageId = randomUUID();
    const now = new Date().toISOString();
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
        now,
      ],
    );

    await this.db.run(
      `INSERT INTO ${this.m} (
        id, tenant_id, ticket_id, author_type, author_id, body, created_at
      ) VALUES (?, ?, ?, 'user', ?, ?, ?)`,
      [messageId, tenantId, id, input.userId ?? null, input.body, now],
    );

    const ticket = await this.getById(tenantId, id);
    const message = await this.getMessage(tenantId, messageId);
    if (!ticket || !message) {
      throw new Error("TicketStore.create: failed to reload row");
    }
    return { ticket, message };
  }

  async getById(tenantId: string, id: string): Promise<Ticket | undefined> {
    const row = await this.db.get<TicketRow>(
      `SELECT * FROM ${this.t} WHERE tenant_id = ? AND id = ?`,
      [tenantId, id],
    );
    return row ? mapTicket(row) : undefined;
  }

  async getByPublicNumber(tenantId: string, publicNumber: number): Promise<Ticket | undefined> {
    const row = await this.db.get<TicketRow>(
      `SELECT * FROM ${this.t} WHERE tenant_id = ? AND public_number = ?`,
      [tenantId, publicNumber],
    );
    return row ? mapTicket(row) : undefined;
  }

  async listByTenant(
    tenantId: string,
    opts?: {
      limit?: number;
      kind?: TicketKind;
      topic?: string;
      status?: TicketStatus;
      userId?: string;
    },
  ): Promise<Ticket[]> {
    const limit = opts?.limit ?? 50;
    const clauses = ["tenant_id = ?"];
    const params: unknown[] = [tenantId];
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
    const rows = await this.db.all<TicketRow>(
      `SELECT * FROM ${this.t} WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
      params,
    );
    return rows.map(mapTicket);
  }

  async listMessages(tenantId: string, ticketId: string): Promise<TicketMessage[]> {
    const rows = await this.db.all<MessageRow>(
      `SELECT * FROM ${this.m} WHERE tenant_id = ? AND ticket_id = ? ORDER BY created_at ASC`,
      [tenantId, ticketId],
    );
    return rows.map(mapMessage);
  }

  async getMessage(tenantId: string, messageId: string): Promise<TicketMessage | undefined> {
    const row = await this.db.get<MessageRow>(
      `SELECT * FROM ${this.m} WHERE tenant_id = ? AND id = ?`,
      [tenantId, messageId],
    );
    return row ? mapMessage(row) : undefined;
  }

  async updateStatus(
    tenantId: string,
    ticketId: string,
    status: TicketStatus,
  ): Promise<Ticket | undefined> {
    const now = new Date().toISOString();
    const normalized = normalizeTicketStatus(status);
    const closedAt = normalized === "closed" || normalized === "resolved" ? now : null;
    await this.db.run(
      `UPDATE ${this.t}
       SET status = ?, updated_at = ?, closed_at = COALESCE(?, closed_at)
       WHERE tenant_id = ? AND id = ?`,
      [normalized, now, closedAt, tenantId, ticketId],
    );
    return this.getById(tenantId, ticketId);
  }

  async updateGithubUrl(
    tenantId: string,
    ticketId: string,
    githubIssueUrl: string,
  ): Promise<Ticket | undefined> {
    const now = new Date().toISOString();
    await this.db.run(
      `UPDATE ${this.t} SET github_issue_url = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`,
      [githubIssueUrl, now, tenantId, ticketId],
    );
    return this.getById(tenantId, ticketId);
  }

  async updateAssignedTo(
    tenantId: string,
    ticketId: string,
    assignedTo: string | null,
  ): Promise<Ticket | undefined> {
    const now = new Date().toISOString();
    await this.db.run(
      `UPDATE ${this.t} SET assigned_to = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`,
      [assignedTo, now, tenantId, ticketId],
    );
    return this.getById(tenantId, ticketId);
  }

  async addMessage(input: {
    tenantId: string;
    ticketId: string;
    authorType: TicketMessage["authorType"];
    authorId?: string | null;
    body: string;
    citationJson?: string | null;
  }): Promise<TicketMessage> {
    const id = randomUUID();
    const now = new Date().toISOString();
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
        now,
      ],
    );
    await this.db.run(
      `UPDATE ${this.t} SET updated_at = ? WHERE tenant_id = ? AND id = ?`,
      [now, input.tenantId, input.ticketId],
    );
    const msg = await this.getMessage(input.tenantId, id);
    if (!msg) throw new Error("TicketStore.addMessage: failed to reload");
    return msg;
  }
}
