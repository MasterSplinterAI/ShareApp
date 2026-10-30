import type { DbAdapter } from "../adapters/types.js";
import { DEFAULT_TABLE_PREFIX } from "../db/migrate.js";

export type TelegramDraftSession = {
  telegramUserId: string;
  tenantId: string;
  proposalId: string;
  ticketId: string;
  publicNumber: number;
  createdAt: string;
  expiresAt: string;
};

type DraftRow = {
  telegram_user_id: string;
  tenant_id: string;
  proposal_id: string;
  ticket_id: string;
  public_number: number;
  created_at: string;
  expires_at: string;
};

const DEFAULT_TTL_MS = 30 * 60 * 1000;

function mapRow(row: DraftRow): TelegramDraftSession {
  return {
    telegramUserId: row.telegram_user_id,
    tenantId: row.tenant_id,
    proposalId: row.proposal_id,
    ticketId: row.ticket_id,
    publicNumber: Number(row.public_number),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class TelegramDraftSessionStore {
  constructor(
    private readonly db: DbAdapter,
    private readonly tablePrefix: string = DEFAULT_TABLE_PREFIX,
  ) {}

  private get t() {
    return `${this.tablePrefix}telegram_draft_sessions`;
  }

  async start(
    telegramUserId: string,
    input: {
      tenantId: string;
      proposalId: string;
      ticketId: string;
      publicNumber: number;
      ttlMs?: number;
    },
  ): Promise<TelegramDraftSession> {
    const now = new Date();
    const expires = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_TTL_MS));
    const createdAt = now.toISOString();
    const expiresAt = expires.toISOString();

    // Upsert — one active draft session per Telegram user
    await this.db.run(`DELETE FROM ${this.t} WHERE telegram_user_id = ?`, [String(telegramUserId)]);
    await this.db.run(
      `INSERT INTO ${this.t} (
        telegram_user_id, tenant_id, proposal_id, ticket_id, public_number, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        String(telegramUserId),
        input.tenantId,
        input.proposalId,
        input.ticketId,
        input.publicNumber,
        createdAt,
        expiresAt,
      ],
    );

    return {
      telegramUserId: String(telegramUserId),
      tenantId: input.tenantId,
      proposalId: input.proposalId,
      ticketId: input.ticketId,
      publicNumber: input.publicNumber,
      createdAt,
      expiresAt,
    };
  }

  async get(telegramUserId: string): Promise<TelegramDraftSession | undefined> {
    const row = await this.db.get<DraftRow>(
      `SELECT * FROM ${this.t} WHERE telegram_user_id = ?`,
      [String(telegramUserId)],
    );
    if (!row) return undefined;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await this.clear(telegramUserId);
      return undefined;
    }
    return mapRow(row);
  }

  async clear(telegramUserId: string): Promise<void> {
    await this.db.run(`DELETE FROM ${this.t} WHERE telegram_user_id = ?`, [
      String(telegramUserId),
    ]);
  }
}
