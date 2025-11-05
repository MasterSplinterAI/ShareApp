# Meeting Access Control & Host Features Plan

## Current State
- ✅ Room codes (6 characters) - simple and shareable
- ✅ Links via URL params (`?room=xxxxxx`)
- ✅ Host role assigned when creating room
- ❌ No access control/password protection
- ❌ No host permissions (mute/unmute, remove participants)
- ❌ Host leaving doesn't transfer host role

## Recommendations

### 1. **Optional Access Code (Password Protection)**
**Why:** Keep meetings simple by default, but allow privacy when needed

**Implementation:**
- When hosting, option to add an access code (4-6 digits)
- When joining, prompt for access code if room has one
- Store access code in room object on server
- Validate access code before allowing join

**UI:**
- Checkbox: "Require access code for this meeting"
- Input field for access code (show/hide toggle)
- Join flow: If room has code, show input before joining

### 2. **Host Controls & Permissions**
**Why:** Hosts need to manage meetings effectively

**Host Abilities:**
- ✅ Mute/unmute any participant's microphone
- ✅ Turn on/off any participant's camera
- ✅ Remove participant from meeting
- ✅ Transfer host role to another participant
- ✅ Lock meeting (prevent new joins)

**UI:**
- Host badge/indicator on participant cards
- Dropdown menu on participant cards for host actions
- Settings panel showing host controls

### 3. **Persistent Host Role**
**Why:** Meeting should continue if host leaves

**Implementation:**
- When host leaves, transfer host to first remaining participant
- Notify all participants of host change
- Update UI to show new host

### 4. **Better Link Sharing**
**Why:** Make it easier to share meetings

**Features:**
- Copy link button (one-click)
- Copy room code button
- QR code generation for mobile sharing
- Share directly via email/SMS (if browser supports)

### 5. **Meeting Settings Panel**
**Why:** Centralized control for meeting configuration

**Settings:**
- Toggle access code requirement
- Change access code
- Lock/unlock meeting
- Show/hide room code
- Meeting duration timer

## Implementation Priority

### Phase 1 (Essential)
1. ✅ Optional access code (password protection)
2. ✅ Host controls (mute/unmute, remove)
3. ✅ Persistent host role transfer

### Phase 2 (Nice to Have)
4. Copy link button
5. QR code generation
6. Meeting settings panel
7. Lock meeting feature

## User Flow Examples

### Scenario 1: Scheduled Meeting Tomorrow
1. Host clicks "Host Meeting"
2. Sets optional access code: "1234"
3. Gets room code: "abc123"
4. Shares link: `share.jarmetals.com/?room=abc123`
5. Tells participants: "Access code: 1234"
6. Tomorrow: Participants join with code "abc123" + access code "1234"

### Scenario 2: Open Meeting (No Password)
1. Host clicks "Host Meeting"
2. No access code needed
3. Gets room code: "xyz789"
4. Shares link freely
5. Anyone with link can join

### Scenario 3: Host Leaves
1. Host leaves meeting
2. First remaining participant becomes host
3. All participants notified: "John is now the host"
4. New host gets host controls

## Security Considerations
- Access codes stored server-side (not in URL)
- Access codes validated server-side
- Host actions validated server-side
- Rate limiting on join attempts

## Technical Notes
- Store room access code in server `rooms` object
- Add `hostActions` socket events for mute/unmute/remove
- Add `host-changed` event (already exists, enhance it)
- Add validation middleware for host actions

