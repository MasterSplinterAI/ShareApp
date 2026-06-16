# Admin Billing, Stripe & Marketing Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give superadmins a Stripe/billing status panel, subscription cancel tools (admin + user), and a marketing email opt-in report — without storing secrets in the DB.

**Architecture:** Read-only billing config from env vars; Stripe subscription cancel via Stripe API + webhooks for state sync; marketing consent queried from existing `v2_user_communication_prefs` / `v2_consent_events`. User cancel uses Stripe Customer Portal `flow_data` for direct cancel UX.

**Tech Stack:** Express admin routes, React admin tabs, Stripe Node SDK, existing apiV2 client.

---

### Task 1: Backend billing config + admin cancel subscription

**Files:**
- Modify: `livekit-app/backend/routes/v2/admin.js`
- Modify: `livekit-app/backend/routes/v2/billing.js` (portal cancel flow)

- [ ] Add `GET /admin/billing/config` — stripe enabled, key mode (test/live/unset), webhook URL, auto-charge flag, plans with price IDs
- [ ] Add `POST /admin/orgs/:orgId/cancel-subscription` — audit reason, `cancelAtPeriodEnd` default true, calls Stripe API
- [ ] Extend `POST /billing/portal` with optional `flow: 'cancel'` using Stripe portal flow_data

### Task 2: Backend marketing consent report

**Files:**
- Modify: `livekit-app/backend/routes/v2/admin.js`

- [ ] Add `GET /admin/consent/marketing` — filter (opted_in|opted_out|all), search by email, pagination, summary counts
- [ ] Include marketing pref in `GET /admin/users/:userId` response

### Task 3: Frontend Admin Billing tab

**Files:**
- Create: `livekit-app/frontend/src/v2/pages/admin/BillingTab.jsx`
- Modify: `livekit-app/frontend/src/services/apiV2.js`
- Modify: `livekit-app/frontend/src/v2/components/AdminShell.jsx`
- Modify: `livekit-app/frontend/src/App.jsx`
- Modify: `livekit-app/frontend/src/v2/pages/AdminDashboard.jsx`

### Task 4: Frontend marketing opt-in report

**Files:**
- Modify: `livekit-app/frontend/src/v2/pages/admin/CommsTab.jsx`

### Task 5: User + admin cancel UX

**Files:**
- Modify: `livekit-app/frontend/src/v2/pages/V2OrgSettings.jsx`
- Modify: `livekit-app/frontend/src/v2/pages/admin/OrgsTab.jsx`
- Modify: `livekit-app/frontend/src/services/apiV2.js`
