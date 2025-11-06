// API helper that respects basePath
export function getApiUrl(path: string): string {
  // Get basePath from window location or use default
  if (typeof window !== 'undefined') {
    // Check if we're on /meet path
    if (window.location.pathname.startsWith('/meet')) {
      return `/meet${path}`;
    }
  }
  // Fallback to path as-is (for development)
  return path;
}

