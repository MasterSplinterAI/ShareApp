const express = require('express');
const { RoomServiceClient, Room, AgentDispatchClient } = require('livekit-server-sdk');
const router = express.Router();

// Initialize LiveKit Room Service Client
const getRoomService = () => {
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET || !process.env.LIVEKIT_URL) {
    throw new Error('LiveKit configuration missing');
  }
  
  const livekitHost = process.env.LIVEKIT_URL.replace('wss://', 'https://').replace('ws://', 'http://');
  
  return new RoomServiceClient(
    livekitHost,
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET
  );
};

// Create a new room
router.post('/create', async (req, res) => {
  try {
    const roomService = getRoomService();
    
    // Generate unique room name
    const roomName = `room-${Math.random().toString(36).substring(2, 15)}-${Date.now().toString(36)}`;
    
    // Create room options
    const createOptions = {
      name: roomName,
      emptyTimeout: 300, // Room closes 5 minutes after last participant leaves
      maxParticipants: 50,
      metadata: JSON.stringify({
        createdAt: new Date().toISOString(),
        type: 'conference'
      })
    };

    // Create room
    const room = await roomService.createRoom(createOptions);
    
    // Dispatch agent to room explicitly
    try {
      const livekitHost = process.env.LIVEKIT_URL.replace('wss://', 'https://').replace('ws://', 'http://');
      const agentDispatch = new AgentDispatchClient(
        livekitHost,
        process.env.LIVEKIT_API_KEY,
        process.env.LIVEKIT_API_SECRET
      );
      
      // Create dispatch - for unnamed self-hosted agents, pass undefined for agentName
      // Signature: createDispatch(roomName, agentName, options)
      await agentDispatch.createDispatch(roomName, undefined);
      
      console.log(`Agent dispatched to room ${roomName}`);
    } catch (agentError) {
      console.warn('Could not dispatch agent:', agentError.message);
      // Continue anyway - room creation succeeded
    }
    
    // Generate host code for easy rejoin
    const hostCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // Generate shareable links based on request origin
    const origin = req.headers.origin || req.headers.referer || '';
    const isNgrok = origin.includes('ngrok.app') || origin.includes('ngrok.io');
    
    let shareableLink, shareableLinkNetwork;
    
    if (isNgrok) {
      // Extract ngrok domain from origin
      const ngrokUrl = origin.replace(/\/$/, ''); // Remove trailing slash
      shareableLink = `${ngrokUrl}/join/${roomName}`;
      shareableLinkNetwork = `${ngrokUrl}/join/${roomName}`;
    } else {
      const localhostUrl = process.env.FRONTEND_URL || 'http://localhost:5174';
      const networkUrl = process.env.NETWORK_URL || 'http://192.168.1.83:5174';
      shareableLink = `${localhostUrl}/join/${roomName}`;
      shareableLinkNetwork = `${networkUrl}/join/${roomName}`;
    }
    
    console.log('Created LiveKit room:', roomName);
    console.log('Request origin:', origin);
    console.log('Shareable link:', shareableLink);
    
    res.json({
      roomName: room.name,
      roomId: room.sid,
      hostCode,
      shareableLink,
      shareableLinkNetwork,
      createdAt: room.creationTime ? room.creationTime.toString() : Date.now().toString(),
      metadata: room.metadata
    });
  } catch (error) {
    console.error('Room creation error:', error);
    res.status(500).json({
      error: 'Failed to create room',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get room info
router.get('/:roomName', async (req, res) => {
  try {
    const { roomName } = req.params;
    const roomService = getRoomService();
    
    // List all rooms and find the one we want
    const rooms = await roomService.listRooms();
    const room = rooms.find(r => r.name === roomName);
    
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    res.json({
      roomName: room.name,
      roomId: room.sid,
      numParticipants: room.numParticipants,
      maxParticipants: room.maxParticipants,
      creationTime: room.creationTime ? room.creationTime.toString() : null,
      metadata: room.metadata
    });
  } catch (error) {
    console.error('Room info error:', error);
    res.status(500).json({
      error: 'Failed to get room info',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// List participants in a room
router.get('/:roomName/participants', async (req, res) => {
  try {
    const { roomName } = req.params;
    const roomService = getRoomService();
    
    const participants = await roomService.listParticipants(roomName);
    
    res.json({
      roomName,
      participants: participants.map(p => ({
        identity: p.identity,
        sid: p.sid,
        name: p.name,
        state: p.state,
        joinedAt: p.joinedAt ? p.joinedAt.toString() : null,
        metadata: p.metadata,
        tracks: p.tracks
      })),
      count: participants.length
    });
  } catch (error) {
    console.error('List participants error:', error);
    res.status(500).json({
      error: 'Failed to list participants',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Delete a room (host only)
router.delete('/:roomName', async (req, res) => {
  try {
    const { roomName } = req.params;
    const { hostCode } = req.body; // In production, verify this properly
    
    const roomService = getRoomService();
    await roomService.deleteRoom(roomName);
    
    console.log('Deleted room:', roomName);
    
    res.json({ message: 'Room deleted successfully' });
  } catch (error) {
    console.error('Room deletion error:', error);
    res.status(500).json({
      error: 'Failed to delete room',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
