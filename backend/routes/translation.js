const express = require('express');
const router = express.Router();

// Store active translation agents (in production, use Redis or database)
const activeAgents = new Map();

// Store language preferences per participant (in production, use Redis or database)
const languagePreferences = new Map(); // key: `${meetingId}:${participantId}`, value: languageCode

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

    // Spawn Python agent process to join meeting
    const { spawn } = require('child_process');
    const path = require('path');
    
    // Get room URL from meeting service
    const axios = require('axios');
    const DAILY_API_URL = 'https://api.daily.co/v1';
    const API_KEY = process.env.DAILY_API_KEY;
    
    if (!API_KEY) {
      throw new Error('DAILY_API_KEY not set in backend environment');
    }
    
    if (!process.env.OPENAI_API_KEY) {
      console.warn('WARNING: OPENAI_API_KEY not set in backend environment. Translation will not work.');
    }
    
    try {
      console.log(`Fetching room info for meeting: ${meetingId}`);
      // Fetch room info to get room URL
      const roomResponse = await axios.get(
        `${DAILY_API_URL}/rooms/${meetingId}`,
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      const roomUrl = roomResponse.data.url;
      
      // Set environment variables for Python agent
      const agentEnv = {
        ...process.env,
        MEETING_ID: meetingId,
        DAILY_ROOM_URL: roomUrl,
        DAILY_TOKEN: token,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || ''
      };
      
      // Spawn Python agent process
      // Use venv python if available, otherwise use system python3
      const venvPython = path.join(__dirname, '../../translation-agent/venv/bin/python3');
      const pythonCmd = require('fs').existsSync(venvPython) ? venvPython : 'python3';
      const agentPath = path.join(__dirname, '../../translation-agent/agent.py');
      
      console.log(`Starting translation agent with: ${pythonCmd} ${agentPath}`);
      console.log(`Working directory: ${path.join(__dirname, '../../translation-agent')}`);
      console.log(`OPENAI_API_KEY present: ${!!process.env.OPENAI_API_KEY}`);
      
      const agentProcess = spawn(pythonCmd, [agentPath], {
        env: agentEnv,
        cwd: path.join(__dirname, '../../translation-agent'),
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      // Store process reference
      activeAgents.set(meetingId, { agentId, process: agentProcess });
      
      // Handle process output
      agentProcess.stdout.on('data', (data) => {
        console.log(`Translation agent ${agentId}: ${data.toString()}`);
      });
      
      agentProcess.stderr.on('data', (data) => {
        console.error(`Translation agent ${agentId} error: ${data.toString()}`);
      });
      
      agentProcess.on('exit', (code, signal) => {
        console.log(`Translation agent ${agentId} exited with code ${code}, signal ${signal}`);
        if (code !== 0 && code !== null) {
          console.error(`Translation agent ${agentId} crashed! Check logs above for errors.`);
        }
        activeAgents.delete(meetingId);
      });
      
      // Log immediately when process starts
      agentProcess.on('spawn', () => {
        console.log(`Translation agent ${agentId} process spawned successfully`);
      });
      
      console.log(`Translation agent ${agentId} started for meeting ${meetingId}`);
    } catch (error) {
      console.error('Error starting translation agent:', error);
      activeAgents.delete(meetingId);
      throw error;
    }

    res.json({
      success: true,
      agentId,
      meetingId,
      message: 'Translation agent started'
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
      const agentInfo = activeAgents.get(meetingId);
      activeAgents.delete(meetingId);
      
      // Stop the Python agent process
      if (agentInfo.process) {
        agentInfo.process.kill('SIGTERM');
        console.log(`Translation agent ${agentInfo.agentId} stopped for meeting ${meetingId}`);
      }
      
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
    const agentInfo = isActive ? activeAgents.get(meetingId) : null;

    res.json({
      active: isActive,
      agentId: agentInfo?.agentId || agentInfo || null,
      meetingId,
      processRunning: agentInfo?.process ? !agentInfo.process.killed : false
    });
  } catch (error) {
    console.error('Translation status error:', error);
    res.status(500).json({
      error: 'Failed to get translation status'
    });
  }
});

// Set language preference for a participant
router.post('/language', (req, res) => {
  try {
    const { meetingId, participantId, languageCode } = req.body;

    if (!meetingId || !participantId || !languageCode) {
      return res.status(400).json({
        error: 'meetingId, participantId, and languageCode are required'
      });
    }

    const key = `${meetingId}:${participantId}`;
    languagePreferences.set(key, languageCode);

    console.log(`Language preference set: ${key} -> ${languageCode}`);

    res.json({
      success: true,
      meetingId,
      participantId,
      languageCode
    });
  } catch (error) {
    console.error('Set language preference error:', error);
    res.status(500).json({
      error: 'Failed to set language preference'
    });
  }
});

// Get language preference for a participant
router.get('/language/:meetingId/:participantId', (req, res) => {
  try {
    const { meetingId, participantId } = req.params;
    const key = `${meetingId}:${participantId}`;
    const languageCode = languagePreferences.get(key) || 'en';

    res.json({
      meetingId,
      participantId,
      languageCode
    });
  } catch (error) {
    console.error('Get language preference error:', error);
    res.status(500).json({
      error: 'Failed to get language preference'
    });
  }
});

// Get all language preferences for a meeting
router.get('/languages/:meetingId', (req, res) => {
  try {
    const { meetingId } = req.params;
    const preferences = {};

    languagePreferences.forEach((languageCode, key) => {
      if (key.startsWith(`${meetingId}:`)) {
        const participantId = key.split(':')[1];
        preferences[participantId] = languageCode;
      }
    });

    res.json({
      meetingId,
      preferences
    });
  } catch (error) {
    console.error('Get language preferences error:', error);
    res.status(500).json({
      error: 'Failed to get language preferences'
    });
  }
});

// Store transcriptions (for display/testing)
const transcriptions = new Map(); // key: `${meetingId}:${participantId}`, value: array of transcriptions

router.post('/transcription', (req, res) => {
      try {
        const { meetingId, participantId, text, timestamp, speakerId } = req.body;

        if (!meetingId || !participantId || !text) {
          return res.status(400).json({
            error: 'meetingId, participantId, and text are required'
          });
        }

        const key = `${meetingId}:${participantId}`;
        if (!transcriptions.has(key)) {
          transcriptions.set(key, []);
        }

        const transcriptList = transcriptions.get(key);
        transcriptList.push({
          text,
          timestamp: timestamp || Date.now(),
          speaker: speakerId || participantId,  // Original speaker
          listener: participantId  // Who sees this translation
        });

        // Keep only last 50 transcriptions
        if (transcriptList.length > 50) {
          transcriptList.shift();
        }

        res.json({
          success: true,
          meetingId,
          participantId,
          transcription: { text, timestamp, speakerId }
        });
      } catch (error) {
        console.error('Store transcription error:', error);
        res.status(500).json({
          error: 'Failed to store transcription'
        });
      }
    });

// Get transcriptions for a participant
router.get('/transcriptions/:meetingId/:participantId', (req, res) => {
  try {
    const { meetingId, participantId } = req.params;
    const key = `${meetingId}:${participantId}`;
    const transcriptList = transcriptions.get(key) || [];

    res.json({
      meetingId,
      participantId,
      transcriptions: transcriptList
    });
  } catch (error) {
    console.error('Get transcriptions error:', error);
    res.status(500).json({
      error: 'Failed to get transcriptions'
    });
  }
});

module.exports = router;

