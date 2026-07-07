# Parley — Launch Readiness Fix Plan

> Generated from a 4-track launch audit (security/backend, billing/entitlements, frontend/UI, marketing/conversion).
> Every item below was verified by reading the cited code. Work top-to-bottom: **Phase 0 blocks charging money and must ship first.**
>
> **Repo layout (read this first):**
> - Backend: `backend/` — Express + SQLite (`backend/db/v2Database.js`, runtime DBs `v2-platform.db`/`translations.db`). Routes in `backend/routes/` and `backend/routes/v2/`. Business logic in `backend/lib/`. Auth middleware `backend/middleware/v2Auth.js`.
> - Frontend: `frontend/` — React + Vite + Tailwind. Marketing/meeting components `frontend/src/components/`, authed product `frontend/src/v2/`, copy strings `frontend/src/locales/en.json`.
> - Translation agent: `translation-agent/` — Python LiveKit agent. **Active/deployed file is `transcription_only_agent.py`** (others are dead backups). Cost telemetry `translation-agent/cost_reporter.py`.
>
> **Working conventions:** parameterized SQL only; immutable updates; small focused commits per task; do NOT modify the meeting/translation core unless a task says so. After each task, run the acceptance check before moving on.

---

## PHASE 0 — Money + auth bypass (MUST ship before charging a single customer)

### TASK 0.1 — Meter translation minutes into the billing table
**Problem:** Plans sell "included translation minutes" + overage rates (Starter 5¢/min, Pro 4¢/min — `backend/db/v2Database.js:447,451`), but **nothing ever writes an `event_type='translation_minute'` row** to `v2_usage_events`. The entitlement cap (`backend/lib/v2Entitlements.js:53-54`) and overage ledger (`backend/lib/v2OverageLedger.js:17,23`) both sum that event type, so translation usage is always 0. The agent's cost telemetry goes to a *different* table (`meeting_cost_events`) that billing never reads.

**Fix (pick ONE source of truth — recommend the reconciler approach):**
- **Option A (recommended): backend reconciler.** Add a job/function that reads `meeting_cost_events` STT minutes per meeting/org and writes corresponding `translation_minute` rows into `v2_usage_events`, using an idempotency key like `cost:<meeting_id>:<cost_event_id>` (the unique index `(org_id, idempotency_key)` at `v2Database.js:324` already supports dedup). Run it from the same place participant-minutes are flushed (`backend/routes/webhooks.js` `room_finished`) and/or a periodic cron.
- **Option B: agent POSTs usage.** Have `cost_reporter.py` POST to the existing `POST /v2/usage/events` endpoint (`backend/routes/v2/usage.js:6`, already allows `translation_minute`) with the `COST_EVENT_SECRET` auth used by `/api/cost-events`.

Decide A or B and document it in `backend/docs/`. Do not do both.

**Acceptance:** Run a meeting with cross-language translation, end it, then query `SELECT event_type, SUM(quantity) FROM v2_usage_events WHERE org_id=? GROUP BY 1` — `translation_minute` rows exist and match agent-reported STT minutes within rounding. `GET /v2/usage` reflects translation minutes.

---

### TASK 0.2 — Build the overage settlement worker
**Problem:** `backend/lib/v2OverageLedger.js:40,55` writes ledger rows as `status:'pending'`, and **no code ever charges them or moves them off `pending`**. `writeOverageLedgerForCycle` is only called from `settle-dry-run` (`backend/routes/v2/billing.js:206`). The auto-charge opt-in gate (`backend/lib/v2OrgBillingPrefs.js:16`) is therefore decorative.

**Fix:** Add a settlement step (cron or admin-triggered endpoint) that, for each `v2_billing_cycles` row past `period_end`:
1. Skips comp orgs and orgs where `getOverageAutoChargeState(org).effective !== true`.
2. Creates Stripe invoice items / a one-off invoice from `pending` ledger rows for that `(org_id, cycle_id, metric)`.
3. Marks rows `charged` (with Stripe ref) or `failed`. Must be idempotent on `(org_id, cycle_id, metric)` — the dedup at `v2OverageLedger.js:32-35` already supports this.

