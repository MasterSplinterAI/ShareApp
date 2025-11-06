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
        // Convert array to object format, excluding self
        const currentSocketId = data.you || socket.id || null
        const participantsObj = {}
        data.participants.forEach(p => {
          if (p && p.id) {
            // Don't add self to participants (local video is handled separately)
            if (p.id !== currentSocketId && p.id !== 'local') {
              participantsObj[p.id] = p
            }
          }
        })
        appState.participants = participantsObj // Replace, don't merge
        if (typeof window !== 'undefined' && window.appState) {
          window.appState.participants = participantsObj
        }
        console.log(`Stored ${Object.keys(participantsObj).length} remote participants (excluded self: ${currentSocketId})`)
      }

      // Create peer connections for existing participants
      // Don't create connection to ourselves
      if (data.participants && Array.isArray(data.participants)) {
        // Use data.you first (most reliable), then socket.id as fallback
        const currentSocketId = data.you || socket.id || null
        if (!currentSocketId) {
          console.warn('Socket ID not available, skipping peer connection creation for now')
          console.log('data.you:', data.you, 'socket.id:', socket.id, 'participants:', data.participants)
          return
        }
        
        console.log(`Using socket ID: ${currentSocketId} (from data.you: ${data.you || 'none'}, socket.id: ${socket.id || 'none'})`)
        
        const otherParticipants = data.participants.filter(p => {
          if (!p || !p.id) {
            return false
          }
          // CRITICAL: Don't create peer connection to ourselves
          if (p.id === currentSocketId) {
            console.log(`🔴 Skipping self peer connection for ${p.id}`)
            return false
          }
          // Check if peer connection already exists
          if (appState.peerConnections && appState.peerConnections[p.id]) {
            return false
          }
          // Also check window.appState.peerConnections
          if (window.appState && window.appState.peerConnections && window.appState.peerConnections[p.id]) {
            return false
          }
          return true
        })
        
        console.log(`Creating peer connections for ${otherParticipants.length} remote participants (total: ${data.participants.length}, current: ${currentSocketId})`)
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
      const currentSocketId = socket.id || (appState.roomId && data.you) || null
      
      // Don't add ourselves to participants
      if (data.userId === currentSocketId || data.userId === 'local') {
        console.log(`Skipping self in user-joined (userId: ${data.userId}, currentSocketId: ${currentSocketId})`)
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
      if (data.userId !== currentSocketId) {
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
      console.error('Join error data:', JSON.stringify(data, null, 2))
      console.error('Join error details:', data)
      
      // Extract error message - handle both string and object formats
      let errorMessage = 'Failed to join room'
      if (typeof data === 'string') {
        errorMessage = data
      } else if (data && typeof data === 'object') {
        errorMessage = data.message || data.error || data.reason || JSON.stringify(data)
      }
      
      console.error('Join error message:', errorMessage)
      
      // Handle specific error cases
      if (errorMessage.includes('INVALID_ACCESS_CODE') || errorMessage.includes('INVALID_HOST_CODE') || errorMessage.includes('access code')) {
        alert(`Access denied: ${errorMessage}. Please check your access code and try again.`)
      } else {
        alert(`Join failed: ${errorMessage}`)
      }
      
      // Reset room state on error
      appState.roomId = null
      appState.isHost = false
      if (typeof window !== 'undefined' && window.appState) {
        window.appState.roomId = null
        window.appState.isHost = false
      }
      
      // Clear room from URL
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        url.searchParams.delete('room')
        window.history.replaceState({}, '', url.pathname + url.search)
      }
    })

    // WebRTC signaling handlers
    socket.on('offer', async (data) => {
      if (!data.senderId) {
        console.error('Received offer without senderId:', data)
        return
      }
      if (!data.sdp) {
        console.error('Received offer without sdp:', data)
        return
      }
      console.log(`Received offer from ${data.senderId}`)
      await handleRemoteOffer(data.senderId, data.sdp)
    })

    socket.on('answer', async (data) => {
      if (!data.senderId) {
        console.error('Received answer without senderId:', data)
        return
      }
      if (!data.sdp) {
        console.error('Received answer without sdp:', data)
        return
      }
      console.log(`Received answer from ${data.senderId}`)
      await handleRemoteAnswer(data.senderId, data.sdp)
    })

    socket.on('ice-candidate', async (data) => {
      if (!data.senderId) {
        console.error('Received ice-candidate without senderId:', data)
        return
      }
      if (!data.candidate) {
        console.error('Received ice-candidate without candidate:', data)
        return
      }
      console.log(`Received ICE candidate from ${data.senderId}`)
      await handleRemoteIceCandidate(data.senderId, data.candidate)
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
        
        const joinData = {
          roomId,
          userName,
          providedAccessCode: accessCode,
          roomHostCode,
          roomAccessCode,
          isHost: isHost || (roomHostCode !== null), // If roomHostCode is provided, likely hosting
        }
        
        console.log('Emitting join (after connect) with data:', {
          roomId,
          userName,
          hasProvidedAccessCode: accessCode !== null && accessCode !== '',
          providedAccessCode: accessCode ? '***' : null,
          hasRoomHostCode: roomHostCode !== null && roomHostCode !== '',
          hasRoomAccessCode: roomAccessCode !== null && roomAccessCode !== '',
          isHost: joinData.isHost
        })
        
        socket.emit('join', joinData)
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

    const joinData = {
      roomId,
      userName,
      providedAccessCode: accessCode,
      roomHostCode,
      roomAccessCode,
      isHost: isHost || (roomHostCode !== null), // If roomHostCode is provided, likely hosting
    }
    
    console.log('Emitting join with data:', {
      roomId,
      userName,
      hasProvidedAccessCode: accessCode !== null && accessCode !== '',
      providedAccessCode: accessCode ? '***' : null, // Don't log actual code
      hasRoomHostCode: roomHostCode !== null && roomHostCode !== '',
      hasRoomAccessCode: roomAccessCode !== null && roomAccessCode !== '',
      isHost: joinData.isHost
    })
    
    socket.emit('join', joinData)
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

