const { WebhookReceiver } = require('livekit-server-sdk');
const { run, get, all, uuid } = require('../db/v2Database');
const { reconcileTranslationMinutesForMeeting } = require('../lib/v2TranslationUsage');
const { checkAndEnforceUsageCap } = require('../lib/v2UsageCapEnforcement');
const { evaluateAndSendUsageAlerts } = require('../lib/v2UsageAlerts');

function isLiveKitWebhookVerifyRequired() {
  if (process.env.NODE_ENV === 'production') return true;
  return process.env.LIVEKIT_WEBHOOK_VERIFY !== 'false';
}

let receiver = null;
function getReceiver() {
  if (!receiver) {
    receiver = new WebhookReceiver(
      process.env.LIVEKIT_API_KEY || '',
      process.env.LIVEKIT_API_SECRET || ''
    );
  }
  return receiver;
}

async function ensureTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS meeting_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT NOT NULL,
      org_id TEXT,
      event_type TEXT NOT NULL,
      participant_identity TEXT,
      track_sid TEXT,
      payload_json TEXT,
      ts INTEGER NOT NULL
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_meeting_events_meeting ON meeting_events(meeting_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_meeting_events_org ON meeting_events(org_id)`);
  await run(`
    CREATE TABLE IF NOT EXISTS meeting_cost_rollups (
      meeting_id TEXT PRIMARY KEY,
      org_id TEXT,
      total_cost_usd REAL NOT NULL,
      breakdown_json TEXT NOT NULL,
      duration_seconds INTEGER,
      computed_at INTEGER NOT NULL
    )
  `);
}

let tablesReady = false;
async function readyTables() {
  if (!tablesReady) {
    await ensureTables();
    tablesReady = true;
  }
}

function isAgentIdentity(identity) {
  if (!identity) return true;
  const s = String(identity).toLowerCase();
  return (
    s.startsWith('agent-') ||
    s.includes('translation') ||
    s.includes('-agent') ||
    s.includes('agent_')
  );
}

async function resolveMeetingContext(roomName) {
  const row = await get(
    `SELECT id, org_id FROM v2_meetings WHERE livekit_room_name = ? ORDER BY datetime(created_at) DESC LIMIT 1`,
    [roomName]
  );
  if (!row) return { orgId: null, meetingUuid: null };
  return { orgId: row.org_id, meetingUuid: row.id };
}

async function recordParticipantSessionUsage(roomName, participantIdentity, leaveTs, orgId, meetingUuid) {
  if (!orgId || !participantIdentity || isAgentIdentity(participantIdentity)) return;

  const joinEv = await get(
    `SELECT ts FROM meeting_events
     WHERE meeting_id = ? AND event_type = 'participant_joined'
       AND participant_identity = ?
       AND ts <= ?
     ORDER BY ts DESC LIMIT 1`,
    [roomName, participantIdentity, leaveTs]
  );
  if (!joinEv) return;

  const idempotencyKey = `${roomName}:${participantIdentity}:${joinEv.ts}`;
  const existing = await get(
    `SELECT id FROM v2_usage_events WHERE org_id = ? AND idempotency_key = ?`,
    [orgId, idempotencyKey]
  );
  if (existing) return;

  const minutes = Math.max(0.01, (leaveTs - joinEv.ts) / 1000 / 60);
  await run(
    `INSERT INTO v2_usage_events (id, org_id, meeting_id, event_type, quantity, unit, idempotency_key)
     VALUES (?,?,?,?,?,?,?)`,
    [uuid(), orgId, meetingUuid, 'meeting_participant_minute', minutes, 'minute', idempotencyKey]
  );
}

async function flushOpenParticipants(roomName, endTs, orgId, meetingUuid) {
  if (!orgId) return;
  const joinRows = await all(
    `SELECT participant_identity, ts FROM meeting_events WHERE meeting_id = ? AND event_type = 'participant_joined'`,
    [roomName]
  );
  for (const join of joinRows) {
    if (isAgentIdentity(join.participant_identity)) continue;
    const idempotencyKey = `${roomName}:${join.participant_identity}:${join.ts}`;
    const billed = await get(
      `SELECT id FROM v2_usage_events WHERE org_id = ? AND idempotency_key = ?`,
      [orgId, idempotencyKey]
    );
    if (billed) continue;

    const leftAfter = await get(
      `SELECT ts FROM meeting_events
       WHERE meeting_id = ? AND event_type = 'participant_left'
         AND participant_identity = ? AND ts >= ?
       ORDER BY ts ASC LIMIT 1`,
      [roomName, join.participant_identity, join.ts]
    );
    const leaveTs = leftAfter ? leftAfter.ts : endTs;
    await recordParticipantSessionUsage(roomName, join.participant_identity, leaveTs, orgId, meetingUuid);
  }
}

function computeRoomDurationSeconds(startRows, finishRows) {
  if (!startRows.length || !finishRows.length) return null;
  let total = 0;
  const pairs = Math.min(startRows.length, finishRows.length);
  for (let i = 0; i < pairs; i += 1) {
    total += Math.max(0, Math.round((finishRows[i].ts - startRows[i].ts) / 1000));
  }
  return total;
}

/** Pair each join with the next leave for the same identity (matches billing usage logic). */
function computeParticipantMinutes(joinRows, leaveRows, fallbackEndTs, skipIdentity) {
  const leavesByIdentity = {};
  for (const row of leaveRows) {
    const id = row.participant_identity;
    if (!id) continue;
    if (!leavesByIdentity[id]) leavesByIdentity[id] = [];
    leavesByIdentity[id].push(row.ts);
  }
  for (const id of Object.keys(leavesByIdentity)) {
    leavesByIdentity[id].sort((a, b) => a - b);
  }

  const leaveCursor = {};
  let participantMinutes = 0;
  const byParticipant = {};

  for (const join of joinRows.sort((a, b) => a.ts - b.ts)) {
    const pid = join.participant_identity;
    if (!pid || skipIdentity(pid)) continue;

    const leaves = leavesByIdentity[pid] || [];
    let idx = leaveCursor[pid] || 0;
    while (idx < leaves.length && leaves[idx] < join.ts) idx += 1;

    const leftTs = idx < leaves.length ? leaves[idx] : fallbackEndTs;
    if (idx < leaves.length) leaveCursor[pid] = idx + 1;

    const mins = Math.max(0, (leftTs - join.ts) / 1000 / 60);
    participantMinutes += mins;
    if (!byParticipant[pid]) {
      byParticipant[pid] = { minutes: 0, cost: 0 };
    }
    byParticipant[pid].minutes += mins;
    byParticipant[pid].cost += mins * 0.004;
  }

  return { participantMinutes, byParticipant };
}

async function aggregateRollup(meetingId) {
  const ctx = await resolveMeetingContext(meetingId);
  const orgId = ctx.orgId;

  if (orgId) {
    await run(
      `UPDATE meeting_cost_events SET org_id = ? WHERE meeting_id = ? AND org_id IS NULL`,
      [orgId, meetingId]
    );
    await run(
      `UPDATE meeting_events SET org_id = ? WHERE meeting_id = ? AND org_id IS NULL`,
      [orgId, meetingId]
    );
  }

  const costRows = await all(
    `SELECT provider, SUM(total_cost_usd) as subtotal FROM meeting_cost_events WHERE meeting_id = ? GROUP BY provider`,
    [meetingId]
  );

  const breakdown = {};
  let totalCost = 0;
  for (const row of costRows) {
    breakdown[row.provider] = row.subtotal;
    totalCost += row.subtotal;
  }

  const allCostEvents = await all(
    `SELECT event_type, units, total_cost_usd, meta_json FROM meeting_cost_events WHERE meeting_id = ? AND meta_json IS NOT NULL`,
    [meetingId]
  );
  const participantStats = {};
  function ensureParticipant(pid) {
    if (!participantStats[pid]) {
      participantStats[pid] = { total_cost_usd: 0, stt_seconds: 0, llm_tokens: 0, livekit_minutes: 0 };
    }
  }
  for (const row of allCostEvents) {
    let meta = null;
    try {
      meta = JSON.parse(row.meta_json);
    } catch {
      /* skip malformed */
    }
    const pid = meta && meta.participant;
    if (!pid) continue;
    ensureParticipant(pid);
    participantStats[pid].total_cost_usd += row.total_cost_usd || 0;
    if (row.event_type && row.event_type.includes('stt')) {
      participantStats[pid].stt_seconds += (row.units || 0) * 60;
    }
    if (row.event_type && (row.event_type.includes('input') || row.event_type.includes('output'))) {
      participantStats[pid].llm_tokens += (row.units || 0) * 1_000_000;
    }
  }

  const startRows = await all(
    `SELECT ts FROM meeting_events WHERE meeting_id = ? AND event_type = 'room_started' ORDER BY ts ASC`,
    [meetingId]
  );
  const finishRows = await all(
    `SELECT ts FROM meeting_events WHERE meeting_id = ? AND event_type = 'room_finished' ORDER BY ts ASC`,
    [meetingId]
  );
  const endEv = finishRows.length ? finishRows[finishRows.length - 1] : null;

  let durationSeconds = computeRoomDurationSeconds(startRows, finishRows);

  if (endEv) {
    const joinRows = await all(
      `SELECT participant_identity, ts FROM meeting_events WHERE meeting_id = ? AND event_type = 'participant_joined' ORDER BY ts ASC`,
      [meetingId]
    );
    const leaveRows = await all(
      `SELECT participant_identity, ts FROM meeting_events WHERE meeting_id = ? AND event_type = 'participant_left' ORDER BY ts ASC`,
      [meetingId]
    );

    const PARTICIPANT_RATE = 0.004;
    const { participantMinutes, byParticipant } = computeParticipantMinutes(
      joinRows,
      leaveRows,
      endEv.ts,
      isAgentIdentity
    );

    for (const [pid, stats] of Object.entries(byParticipant)) {
      ensureParticipant(pid);
      participantStats[pid].livekit_minutes += stats.minutes;
      participantStats[pid].total_cost_usd += stats.cost;
    }

    const participantCost = participantMinutes * PARTICIPANT_RATE;
    if (participantCost > 0) {
      breakdown.livekit = (breakdown.livekit || 0) + participantCost;
      totalCost += participantCost;
    }
  }

  if (Object.keys(participantStats).length > 0) {
    breakdown.participants = participantStats;
  }

  await run(
    `INSERT INTO meeting_cost_rollups (meeting_id, org_id, total_cost_usd, breakdown_json, duration_seconds, computed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(meeting_id) DO UPDATE SET
       org_id = excluded.org_id,
       total_cost_usd = excluded.total_cost_usd,
       breakdown_json = excluded.breakdown_json,
       duration_seconds = excluded.duration_seconds,
       computed_at = excluded.computed_at`,
    [meetingId, orgId, totalCost, JSON.stringify(breakdown), durationSeconds, Date.now()]
  );
}

async function handleLiveKitWebhook(req, res) {
  try {
    await readyTables();

    const body = req.body instanceof Buffer ? req.body : Buffer.from(req.body);
    const authHeader = req.get('Authorization') || '';

    let event;
    if (isLiveKitWebhookVerifyRequired()) {
      try {
        event = await getReceiver().receive(body, authHeader);
      } catch (err) {
        console.warn('[webhook/livekit] Signature verify failed:', err.message);
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    } else {
      try {
        event = JSON.parse(body.toString());
      } catch {
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }

    const eventType = event.event || 'unknown';
    const roomName = event.room?.name || 'unknown';
    const ts = Date.now();
    const participantIdentity = event.participant?.identity || null;

    const ctx = await resolveMeetingContext(roomName);
    const orgId = ctx.orgId;
    const meetingUuid = ctx.meetingUuid;

    await run(
      `INSERT INTO meeting_events (meeting_id, org_id, event_type, participant_identity, track_sid, payload_json, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        roomName,
        orgId,
        eventType,
        participantIdentity,
        event.track?.sid || null,
        JSON.stringify(event),
        ts,
      ]
    );

    if (eventType === 'participant_joined' && participantIdentity && orgId && !isAgentIdentity(participantIdentity)) {
      checkAndEnforceUsageCap(roomName, orgId, meetingUuid).catch((err) =>
        console.error('[webhook/livekit] usage cap check:', err.message)
      );
    }

    if (eventType === 'participant_left' && participantIdentity && orgId) {
      await recordParticipantSessionUsage(roomName, participantIdentity, ts, orgId, meetingUuid);
      if (!isAgentIdentity(participantIdentity)) {
        checkAndEnforceUsageCap(roomName, orgId, meetingUuid).catch((err) =>
          console.error('[webhook/livekit] usage cap check:', err.message)
        );
        evaluateAndSendUsageAlerts(orgId).catch((err) =>
          console.error('[webhook/livekit] usage alerts:', err.message)
        );
      }
    }

    if (eventType === 'room_finished') {
      if (orgId) {
        await flushOpenParticipants(roomName, ts, orgId, meetingUuid);
        try {
          await reconcileTranslationMinutesForMeeting(roomName, orgId, meetingUuid);
        } catch (err) {
          console.error('[webhook/livekit] translation usage reconcile:', err.message);
        }
        evaluateAndSendUsageAlerts(orgId).catch((err) =>
          console.error('[webhook/livekit] usage alerts:', err.message)
        );
      }
      aggregateRollup(roomName).catch((err) =>
        console.error('[webhook/livekit] rollup error:', err.message)
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[webhook/livekit] error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
}

module.exports = { handleLiveKitWebhook, aggregateRollup, computeParticipantMinutes, isLiveKitWebhookVerifyRequired };
