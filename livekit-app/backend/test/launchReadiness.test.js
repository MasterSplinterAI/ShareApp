const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { assertMeetingHostOrAdmin } = require('../lib/v2MeetingAuthz');
const { isLiveKitWebhookVerifyRequired } = require('../routes/webhooks');

describe('assertMeetingHostOrAdmin', () => {
  const meeting = { org_id: 'org-a', host_user_id: 'user-host' };

  it('rejects cross-org access', () => {
    const result = assertMeetingHostOrAdmin(meeting, {
      orgId: 'org-b',
      userId: 'user-host',
      role: 'owner',
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  });

  it('allows meeting host in same org', () => {
    const result = assertMeetingHostOrAdmin(meeting, {
      orgId: 'org-a',
      userId: 'user-host',
      role: 'member',
    });
    assert.equal(result.ok, true);
  });

  it('allows org admin who is not the host', () => {
    const result = assertMeetingHostOrAdmin(meeting, {
      orgId: 'org-a',
      userId: 'other-user',
      role: 'admin',
    });
    assert.equal(result.ok, true);
  });

  it('rejects non-host member', () => {
    const result = assertMeetingHostOrAdmin(meeting, {
      orgId: 'org-a',
      userId: 'other-user',
      role: 'member',
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  });
});

describe('isLiveKitWebhookVerifyRequired', () => {
  let savedNodeEnv;
  let savedVerify;

  afterEach(() => {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
    if (savedVerify === undefined) delete process.env.LIVEKIT_WEBHOOK_VERIFY;
    else process.env.LIVEKIT_WEBHOOK_VERIFY = savedVerify;
  });

  it('requires verification in production', () => {
    savedNodeEnv = process.env.NODE_ENV;
    savedVerify = process.env.LIVEKIT_WEBHOOK_VERIFY;
    process.env.NODE_ENV = 'production';
    process.env.LIVEKIT_WEBHOOK_VERIFY = 'false';
    assert.equal(isLiveKitWebhookVerifyRequired(), true);
  });

  it('allows opt-out only outside production', () => {
    savedNodeEnv = process.env.NODE_ENV;
    savedVerify = process.env.LIVEKIT_WEBHOOK_VERIFY;
    process.env.NODE_ENV = 'development';
    process.env.LIVEKIT_WEBHOOK_VERIFY = 'false';
    assert.equal(isLiveKitWebhookVerifyRequired(), false);
  });

  it('defaults to verify outside production when flag unset', () => {
    savedNodeEnv = process.env.NODE_ENV;
    savedVerify = process.env.LIVEKIT_WEBHOOK_VERIFY;
    process.env.NODE_ENV = 'development';
    delete process.env.LIVEKIT_WEBHOOK_VERIFY;
    assert.equal(isLiveKitWebhookVerifyRequired(), true);
  });
});
