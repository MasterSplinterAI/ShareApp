# Parley Support Platform — Design Spec

**Status:** Approved (Option A — GitHub issue on bug approval, no auto-PR)  
**Date:** 2026-06-13  
**Scope:** Custom help widget, ticket center, AI proposal worker, Telegram ops/approval, auth/profile gaps, communication consent, legal updates.

---

## 1. Goals

Build a **100% custom** support and operations platform for Parley SaaS:

1. Users open **Help** and choose **Customer support**, **Bug report**, or **Feature request**.
2. An **AI worker** triages all tickets, reviews threads, and produces **structured proposals** before any engineering work.
3. **Telegram** is the primary ops channel: new tickets, AI proposals, and **Approve / Reject / Need info** actions.
4. On **approved bug fixes**, create a **GitHub issue only** (Option A). No autonomous PRs in v1.
5. Complete account basics: **change password** in settings, **communication consent** (email/SMS/phone), and **Privacy/ToS** updates for support + marketing data.

**Non-goals (v1):** Zendesk/Intercom, auto-PR agents, SMS delivery (Twilio), merging in-meeting participant chat with support.

---

## 2. Current state

| Area | Status |
|------|--------|
| Terms + Privacy (`/terms`, `/privacy`) | Exists; signup checkbox exists |
| Forgot password | Done (`/v2/reset-password`, email token flow) |
| Change password in profile | **Missing** |
| Communication consent | **Missing** |
| Help / tickets | **Missing** |
| Super Admin support inbox | **Missing** (user tools exist) |
| In-meeting chat | Exists (`ChatPanel.jsx`) — **separate product surface** |

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Frontend                                                         │
│  HelpPanel (V2AppShell, marketing, meeting overflow)            │
│  Settings: password + communication prefs                        │
│  Super Admin: Support tab (mirror of Telegram queue)           │
└───────────────────────────┬─────────────────────────────────────┘
                            │ REST /v2/support/*
┌───────────────────────────▼─────────────────────────────────────┐
│ Node backend (livekit-app/backend)                               │
│  Ticket API · Proposal API · Telegram webhook                    │
│  Support worker trigger (poll or job queue)                      │
│  GitHub issue creator (on approved bug proposal)                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   SQLite v2_*         docs/support/      Telegram Bot API
   tickets/proposals   RAG corpus         (notify + inline buttons)
```

### 3.1 Autonomy model

| Level | Behavior | v1 default |
|-------|----------|------------|
| L0 | Intake + store ticket | Always |
| L1 | AI classify, summarize, dedupe | Always |
| L2 | AI structured **Proposal** | Always |
| L3 | Telegram → human **Approve / Reject / Need info** | Always |
| L4 | Execute: reply user, GitHub issue, close ticket | **Only after L3 approval** |
| L5 | Auto-PR / code changes | **Never in v1** |

Routing and safety decisions live in **code**, not LLM prompts.

---

## 4. User-facing UX

### 4.1 Help entry points

| Surface | Location |
|---------|----------|
| V2 app | Header/user menu — LifeBuoy **Help** |
| Marketing site | Footer **Help & support** (guest mode) |
| Meeting room | Overflow **Report a problem** (prefills room, browser, effects) |

### 4.2 Category flows

**Customer support** — conversational thread in widget.

- AI answers from RAG when confident.
- Low confidence or sensitive topics → proposal type `escalation` → Telegram.
- v1: all outbound replies to user go through **proposal + Telegram approval** (`SUPPORT_AI_AUTO_REPLY=false`).

**Bug report** — structured form (not open chat).

- Fields: title, steps to reproduce, expected vs actual, severity (low/medium/high/critical), optional screenshot.
- AI analyzes → proposal type `bug_fix` → Telegram always.

**Feature request** — structured form.

- Fields: problem, proposed solution, priority (nice-to-have / important / critical).
- AI dedupes against open tickets → proposal type `feature` → Telegram always.

### 4.3 Auto-attached context (all categories)

Logged-in: `user_id`, `org_id`, plan, email, role.  
All: page URL, user agent, app build/version.  
Meeting overflow: `livekit_room_name`, translation enabled, video effect id.

Guests: require email; no account required.

### 4.4 My requests (logged-in, Phase 5)

List user tickets with status: `open`, `ai_reviewing`, `waiting_on_you`, `escalated`, `resolved`, `closed`.

---

## 5. Data model

Add migrations in `livekit-app/backend/db/v2Database.js`.

### 5.1 `v2_support_tickets`

```sql
CREATE TABLE v2_support_tickets (
  id TEXT PRIMARY KEY,
  public_number INTEGER NOT NULL,           -- human-readable #1042
  category TEXT NOT NULL,                   -- customer_support | bug_report | feature_request
  status TEXT NOT NULL DEFAULT 'open',
  -- open | ai_reviewing | waiting_user | pending_review | escalated | resolved | closed
  subject TEXT,
  severity TEXT,                            -- bug only: low | medium | high | critical
  priority TEXT,                            -- feature only
  user_id TEXT,
  org_id TEXT,
  guest_email TEXT,
  context_json TEXT,                        -- url, ua, room, plan snapshot
  duplicate_of_ticket_id TEXT,
  assigned_to TEXT,                         -- admin email
  github_issue_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX idx_support_tickets_status ON v2_support_tickets(status);
CREATE INDEX idx_support_tickets_user ON v2_support_tickets(user_id);
```

### 5.2 `v2_support_messages`

```sql
CREATE TABLE v2_support_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  author_type TEXT NOT NULL,                -- user | agent | staff | system
  author_id TEXT,                           -- user id or admin email
  body TEXT NOT NULL,
  attachments_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (ticket_id) REFERENCES v2_support_tickets(id)
);
```

### 5.3 `v2_support_proposals`

```sql
CREATE TABLE v2_support_proposals (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  proposal_type TEXT NOT NULL,
  -- support_reply | escalation | bug_fix | feature | close_ticket
  status TEXT NOT NULL DEFAULT 'pending_review',
  -- draft | pending_review | approved | rejected | needs_info
  summary TEXT NOT NULL,
  body_json TEXT NOT NULL,                  -- structured payload (see §6)
  confidence REAL,
  telegram_message_id TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  execution_status TEXT,                    -- null | queued | done | failed
  execution_ref TEXT,                       -- github issue url, etc.
  created_at TEXT NOT NULL,
  FOREIGN KEY (ticket_id) REFERENCES v2_support_tickets(id)
);
```

### 5.4 Communication consent

```sql
-- Extend v2_users or separate table:
CREATE TABLE v2_user_communication_prefs (
  user_id TEXT PRIMARY KEY,
  marketing_email INTEGER NOT NULL DEFAULT 0,
  marketing_sms INTEGER NOT NULL DEFAULT 0,
  marketing_phone INTEGER NOT NULL DEFAULT 0,
  phone_e164 TEXT,
  prefs_updated_at TEXT,
  policy_version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES v2_users(id)
);

CREATE TABLE v2_consent_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  consent_type TEXT NOT NULL,               -- tos | privacy | marketing_email | ...
  granted INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT,
  policy_version INTEGER,
  created_at TEXT NOT NULL
);
```

---

## 6. Proposal JSON schema

Stored in `body_json`. LLM output must validate against this shape (Pydantic/Zod on worker side).

### 6.1 `bug_fix`

```json
{
  "user_intent": "Effects missing for ~5s after room join on mobile",
  "root_cause_hypothesis": "Prejoin track/effect state not carried through join on mobile path",
  "affected_components": ["PublishPreviewTracks.jsx", "videoEffects.js"],
  "suggested_fix": "Pass initialVideoEffectId through join; verify processor attached before publish",
  "repro_steps": ["Join from prejoin with blur enabled", "Enter room on iOS Safari"],
  "test_plan": ["Playwright mobile prejoin→join effects spec"],
  "risks": ["Regression on desktop lazy-load path"],
  "github_issue_title": "Mobile: video effects delayed ~5s after join from prejoin",
  "github_issue_body": "…markdown…"
}
```

### 6.2 `feature`

```json
{
  "problem_statement": "No mic device picker on mobile",
  "proposed_mvp": "Chevron menu on mic button mirroring camera settings pattern",
  "similar_tickets": ["ticket-uuid-891"],
  "effort_estimate": "S",
  "risk": "low",
  "files_likely_touched": ["CustomControlBar.jsx"],
  "backlog_recommendation": "approve_for_sprint | backlog | duplicate"
}
```

### 6.3 `support_reply`

```json
{
  "user_intent": "How to enable transcript storage",
  "draft_reply": "…customer-facing markdown…",
  "sources": ["docs/support/product/meetings.md"],
  "escalation_reason": null
}
```

### 6.4 `escalation`

```json
{
  "reason": "Billing dispute — requires human",
  "draft_reply": null,
  "recommended_assignee": "billing",
  "urgency": "high"
}
```

---

## 7. AI support worker

### 7.1 Location

**Phase 2:** Node module `livekit-app/backend/lib/supportAgent/` (OpenAI + doc retrieval).  
Optional later: Python worker if shared infra with translation-agent is preferred.

### 7.2 Trigger

On: new ticket, new user message, debounced idle (30s).  
Set ticket `status = ai_reviewing` during run.

### 7.3 Pipeline

1. Load ticket, messages, user/org context.
2. Confirm category (code override if form submission).
3. RAG: chunk search over `docs/support/**/*.md` (start with SQLite FTS or simple file scan + keyword; vectors later).
4. Search open tickets for duplicates (subject + embedding/keyword).
5. Generate structured proposal (JSON schema above).
6. Persist `v2_support_proposals` with `status = pending_review`.
7. Notify Telegram (§8).
8. Set ticket `status = pending_review`.

### 7.4 Model & env

| Variable | Default | Purpose |
|----------|---------|---------|
| `SUPPORT_AI_ENABLED` | `true` | Master switch |
| `SUPPORT_AI_MODEL` | `gpt-4.1-mini` | Analysis + drafts |
| `SUPPORT_AI_AUTO_REPLY` | `false` | v1: all user replies need approval |
| `SUPPORT_AI_AUTO_REPLY_MIN_CONF` | `0.9` | When auto-reply enabled later |
| `SUPPORT_AI_REQUIRE_TELEGRAM_APPROVAL` | `true` | Hard gate for L4 execution |

### 7.5 Knowledge base

```
docs/support/
  index.md
  product/meetings.md
  product/translation.md
  product/video-effects.md
  product/billing.md
  troubleshooting/audio-video.md
  troubleshooting/translation-stuck.md
  troubleshooting/effects-mobile.md
  runbooks/escalation.md
  runbooks/telegram-approval.md
  known-issues.md
