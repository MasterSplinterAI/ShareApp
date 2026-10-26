const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  decideDispatchAction,
  withRoomLock,
} = require('../lib/livekitService');

const AGENT = 'translation-cloud-deepgram-codeswitch';

describe('decideDispatchAction (duplicate-agent + unnamed-dispatch guard)', () => {
  it('never dispatches when an agent participant is already in the room', () => {
    assert.deepEqual(
      decideDispatchAction({ agentPresent: true, dispatches: [], agentName: AGENT }),
      { action: 'none', staleDispatchIds: [] }
    );
  });

  it('ignores LiveKit automatic unnamed (agentName: "") dispatch and creates named dispatch', () => {
    const unnamed = {
      id: 'AD_default',
      agentName: '',
      state: { jobs: [] },
    };
    assert.deepEqual(
      decideDispatchAction({ agentPresent: false, dispatches: [unnamed], agentName: AGENT }),
      { action: 'create', staleDispatchIds: [] }
    );
  });

  it('never dispatches when a named dispatch has a pending or running job in flight', () => {
    const pending = {
      id: 'AD_live',
      agentName: AGENT,
      state: {
        jobs: [{ id: 'AJ_1', state: { status: 'JS_PENDING', endedAt: 0n } }],
      },
    };
    assert.deepEqual(
      decideDispatchAction({ agentPresent: false, dispatches: [pending], agentName: AGENT }),
      { action: 'none', staleDispatchIds: [] }
    );
  });

  it('cleans up stale completed/failed dispatches and creates a fresh one when no agent is in the room', () => {
    const finished = {
      id: 'AD_old',
      agentName: AGENT,
      state: {
        jobs: [{ id: 'AJ_old', state: { status: 'JS_SUCCESS', endedAt: 1700000000n } }],
      },
    };
    assert.deepEqual(
      decideDispatchAction({ agentPresent: false, dispatches: [finished], agentName: AGENT }),
      { action: 'create', staleDispatchIds: ['AD_old'] }
    );
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
