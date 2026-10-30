/**
 * Plan tiers: which capabilities exist at the product level.
 * Individual (solo) plans: meetings + guest links only — no inviting additional org members.
 * Team / business plans: named org, invite colleagues, shared workspace.
 */
const TEAM_WORKSPACE_PLAN_IDS = new Set(['pro', 'business', 'enterprise', 'team']);

function planAllowsTeamWorkspace(planId) {
  if (!planId || typeof planId !== 'string') return false;
  return TEAM_WORKSPACE_PLAN_IDS.has(planId.toLowerCase());
}

module.exports = {
  planAllowsTeamWorkspace,
  TEAM_WORKSPACE_PLAN_IDS,
};