```

Update `known-issues.md` when bugs are resolved from approved proposals.

---

## 8. Telegram integration

### 8.1 Setup

1. `@BotFather` → create bot → `SUPPORT_TELEGRAM_BOT_TOKEN`
2. Private group/channel → add bot → `SUPPORT_TELEGRAM_CHAT_ID`
3. Webhook: `POST /api/v2/support/telegram/webhook` (HTTPS)
4. `SUPPORT_TELEGRAM_ALLOWED_USER_IDS` — comma-separated Telegram user IDs allowed to press inline buttons

### 8.2 Notification types

| Event | Telegram message |
|-------|-------------------|
| New ticket | Short alert + link to Super Admin |
| New proposal | Full summary + inline keyboard |
| User replied | Thread bump on open tickets |
| GitHub issue created | Link back to ticket |

### 8.3 Inline keyboards (by proposal type)

**`bug_fix`**

- `✅ Approve → GitHub issue` → creates issue (§9), marks proposal approved
- `📋 Issue only` → same as approve (alias)
- `❌ Reject` → proposal rejected, ticket stays open
- `💬 Need info` → sends templated question to user, `needs_info`

**`feature`**

- `✅ Approve backlog` → GitHub issue with label `feature`, type enhancement
- `❌ Reject`
- `💬 Need info`

**`support_reply`**

- `✅ Send reply` → email + in-app message to user
- `👤 Take over` → assign to human, no auto send
- `❌ Reject`

**`escalation`**

- `👤 Assign me` → escalated, notify again if stale 24h

### 8.4 Callback payload

`callback_data`: `prop:{proposal_id}:{action}`  
Webhook validates allowed user, idempotency on proposal status, writes audit log.

---

## 9. GitHub issue creation (Option A — approved)

On `bug_fix` or `feature` approval:

1. `POST` to GitHub REST API using `GITHUB_TOKEN` + `GITHUB_REPO=owner/share-app`
2. Labels: `bug` or `enhancement`, `from-support`, optional `severity-*`
3. Body template includes:
   - Ticket `#1042` link (Super Admin URL)
   - User/org context (no secrets)
   - AI proposal fields (root cause, repro, suggested fix, test plan)
   - Original user submission
