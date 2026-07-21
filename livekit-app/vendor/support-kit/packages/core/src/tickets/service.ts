import {
  CreateTicketInputSchema,
  normalizeCreateTicketInput,
  type CreateTicketInput,
  type Ticket,
  type TicketKind,
  type TicketMessage,
  type TicketStatus,
} from "@rhule/support-shared";
import type { DbAdapter } from "../adapters/types.js";
import { DEFAULT_TABLE_PREFIX } from "../db/migrate.js";
import { TicketStore } from "./store.js";

export class TicketService {
  private readonly store: TicketStore;

  constructor(db: DbAdapter, tablePrefix: string = DEFAULT_TABLE_PREFIX) {
    this.store = new TicketStore(db, tablePrefix);
  }

  async createTicket(raw: CreateTicketInput): Promise<{ ticket: Ticket; message: TicketMessage }> {
    const input = normalizeCreateTicketInput(CreateTicketInputSchema.parse(raw));
    return this.store.create(input);
  }

  listTickets(
    tenantId: string,
    opts?: {
      limit?: number;
      kind?: TicketKind;
      topic?: string;
      status?: TicketStatus;
      userId?: string;
    },
  ) {
    if (typeof opts === "number") {
      return this.store.listByTenant(tenantId, { limit: opts });
    }
    return this.store.listByTenant(tenantId, opts);
  }

  getTicket(tenantId: string, id: string) {
    return this.store.getById(tenantId, id);
  }

  getTicketByPublicNumber(tenantId: string, publicNumber: number) {
    return this.store.getByPublicNumber(tenantId, publicNumber);
  }

  async getTicketByIdOrNumber(tenantId: string, idOrNumber: string) {
    if (idOrNumber.includes("-")) {
      return this.store.getById(tenantId, idOrNumber);
    }
    const n = Number.parseInt(idOrNumber, 10);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return this.store.getByPublicNumber(tenantId, n);
  }

  listMessages(tenantId: string, ticketId: string) {
    return this.store.listMessages(tenantId, ticketId);
  }

  setStatus(tenantId: string, ticketId: string, status: TicketStatus) {
    return this.store.updateStatus(tenantId, ticketId, status);
  }

  setGithubIssueUrl(tenantId: string, ticketId: string, url: string) {
    return this.store.updateGithubUrl(tenantId, ticketId, url);
  }

  setAssignedTo(tenantId: string, ticketId: string, assignedTo: string | null) {
    return this.store.updateAssignedTo(tenantId, ticketId, assignedTo);
  }

  addMessage(
    tenantId: string,
    ticketId: string,
    body: string,
    opts?: {
      authorType?: TicketMessage["authorType"];
      authorId?: string;
      citationJson?: string | null;
    },
  ) {
    return this.store.addMessage({
      tenantId,
      ticketId,
      body,
      authorType: opts?.authorType ?? "user",
      authorId: opts?.authorId ?? null,
      citationJson: opts?.citationJson ?? null,
    });
  }
}
