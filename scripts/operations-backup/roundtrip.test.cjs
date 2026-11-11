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
