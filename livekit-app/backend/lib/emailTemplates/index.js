const { renderPasswordReset } = require('./passwordReset');
const { renderGuestInvite, renderGuestReminder } = require('./guestInvite');
const { renderTranscriptReport } = require('./transcriptReport');
const { renderSupportReply } = require('./supportReply');
const { renderAdminMessage } = require('./adminMessage');

module.exports = {
  renderPasswordReset,
  renderGuestInvite,
  renderGuestReminder,
  renderTranscriptReport,
  renderSupportReply,
  renderAdminMessage,
};
