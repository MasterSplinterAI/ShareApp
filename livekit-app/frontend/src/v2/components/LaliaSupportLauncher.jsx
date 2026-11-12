import { useRef } from 'react';
import { SupportLauncher } from '@quill/support-react';
import { resolveApiBaseUrl } from '../../lib/nativePlatform';

const SUPPORT_API_BASE = `${resolveApiBaseUrl().replace(/\/$/, '')}/v2/support`;

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
  // Public/auth pages intentionally stay guest clients, even with an ambient JWT.
  // Only the app shell supplies verified me.user; never infer customer identity from token presence.
  const resolvedAudience = audience || (user?.id ? 'app' : 'public');
  const customerContext = resolvedAudience === 'app';

  return (
    <SupportLauncher
      key={customerContext ? user?.id || "unresolved-customer" : "guest"}
      apiBase={SUPPORT_API_BASE}
      getAccessToken={customerContext ? getSupportAccessToken : undefined}
      brand={{
        name: 'Lalia',
        supportAgentName: 'Lalia Help',
        signupUrl: '/v2/signup',
      }}
      audience={resolvedAudience}
      requireCustomer={customerContext}
      guestOnly={!customerContext}
      user={
        customerContext && user
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
                  className="hidden md:inline-flex"
                  style={{
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
