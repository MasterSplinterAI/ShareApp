const db = require('../db/v2Database');

/** STT cost event types mirrored into billable translation_minute usage (see docs/billing-translation-usage.md). */
const STT_COST_EVENT_TYPES = [
  'deepgram_stt_minute',
  'gladia_stt_minute',
  'openai_stt_minute',
  'xai_stt_minute',
];

/**
 * Reconcile agent STT minutes from meeting_cost_events into v2_usage_events.translation_minute.
 * Idempotent per cost row via idempotency_key cost:{meetingUuid}:{costEventId}.
 */
async function reconcileTranslationMinutesForMeeting(roomName, orgId, meetingUuid) {
  if (!roomName || !orgId || !meetingUuid) {
    return { written: 0, skipped: 0 };
  }

  const placeholders = STT_COST_EVENT_TYPES.map(() => '?').join(', ');
  const rows = await db.all(
    `SELECT id, event_type, units FROM meeting_cost_events
     WHERE meeting_id = ? AND event_type IN (${placeholders})`,
    [roomName, ...STT_COST_EVENT_TYPES]
  );

  let written = 0;
  let skipped = 0;

  for (const row of rows) {
    const minutes = Number(row.units);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      skipped += 1;
      continue;
    }

    const idempotencyKey = `cost:${meetingUuid}:${row.id}`;
    const existing = await db.get(
      `SELECT id FROM v2_usage_events WHERE org_id = ? AND idempotency_key = ?`,
      [orgId, idempotencyKey]
    );
    if (existing) {
      skipped += 1;
      continue;
    }

    await db.run(
      `INSERT INTO v2_usage_events (id, org_id, meeting_id, event_type, quantity, unit, idempotency_key, meta_json)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        db.uuid(),
        orgId,
        meetingUuid,
        'translation_minute',
        minutes,
        'minute',
        idempotencyKey,
        JSON.stringify({ source: 'cost_reconcile', cost_event_id: row.id, event_type: row.event_type }),
      ]
    );
    written += 1;
  }

  return { written, skipped };
}

module.exports = {
  STT_COST_EVENT_TYPES,
  reconcileTranslationMinutesForMeeting,
};
