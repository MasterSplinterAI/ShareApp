const express = require('express');
const router = express.Router();

// Store active translation agents (in production, use Redis or database)
const activeAgents = new Map();

// Start translation agent for a meeting
router.post('/start', async (req, res) => {
  try {
    const { meetingId, token } = req.body;

    if (!meetingId || !token) {
      return res.status(400).json({
        error: 'meetingId and token are required'
      });
    }

    // Check if agent already exists for this meeting
    if (activeAgents.has(meetingId)) {
      return res.json({
        success: true,
        agentId: activeAgents.get(meetingId),
        message: 'Translation agent already active'
      });
    }

    // Generate agent ID
    const agentId = `agent-${Date.now()}`;
    activeAgents.set(meetingId, agentId);

    // TODO: Trigger Python agent to join meeting
    // This would typically spawn a subprocess or call a service
    // For now, we'll just track it
    console.log(`Translation agent ${agentId} started for meeting ${meetingId}`);

    res.json({
      success: true,
      agentId,
      meetingId
    });
  } catch (error) {
    console.error('Translation start error:', error);
    res.status(500).json({
      error: 'Failed to start translation agent'
    });
  }
});

// Stop translation agent
router.post('/stop', async (req, res) => {
  try {
    const { meetingId } = req.body;

    if (!meetingId) {
      return res.status(400).json({
        error: 'meetingId is required'
      });
    }

    if (activeAgents.has(meetingId)) {
      activeAgents.delete(meetingId);
      console.log(`Translation agent stopped for meeting ${meetingId}`);
      
      // TODO: Actually stop the Python agent process
      
      res.json({
        success: true,
        message: 'Translation agent stopped'
      });
    } else {
      res.json({
        success: false,
        message: 'No active translation agent found'
      });
    }
  } catch (error) {
    console.error('Translation stop error:', error);
    res.status(500).json({
      error: 'Failed to stop translation agent'
    });
  }
});

// Check translation agent status
router.get('/status/:meetingId', (req, res) => {
  try {
    const { meetingId } = req.params;
    const isActive = activeAgents.has(meetingId);

    res.json({
      active: isActive,
      agentId: isActive ? activeAgents.get(meetingId) : null,
      meetingId
    });
  } catch (error) {
    console.error('Translation status error:', error);
    res.status(500).json({
      error: 'Failed to get translation status'
    });
  }
});

module.exports = router;

