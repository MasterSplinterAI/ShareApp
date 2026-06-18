/**
 * Org-scoped meeting action authorization (host or org owner/admin).
 */
function assertMeetingHostOrAdmin(meeting, v2Auth) {
  if (!meeting) {
    return { ok: false, status: 404, error: 'Not found' };
  }
  if (meeting.org_id !== v2Auth.orgId) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  if (meeting.host_user_id !== v2Auth.userId && !['owner', 'admin'].includes(v2Auth.role)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  return { ok: true };
}

module.exports = { assertMeetingHostOrAdmin };
