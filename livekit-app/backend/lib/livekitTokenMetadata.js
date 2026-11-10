const { isSuperadminEmail } = require('./v2Superadmin');

function ttsAdminForAuth(auth) {
  if (!auth) return false;
  const orgRole = String(auth.role || '').toLowerCase();
  return ['owner', 'admin'].includes(orgRole) || isSuperadminEmail(auth.email);
}

/**
 * LiveKit participant metadata. `ttsAdmin` lets the translation agent accept
 * in-room STT/TTS switches. Meeting hosts also qualify via role "host" even
 * when this flag was not on the token they already joined with.
 */
function participantMetadata({ displayName, role, auth }) {
  const body = {
    displayName,
    role,
  };
  if (auth) {
    body.orgRole = String(auth.role || '');
    body.userId = auth.userId;
    body.ttsAdmin = ttsAdminForAuth(auth);
    body.isSuperadmin = isSuperadminEmail(auth.email);
  }
  return JSON.stringify(body);
}

module.exports = {
  ttsAdminForAuth,
  participantMetadata,
};
