const express = require('express');
const { AccessToken } = require('livekit-server-sdk');
const router = express.Router();

// Generate LiveKit access token
router.post('/token', async (req, res) => {
  try {
    const { roomName, participantName, isHost } = req.body;

    if (!roomName || !participantName) {
      return res.status(400).json({
        error: 'roomName and participantName are required'
      });
    }

    // Check if LiveKit credentials are configured
    if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      return res.status(500).json({
        error: 'LiveKit credentials not configured. Please set LIVEKIT_API_KEY and LIVEKIT_API_SECRET in your .env file.'
      });
    }

    // Create access token
    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      {
        identity: participantName,
        ttl: '24h', // Token expires in 24 hours
      }
    );

    // Grant permissions
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      // Additional permissions for hosts
      roomAdmin: isHost === true,
      recorder: isHost === true,
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
