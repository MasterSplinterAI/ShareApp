import { randomUUID } from "node:crypto";
import type { GapStatus, KnowledgeGap, ProposalType } from "@rhule/support-shared";
import type { DbAdapter } from "../adapters/types.js";
import { DEFAULT_TABLE_PREFIX } from "../db/migrate.js";

type GapRow = {
  id: string;
  tenant_id: string;
  ticket_id: string;
  public_number: number | null;
  user_question: string;
  escalation_reason: string | null;
  doc_query: string | null;
  doc_hits_json: string | null;
  proposal_id: string | null;
  proposal_type: string | null;
  summary: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
};

function mapGap(row: GapRow): KnowledgeGap {
  return {
    id: row.id,
    tenantId: row.tenant_id as KnowledgeGap["tenantId"],
    ticketId: row.ticket_id,
    publicNumber: row.public_number,
    userQuestion: row.user_question,
    escalationReason: row.escalation_reason,
    docQuery: row.doc_query,
    docHitsJson: row.doc_hits_json,
    proposalId: row.proposal_id,
    proposalType: row.proposal_type as KnowledgeGap["proposalType"],
    summary: row.summary,
    status: row.status as KnowledgeGap["status"],
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export class KnowledgeGapStore {
  constructor(
    private readonly db: DbAdapter,
    private readonly tablePrefix: string = DEFAULT_TABLE_PREFIX,
  ) {}

  private get g() {
    return `${this.tablePrefix}knowledge_gaps`;
  }

  private get t() {
    return `${this.tablePrefix}tickets`;
  }

  private get m() {
    return `${this.tablePrefix}messages`;
  }

  async getLastUserQuestion(tenantId: string, ticketId: string): Promise<string | null> {
    const row = await this.db.get<{ body: string }>(
      `SELECT body FROM ${this.m}
       WHERE tenant_id = ? AND ticket_id = ? AND author_type = 'user'
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId, ticketId],
    );
    return row?.body ?? null;
  }

  async record(input: {
    tenantId: string;
    ticketId: string;
    proposalId?: string | null;
    proposalType?: ProposalType | null;
    summary?: string | null;
    escalationReason?: string | null;
    docQuery?: string | null;
    docHitsJson?: string | null;
    userQuestion?: string | null;
  }): Promise<KnowledgeGap> {
    const ticket = await this.db.get<{ public_number: number }>(
      `SELECT public_number FROM ${this.t} WHERE tenant_id = ? AND id = ?`,
      [input.tenantId, input.ticketId],
    );

    const lastQuestion = await this.getLastUserQuestion(input.tenantId, input.ticketId);
    const userQuestion = String(
      input.userQuestion ?? lastQuestion ?? input.summary ?? "",
    ).slice(0, 4000);

    const id = randomUUID();
    const now = new Date().toISOString();

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
        input.escalationReason ? String(input.escalationReason).slice(0, 2000) : null,
        input.docQuery ? String(input.docQuery).slice(0, 2000) : null,
        input.docHitsJson ?? "[]",
        input.proposalId ?? null,
        input.proposalType ?? null,
        input.summary ? String(input.summary).slice(0, 500) : null,
        now,
      ],
    );

    const gap = await this.getById(input.tenantId, id);
    if (!gap) {
      throw new Error("KnowledgeGapStore.record: failed to reload row");
    }
    return gap;
  }

  async getById(tenantId: string, id: string): Promise<KnowledgeGap | undefined> {
    const row = await this.db.get<GapRow>(
      `SELECT * FROM ${this.g} WHERE tenant_id = ? AND id = ?`,
      [tenantId, id],
    );
    return row ? mapGap(row) : undefined;
  }

  async listByTenant(
    tenantId: string,
    opts?: { status?: GapStatus; limit?: number },
  ): Promise<KnowledgeGap[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
    const params: unknown[] = [tenantId];
    let where = "WHERE tenant_id = ?";
    if (opts?.status) {
      where += " AND status = ?";
      params.push(opts.status);
    }
    params.push(limit);
    const rows = await this.db.all<GapRow>(
      `SELECT * FROM ${this.g} ${where} ORDER BY created_at DESC LIMIT ?`,
      params,
    );
    return rows.map(mapGap);
  }

  async updateStatus(
    tenantId: string,
    id: string,
    status: GapStatus,
  ): Promise<KnowledgeGap | undefined> {
    const now = new Date().toISOString();
    const resolvedAt = status === "resolved" || status === "dismissed" ? now : null;
    await this.db.run(
      `UPDATE ${this.g} SET status = ?, resolved_at = ? WHERE tenant_id = ? AND id = ?`,
      [status, resolvedAt, tenantId, id],
    );
    return this.getById(tenantId, id);
  }
}
