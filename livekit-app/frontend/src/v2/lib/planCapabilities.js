/**
 * Team workspace = named org + invite colleagues with their own login (not guest links).
 * Mirrors backend `v2PlanFeatures.planAllowsTeamWorkspace`.
 */
export function hasTeamWorkspace(entitlements, plan) {
  if (entitlements?.teamWorkspace === true) return true;
  if (entitlements?.teamWorkspace === false) return false;
  return plan?.teamWorkspace === true;
}
