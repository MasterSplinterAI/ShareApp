# Sales Readiness Plan — Marketing, Dashboard, Admin

Audited Jun 10 2026 (marketing surface + v2 dashboard/admin/data model).
Verdict: the product core is strong and the funnel works end-to-end; the gaps are
trust collateral, billing connection, and admin observability — not the app itself.

## Fixed in this pass (commit accompanying this doc)

- **Admin Users tab** — Super Admin now lists every login identity with search;
  users who skipped the company field are flagged ("no company name" badge on their
  auto-named org), broken org-less accounts flagged red. The backend API existed but
  was never wired into the UI — this was the "can't see them as admin" bug.
- **Self-healing signups** — signup failures now roll back the half-created user;
  existing org-less accounts get an org auto-provisioned at next login instead of a
  403 lockout.
- **Guest-room costs visible** — org-less meetings (bare invite links) appear in the
  admin cost summary as a "No organization (guest rooms)" bucket instead of being
  silently excluded.

## P0 — Before charging money

| # | Item | Area | Notes |
|---|------|------|-------|
| 1 | Terms of Service + Privacy Policy pages, linked from footer + signup consent checkbox | Legal | Hard blocker for any B2B sale; pages can be standard SaaS templates reviewed once |
| 2 | Rewrite 3 FAQ answers that expose internals | Marketing | "Staging validates the product path", SQLite ops note, "retired classic home" — replace with buyer-facing answers |
| 3 | Connect paid-tier CTAs | Marketing/Billing | Starter/Pro buttons → signup with plan intent → Stripe checkout post-signup. Requires `STRIPE_ENABLED=true` + `stripe_price_id` on plan rows |
| 4 | Forgot-password flow | Auth | No reset path exists; first support ticket magnet |
| 5 | og:image + canonical + robots.txt + sitemap + real favicon files | SEO | Social shares currently render with no preview image |
| 6 | Make support email a mailto link; add a contact/sales touchpoint | Marketing | Email-only is fine at this stage, but it must be reachable |

## P1 — Admin dashboard build-out (business insights)

| # | Item | Notes |
|---|------|-------|
| 1 | **Trends panel** — signups/day, meetings/day, MTD minutes trend | `v2_users.created_at`, `v2_meetings`, `v2_usage_events` all queryable today |
| 2 | **Plan/billing mix charts** — already computed by `GET /v2/orgs/admin/kpis` (`planMix`, `billingStatusMix`), just not rendered | Pure frontend work |
| 3 | **Per-meeting cost explorer** — drill from org → meeting → raw `meeting_cost_events` (provider, STT minutes, LLM tokens) | Table exists, no UI; this is where Gladia-vs-Deepgram economics become visible |
| 4 | **Global meetings view** — cross-org list w/ status, duration, participant count, cost | Joins `v2_meetings` + `meeting_events` + rollups |
| 5 | **Audit log viewer** — `GET /v2/admin/audit` exists, unused | Pure frontend work |
| 6 | **Stripe health** — failed payments, churn from `v2_webhook_events` | Needed once checkout is live |
| 7 | **Guest participants ledger** — guests never become records; log join name/room/time from `meeting_events` into an admin view | Answers "who used the product" beyond signups |

## P2 — Dashboard & growth polish

- Email invites for org members (currently: invitee must sign up first, then be added by email — no invite email/magic link)
- Multi-org context switcher (login currently picks the oldest membership)
- Org settings: real branding section (logo/colors), real danger zone (delete org)
- Meetings: calendar view, recurring meetings, reminders for scheduled meetings
- Marketing: testimonials/logos when available, demo video, real screenshots beside the simulated hero, security page
- Sidebar org-name bug: `V2AppShell` reads `org?.organization?.name` but API returns `org` — shows "Workspace" instead of the actual name (quick fix)

## Sequencing recommendation

1. This pass (shipped): admin visibility fixes.
2. P0 items 1–2–5–6 are copy/static work — one focused day, no risk to the meeting core.
3. P0 3–4 (Stripe connect + password reset) — the only real engineering in P0.
4. P1 admin build-out as a `feat/admin-insights` branch post-launch — items 2 and 5 are
   render-only and can ship immediately with it.
