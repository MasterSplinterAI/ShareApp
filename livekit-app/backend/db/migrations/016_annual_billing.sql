ALTER TABLE v2_plans ADD COLUMN IF NOT EXISTS annual_price_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE v2_plans ADD COLUMN IF NOT EXISTS stripe_annual_price_id TEXT;
ALTER TABLE v2_org_subscriptions ADD COLUMN IF NOT EXISTS billing_interval TEXT NOT NULL DEFAULT 'month';

UPDATE v2_plans SET annual_price_cents = 46800 WHERE id = 'starter' AND annual_price_cents = 0;
UPDATE v2_plans SET annual_price_cents = 190800 WHERE id = 'pro' AND annual_price_cents = 0;
