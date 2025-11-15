const express = require('express');
const axios = require('axios');
const router = express.Router();

const DAILY_API_URL = 'https://api.daily.co/v1';

// Create a new Daily.co room
router.post('/create', async (req, res) => {
  try {
    const API_KEY = process.env.DAILY_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({
        error: 'Daily.co API key not configured'
      });
    }

    // Generate a unique room name
    const roomName = `room-${Math.random().toString(36).substring(2, 15)}-${Date.now().toString(36)}`;

    // Create room via Daily.co API
    const response = await axios.post(
      `${DAILY_API_URL}/rooms`,
      {
        name: roomName,
        privacy: 'private',
        properties: {
          enable_screenshare: true,
          enable_chat: true,
          enable_knocking: false,
          enable_prejoin_ui: true,
          exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days expiration
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Generate shareable links for both localhost and network access
    const localhostUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const networkUrl = process.env.NETWORK_URL || 'http://192.168.1.83:5173';
    
    // Generate a simple host code (for rejoin)
    const hostCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    console.log('Created Daily.co room:', roomName);
    console.log('Shareable link (localhost):', `${localhostUrl}/join/${roomName}`);
    console.log('Shareable link (network):', `${networkUrl}/join/${roomName}`);

    res.json({
      meetingId: roomName,
      roomUrl: response.data.url,
      hostCode,
      shareableLink: `${localhostUrl}/join/${roomName}`,
      shareableLinkNetwork: `${networkUrl}/join/${roomName}`
    });
  } catch (error) {
    console.error('Room creation error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to create room',
      details: error.response?.data || error.message
    });
  }
});

// Validate room exists
router.get('/:id/validate', async (req, res) => {
  try {
    const { id } = req.params;
    const API_KEY = process.env.DAILY_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({
        error: 'Daily.co API key not configured'
      });
    }

    // Check room status via Daily.co API
    const response = await axios.get(
      `${DAILY_API_URL}/rooms/${id}`,
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`
        }
      }
    );

    res.json({
      valid: true,
      exists: true,
      participantCount: response.data.config?.max_participants || 0,
      meetingId: id,
      roomUrl: response.data.url
    });
  } catch (error) {
    if (error.response?.status === 404) {
      res.json({
        valid: false,
        exists: false,
        participantCount: 0
      });
    } else {
      console.error('Room validation error:', error.response?.data || error.message);
      res.status(500).json({
        error: 'Failed to validate room',
        details: error.response?.data || error.message
      });
    }
  }
});

// Get room info
router.get('/:id/info', async (req, res) => {
  try {
    const { id } = req.params;
    const API_KEY = process.env.DAILY_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({
        error: 'Daily.co API key not configured'
      });
    }

    const response = await axios.get(
      `${DAILY_API_URL}/rooms/${id}`,
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`
        }
      }
    );

    res.json({
      meetingId: id,
      roomUrl: response.data.url,
      createdAt: response.data.created_at,
      config: response.data.config
    });
  } catch (error) {
    console.error('Room info error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to get room info',
      details: error.response?.data || error.message
    });
  }
});

module.exports = router;

