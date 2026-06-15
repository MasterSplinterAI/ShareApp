# Meeting transcripts — storage and security

## When are transcripts stored?

Parley does **not** record meeting audio or video. **Text transcripts** (captions) are stored on our servers **only when**:

1. Your workspace allows transcript storage, and  
2. **Save transcript on server** is enabled for that meeting (in the **New meeting** dialog or under **Meeting settings → Access & policy**).

If storage is off, captions may still appear live in the meeting but are not saved after the meeting ends.

## Who can access stored transcripts?

Stored transcripts belong to your **organization**. They are available to users who can access that meeting in the Parley app (typically org members). Hosts and org admins can export or delete them from meeting history.

## What encryption is used?

### In transit

- **Web app and API:** All communication with Parley uses **HTTPS (TLS)**.
- **Live meeting media and captions:** Real-time audio, video, and caption data use **WebRTC encryption** (DTLS-SRTP) via LiveKit — industry-standard protection for data in flight during the meeting.
- **Saving transcript lines:** When captions are persisted, the client sends them to our backend over **HTTPS/TLS**.

### At rest (stored transcript text)

When **Save transcript on server** is on, transcript text is stored in Parley's database on our infrastructure, scoped to your organization.

Our **Privacy Policy** (Settings → legal links, or `/privacy`) states that we use industry-standard safeguards and that **data is encrypted in transit**. We do **not** document a separate application-level encryption scheme (for example AES-256 field encryption) specifically for stored transcript content. Infrastructure providers may encrypt disks at the host level; contact us if you need details for a security review or RFP.

### Account credentials

User passwords are stored as **bcrypt hashes** (one-way, not stored in plain text). See product/account-settings.md for password changes.

## Deleting transcripts

Hosts and organization admins can delete stored transcripts from the meeting in the app. Account deletion is described in the Privacy Policy.

## When to escalate

Escalate to a human (do not guess) for: custom enterprise agreements, compliance certifications, pen-test reports, or questions about a specific cloud region/data residency not covered here.