**Acceptance:** Seed a cycle with overage + opt-in enabled → run settlement → ledger rows move to `charged` with a Stripe invoice-item id, and a re-run creates no duplicate charges. With opt-in OFF, rows stay `pending` and no charge is created.

---

### TASK 0.3 — Enforce usage cap in-meeting and on the guest-join path
**Problem:** `assertCanCreateMeeting` (`backend/lib/v2Entitlements.js:68-106`) runs only at meeting create (`backend/routes/v2/meetings.js:84`) and host-token mint (`meetings.js:659`). The **guest** token path (`backend/routes/v2/joinPublic.js:49-95` `validateGuestAccess`) checks suspension/billing status but **not** the usage cap. A single open meeting therefore translates with no ceiling.

**Fix:**
1. Call the usage-cap check in `validateGuestAccess` (block guest joins for free/over-hard-cap orgs).
2. Add a periodic in-meeting check: on `participant_joined` in `backend/routes/webhooks.js`, re-run the cap for the room's org; when over hard cap, end the room via LiveKit (or flip caption/translation off) and surface a clear "limit reached" state.
3. Document/justify the `hardCapMultiplier` value (default 2× for paid; forced 1× for free at `v2Entitlements.js:6`).

**Acceptance:** A free org at its 60-min cap cannot create a new meeting (already true) AND its in-progress meeting is terminated/degraded once it crosses the hard cap; guest links into an over-cap org are refused with a 402-style message.

---

### TASK 0.4 — Authorize the `caption-config` endpoint (host-only)
**Problem (confirmed authz hole, flagged in `LAUNCH_SPEC.md`):** `backend/routes/v2/captionConfig.js:7-38` (mounted at `/api/v2/rooms/:name/caption-config`, `backend/routes/v2/index.js:19`) applies only `requireV2Auth`. Any logged-in user from any org who knows/guesses a `livekit_room_name` can call `svc.updateRoomMetadata(name, ...)` and kill captions in someone else's paid meeting. No org scope, no host check, no audit.

**Fix:** Mirror the pattern in `backend/routes/v2/host.js` (e.g. `host.js:72,102,157`): resolve the meeting `WHERE livekit_room_name=? AND org_id=?` scoped to `req.v2Auth.orgId`, then require `host_user_id === userId || role in ('owner','admin')`. Prefer keying by meeting `:id` over raw room name. Reject with 403 otherwise.

**Acceptance:** A user in Org A gets 403 calling caption-config for an Org B / different-host room; the legitimate host still succeeds. Add a test asserting cross-org rejection.

---

### TASK 0.5 — Make both webhooks fail CLOSED on missing/invalid signature
**Problem:**
- **LiveKit:** `backend/routes/webhooks.js:301-314` reads `VERIFY = process.env.LIVEKIT_WEBHOOK_VERIFY !== 'false'`, and `backend/.env:48` currently sets it to `false` → the unauthenticated `/api/webhooks/livekit` (`server.js:69`) accepts forged participant events that drive billable minutes.
- **Stripe:** `backend/routes/v2/billingWebhook.js:151-159` logs a warning and **processes the event anyway** when no webhook secret is configured, then trusts `metadata.org_id`/`plan_id` from the body to set `plan_id` + `status='active'` (`:117-126`). Forged `checkout.session.completed` = free plan upgrade.

**Fix:**
1. LiveKit: require `WebhookReceiver.receive()` verification; remove the `!== 'false'` opt-out for production (fail closed). Set `LIVEKIT_WEBHOOK_VERIFY=true` (or delete the flag) in all non-local env.
2. Stripe: when no webhook secret is configured AND `NODE_ENV==='production'`, return `400` and do not mutate any subscription. (Signature verification itself is already correct — `billingWebhook.js:7-39`.)

**Acceptance:** In a prod-like env, an unsigned POST to either webhook returns 4xx and writes nothing. Signed events still process. Add tests for both.

---

