// ICE server configuration module with support for dynamic TURN credentials
// This helps with international connectivity by using reliable TURN servers

// Default fallback ICE servers (works without server-side configuration)
const defaultIceServers = [
  // Google STUN servers (free, reliable)
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  
  // Additional STUN servers for redundancy
  { urls: 'stun:stun.services.mozilla.com' },
  { urls: 'stun:stun.ekiga.net' },
  { urls: 'stun:stun.voiparound.com' },
  { urls: 'stun:stun.voipbuster.com' },
  
  // Free TURN servers (fallback for when direct connection fails)
  // Note: These may have rate limits and limited bandwidth
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

// Cache for ICE servers to avoid repeated fetches
let cachedIceServers = null;
let iceServerFetchPromise = null;

/**
 * Fetch ICE servers from the server (with TURN credentials if configured)
 * Falls back to default servers if server doesn't provide them
 */
export async function getIceServers() {
  // Return cached servers if available
  if (cachedIceServers) {
    return cachedIceServers;
  }
  
  // If a fetch is already in progress, wait for it
  if (iceServerFetchPromise) {
    return iceServerFetchPromise;
  }
  
  // Fetch ICE servers from server
  iceServerFetchPromise = fetch('/api/ice-servers')
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      if (data && data.iceServers && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
        console.log('Using server-provided ICE servers:', data.iceServers.length, 'servers');
        cachedIceServers = data.iceServers;
        return cachedIceServers;
      } else {
        throw new Error('Invalid server response');
      }
    })
    .catch(error => {
      console.warn('Could not fetch ICE servers from server, using defaults:', error.message);
      // Use default servers as fallback
      cachedIceServers = defaultIceServers;
      return cachedIceServers;
    })
    .finally(() => {
      // Clear the promise so we can retry later if needed
      iceServerFetchPromise = null;
    });
  
  return iceServerFetchPromise;
}

/**
 * Get ICE servers synchronously (returns cached or defaults)
 * Use this for immediate access, but prefer getIceServers() for async access
 */
export function getIceServersSync() {
  return cachedIceServers || defaultIceServers;
}

/**
 * Clear the cached ICE servers (useful for testing or reconfiguration)
 */
export function clearIceServerCache() {
  cachedIceServers = null;
  iceServerFetchPromise = null;
}

/**
 * Initialize ICE servers (should be called early in app initialization)
 */
export async function initializeIceServers() {
  try {
    await getIceServers();
    console.log('ICE servers initialized');
  } catch (error) {
    console.error('Error initializing ICE servers:', error);
    // Continue with defaults
  }
}

