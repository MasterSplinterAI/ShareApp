const express = require('express');
const crypto = require('crypto');
const { createLiveKitConferenceRoom, getRoomService } = require('../lib/livekitService');
const { publicFrontendBaseUrl } = require('../lib/publicFrontendBaseUrl');
const { requireV2Auth } = require('../middleware/v2Auth');
const db = require('../db/v2Database');
const router = express.Router();

// Create a new room (authenticated V2 users only)
router.post('/create', requireV2Auth, async (req, res) => {
  try {
    const roomMode = req.body.roomMode || 'multi-language';
    const roomName = req.body.roomName || `room-${crypto.randomBytes(6).toString('hex')}-${Date.now().toString(36)}`;
    const room = await createLiveKitConferenceRoom(roomName, roomMode, req.v2Auth.orgId);
    
    // Generate host code for easy rejoin
    const hostCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    
    const base = publicFrontendBaseUrl(req);
    const shareableLink = `${base}/join/${encodeURIComponent(roomName)}`;
    let shareableLinkNetwork = shareableLink;
    if (base.includes('localhost') || base.includes('127.0.0.1')) {
      const networkUrl = (process.env.NETWORK_URL || 'http://192.168.1.83:5174').replace(/\/$/, '');
      shareableLinkNetwork = `${networkUrl}/join/${encodeURIComponent(roomName)}`;
    }

    console.log('Created LiveKit room:', roomName);
    console.log('Share base URL:', base);
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
      roomMode: metadata.roomMode || 'multi-language',
      numParticipants: room.numParticipants,
      maxParticipants: room.maxParticipants,
      creationTime: room.creationTime ? room.creationTime.toString() : null,
    });
  } catch (error) {
    console.error('Room info error:', error);
    res.status(500).json({
      error: 'Failed to get room info',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// List participants in a room (authenticated only)
router.get('/:roomName/participants', requireV2Auth, async (req, res) => {
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

// Delete a room (authenticated host/org admin only)
router.delete('/:roomName', requireV2Auth, async (req, res) => {
  try {
    const { roomName } = req.params;
    const meeting = await db.get(
      `SELECT id, org_id, host_user_id FROM v2_meetings WHERE livekit_room_name = ?`,
      [roomName]
    );
    if (!meeting || meeting.org_id !== req.v2Auth.orgId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (meeting.host_user_id !== req.v2Auth.userId && !['owner', 'admin'].includes(req.v2Auth.role)) {
      return res.status(403).json({ error: 'Only the host can delete this room' });
    }
    
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

// Generate an invite link (authenticated only)
router.post('/invite', requireV2Auth, async (req, res) => {
  try {
    const slug = `invite-${Math.random().toString(36).substring(2, 10)}${Date.now().toString(36)}`;

    const base = publicFrontendBaseUrl(req);
    const inviteLink = `${base}/join/${encodeURIComponent(slug)}`;

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
