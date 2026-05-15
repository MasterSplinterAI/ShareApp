const { WebhookReceiver } = require('livekit-server-sdk');
const { run, get, all } = require('../db/v2Database');

const VERIFY = process.env.LIVEKIT_WEBHOOK_VERIFY !== 'false';

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

async function aggregateRollup(meetingId) {
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

  // Calculate duration from room_started / room_finished events
  const startEv = await get(
    `SELECT ts FROM meeting_events WHERE meeting_id = ? AND event_type = 'room_started' ORDER BY ts ASC LIMIT 1`,
    [meetingId]
  );
  const endEv = await get(
    `SELECT ts FROM meeting_events WHERE meeting_id = ? AND event_type = 'room_finished' ORDER BY ts DESC LIMIT 1`,
    [meetingId]
  );

  let durationSeconds = null;
  if (startEv && endEv) {
    durationSeconds = Math.round((endEv.ts - startEv.ts) / 1000);

    // Add participant-minute cost from events
    const joinRows = await all(
      `SELECT participant_identity, ts FROM meeting_events WHERE meeting_id = ? AND event_type = 'participant_joined'`,
      [meetingId]
    );
    const leaveRows = await all(
      `SELECT participant_identity, ts FROM meeting_events WHERE meeting_id = ? AND event_type = 'participant_left'`,
      [meetingId]
    );

    const leaveMap = {};
    for (const r of leaveRows) {
      leaveMap[r.participant_identity] = r.ts;
    }

    let participantMinutes = 0;
    for (const r of joinRows) {
      const leftTs = leaveMap[r.participant_identity] || endEv.ts;
      participantMinutes += (leftTs - r.ts) / 1000 / 60;
    }

    const PARTICIPANT_RATE = 0.004;
    const participantCost = participantMinutes * PARTICIPANT_RATE;
    if (participantCost > 0) {
      breakdown['livekit'] = (breakdown['livekit'] || 0) + participantCost;
      totalCost += participantCost;
    }
  }

  await run(
    `INSERT INTO meeting_cost_rollups (meeting_id, org_id, total_cost_usd, breakdown_json, duration_seconds, computed_at)
     VALUES (?, NULL, ?, ?, ?, ?)
     ON CONFLICT(meeting_id) DO UPDATE SET
       total_cost_usd = excluded.total_cost_usd,
       breakdown_json = excluded.breakdown_json,
       duration_seconds = excluded.duration_seconds,
       computed_at = excluded.computed_at`,
    [meetingId, totalCost, JSON.stringify(breakdown), durationSeconds, Date.now()]
  );
}

async function handleLiveKitWebhook(req, res) {
  try {
    await readyTables();

    const body = req.body instanceof Buffer ? req.body : Buffer.from(req.body);
    const authHeader = req.get('Authorization') || '';

    let event;
    if (VERIFY) {
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
    const meetingId = event.room?.name || 'unknown';
    const ts = Date.now();

    await run(
      `INSERT INTO meeting_events (meeting_id, org_id, event_type, participant_identity, track_sid, payload_json, ts)
       VALUES (?, NULL, ?, ?, ?, ?, ?)`,
      [
        meetingId,
        eventType,
        event.participant?.identity || null,
        event.track?.sid || null,
        JSON.stringify(event),
        ts,
      ]
    );

    if (eventType === 'room_finished') {
      aggregateRollup(meetingId).catch(err =>
        console.error('[webhook/livekit] rollup error:', err.message)
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[webhook/livekit] error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
}

module.exports = { handleLiveKitWebhook };
