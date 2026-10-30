# V2 Phase 1 Implementation Plan

**Branch:** v2-foundation  
**Date:** 2026-05-14  
**Head:** 8aa64c9

## Goals

Three self-contained features delivered as one commit:

| Feature | Effort | Impact |
|---------|--------|--------|
| A) Cost-tracking infrastructure | Medium | Pricing, free-tier enforcement |
| B) Host caption toggle | Medium | UX, agent control |
| C) Screen-share quality monitoring | Small | Observability |

---

## A) Cost-Tracking Infrastructure

### Data Model

All tables added to `v2-platform.db` via `db/v2Database.js:migrate()`.

**`meeting_events`** — raw LiveKit webhook events per meeting  
**`meeting_cost_events`** — STT/LLM/bandwidth cost rows emitted by agent  
**`meeting_cost_rollups`** — aggregated cost per meeting (computed on room_finished)  
**`screen_share_quality_events`** — layer downgrade telemetry from clients

### Cost Constants (`lib/costConstants.js`)

```
livekit_agent_minute       $0.0100/min
livekit_participant_minute $0.0040/min
livekit_bandwidth_gb       $0.1200/GB
xai_stt_minute             $0.00333/min
xai_llm_input_mtok         $1.25/Mtok
xai_llm_output_mtok        $2.50/Mtok
openai_llm_input_mtok      $0.15/Mtok
openai_llm_output_mtok     $0.60/Mtok
deepgram_stt_minute        $0.0043/min
```

`computeCost(eventType, units)` returns `{ provider, unit_cost_usd, total_cost_usd }`

### New Routes

**`POST /api/webhooks/livekit`** (`routes/webhooks.js`)
- Raw body (registered before `express.json()`)
- Signature verified via `WebhookReceiver` from `livekit-server-sdk`
- Inserts row into `meeting_events`
- On `room_finished`: reads accumulated cost events + participant count/duration to insert `meeting_cost_rollups`
- Env: `LIVEKIT_WEBHOOK_VERIFY=true` (skip verify if false, for local dev)

**`POST /api/cost-events`** (`routes/costEvents.js`)
- Auth: `X-Cost-Secret` header == `COST_EVENT_SECRET` env
- Body: `{ meeting_id, org_id?, event_type, units, meta? }`
- Looks up rate via `costConstants.computeCost`, inserts `meeting_cost_events`

**`POST /api/quality-events`** (`routes/qualityEvents.js`)
- No auth (client fire-and-forget)
- Body: `{ meeting_id, participant_identity, from_layer, to_layer }`
- Inserts `screen_share_quality_events`

**`POST /api/v2/rooms/:name/caption-config`** (`routes/v2/captionConfig.js`)
- Host-only: validates v2 JWT
- Updates room.metadata via LiveKit `RoomServiceClient`
- Returns `{ ok: true }`

### Registration in server.js

Webhook registered before `express.json()` (raw body required for signature verification).
Cost-events and quality-events registered after `express.json()`.

---

## B) Host Caption Toggle

### Decision: Host Detection

`isHost` is passed as a prop to `CustomControlBar` from `MeetingRoomInner`. It comes from
`participantInfo.isHost` which is set from sessionStorage/location state (JWT-enforced on token
creation). Used directly as the gate.

### UI: `CustomControlBar.jsx`

New host-only section (hidden on compact):
- **Dropdown**: "Captions: Off / Transcription / Transcription + Translation"
- **Language chips** (shown only when mode != 'off'): multi-select from SUPPORTED_LANGUAGES

On change:
1. `room.localParticipant.publishData()` with `{type:'caption_config', mode, languages}` on topic `caption_config`
2. `fetch('/api/v2/rooms/:name/caption-config')` to persist in room.metadata for late joiners

### Agent: `transcription_only_agent.py`

In `handle_data`: added `caption_config` message type handler that stores mode/languages on
the agent instance. On `participant_connected`, reads `ctx.room.metadata` for initial state.
The actual mode enforcement (e.g., skipping translation lanes when mode=transcription_only)
is a Phase 2 concern — this PR wires the plumbing and data path.

### Backend: `routes/v2/captionConfig.js`

- Validates v2 JWT via existing `authAdapter`
- Uses `RoomServiceClient` from `livekit-server-sdk` to update room metadata
- Merges `caption_config` key into existing metadata JSON

---

## C) Screen-Share Quality Monitoring

### VideoGrid.jsx Changes

In the screen-share layout branch, added `<ScreenShareQualityChip>` overlay:
- Reads `publication.videoQuality` on the screen-share publication
- Polls every 2s (livekit-client track quality-change events not reliably fired in React layer)
- Maps VideoQuality enum: HIGH(2)=1080p, MEDIUM(1)=720p, LOW(0)=360p
- On HIGH to MEDIUM downgrade: fires `fetch('/api/quality-events', ...)` best-effort (no await)

### README

`livekit-app/frontend/README.md` documents the VP9 + simulcast publishDefaults from commit
8aa64c9, rationale (clarity > motion for code/docs/slides), and "DO NOT REVERT" instruction.

---

## Env Vars Added

```
LIVEKIT_WEBHOOK_VERIFY=true         # set false for local dev without ngrok
COST_EVENT_SECRET=<32-byte-hex>     # auth for agent cost reporting to /api/cost-events
BACKEND_BASE_URL=http://localhost:3000
```

Both existing .env files are git-ignored; secret written there directly.

---

## Files Changed

### New
- `livekit-app/backend/lib/costConstants.js`
- `livekit-app/backend/routes/webhooks.js`
- `livekit-app/backend/routes/costEvents.js`
- `livekit-app/backend/routes/qualityEvents.js`
- `livekit-app/backend/routes/v2/captionConfig.js`
- `livekit-app/frontend/README.md`
- `.env.example` (root of livekit-app/backend)

### Modified
- `livekit-app/backend/db/v2Database.js` — 4 new tables in migrate()
- `livekit-app/backend/server.js` — register 4 new routes
- `livekit-app/backend/routes/v2/index.js` — mount captionConfig
- `livekit-app/frontend/src/components/CustomControlBar.jsx` — caption toggle
- `livekit-app/frontend/src/components/VideoGrid.jsx` — quality chip
- `livekit-app/translation-agent/transcription_only_agent.py` — caption_config handler
- `docs/V2_PHASE1_PLAN.md` — this file

---

## Deviations & Decisions

1. **Quality chip polling** (2s interval) vs event subscription — track quality-change events
   are not reliably fired in the React component layer via @livekit/components-react; polling is safe.

2. **captionConfig route mounted under /api/v2** — keeps all v2 routes namespaced; frontend
   calls `/api/v2/rooms/:name/caption-config`.

3. **caption_config late-joiner** — agent reads `ctx.room.metadata` on join. The room.metadata
   is available synchronously at that point.

4. **WebhookReceiver raw body type** — `express.raw({ type: '*/*' })` catches any content-type
   LiveKit may send.

5. **caption mode enforcement deferred** — Phase 1 wires the signal path (UI → data channel →
   agent storage → room metadata). Actual enforcement (suppressing translation lanes based on mode)
   is Phase 2, letting us ship and test the signal path independently.
