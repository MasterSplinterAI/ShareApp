const express = require('express');
const { AccessToken } = require('livekit-server-sdk');
const db = require('../db/v2Database');
const { requireV2Auth } = require('../middleware/v2Auth');
const router = express.Router();

// Legacy token endpoint — locked down to authenticated V2 users and non-V2 rooms only.
router.post('/token', requireV2Auth, async (req, res) => {
  try {
    const { roomName, participantName } = req.body;

    if (!roomName || !participantName) {
      return res.status(400).json({
        error: 'roomName and participantName are required'
      });
    }

    // Never mint tokens for V2 meetings here — V2 meetings must go through
    // /api/v2/meetings/:id/token or /api/v2/join/guest-token.
    const v2Row = await db.get(`SELECT id FROM v2_meetings WHERE livekit_room_name = ?`, [String(roomName)]);
    if (v2Row) {
      return res.status(403).json({ error: 'Use V2 meeting token endpoint for this room' });
    }

    // Check if LiveKit credentials are configured
    if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      return res.status(500).json({
        error: 'LiveKit credentials not configured.'
      });
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
        metadata: JSON.stringify({ displayName: safeName, role: 'member' }),
        ttl: '24h',
      }
    );
    at.name = safeName;

    // Grant permissions
    at.addGrant({
      roomJoin: true,
      room: String(roomName),
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: false,
      recorder: false,
    });

    // Generate JWT token
    const token = await at.toJwt();

    console.log(`Generated token for ${participantName} in room ${roomName} (host: ${isHost})`);
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
