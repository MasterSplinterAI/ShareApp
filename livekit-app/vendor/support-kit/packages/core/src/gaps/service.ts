import {
  GapStatusSchema,
  RecordKnowledgeGapInputSchema,
  type GapStatus,
  type KnowledgeGap,
  type RecordKnowledgeGapInput,
} from "@rhule/support-shared";
import type { DbAdapter } from "../adapters/types.js";
import { DEFAULT_TABLE_PREFIX } from "../db/migrate.js";
import { KnowledgeGapStore } from "./store.js";

export class KnowledgeGapService {
  private readonly store: KnowledgeGapStore;

  constructor(db: DbAdapter, tablePrefix: string = DEFAULT_TABLE_PREFIX) {
    this.store = new KnowledgeGapStore(db, tablePrefix);
  }

  async recordKnowledgeGap(raw: RecordKnowledgeGapInput): Promise<KnowledgeGap> {
    const input = RecordKnowledgeGapInputSchema.parse(raw);
    const recordInput: Parameters<KnowledgeGapStore["record"]>[0] = {
      tenantId: String(input.tenantId),
      ticketId: input.ticketId,
    };
    if (input.proposalId !== undefined) recordInput.proposalId = input.proposalId;
    if (input.proposalType !== undefined) recordInput.proposalType = input.proposalType;
    if (input.summary !== undefined) recordInput.summary = input.summary;
    if (input.escalationReason !== undefined) recordInput.escalationReason = input.escalationReason;
    if (input.docQuery !== undefined) recordInput.docQuery = input.docQuery;
    if (input.docHitsJson !== undefined) recordInput.docHitsJson = input.docHitsJson;
    if (input.userQuestion !== undefined) recordInput.userQuestion = input.userQuestion;
    return this.store.record(recordInput);
  }

  getKnowledgeGap(tenantId: string, id: string) {
    return this.store.getById(tenantId, id);
  }

  listKnowledgeGaps(tenantId: string, opts?: { status?: GapStatus; limit?: number }) {
    return this.store.listByTenant(tenantId, opts);
  }

  patchKnowledgeGap(tenantId: string, id: string, status: GapStatus) {
    const parsed = GapStatusSchema.parse(status);
    return this.store.updateStatus(tenantId, id, parsed);
  }
}
