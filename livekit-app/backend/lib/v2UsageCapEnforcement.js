const db = require('../db/v2Database');
const { assertCanCreateMeeting } = require('./v2Entitlements');
const { getRoomService } = require('./livekitService');
const { mergeRoomMetadata } = require('./livekitRoomMetadata');

/**
 * End an over-cap LiveKit room and mark the V2 meeting ended with a visible limit flag in metadata.
 */
async function enforceUsageCapForRoom(roomName, orgId, meetingUuid, gate) {
  if (!roomName || !orgId) return false;

  try {
    await mergeRoomMetadata(roomName, {
      usage_limit_reached: true,
      caption_config: { mode: 'off', languages: [] },
      usage_limit_message:
        gate?.message ||
        'This workspace has reached its monthly usage limit. Upgrade your plan to continue.',
    });
  } catch (err) {
    console.warn('[usage-cap] metadata update failed:', err.message);
  }

  try {
    await getRoomService().deleteRoom(roomName);
  } catch (err) {
    console.warn('[usage-cap] deleteRoom failed:', err.message);
  }

  if (meetingUuid) {
    const now = new Date().toISOString();
    await db.run(`UPDATE v2_meetings SET status = 'ended', ended_at = ? WHERE id = ? AND org_id = ?`, [
      now,
      meetingUuid,
      orgId,
    ]);
  }

  return true;
}

async function checkAndEnforceUsageCap(roomName, orgId, meetingUuid) {
  if (!orgId) return { enforced: false };

  const gate = await assertCanCreateMeeting(orgId);
  if (gate.ok || gate.code !== 'hard_cap_meeting') {
    return { enforced: false, gate };
  }

  await enforceUsageCapForRoom(roomName, orgId, meetingUuid, gate);
  return { enforced: true, gate };
}

module.exports = {
  checkAndEnforceUsageCap,
  enforceUsageCapForRoom,
};
