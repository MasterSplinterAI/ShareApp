/**
 * Centralized SEO metadata for the Lalia SPA.
 *
 * Marketing routes are indexable with unique titles/descriptions/canonicals.
 * App, room, join, and admin routes are noindex. Auth utility pages (login,
 * reset-password) are noindex; signup stays indexable with a unique title.
 */

export const SITE_ORIGIN = 'https://lalia.cloud';
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/marketing/og-card.png`;

const DEFAULT_DESCRIPTION =
  'Multilingual video meetings in the browser. Live translation, speech-to-text, optional transcripts, and AI meeting insights—for individuals and teams. Free tier, no credit card.';

/** Exact-match SEO for indexable marketing routes. */
export const SEO_BY_PATH = {
  '/': {
    title: 'Live Meeting Translation & Captions | Lalia',
    description: DEFAULT_DESCRIPTION,
    canonical: `${SITE_ORIGIN}/`,
  },
  '/demo': {
    title: 'Try Live Translation Demo | Lalia',
    description:
      'Try Lalia’s multilingual meeting translation right in your browser—no download or account needed. See live captions and cross-language translation in action.',
    canonical: `${SITE_ORIGIN}/demo`,
  },
  '/terms': {
    title: 'Terms of Service | Lalia',
    description:
      'Read the Terms of Service governing your use of Lalia’s multilingual meeting platform.',
    canonical: `${SITE_ORIGIN}/terms`,
  },
  '/privacy': {
    title: 'Privacy Policy | Lalia',
    description:
      'Learn how Lalia handles your data. Meetings are not recorded and content is never used to train AI models.',
    canonical: `${SITE_ORIGIN}/privacy`,
  },
};

const DEFAULTS = {
  title: 'Live Meeting Translation & Captions | Lalia',
  description: DEFAULT_DESCRIPTION,
  ogImage: DEFAULT_OG_IMAGE,
  ogType: 'website',
};

/**
 * Resolve SEO metadata for a given pathname.
 * @param {string} pathname
 * @returns {{ title: string, description: string, canonical?: string, robots?: string, ogImage: string, ogType: string }}
 */
export function resolveSeo(pathname) {
  const path = normalizePath(pathname);

  // Exact match for indexable marketing routes.
  if (SEO_BY_PATH[path]) {
    return { ...DEFAULTS, ...SEO_BY_PATH[path] };
  }

  // Auth utility pages under /v2.
  if (path === '/v2/signup') {
    return {
      ...DEFAULTS,
      title: 'Sign Up | Lalia',
      description:
        'Create a free Lalia account to host multilingual meetings with live translation and captions.',
      canonical: `${SITE_ORIGIN}/v2/signup`,
    };
  }
  if (path === '/v2/login') {
    return {
      ...DEFAULTS,
      title: 'Log In | Lalia',
      robots: 'noindex, nofollow',
    };
  }
  if (path === '/v2/reset-password') {
    return {
      ...DEFAULTS,
      title: 'Reset Password | Lalia',
      robots: 'noindex, nofollow',
    };
  }

  // Authenticated app, admin, and any other /v2 surface: noindex.
  if (path === '/v2' || path.startsWith('/v2/')) {
    return {
      ...DEFAULTS,
      title: 'Lalia App',
      robots: 'noindex, nofollow',
    };
  }

  // Meeting rooms and guest-join links: noindex.
  if (path.startsWith('/room/')) {
    return {
      ...DEFAULTS,
      title: 'Meeting Room | Lalia',
      robots: 'noindex, nofollow',
    };
  }
  if (path.startsWith('/join/')) {
    return {
      ...DEFAULTS,
      title: 'Join Meeting | Lalia',
      robots: 'noindex, nofollow',
    };
  }

  // Unknown paths (404).
  return {
    ...DEFAULTS,
    title: 'Page not found | Lalia',
    description: 'The page you are looking for could not be found.',
    robots: 'noindex, nofollow',
  };
}

/** Strip trailing slash (except root) so '/demo/' matches '/demo'. */
function normalizePath(pathname) {
  if (!pathname) return '/';
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
}
