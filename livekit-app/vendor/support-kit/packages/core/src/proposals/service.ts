import {
  CreateProposalInputSchema,
  type CreateProposalInput,
  type Proposal,
  type ProposalStatus,
} from "@rhule/support-shared";
import type { DbAdapter } from "../adapters/types.js";
import { DEFAULT_TABLE_PREFIX } from "../db/migrate.js";
import { ProposalStore } from "./store.js";

const REVIEWABLE_STATUSES = new Set<ProposalStatus>(["pending_review", "needs_info"]);
const ATOMIC_FROM: ProposalStatus[] = ["pending_review", "needs_info"];

export class ProposalService {
  private readonly store: ProposalStore;

  constructor(db: DbAdapter, tablePrefix: string = DEFAULT_TABLE_PREFIX) {
    this.store = new ProposalStore(db, tablePrefix);
  }

  /** Expose store for executor / webhook soft-claim helpers. */
  getStore(): ProposalStore {
    return this.store;
  }

  async createProposal(raw: CreateProposalInput): Promise<Proposal> {
    const input = CreateProposalInputSchema.parse(raw);
    const createInput: Parameters<ProposalStore["create"]>[0] = {
      tenantId: String(input.tenantId),
      ticketId: input.ticketId,
      proposalType: input.proposalType,
      summary: input.summary,
      bodyJson: input.bodyJson,
    };
    if (input.confidence !== undefined) {
      createInput.confidence = input.confidence;
    }
    return this.store.create(createInput);
  }

  getProposal(tenantId: string, id: string) {
    return this.store.getById(tenantId, id);
  }

  listProposals(tenantId: string, opts?: { status?: ProposalStatus; limit?: number }) {
    return this.store.listByTenant(tenantId, opts);
  }

  listProposalsForTicket(tenantId: string, ticketId: string) {
    return this.store.listForTicket(tenantId, ticketId);
  }

  getActivePendingForTicket(tenantId: string, ticketId: string) {
    return this.store.getActivePendingForTicket(tenantId, ticketId);
  }

  setTelegramMeta(
    tenantId: string,
    id: string,
    meta: { telegramMessageId: string; telegramChatId: string },
  ) {
    return this.store.setTelegramMeta(tenantId, id, meta);
  }

  setClaim(tenantId: string, id: string, claimedBy: string | null) {
    return this.store.setClaim(tenantId, id, claimedBy);
  }

  /**
   * Atomic approve/reject/needs_info. Returns undefined if another reviewer won.
   */
  async tryAtomicTransition(
    tenantId: string,
    id: string,
    nextStatus: "approved" | "rejected" | "needs_info",
    reviewedBy: string,
    extra?: { executionStatus?: string | null; executionRef?: string | null },
  ): Promise<Proposal | undefined> {
    const now = new Date().toISOString();
    return this.store.tryAtomicTransition(tenantId, id, ATOMIC_FROM, nextStatus, {
      reviewedBy,
      reviewedAt: now,
      executionStatus: extra?.executionStatus ?? "done",
      executionRef: extra?.executionRef ?? null,
    });
  }

  async approveProposal(
    tenantId: string,
    id: string,
    reviewedBy: string,
  ): Promise<Proposal> {
    const updated = await this.tryAtomicTransition(tenantId, id, "approved", reviewedBy);
    if (!updated) {
      const existing = await this.store.getById(tenantId, id);
      if (!existing) throw new Error(`ProposalService: proposal not found (${id})`);
      throw new Error(
        `ProposalService: already handled by ${existing.reviewedBy ?? existing.status}`,
      );
    }
    return updated;
  }

  async rejectProposal(
    tenantId: string,
    id: string,
    reviewedBy: string,
  ): Promise<Proposal> {
    const updated = await this.tryAtomicTransition(tenantId, id, "rejected", reviewedBy);
    if (!updated) {
      const existing = await this.store.getById(tenantId, id);
      if (!existing) throw new Error(`ProposalService: proposal not found (${id})`);
      throw new Error(
        `ProposalService: already handled by ${existing.reviewedBy ?? existing.status}`,
      );
    }
    return updated;
  }

  async markNeedsInfo(
    tenantId: string,
    id: string,
    reviewedBy: string,
  ): Promise<Proposal> {
    const updated = await this.tryAtomicTransition(tenantId, id, "needs_info", reviewedBy);
    if (!updated) {
      const existing = await this.store.getById(tenantId, id);
      if (!existing) throw new Error(`ProposalService: proposal not found (${id})`);
      throw new Error(
        `ProposalService: already handled by ${existing.reviewedBy ?? existing.status}`,
      );
    }
    return updated;
  }

  /** Non-atomic path kept for tests that expect throw on invalid status. */
  async transitionReviewUnchecked(
    tenantId: string,
    id: string,
    nextStatus: "approved" | "rejected" | "needs_info",
    reviewedBy: string,
  ): Promise<Proposal> {
    const existing = await this.store.getById(tenantId, id);
    if (!existing) {
      throw new Error(`ProposalService: proposal not found (${id})`);
    }
    if (!REVIEWABLE_STATUSES.has(existing.status)) {
      throw new Error(
        `ProposalService: cannot transition from "${existing.status}" to "${nextStatus}"`,
      );
    }
    const now = new Date().toISOString();
    const updated = await this.store.updateStatus(tenantId, id, nextStatus, {
      reviewedBy,
      reviewedAt: now,
    });
    if (!updated) {
      throw new Error(`ProposalService: failed to update proposal (${id})`);
    }
    return updated;
  }
}
