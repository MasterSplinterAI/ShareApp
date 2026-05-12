const express = require('express');
const { createLiveKitConferenceRoom, getRoomService } = require('../lib/livekitService');
const router = express.Router();

// Create a new room
router.post('/create', async (req, res) => {
  try {
    const roomMode = req.body.roomMode || 'multi-language';
    const roomName = req.body.roomName || `room-${Math.random().toString(36).substring(2, 15)}-${Date.now().toString(36)}`;
    const room = await createLiveKitConferenceRoom(roomName, roomMode);
    
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
    
    // Parse metadata to include roomMode
    let metadata = {};
    try {
      metadata = room.metadata ? JSON.parse(room.metadata) : {};
    } catch (e) {
      console.warn('Failed to parse room metadata:', e);
    }

    res.json({
      roomName: room.name,
      roomId: room.sid,
      hostCode,
      shareableLink,
      shareableLinkNetwork,
      createdAt: room.creationTime ? room.creationTime.toString() : Date.now().toString(),
      metadata: room.metadata,
      roomMode: metadata.roomMode || roomMode // Include room mode in response
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
    
    // Parse metadata to include roomMode
    let metadata = {};
    try {
      metadata = room.metadata ? JSON.parse(room.metadata) : {};
    } catch (e) {
      console.warn('Failed to parse room metadata:', e);
    }
    
    res.json({
      roomName: room.name,
      roomId: room.sid,
      roomMode: metadata.roomMode || 'multi-language', // Include room mode from metadata
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

// Generate an invite link (no LiveKit room created yet -- room is created on-demand when someone joins)
router.post('/invite', async (req, res) => {
  try {
    const slug = `invite-${Math.random().toString(36).substring(2, 10)}${Date.now().toString(36)}`;

    const origin = req.headers.origin || req.headers.referer || '';
    const isNgrok = origin.includes('ngrok.app') || origin.includes('ngrok.io');

    let inviteLink;
    if (isNgrok) {
      const ngrokUrl = origin.replace(/\/$/, '');
      inviteLink = `${ngrokUrl}/join/${slug}`;
    } else if (process.env.PRODUCTION_URL) {
      inviteLink = `${process.env.PRODUCTION_URL}/join/${slug}`;
    } else {
      const localhostUrl = process.env.FRONTEND_URL || 'http://localhost:5174';
      inviteLink = `${localhostUrl}/join/${slug}`;
    }

    console.log('Created invite link:', inviteLink, 'slug:', slug);

    res.json({ slug, inviteLink });
  } catch (error) {
    console.error('Invite link error:', error);
    res.status(500).json({
      error: 'Failed to create invite link',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
