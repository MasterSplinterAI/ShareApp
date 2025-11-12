// Application entry point - initializes core modules and sets up the application
import { logger } from './core/Logger.js';
import { config } from './core/Config.js';
import { eventBus } from './core/EventBus.js';
import { stateManager } from './core/StateManager.js';
import { commandDispatcher } from './core/CommandDispatcher.js';
import { registerCommands } from './core/commands.js';
import { signalingClient } from './webrtc/SignalingClient.js';
import { connectionManager } from './webrtc/ConnectionManager.js';
import { iceServersManager } from './webrtc/IceServersManager.js';
import { roomService } from './services/RoomService.js';

// Set logger context
logger.setContext({ 
  app: 'webrtc-v2',
  version: '2.0.0',
  environment: config.environment.isProduction ? 'production' : 'development'
});

class Application {
  constructor() {
    this.initialized = false;
    this.modules = new Map();
  }

  /**
   * Initialize the application
   */
  async initialize() {
    if (this.initialized) {
      logger.warn('Application', 'Application already initialized');
      return;
    }

    logger.info('Application', 'Initializing application...');

    try {
      // Initialize core modules
      await this.initializeCore();

      // Register commands
      registerCommands();

      // Initialize WebRTC modules
      await this.initializeWebRTC();

      // Initialize UI modules
      await this.initializeUI();

      // Set up event handlers
      this.setupEventHandlers();

      // Set up global error handlers
      this.setupErrorHandlers();

      // Set up state logging (for debugging)
      this.setupStateLogging();

      // Set up command logging (for debugging)
      this.setupCommandLogging();

      // Expose to window for debugging
      this.exposeToWindow();

      this.initialized = true;
      logger.info('Application', 'Application initialized successfully');

      // Emit ready event
      eventBus.emit('app:ready');

      return true;
    } catch (error) {
      logger.error('Application', 'Failed to initialize application', { error });
      throw error;
    }
  }

  /**
   * Initialize core modules
   */
  async initializeCore() {
    logger.debug('Application', 'Initializing core modules...');

    // Core modules are already instantiated as singletons
    // Just verify they're working
    logger.debug('Application', 'Core modules ready', {
      logger: typeof logger !== 'undefined',
      config: typeof config !== 'undefined',
      eventBus: typeof eventBus !== 'undefined',
      stateManager: typeof stateManager !== 'undefined',
      commandDispatcher: typeof commandDispatcher !== 'undefined'
    });
  }

  /**
   * Initialize WebRTC modules
   */
  async initializeWebRTC() {
    logger.debug('Application', 'Initializing WebRTC modules...');

    // Initialize ICE servers
    await iceServersManager.getIceServers();

    // Connect to signaling server
    await signalingClient.connect();

    logger.debug('Application', 'WebRTC modules initialized');
  }

  /**
   * Initialize UI modules
   */
  async initializeUI() {
    logger.debug('Application', 'Initializing UI modules...');

    // UI modules are auto-initialized when imported
    await import('./ui/VideoGrid.js');
    await import('./ui/Controls.js');
    await import('./ui/Layout.js');
    await import('./ui/Participants.js');
    await import('./ui/Chat.js');

    logger.debug('Application', 'UI modules initialized');
  }

