import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
let monitor = {};
try { monitor = await import('./monitor.mjs'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const now = new Date('2026-11-12T12:00:00Z');
const prefix = 'lalia/daily/';
const objects = (run = 'a', age = 1000) => ['manifest.json', 'database.dump', 'uploads.tar.gz'].map(name => ({ Key: `${prefix}${run}/${name}`, Size: 10, LastModified: new Date(now - age) }));
const fakeRequest = (status, body, error) => (_url, _options, callback) => {
  const request = new EventEmitter();
  request.destroy = () => {};
  request.end = () => queueMicrotask(() => {
    if (error) return request.emit('error', error);
    const response = new EventEmitter(); response.statusCode = status; response.destroy = () => {};
    callback(response);
    response.emit('data', Buffer.from(body)); response.emit('end');
  });
  return request;
};
test('accepts expected health JSON and refuses malformed/wrong/status/redirect/oversized responses', async () => {
  assert.equal(typeof monitor.checkHealth, 'function');
  for (const [status, body, ok] of [[200, '{"status":"ok","service":"livekit-backend"}', true], [200, '{bad', false], [200, '{"status":"ok"}', false], [503, '{}', false], [302, '{}', false], [200, 'x'.repeat(5000), false]]) {
    assert.equal((await monitor.checkHealth({ request: fakeRequest(status, body) })).ok, ok);
  }
});
test('TLS and network errors produce sanitized failure without response or exception content', async () => {
  assert.equal(typeof monitor.checkHealth, 'function');
  const result = await monitor.checkHealth({ request: fakeRequest(0, '', new Error('SECRET tls error')) });
  assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes('SECRET'), false);
});
test('health timeout bounds headers and body and destroys request', async () => {
  assert.equal(typeof monitor.checkHealth, 'function');
  for (const sendHeaders of [false, true]) {
    let destroyed = false;
    const request = (_url, _options, callback) => {
      const req = new EventEmitter(); req.destroy = () => { destroyed = true; };
      req.end = () => { if (sendHeaders) { const res = new EventEmitter(); res.statusCode = 200; callback(res); } }; return req;
    };
    const result = await monitor.checkHealth({ request, timeoutMs: 10 });
    assert.deepEqual(result, { ok: false, status: 'timeout' }); assert.equal(destroyed, true);
  }
});
test('requires exact nonempty same-run object set and uses manifest completion time', async () => {
  assert.equal(typeof monitor.evaluateBackups, 'function');
  const check = items => monitor.evaluateBackups(items, now);
  assert.equal(check(objects()).ok, true);
  assert.equal(check(objects('a', 26 * 3600000)).ok, true);
  assert.equal(check(objects('a', 26 * 3600000 + 1)).ok, false);
  assert.equal(check(objects().slice(0, 2)).ok, false);
  assert.equal(check(objects().map((x, i) => i === 1 ? { ...x, Size: 0 } : x)).ok, false);
  assert.equal(check([...objects(), { ...objects()[0], Key: `${prefix}a/extra` }]).ok, false);
  assert.equal(check(objects().map((x, i) => i === 1 ? { ...x, Key: `${prefix}b/database.dump` } : x)).ok, false);
  assert.equal(check(objects().map((x, i) => i === 0 ? x : { ...x, LastModified: new Date(now - 30 * 3600000) })).ok, true);
  assert.equal(check([...objects('z', 30 * 3600000), ...objects('a')]).ok, true);
  assert.equal(check(objects('future', -10000)).ok, false);
});
test('paginates metadata-only listing and bounds incomplete/cyclic pagination', async () => {
  assert.equal(typeof monitor.checkBackups, 'function');
  const requests = [];
  const result = await monitor.checkBackups({ now, list: async input => {
    requests.push(input);
    return requests.length === 1 ? { Contents: objects().slice(0, 2), IsTruncated: true, NextContinuationToken: 'page2' } : { Contents: objects().slice(2), IsTruncated: false };
  } });
  assert.equal(result.ok, true); assert.equal(requests[1].ContinuationToken, 'page2');
  assert.equal(requests[0].Prefix, prefix); assert.equal(requests[0].Bucket, 'lalia-backups-690248313257-us-east-2');
  const bad = await monitor.checkBackups({ now, list: async () => ({ Contents: [], IsTruncated: true }) }); assert.equal(bad.ok, false);
  const cycle = await monitor.checkBackups({ now, list: async () => ({ Contents: [], IsTruncated: true, NextContinuationToken: 'same' }) }); assert.equal(cycle.ok, false);
});
test('backup deadline aborts hung list; permission failures are sanitized', async () => {
  assert.equal(typeof monitor.checkBackups, 'function');
  let signal;
  const result = await monitor.checkBackups({ now, timeoutMs: 10, list: async (_input, options) => { signal = options.abortSignal; return new Promise(() => {}); } });
  assert.equal(result.ok, false); assert.equal(signal.aborted, true);
  const denied = await monitor.checkBackups({ now, list: async () => { throw new Error('SECRET AccessDenied'); } });
  assert.equal(denied.ok, false); assert.equal(JSON.stringify(denied).includes('SECRET'), false);
});
test('independent failed probes still publish all three metrics with a heartbeat', async () => {
  assert.equal(typeof monitor.runMonitor, 'function');
  for (const failure of ['health', 'backup']) {
    let metrics; const logs = [];
    await monitor.runMonitor({ now, health: async () => { if (failure === 'health') throw new Error('SECRET'); return { ok: true, status: 'healthy' }; }, backup: async () => { if (failure === 'backup') throw new Error('SECRET'); return { ok: true, status: 'fresh', ageHours: 1 }; }, publish: async data => { metrics = data; }, log: line => logs.push(line) });
    assert.equal(metrics.Namespace, 'Lalia/Operations');
    assert.deepEqual(metrics.MetricData.map(x => x.Value), failure === 'health' ? [0, 1, 1] : [1, 0, 1]);
    assert.deepEqual(metrics.MetricData.map(x => x.MetricName), ['ApiHealthy', 'BackupFresh', 'MonitorHeartbeat']);
    assert.equal(JSON.stringify(logs).includes('SECRET'), false);
  }
});
test('publication failure rejects invocation so heartbeat cannot claim success', async () => {
  assert.equal(typeof monitor.runMonitor, 'function');
  await assert.rejects(monitor.runMonitor({ now, health: async () => ({ ok: true }), backup: async () => ({ ok: true }), publish: async () => { throw new Error('denied'); }, log: () => {} }), /metric_publication_failed/);
});
