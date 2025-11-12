// Centralized reactive state manager with event emission and subscription system
import { logger } from './Logger.js';
import { eventBus } from './EventBus.js';

class StateManager {
  constructor() {
    this.state = {
      // Connection state
      socketId: null,
      roomId: null,
      isHost: false,
      connectionState: 'disconnected', // 'disconnected' | 'connecting' | 'connected' | 'failed'
      
      // Media state
      localStream: null,
      cameraTrack: null,
      screenTrack: null,
      isCameraOn: false,
      isMicOn: false,
      isScreenSharing: false,
      audioOnlyMode: false,
      viewOnlyMode: false,
      
      // Peer state
      peers: new Map(), // peerId -> { connection, tracks, state, metadata }
      
      // UI state
      pinnedParticipant: null,
      layoutMode: 'grid',
      
      // Device state
      devices: {
        camera: null,
        mic: null,
        speaker: null,
        available: {
          cameras: [],
          microphones: [],
          speakers: []
        }
      },
      
      // Room state
      room: {
        id: null,
        hostId: null,
        hostCode: null,
        participantCode: null,
        participants: new Map() // participantId -> { id, name, isHost, joinedAt }
      }
    };

    this.listeners = [];
    this.stateHistory = [];
    this.maxHistorySize = 100;
    this.batchUpdates = false;
    this.pendingUpdates = {};
  }

  /**
   * Get state value by path (supports dot notation)
   * @param {string} path - Path to state (e.g., 'room.id' or 'peers')
   * @returns {*} State value
   */
  getState(path = null) {
    if (!path) {
      return this.deepClone(this.state);
    }

    const keys = path.split('.');
    let value = this.state;

    for (const key of keys) {
      if (value === undefined || value === null) {
        return undefined;
      }
      value = value[key];
    }

    return this.deepClone(value);
  }

  /**
   * Set state value(s)
   * @param {Object|string} updates - Object with updates or path string
   * @param {*} value - Value if updates is a string path
   */
  setState(updates, value = undefined) {
    if (typeof updates === 'string') {
      // Single path update
      updates = { [updates]: value };
    }

    const changes = {};
    const oldState = this.deepClone(this.state);

    // Apply updates
    for (const [path, newValue] of Object.entries(updates)) {
      const oldValue = this.getState(path);
      
      if (this.deepEqual(oldValue, newValue)) {
        continue; // No change
      }

      this.setNestedState(path, newValue);
      changes[path] = { old: oldValue, new: newValue };
    }

    if (Object.keys(changes).length === 0) {
      return; // No changes
    }

    // Add to history
    this.addToHistory(changes, oldState);

    // Emit change events
    this.emitChangeEvents(changes);

    // Notify listeners
    this.notifyListeners(changes);

    logger.debug('StateManager', 'State updated', { 
      paths: Object.keys(changes),
      changes: Object.keys(changes).reduce((acc, path) => {
        acc[path] = { old: changes[path].old, new: changes[path].new };
        return acc;
      }, {})
    });
  }

  /**
   * Set nested state value by path
   */
  setNestedState(path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    let target = this.state;

    for (const key of keys) {
      if (!target[key] || typeof target[key] !== 'object') {
        target[key] = {};
      }
      target = target[key];
    }

    target[lastKey] = value;
  }

  /**
   * Batch multiple state updates (emits single change event)
   */
  batch(callback) {
    this.batchUpdates = true;
    this.pendingUpdates = {};
    
    try {
      callback();
    } finally {
      this.batchUpdates = false;
      
      if (Object.keys(this.pendingUpdates).length > 0) {
        this.setState(this.pendingUpdates);
        this.pendingUpdates = {};
      }
    }
  }

  /**
   * Subscribe to state changes
   * @param {Function|string} callbackOrPath - Callback function or path to watch
   * @param {Function} callback - Callback function if first arg is path
   * @returns {Function} Unsubscribe function
   */
  subscribe(callbackOrPath, callback = null) {
    let path = null;
    let cb = callbackOrPath;

    if (typeof callbackOrPath === 'string' && callback) {
      path = callbackOrPath;
      cb = callback;
    }

    const listener = { callback: cb, path, id: Date.now() + Math.random() };
    this.listeners.push(listener);

    logger.debug('StateManager', 'Subscribed to state changes', { path, listenerId: listener.id });

    // Return unsubscribe function
    return () => {
      const index = this.listeners.findIndex(l => l.id === listener.id);
      if (index !== -1) {
        this.listeners.splice(index, 1);
        logger.debug('StateManager', 'Unsubscribed from state changes', { listenerId: listener.id });
      }
    };
  }

