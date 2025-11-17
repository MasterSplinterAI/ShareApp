# Agent Not Receiving Jobs - Fix Guide

## Problem
The translation agent is registered with LiveKit Cloud but not receiving jobs when rooms are created. No translation is happening because the agent entrypoint is never called.

## Root Cause
LiveKit Cloud agents need to be configured to automatically join rooms. By default, agents wait for explicit job dispatch, but we need them to auto-join.

## Solution Options

### Option 1: Configure Agent Auto-Join in LiveKit Cloud Dashboard (Recommended)

1. **Go to LiveKit Cloud Dashboard**
   - Navigate to your project
   - Go to "Agents" section
   - Find your translation agent

2. **Configure Auto-Join**
   - Edit the agent configuration
   - Enable "Auto-join rooms" or "Auto-dispatch"
   - Set room name pattern (if needed): `room-*` to match all rooms
   - Save configuration

3. **Restart the Agent**
   - In the dashboard, restart/redeploy the agent
   - Or use CLI: `lk agent restart <agent-id>`

### Option 2: Use LiveKit CLI to Configure Auto-Join

If you have LiveKit CLI installed:

```bash
# Check agent status
lk agent status

# Configure agent to auto-join rooms matching pattern
lk agent update <agent-id> --room-pattern "room-*"

# Or configure via agent config file
# Edit livekit.toml in translation-agent directory
```

### Option 3: Explicit Job Creation (Alternative)

If auto-join isn't available, we can modify the backend to explicitly create agent jobs. However, this requires the AgentServiceClient API which may have limitations.

## Current Status

✅ Agent is registered: `AW_ka9FRbwXUn7g`  
✅ Agent is running and connected to LiveKit Cloud  
❌ Agent is NOT receiving jobs (entrypoint never called)  
❌ No translation happening  

## Testing After Fix

1. Create a new room
2. Join with multiple participants
3. Enable translation
4. Check agent logs: `tail -f livekit-app/translation-agent/agent.log`
5. You should see:
   ```
   ==================================================
   AGENT ENTRYPOINT CALLED!
   Room: room-xxxxx
   ==================================================
   ```

## Quick Check

To verify if agent is receiving jobs, watch the logs in real-time:

```bash
cd livekit-app/translation-agent
tail -f agent.log | grep -E "ENTRYPOINT|Room:|language|Language"
```

Then create a room and join. If you see "AGENT ENTRYPOINT CALLED!", the agent is working.

## Next Steps

1. **Configure auto-join in LiveKit Cloud Dashboard** (easiest)
2. **Or use LiveKit CLI** if you have it installed
3. **Test by creating a room and checking logs**
4. **Verify translation works**

The agent code is ready - it just needs to be configured to receive jobs from LiveKit Cloud!

