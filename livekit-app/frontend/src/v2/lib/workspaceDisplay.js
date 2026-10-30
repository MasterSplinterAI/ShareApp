/** Personal vs team workspace display (every account still has an internal org for billing). */

export function isPersonalWorkspace(org) {
  const t = org?.account_type ?? org?.accountType;
  return t === 'personal' || t === undefined;
}

export function isTeamWorkspace(org) {
  return (org?.account_type ?? org?.accountType) === 'team';
}

/** Sidebar, home subtitle, etc. */
export function workspaceLabel({ org, user }) {
  if (isTeamWorkspace(org)) {
    return org?.name || 'Workspace';
  }
  return (
    user?.display_name ||
    user?.displayName ||
    user?.email?.split('@')[0] ||
    'Account'
  );
}

export function workspaceKindLabel(org) {
  return isTeamWorkspace(org) ? 'Team workspace' : 'Personal account';
}