### TASK 0.6 — Secrets & environment hardening
**Problem:** `backend/.env` contains live `LIVEKIT_API_SECRET`, an `xai-…` translation key, `COST_EVENT_SECRET`, and `SUPPORT_TELEGRAM_BOT_TOKEN` (not committed — `.gitignore` is clean — but live on a dev box and exposed during audit). `JWT_SECRET_V2` is unset, so `backend/lib/authAdapter.js:8` falls back to the hardcoded `'change-me-in-production-v2'` → forgeable tokens. `backend/.env:NODE_ENV=development` leaks raw error messages (`server.js:96`) and enables permissive CORS (`server.js:34-40`).

**Fix:**
1. **Rotate** all four live secrets; move prod secrets to the platform secret manager, never a checked-in-adjacent `.env`.
2. Set a strong `JWT_SECRET_V2`; make `authAdapter.js` **throw on startup** if no strong secret is configured (no default fallback).
3. Set `NODE_ENV=production` for launch; verify the prod CORS allowlist is tight (no `ngrok`/regex origins) and error responses don't return `err.message`.
4. Confirm `backend/Dockerfile` build context excludes `.env*`; delete any `.env.backup`/`.env.bak`.

**Acceptance:** App refuses to boot without `JWT_SECRET_V2`; prod responses return generic error bodies; `git ls-files | grep -i env` shows only `*.example`.

---

## PHASE 1 — White-screen / lockout fixes (ship right after Phase 0)

