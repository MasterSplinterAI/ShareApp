// Socket service for handling real-time communication
import { createPeerConnection, handleRemoteOffer, handleRemoteAnswer, handleRemoteIceCandidate } from '../webrtc/peerConnection.js';
import { updateParticipantList } from '../ui/participants.js';
import { addChatMessage } from '../ui/chat.js';
import { updateConnectionStatus } from '../ui/notifications.js';
import { debounce } from '../utils/helpers.js';

let socket;

// Create debounced version of media refresh function
const debouncedRefreshMedia = debounce(async () => {
  try {
    const { debouncedRefreshMediaDisplays } = await import('../ui/video.js');
    if (typeof debouncedRefreshMediaDisplays === 'function') {
      debouncedRefreshMediaDisplays();
    }
  } catch (err) {
    console.warn('Error in debounced media refresh:', err);
  }
}, 500);

// Create a debounced version of forceFullMeshConnections
export const debouncedForceFullMeshConnections = debounce(forceFullMeshConnections, 5000);

export function setupSocketListeners() {
  // Initialize Socket.io connection
  // Check if io is available (loaded from socket.io.js script)
  if (typeof io === 'undefined') {
    console.error('Socket.io library not loaded. Make sure /socket.io/socket.io.js is included before this script.');
    // Try to wait a bit and retry
    setTimeout(() => {
      if (typeof io !== 'undefined') {
        setupSocketListeners();
      } else {
        console.error('Socket.io still not available after retry');
      }
    }, 1000);
    return;
  }
  
  socket = io();
  
  // Connection status handlers
  socket.on('connect', () => {
    console.log('Connected to server with ID:', socket.id);
    updateConnectionStatus('connected');
    
    // Set up periodic connection check
    if (!window.connectionCheckInterval) {
      window.connectionCheckInterval = setInterval(() => {
        if (window.appState.roomId) {
          // Check if we have enough participants
          const participantCount = Object.keys(window.appState.participants || {}).length;
          
          if (participantCount > 1) {
            console.log('Running periodic connection check');
            forceFullMeshConnections();
          } else {
            console.log('Only one participant, skipping mesh connection check');
          }
        }
      }, 30000); // Check every 30 seconds
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Disconnected from server');
    updateConnectionStatus('disconnected');
    
    // Clear connection check interval
    if (window.connectionCheckInterval) {
      clearInterval(window.connectionCheckInterval);
      window.connectionCheckInterval = null;
    }
  });
  
  socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    updateConnectionStatus('error');
  });
  
  // Room event handlers
  // Handle join errors (e.g., invalid access code)
  socket.on('join-error', async (data) => {
    console.error('Join error:', data);
    
    // If it's an access code error, prompt for access code and retry
    if (data.error === 'INVALID_ACCESS_CODE' || data.error === 'INVALID_HOST_CODE') {
      // Import the prompt function
      try {
        const { promptForAccessCode } = await import('../ui/events.js');
        const mode = data.error === 'INVALID_HOST_CODE' ? 'host' : 'participant';
        const accessCode = await promptForAccessCode(mode);
        
        if (accessCode) {
          // Retry join with access code
          const roomId = window.appState.roomId;
          if (roomId) {
            // Get current user name from participants or prompt
            let userName = 'Guest';
            if (window.appState.participants && window.appState.participants[socket.id]) {
              userName = window.appState.participants[socket.id].name;
            } else {
              // Try to get from localStorage
              userName = localStorage.getItem('username') || 'Guest';
            }
            
            // Determine if joining as host based on error type
            const isHost = data.error === 'INVALID_HOST_CODE';
            
            joinRoom(roomId, { userName: userName, accessCode: accessCode, isHost: isHost });
            return; // Don't show error, retrying
          }
        }
      } catch (err) {
        console.error('Error importing promptForAccessCode:', err);
      }
    }
    
    // Show error for other cases or if user cancelled
    showError(data.message || 'Failed to join meeting. Please try again.');
    // Reset connection status
    updateConnectionStatus('idle');
    // Return to home screen
    document.getElementById('home').classList.remove('hidden');
    document.getElementById('meeting').classList.add('hidden');
  });
  
  socket.on('room-joined', (data) => {
    console.log('Joined room:', data);
    window.appState.roomId = data.roomId;
    
    // Update participant list
    window.appState.participants = {};
    data.participants.forEach(participant => {
      window.appState.participants[participant.id] = participant;
      
      // If this participant is the host, set them as the pinned participant
      if (participant.isHost && participant.id !== socket.id) {
        console.log(`Setting host ${participant.id} as pinned participant`);
        window.appState.pinnedParticipant = participant.id;
        
        // Wait a short time for UI to be ready before triggering the event
        setTimeout(() => {
          document.dispatchEvent(new CustomEvent('pinned-participant-changed'));
        }, 500);
      }
    });
    
    // Mark self as host if appropriate
    if (data.hostId === socket.id) {
      window.appState.isHost = true;
      
      // If we're the host, pin ourselves
      window.appState.pinnedParticipant = 'local';
      
      // Wait a short time for UI to be ready before triggering the event
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent('pinned-participant-changed'));
      }, 500);
    }
    
    // Update UI with participants
    updateParticipantList();
    
    // Show connection status as active
    updateConnectionStatus('active');
    
    // SIMPLE MESH NETWORKING: Connect to all existing participants
    console.log('Establishing connections with all existing participants');
    
    // Get all participants except ourselves
    const otherParticipants = data.participants.filter(p => p.id !== socket.id);
    console.log(`Found ${otherParticipants.length} other participants to connect with`);
    
    if (otherParticipants.length > 0) {
      // Import dynamically to avoid circular dependencies
      import('../webrtc/peerConnection.js').then(({ createPeerConnection }) => {
        if (typeof createPeerConnection === 'function') {
          // Connect to each participant with a small delay between connections
          otherParticipants.forEach(async (participant, index) => {
            // Add a small delay for each connection to prevent race conditions
            setTimeout(async () => {
              console.log(`Creating direct connection to participant ${participant.id}`);
              try {
                await createPeerConnection(participant.id);
              } catch (err) {
                console.error(`Failed to create connection to ${participant.id}:`, err);
              }
            }, index * 500); // Stagger connections by 500ms each
          });
        }
      }).catch(err => {
        console.error('Failed to import peerConnection.js:', err);
      });
    }
  });
  
  socket.on('user-joined', (data) => {
    console.log('User joined:', data);
    
    // Check for any existing containers for this user before adding them
    // This helps prevent duplicate containers
    const existingContainers = [
      document.getElementById(`video-container-${data.userId}`),
      document.getElementById(`participant-${data.userId}`)
    ].filter(Boolean);
    
    if (existingContainers.length > 1) {
      console.log(`Found ${existingContainers.length} containers for user ${data.userId}, cleaning up duplicates`);
      
      // Keep only the first container and remove others
      for (let i = 1; i < existingContainers.length; i++) {
        console.log(`Removing duplicate container for ${data.userId}`);
        existingContainers[i].remove();
      }
    }
    
    // Add to participants list
    window.appState.participants[data.userId] = {
      id: data.userId,
      name: data.name,
      isHost: data.isHost
    };
    
    // If this is the host joining and we don't have a pinned participant yet or we're showing local
    if (data.isHost && (window.appState.pinnedParticipant === 'local' || !window.appState.pinnedParticipant)) {
      // Pin the host's video
      console.log(`Setting host ${data.userId} as pinned participant`);
      window.appState.pinnedParticipant = data.userId;
      
      // Wait a short time for WebRTC to be ready
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent('pinned-participant-changed'));
      }, 1000);
    }
    
    // Update UI
    updateParticipantList();
    
    // Refresh the pin button handlers for mobile
    setTimeout(() => {
      try {
        // Import dynamically to avoid circular dependencies
        import('../ui/events.js').then(({ refreshPinButtonHandlers }) => {
          if (typeof refreshPinButtonHandlers === 'function') {
            console.log('Refreshing pin button handlers after new participant joined');
            refreshPinButtonHandlers();
          }
        }).catch(err => {
          console.warn('Could not refresh pin button handlers:', err);
        });
      } catch (error) {
        console.warn('Error refreshing pin button handlers:', error);
      }
    }, 1500); // Delay to allow DOM to update
    
    // Dispatch participant-joined event for screen share notifications
    document.dispatchEvent(new CustomEvent('participant-joined', { 
      detail: { 
        participantId: data.userId,
        participantName: data.name
      }
    }));
    
    // Also dispatch user-joined-event for modern UI
    document.dispatchEvent(new CustomEvent('user-joined-event', {
      detail: {
        userId: data.userId,
        name: data.name,
        isHost: data.isHost
      }
    }));
    
    // Track if we need to update media for screen sharing
    const isLocalScreenSharing = window.appState.isScreenSharing && window.appState.screenStream;
    
    // Import dynamically to avoid circular dependencies
    import('../webrtc/peerConnection.js').then(({ createPeerConnection }) => {
      if (typeof createPeerConnection === 'function') {
        // IMPORTANT: Always attempt to connect to the new participant
        // This ensures a full mesh network
        if (data.userId !== socket.id && !window.appState.peerConnections[data.userId]) {
          console.log(`Creating direct connection to new participant ${data.userId}`);
          setTimeout(async () => {
            try {
              await createPeerConnection(data.userId);
            } catch (err) {
              console.error(`Failed to create connection to ${data.userId}:`, err);
            }
            
            // If we're sharing our screen, make sure the new participant receives it
            if (isLocalScreenSharing) {
              setTimeout(() => {
                console.log(`Updating screen share for new participant: ${data.userId}`);
                import('../services/media.js').then(({ updateScreenShareForNewParticipant }) => {
                  if (typeof updateScreenShareForNewParticipant === 'function') {
                    updateScreenShareForNewParticipant(data.userId);
                  } else {
                    // Fallback to refreshing screen share for everyone
                    import('../services/media.js').then(({ refreshScreenSharing }) => {
                      if (typeof refreshScreenSharing === 'function') {
                        refreshScreenSharing();
                      }
                    });
                  }
                });
              }, 2000); // Wait longer for the connection to initialize
            }
            
            // Force full mesh connections after a delay
            // This ensures all participants can see and hear each other
            setTimeout(() => {
              forceFullMeshConnections();
            }, 5000);
          }, 1000); // Small delay to ensure room state is updated
        }
      }
    }).catch(err => {
      console.error('Failed to import peerConnection.js:', err);
    });
  });
  
  socket.on('user-left', (data) => {
    console.log('User left:', data);
    
    // Remove from participants list
    delete window.appState.participants[data.userId];
    
    // Clean up peer connection using the cleanup function
    import('../webrtc/peerConnection.js').then(({ cleanupPeerConnection }) => {
      if (typeof cleanupPeerConnection === 'function') {
        cleanupPeerConnection(data.userId);
      } else {
        // Fallback to manual cleanup
        if (window.appState.peerConnections[data.userId]) {
          window.appState.peerConnections[data.userId].close();
          delete window.appState.peerConnections[data.userId];
        }
      }
    }).catch(() => {
      // Fallback if import fails
      if (window.appState.peerConnections[data.userId]) {
        window.appState.peerConnections[data.userId].close();
        delete window.appState.peerConnections[data.userId];
      }
    });
    
    // Remove all elements related to this participant
    const elementsToRemove = [
      // Video container by various possible IDs
      document.getElementById(`video-container-${data.userId}`),
      document.getElementById(`participant-${data.userId}`),
      
      // Dedicated video element
      document.getElementById(`video-${data.userId}`),
      
      // Dedicated audio element
      document.getElementById(`audio-${data.userId}`)
    ];
    
    // Remove each element if it exists
    elementsToRemove.forEach(element => {
      if (element) {
        console.log(`Removing element ${element.id} for departed participant ${data.userId}`);
        element.remove();
      }
    });
    
    // Check if pinned user left
    if (window.appState.pinnedParticipant === data.userId) {
      window.appState.pinnedParticipant = 'local';
      document.dispatchEvent(new CustomEvent('pinned-participant-changed'));
    }
    
    // Update UI
    updateParticipantList();
  });
  
  socket.on('host-changed', (data) => {
    console.log('Host changed:', data);
    
    // Update host status in participants list
    if (window.appState.participants[data.newHostId]) {
      window.appState.participants[data.newHostId].isHost = true;
    }
    
    // Update self if we're the new host
    if (data.newHostId === socket.id) {
      window.appState.isHost = true;
    }
    
    // Update UI
    updateParticipantList();
  });
  
  // WebRTC signaling handlers
  socket.on('offer', (data) => {
    console.log('Received offer from:', data.senderId);
    
    // Import dynamically to avoid circular dependencies
    import('../webrtc/peerConnection.js').then(({ handleRemoteOffer }) => {
      if (typeof handleRemoteOffer === 'function') {
        handleRemoteOffer(data.senderId, data.sdp, data.renegotiation)
          .then(() => {
            // Only refresh displays for the first connection, not for renegotiations
            if (!data.renegotiation) {
              debouncedRefreshMedia();
            }
          })
          .catch(err => {
            console.error('Error handling WebRTC offer:', err);
          });
      }
    }).catch(err => {
      console.error('Failed to import peerConnection.js:', err);
    });
  });
  
  socket.on('answer', (data) => {
    console.log('Received answer from:', data.senderId);
    
    // Import dynamically to avoid circular dependencies
    import('../webrtc/peerConnection.js').then(({ handleRemoteAnswer }) => {
      if (typeof handleRemoteAnswer === 'function') {
        handleRemoteAnswer(data.senderId, data.sdp)
          .then(() => {
            // Use debounced refresh to prevent screen flashing
            debouncedRefreshMedia();
          })
          .catch(err => {
            console.error('Error handling WebRTC answer:', err);
          });
      }
    }).catch(err => {
      console.error('Failed to import peerConnection.js:', err);
    });
  });
  
  socket.on('ice-candidate', (data) => {
    console.log('Received ICE candidate from:', data.senderId);
    
    // Import dynamically to avoid circular dependencies
    import('../webrtc/peerConnection.js').then(({ handleRemoteIceCandidate }) => {
      if (typeof handleRemoteIceCandidate === 'function') {
        handleRemoteIceCandidate(data.senderId, data.candidate)
          .catch(err => {
            console.error('Error handling ICE candidate:', err);
          });
      }
    }).catch(err => {
      console.error('Failed to import peerConnection.js:', err);
    });
  });
  
  // Chat handler
  socket.on('chat-message', (data) => {
    console.log('Received chat message:', data);
    addChatMessage(data.senderId, data.senderName, data.message, false);
  });
}

