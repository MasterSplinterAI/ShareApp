-- Lalia V2 platform schema (PostgreSQL)
-- TEXT timestamps + INTEGER flags match existing app SQL / sqlCompat layer.

CREATE TABLE IF NOT EXISTS v2_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')),
  disabled_at TEXT,
  last_login_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_users_email_lower ON v2_users (lower(email));

CREATE TABLE IF NOT EXISTS v2_organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  billing_status TEXT NOT NULL DEFAULT 'trial',
  account_type TEXT NOT NULL DEFAULT 'personal',
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')),
  brand_accent_color TEXT,
  brand_welcome_message TEXT,
  brand_logo_file TEXT,
  suspended_at TEXT,
  suspended_reason TEXT
);

CREATE TABLE IF NOT EXISTS v2_org_members (
  org_id TEXT NOT NULL REFERENCES v2_organizations(id),
  user_id TEXT NOT NULL REFERENCES v2_users(id),
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS v2_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_price_cents INTEGER NOT NULL DEFAULT 0,
  included_meeting_minutes INTEGER NOT NULL DEFAULT 0,
  included_translation_minutes INTEGER NOT NULL DEFAULT 0,
  overage_meeting_cents_per_min INTEGER NOT NULL DEFAULT 0,
  overage_translation_cents_per_min INTEGER NOT NULL DEFAULT 0,
  stripe_price_id TEXT
);

CREATE TABLE IF NOT EXISTS v2_org_subscriptions (
  org_id TEXT PRIMARY KEY REFERENCES v2_organizations(id),
  plan_id TEXT NOT NULL REFERENCES v2_plans(id),
  status TEXT NOT NULL DEFAULT 'active',
  current_period_start TEXT,
  current_period_end TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  is_comp INTEGER NOT NULL DEFAULT 0,
  comp_label TEXT,
  comp_reason TEXT,
  comp_set_by TEXT,
  comp_set_at TEXT,
  overage_auto_charge_opt_in INTEGER NOT NULL DEFAULT 0,
  overage_auto_charge_opt_in_at TEXT,
  overage_auto_charge_opt_in_by TEXT,
  custom_included_meeting_minutes INTEGER,
  custom_included_translation_minutes INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  cancel_at TEXT,
  canceled_at TEXT
);

