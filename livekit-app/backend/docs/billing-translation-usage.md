# Translation minute billing (source of truth)

## Approach: backend reconciler (Option A)

Billable **translation minutes** are derived from agent STT cost telemetry already stored in
`meeting_cost_events`. We do **not** duplicate metering via a second agent POST to `/v2/usage/events`.

### Flow

1. The translation agent reports STT usage to `POST /api/cost-events` (e.g. `deepgram_stt_minute`).
2. On LiveKit `room_finished`, `reconcileTranslationMinutesForMeeting()` in `lib/v2TranslationUsage.js`:
   - Reads STT rows for the room (`meeting_id` = LiveKit room name).
   - Inserts `v2_usage_events` rows with `event_type = 'translation_minute'`.
   - Uses idempotency key `cost:{v2_meeting_uuid}:{meeting_cost_events.id}`.

### Supported STT event types

- `deepgram_stt_minute` (production default)
- `gladia_stt_minute`
- `openai_stt_minute`
- `xai_stt_minute`

### Consumers

- Entitlement usage summaries (`getMonthToDateUsage`)
- Overage ledger (`writeOverageLedgerForCycle`)
- `GET /v2/usage` and admin analytics

### Verification

After a translated meeting ends:

```sql
SELECT event_type, SUM(quantity) FROM v2_usage_events
WHERE org_id = ? GROUP BY 1;
```

Expect non-zero `translation_minute` aligned with summed STT units in `meeting_cost_events`.
