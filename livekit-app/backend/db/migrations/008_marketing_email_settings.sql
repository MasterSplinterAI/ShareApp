-- Marketing email settings for @rhule/marketing-kit (Admin → Marketing).
-- Separate from transactional Resend inbound webhook secret.
ALTER TABLE v2_platform_email_settings
  ADD COLUMN IF NOT EXISTS marketing_resend_webhook_secret TEXT;

ALTER TABLE v2_platform_email_settings
  ADD COLUMN IF NOT EXISTS marketing_email_from TEXT;
