/**
 * Persist preferred UI/meeting language to the signed-in user profile.
 * Safe to call from SPA code; no-ops when logged out or offline.
 */

export function syncPreferredLanguageToServer(code) {
  if (!code || typeof code !== 'string') return;
  if (typeof localStorage === 'undefined' || typeof fetch === 'undefined') return;
  let token = null;
  try {
    token = localStorage.getItem('v2_token');
  } catch {
    return;
  }
  if (!token) return;

  const cleaned = String(code).trim().slice(0, 16);
  if (!cleaned) return;

  fetch('/api/v2/auth/me', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ preferredLanguage: cleaned }),
  }).catch(() => {
    /* ignore network / auth errors — localStorage remains source of truth offline */
  });
}

export async function fetchPreferredLanguageFromServer() {
  if (typeof localStorage === 'undefined' || typeof fetch === 'undefined') return null;
  let token = null;
  try {
    token = localStorage.getItem('v2_token');
  } catch {
    return null;
  }
  if (!token) return null;

  try {
    const res = await fetch('/api/v2/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (
      data?.user?.preferredLanguage ||
      data?.user?.preferred_language ||
      null
    );
  } catch {
    return null;
  }
}
