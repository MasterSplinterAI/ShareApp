import { useRef } from 'react';
import { SupportLauncher } from '@rhule/support-react';

const SUPPORT_API_BASE = '/api/v2/support';

export function getSupportAccessToken() {
  try {
    return localStorage.getItem('v2_token');
  } catch {
    return null;
  }
}

/**
 * Kit SupportLauncher with ShareApp Bearer JWT.
 * - Logged-in app: pass `user` (+ optional `openRef` for menu → open).
 * - Marketing / auth pages: omit `user` → contact gate + FAQ/Contact only.
 */
export default function LaliaSupportLauncher({ user, openRef, audience }) {
  const localOpen = useRef(null);
  const resolvedAudience = audience || (user?.id ? 'app' : 'public');

  return (
    <SupportLauncher
      apiBase={SUPPORT_API_BASE}
      getAccessToken={getSupportAccessToken}
      brand={{
        name: 'Lalia',
        supportAgentName: 'Lalia Help',
        signupUrl: '/v2/signup',
      }}
      audience={resolvedAudience}
      user={
        user
          ? {
              id: user.id,
              email: user.email || undefined,
              name: user.display_name || user.name || undefined,
              planLabel: user.planLabel,
            }
          : undefined
      }
      offset={{ bottom: 20, right: 20 }}
      renderTrigger={
        openRef
          ? (open) => {
              localOpen.current = open;
              openRef.current = open;
              return (
                <button
                  type="button"
                  aria-label="Open Lalia help"
                  onClick={open}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '12px 18px',
                    border: 'none',
                    borderRadius: 999,
                    background: '#2563eb',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(15, 23, 42, 0.18)',
                  }}
                >
                  Help
                </button>
              );
            }
          : undefined
      }
    />
  );
}

export { SUPPORT_API_BASE };
