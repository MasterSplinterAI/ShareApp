import { randomUUID } from "node:crypto";
import type { DbAdapter } from "../adapters/types.js";
import { DEFAULT_TABLE_PREFIX } from "../db/migrate.js";

/** A registered business tenant on the hosted support platform. */
export interface Tenant {
  id: string;
  name: string;
  domain: string | null;
  /** SHA-256 of the per-tenant ingest token (plaintext returned once, at creation). */
  ingestTokenHash: string | null;
  createdAt: string;
  updatedAt: string;
}

type TenantRow = {
  id: string;
  name: string;
  domain: string | null;
  ingest_token_hash: string | null;
  created_at: string;
  updated_at: string;
};

function mapTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    ingestTokenHash: row.ingest_token_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateTenantInput {
  name: string;
  domain?: string;
  /** Plaintext ingest token; stored as SHA-256. */
  ingestToken?: string;
}

export class TenantStore {
  constructor(
    private readonly db: DbAdapter,
    private readonly tablePrefix: string = DEFAULT_TABLE_PREFIX,
  ) {}

  private get t() {
    return `${this.tablePrefix}tenants`;
  }

  async getById(id: string): Promise<Tenant | undefined> {
    const row = await this.db.get<TenantRow>(
      `SELECT * FROM ${this.t} WHERE id = ?`,
      [id],
    );
    return row ? mapTenant(row) : undefined;
  }

  async getByDomain(domain: string): Promise<Tenant | undefined> {
    const row = await this.db.get<TenantRow>(
      `SELECT * FROM ${this.t} WHERE lower(domain) = ?`,
      [domain.toLowerCase()],
    );
    return row ? mapTenant(row) : undefined;
  }

  async list(opts?: { limit?: number }): Promise<Tenant[]> {
    const limit = opts?.limit ?? 100;
    const rows = await this.db.all<TenantRow>(
      `SELECT * FROM ${this.t} ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
    return rows.map(mapTenant);
  }

  /**
   * Create a tenant. Returns the tenant plus the plaintext ingest token
   * (only shown once; only the hash is persisted).
   */
  async create(input: CreateTenantInput): Promise<{ tenant: Tenant; ingestToken: string }> {
    const name = input.name.trim();
    if (!name) throw new Error("tenant name is required");
    const domain = input.domain?.trim().toLowerCase() || null;
    const ingestToken =
      (input.ingestToken ?? "").trim() || `sk_live_${randomUUID().replace(/-/g, "").slice(0, 32)}`;

    const hash = await hashToken(ingestToken);
    const now = new Date().toISOString();
    const id = randomUUID();
    await this.db.run(
      `INSERT INTO ${this.t} (id, name, domain, ingest_token_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name, domain, hash, now, now],
    );
    return {
      tenant: {
        id,
        name,
        domain,
        ingestTokenHash: hash,
        createdAt: now,
        updatedAt: now,
      },
      ingestToken,
    };
  }

  async update(
    id: string,
    patch: { name?: string; domain?: string | null },
  ): Promise<Tenant> {
    const tenant = await this.getById(id);
    if (!tenant) throw new Error(`tenant ${id} not found`);
    const now = new Date().toISOString();
    const next: Tenant = {
      ...tenant,
      name: patch.name?.trim() || tenant.name,
      domain: patch.domain === undefined ? tenant.domain : (patch.domain?.trim().toLowerCase() ?? null),
      updatedAt: now,
    };
    await this.db.run(
      `UPDATE ${this.t} SET name = ?, domain = ?, updated_at = ? WHERE id = ?`,
      [next.name, next.domain, now, id],
    );
    return next;
  }

  async remove(id: string): Promise<boolean> {
    const changes = await this.db.run(`DELETE FROM ${this.t} WHERE id = ?`, [id]);
    return changes.changes > 0;
  }
}

async function hashToken(token: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(token).digest("hex");
}
