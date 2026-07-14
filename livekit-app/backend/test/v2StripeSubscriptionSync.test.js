const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveCancelFlags,
  resolvePeriodBounds,
} = require('../lib/v2StripeSubscriptionSync');

describe('resolveCancelFlags', () => {
  it('detects cancel_at_period_end', () => {
    const f = resolveCancelFlags({
      status: 'active',
      cancel_at_period_end: true,
      cancel_at: null,
    });
    assert.equal(f.cancelAtPeriodEnd, true);
  });

  it('treats scheduled cancel_at as pending cancel while active', () => {
    const f = resolveCancelFlags({
      status: 'active',
      cancel_at_period_end: false,
      cancel_at: 1786737052,
      canceled_at: 1784058741,
    });
    assert.equal(f.cancelAtPeriodEnd, true);
    assert.equal(f.cancelAt, '2026-08-14T19:50:52.000Z');
  });
});

describe('resolvePeriodBounds', () => {
  it('falls back to subscription item period when top-level missing', () => {
    const bounds = resolvePeriodBounds({
      items: {
        data: [
          {
            current_period_start: 1784058652,
            current_period_end: 1786737052,
          },
        ],
      },
    });
    assert.equal(bounds.cps, '2026-07-14T19:50:52.000Z');
    assert.equal(bounds.cpe, '2026-08-14T19:50:52.000Z');
  });
});
