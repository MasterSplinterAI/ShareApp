# WebRTC Application v2 - Parallel Rewrite

This is a parallel rewrite of the WebRTC application with clean architecture, modular design, and imperative command pattern.

## Architecture

### Core Modules (`core/`)
- **StateManager.js**: Centralized reactive state management
- **EventBus.js**: Pub/sub event system
- **CommandDispatcher.js**: Command pattern implementation
- **Logger.js**: Structured logging
- **Config.js**: Application configuration

### WebRTC Modules (`webrtc/`)
- **ConnectionManager.js**: Manages all peer connections
- **TrackManager.js**: Handles camera/screen track lifecycle
- **SignalingClient.js**: Socket.io wrapper for signaling
- **IceServersManager.js**: ICE server management
- **ConnectionStateMachine.js**: Connection lifecycle state machine

### Media Modules (`media/`)
- **MediaStreamFactory.js**: Creates/manages media streams
- **DeviceManager.js**: Device enumeration and selection
- **MediaConstraints.js**: Constraint management

### UI Modules (`ui/`)
- **VideoGrid.js**: Video tile management and layout
- **Controls.js**: Media control buttons
- **Layout.js**: Responsive layout system
- **Participants.js**: Participant list UI
- **Chat.js**: Chat UI

### Services (`services/`)
- **RoomService.js**: Room creation/joining logic
- **NotificationService.js**: Toast notifications

## Usage

To use the v2 implementation, add `?v2=true` to the URL or set a feature flag.

## Key Features

1. **Command Pattern**: All user actions flow through commands for easy debugging
2. **Reactive State**: State changes automatically trigger UI updates
3. **Event-Driven**: Loose coupling via event bus
4. **Modular**: Clear module boundaries and single responsibility
5. **Type-Safe**: Structured logging and error handling

## Debugging

In development mode, the application is exposed to `window.appV2`:

```javascript
// Get state
appV2.getState('roomId')

// Execute command
appV2.execute('toggleCamera')

// Get history
appV2.getHistory()
```

## Status

✅ Phase 1: Foundation - Complete
✅ Phase 2: WebRTC Core - Complete
✅ Phase 3: Media Layer - Complete
✅ Phase 4: UI Layer - Complete
✅ Phase 5: Integration - Complete

Ready for parallel testing!

