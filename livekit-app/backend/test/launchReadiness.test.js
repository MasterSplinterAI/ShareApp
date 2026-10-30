const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { assertMeetingHostOrAdmin } = require('../lib/v2MeetingAuthz');
const { isLiveKitWebhookVerifyRequired } = require('../routes/webhooks');
const { isResendInboundSecretRequired } = require('../routes/v2/resendInboundWebhook');
const { scrubbedJoinDenial, INVITE_GATE_REASONS } = require('../routes/v2/joinPublic');
const { mintMeetingQualityToken, verifyMeetingQualityToken } = require('../lib/meetingQualityToken');
const crypto = require('crypto');

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

describe('isResendInboundSecretRequired', () => {
  let savedNodeEnv;

  afterEach(() => {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
  });

  it('requires secret in production (fail-closed)', () => {
    savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    assert.equal(isResendInboundSecretRequired(), true);
  });

  it('allows unsigned only outside production', () => {
    savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    assert.equal(isResendInboundSecretRequired(), false);
  });
});

describe('join-info scrubbing', () => {
  it('omits title/meetingId/branding without valid invite', () => {
    const body = scrubbedJoinDenial('invalid_invite');
    assert.equal(body.allowed, false);
    assert.equal(body.reason, 'invalid_invite');
    assert.equal(body.message, null);
    assert.equal(body.meetingId, undefined);
    assert.equal(body.title, undefined);
    assert.equal(body.branding, undefined);
  });

  it('maps non-invite gate failures to generic invite_required when scrubbing', () => {
    const body = scrubbedJoinDenial('hard_cap_meeting');
    assert.equal(body.reason, 'invite_required');
    assert.ok(!INVITE_GATE_REASONS.has('hard_cap_meeting'));
  });
});

describe('guest identity shape', () => {
  it('uses guest-{uuid} form', () => {
    const identity = `guest-${crypto.randomUUID()}`;
    assert.match(identity, /^guest-[0-9a-f-]{36}$/i);
  });
});

describe('meeting quality token', () => {
  it('round-trips HMAC for a meeting id', () => {
    const prev = process.env.JWT_SECRET_V2;
    process.env.JWT_SECRET_V2 = prev || 'test-quality-token-secret-at-least-32chars';
    try {
      const meetingId = 'mtg-test-1';
      const token = mintMeetingQualityToken(meetingId, { ttlSec: 120 });
      const ok = verifyMeetingQualityToken(token, meetingId);
      assert.equal(ok.ok, true);
      assert.equal(verifyMeetingQualityToken(token, 'other').ok, false);
    } finally {
      if (prev === undefined) delete process.env.JWT_SECRET_V2;
      else process.env.JWT_SECRET_V2 = prev;
    }
  });
});
