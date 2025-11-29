# Updating LiveKit Cloud Agent

This guide explains how to update your deployed LiveKit Cloud agent with new code changes (like the new `slow_speaker` VAD setting).

## Prerequisites

1. **Install LiveKit CLI** (if not already installed):
   ```bash
   # macOS
   brew install livekit-cli
   
   # Or download from: https://docs.livekit.io/agents/v0/deployment/
   ```

2. **Verify CLI is installed**:
   ```bash
   lk --version
   ```

## Step-by-Step Update Process

### 1. Navigate to Agent Directory

```bash
cd /Users/rhule/Documents/ShareApp/share-app/livekit-app/translation-agent
```

### 2. Authenticate with LiveKit Cloud

```bash
lk cloud auth
```

This will open a browser window for authentication. Once authenticated, your CLI will be linked to your LiveKit Cloud project.

### 3. Verify Agent Configuration

Your `livekit.toml` file should already be configured:
```toml
[project]
  subdomain = "production-uiycx4ku"

[agent]
  id = "CA_j25z2MSs8rBF"
  name = "translation-cloud-prod"
  room_pattern = "room-*"
```

The agent ID (`CA_j25z2MSs8rBF`) tells LiveKit which existing agent to update.

### 4. Deploy Updated Agent Code

```bash
lk agent deploy
```

This command will:
- Upload your updated code (including `realtime_agent_simple.py` with the new `slow_speaker` setting)
- Build a new container image
- Deploy it to LiveKit Cloud using a rolling deployment strategy
- New instances will serve new sessions while existing instances complete active sessions

**Note**: Since your `livekit.toml` contains an agent ID, `lk agent deploy` will update the existing agent rather than creating a new one.

### 5. Monitor Deployment Status

Check if the deployment was successful:

```bash
lk agent status
```

This shows:
- Agent status (running/stopped)
- Replica count
- Other relevant details

### 6. View Agent Logs

Monitor logs to verify the new code is working:

```bash
lk agent logs
```

This displays real-time logs from your agent. Look for:
- Agent initialization messages
- VAD configuration logs showing the new `slow_speaker` option is available
- Any errors or warnings

### 7. Test the New Feature

1. Join a room with the updated agent
2. As host, open the VAD sensitivity controls
3. Verify "Slow Speaker" option appears in the dropdown
4. Select it and test that translations wait longer before pushing

## Alternative: Update Specific Agent

If you need to explicitly update a specific agent by ID:

```bash
lk agent update CA_j25z2MSs8rBF
```

Or update agent settings without redeploying code:

```bash
lk agent update CA_j25z2MSs8rBF --room-pattern "room-*"
```

## Troubleshooting

### Agent Not Found
If you get an error about agent not found:
- Verify your `livekit.toml` has the correct agent ID
- Check you're authenticated: `lk cloud auth`
- List your agents: `lk agent list`

### Deployment Fails
- Check that all dependencies are in `requirements.txt` or `requirements_livekit.txt`
- Verify environment variables are set in LiveKit Cloud dashboard
- Check logs: `lk agent logs`

### Code Changes Not Reflected
- Ensure you've committed and saved all changes
- Try a full redeploy: `lk agent delete CA_j25z2MSs8rBF` then `lk agent deploy`
- Check that you're deploying from the correct directory

## Environment Variables

Make sure these are set in LiveKit Cloud dashboard for your agent:
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_URL` (should be `wss://production-uiycx4ku.livekit.cloud`)
- `OPENAI_API_KEY`
- `AGENT_NAME` (optional, defaults to `translation-bot-dev`)

## Quick Reference

```bash
# Full update workflow
cd livekit-app/translation-agent
lk cloud auth                    # Authenticate (one-time)
lk agent deploy                  # Deploy updated code
lk agent status                  # Check status
lk agent logs                    # View logs

# Other useful commands
lk agent list                    # List all agents
lk agent delete <ID>            # Delete an agent
lk agent update <ID> --help     # See update options
```

## What Changed?

The update includes:
- ✅ New `slow_speaker` VAD setting (1500ms pause, normal sensitivity)
- ✅ Updated VAD configuration in `_get_vad_config()`
- ✅ Updated Silero VAD parameters in `_create_assistant_for_pair()`
- ✅ Frontend UI updated to show "Slow Speaker" option

After deployment, hosts can select "Slow Speaker" from the VAD sensitivity dropdown to optimize translation timing for slow speakers.

