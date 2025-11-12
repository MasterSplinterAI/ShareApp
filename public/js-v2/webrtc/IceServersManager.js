// ICE server management with fetching and caching
import { logger } from '../core/Logger.js';
import { eventBus } from '../core/EventBus.js';

class IceServersManager {
  constructor() {
    this.iceServers = null;
    this.cacheExpiry = null;
    this.cacheDuration = 60 * 60 * 1000; // 1 hour
    this.isFetching = false;
    this.fetchPromise = null;
  }

  /**
   * Get ICE servers (from cache or fetch fresh)
   */
  async getIceServers(forceRefresh = false) {
    // Return cached servers if still valid
    if (!forceRefresh && this.iceServers && this.cacheExpiry && Date.now() < this.cacheExpiry) {
      logger.debug('IceServersManager', 'Using cached ICE servers');
      return this.iceServers;
    }

    // If already fetching, return the existing promise
    if (this.isFetching && this.fetchPromise) {
      logger.debug('IceServersManager', 'ICE servers fetch already in progress, waiting...');
      return this.fetchPromise;
    }

    // Start fetching
    this.isFetching = true;
    this.fetchPromise = this.fetchIceServers();

    try {
      const servers = await this.fetchPromise;
      return servers;
    } finally {
      this.isFetching = false;
      this.fetchPromise = null;
    }
  }

  /**
   * Fetch ICE servers from server
   */
  async fetchIceServers() {
    logger.info('IceServersManager', 'Fetching ICE servers from server...');

    try {
      const response = await fetch('/api/ice-servers');
      
      if (!response.ok) {
        throw new Error(`Failed to fetch ICE servers: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.iceServers || !Array.isArray(data.iceServers)) {
        throw new Error('Invalid ICE servers response format');
      }

      this.iceServers = data.iceServers;
      this.cacheExpiry = Date.now() + this.cacheDuration;

      logger.info('IceServersManager', `Fetched ${data.iceServers.length} ICE servers`, {
        serverCount: data.iceServers.length,
        hasStun: data.iceServers.some(s => s.urls.includes('stun:')),
        hasTurn: data.iceServers.some(s => s.urls.includes('turn:'))
      });

      eventBus.emit('iceservers:updated', { servers: this.iceServers });

      return this.iceServers;
    } catch (error) {
      logger.error('IceServersManager', 'Failed to fetch ICE servers', { error });

      // Fallback to default STUN servers
      const fallbackServers = this.getDefaultIceServers();
      logger.warn('IceServersManager', 'Using fallback ICE servers', {
        serverCount: fallbackServers.length
      });

      this.iceServers = fallbackServers;
      this.cacheExpiry = Date.now() + (5 * 60 * 1000); // Cache fallback for 5 minutes

      eventBus.emit('iceservers:error', { error, fallback: true });

      return fallbackServers;
    }
  }

  /**
   * Get default STUN servers
   */
  getDefaultIceServers() {
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.services.mozilla.com' },
      { urls: 'stun:stun.ekiga.net' }
    ];
  }

  /**
   * Get ICE servers synchronously (from cache only)
   */
  getIceServersSync() {
    if (this.iceServers) {
      return this.iceServers;
    }

    // Return defaults if no cache
    return this.getDefaultIceServers();
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.iceServers = null;
    this.cacheExpiry = null;
    logger.debug('IceServersManager', 'ICE servers cache cleared');
  }

  /**
   * Refresh ICE servers
   */
  async refresh() {
    this.clearCache();
    return this.getIceServers(true);
  }
}

// Export singleton instance
export const iceServersManager = new IceServersManager();
export default iceServersManager;