// Join a room with optional parameters
export function joinRoom(roomId, options = {}) {
  if (!socket) {
    console.error('Socket not initialized');
    return;
  }
  
  const joinData = {
    roomId: roomId,
    isHost: options.isHost || false,
    userName: options.userName || 'Guest',
    accessCode: options.accessCode || null,
    roomAccessCode: options.roomAccessCode || null,
    roomHostCode: options.roomHostCode || null
  };
  
  console.log('Joining room with data:', joinData);
  socket.emit('join', joinData);
  updateConnectionStatus('connecting');
  
  // After a short delay, refresh all media displays to ensure proper rendering
  // Use a single timeout instead of nested ones
  setTimeout(async () => {
    try {
      // Import function dynamically to avoid circular dependencies
      const { debouncedRefreshMediaDisplays } = await import('../ui/video.js');
      if (typeof debouncedRefreshMediaDisplays === 'function') {
        debouncedRefreshMediaDisplays();
      }
      
      // Check for missing connections after a delay to ensure all participants are loaded
      // Use the debounced version to prevent excessive reconnections
      debouncedForceFullMeshConnections();
    } catch (err) {
      console.warn('Could not refresh media displays after joining:', err);
    }
  }, 3000);
}

// Leave the current room
export function leaveRoom() {
  if (!socket || !window.appState.roomId) {
    return;
  }
  
  console.log('Leaving room:', window.appState.roomId);
  socket.emit('leave');
  
  // Reset state
  window.appState.roomId = null;
  window.appState.isHost = false;
  window.appState.participants = {};
  
  // Clean up peer connections
  Object.keys(window.appState.peerConnections).forEach(peerId => {
    window.appState.peerConnections[peerId].close();
  });
  window.appState.peerConnections = {};
  
  updateConnectionStatus('idle');
}

