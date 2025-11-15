const express = require('express');
const axios = require('axios');
const router = express.Router();

const DAILY_API_URL = 'https://api.daily.co/v1';

// Generate Daily.co meeting token
router.get('/daily-token', async (req, res) => {
  try {
    const API_KEY = process.env.DAILY_API_KEY;
    const { roomName, userName, isOwner } = req.query;

    if (!API_KEY) {
      return res.status(500).json({
        error: 'Daily.co API key not configured'
      });
    }

    if (!roomName) {
      return res.status(400).json({
        error: 'roomName is required'
      });
    }

    // Generate meeting token via Daily.co API
    const response = await axios.post(
      `${DAILY_API_URL}/meeting-tokens`,
      {
        properties: {
          room_name: roomName,
          user_name: userName || 'Guest',
          is_owner: isOwner === 'true',
          exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      token: response.data.token,
      expiresIn: 24 * 60 * 60 * 1000 // 24 hours in milliseconds
    });
  } catch (error) {
    console.error('Daily.co token generation error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to generate Daily.co token',
      details: error.response?.data || error.message
    });
  }
});

module.exports = router;