### TASK 1.1 — Wrap the whole app in ErrorBoundary
**Problem:** `frontend/src/App.jsx:100-103` wraps only `/room/:roomName`. The entire `/v2/*` paid tree, admin, marketing `HomeScreen`, `/terms`, `/privacy`, `/join` white-screen on any render error.
**Fix:** Wrap the `/v2` element (or `V2Layout`'s `<Outlet>`) and ideally each top-level route in `frontend/src/components/ErrorBoundary.jsx`. Provide a recover/reload affordance.
**Acceptance:** Throwing in a v2 page renders the fallback UI, not a blank screen.

### TASK 1.2 — Global 401 handling
**Problem:** `frontend/src/services/apiV2.js` has a request interceptor but no response interceptor; `frontend/src/v2/V2RequireAuth.jsx:6-12` only checks that a token *exists*. An expired 7-day token renders the app, then every call 401s into misleading empty states.
**Fix:** Add `apiV2.interceptors.response` that, on 401, clears `v2_token` and redirects to `/v2/login`.
**Acceptance:** With an expired/invalid token, the first failed call routes the user to login instead of showing empty data.

### TASK 1.3 — RTL support
**Problem:** Arabic/Hebrew/Persian/Urdu are selectable UI locales (`frontend/src/lib/uiLanguages.js:48-50`, `deepgramLanguages.ts:63,85-87`), but `frontend/src/context/I18nProvider.jsx:33-36` sets only `document.documentElement.lang`, never `dir`.
**Fix:** Set `document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr'`. Audit hard-coded `left/right/ml-/mr-` in shared chrome (nav, sidebar, control bar) → logical Tailwind utilities (`ms-/me-/start/end`).
**Acceptance:** Selecting Arabic flips layout direction across marketing, meeting, and admin without visual breakage.

---

## PHASE 2 — Billing correctness & security hardening

### TASK 2.1 — Reconcile cost-event provider maps
**Problem:** `translation-agent/cost_reporter.py:18` emits `openai_stt_minute`, but `backend/lib/costConstants.js` has no such key → `computeCost` throws, `backend/routes/costEvents.js:44` returns 400, and the cost event is silently dropped. `xai` STT is also unmapped.
**Fix:** Align `cost_reporter.py` provider→event_type maps with `costConstants.js` keys (add `openai_stt_minute`, any `xai` mapping). Add a unit test asserting every value in the agent's `_STT_EVENT_TYPES`/`_LLM_EVENT_TYPES` exists as a key in `COSTS`.
**Acceptance:** With OpenAI STT active, `meeting_cost_events` records STT rows; the new test passes.

### TASK 2.2 — Clean cancel/downgrade entitlement revocation
**Problem:** `backend/routes/v2/billingWebhook.js:71` copies Stripe `status` verbatim but never sets `plan_id='free'` on cancel; `v2_organizations.billing_status` (which guest-join checks at `joinPublic.js:56`) is never touched by the webhook → guest access can persist after cancellation.
**Fix:** On `customer.subscription.deleted`/`canceled`, set `plan_id='free'` (or a grace state) and propagate to `v2_organizations.billing_status`. Make one field authoritative for access.
**Acceptance:** Canceling via Stripe portal drops the org to free entitlements and stops guest joins.

### TASK 2.3 — Single source of truth for plan metadata
**Problem:** `backend/lib/v2PlanFeatures.js:6` grants team workspace to `pro/business/enterprise/team`, but only `free/starter/pro` are seeded (`v2Database.js:443-451`) — so paid **Starter customers can't invite colleagues**, and `business/team` break `upgradeOffers.js:2` `PLAN_RANK` (ranks them 99).
**Fix:** Add a `team_workspace` (and other capability) column to `v2_plans`; derive both capability and rank from the DB. Seed every referenced plan or remove unreferenced tiers. Remove hardcoded `PLAN_RANK`. Confirm `frontend/src/v2/lib/planCapabilities.js` matches.
**Acceptance:** Starter's team-workspace behavior is intentional and consistent FE↔BE; adding a `business` plan doesn't break upgrade offers.

### TASK 2.4 — Webhook reconciliation fallback
**Problem:** No fallback if `checkout.session.completed` never arrives (`billing.js:121`) — org stays on old plan.
**Fix:** On settings load (or `?billing=success` return), if `stripe_customer_id` exists, reconcile subscription state via `stripe.subscriptions.retrieve` and update local state.
**Acceptance:** Killing the webhook but completing checkout still activates the plan within one settings load.

### TASK 2.5 — Rate limiting + security headers
**Problem:** No `express-rate-limit`/`helmet`; `/login`, `/signup`, `/guest-token`, `/join-info` are unthrottled (ad-hoc limiters are per-process, useless behind multiple workers).
**Fix:** Add `helmet`. Add `express-rate-limit` (shared store, e.g. Redis, for multi-instance) on auth + public endpoints.
**Acceptance:** Rapid repeated `/login` attempts get 429; headers include standard `helmet` set.

### TASK 2.6 — JWT role/membership freshness
**Problem:** `backend/lib/authAdapter.js:9` issues 7-day tokens embedding `role`/`orgId`; `middleware/v2Auth.js` re-checks account-active but trusts the JWT's role → a demoted/removed user keeps admin until expiry.
**Fix:** Re-resolve role/membership from DB in `assertAccountActive` (already a DB hit) and use the DB value for `req.v2Auth.role`; or add refresh tokens + short TTL.
**Acceptance:** Demoting a user takes effect on their next request, not in 7 days.

### TASK 2.7 — Telegram support webhook fail-closed
**Problem:** `backend/lib/supportTelegramWebhook.js:25-29` allows all users when the allowlist is empty; combined with an unset `SUPPORT_TELEGRAM_WEBHOOK_SECRET`, anyone hitting the URL can drive support actions.
**Fix:** Require BOTH a non-empty `SUPPORT_TELEGRAM_ALLOWED_USER_IDS` and a set webhook secret; reject if either is missing.
**Acceptance:** Unset secret or empty allowlist → webhook rejects all requests.

---

## PHASE 3 — Trust, conversion & marketing (parallelizable with Phase 2)

### TASK 3.1 — Real OG/social image
**Problem:** `frontend/index.html:19-20` `og:image` = 400×300 stand-in `hero-kenny.jpg`; needs 1200×630; no `twitter:image`. (Repo has `public/marketing/OG-IMAGE-TODO.md`.)
**Fix:** Ship a branded 1200×630 `og-card.png` (logo + "Video meetings everyone can follow — in their own language" + meeting-preview mock). Update `og:image` + add `twitter:image`. Align `og:title`/`og:description`/`<meta description>` to one message (currently three different ones — `index.html:13,15,16,23`).
**Acceptance:** LinkedIn/Slack/iMessage link preview renders a full-size branded card.

### TASK 3.2 — Trust / social-proof strip
**Problem:** No testimonials, logos, customer count, security badge, or demo anywhere on the landing page (verified across Hero/FeatureGrid/HowItWorks/AiReports/PricingTable/FAQ).
**Fix:** Add a trust strip below the hero. Launch-minimum (all true per `PrivacyPage.jsx`): "Encrypted in transit · Transcripts off by default · You control retention", "Powered by LiveKit", and beta/founding-customer quotes when available. Do not fake logos.
**Acceptance:** Landing page communicates security posture + credibility above the fold on desktop and mobile.

### TASK 3.3 — No-signup demo / hero video
**Problem:** The aha-moment (live translation) is entirely behind `V2RequireAuth` (`App.jsx:66-113`); the only public taste is a static "Simulated room" mock.
**Fix:** Add a "Start a demo meeting — no signup" CTA (guest room with a sample/bot speaker) OR a 30-sec screen-capture of real translation in the hero.
**Acceptance:** A visitor sees live (or recorded-real) translation without creating an account.

### TASK 3.4 — FAQ objection coverage
**Problem:** `frontend/src/components/marketing/FAQ.jsx:4` `FAQ_KEYS` misses top B2B objections.
**Fix:** Add FAQ entries (copy in `frontend/src/locales/en.json`) for: supported languages, max participants per meeting, what happens at the plan limit (overage vs hard stop), whether meetings are recorded (`PrivacyPage.jsx:107` = no), and **whether transcripts/AI are used to train models** (state this explicitly).
**Acceptance:** Each listed objection has a clear answer; nothing contradicts the Privacy/Terms pages.

### TASK 3.5 — Surface enterprise tier + sales motion
**Problem:** `business/enterprise/team` tiers exist in code (`v2PlanFeatures.js:6`) but not on the pricing page; the only sales touchpoint is a raw `mailto` (`MarketingFooter.jsx:62`).
**Fix:** Add an "Enterprise / Need more?" pricing column with a "Talk to us" / "Book a demo" CTA (contact form or scheduling link). Define "participant-minutes" with a one-line footnote on the pricing table.
**Acceptance:** A >10k-minute buyer has a clear path to contact sales from the pricing section.

### TASK 3.6 — Mobile marketing nav
**Problem:** `frontend/src/components/marketing/MarketingNav.jsx:36-47` hides Features/Pricing/FAQ behind `hidden sm/md:inline` with no hamburger.
**Fix:** Add a hamburger opening the existing `frontend/src/components/ui/sheet.jsx`.
**Acceptance:** All marketing nav items reachable on a 375px-wide viewport.

### TASK 3.7 — SEO structured data
**Fix:** Add `SoftwareApplication` + `Organization` + `FAQPage` JSON-LD to `frontend/index.html` (or injected on the marketing route).
**Acceptance:** Google Rich Results test validates the FAQPage + SoftwareApplication schema.

### TASK 3.8 — Pricing annual toggle
**Fix:** Add a monthly/annual toggle to `PricingTable.jsx` with ~20% annual discount; reflect period in `en.json` copy.
**Acceptance:** Toggling updates displayed prices and the plan intent passed to checkout.

---

## PHASE 4 — Polish & hygiene

### Frontend polish
- **3.P1** Wire `onPreviewMediaError → setMediaError(err)` in `frontend/src/components/PreJoinScreen.jsx:87-89` so the existing permission-error banner (`:325-337`) actually renders.
- **3.P2** Add `toast.error(...)` to the silent catches in `frontend/src/components/CustomControlBar.jsx:137-139,156-158` (mute/camera toggle failures).
- **3.P3** Route the English-literal `aria-label`/`title` attributes in `CustomControlBar.jsx:317-319,374-376,457-459,524,562,581` through `t()`.
- **3.P4** Replace `window.location.href` with `navigate()` in `frontend/src/v2/pages/V2MeetingsList.jsx:339,355`.
- **3.P5** Connecting-state timeout (~20s) + Cancel button in `frontend/src/components/MeetingRoom.jsx:367-376`.
- **3.P6** Distinguish error vs empty in the 6 older data pages (`V2AppHome.jsx:45-56`, `V2MeetingsList.jsx:253-260`, admin `GuestsTab`/`MeetingsTab`/`CostsTab`/`TrendsTab` — `AdminContext.jsx:17-61` needs an `error` flag). `TrendsTab.jsx:46-50` currently shows "Loading…" forever on error. Match the pattern in BillingTab/CommsTab/PlansTab.
- **3.P7** Add `drop_console` (terser) to `frontend/vite.config.js` and strip the caption/transcript `console.log`s at `TranscriptionPanel.jsx:332`, `TranscriptionDisplay.jsx:44`.
- **3.P8** Add disabled/loading states to mutations lacking them: `V2OrgSettings.jsx:382-393,674` (addMember), `V2MeetingDetail.jsx:304-321,343-351` (create/revoke invite), `MeetingJoinCard.jsx:17`.
- **3.P9** Per-route `document.title`; friendly 404 with "Go home" link (`App.jsx:105-112` currently leaks `location.pathname`).
- **3.P10** Reset-password success affordance (`V2ResetPassword.jsx:63-64`) + inline password-rule feedback on signup (`V2Signup.jsx:147-156`).
- **3.P11** Reword admin internal jargon: "no org — broken signup" badge (`UsersTab.jsx:114`) → "Orphaned account"; tooltip the raw `V2_SUPERADMIN_EMAILS` hint (`AdminDashboard.jsx:38-40`).

### Repo hygiene
- **4.H1** Delete dead agent backups: `translation-agent/realtime_agent_simple_backup.py`, `realtime_agent_simple.py.backup`, `livekit.toml.backup`, and `realtime_agent_simple.py` if confirmed unused (active = `transcription_only_agent.py`).
- **4.H2** Delete dead frontend components imported nowhere: `frontend/src/components/TranscriptionDisplay.jsx`, `InviteLinkModal.jsx`, `NameModal.jsx`; update the `frontend/src/lib/domTranslator.js:57,60` selectors that target TranscriptionDisplay.
- **4.H3** Fix the top-level `share-app/README.md` — it documents an obsolete VideoSDK architecture; the real product is this LiveKit app.
- **4.H4** Optimize heavy assets: compress `frontend/public/marketing/hero-screenshare.png` (1.4MB) to <150KB WebP; lazy-load the ~9MB MediaPipe `.wasm` only when background blur is enabled.
- **4.H5** Finalize legal: replace `COMPANY_LEGAL_NAME='Parley'` placeholder + governing-law entity in `frontend/src/components/legal/PrivacyPage.jsx:6-8` and `TermsPage.jsx:6-8,147-152`; share the `LAST_UPDATED` date constant. (Requires business/legal sign-off.)

### Lower-priority correctness (track, not launch-blocking)
- Webhook event ordering guard (`billingWebhook.js:48-98` — compare `created`/period before applying).
- Atomic guest-invite use_count (`joinPublic.js:147-148` → `UPDATE ... WHERE use_count < max_uses` + check `changes`).
- Server-generated guest identities (`joinPublic.js:154,169` lets a guest pick another participant's identity → impersonation).
- Constant-time `COST_EVENT_SECRET` compare (`costEvents.js:32` → `crypto.timingSafeEqual`).
- Align entitlement cap window to the org's `v2_billing_cycles` instead of calendar month (`v2Entitlements.js:56`).
- Add currency field + unify on integer minor units (cents vs USD floats split across `costConstants.js` and the ledger).
- Localize the v2 product surface (currently English-only while marketing/auth are localized).

---

## What is already solid (do NOT rework)
Parameterized SQL everywhere; bcrypt-12 + safe single-use password reset + enumeration-safe login; Stripe signature verification is correct (the only gap is the unsigned fallback, Task 0.5); usage-event idempotency is airtight; meeting-creation cap IS enforced server-side (HTTP 402); comp accounts protected from downgrades; `host.js` meeting actions correctly org-scoped; transcript reads gated by `assertMeetingAccess`; `TranslationDebugPanel` correctly gated behind `?debug=1`; meeting modals use Radix with proper focus trap; the signup→Stripe-checkout plan-intent funnel works end-to-end.

## Suggested commit grouping
1 commit per task in Phase 0–2; Phase 3 marketing items can batch by surface; Phase 4 hygiene in a single cleanup commit. Run the existing Python agent tests (`translation-agent/test_*.py`) and any backend/frontend tests after Phase 0/2 changes.
