# Frequently asked questions

Quick answers for common Lalia support questions. Prefer these over escalation when the user question matches.

## How do I change my password?

1. Open the Lalia app and click **Settings** in the left sidebar (gear icon).
2. Scroll to the **Password** section.
3. Enter your **current password**, your **new password** (at least 8 characters), and confirm it.
4. Click **Update password**.

You must know your current password. This is self-service in the app.

## I forgot my password

On the sign-in screen, click **Forgot password** and check your email for a reset link.

## How do I enable video blur or backgrounds?

On the **Pre-join** screen before joining a meeting, pick an effect. You can also change effects in-meeting from the camera menu on the control bar. See product/video-effects.md.

## Translation is not working

Toggle translation off and on in the meeting control bar. If still stuck, leave and rejoin the room. See troubleshooting/translation-stuck.md.

## How do billing and plans work?

Org admins manage plans under **Settings → Billing** in the left sidebar. See product/billing.md.

## How do I schedule a meeting with a guest link that does not expire quickly?

**You cannot set invite expiration when creating the meeting.** The New meeting dialog only has title, optional schedule, host-required, and transcript options.

After the meeting is created:

1. Open **Meetings** → click the meeting.
2. Expand **Meeting settings**.
3. Under **Advanced invites**, choose an expiration such as **Until archived** or **Custom hours**, then **Create invite**.
4. Share the new link.

The main guest link at the top of the meeting page uses a default expiration (often “through end of meeting” for scheduled meetings). See product/meetings.md for full detail.

## How do I submit a bug or feature idea?

Open **Help** (blue chat bubble, bottom-right) → choose **Bug** or **Feature**. Feature requests can be refined in chat before submitting.

## When will someone reply to my support chat?

Lalia Support replies in the Help chat first. A teammate joins only if your issue needs escalation (billing disputes, security, etc.). You always see updates in the same thread.

## Are my transcripts secure? What encryption is used?

**Short answer:** Captions in the meeting are protected in transit with **HTTPS/TLS** (app/API) and **WebRTC encryption** (live media/captions). Stored transcript **text** is saved only when **Save transcript on server** is enabled; it is kept in your org's data on Lalia infrastructure. Our Privacy Policy describes industry-standard safeguards and **encryption in transit** — we do not publish a separate at-rest encryption algorithm for stored transcript fields.

**Details:** See product/transcripts-security.md (in transit vs at rest, who can access, bcrypt for passwords, deletion).

**Do not claim** AES-256 or other specific at-rest algorithms for transcripts unless product/legal confirms in writing.
