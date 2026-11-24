export function resolveSettingsSection(searchParams) {
  if (searchParams.has('section')) return searchParams.get('section') || 'profile';
  return ['success', 'cancel', 'portal'].includes(searchParams.get('billing')) ? 'billing' : 'profile';
}
