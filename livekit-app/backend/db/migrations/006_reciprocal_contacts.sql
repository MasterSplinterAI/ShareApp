-- Reciprocal Contact Request / 1-Tap "Add Back" Flow

ALTER TABLE v2_contacts
  ADD COLUMN IF NOT EXISTS recipient_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE v2_contacts
  ADD COLUMN IF NOT EXISTS recipient_responded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_v2_contacts_reverse_lookup
  ON v2_contacts (LOWER(contact_email), contact_user_id, recipient_status);

-- Backfill contact_user_id where the email matches an existing v2_users row
UPDATE v2_contacts c
SET contact_user_id = u.id
FROM v2_users u
WHERE c.contact_user_id IS NULL
  AND LOWER(u.email) = LOWER(c.contact_email);

-- Backfill recipient_status = 'accepted' for existing pairs where both users have already added each other
UPDATE v2_contacts c1
SET recipient_status = 'accepted',
    recipient_responded_at = COALESCE(c1.recipient_responded_at, NOW())
FROM v2_users u1, v2_contacts c2, v2_users u2
WHERE u1.id = c1.owner_user_id
  AND u2.id = c2.owner_user_id
  AND (c1.contact_user_id = u2.id OR LOWER(c1.contact_email) = LOWER(u2.email))
  AND (c2.contact_user_id = u1.id OR LOWER(c2.contact_email) = LOWER(u1.email))
  AND c1.recipient_status = 'pending';
