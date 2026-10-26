const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  decideDispatchAction,
  withRoomLock,
} = require('../lib/livekitService');

describe('decideDispatchAction (duplicate-agent guard)', () => {
  it('never dispatches when an agent participant is already in the room', () => {
    assert.equal(decideDispatchAction({ agentPresent: true, dispatchCount: 0 }), 'none');
    assert.equal(decideDispatchAction({ agentPresent: true, dispatchCount: 2 }), 'none');
  });

  it('never dispatches when a dispatch is already in flight', () => {
    assert.equal(decideDispatchAction({ agentPresent: false, dispatchCount: 1 }), 'none');
  });

  it('dispatches only when no agent and no dispatch exist', () => {
    assert.equal(decideDispatchAction({ agentPresent: false, dispatchCount: 0 }), 'create');
  });
});

describe('withRoomLock', () => {
  it('serializes concurrent work for the same room', async () => {
    const order = [];
    const run = (label, ms) =>
      withRoomLock('room-a', async () => {
        order.push(`start:${label}`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`end:${label}`);
      });
    await Promise.all([run('first', 30), run('second', 1)]);
    assert.deepEqual(order, ['start:first', 'end:first', 'start:second', 'end:second']);
  });

  it('does not block different rooms', async () => {
    const order = [];
    await Promise.all([
      withRoomLock('room-a', async () => {
        await new Promise((r) => setTimeout(r, 30));
        order.push('a');
      }),
      withRoomLock('room-b', async () => {
        order.push('b');
      }),
    ]);
    assert.deepEqual(order, ['b', 'a']);
  });

  it('releases the lock when work throws', async () => {
    await assert.rejects(() => withRoomLock('room-a', async () => { throw new Error('boom'); }));
    const out = await withRoomLock('room-a', async () => 'ok');
    assert.equal(out, 'ok');
  });
});
