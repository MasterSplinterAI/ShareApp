# UI Polish Plan — Jitsi-Level Frontend on Our LiveKit Stack

Decision (Jun 2026): keep LiveKit + our translation pipeline; close the perceived-polish
gap with jitsi-meet by upgrading our own React frontend. jitsi-meet is Apache-2.0 —
borrow its UX patterns freely (prejoin flow, tile design, toolbar grouping, dark theme).

Baseline: full frontend inventory (Jun 10) — strong: captions/translation UX, chat with
auto-translate, host moderation, screen share w/ quality chip, reconnect resilience.
Weak vs Jitsi: no prejoin AV preview, light-only theme, no reactions/raise hand, no
layout control, sparse in-call meeting info.

## P0 — Pre-launch (the polish people actually notice)

| # | Feature | Notes |
|---|---------|-------|
| 1 | **Prejoin screen** | Camera preview + mic level meter, device pickers, join-muted toggles, name + language (replaces bare NameModal). This is the single biggest "polished product" signal — it's the first thing every participant sees. |
| 2 | ~~Dark theme~~ | **Dropped — product stays light theme** (owner preference). `.dark` tokens remain in CSS for a possible future toggle (P2). |
| 3 | **Meeting header info** | Timer, participant count, room name, copy-link for everyone (not just host). |
| 4 | **Connection quality indicators** | Per-tile signal bars (LiveKit `connectionQuality` events) + "your connection is unstable" toast. |
| 5 | **Layout control** | Grid ⇄ speaker view toggle + pin participant. |
| 6 | **Leave flow** | "You left the meeting" screen with Rejoin + feedback prompt (currently dumps to navigate-away). |
| 7 | **Dead code cleanup** | Remove `LanguageSelector`, `TranscriptionDisplay`, `useTranslation`, DOM-translator stack; fix stale Playwright home tests. |

## P1 — Fast follow (engagement parity)

| # | Feature | Notes |
|---|---------|-------|
| 8 | Reactions + raise hand | Data channel topic (same infra as captions); floating emoji + hand badge in tiles/participants panel. |
| 9 | Background blur | `@livekit/track-processors` (client-side, no server work). Preview it on the prejoin screen. |
| 10 | Noise suppression toggle | Client-side Krisp/BVC toggle (agent-side BVC already live). |
| 11 | Participants panel for everyone | Non-host read-only view + invite-from-call; host keeps moderation. |
| 12 | Unified settings dialog | Audio/video/effects/captions in one sheet (gear in control bar). |
| 13 | Caption overlay mode | Optional CC strip over video (Jitsi-style) in addition to the panel. |
| 14 | i18n for UI chrome | `controlLabels.js` covers en/es only; extend to caption-language locales. |

## P2 — Post-launch branches

Recording UI (egress), polls/Q&A, virtual background gallery, breakout rooms,
keyboard shortcuts panel, waiting-room admission UI, private chat/file share,
PWA/installability, end-of-call ratings dashboard.

## Non-negotiable regression guard

Captions are the product. Every polish PR must verify on staging before merge:
1. Captions render (partials + finals) for at least two participants
2. Language preference handoff still reaches the agent (prejoin/name flow feeds `RoomControls` → `language_update` data packet)
3. Chat send/receive + auto-translate
4. Host caption broadcast config (mode + languages)

## Execution notes

- One feature per PR onto `v2-foundation` (pre-launch) / `feat/*` branches (post-launch).
- Every P0 item must be verified on desktop + mobile breakpoints (640px compact rules).
- Captions/translation surfaces are launch-critical — visual changes near
  `TranscriptionPanel` need a staging caption session before merge.
- Borrow from jitsi-meet by *pattern*, not by code import, to keep our
  Tailwind/shadcn system coherent.
