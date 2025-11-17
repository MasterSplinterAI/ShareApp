# Agent Session Cleanup Guide

## Problem
You're seeing 18 active agent sessions on LiveKit Cloud even though there are no rooms open. This happens when agents don't properly exit when rooms disconnect.

## Solution

### 1. Redeploy the Agent (Recommended)

The agent code has been updated to properly handle cleanup and exit when rooms disconnect. Redeploy it:

```bash
cd livekit-app/translation-agent

# If using LiveKit CLI
lk agent deploy

# Or if running locally, restart the agent
# Stop current agent (Ctrl+C) and restart:
python realtime_agent.py dev
```

### 2. Check Agent Status

```bash
# Check agent status
lk agent status

# View agent logs
lk agent logs

# List all agents
lk agent list
```

### 3. Manual Cleanup (If Needed)

If sessions are still stuck after redeploying:

1. **Restart the Agent Deployment**
   - Go to LiveKit Cloud Dashboard
   - Navigate to your agent
   - Click "Restart" or "Redeploy"

2. **Check for Stuck Rooms**
   - In LiveKit Dashboard, check if there are any rooms that didn't close properly
   - Manually close any stuck rooms

3. **Force Agent Restart**
   ```bash
   # Stop the agent
   lk agent stop <agent-id>
   
   # Start it again
   lk agent start <agent-id>
   ```

## What Was Fixed

The agent now:
- ✅ Properly listens for room disconnect events
- ✅ Cancels all background audio processing tasks on disconnect
- ✅ Clears all data structures (buffers, language preferences, etc.)
- ✅ Explicitly returns/exits from the entrypoint function
- ✅ Handles cancellation exceptions properly

## Prevention

The updated agent will:
- Exit immediately when rooms disconnect
- Clean up all resources before exiting
- Not leave orphaned sessions running

## Monitoring

After redeploying, monitor:
- Agent session count should decrease as rooms close
- Check logs for "Agent shutdown complete" messages
- Verify sessions are cleaned up within a few seconds of room closure

## If Issues Persist

1. Check LiveKit Cloud Dashboard for any error messages
2. Review agent logs: `lk agent logs`
3. Verify environment variables are set correctly
4. Check if there are any network issues preventing proper disconnection