// Send WebRTC offer to peer
export function sendOffer(targetUserId, sdp, isRenegotiation = false) {
  if (!socket || !window.appState.roomId) {
    console.error('Cannot send offer - not connected to room');
    return;
  }
  
  socket.emit('offer', {
    roomId: window.appState.roomId,
    targetUserId: targetUserId,
    sdp: sdp,
    renegotiation: isRenegotiation
  });
}

// Send renegotiation offer specifically (for media changes)
export function sendRenegotiationOffer(targetUserId, sdp) {
  if (!socket || !window.appState.roomId) {
    console.error('Cannot send renegotiation offer - not connected to room');
    return;
  }
  
  console.log(`Sending renegotiation offer to ${targetUserId}`);
  
  socket.emit('offer', {
    roomId: window.appState.roomId,
    targetUserId: targetUserId,
    sdp: sdp,
    renegotiation: true
  });
}

// Special function for screen sharing renegotiation - ensures video tracks can be received
export function sendScreenSharingOffer(targetUserId, sdp) {
  if (!socket || !window.appState.roomId) {
    console.error('Cannot send screen sharing offer - not connected to room');
    return;
  }
  
  console.log(`Sending screen sharing offer to ${targetUserId}`);
  
  // Mark this as a special screen sharing renegotiation
  socket.emit('offer', {
    roomId: window.appState.roomId,
    targetUserId: targetUserId,
    sdp: sdp,
    renegotiation: true,
    screenSharing: true
  });
  
  // Force a refresh of the media displays after a short delay but use debounced version
  setTimeout(() => {
    debouncedRefreshMedia();
  }, 1000);
}

