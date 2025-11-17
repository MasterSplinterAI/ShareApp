# Disable Unnamed Agent via CLI

## Problem
The unnamed agent `A_4NQozRThmiRx` is auto-dispatching to all rooms, causing duplicate agents.

## Solution: Use LiveKit CLI

### Step 1: Authenticate LiveKit CLI

```bash
cd livekit-app/translation-agent
lk auth
```

Follow the prompts to authenticate with your LiveKit Cloud account.

### Step 2: List Agents (Verify)

```bash
lk agent list
```

You should see both agents:
- `translation-bot` (A_hHk9G6c47YGx) - your named agent
- `A_4NQozRThmiRx` - the unnamed agent to disable

### Step 3: Disable Auto-Dispatch (Option A - Recommended)

Disable auto-dispatch by setting a room pattern that won't match your rooms:

```bash
lk agent update A_4NQozRThmiRx --room-pattern "disabled-*"
```

This prevents the agent from auto-joining rooms that start with `room-`.

### Step 4: Delete Agent (Option B - If you don't need it)

If you don't need the unnamed agent at all:

```bash
lk agent delete A_4NQozRThmiRx
```

### Step 5: Verify

1. Create a new room
2. Check that only ONE agent joins (the `translation-bot` agent)
3. Check agent logs: `tail -f agent.log | grep "AGENT ENTRYPOINT"`

You should see only one entrypoint call per room.

## Alternative: If CLI Authentication Fails

If `lk auth` doesn't work, you may need to:

1. Get an API token from LiveKit Cloud dashboard
2. Set it as an environment variable:
   ```bash
   export LIVEKIT_CLOUD_API_TOKEN=<your-token>
   ```
3. Then run the agent commands

## After Disabling

Once the unnamed agent is disabled/deleted:
- Only `translation-bot` will receive jobs
- No more duplicate agents in rooms
- Translation will work normally with a single agent

