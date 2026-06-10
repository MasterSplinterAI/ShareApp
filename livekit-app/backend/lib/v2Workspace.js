/** Personal vs team workspace helpers (billing unit is always an org row). */

const PERSONAL = 'personal';
const TEAM = 'team';

function isLegacyAutoOrgName(name, email) {
  if (!name || !email) return false;
  const local = String(email).split('@')[0];
  return name === `${local}'s org`;
}

/**
 * Decide account_type + stored org name at signup / repair.
 * @returns {{ accountType: 'personal'|'team', name: string }}
 */
function resolveNewWorkspace({ orgName, displayName, email }) {
  const trimmedOrg = orgName && String(orgName).trim();
  const trimmedDisplay = displayName && String(displayName).trim();
  const emailLocal = String(email || '').split('@')[0] || 'User';

  if (trimmedOrg) {
    return { accountType: TEAM, name: trimmedOrg.slice(0, 128) };
  }
  return {
    accountType: PERSONAL,
    name: (trimmedDisplay || emailLocal).slice(0, 128),
  };
}

/** Label for exports and admin when org is a personal account. */
function workspaceDisplayLabel(org, user) {
  const type = org?.account_type || org?.accountType;
  if (type === PERSONAL) {
    return user?.display_name || user?.displayName || user?.email?.split('@')[0] || null;
  }
  return org?.name || null;
}

module.exports = {
  PERSONAL,
  TEAM,
  isLegacyAutoOrgName,
  resolveNewWorkspace,
  workspaceDisplayLabel,
};
