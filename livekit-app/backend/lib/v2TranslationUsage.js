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
async function reconcileTranslationMinutesForMeeting(roomName, orgId, meetingUuid, { costEventId } = {}) {
  if (!roomName || !orgId || !meetingUuid) {
    return { written: 0, skipped: 0 };
  }

  const placeholders = STT_COST_EVENT_TYPES.map(() => '?').join(', ');
  const boundedArrival = costEventId != null;
  const rows = await db.all(
    `SELECT c.id, c.event_type, c.units FROM meeting_cost_events c
     WHERE c.meeting_id = ? AND c.event_type IN (${placeholders}) AND c.units > 0
       AND NOT EXISTS (SELECT 1 FROM v2_usage_events u WHERE u.org_id = ?
         AND u.idempotency_key = ? || CAST(c.id AS TEXT))
     ORDER BY ${boundedArrival ? 'CASE WHEN c.id = ? THEN 0 ELSE 1 END,' : ''} c.id
     ${boundedArrival ? 'LIMIT 100' : ''}`,
    [roomName, ...STT_COST_EVENT_TYPES, orgId, `cost:${meetingUuid}:`, ...(boundedArrival ? [costEventId] : [])]
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
    const inserted = await db.run(
      `INSERT INTO v2_usage_events (id, org_id, meeting_id, event_type, quantity, unit, idempotency_key, meta_json)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(org_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
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
    if (inserted.changes) written += 1;
    else skipped += 1;
  }

  return { written, skipped, pending: boundedArrival && rows.length === 100 };
}

module.exports = {
  STT_COST_EVENT_TYPES,
  reconcileTranslationMinutesForMeeting,
};
