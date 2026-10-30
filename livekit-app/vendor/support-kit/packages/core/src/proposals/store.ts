import { randomUUID } from "node:crypto";
import type { Proposal, ProposalStatus, ProposalType } from "@rhule/support-shared";
import type { DbAdapter } from "../adapters/types.js";
import { DEFAULT_TABLE_PREFIX } from "../db/migrate.js";

type ProposalRow = {
  id: string;
  tenant_id: string;
  ticket_id: string;
  proposal_type: string;
  status: string;
  summary: string;
  body_json: string;
  confidence: number | null;
  telegram_message_id: string | null;
  telegram_chat_id: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  execution_status: string | null;
  execution_ref: string | null;
  created_at: string;
};

function mapProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    tenantId: row.tenant_id as Proposal["tenantId"],
    ticketId: row.ticket_id,
    proposalType: row.proposal_type as Proposal["proposalType"],
    status: row.status as Proposal["status"],
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
    createdAt: row.created_at,
  };
}

export class ProposalStore {
  constructor(
    private readonly db: DbAdapter,
    private readonly tablePrefix: string = DEFAULT_TABLE_PREFIX,
  ) {}

  private get p() {
    return `${this.tablePrefix}proposals`;
  }

  async create(input: {
    tenantId: string;
    ticketId: string;
    proposalType: ProposalType;
    summary: string;
    bodyJson: string;
    confidence?: number | null;
    status?: ProposalStatus;
  }): Promise<Proposal> {
    const id = randomUUID();
    const now = new Date().toISOString();
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
        now,
      ],
    );

    const proposal = await this.getById(input.tenantId, id);
    if (!proposal) {
      throw new Error("ProposalStore.create: failed to reload row");
    }
    return proposal;
  }

  async getById(tenantId: string, id: string): Promise<Proposal | undefined> {
    const row = await this.db.get<ProposalRow>(
      `SELECT * FROM ${this.p} WHERE tenant_id = ? AND id = ?`,
      [tenantId, id],
    );
    return row ? mapProposal(row) : undefined;
  }

  async listByTenant(
    tenantId: string,
    opts?: { status?: ProposalStatus; limit?: number },
  ): Promise<Proposal[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    const params: unknown[] = [tenantId];
    let where = "WHERE tenant_id = ?";
    if (opts?.status) {
      where += " AND status = ?";
      params.push(opts.status);
    }
    params.push(limit);
    const rows = await this.db.all<ProposalRow>(
      `SELECT * FROM ${this.p} ${where} ORDER BY created_at DESC LIMIT ?`,
      params,
    );
    return rows.map(mapProposal);
  }

  async listForTicket(tenantId: string, ticketId: string): Promise<Proposal[]> {
    const rows = await this.db.all<ProposalRow>(
      `SELECT * FROM ${this.p} WHERE tenant_id = ? AND ticket_id = ? ORDER BY created_at DESC`,
      [tenantId, ticketId],
    );
    return rows.map(mapProposal);
  }

  async getActivePendingForTicket(
    tenantId: string,
    ticketId: string,
  ): Promise<Proposal | undefined> {
    const row = await this.db.get<ProposalRow>(
      `SELECT * FROM ${this.p}
       WHERE tenant_id = ? AND ticket_id = ? AND status = 'pending_review'
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId, ticketId],
    );
    return row ? mapProposal(row) : undefined;
  }

  async updateStatus(
    tenantId: string,
    id: string,
    status: ProposalStatus,
    fields?: {
      reviewedBy?: string | null;
      reviewedAt?: string | null;
      telegramMessageId?: string | null;
      telegramChatId?: string | null;
      claimedBy?: string | null;
      claimedAt?: string | null;
      executionStatus?: string | null;
      executionRef?: string | null;
    },
  ): Promise<Proposal | undefined> {
    const sets = ["status = ?"];
    const params: unknown[] = [status];

    if (fields?.reviewedBy !== undefined) {
      sets.push("reviewed_by = ?");
      params.push(fields.reviewedBy);
    }
    if (fields?.reviewedAt !== undefined) {
      sets.push("reviewed_at = ?");
      params.push(fields.reviewedAt);
    }
    if (fields?.telegramMessageId !== undefined) {
      sets.push("telegram_message_id = ?");
      params.push(fields.telegramMessageId);
    }
    if (fields?.telegramChatId !== undefined) {
      sets.push("telegram_chat_id = ?");
      params.push(fields.telegramChatId);
    }
    if (fields?.claimedBy !== undefined) {
      sets.push("claimed_by = ?");
      params.push(fields.claimedBy);
    }
    if (fields?.claimedAt !== undefined) {
      sets.push("claimed_at = ?");
      params.push(fields.claimedAt);
    }
    if (fields?.executionStatus !== undefined) {
      sets.push("execution_status = ?");
      params.push(fields.executionStatus);
    }
    if (fields?.executionRef !== undefined) {
      sets.push("execution_ref = ?");
      params.push(fields.executionRef);
    }

    params.push(tenantId, id);
    await this.db.run(
      `UPDATE ${this.p} SET ${sets.join(", ")} WHERE tenant_id = ? AND id = ?`,
      params,
    );
    return this.getById(tenantId, id);
  }

  /**
   * Atomic transition: only succeeds if current status is in `fromStatuses`.
   * Returns updated proposal or undefined if lost the race.
   */
  async tryAtomicTransition(
    tenantId: string,
    id: string,
    fromStatuses: ProposalStatus[],
    nextStatus: ProposalStatus,
    fields: {
      reviewedBy: string;
      reviewedAt: string;
      executionStatus?: string | null;
      executionRef?: string | null;
    },
  ): Promise<Proposal | undefined> {
    if (fromStatuses.length === 0) return undefined;
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
        ...fromStatuses,
      ],
    );
    if ((result.changes ?? 0) < 1) return undefined;
    return this.getById(tenantId, id);
  }

  async setTelegramMeta(
    tenantId: string,
    id: string,
    meta: { telegramMessageId: string; telegramChatId: string },
  ): Promise<Proposal | undefined> {
    await this.db.run(
      `UPDATE ${this.p}
       SET telegram_message_id = ?, telegram_chat_id = ?
       WHERE tenant_id = ? AND id = ?`,
      [meta.telegramMessageId, meta.telegramChatId, tenantId, id],
    );
    return this.getById(tenantId, id);
  }

  async setClaim(
    tenantId: string,
    id: string,
    claimedBy: string | null,
  ): Promise<Proposal | undefined> {
    const now = claimedBy ? new Date().toISOString() : null;
    await this.db.run(
      `UPDATE ${this.p} SET claimed_by = ?, claimed_at = ? WHERE tenant_id = ? AND id = ?`,
      [claimedBy, now, tenantId, id],
    );
    return this.getById(tenantId, id);
  }
}
