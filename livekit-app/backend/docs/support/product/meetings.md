# Meetings

Lalia provides hosted video meetings with optional translation, captions, and video effects.

## Creating a meeting (New meeting dialog)

From **Meetings** in the left sidebar, click **New meeting** or **Start instant meeting**.

The **New meeting** dialog lets you set:

- **Title**
- **Optional schedule** — pick a date and time for a future meeting (leave blank for an instant meeting)
- **Require host before guests enter** — guests wait in the lobby until the host joins
- **Save transcript on server** — store captions for this meeting when enabled for your workspace

**Important:** There is **no invite expiration or link duration option on the create-meeting screen.** You cannot choose “never expire” or custom expiry while creating the meeting.

After you create the meeting, you are taken to the meeting page where guest links and expiration are managed.

## Scheduled meetings

1. Click **New meeting** on the Meetings page.
2. Enter a title and choose a **date and time** in the schedule picker.
3. Click create — the meeting appears under **Upcoming** until start time.
4. Open the meeting to copy the guest link or adjust settings.

Scheduling only sets **when the meeting starts**. It does not set how long invite links stay valid.

## Guest invite links and expiration

Invite link duration is configured **after** the meeting exists — not during creation.

### Main guest link

At the top of the meeting page, **Invite guests** shows the primary guest link. It has a default expiration (shown under the link), for example “Through end of meeting” for scheduled meetings or “7 days after start” for instant meetings.

### Custom expiration (Advanced invites)

To control how long a link stays valid — including longer or “until archived” links:

1. Open **Meetings** in the left sidebar.
2. Click your meeting to open it.
3. Expand **Meeting settings** (accordion section on the meeting page).
4. Scroll to **Advanced invites**.
5. Choose an **expiration** preset, then click **Create invite**:
   - **Through end of meeting** — expires after the meeting ends (plus a short buffer). Default for scheduled meetings.
   - **Day of meeting** — valid from one hour before start until end of that calendar day (UTC).
   - **7 days after start** — measured from scheduled start, or from now if unscheduled. Default for instant meetings.
   - **Custom hours** — set your own duration from scheduled start (or from now).
   - **Until archived** — stays valid until you archive the meeting (subject to the workspace max TTL cap). Use this when guests need access for a long time after the meeting.

Copy the new invite link and share it. You can revoke old links from the same section.

### Access and policy toggles

Under **Meeting settings → Access & policy** (same accordion), hosts can also toggle:

- **Require host before guests enter**
- **Secure invite link** (token in URL — recommended)
- **Save transcript on server**

These are separate from expiration presets in **Advanced invites**.

## Joining a meeting

1. Open the invite link or enter the room from your dashboard.
2. On the **Pre-join** screen, choose camera, microphone, and optional video effect.
3. Click **Join** to enter the room.

Guests may join without an account if the host allows guest access on the invite.

## Host controls

Hosts can mute participants, end the meeting, and manage recording/transcript settings from the control bar.

## Transcripts

When enabled for the organization, meeting transcripts are stored according to org policy. Users can export transcripts from the meeting history in the V2 app.

## Common issues

- **Cannot join:** Check browser permissions for camera/mic; try Chrome or Safari latest.
- **Black video:** Toggle camera off/on; verify no other app is using the camera.
- **Guest link expired:** Open the meeting → **Meeting settings** → **Advanced invites** → create a new invite with a longer expiration (e.g. **Until archived** or **Custom hours**).
- **Wrong steps about expiration on create:** Expiration is **not** on the New meeting form — only in **Meeting settings** after the meeting is created.
