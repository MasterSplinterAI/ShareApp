# Translation Debugging Guide

## Current Status

✅ **Agent is registered**: `translation-bot` (Worker ID: `AW_5ueVwZvkZqRF`)  
✅ **Agent is running**: Process is active  
❌ **Agent NOT receiving jobs**: No "AGENT ENTRYPOINT CALLED!" logs  
❌ **Translation not working**: No audio processing happening  

## Issue

The agent is registered with LiveKit Cloud but **not receiving jobs** when rooms are created. However, you see an agent tile in rooms, which suggests:
- Either a different agent is joining (cloud-deployed or different self-hosted instance)
- Or our local agent is joining but not logging properly

## Verification Steps

### 1. Check Agent Name Match

In LiveKit Cloud Dashboard:
- Go to: https://cloud.livekit.io/projects/p_1wcbxip8zp6/agents/self-hosted/A_4NQozRThmiRx
- Check what **agent name** is configured
- Verify it matches `translation-bot` (our local agent name)

### 2. Check Which Agent is Actually Joining

When you see the agent tile in a room:
- Check the agent's identity/name shown in the tile
- Verify it matches `translation-bot`

### 3. Verify Local Agent is Being Used

Our local agent logs should show:
```
AGENT ENTRYPOINT CALLED!
Room: room-xxxxx
```

If you don't see this, the agent joining is NOT our local agent.

## Possible Solutions

### Option 1: Agent Name Mismatch

If the agent name in LiveKit Cloud doesn't match `translation-bot`:
1. Update `.env` file: `AGENT_NAME=<exact-name-from-dashboard>`
2. Restart agent

### Option 2: Different Agent is Joining

If a cloud-deployed agent is joining instead:
1. Check LiveKit Cloud dashboard for cloud-deployed agents
2. Either:
   - Disable/delete the cloud agent
   - Or update it to use our code
   - Or configure rooms to use our self-hosted agent specifically

### Option 3: Agent Configuration Issue

If agent name matches but still not working:
1. In LiveKit Cloud dashboard, check agent configuration
2. Verify "Auto-dispatch" or "Auto-join" is enabled
3. Check if there are any filters or conditions preventing dispatch

## Testing

After making changes:

1. **Create a new room**
2. **Check agent logs immediately**:
   ```bash
   tail -f livekit-app/translation-agent/agent.log | grep -E "ENTRYPOINT|Room:|Translation|audio|ERROR"
   ```
3. **You should see**:
   ```
   AGENT ENTRYPOINT CALLED!
   Room: room-xxxxx
   Translation Agent starting in room: room-xxxxx
   ```

## Current Agent Configuration

- **Agent Name**: `translation-bot` (from `.env`)
- **LiveKit URL**: `wss://jayme-rhmomj8r.livekit.cloud`
- **Worker ID**: `AW_5ueVwZvkZqRF` (changes on restart)
- **Status**: Registered but not receiving jobs

## Next Steps

1. **Verify agent name** in LiveKit Cloud dashboard matches `translation-bot`
2. **Check which agent** is actually joining rooms (check agent tile identity)
3. **If mismatch**: Update agent name to match dashboard
4. **If correct**: Check LiveKit Cloud agent configuration for auto-dispatch settings
5. **Test again** and monitor logs in real-time

