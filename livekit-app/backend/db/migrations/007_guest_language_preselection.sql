-- Guest language preselection on invite links and emailed guest invites

ALTER TABLE v2_meeting_invite_links
  ADD COLUMN IF NOT EXISTS default_language TEXT;

ALTER TABLE v2_meeting_guest_invites
  ADD COLUMN IF NOT EXISTS default_language TEXT;
