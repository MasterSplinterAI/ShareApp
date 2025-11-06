// Vue Composable for Socket.io Integration
import { onMounted, onUnmounted } from 'vue'
import { appState } from './useAppState.js'
import { createPeerConnection, handleRemoteOffer, handleRemoteAnswer, handleRemoteIceCandidate } from '../../webrtc/peerConnection.js'

let socket = null
let connectionCheckInterval = null

// CRITICAL: Export socket so socket.js functions can access it
// We'll set this globally so the classic socket.js module can use it
if (typeof window !== 'undefined') {
  window.__vueSocket = null
}

export function useSocket() {
  const connect = () => {
    if (typeof io === 'undefined') {
      console.error('Socket.io library not loaded')
      setTimeout(() => {
        if (typeof io !== 'undefined') {
          connect()
        }
      }, 1000)
      return
    }

    // Configure socket.io with proper options for production
    socket = io({
      transports: ['polling', 'websocket'],
      upgrade: true,
      rememberUpgrade: true,
      // For production with Apache proxy
      path: '/socket.io/',
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    })

    // CRITICAL: Set socket globally so socket.js functions can access it
    if (typeof window !== 'undefined') {
      window.__vueSocket = socket
      // Also try to set it on the socket.js module's socket variable
      // Import socket.js and set its socket variable
      import('../../services/socket.js').then(socketModule => {
        // Set socket via a setter if available, or directly if exported
        if (socketModule.setSocket) {
          socketModule.setSocket(socket)
        } else {
          // Try to access the internal socket variable
          try {
            socketModule._setSocket(socket)
          } catch (e) {
            // Fallback: use window global
            console.log('Using window.__vueSocket for socket.js compatibility')
          }
        }
      }).catch(e => {
        console.log('Could not import socket.js module, using window global')
      })
    }

    socket.on('connect', () => {
      console.log('Connected to server with ID:', socket.id)
      
      // Set up periodic connection check
      if (!connectionCheckInterval) {
        connectionCheckInterval = setInterval(() => {
          if (appState.roomId) {
            const participantCount = Object.keys(appState.participants || {}).length
            if (participantCount > 1) {
              // Force full mesh connections if needed
              console.log('Running periodic connection check')
            }
          }
        }, 30000)
      }
    })

    socket.on('disconnect', () => {
      console.log('Disconnected from server')
      if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval)
        connectionCheckInterval = null
      }
    })

    socket.on('connect_error', (error) => {
      console.error('Connection error:', error)
    })

    // Room event handlers
    socket.on('room-joined', async (data) => {
      console.log('Room joined:', data)
      appState.roomId = data.roomId
      appState.isHost = data.isHost || false
      
      // IMPORTANT: Sync roomId to window.appState immediately for WebRTC functions
      if (typeof window !== 'undefined' && window.appState) {
        window.appState.roomId = data.roomId
        window.appState.isHost = data.isHost || false
      }
      
      // Store participants - ensure participants is an object
      if (!appState.participants || typeof appState.participants !== 'object') {
        appState.participants = {}
      }
      if (typeof window !== 'undefined' && window.appState) {
        if (!window.appState.participants || typeof window.appState.participants !== 'object') {
          window.appState.participants = {}
        }
      }
      
      if (data.participants && Array.isArray(data.participants)) {
        // Convert array to object format
        const participantsObj = {}
        data.participants.forEach(p => {
          if (p && p.id) {
            participantsObj[p.id] = p
          }
        })
        Object.assign(appState.participants, participantsObj)
        if (typeof window !== 'undefined' && window.appState) {
          Object.assign(window.appState.participants, participantsObj)
        }
      }

      // Create peer connections for existing participants
      // Don't create connection to ourselves
      if (data.participants && Array.isArray(data.participants)) {
        const currentSocketId = socket.id
        const otherParticipants = data.participants.filter(p => {
          if (!p || !p.id) return false
          // Don't create peer connection to ourselves
          if (p.id === currentSocketId) return false
          // Check if peer connection already exists
          if (appState.peerConnections && appState.peerConnections[p.id]) {
            return false
          }
          return true
        })
        
        for (const participant of otherParticipants) {
          try {
            await createPeerConnection(participant.id)
          } catch (error) {
            console.error(`Error creating peer connection for ${participant.id}:`, error)
          }
        }
      }
    })

    socket.on('user-joined', async (data) => {
      console.log('User joined:', data)
      
      // Don't add ourselves to participants
      if (data.userId === socket.id) {
        return
      }
      
      // Ensure participants object exists
      if (!appState.participants || typeof appState.participants !== 'object') {
        appState.participants = {}
      }
      
      appState.participants[data.userId] = {
        id: data.userId,
        name: data.userName,
        isHost: data.isHost,
      }
      
      // Sync to window.appState
      if (typeof window !== 'undefined' && window.appState) {
        if (!window.appState.participants || typeof window.appState.participants !== 'object') {
          window.appState.participants = {}
        }
        window.appState.participants[data.userId] = appState.participants[data.userId]
      }
      
      // Create peer connection for new user (if not ourselves)
      if (data.userId !== socket.id) {
        try {
          await createPeerConnection(data.userId)
        } catch (error) {
          console.error(`Error creating peer connection for ${data.userId}:`, error)
        }
      }
    })

    socket.on('user-left', (data) => {
      console.log('User left:', data)
      delete appState.participants[data.userId]
    })

    socket.on('join-error', (data) => {
      console.error('Join error:', data)
      alert(`Join failed: ${data.message || data.error}`)
    })

    // WebRTC signaling handlers
    socket.on('offer', async (data) => {
      await handleRemoteOffer(data.from, data.offer)
    })

    socket.on('answer', async (data) => {
      await handleRemoteAnswer(data.from, data.answer)
    })

    socket.on('ice-candidate', async (data) => {
      await handleRemoteIceCandidate(data.from, data.candidate)
    })

    // Listen for peer track events (from peerConnection.js)
    document.addEventListener('peer-track-received', (event) => {
      const { peerId, stream } = event.detail
      const pc = appState.peerConnections[peerId]
      if (pc) {
        // Store remote stream on peer connection for Vue components
        pc.remoteStream = stream
        // Trigger reactivity by updating participants
        if (appState.participants[peerId]) {
          appState.participants[peerId] = { ...appState.participants[peerId] }
        }
      }
    })
  }

  const joinRoom = (roomId, userName, accessCode = null, roomHostCode = null, roomAccessCode = null, isHost = false) => {
    if (!socket) {
      console.error('Socket not initialized')
      return
    }

    // Wait for socket to connect if not already connected
    if (!socket.connected) {
      socket.once('connect', () => {
        appState.userName = userName
        appState.roomId = roomId
        
        socket.emit('join', {
          roomId,
          userName,
          providedAccessCode: accessCode,
          roomHostCode,
          roomAccessCode,
          isHost: isHost || (roomHostCode !== null), // If roomHostCode is provided, likely hosting
        })
      })
      return
    }

    appState.userName = userName
    appState.roomId = roomId
    
    // CRITICAL: Sync to window.appState IMMEDIATELY before emitting join
    // This ensures WebRTC functions can access roomId
    if (typeof window !== 'undefined') {
      if (!window.appState) {
        window.appState = {}
      }
      window.appState.userName = userName
      window.appState.roomId = roomId
      // Also ensure other critical properties exist
      if (!window.appState.peerConnections) {
        window.appState.peerConnections = {}
      }
      if (!window.appState.participants) {
        window.appState.participants = {}
      }
    }

    socket.emit('join', {
      roomId,
      userName,
      providedAccessCode: accessCode,
      roomHostCode,
      roomAccessCode,
      isHost: isHost || (roomHostCode !== null), // If roomHostCode is provided, likely hosting
    })
  }

  const leaveRoom = () => {
    if (socket && socket.connected && appState.roomId) {
      socket.emit('leave', { roomId: appState.roomId })
    }
    
    appState.roomId = null
    appState.isHost = false
    appState.participants = {}
    appState.pinnedParticipant = 'local'
    
    // Clean up peer connections
    Object.keys(appState.peerConnections).forEach(peerId => {
      const pc = appState.peerConnections[peerId]
      if (pc) {
        pc.close()
      }
    })
    appState.peerConnections = {}
  }

  const sendChatMessage = (message) => {
    if (socket && socket.connected && appState.roomId) {
      socket.emit('chat-message', {
        roomId: appState.roomId,
        message,
      })
    }
  }

  // Initialize on mount
  onMounted(() => {
    connect()
  })

  // Cleanup on unmount
  onUnmounted(() => {
    if (connectionCheckInterval) {
      clearInterval(connectionCheckInterval)
    }
    if (socket) {
      socket.disconnect()
    }
  })

  return {
    socket: () => socket,
    joinRoom,
    leaveRoom,
    sendChatMessage,
  }
}