4. Store `github_issue_url` on ticket + `execution_ref` on proposal
5. Telegram confirmation with issue link
6. Ticket → `resolved` or `waiting_user` depending on whether user was waiting on fix

**No PR, no Cursor agent, no code changes** in this step.

---

## 10. API routes

Prefix: `/api/v2/support` (auth optional for create; required for list own tickets).

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/tickets` | optional | Create ticket + initial message/form |
| GET | `/tickets` | user | List own tickets |
| GET | `/tickets/:id` | user/staff | Thread + proposals (staff sees internal) |
| POST | `/tickets/:id/messages` | user | User follow-up |
| POST | `/telegram/webhook` | Telegram secret | Inline button callbacks |
| GET | `/admin/tickets` | superadmin | Inbox filters |
| GET | `/admin/tickets/:id` | superadmin | Full detail |
| POST | `/admin/tickets/:id/reply` | superadmin | Staff message |
| POST | `/admin/proposals/:id/approve` | superadmin | Mirror Telegram actions |

Auth additions:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v2/auth/change-password` | Current + new password |

Communication:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v2/auth/communication-prefs` | Read prefs |
| PATCH | `/v2/auth/communication-prefs` | Update + consent event |

---

## 11. Super Admin — Support tab

New tab in `V2SuperAdmin.jsx`:

- **Inbox:** filters by status, category, severity
- **Ticket detail:** messages, context JSON, proposal history
- **Proposal queue:** pending_review items (same as Telegram)
- **Actions:** approve/reject/reply (duplicates Telegram for desktop ops)
- Reuse `AuditTab` patterns for staff actions

---

## 12. Auth & communication (Phase 0)

### 12.1 Change password

Settings → Account → card **Password**:

- Current password, new password, confirm
- `POST /v2/auth/change-password` — verify current hash, min 8 chars, rate limit

### 12.2 Communication preferences

Settings → Account → **Communication preferences**:

- Unchecked by default at signup: “Email me product updates”
- Toggles: email / SMS / phone (SMS+phone disabled until Twilio phase)
- Phone field visible only when SMS or phone enabled
- Each change writes `v2_consent_events`

### 12.3 Legal updates

**Privacy Policy** — add sections for:

- Support ticket content and attachments
- Device/meeting context collected with reports
- Marketing communication preferences and opt-out
- Automated support tools (AI-assisted triage)

**Terms** — add:

- Feedback and support submissions license
- Plan-specific support (email vs priority = queue priority, not SLA unless contracted)
- Prohibited abuse of support channels

Bump `LAST_UPDATED` and `policy_version` constant.

---

## 13. Security & compliance

- Rate-limit ticket creation per IP (reuse reset-password pattern)
- Sanitize user HTML; store plain text / markdown
- Telegram webhook: verify secret token header
- GitHub token: repo-scoped, issues write only
- Do not put passwords, tokens, or full transcripts in GitHub issues
- Staff internal notes never emailed to users
- `SUPPORT_TELEGRAM_ALLOWED_USER_IDS` required in production

---

## 14. Phased implementation

| Phase | Deliverable | Est. |
|-------|-------------|------|
| **0** | Change password API + UI; comm prefs schema + UI; Privacy/ToS updates | 2–3 days |
| **1** | DB tables; ticket API; HelpPanel widget (3 categories); Super Admin inbox; Telegram new-ticket alerts | 1 week |
| **2** | AI worker + proposals; Telegram inline approve/reject; GitHub issue on bug/feature approve | 1 week |
| **3** | `docs/support/` corpus (10–15 pages); RAG retrieval; support_reply proposals | 3–5 days |
| **4** | Super Admin proposal actions; user “My requests”; known-issues workflow | 3–5 days |
| **5** | Optional `SUPPORT_AI_AUTO_REPLY` for high-confidence how-to | later |

**Execution order:** 0 → 1 → 2 → 3 → 4. Phase 5 only after proposal quality is validated in production.

---

## 15. Testing

- **Unit:** proposal JSON validation, GitHub body renderer, Telegram callback parser
- **Integration:** create ticket → worker → proposal → mock Telegram approve → GitHub issue (mock API)
- **E2E (Playwright):** Help widget category flows; change password; comm prefs persist
- **Manual:** Telegram button round-trip on staging

---

## 16. Open items (before implementation)

1. Final legal entity name for ToS/Privacy (`COMPANY_LEGAL_NAME`)
2. GitHub repo + default labels for support-created issues
3. Production Super Admin base URL for ticket links in Telegram
4. Telegram user IDs for approvers

---

## 17. Approval record

| Decision | Choice |
|----------|--------|
| Third-party helpdesk | No — custom built |
| Primary ops channel | Telegram |
| Bug fix on approval | **Option A — GitHub issue only** |
| Auto-PR | No in v1 |
| AI auto-reply to users | Off initially; proposal + Telegram approval |

---

*Next step after spec approval: invoke `writing-plans` skill to produce phased implementation plan with file-level tasks.*
