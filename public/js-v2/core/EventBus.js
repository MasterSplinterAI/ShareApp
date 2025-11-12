// Pub/sub event system with namespacing, event history, and priority-based listeners
import { logger } from './Logger.js';

class EventBus {
  constructor() {
    this.listeners = new Map();
    this.eventHistory = [];
    this.maxHistorySize = 500;
    this.enabled = true;
  }

  /**
   * Subscribe to an event
   * @param {string} eventName - Event name (supports namespacing: 'module:event:action')
   * @param {Function} callback - Callback function
   * @param {number} priority - Priority (higher = called first, default: 0)
   * @returns {Function} Unsubscribe function
   */
  on(eventName, callback, priority = 0) {
    if (typeof callback !== 'function') {
      logger.error('EventBus', 'Callback must be a function', { eventName });
      return () => {};
    }

    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }

    const listener = { callback, priority, id: Date.now() + Math.random() };
    const listeners = this.listeners.get(eventName);
    listeners.push(listener);
    
    // Sort by priority (higher priority first)
    listeners.sort((a, b) => b.priority - a.priority);

    logger.debug('EventBus', `Subscribed to event: ${eventName}`, { priority, listenerId: listener.id });

    // Return unsubscribe function
    return () => {
      const currentListeners = this.listeners.get(eventName);
      if (currentListeners) {
        const index = currentListeners.findIndex(l => l.id === listener.id);
        if (index !== -1) {
          currentListeners.splice(index, 1);
          logger.debug('EventBus', `Unsubscribed from event: ${eventName}`, { listenerId: listener.id });
        }
      }
    };
  }

  /**
   * Subscribe to an event once (auto-unsubscribe after first call)
   */
  once(eventName, callback, priority = 0) {
    let unsubscribe;
    unsubscribe = this.on(eventName, (...args) => {
      unsubscribe();
      callback(...args);
    }, priority);
    return unsubscribe;
  }

  /**
   * Emit an event
   * @param {string} eventName - Event name
   * @param {*} payload - Event payload
   */
  emit(eventName, payload = null) {
    if (!this.enabled) {
      logger.debug('EventBus', 'EventBus is disabled, ignoring event', { eventName });
      return;
    }

    // Add to history
    this.addToHistory(eventName, payload);

    // Get listeners for exact match
    const exactListeners = this.listeners.get(eventName) || [];

    // Get listeners for wildcard matches (e.g., 'module:*' matches 'module:event')
    const wildcardListeners = [];
    for (const [pattern, listeners] of this.listeners.entries()) {
      if (pattern.includes('*') && this.matchesPattern(eventName, pattern)) {
        wildcardListeners.push(...listeners);
      }
    }

    // Combine and sort by priority
    const allListeners = [...exactListeners, ...wildcardListeners]
      .sort((a, b) => b.priority - a.priority);

    logger.debug('EventBus', `Emitting event: ${eventName}`, { 
      listenerCount: allListeners.length,
      payload: payload !== null ? (typeof payload === 'object' ? Object.keys(payload) : payload) : null
    });

    // Call all listeners
    for (const listener of allListeners) {
      try {
        listener.callback(payload, eventName);
      } catch (error) {
        logger.error('EventBus', `Error in event listener for ${eventName}`, { error, listenerId: listener.id });
      }
    }
  }

  /**
   * Check if event name matches a wildcard pattern
   */
  matchesPattern(eventName, pattern) {
    const patternParts = pattern.split(':');
    const eventParts = eventName.split(':');

    if (patternParts.length !== eventParts.length) {
      return false;
    }

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] !== '*' && patternParts[i] !== eventParts[i]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Add event to history
   */
  addToHistory(eventName, payload) {
    this.eventHistory.push({
      timestamp: Date.now(),
      eventName,
      payload: this.serializePayload(payload)
    });

    // Keep history size manageable
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  /**
   * Serialize payload for history (handle circular references)
   */
  serializePayload(payload) {
    if (payload === null || payload === undefined) {
      return payload;
    }

    try {
      // Try to serialize, but catch circular references
      return JSON.parse(JSON.stringify(payload, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          // Skip MediaStream, RTCPeerConnection, etc.
          if (value instanceof MediaStream || 
              value instanceof RTCPeerConnection ||
              value instanceof MediaStreamTrack) {
            return `[${value.constructor.name}]`;
          }
        }
        return value;
      }));
    } catch (error) {
      return '[Circular or non-serializable]';
    }
  }

  /**
   * Get event history
   */
  getHistory(filter = {}) {
    let history = [...this.eventHistory];

    if (filter.eventName) {
      history = history.filter(event => {
        if (filter.eventName.includes('*')) {
          return this.matchesPattern(event.eventName, filter.eventName);
        }
        return event.eventName === filter.eventName;
      });
    }

    if (filter.since) {
      history = history.filter(event => event.timestamp >= filter.since);
    }

    return history;
  }

  /**
   * Clear event history
   */
  clearHistory() {
    this.eventHistory = [];
    logger.debug('EventBus', 'Event history cleared');
  }

  /**
   * Remove all listeners for an event
   */
  off(eventName) {
    this.listeners.delete(eventName);
    logger.debug('EventBus', `Removed all listeners for event: ${eventName}`);
  }

  /**
   * Remove all listeners
   */
  removeAllListeners() {
    this.listeners.clear();
    logger.debug('EventBus', 'Removed all listeners');
  }

  /**
   * Enable/disable event bus
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    logger.debug('EventBus', `EventBus ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get listener count for an event
   */
  getListenerCount(eventName) {
    return (this.listeners.get(eventName) || []).length;
  }
}

// Export singleton instance
export const eventBus = new EventBus();
export default eventBus;