  /**
   * Notify all listeners of state changes
   */
  notifyListeners(changes) {
    for (const listener of this.listeners) {
      try {
        if (listener.path) {
          // Path-specific listener
          if (changes[listener.path]) {
            listener.callback(changes[listener.path].new, changes[listener.path].old, listener.path);
          }
        } else {
          // Global listener
          listener.callback(changes, this.getState());
        }
      } catch (error) {
        logger.error('StateManager', 'Error in state listener', { error, listenerId: listener.id });
      }
    }
  }

  /**
   * Emit change events via EventBus
   */
  emitChangeEvents(changes) {
    for (const [path, change] of Object.entries(changes)) {
      // Emit specific path event
      eventBus.emit(`state:${path}`, { path, value: change.new, oldValue: change.old });
      
      // Emit general state change event
      eventBus.emit('state:changed', { path, value: change.new, oldValue: change.old });
    }
  }

  /**
   * Add state change to history
   */
  addToHistory(changes, oldState) {
    this.stateHistory.push({
      timestamp: Date.now(),
      changes: this.deepClone(changes),
      stateSnapshot: this.deepClone(this.state)
    });

    // Keep history size manageable
    if (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory.shift();
    }
  }

  /**
   * Get state history
   */
  getHistory(filter = {}) {
    let history = [...this.stateHistory];

    if (filter.since) {
      history = history.filter(entry => entry.timestamp >= filter.since);
    }

    if (filter.path) {
      history = history.filter(entry => 
        Object.keys(entry.changes).some(p => p.startsWith(filter.path))
      );
    }

    return history;
  }

  /**
   * Clear state history
   */
  clearHistory() {
    this.stateHistory = [];
    logger.debug('StateManager', 'State history cleared');
  }

  /**
   * Reset state to initial values
   */
  reset() {
    const oldState = this.deepClone(this.state);
    this.state = {
      socketId: null,
      roomId: null,
      isHost: false,
      connectionState: 'disconnected',
      localStream: null,
      cameraTrack: null,
      screenTrack: null,
      isCameraOn: false,
      isMicOn: false,
      isScreenSharing: false,
      audioOnlyMode: false,
      viewOnlyMode: false,
      peers: new Map(),
      pinnedParticipant: null,
      layoutMode: 'grid',
      devices: {
        camera: null,
        mic: null,
        speaker: null,
        available: {
          cameras: [],
          microphones: [],
          speakers: []
        }
      },
      room: {
        id: null,
        hostId: null,
        hostCode: null,
        participantCode: null,
        participants: new Map()
      }
    };

    this.setState({}); // Trigger change events
    logger.info('StateManager', 'State reset to initial values');
  }

  /**
   * Deep clone an object
   */
  deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (obj instanceof Map) {
      return new Map(obj);
    }

    if (obj instanceof Set) {
      return new Set(obj);
    }

    if (obj instanceof Date) {
      return new Date(obj);
    }

    if (obj instanceof MediaStream || 
        obj instanceof RTCPeerConnection ||
        obj instanceof MediaStreamTrack) {
      return obj; // Don't clone WebRTC objects
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.deepClone(item));
    }

    const cloned = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = this.deepClone(obj[key]);
      }
    }

    return cloned;
  }

  /**
   * Deep equality check
   */
  deepEqual(a, b) {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;

    if (a instanceof Map && b instanceof Map) {
      if (a.size !== b.size) return false;
      for (const [key, value] of a) {
        if (!b.has(key) || !this.deepEqual(value, b.get(key))) {
          return false;
        }
      }
      return true;
    }

    if (typeof a === 'object') {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      if (keysA.length !== keysB.length) return false;

      for (const key of keysA) {
        if (!keysB.includes(key) || !this.deepEqual(a[key], b[key])) {
          return false;
        }
      }
      return true;
    }

    return false;
  }
}

// Export singleton instance
export const stateManager = new StateManager();
export default stateManager;

