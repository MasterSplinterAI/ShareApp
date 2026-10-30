export type OpsNotificationKind =
  | "ticket_created"
  | "escalation"
  | "proposal_ready"
  | "user_reply"
  | "kb_drafts_ready";

export interface OpsNotification {
  kind: OpsNotificationKind;
  title: string;
  body: string;
  adminUrl?: string;
  ticketPublicNumber?: number;
}

/** Channel adapter — Telegram/Slack/email implement this. */
export interface OpsNotifier {
  sendToOps(notification: OpsNotification): Promise<void>;
  /** Optional rich proposal notify with inline keyboard. */
  notifyProposalReady?(
    input: import("./telegram.js").ProposalReadyNotifyInput,
  ): Promise<import("./telegram.js").TelegramSendResult | void>;
}

export interface EmailNotifier {
  sendToUser(input: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<void>;
}

/** Placeholder until Telegram adapter is extracted from ShareApp. */
export function createNoopOpsNotifier(): OpsNotifier {
  return {
    async sendToOps() {
      /* intentionally empty for scaffold */
    },
  };
}

export {
  createTelegramOpsNotifier,
  formatTelegramOpsMessage,
  formatProposalReadyMessage,
  buildProposalKeyboard,
  getDraftSeedForProposal,
  escapeHtml,
} from "./telegram.js";
export type {
  TelegramOpsNotifierOptions,
  TelegramFetch,
  TelegramOpsClient,
  ProposalReadyNotifyInput,
  TelegramSendResult,
  TelegramReplyMarkup,
} from "./telegram.js";
