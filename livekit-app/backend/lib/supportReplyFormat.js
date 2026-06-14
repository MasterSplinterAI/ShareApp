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

function scrubRoleJargon(text) {
  return String(text || '')
    .replace(/\s*—?\s*including\s+\*\*Super Admin\*\*[^.\n]*/gi, '')
    .replace(/\s*Works for regular users and Super Admin accounts\.?/gi, '')
    .replace(/\s*This works for Super Admin accounts too\.?/gi, '')
    .replace(/\s*All Parley accounts — including \*\*Super Admin\*\* —/gi, 'All Parley accounts')
    .replace(/Super Admin users use the same account settings for password;[^.\n]*\.?/gi, '')
    .replace(/\bSuper Admin\b/gi, 'your account')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function formatUserFacingReply(text) {
  if (!text) return text;
  let out = scrubInternalPaths(text);
  out = scrubRoleJargon(out);
  return out;
}

const REPLY_STYLE_RULES = `
User-facing reply rules (draft_reply and user_update):
- Use **bold** sparingly for UI labels (Settings, Password, Update password).
- Describe navigation in the app UI only: "Settings in the left sidebar", "Help chat bubble", "Forgot password on the sign-in screen".
- Never include URL paths (/v2/...), route names, or internal links.
- Do not mention Super Admin, internal roles, or platform ops unless the user explicitly asked about admin tools.
- Keep answers concise and conversational.`;

module.exports = {
  formatUserFacingReply,
  REPLY_STYLE_RULES,
};
