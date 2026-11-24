import { randomUUID } from "node:crypto";
import type { DbAdapter } from "../adapters/types.js";
import { DEFAULT_TABLE_PREFIX } from "../db/migrate.js";

/** Per-tenant brand stored in support_tenants.brand_json. */
export interface TenantBrand {
  name: string;
  accent?: string;
  supportAgentName?: string;
  signupUrl?: string;
  contactEmail?: string;
}

/** A registered business tenant on the hosted support platform. */
export interface Tenant {
  id: string;
  name: string;
  domain: string | null;
  /** SHA-256 of the per-tenant ingest token (plaintext returned once, at creation). */
  ingestTokenHash: string | null;
  brand: TenantBrand | null;
  createdAt: string;
  updatedAt: string;
}

type TenantRow = {
  id: string;
  name: string;
  domain: string | null;
  ingest_token_hash: string | null;
  brand_json: string | null;
  created_at: string;
  updated_at: string;
};

function parseBrandJson(raw: string | null, tenantName: string): TenantBrand | null {
  if (!raw?.trim()) {
    return { name: tenantName };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<TenantBrand>;
    const name = (parsed.name ?? tenantName).trim() || tenantName;
    const brand: TenantBrand = { name };
    if (parsed.accent?.trim()) brand.accent = parsed.accent.trim();
    if (parsed.supportAgentName?.trim()) brand.supportAgentName = parsed.supportAgentName.trim();
    if (parsed.signupUrl?.trim()) brand.signupUrl = parsed.signupUrl.trim();
    if (parsed.contactEmail?.trim()) brand.contactEmail = parsed.contactEmail.trim();
    return brand;
  } catch {
    return { name: tenantName };
  }
}

function serializeBrand(brand: TenantBrand | null | undefined, tenantName: string): string {
  const next = brand ?? { name: tenantName };
  const payload: TenantBrand = {
    name: (next.name ?? tenantName).trim() || tenantName,
  };
  if (next.accent?.trim()) payload.accent = next.accent.trim();
  if (next.supportAgentName?.trim()) payload.supportAgentName = next.supportAgentName.trim();
  if (next.signupUrl?.trim()) payload.signupUrl = next.signupUrl.trim();
  if (next.contactEmail?.trim()) payload.contactEmail = next.contactEmail.trim();
  return JSON.stringify(payload);
}

function mergeBrand(
  existing: TenantBrand | null,
  patch: TenantBrand | null | undefined,
  tenantName: string,
): TenantBrand {
  const base = existing ?? { name: tenantName };
  if (!patch) return base;
  const name = (patch.name ?? base.name ?? tenantName).trim() || tenantName;
  const merged: TenantBrand = { name };
  const accent = patch.accent ?? base.accent;
  if (accent) merged.accent = accent;
  const supportAgentName = patch.supportAgentName ?? base.supportAgentName;
  if (supportAgentName) merged.supportAgentName = supportAgentName;
  const signupUrl = patch.signupUrl ?? base.signupUrl;
  if (signupUrl) merged.signupUrl = signupUrl;
  const contactEmail = patch.contactEmail ?? base.contactEmail;
  if (contactEmail) merged.contactEmail = contactEmail;
  return merged;
}

function mapTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    ingestTokenHash: row.ingest_token_hash,
    brand: parseBrandJson(row.brand_json, row.name),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateTenantInput {
  name: string;
  domain?: string;
  brand?: TenantBrand;
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
    const brandJson = serializeBrand(
      input.brand ?? { name },
      name,
    );
    await this.db.run(
      `INSERT INTO ${this.t} (id, name, domain, ingest_token_hash, brand_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, name, domain, hash, brandJson, now, now],
    );
    return {
      tenant: {
        id,
        name,
        domain,
        ingestTokenHash: hash,
        brand: parseBrandJson(brandJson, name),
        createdAt: now,
        updatedAt: now,
      },
      ingestToken,
    };
  }

  async update(
    id: string,
    patch: { name?: string; domain?: string | null; brand?: TenantBrand | null },
  ): Promise<Tenant> {
    const tenant = await this.getById(id);
    if (!tenant) throw new Error(`tenant ${id} not found`);
    const now = new Date().toISOString();
    const nextName = patch.name?.trim() || tenant.name;
    let nextBrand = mergeBrand(tenant.brand, patch.brand, nextName);
    if (patch.name !== undefined && (patch.brand === undefined || patch.brand?.name === undefined)) {
      nextBrand = { ...nextBrand, name: nextName };
    }
    const next: Tenant = {
      ...tenant,
      name: nextName,
      domain: patch.domain === undefined ? tenant.domain : (patch.domain?.trim().toLowerCase() ?? null),
      brand: nextBrand,
      updatedAt: now,
    };
    await this.db.run(
      `UPDATE ${this.t} SET name = ?, domain = ?, brand_json = ?, updated_at = ? WHERE id = ?`,
      [next.name, next.domain, serializeBrand(nextBrand, next.name), now, id],
    );
    return next;
  }

  async remove(id: string): Promise<boolean> {
    const changes = await this.db.run(`DELETE FROM ${this.t} WHERE id = ?`, [id]);
    return changes.changes > 0;
  }

  /** Returns true when SHA-256(token) matches the tenant's stored ingest_token_hash. */
  async verifyIngestToken(tenantId: string, token: string): Promise<boolean> {
    const tenant = await this.getById(tenantId);
    if (!tenant?.ingestTokenHash) return false;
    const hash = await hashToken(token);
    return hash === tenant.ingestTokenHash;
  }
}

async function hashToken(token: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(token).digest("hex");
}
