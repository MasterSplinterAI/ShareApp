-- Persist signed-in UI/meeting language preference on the user profile.
ALTER TABLE v2_users ADD COLUMN IF NOT EXISTS preferred_language TEXT;
