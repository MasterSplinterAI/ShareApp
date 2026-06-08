function roomService() {
  const { getRoomService } = require('./livekitService');
  return getRoomService();
}

async function readRoomMetadata(roomName) {
  try {
    const svc = roomService();
    const rooms = await svc.listRooms([roomName]);
    if (rooms.length > 0 && rooms[0].metadata) {
      return JSON.parse(rooms[0].metadata);
    }
  } catch {
    /* room may not exist yet */
  }
  return {};
}

async function mergeRoomMetadata(roomName, patch) {
  const existing = await readRoomMetadata(roomName);
  const merged = { ...existing, ...patch };
  const svc = roomService();
  await svc.updateRoomMetadata(roomName, JSON.stringify(merged));
  return merged;
}

async function ensureRoomOrgMetadata(roomName, orgId) {
  if (!roomName || !orgId) return;
  const existing = await readRoomMetadata(roomName);
  if (existing.org_id === orgId) return;
  await mergeRoomMetadata(roomName, { org_id: orgId });
}

module.exports = {
  readRoomMetadata,
  mergeRoomMetadata,
  ensureRoomOrgMetadata,
};
