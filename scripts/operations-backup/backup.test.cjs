const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pgEnvironment, inspectUploads, verifyArtifacts, assertInventory, run } = require('./common.cjs');
const { checkFreshness } = require('./freshness.cjs');

test('freshness monitor fails missing, stale and future stamps, accepts a recent completed backup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lalia-freshness-test-'));
  const stamp = path.join(root, 'last-success.json'); const now = Date.now();
  try {
    await assert.rejects(checkFreshness(stamp, now));
    for (const age of [27 * 3600000, -3600000]) {
      await fs.writeFile(stamp, JSON.stringify({ completedAt: new Date(now - age).toISOString() }));
      await assert.rejects(checkFreshness(stamp, now), /freshness/i);
    }
    await fs.writeFile(stamp, JSON.stringify({ completedAt: new Date(now - 3600000).toISOString() }));
    assert.equal((await checkFreshness(stamp, now)).status, 'backup_fresh');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('stuck subprocess is killed within its deadline without leaking stderr', async () => {
  const start = Date.now();
  await assert.rejects(run(process.execPath, ['-e', 'process.stderr.write("SENSITIVE_SYNTHETIC_MARKER"); process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)'], { timeoutMs: 80, killGraceMs: 40 }), error => /timed out/.test(error.message) && !error.message.includes('SENSITIVE'));
  assert.ok(Date.now() - start < 2000);
});

test('database credentials use child environment, decode safely, reject unsupported URLs', () => {
  const env = pgEnvironment('postgresql://user:p%40ss@127.0.0.1:5432/lalia_staging');
  assert.equal(env.PGPASSWORD, 'p@ss');
  assert.equal(env.PGDATABASE, 'lalia_staging');
  assert.equal(env.PGHOST, '127.0.0.1');
  assert.throws(() => pgEnvironment('https://example.com/db'));
  assert.throws(() => pgEnvironment('postgres://u:p@localhost/db?options=evil'));
});

test('upload inventory rejects secrets and symlinks instead of following them', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lalia-backup-test-'));
  try {
    await fs.writeFile(path.join(root, 'ok.wav'), 'synthetic');
    assert.equal((await inspectUploads(root)).length, 1);
    await fs.symlink('/etc/passwd', path.join(root, 'link'));
    await assert.rejects(inspectUploads(root), /symlink|regular/i);
    await fs.unlink(path.join(root, 'link'));
    await fs.writeFile(path.join(root, '.env'), 'not-a-real-secret');
    await assert.rejects(inspectUploads(root), /secret|env/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('corrupted and traversal artifacts are rejected before restore', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lalia-backup-test-'));
  try {
    await fs.writeFile(path.join(root, 'database.dump'), 'corrupt');
    await assert.rejects(verifyArtifacts(root, { artifacts: [{ name: 'database.dump', sha256: '0'.repeat(64), bytes: 7 }] }), /checksum/i);
    await assert.rejects(verifyArtifacts(root, { artifacts: [{ name: '../database.dump', sha256: '0'.repeat(64), bytes: 7 }] }), /artifact/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('restore inventory detects lost rows and missing constraints', () => {
  const original = { tables: [{ schema: 'public', name: 'items', rows: '2' }], constraints: [{ schema: 'public', table: 'items', name: 'items_pkey', type: 'p', validated: true, definition: 'PRIMARY KEY (id)' }] };
  assert.doesNotThrow(() => assertInventory(original, structuredClone(original)));
  const changed = structuredClone(original); changed.tables[0].rows = '1';
  assert.throws(() => assertInventory(original, changed), /inventory/i);
  const missing = structuredClone(original); missing.constraints = [];
  assert.throws(() => assertInventory(original, missing), /inventory/i);
});

test('trusted deployed uploads root alias resolves while nested and unrelated links remain rejected', async () => {
  const { resolveUploadsDirectory } = require('./backup.cjs');
  assert.equal(typeof resolveUploadsDirectory, 'function');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lalia-upload-root-'));
  try {
    const backend = path.join(root, 'backend'); const shared = path.join(root, 'persistent-uploads'); const other = path.join(root, 'unrelated');
    await fs.mkdir(backend); await fs.mkdir(shared); await fs.mkdir(other);
    await fs.writeFile(path.join(shared, 'synthetic.txt'), 'synthetic');
    const alias = path.join(backend, 'uploads'); await fs.symlink(shared, alias);
    const canonical = await resolveUploadsDirectory(backend, alias);
    assert.equal(canonical, await fs.realpath(shared));
    assert.equal((await inspectUploads(canonical)).length, 1);
    await assert.rejects(resolveUploadsDirectory(backend, other), /Unexpected uploads path/);
    await fs.symlink(other, path.join(shared, 'nested'));
    await assert.rejects(inspectUploads(canonical), /symlink|regular/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
