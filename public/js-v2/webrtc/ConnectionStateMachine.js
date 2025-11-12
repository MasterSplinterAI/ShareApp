// Connection state machine with explicit states and transitions
import { logger } from '../core/Logger.js';
import { eventBus } from '../core/EventBus.js';

class ConnectionStateMachine {
  constructor(peerId) {
    this.peerId = peerId;
    this.state = 'idle';
    this.transitions = {
      idle: ['connecting'],
      connecting: ['connected', 'failed', 'disconnected'],
      connected: ['disconnected', 'failed', 'reconnecting'],
      reconnecting: ['connected', 'failed', 'disconnected'],
      disconnected: ['connecting', 'idle'],
      failed: ['connecting', 'idle']
    };
    this.retryCount = 0;
    this.maxRetries = 3;
    this.retryDelay = 2000;
    this.retryTimer = null;
  }

  /**
   * Transition to a new state
   */
  transition(newState, reason = null) {
    const validTransitions = this.transitions[this.state];
    
    if (!validTransitions || !validTransitions.includes(newState)) {
      logger.warn('ConnectionStateMachine', `Invalid transition from ${this.state} to ${newState}`, {
        peerId: this.peerId,
        currentState: this.state,
        attemptedState: newState,
        validTransitions
      });
      return false;
    }

    const oldState = this.state;
    this.state = newState;

    logger.info('ConnectionStateMachine', `State transition: ${oldState} → ${newState}`, {
      peerId: this.peerId,
      reason
    });

    // Emit state change event
    eventBus.emit(`connection:state:${this.peerId}`, {
      peerId: this.peerId,
      oldState,
      newState,
      reason
    });

    // Handle state-specific logic
    this.handleStateChange(oldState, newState);

    return true;
  }

  /**
   * Handle state change
   */
  handleStateChange(oldState, newState) {
    // Clear retry timer on successful connection
    if (newState === 'connected') {
      this.retryCount = 0;
      this.clearRetryTimer();
    }

    // Handle failed state
    if (newState === 'failed') {
      if (this.retryCount < this.maxRetries) {
        this.scheduleRetry();
      } else {
        logger.warn('ConnectionStateMachine', 'Max retries reached', {
          peerId: this.peerId,
          retryCount: this.retryCount
        });
        eventBus.emit(`connection:maxRetries:${this.peerId}`, {
          peerId: this.peerId,
          retryCount: this.retryCount
        });
      }
    }
  }

  /**
   * Schedule retry
   */
  scheduleRetry() {
    this.clearRetryTimer();

    this.retryCount++;
    const delay = this.retryDelay * Math.pow(2, this.retryCount - 1); // Exponential backoff

    logger.info('ConnectionStateMachine', 'Scheduling retry', {
      peerId: this.peerId,
      retryCount: this.retryCount,
      delay
    });

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      eventBus.emit(`connection:retry:${this.peerId}`, {
        peerId: this.peerId,
        retryCount: this.retryCount
      });
    }, delay);
  }

  /**
   * Clear retry timer
   */
  clearRetryTimer() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /**
   * Get current state
   */
  getState() {
    return this.state;
  }

  /**
   * Check if state is valid
   */
  isValidState(state) {
    return Object.keys(this.transitions).includes(state);
  }

  /**
   * Check if transition is valid
   */
  canTransitionTo(newState) {
    const validTransitions = this.transitions[this.state];
    return validTransitions && validTransitions.includes(newState);
  }

  /**
   * Reset state machine
   */
  reset() {
    const oldState = this.state;
    this.state = 'idle';
    this.retryCount = 0;
    this.clearRetryTimer();

    logger.debug('ConnectionStateMachine', 'State machine reset', {
      peerId: this.peerId,
      oldState
    });
  }

  /**
   * Destroy state machine
   */
  destroy() {
    this.clearRetryTimer();
    this.state = 'idle';
    this.retryCount = 0;
  }
}

export default ConnectionStateMachine;

