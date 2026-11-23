import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isActiveMeetingPath,
  isChunkLoadError,
  loadWithChunkRetry,
} from './lazyWithRetry.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
  };
}

test('identifies active meeting routes vs normal workspace routes', () => {
  assert.equal(isActiveMeetingPath('/room/team-sync'), true);
  assert.equal(isActiveMeetingPath('/meeting/123'), true);
  assert.equal(isActiveMeetingPath('/join/invite-abc'), true);
  assert.equal(isActiveMeetingPath('/v2/app/meetings'), false);
  assert.equal(isActiveMeetingPath('/v2/app/meetings/abc-123'), false);
  assert.equal(isActiveMeetingPath('/v2/app/notetaker'), false);
});

test('retries transient chunk import failure once without reloading', async () => {
  let attempts = 0;
  let reloads = 0;
  const mod = { default: () => 'ok' };
  const out = await loadWithChunkRetry(
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('Failed to fetch dynamically imported module: /assets/Foo-123.js');
      }
      return mod;
    },
    {
      retryDelayMs: 1,
      getPathname: () => '/v2/app/meetings/m1',
      reload: () => {
        reloads += 1;
      },
      storage: memoryStorage(),
    }
  );
  assert.equal(attempts, 2);
  assert.equal(reloads, 0);
  assert.equal(out, mod);
});

test('reloads once on persistent chunk error outside meetings and suppresses immediate loop', async () => {
  let reloads = 0;
  const store = memoryStorage();
  const chunkErr = new Error('Failed to fetch dynamically imported module: /assets/Bar-456.js');
  assert.equal(isChunkLoadError(chunkErr), true);

  let settledFirst = false;
  const firstPromise = loadWithChunkRetry(
    async () => {
      throw chunkErr;
    },
    {
      retryDelayMs: 1,
      getPathname: () => '/v2/app/meetings',
      reload: () => {
        reloads += 1;
      },
      storage: store,
    }
  ).then(() => {
    settledFirst = true;
  });

  await new Promise((r) => setTimeout(r, 25));
  assert.equal(reloads, 1);
  assert.equal(settledFirst, false);
  void firstPromise;

  await assert.rejects(
    loadWithChunkRetry(
      async () => {
        throw chunkErr;
      },
      {
        retryDelayMs: 1,
        getPathname: () => '/v2/app/meetings',
        reload: () => {
          reloads += 1;
        },
        storage: store,
      }
    ),
    /Failed to fetch dynamically imported module/
  );
  assert.equal(reloads, 1);
});

test('never reloads on active meeting routes (/room, /join, /meeting)', async () => {
  const store = memoryStorage();
  for (const path of ['/room/demo-123', '/join/token-99', '/meeting/live-7']) {
    let reloads = 0;
    await assert.rejects(
      loadWithChunkRetry(
        async () => {
          throw new Error('Importing a module script failed.');
        },
        {
          retryDelayMs: 1,
          getPathname: () => path,
          reload: () => {
            reloads += 1;
          },
          storage: store,
        }
      ),
      /Importing a module script failed/
    );
    assert.equal(reloads, 0, `expected zero reloads for ${path}`);
  }
});
