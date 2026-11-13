const db = require('../db/v2Database');

// Webhooks are signature-verified by the caller. Accept real historical delivery
// backlogs; reject malformed epochs and clocks more than one minute ahead.
function webhookTimestamp(event, receivedAt = Date.now()) {
  const seconds = Number(event?.createdAt);
  const ms = seconds * 1000;
  return Number.isFinite(ms) && ms >= Date.UTC(2000, 0, 1) && ms <= receivedAt + 60000 ? Math.round(ms) : receivedAt;
}
const pendingRooms = new Map();
function reconcileParticipantUsage(roomName, orgId, meetingUuid, isAgentIdentity) {
  if (!roomName || !orgId || !meetingUuid) return Promise.resolve();
  // A late leave can correct room-end fallback downward. Serialize snapshots so
  // an older in-process reconciliation cannot overwrite the newer exact leave.
  const task = (pendingRooms.get(roomName) || Promise.resolve()).catch(() => {}).then(() => reconcileNow(roomName, orgId, meetingUuid, isAgentIdentity));
  pendingRooms.set(roomName, task);
  return task.finally(() => { if (pendingRooms.get(roomName) === task) pendingRooms.delete(roomName); });
}
async function reconcileNow(roomName, orgId, meetingUuid, isAgentIdentity) {
  const rows = await db.all('SELECT event_type, participant_identity, payload_json, ts FROM meeting_events WHERE meeting_id=? ORDER BY ts ASC, id ASC', [roomName]);
  const events = rows.map(row => {
    let payload = {}; try { payload = JSON.parse(row.payload_json || '{}'); } catch {}
    return { type: row.event_type, identity: row.participant_identity, sid: typeof payload?.participant?.sid === 'string' ? payload.participant.sid : null, eventId: payload?.id, ts: webhookTimestamp(payload, Number(row.ts)), storedTs: row.ts };
  }).sort((a, b) => a.ts - b.ts);
  const sessions = new Map();
  for (const event of events) {
    if (event.type !== 'participant_joined' || !event.identity || isAgentIdentity(event.identity)) continue;
    const key = event.sid ? `sid:${event.sid}` : `legacy:${event.identity}:${event.eventId || event.ts}`;
    if (!sessions.has(key)) sessions.set(key, { ...event, joins: [], leave: null });
    sessions.get(key).joins.push(event.storedTs);
  }
  const seenLeaves = new Set();
  for (const event of events) {
    if (event.type !== 'participant_left' || !event.identity) continue;
    const key = event.eventId || `${event.identity}:${event.sid}:${event.ts}`;
    if (seenLeaves.has(key)) continue; seenLeaves.add(key);
    const candidates = [...sessions.values()].filter(s => s.leave == null && s.ts <= event.ts && (s.sid && event.sid ? s.sid === event.sid : s.identity === event.identity));
    // SID is authoritative; nearest preceding legacy join is a compatibility
    // fallback only when one side predates SID-bearing stored payloads.
    candidates.sort((a, b) => Number(Boolean(event.sid && b.sid === event.sid)) - Number(Boolean(event.sid && a.sid === event.sid)) || b.ts - a.ts);
    if (candidates[0]) candidates[0].leave = event.ts;
  }
  const existing = await db.all("SELECT idempotency_key FROM v2_usage_events WHERE org_id=? AND meeting_id=? AND event_type='meeting_participant_minute'", [orgId, meetingUuid]);
  const keys = new Set(existing.map(r => r.idempotency_key));
  for (const session of sessions.values()) {
    const finish = events.find(e => e.type === 'room_finished' && e.ts >= session.ts);
    // Prefer the exact session disconnect even when it arrives after room end.
    const end = session.leave ?? finish?.ts;
    if (end == null) continue;
    const legacyKey = session.joins.map(ts => `${roomName}:${session.identity}:${ts}`).find(key => keys.has(key));
    const idempotencyKey = legacyKey || (session.sid ? `${roomName}:sid:${session.sid}` : `${roomName}:${session.identity}:${session.ts}`);
    const minutes = Math.max(0.01, (Math.max(session.ts, end) - session.ts) / 60000);
    await db.run(
      `INSERT INTO v2_usage_events (id,org_id,meeting_id,event_type,quantity,unit,idempotency_key,meta_json)
       VALUES (?,?,?,'meeting_participant_minute',?,'minute',?,?)
       ON CONFLICT(org_id,idempotency_key) WHERE idempotency_key IS NOT NULL
       DO UPDATE SET quantity=excluded.quantity, meta_json=excluded.meta_json`,
      [db.uuid(), orgId, meetingUuid, minutes, idempotencyKey, JSON.stringify({ source: 'livekit_session', session_sid: session.sid, joined_at: session.ts, ended_at: end, end_source: session.leave == null ? 'room_finished' : 'participant_left' })]
    );
  }
}
module.exports = { webhookTimestamp, reconcileParticipantUsage };