  /**
   * Setup event handlers for WebRTC signaling
   */
  setupEventHandlers() {
    // Handle WebRTC offers
    eventBus.on('webrtc:offer', async (data) => {
      await connectionManager.handleOffer(data.senderId, data.sdp);
    });

    // Handle WebRTC answers
    eventBus.on('webrtc:answer', async (data) => {
      await connectionManager.handleAnswer(data.senderId, data.sdp);
    });

    // Handle ICE candidates
    eventBus.on('webrtc:iceCandidate', async (data) => {
      await connectionManager.handleIceCandidate(data.senderId, data.candidate);
    });

    // Handle user joined - create peer connection
    eventBus.on('room:userJoined', async (data) => {
      const socketId = stateManager.getState('socketId') || signalingClient.getSocketId();
      logger.info('Application', 'User joined event received', { 
        userId: data.userId, 
        name: data.name,
        mySocketId: socketId
      });
      
      if (data.userId !== socketId) {
        // Check if connection already exists
        const existingConnection = connectionManager.getConnection(data.userId);
        if (existingConnection) {
          logger.debug('Application', 'Connection already exists for user', { peerId: data.userId });
          return;
        }
        
        setTimeout(async () => {
          try {
            logger.info('Application', 'Creating connection to newly joined user', { peerId: data.userId });
            await connectionManager.createConnection(data.userId);
          } catch (error) {
            logger.error('Application', 'Failed to create connection to new user', { error });
          }
        }, 1000); // Increased delay to avoid race conditions
      } else {
        logger.debug('Application', 'Ignoring own user joined event');
      }
    });

    // Handle room joined - connect to all existing participants
    eventBus.on('room:joined', async (data) => {
      const socketId = stateManager.getState('socketId') || signalingClient.getSocketId();
      logger.info('Application', 'Room joined event received', { 
        socketId, 
        participantCount: data.participants?.length || 0,
        participants: data.participants?.map(p => ({ id: p.id, name: p.name })) || []
      });
      
      if (!data.participants || !Array.isArray(data.participants)) {
        logger.warn('Application', 'No participants array in room:joined event', { data });
        return;
      }
      
      const otherParticipants = data.participants.filter(p => p.id !== socketId);
      logger.info('Application', 'Connecting to existing participants', { 
        count: otherParticipants.length,
        participants: otherParticipants.map(p => ({ id: p.id, name: p.name }))
      });
      
      for (const participant of otherParticipants) {
        setTimeout(async () => {
          try {
            logger.info('Application', 'Creating connection to participant', { peerId: participant.id });
            await connectionManager.createConnection(participant.id);
          } catch (error) {
            logger.error('Application', 'Failed to create connection', { peerId: participant.id, error });
          }
        }, 500);
      }
    });

    logger.debug('Application', 'Event handlers set up');
  }

  /**
   * Set up global error handlers
   */
  setupErrorHandlers() {
    // Unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      logger.error('Application', 'Unhandled promise rejection', {
        reason: event.reason,
        promise: event.promise
      });
      eventBus.emit('app:error', { type: 'unhandledRejection', error: event.reason });
    });

    // Global errors
    window.addEventListener('error', (event) => {
      logger.error('Application', 'Global error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error
      });
      eventBus.emit('app:error', { type: 'error', error: event.error });
    });
  }

  /**
   * Set up state change logging (for debugging)
   */
  setupStateLogging() {
    if (config.get('logLevel') === 'debug') {
      stateManager.subscribe((changes) => {
        logger.debug('Application', 'State changed', { changes: Object.keys(changes) });
      });
    }
  }

  /**
   * Set up command logging (for debugging)
   */
  setupCommandLogging() {
    eventBus.on('command:start', ({ commandName, payload }) => {
      logger.debug('Application', `Command started: ${commandName}`, { payload });
    });

    eventBus.on('command:success', ({ commandName, duration }) => {
      logger.debug('Application', `Command succeeded: ${commandName}`, { duration });
    });

    eventBus.on('command:error', ({ commandName, error }) => {
      logger.error('Application', `Command failed: ${commandName}`, { error });
    });
  }

  /**
   * Expose application to window for debugging
   */
  exposeToWindow() {
    if (config.environment.isProduction) {
      return; // Don't expose in production
    }

    window.appV2 = {
      logger,
      config,
      eventBus,
      stateManager,
      commandDispatcher,
      signalingClient,
      connectionManager,
      roomService,
      getState: (path) => stateManager.getState(path),
      setState: (updates, value) => stateManager.setState(updates, value),
      execute: (command, payload) => commandDispatcher.execute(command, payload),
      getHistory: () => ({
        commands: commandDispatcher.getHistory(),
        events: eventBus.getHistory(),
        state: stateManager.getHistory()
      })
    };

    logger.debug('Application', 'Application exposed to window.appV2 for debugging');
  }

  /**
   * Register a module
   */
  registerModule(name, module) {
    this.modules.set(name, module);
    logger.debug('Application', `Registered module: ${name}`);
  }

  /**
   * Get a registered module
   */
  getModule(name) {
    return this.modules.get(name);
  }
}

// Create application instance
const app = new Application();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    app.initialize().catch(error => {
      console.error('Failed to initialize application:', error);
    });
  });
} else {
  app.initialize().catch(error => {
    console.error('Failed to initialize application:', error);
  });
}

// Export application instance
export default app;
export { logger, config, eventBus, stateManager, commandDispatcher };

