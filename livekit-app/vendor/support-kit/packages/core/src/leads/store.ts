import { randomUUID } from "node:crypto";
import type { CreateLeadInput, Lead } from "@rhule/support-shared";
import type { DbAdapter } from "../adapters/types.js";
import { DEFAULT_TABLE_PREFIX } from "../db/migrate.js";

type LeadRow = {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  phone: string | null;
  marketing_email_opt_in: number;
  marketing_sms_opt_in: number;
  source: string;
  consent_text: string | null;
  consent_at: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
};

function mapLead(row: LeadRow): Lead {
  return {
    id: row.id,
    tenantId: row.tenant_id as Lead["tenantId"],
    email: row.email,
    name: row.name,
    phone: row.phone,
    marketingEmailOptIn: Boolean(row.marketing_email_opt_in),
    marketingSmsOptIn: Boolean(row.marketing_sms_opt_in),
    source: row.source,
    consentText: row.consent_text,
    consentAt: row.consent_at,
    ipHash: row.ip_hash,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class LeadStore {
  constructor(
    private readonly db: DbAdapter,
    private readonly tablePrefix: string = DEFAULT_TABLE_PREFIX,
  ) {}

  private get t() {
    return `${this.tablePrefix}leads`;
  }

  async getById(tenantId: string, id: string): Promise<Lead | undefined> {
    const row = await this.db.get<LeadRow>(
      `SELECT * FROM ${this.t} WHERE tenant_id = ? AND id = ?`,
      [tenantId, id],
    );
    return row ? mapLead(row) : undefined;
  }

  async getByEmail(tenantId: string, email: string): Promise<Lead | undefined> {
    const row = await this.db.get<LeadRow>(
      `SELECT * FROM ${this.t} WHERE tenant_id = ? AND email = ?`,
      [tenantId, email.toLowerCase()],
    );
    return row ? mapLead(row) : undefined;
  }

  /**
   * Insert or update by (tenant_id, email). Re-submitting the gate refreshes
   * name/phone/consent so ops always see the latest opt-in state.
   */
  async upsert(input: CreateLeadInput & {
    marketingEmailOptIn: boolean;
    marketingSmsOptIn: boolean;
  }): Promise<Lead> {
    const now = new Date().toISOString();
    const email = input.email.trim().toLowerCase();
    const existing = await this.getByEmail(input.tenantId, email);
    const phone = input.phone?.trim() || null;
    const consentAt = now;

    if (existing) {
      await this.db.run(
        `UPDATE ${this.t} SET
          name = ?, phone = ?,
          marketing_email_opt_in = ?, marketing_sms_opt_in = ?,
          source = ?, consent_text = ?, consent_at = ?,
          ip_hash = COALESCE(?, ip_hash),
          user_agent = COALESCE(?, user_agent),
          updated_at = ?
         WHERE tenant_id = ? AND id = ?`,
        [
          input.name.trim(),
          phone,
          input.marketingEmailOptIn ? 1 : 0,
          input.marketingSmsOptIn ? 1 : 0,
          input.source,
          input.consentText ?? null,
          consentAt,
          input.ipHash ?? null,
          input.userAgent ?? null,
          now,
          input.tenantId,
          existing.id,
        ],
      );
      const updated = await this.getById(input.tenantId, existing.id);
      if (!updated) throw new Error("Lead upsert failed");
      return updated;
    }

    const id = randomUUID();
    await this.db.run(
      `INSERT INTO ${this.t} (
        id, tenant_id, email, name, phone,
        marketing_email_opt_in, marketing_sms_opt_in,
        source, consent_text, consent_at, ip_hash, user_agent,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.tenantId,
        email,
        input.name.trim(),
        phone,
        input.marketingEmailOptIn ? 1 : 0,
        input.marketingSmsOptIn ? 1 : 0,
        input.source,
        input.consentText ?? null,
        consentAt,
        input.ipHash ?? null,
        input.userAgent ?? null,
        now,
        now,
      ],
    );
    const created = await this.getById(input.tenantId, id);
    if (!created) throw new Error("Lead insert failed");
    return created;
  }

  async list(
    tenantId: string,
    opts?: { marketingOnly?: boolean; limit?: number },
  ): Promise<Lead[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
    const rows = opts?.marketingOnly
      ? await this.db.all<LeadRow>(
          `SELECT * FROM ${this.t}
           WHERE tenant_id = ? AND marketing_email_opt_in = 1
           ORDER BY updated_at DESC LIMIT ?`,
          [tenantId, limit],
        )
      : await this.db.all<LeadRow>(
          `SELECT * FROM ${this.t}
           WHERE tenant_id = ?
           ORDER BY updated_at DESC LIMIT ?`,
          [tenantId, limit],
        );
    return rows.map(mapLead);
  }
}
