process.env.JWT_SECRET_V2 = process.env.JWT_SECRET_V2 || 'test-secret-with-more-than-32-characters';
process.env.V2_DB_PATH = process.env.V2_DB_PATH || ':memory:';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db/v2Database');
const {
  saveIosPushToken,
  getUserPushDiagnostics,
  sendIncomingCallPush,
} = require('../lib/v2PushNotifications');

describe('v2PushNotifications iOS APNs & PushKit tokens', () => {
  before(async () => {
    await db.initDatabase();
    await db.run(
      `INSERT OR REPLACE INTO v2_users (id, email, password_hash, display_name)
       VALUES (?,?,?,?)`,
      ['user-ios-push', 'ios-callee@example.com', 'unused', 'iOS Callee']
    );
  });

  it('normalizes and stores VoIP and APNs hex tokens for a user', async () => {
    const voipToken = '<A1B2C3D4 E5F60718 9900AABB CCDDEEFF 00112233 44556677 8899AABB CCDDEEFF>';
    const apnsToken = '11223344556677889900aabbccddeeff00112233445566778899aabbccddeeff';

    const r1 = await saveIosPushToken({
      userId: 'user-ios-push',
      token: voipToken,
      pushType: 'voip',
      bundleId: 'cloud.lalia.app',
      environment: 'sandbox',
      userAgent: 'Lalia-iOS/1.0',
    });
    assert.equal(r1.ok, true);
    assert.equal(r1.pushType, 'voip');

    const r2 = await saveIosPushToken({
      userId: 'user-ios-push',
      token: apnsToken,
      pushType: 'apns',
      bundleId: 'cloud.lalia.app',
      environment: 'production',
      userAgent: 'Lalia-iOS/1.0',
    });
    assert.equal(r2.ok, true);
    assert.equal(r2.pushType, 'apns');

    const diag = await getUserPushDiagnostics('user-ios-push');
    assert.equal(diag.iosTokenCount, 2);
    assert.equal(
      diag.iosTokens.some((t) => t.pushType === 'voip' && t.environment === 'sandbox'),
      true
    );
    assert.equal(
      diag.iosTokens.some((t) => t.pushType === 'apns' && t.environment === 'production'),
      true
    );
  });

  it('rejects non-hex or too-short iOS tokens', async () => {
    const bad = await saveIosPushToken({
      userId: 'user-ios-push',
      token: 'not-a-valid-hex-token',
      pushType: 'voip',
    });
    assert.equal(bad.ok, false);
  });

  it('gracefully handles sendIncomingCallPush when APNs credentials are not set', async () => {
    const res = await sendIncomingCallPush({
      calleeEmail: 'ios-callee@example.com',
      callerName: 'Kenneth',
      joinUrl: 'https://lalia.cloud/join/v2-room-123',
      callId: 'call-123',
      roomName: 'v2-room-123',
    });
    assert.equal(typeof res.sent, 'number');
    assert.equal(res.apnsConfigured, false);
  });
});
