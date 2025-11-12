// Structured logging system with levels, module filtering, and context
class Logger {
  constructor() {
    this.logLevel = this.getLogLevel();
    this.logHistory = [];
    this.maxHistorySize = 1000;
    this.moduleFilters = new Set();
    this.context = {};
  }

  getLogLevel() {
    // Check URL parameter first
    const urlParams = new URLSearchParams(window.location.search);
    const level = urlParams.get('log');
    if (level) return level;

    // Check localStorage
    const stored = localStorage.getItem('logLevel');
    if (stored) return stored;

    // Default: 'info' in production, 'debug' in development
    return window.location.hostname === 'localhost' ? 'debug' : 'info';
  }

  setLogLevel(level) {
    this.logLevel = level;
    localStorage.setItem('logLevel', level);
  }

  setContext(context) {
    this.context = { ...this.context, ...context };
  }

  clearContext() {
    this.context = {};
  }

  shouldLog(level) {
    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  formatMessage(module, level, message, ...args) {
    const timestamp = new Date().toISOString();
    const contextStr = Object.keys(this.context).length > 0 
      ? ` [${Object.entries(this.context).map(([k, v]) => `${k}=${v}`).join(', ')}]`
      : '';
    return `[${timestamp}] [${module}] [${level.toUpperCase()}]${contextStr} ${message}`;
  }

  addToHistory(module, level, message, args) {
    this.logHistory.push({
      timestamp: Date.now(),
      module,
      level,
      message,
      args: args.map(arg => {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }),
      context: { ...this.context }
    });

    // Keep history size manageable
    if (this.logHistory.length > this.maxHistorySize) {
      this.logHistory.shift();
    }
  }

  debug(module, message, ...args) {
    if (!this.shouldLog('debug')) return;
    const formatted = this.formatMessage(module, 'debug', message, ...args);
    console.debug(formatted, ...args);
    this.addToHistory(module, 'debug', message, args);
  }

  info(module, message, ...args) {
    if (!this.shouldLog('info')) return;
    const formatted = this.formatMessage(module, 'info', message, ...args);
    console.info(formatted, ...args);
    this.addToHistory(module, 'info', message, args);
  }

  warn(module, message, ...args) {
    if (!this.shouldLog('warn')) return;
    const formatted = this.formatMessage(module, 'warn', message, ...args);
    console.warn(formatted, ...args);
    this.addToHistory(module, 'warn', message, args);
  }

  error(module, message, ...args) {
    if (!this.shouldLog('error')) return;
    const formatted = this.formatMessage(module, 'error', message, ...args);
    console.error(formatted, ...args);
    this.addToHistory(module, 'error', message, args);
  }

  getHistory(filter = {}) {
    let history = [...this.logHistory];

    if (filter.module) {
      history = history.filter(log => log.module === filter.module);
    }

    if (filter.level) {
      const levels = ['debug', 'info', 'warn', 'error'];
      const levelIndex = levels.indexOf(filter.level);
      history = history.filter(log => {
        const logLevelIndex = levels.indexOf(log.level);
        return logLevelIndex >= levelIndex;
      });
    }

    if (filter.since) {
      history = history.filter(log => log.timestamp >= filter.since);
    }

    return history;
  }

  clearHistory() {
    this.logHistory = [];
  }
}

// Export singleton instance
export const logger = new Logger();
export default logger;

