const express = require('express');
const { AccessToken } = require('livekit-server-sdk');
const db = require('../db/v2Database');
const { requireV2Auth } = require('../middleware/v2Auth');
const { assertCanCreateMeeting } = require('../lib/v2Entitlements');
const { getRoomService } = require('../lib/livekitService');
const { participantMetadata } = require('../lib/livekitTokenMetadata');
const router = express.Router();

const VALID_ROOM_NAME_RE = /^[a-zA-Z0-9_-]{3,128}$/;

// Legacy token endpoint — locked down to authenticated V2 users in their own provisioned non-V2 rooms.
router.post('/token', requireV2Auth, async (req, res) => {
  try {
    const { roomName, participantName } = req.body;

    if (!roomName || !participantName) {
      return res.status(400).json({
        error: 'roomName and participantName are required'
      });
    }

    const cleanRoomName = String(roomName).trim();
    if (!VALID_ROOM_NAME_RE.test(cleanRoomName)) {
      return res.status(400).json({ error: 'Invalid roomName format' });
    }

    // Never mint tokens for V2 meetings here — V2 meetings must go through
    // /api/v2/meetings/:id/token or /api/v2/join/guest-token.
    const v2Row = await db.get(`SELECT id FROM v2_meetings WHERE livekit_room_name = ?`, [cleanRoomName]);
    if (v2Row) {
      return res.status(403).json({ error: 'Use V2 meeting token endpoint for this room' });
    }

    const gate = await assertCanCreateMeeting(req.v2Auth.orgId);
    if (!gate.ok) {
      return res.status(402).json({ error: gate.message, code: gate.code });
    }

    // Check if LiveKit credentials are configured
    if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      return res.status(500).json({
        error: 'LiveKit credentials not configured.'
      });
    }

    const rooms = await getRoomService().listRooms([cleanRoomName]);
    if (!rooms || rooms.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }
    let roomMeta = {};
    try {
      roomMeta = rooms[0].metadata ? JSON.parse(rooms[0].metadata) : {};
    } catch {
      roomMeta = {};
    }
    if (!roomMeta.org_id || roomMeta.org_id !== req.v2Auth.orgId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const safeName = String(participantName).trim().slice(0, 128);
    // Create access token with a per-connection unique identity so two people with the same name
    // (or the same user on two devices) never collide on LiveKit identity.
    const uniqueSuffix = require('crypto').randomUUID().slice(0, 8);
    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      {
        identity: `user-${req.v2Auth.userId}-${uniqueSuffix}`,
        name: safeName,
        metadata: participantMetadata({
          displayName: safeName,
          role: 'member',
          auth: req.v2Auth,
        }),
        ttl: '24h',
      }
    );
    at.name = safeName;

    // Grant permissions
    at.addGrant({
      roomJoin: true,
      room: cleanRoomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: false,
      recorder: false,
    });

    // Generate JWT token
    const token = await at.toJwt();

    console.log(`Generated token for ${participantName} in room ${roomName}`);
    console.log(`Token type: ${typeof token}, Token length: ${token ? token.length : 0}`);
    
    // Ensure token is a string
    if (!token || typeof token !== 'string') {
      throw new Error('Failed to generate valid token');
    }

    res.json({
      token: token,
      url: process.env.LIVEKIT_URL,
      participantName,
      roomName,
    });
  } catch (error) {
    console.error('Token generation error:', error);
    res.status(500).json({
      error: 'Failed to generate access token',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
