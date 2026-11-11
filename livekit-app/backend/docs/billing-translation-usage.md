# Translation minute billing (source of truth)

## Approach: backend reconciler (Option A)

Billable **translation minutes** are derived from agent STT cost telemetry already stored in
`meeting_cost_events`. We do **not** duplicate metering via a second agent POST to `/v2/usage/events`.

### Flow

1. The translation agent reports STT usage to `POST /api/cost-events` (e.g. `deepgram_stt_minute`).
   Units are minutes of audio streamed to the provider for that speaker pipeline, including silence on an open mic. That is the duration Deepgram bills per second. Detected-speech time is not the bill.
2. On every accepted STT cost event, and again on LiveKit `room_finished`, `reconcileTranslationMinutesForMeeting()` in `lib/v2TranslationUsage.js`:
   - Reads STT rows for the room (`meeting_id` = LiveKit room name).
   - Inserts `v2_usage_events` rows with `event_type = 'translation_minute'`.
   - Uses idempotency key `cost:{v2_meeting_uuid}:{meeting_cost_events.id}`.
   - Atomically ignores an already-reconciled cost row, including concurrent calls. Late shutdown reports therefore count even after the room-finished webhook. A reopened room does not depend on an old "ended" flag.
   - On arrival, a single missing-row query selects up to 100 unreconciled rows, prioritizing the accepted row; room-finished reconciliation covers all remaining stored rows. If mirroring temporarily fails after ingestion, the endpoint acknowledges the durable cost row and logs `usage reconciliation pending`, instead of inviting a duplicate POST. The next STT event or room-finished retries that backlog. A final post-room-finish failure with no later event needs operator reconciliation; there is no automatic durable retry worker. Agent HTTP delivery itself is best effort and has no retry/outbox guarantee.

The unit above is audio sent per speaker, including silent frames, not elapsed room time or the number of target languages. Both agent variants use `MeteredSttInput` to sum the duration of PCM frames accepted by the STT stream; no-frame gaps add no duration, while silent frames still count. This records client-streamed audio and does not guarantee a byte-for-byte match to a provider invoice after transport failures or provider-side retries. The backend reconciliation changes neither prices nor this measurement definition.

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
