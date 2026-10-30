import type { KbArticle } from "@rhule/support-shared";
import type { DbAdapter } from "../adapters/types.js";
import { DEFAULT_TABLE_PREFIX } from "../db/migrate.js";
import { TicketService } from "../tickets/service.js";
import { ingestCodegenArticle, promoteKbArticle } from "./codegen.js";

export interface PromoteTicketToKbInput {
  tenantId: string;
  ticketId: string;
  title?: string;
  body?: string;
  /** If true, promote immediately to active (ops already reviewed). Default draft. */
  activate?: boolean;
  tablePrefix?: string;
}

/**
 * Create an evolutionary KB draft from a resolved support ticket thread.
 */
export async function promoteTicketAnswerToKb(
  db: DbAdapter,
  input: PromoteTicketToKbInput,
): Promise<KbArticle> {
  const prefix = input.tablePrefix ?? DEFAULT_TABLE_PREFIX;
  const tickets = new TicketService(db, prefix);
  const ticket = await tickets.getTicket(input.tenantId, input.ticketId);
  if (!ticket) throw new Error(`promoteTicketAnswerToKb: ticket not found (${input.ticketId})`);

  const messages = await tickets.listMessages(input.tenantId, ticket.id);
  const staffOrAssistant = [...messages]
    .reverse()
    .find((m) => m.authorType === "assistant" || m.authorType === "staff" || m.authorType === "agent" || m.authorType === "ops");

  const title =
    input.title?.trim() ||
    ticket.subject?.trim() ||
    `Ticket #${ticket.publicNumber}`;
  const body =
    input.body?.trim() ||
    staffOrAssistant?.body ||
    messages.map((m) => `**${m.authorType}:** ${m.body}`).join("\n\n");

  const article = await ingestCodegenArticle(db, {
    tenantId: input.tenantId,
    title,
    body,
    sourceKey: `evolutionary:ticket:${ticket.id}`,
    sourceKind: "evolutionary",
    path: `ticket/${ticket.publicNumber}`,
    tablePrefix: prefix,
  });

  if (input.activate) {
    return promoteKbArticle(db, input.tenantId, article.id, prefix);
  }
  return article;
}
