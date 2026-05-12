/**
 * V2 feature flags (build-time). Production: omit or set to 'false' until ready.
 */
export function isV2EntryEnabled() {
  return import.meta.env.VITE_V2_ENTRY_ENABLED === 'true';
}
