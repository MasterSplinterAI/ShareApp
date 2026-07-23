import {
  CreateLeadInputSchema,
  type CreateLeadInput,
  type Lead,
} from "@rhule/support-shared";
import type { DbAdapter } from "../adapters/types.js";
import { DEFAULT_TABLE_PREFIX } from "../db/migrate.js";
import { LeadStore } from "./store.js";

export class LeadService {
  private readonly store: LeadStore;

  constructor(
    db: DbAdapter,
    tablePrefix: string = DEFAULT_TABLE_PREFIX,
  ) {
    this.store = new LeadStore(db, tablePrefix);
  }

  getById(tenantId: string, id: string) {
    return this.store.getById(tenantId, id);
  }

  getByEmail(tenantId: string, email: string) {
    return this.store.getByEmail(tenantId, email);
  }

  list(tenantId: string, opts?: { marketingOnly?: boolean; limit?: number }) {
    return this.store.list(tenantId, opts);
  }

  async upsertLead(
    raw: CreateLeadInput,
  ): Promise<Lead> {
    const input = CreateLeadInputSchema.parse(raw);
    const phone = input.phone?.trim() || undefined;
    const marketingEmailOptIn = Boolean(input.marketingOptIn);
    const marketingSmsOptIn = Boolean(input.marketingOptIn && phone);

    return this.store.upsert({
      ...input,
      ...(phone ? { phone } : {}),
      marketingEmailOptIn,
      marketingSmsOptIn,
    });
  }
}
