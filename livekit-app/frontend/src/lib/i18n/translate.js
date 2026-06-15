/**
 * Resolve dot-notation keys with optional {{param}} interpolation.
 * Falls back to English bundle, then the key string.
 */
export function createTranslator(messages, fallbackMessages = {}) {
  return function t(key, params) {
    let value = lookup(messages, key) ?? lookup(fallbackMessages, key) ?? key;
    if (params && typeof value === 'string') {
      value = value.replace(/\{\{(\w+)\}\}/g, (_, name) =>
        params[name] != null ? String(params[name]) : `{{${name}}}`
      );
    }
    return value;
  };
}

function lookup(messages, key) {
  if (!messages || !key) return undefined;
  const parts = key.split('.');
  let cur = messages;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}
