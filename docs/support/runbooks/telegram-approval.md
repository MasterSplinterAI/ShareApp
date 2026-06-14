# Telegram approval runbook

1. New ticket → alert in Telegram with admin link.
2. AI analyzes ticket → **proposal** message with inline buttons.
3. Approve actions:
   - **Support reply** → sends approved text to user (email + in-app thread).
   - **Bug / feature** → creates GitHub issue only (no auto-PR).
   - **Reject** → proposal closed; ticket stays open for manual handling.
   - **Need info** → templated question sent to user.

Only Telegram user IDs in `SUPPORT_TELEGRAM_ALLOWED_USER_IDS` may press buttons.

Mirror actions available in Super Admin → Support tab.
