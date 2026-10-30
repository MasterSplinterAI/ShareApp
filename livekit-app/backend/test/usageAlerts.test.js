const assert = require('assert');
const { meterState, alertKeysForState } = require('../lib/v2UsageAlerts');

function testMeterLevels() {
  const low = meterState(10, 100, 200);
  assert.strictEqual(low.level, 'ok');
  assert.strictEqual(low.pctIncluded, 10);

  const mid = meterState(55, 100, 200);
  assert.strictEqual(mid.level, 'medium');

  const high = meterState(85, 100, 200);
  assert.strictEqual(high.level, 'running_low');
  assert.ok(high.pctIncluded >= 80);

  const soft = meterState(120, 100, 200);
  assert.strictEqual(soft.level, 'soft_overage');

  const near = meterState(185, 100, 200);
  assert.strictEqual(near.level, 'near_hard_cap');
  assert.ok(near.pctHard >= 90);

  const stopped = meterState(200, 100, 200);
  assert.strictEqual(stopped.level, 'hard_stopped');
}

function testAlertKeys() {
  const state = {
    unlimited: false,
    meeting: meterState(90, 100, 200),
    translation: meterState(10, 100, 200),
  };
  const keys = alertKeysForState(state);
  assert.ok(keys.includes('meeting:running_low'));
  assert.ok(!keys.includes('translation:running_low'));

  const nearState = {
    unlimited: false,
    meeting: meterState(190, 100, 200),
    translation: meterState(50, 100, 200),
  };
  const nearKeys = alertKeysForState(nearState);
  assert.ok(nearKeys.includes('meeting:near_hard_cap'));
}

testMeterLevels();
testAlertKeys();
console.log('usageAlerts.test.js OK');