// Send WebRTC answer to peer
export function sendAnswer(targetUserId, sdp) {
  if (!socket || !window.appState.roomId) {
    console.error('Cannot send answer - not connected to room');
    return;
  }
  
  socket.emit('answer', {
    roomId: window.appState.roomId,
    targetUserId: targetUserId,
    sdp: sdp
  });
}

// Send ICE candidate to peer
export function sendIceCandidate(targetUserId, candidate) {
  if (!socket || !window.appState.roomId) {
    console.error('Cannot send ICE candidate - not connected to room');
    return;
  }
  
  socket.emit('ice-candidate', {
    roomId: window.appState.roomId,
    targetUserId: targetUserId,
    candidate: candidate
  });
}

// Send chat message to all participants
export function sendChatMessage(message) {
  if (!socket || !window.appState.roomId) {
    console.error('Cannot send message - not connected to room');
    return;
  }
  
  socket.emit('chat-message', {
    roomId: window.appState.roomId,
    message: message
  });
}

// Get the socket ID
export function getSocketId() {
  return socket ? socket.id : null;
}

// Refresh all media displays
export async function refreshAllMedia() {
  // Use the debounced version to avoid flashing
  debouncedRefreshMedia();
  return true;
}

// Check for missing peer connections and establish them if needed
export function checkAndEstablishMissingConnections() {
  console.log('Checking for missing peer connections');
  
  if (!window.appState.roomId) {
    console.log('Not in a room, skipping connection check');
    return Promise.resolve(false);
  }
  
  // Get all participants except ourselves
  const otherParticipants = Object.values(window.appState.participants)
    .filter(p => p.id !== socket.id);
  
  console.log(`Found ${otherParticipants.length} other participants to check connections with`);
  
  if (otherParticipants.length === 0) {
    console.log('No other participants to connect with');
    return Promise.resolve(false);
  }
  
  // Import dynamically to avoid circular dependencies
  return import('../webrtc/peerConnection.js').then(({ createPeerConnection }) => {
    if (typeof createPeerConnection === 'function') {
      let connectionsCreated = false;
      
          // Check each participant and create missing connections
          otherParticipants.forEach(async (participant, index) => {
            // Check if we already have a connection with this participant
            const hasConnection = window.appState.peerConnections[participant.id] !== undefined;
            
            if (!hasConnection) {
              console.log(`Missing connection with participant ${participant.id}, establishing now`);
              
              // Add a small delay for each connection to prevent race conditions
              setTimeout(async () => {
                try {
                  await createPeerConnection(participant.id);
                } catch (err) {
                  console.error(`Failed to create connection to ${participant.id}:`, err);
                }
              }, index * 300);
              
              connectionsCreated = true;
            } else {
              console.log(`Connection with ${participant.id} already exists`);
            }
          });
      
      return connectionsCreated;
    }
    return false;
  }).catch(err => {
    console.warn('Failed to check for missing connections:', err);
    return false;
  });
}

