type TelegramFetch = (url: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}) => Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
    json?: () => Promise<unknown>;
}>;
interface TelegramOpsNotifierOptions {
    botToken: string;
    chatId: string;
    fetchImpl?: TelegramFetch;
}
type TelegramInlineButton = {
    text: string;
    callback_data: string;
};
type TelegramReplyMarkup = {
    inline_keyboard?: TelegramInlineButton[][];
    force_reply?: boolean;
    input_field_placeholder?: string;
};
interface ProposalReadyNotifyInput {
    ticketPublicNumber: number;
    proposal: {
        id: string;
        proposalType: string;
        summary: string;
        bodyJson: string;
        confidence?: number | null;
        claimedBy?: string | null;
    };
    adminUrl?: string;
    kindLabel?: string;
    claimLabel?: string | null;
    doneLabel?: string | null;
}
interface TelegramSendResult {
    ok: boolean;
    messageId?: string;
    chatId?: string;
    skipped?: boolean;
    error?: string;
}
interface TelegramOpsClient extends OpsNotifier {
    notifyProposalReady(input: ProposalReadyNotifyInput): Promise<TelegramSendResult>;
    editProposalMessage(input: {
        chatId: string;
        messageId: string;
        text: string;
        replyMarkup?: TelegramReplyMarkup | null;
    }): Promise<TelegramSendResult>;
    answerCallback(callbackQueryId: string, text: string): Promise<void>;
    sendForceReply(text: string, placeholder?: string): Promise<TelegramSendResult>;
    sendText(text: string, replyMarkup?: TelegramReplyMarkup | null): Promise<TelegramSendResult>;
    formatProposalMessage(input: ProposalReadyNotifyInput): string;
    proposalKeyboard(proposal: {
        id: string;
        proposalType: string;
        claimedBy?: string | null;
    }, opts?: {
        claimedBy?: string | null;
    }): TelegramReplyMarkup;
}
declare function escapeHtml(value: string): string;
/** Format OpsNotification as Telegram HTML (mirrors ShareApp telegramSupport.js). */
declare function formatTelegramOpsMessage(notification: OpsNotification): string;
declare function getDraftSeedForProposal(proposal: {
    proposalType: string;
    bodyJson: string;
}): string;
declare function buildProposalKeyboard(proposal: {
    id: string;
    proposalType: string;
    claimedBy?: string | null;
}, opts?: {
    claimedBy?: string | null;
}): TelegramReplyMarkup;
declare function formatProposalReadyMessage(input: ProposalReadyNotifyInput): string;
declare function createTelegramOpsNotifier(options: TelegramOpsNotifierOptions): TelegramOpsClient;

type OpsNotificationKind = "ticket_created" | "escalation" | "proposal_ready" | "user_reply" | "kb_drafts_ready";
interface OpsNotification {
    kind: OpsNotificationKind;
    title: string;
    body: string;
    adminUrl?: string;
    ticketPublicNumber?: number;
}
/** Channel adapter — Telegram/Slack/email implement this. */
interface OpsNotifier {
    sendToOps(notification: OpsNotification): Promise<void>;
    /** Optional rich proposal notify with inline keyboard. */
    notifyProposalReady?(input: ProposalReadyNotifyInput): Promise<TelegramSendResult | void>;
}
interface EmailNotifier {
    sendToUser(input: {
        to: string;
        subject: string;
        text: string;
        html?: string;
    }): Promise<void>;
}
/** Placeholder until Telegram adapter is extracted from ShareApp. */
declare function createNoopOpsNotifier(): OpsNotifier;

export { type EmailNotifier, type OpsNotification, type OpsNotificationKind, type OpsNotifier, type ProposalReadyNotifyInput, type TelegramFetch, type TelegramOpsClient, type TelegramOpsNotifierOptions, type TelegramReplyMarkup, type TelegramSendResult, buildProposalKeyboard, createNoopOpsNotifier, createTelegramOpsNotifier, escapeHtml, formatProposalReadyMessage, formatTelegramOpsMessage, getDraftSeedForProposal };
