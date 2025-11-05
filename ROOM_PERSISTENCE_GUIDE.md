# Room Persistence & Cleanup Impact

## How Rooms Work

### Current Behavior: Ephemeral Rooms (In-Memory Only)

**Rooms are temporary** - they only exist in server memory while someone is actively in them.

### Lifecycle:

1. **Room Creation**
   - Host creates room with ID (e.g., "abc123")
   - Host sets participant code and host code
   - Room exists in memory: `rooms["abc123"] = { hostCode: "1470", accessCode: "1234", ... }`

2. **Room Active**
   - While participants are in the room, it exists
   - Can be accessed via `/room/:roomId/status` endpoint

3. **Room Cleanup**
   - When last participant leaves → room **immediately deleted**
   - Periodic cleanup (every 5 min) catches any missed empty rooms
   - Server restart → all rooms deleted

4. **Room Recreation**
   - When someone joins a non-existent room ID
   - Room is **recreated** with the codes provided
   - If host code matches, user becomes host

## Impact on Future Use

### ✅ What Works:

1. **Host Rejoining**
   ```
   Day 1: Host creates room "abc123" with host code "1470"
   Day 1: Host leaves → room deleted
   Day 2: Host rejoins "abc123" with host code "1470"
   → Room recreated, host set automatically ✅
   ```

2. **Participant Joining**
   ```
   Day 1: Host creates room "abc123" with participant code "1234"
   Day 1: Host leaves → room deleted
   Day 2: Participant joins "abc123" with code "1234"
   → Room recreated, participant joins ✅
   ```

### ⚠️ Important Considerations:

1. **Room Must Be Recreated**
   - The room ID must be saved (URL parameter works)
   - Access codes must be saved (host/participant codes)
   - First person to rejoin recreates the room

2. **Race Conditions**
   - If multiple people try to recreate simultaneously, first one wins
   - Codes are set by whoever recreates the room first

3. **No Persistent Storage**
   - Rooms don't survive server restarts
   - No database/file storage
   - All room data is in-memory only

## Current Implementation Details

### Room Recreation Logic (server.js lines 327-362):

```javascript
if (!rooms[roomId]) {
    // Room doesn't exist - recreate it
    const finalHostCode = roomHostCode || (joinAsHost && providedAccessCode ? providedAccessCode : null);
    const finalAccessCode = roomAccessCode || null;
    
    rooms[roomId] = {
        hostId: null,
        participants: {},
        accessCode: finalAccessCode,
        hostCode: finalHostCode,
        locked: false
    };
    
    // If joining as host with host code, set as host
    if (joinAsHost && roomHostCode) {
        rooms[roomId].hostId = socket.id;
    }
}
```

### What Gets Preserved:

- ✅ Room ID (in URL)
- ✅ Host code (stored in `window.appState.roomHostCode` on client)
- ✅ Participant code (stored in `window.appState.roomAccessCode` on client)

**Both codes are equally persistent!** When you:
1. **Host a room** → Both codes are saved to `window.appState`
2. **Leave and rejoin** → Both codes are sent to recreate the room
3. **Room recreates** → Both codes are restored automatically

### What Gets Lost:

- ❌ Chat history
- ❌ Previous participant list
- ❌ Room settings (locked status)
- ❌ Any room-specific state

## Recommendations

### For Users:

1. **Save Room Information**
   - Copy the room URL (includes room ID)
   - Save host code securely
   - Save participant code if needed

2. **Rejoining as Host**
   - Use the same room ID from URL
   - Enter host code when prompted
   - Room will be recreated with you as host

3. **Scheduled Meetings**
   - Share room URL + codes ahead of time
   - Host should join first to recreate room
   - Participants can join after

### Potential Improvements (Future):

1. **Persistent Storage**
   - Store rooms in database/file
   - Persist room codes and settings
   - Survive server restarts

2. **Room Expiry**
   - Optional: Keep rooms for X hours/days
   - Auto-delete after expiry
   - Useful for scheduled meetings

3. **Room State Persistence**
   - Save chat history
   - Save participant list
   - Restore on recreation

## Summary

**Cleanup doesn't prevent room reuse** - it just ensures empty rooms don't accumulate. Rooms can be recreated anytime by:
1. Using the same room ID
2. Providing the correct access codes
3. The first person to join recreates the room

The system is designed for **on-demand meetings** rather than persistent scheduled rooms. This is intentional for simplicity and security (no database needed).

