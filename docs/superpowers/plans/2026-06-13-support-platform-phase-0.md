# Support Platform Phase 0 — Account, Consent & Legal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship change-password in settings, communication consent storage + UI, and Privacy/ToS updates — no blockers for Phase 1 tickets/Telegram.

**Architecture:** Extend existing v2 SQLite schema and `/v2/auth` routes; add consent audit table; update `V2OrgSettings` Account section and `V2Signup` optional marketing checkbox; expand legal pages. Reuse password hashing from `authAdapter`, rate limiting pattern from forgot-password.

**Tech Stack:** Node/Express, SQLite (`v2Database.js`), React/V2 settings, existing `sendEmail` unchanged.

**Spec:** `docs/superpowers/specs/2026-06-13-parley-support-platform-design.md` §12

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/db/v2Database.js` | Migrations: comm prefs + consent events |
| `backend/routes/v2/auth.js` | change-password, communication-prefs GET/PATCH |
| `backend/routes/v2/auth.test.js` | New — API tests (or extend if exists) |
| `frontend/src/services/apiV2.js` | Client methods |
| `frontend/src/v2/pages/V2OrgSettings.jsx` | Password + comm prefs UI |
| `frontend/src/v2/pages/V2Signup.jsx` | Optional marketing email checkbox |
| `frontend/src/components/legal/TermsPage.jsx` | Support + feedback sections |
| `frontend/src/components/legal/PrivacyPage.jsx` | Support data + marketing prefs |
| `backend/.env.example` or root env docs | Document `POLICY_VERSION=1` if used |

---

### Task 1: Database migrations

**Files:**
- Modify: `livekit-app/backend/db/v2Database.js`

- [ ] **Step 1:** Add `POLICY_VERSION` constant usage — default `1` in migration comments.
- [ ] **Step 2:** Add tables from spec §5.4 (`v2_user_communication_prefs`, `v2_consent_events`).
- [ ] **Step 3:** On signup path, insert default prefs row (all marketing flags 0) — hook in auth signup after user insert.
- [ ] **Step 4:** Restart backend locally; confirm tables exist (`sqlite3 v2-platform.db ".schema v2_user_communication_prefs"`).

---

### Task 2: Change password API

**Files:**
- Modify: `livekit-app/backend/routes/v2/auth.js`
- Test: `livekit-app/backend/routes/v2/auth.changePassword.test.js` (create)

- [ ] **Step 1:** Write failing test — POST `/change-password` with wrong current password → 401.

```javascript
// auth.changePassword.test.js — use supertest against router or mini app
it('rejects wrong current password', async () => {
  // setup user + session token
  const res = await request(app)
    .post('/v2/auth/change-password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: 'wrong', newPassword: 'newpass123' });
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2:** Run test — expect FAIL.
- [ ] **Step 3:** Implement `POST /change-password`:
  - `requireV2Auth`
  - body: `currentPassword`, `newPassword` (min 8)
  - verify current via `verifyPassword`
  - `hashPassword` + update `v2_users.password_hash`
  - rate limit per user (reuse IP map pattern or simple 5/15min per user id)
- [ ] **Step 4:** Test passes for happy path + validation errors.
- [ ] **Step 5:** Commit (if user requested).

---

### Task 3: Communication prefs API

**Files:**
- Modify: `livekit-app/backend/routes/v2/auth.js`
- Test: same test file

- [ ] **Step 1:** `GET /communication-prefs` — return prefs or defaults for authed user.
- [ ] **Step 2:** `PATCH /communication-prefs` — body: `marketingEmail`, `marketingSms`, `marketingPhone`, `phoneE164` (optional).
  - Validate: if sms/phone true, require plausible phone or reject sms/phone until Twilio phase (spec: disable SMS/phone toggles in UI but store schema now).
  - Insert `v2_consent_events` row per changed field.
  - Update `prefs_updated_at`, `policy_version`.
- [ ] **Step 3:** Tests for GET default + PATCH + consent event row count.
- [ ] **Step 4:** Extend signup to accept optional `marketingEmail: boolean` and write prefs + consent event.

---

### Task 4: Frontend API client

**Files:**
- Modify: `livekit-app/frontend/src/services/apiV2.js`

- [ ] Add to `v2Auth`:
  - `changePassword({ currentPassword, newPassword })`
  - `communicationPrefs()` → GET
  - `updateCommunicationPrefs(body)` → PATCH
- [ ] Extend `signup` payload type with optional `marketingEmail`.

---

### Task 5: Settings UI — password + comm prefs

**Files:**
- Modify: `livekit-app/frontend/src/v2/pages/V2OrgSettings.jsx`

- [ ] **Password card** (Account section):
  - Current / new / confirm fields
  - Submit → `v2Auth.changePassword`
  - Toast success; clear fields
- [ ] **Communication preferences card**:
  - Load on profile section mount
  - Checkbox: product updates by email (maps to `marketingEmail`)
  - SMS/phone toggles visible but `disabled` with helper text "Coming soon"
  - Save → PATCH + toast
- [ ] Manual smoke: login → Settings → change password → re-login with new password.

---

### Task 6: Signup marketing checkbox

**Files:**
- Modify: `livekit-app/frontend/src/v2/pages/V2Signup.jsx`

- [ ] Optional unchecked checkbox below ToS agreement: "Email me product updates and tips"
- [ ] Pass `marketingEmail: agreedToMarketing` in signup body (only if checked)

---

### Task 7: Legal page updates

**Files:**
- Modify: `livekit-app/frontend/src/components/legal/PrivacyPage.jsx`
- Modify: `livekit-app/frontend/src/components/legal/TermsPage.jsx`

- [ ] Privacy: new bullets for support tickets, device context, AI-assisted support, marketing preferences + opt-out (§12.3 spec).
- [ ] Terms: feedback license, support channel abuse, plan support tiers (§12.3).
- [ ] Bump `LAST_UPDATED` to implementation date.
- [ ] Keep `COMPANY_LEGAL_NAME` as `Parley` until user provides legal entity — add comment only, no blocker.

---

### Task 8: Verification

- [ ] Backend: run auth tests
- [ ] Frontend: `npm run lint` in `livekit-app/frontend`
- [ ] Manual: signup with/without marketing checkbox; verify DB prefs + consent_events

---

## Phase 0 complete when

- [ ] User can change password from Settings
- [ ] Communication prefs persist with audit trail
- [ ] Signup optional marketing opt-in works
- [ ] Legal pages mention support + marketing data

**Next plan:** `2026-06-13-support-platform-phase-1.md` (tickets, Help widget, Telegram alerts)
