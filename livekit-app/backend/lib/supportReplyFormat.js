/** Normalize AI/support replies for end users — UI language, no internal paths or role jargon. */

function scrubInternalPaths(text) {
  return String(text || '')
    .replace(/\(`\/v2\/[^`]+`\)/gi, '')
    .replace(/`\/v2\/[^`]+`/gi, '')
    .replace(/\(\/v2\/[^)]+\)/gi, '')
    .replace(/\/v2\/[^\s,)]+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function formatUserFacingReply(text) {
  if (!text) return text;
  return scrubInternalPaths(text);
}

const REPLY_STYLE_RULES = `
User-facing reply rules (draft_reply and user_update):
- Use **bold** sparingly for UI labels (Settings, Password, Update password).
- Describe navigation in the app UI only: "Settings in the left sidebar", "Help chat bubble", "Forgot password on the sign-in screen".
- Never include URL paths (/v2/...), route names, or internal links.
- Do not mention Super Admin as a product role unless userContext.isPlatformAdmin is true; then say "platform administrator" or "Admin in the sidebar".
- Use userContext plan, role, and workspace type to tailor answers (e.g. "On your Pro plan…", "As the workspace owner…").
- Keep answers concise and conversational.`;

module.exports = {
  formatUserFacingReply,
  REPLY_STYLE_RULES,
};