// Force full mesh connections between all participants
export function forceFullMeshConnections() {
  if (!window.appState.roomId) {
    console.log('Not in a room, cannot establish connections');
    return Promise.resolve(false);
  }
  
  console.log('Forcing establishment of full mesh connections between all participants');
  
  // Import dynamically to avoid circular dependencies
  return import('../webrtc/peerConnection.js').then(({ establishFullMeshConnections }) => {
    if (typeof establishFullMeshConnections === 'function') {
      establishFullMeshConnections();
      
      // Refresh video displays but with a delay to avoid flashing
      setTimeout(() => {
        debouncedRefreshMedia();
      }, 1000);
      
      return true;
    }
    return false;
  }).catch(err => {
    console.error('Failed to establish full mesh connections:', err);
    return false;
  });
}

// Set up a periodic connection check to ensure all peers are connected
function setupPeriodicConnectionCheck() {
  // Run every 30 seconds instead of 10
  setInterval(() => {
    console.log('Running periodic connection check');
    
    // Only force reconnections if we have participants and are in a room
    if (window.appState.roomId && Object.keys(window.appState.participants || {}).length > 0) {
      // Use the debounced version to prevent excessive reconnections
      debouncedForceFullMeshConnections();
    }
  }, 30000); // Every 30 seconds instead of 10
}