CREATE TABLE IF NOT EXISTS v2_billing_cycles (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES v2_organizations(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  rolled_up_at TEXT
);

CREATE TABLE IF NOT EXISTS v2_meetings (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES v2_organizations(id),
  host_user_id TEXT NOT NULL REFERENCES v2_users(id),
  livekit_room_name TEXT NOT NULL UNIQUE,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_start TEXT,
  scheduled_end TEXT,
  host_code TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')),
  metadata TEXT,
  host_present INTEGER NOT NULL DEFAULT 1,
  guest_invite_reminder_offsets_json TEXT,
  ics_sequence INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_v2_meetings_org ON v2_meetings(org_id);

CREATE TABLE IF NOT EXISTS v2_usage_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES v2_organizations(id),
  meeting_id TEXT,
  event_type TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  unit TEXT NOT NULL,
  unit_cost_micros INTEGER,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')),
  idempotency_key TEXT
);
CREATE INDEX IF NOT EXISTS idx_v2_usage_org_time ON v2_usage_events(org_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_usage_org_idempotency
  ON v2_usage_events(org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS v2_usage_rollups (
  org_id TEXT NOT NULL REFERENCES v2_organizations(id),
  cycle_id TEXT NOT NULL REFERENCES v2_billing_cycles(id),
  metric TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, cycle_id, metric)
);

CREATE TABLE IF NOT EXISTS v2_overage_ledger (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES v2_organizations(id),
  cycle_id TEXT NOT NULL REFERENCES v2_billing_cycles(id),
  metric TEXT NOT NULL,
  units DOUBLE PRECISION NOT NULL,
  rate_micros INTEGER NOT NULL,
  amount_micros INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')),
  stripe_invoice_item_id TEXT,
  settled_at TEXT,
  failure_reason TEXT,
  stripe_invoice_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_overage_ledger_org_cycle_metric
  ON v2_overage_ledger(org_id, cycle_id, metric);

CREATE TABLE IF NOT EXISTS v2_files (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES v2_organizations(id),
  meeting_id TEXT,
  room_name TEXT,
  stored_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT,
  size_bytes INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_v2_files_org ON v2_files(org_id);

CREATE TABLE IF NOT EXISTS v2_meeting_policies (
  meeting_id TEXT PRIMARY KEY REFERENCES v2_meetings(id),
  host_required_to_start INTEGER NOT NULL DEFAULT 0,
  require_invite_token INTEGER NOT NULL DEFAULT 1,
  store_transcripts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS v2_meeting_invite_links (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES v2_meetings(id),
  token TEXT NOT NULL UNIQUE,
  label TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  reusable INTEGER NOT NULL DEFAULT 0,
  use_count INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER,
  expiry_mode TEXT NOT NULL DEFAULT 'days_after_start',
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_v2_invite_meeting ON v2_meeting_invite_links(meeting_id);

CREATE TABLE IF NOT EXISTS v2_meeting_guest_invites (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES v2_meetings(id),
  invite_link_id TEXT,
  email TEXT NOT NULL,
  invited_by TEXT,
  sent_at TEXT,
  reminder_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')),
  reminders_sent_json TEXT,
  rsvp_status TEXT,
  rsvp_updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_v2_guest_invites_meeting ON v2_meeting_guest_invites(meeting_id);

CREATE TABLE IF NOT EXISTS v2_meeting_transcript_lines (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES v2_meetings(id),
  recorded_at TEXT NOT NULL,
  participant_identity TEXT NOT NULL,
  language TEXT,
  source_language TEXT,
  original_text TEXT NOT NULL,
  translated_text TEXT,
  transcription_id TEXT,
  dedupe_key TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_v2_transcript_meeting_time ON v2_meeting_transcript_lines(meeting_id, recorded_at);

CREATE TABLE IF NOT EXISTS v2_meeting_transcript_reports (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES v2_meetings(id),
  template_id TEXT NOT NULL,
  custom_instructions TEXT,
  instructions_hash TEXT NOT NULL,
  line_count INTEGER NOT NULL DEFAULT 0,
  content_markdown TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_v2_transcript_reports_meeting ON v2_meeting_transcript_reports(meeting_id, created_at);

CREATE TABLE IF NOT EXISTS v2_webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'stripe',
  type TEXT NOT NULL,
  payload_json TEXT,
  received_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')),
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS v2_admin_audit_log (
  id TEXT PRIMARY KEY,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_v2_admin_audit_created ON v2_admin_audit_log(created_at);

CREATE TABLE IF NOT EXISTS v2_platform_billing_settings (
  id TEXT PRIMARY KEY,
  stripe_enabled INTEGER NOT NULL DEFAULT 0,
  stripe_secret_key TEXT,
  stripe_webhook_secret TEXT,
  auto_charge_enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS v2_platform_email_settings (
  id TEXT PRIMARY KEY,
  email_enabled INTEGER NOT NULL DEFAULT 1,
  resend_api_key TEXT,
  mail_from TEXT,
  resend_webhook_secret TEXT,
  ics_organizer_domain TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS v2_platform_storage_settings (
  id TEXT PRIMARY KEY,
  storage_driver TEXT,
  storage_local_dir TEXT,
  storage_s3_bucket TEXT,
  storage_s3_region TEXT,
  storage_s3_endpoint TEXT,
  storage_s3_force_path_style INTEGER,
  storage_s3_access_key_id TEXT,
  storage_s3_secret_access_key TEXT,
  storage_s3_prefix TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS v2_resend_inbound_events (
  id TEXT PRIMARY KEY,
  payload_json TEXT,
  processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_announcements (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  created_by TEXT,
  disabled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_v2_announcements_active ON v2_announcements(starts_at, ends_at);

CREATE TABLE IF NOT EXISTS meeting_events (
  id BIGSERIAL PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  org_id TEXT,
  event_type TEXT NOT NULL,
  participant_identity TEXT,
  track_sid TEXT,
  payload_json TEXT,
  ts BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meeting_events_meeting ON meeting_events(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_events_org ON meeting_events(org_id);

CREATE TABLE IF NOT EXISTS meeting_cost_events (
  id BIGSERIAL PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  org_id TEXT,
  event_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  units DOUBLE PRECISION NOT NULL,
  unit_cost_usd DOUBLE PRECISION NOT NULL,
  total_cost_usd DOUBLE PRECISION NOT NULL,
  ts BIGINT NOT NULL,
  meta_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_cost_events_meeting ON meeting_cost_events(meeting_id);

CREATE TABLE IF NOT EXISTS meeting_cost_rollups (
  meeting_id TEXT PRIMARY KEY,
  org_id TEXT,
  total_cost_usd DOUBLE PRECISION NOT NULL,
  breakdown_json TEXT NOT NULL,
  duration_seconds INTEGER,
  computed_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS screen_share_quality_events (
  id BIGSERIAL PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  participant_identity TEXT,
  from_layer TEXT,
  to_layer TEXT,
  ts BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES v2_users(id),
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_v2_password_resets_token ON v2_password_resets(token_hash);

CREATE TABLE IF NOT EXISTS v2_user_communication_prefs (
  user_id TEXT PRIMARY KEY REFERENCES v2_users(id),
  marketing_email INTEGER NOT NULL DEFAULT 0,
  marketing_sms INTEGER NOT NULL DEFAULT 0,
  marketing_phone INTEGER NOT NULL DEFAULT 0,
  phone_e164 TEXT,
  prefs_updated_at TEXT,
  policy_version INTEGER NOT NULL DEFAULT 1,
  timezone TEXT,
  guest_invite_reminder_offsets_json TEXT,
  guest_invite_cc_host INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS v2_consent_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES v2_users(id),
  consent_type TEXT NOT NULL,
  granted INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT,
  policy_version INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_consent_events_user ON v2_consent_events(user_id);

CREATE TABLE IF NOT EXISTS v2_support_tickets (
  id TEXT PRIMARY KEY,
  public_number INTEGER NOT NULL UNIQUE,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  subject TEXT,
  severity TEXT,
  priority TEXT,
  user_id TEXT,
  org_id TEXT,
  guest_email TEXT,
  context_json TEXT,
  duplicate_of_ticket_id TEXT,
  assigned_to TEXT,
  github_issue_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_v2_support_tickets_status ON v2_support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_v2_support_tickets_user ON v2_support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_v2_support_tickets_created ON v2_support_tickets(created_at);

CREATE TABLE IF NOT EXISTS v2_support_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES v2_support_tickets(id),
  author_type TEXT NOT NULL,
  author_id TEXT,
  body TEXT NOT NULL,
  attachments_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_support_messages_ticket ON v2_support_messages(ticket_id);

CREATE TABLE IF NOT EXISTS v2_support_proposals (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES v2_support_tickets(id),
  proposal_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  summary TEXT NOT NULL,
  body_json TEXT NOT NULL,
  confidence DOUBLE PRECISION,
  telegram_message_id TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  execution_status TEXT,
  execution_ref TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_support_proposals_ticket ON v2_support_proposals(ticket_id);
CREATE INDEX IF NOT EXISTS idx_v2_support_proposals_status ON v2_support_proposals(status);

CREATE TABLE IF NOT EXISTS v2_support_knowledge_gaps (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES v2_support_tickets(id),
  public_number INTEGER,
  user_question TEXT NOT NULL,
  escalation_reason TEXT,
  doc_query TEXT,
  doc_hits_json TEXT,
  proposal_id TEXT,
  proposal_type TEXT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_v2_support_knowledge_gaps_status ON v2_support_knowledge_gaps(status);
CREATE INDEX IF NOT EXISTS idx_v2_support_knowledge_gaps_created ON v2_support_knowledge_gaps(created_at);

CREATE TABLE IF NOT EXISTS v2_stripe_disputes (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES v2_organizations(id),
  stripe_customer_id TEXT,
  charge_id TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  evidence_due_by TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')),
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_v2_stripe_disputes_org ON v2_stripe_disputes(org_id);
CREATE INDEX IF NOT EXISTS idx_v2_stripe_disputes_status ON v2_stripe_disputes(status);

CREATE TABLE IF NOT EXISTS v2_usage_alert_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES v2_organizations(id),
  alert_key TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_v2_usage_alert_events_org_key ON v2_usage_alert_events(org_id, alert_key, sent_at);

-- Seed plans
INSERT INTO v2_plans (id, name, monthly_price_cents, included_meeting_minutes, included_translation_minutes, overage_meeting_cents_per_min, overage_translation_cents_per_min)
VALUES
  ('free', 'Free', 0, 60, 60, 0, 0),
  ('starter', 'Starter', 4900, 2000, 500, 3, 6),
  ('pro', 'Pro', 19900, 10000, 3000, 2, 5)
ON CONFLICT (id) DO NOTHING;
