// Command pattern implementation for all user actions with logging and async execution
import { logger } from './Logger.js';
import { eventBus } from './EventBus.js';
import { stateManager } from './StateManager.js';

class CommandDispatcher {
  constructor() {
    this.commands = new Map();
    this.commandHistory = [];
    this.maxHistorySize = 500;
    this.executingCommands = new Set();
    this.commandQueue = [];
    this.isProcessingQueue = false;
  }

  /**
   * Register a command handler
   * @param {string} commandName - Command name
   * @param {Function} handler - Async command handler function
   * @param {Object} options - Command options (priority, canUndo, etc.)
   */
  register(commandName, handler, options = {}) {
    if (typeof handler !== 'function') {
      logger.error('CommandDispatcher', 'Handler must be a function', { commandName });
      return;
    }

    this.commands.set(commandName, {
      handler,
      options: {
        priority: 0,
        canUndo: false,
        requiresConnection: false,
        ...options
      }
    });

    logger.debug('CommandDispatcher', `Registered command: ${commandName}`, options);
  }

  /**
   * Execute a command
   * @param {string} commandName - Command name
   * @param {*} payload - Command payload
   * @returns {Promise<*>} Command result
   */
  async execute(commandName, payload = {}) {
    const command = this.commands.get(commandName);

    if (!command) {
      const error = new Error(`Command not found: ${commandName}`);
      logger.error('CommandDispatcher', error.message, { commandName, availableCommands: Array.from(this.commands.keys()) });
      throw error;
    }

    // Check if command is already executing
    if (this.executingCommands.has(commandName)) {
      logger.warn('CommandDispatcher', `Command already executing: ${commandName}, queuing...`);
      return new Promise((resolve, reject) => {
        this.commandQueue.push({ commandName, payload, resolve, reject });
        this.processQueue();
      });
    }

    // Check prerequisites
    if (command.options.requiresConnection) {
      const connectionState = stateManager.getState('connectionState');
      if (connectionState !== 'connected') {
        const error = new Error(`Command requires connection: ${commandName}`);
        logger.warn('CommandDispatcher', error.message, { connectionState });
        throw error;
      }
    }

    this.executingCommands.add(commandName);
    const startTime = Date.now();

    // Emit command start event
    eventBus.emit('command:start', { commandName, payload });

    try {
      logger.info('CommandDispatcher', `Executing command: ${commandName}`, { payload });

      // Execute command handler
      const result = await command.handler(payload, { stateManager, eventBus, logger });

      const duration = Date.now() - startTime;

      // Add to history
      this.addToHistory(commandName, payload, result, duration, null);

      // Emit command success event
      eventBus.emit('command:success', { commandName, payload, result, duration });

      logger.info('CommandDispatcher', `Command succeeded: ${commandName}`, { duration: `${duration}ms` });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Add to history
      this.addToHistory(commandName, payload, null, duration, error);

      // Emit command error event
      eventBus.emit('command:error', { commandName, payload, error, duration });

      logger.error('CommandDispatcher', `Command failed: ${commandName}`, { error, duration: `${duration}ms` });

      throw error;
    } finally {
      this.executingCommands.delete(commandName);
      this.processQueue();
    }
  }

  /**
   * Process command queue
   */
  async processQueue() {
    if (this.isProcessingQueue || this.commandQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.commandQueue.length > 0) {
      const { commandName, payload, resolve, reject } = this.commandQueue.shift();

      try {
        const result = await this.execute(commandName, payload);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * Add command to history
   */
  addToHistory(commandName, payload, result, duration, error) {
    this.commandHistory.push({
      timestamp: Date.now(),
      commandName,
      payload: this.serializePayload(payload),
      result: this.serializePayload(result),
      duration,
      error: error ? {
        message: error.message,
        stack: error.stack
      } : null
    });

    // Keep history size manageable
    if (this.commandHistory.length > this.maxHistorySize) {
      this.commandHistory.shift();
    }
  }

  /**
   * Serialize payload for history
   */
  serializePayload(payload) {
    if (payload === null || payload === undefined) {
      return payload;
    }

    try {
      return JSON.parse(JSON.stringify(payload, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          // Skip WebRTC objects
          if (value instanceof MediaStream || 
              value instanceof RTCPeerConnection ||
              value instanceof MediaStreamTrack) {
            return `[${value.constructor.name}]`;
          }
        }
        return value;
      }));
    } catch (error) {
      return '[Non-serializable]';
    }
  }

  /**
   * Get command history
   */
  getHistory(filter = {}) {
    let history = [...this.commandHistory];

    if (filter.commandName) {
      history = history.filter(cmd => cmd.commandName === filter.commandName);
    }

    if (filter.since) {
      history = history.filter(cmd => cmd.timestamp >= filter.since);
    }

    if (filter.errorsOnly) {
      history = history.filter(cmd => cmd.error !== null);
    }

    return history;
  }

  /**
   * Clear command history
   */
  clearHistory() {
    this.commandHistory = [];
    logger.debug('CommandDispatcher', 'Command history cleared');
  }

  /**
   * Check if command exists
   */
  hasCommand(commandName) {
    return this.commands.has(commandName);
  }

  /**
   * Get all registered commands
   */
  getCommands() {
    return Array.from(this.commands.keys());
  }

  /**
   * Unregister a command
   */
  unregister(commandName) {
    if (this.commands.delete(commandName)) {
      logger.debug('CommandDispatcher', `Unregistered command: ${commandName}`);
    }
  }
}

// Export singleton instance
export const commandDispatcher = new CommandDispatcher();
export default commandDispatcher;

