const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { backendRequire } = require('./common.cjs');
const { createBackup } = require('./backup.cjs');
const { withCluster, restoreDrill } = require('./restore-drill.cjs');

test('synthetic PG16 + upload backup restores counts/constraints and cleans both clusters', async () => {
  const backendDir = process.env.BACKUP_TEST_BACKEND_DIR;
  const pgBin = process.env.BACKUP_TEST_PG_BIN;
  assert.ok(backendDir && pgBin, 'Set BACKUP_TEST_BACKEND_DIR and BACKUP_TEST_PG_BIN for this isolated integration test');
  const { Client } = backendRequire(backendDir)('pg');
  const root = await fs.mkdtemp('/tmp/lalia-roundtrip-');
  const uploads = path.join(root, 'uploads'); const artifacts = path.join(root, 'artifacts');
  await fs.mkdir(uploads); await fs.mkdir(artifacts);
  await fs.writeFile(path.join(uploads, 'synthetic.txt'), 'synthetic upload only');
  const order = []; let clusterPath;
  try {
    await withCluster(pgBin, async cluster => {
      clusterPath = cluster.root;
      const client = new Client(cluster.connection); await client.connect();
      try {
        await client.query('CREATE TABLE parent (id int PRIMARY KEY); CREATE TABLE child (id int PRIMARY KEY, parent_id int REFERENCES parent(id), value int CHECK(value > 0)); INSERT INTO parent VALUES (1),(2); INSERT INTO child VALUES (1,1,3)');
      } finally { await client.end(); }
      const base = { backendDir, pgBin, connection: cluster.connection, pgEnv: cluster.env, uploadsDir: uploads, tempRoot: root };
      await createBackup({ ...base, upload: async (name, file) => { order.push(name); await fs.copyFile(file, path.join(artifacts, name)); } });
      assert.deepEqual(order, ['database.dump', 'uploads.tar.gz', 'manifest.json']);
      const result = await restoreDrill({ backendDir, pgBin, artifactsDir: artifacts });
      assert.equal(result.tables, 2); assert.equal(result.files, 1); assert.equal(result.constraints, 4);
      assert.equal((await fs.readdir(root)).filter(n => n.startsWith('lalia-backup-')).length, 0);
      let attemptedManifest = false;
      await assert.rejects(createBackup({ ...base, upload: async name => { if (name === 'manifest.json') attemptedManifest = true; throw new Error('synthetic upload failure'); } }));
      assert.equal(attemptedManifest, false);
      assert.equal((await fs.readdir(root)).filter(n => n.startsWith('lalia-backup-')).length, 0);
    });
    await assert.rejects(fs.stat(clusterPath), { code: 'ENOENT' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('recovery reference survives manifest round trip and recovered key authenticates restored settings', async () => {
  const crypto = require('node:crypto');
  const { verifyRestore } = require('../operations-recovery/verify-restore.cjs');
  const backendDir = process.env.BACKUP_TEST_BACKEND_DIR;
  const pgBin = process.env.BACKUP_TEST_PG_BIN;
  assert.ok(backendDir && pgBin);
  const { Client } = backendRequire(backendDir)('pg');
  const root = await fs.mkdtemp('/tmp/lalia-recovery-roundtrip-');
  const uploads = path.join(root, 'uploads'); const artifacts = path.join(root, 'artifacts');
  await fs.mkdir(uploads); await fs.mkdir(artifacts);
  const key = 'synthetic-recovery-key';
  const recoveryMetadata = { format: 1, backend: { secretArn: 'arn:aws:secretsmanager:us-east-2:690248313257:secret:lalia/prod/recovery/backend-Ab123X', versionId: '12345678-1234-1234-1234-123456789012', keyGeneration: 'key-generation-' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 24) } };
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(key).digest(), iv);
  const bytes = Buffer.concat([cipher.update('PRIVATE-TEST-SENTINEL'), cipher.final()]);
  const encrypted = `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${bytes.toString('base64')}`;
  let clusterPath;
  try {
    await withCluster(pgBin, async cluster => {
      clusterPath = cluster.root;
      const client = new Client(cluster.connection); await client.connect();
      try {
        await client.query('CREATE TABLE v2_platform_email_settings (id int PRIMARY KEY, resend_api_key text)');
        await client.query('INSERT INTO v2_platform_email_settings VALUES (1,$1)', [encrypted]);
      } finally { await client.end(); }
      await createBackup({ backendDir, pgBin, connection: cluster.connection, pgEnv: cluster.env, uploadsDir: uploads, recoveryMetadata, tempRoot: root, upload: async (name, file) => fs.copyFile(file, path.join(artifacts, name)) });
      const manifest = JSON.parse(await fs.readFile(path.join(artifacts, 'manifest.json'), 'utf8'));
      assert.deepEqual(manifest.recovery, recoveryMetadata);
      const result = await verifyRestore({ artifactsDir: artifacts, backendDir, pgBin, settingsKey: key });
      assert.equal(result.tables, 1); assert.equal(result.constraints, 1); assert.equal(result.encryptedValues, 1); assert.equal(result.allAuthenticated, true); assert.equal(result.applicationStarted, false); assert.equal(result.providerCalls, false);
      assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
      await assert.rejects(verifyRestore({ artifactsDir: artifacts, backendDir, pgBin, settingsKey: 'wrong-key' }), /verification failed/);
    });
    await assert.rejects(fs.stat(clusterPath), { code: 'ENOENT' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
