#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { backendRequire, pgEnvironment, run, sha256, inspectUploads, inventory } = require('./common.cjs');

async function createBackup({ backendDir, pgBin = '/usr/lib/postgresql/16/bin', connection, pgEnv, uploadsDir, upload, tempRoot = '/tmp' }) {
  const { Client } = backendRequire(backendDir)('pg');
  const root = await fs.mkdtemp(path.join(tempRoot, 'lalia-backup-')); await fs.chmod(root, 0o700);
  const client = new Client({ ...connection, connectionTimeoutMillis: 15000, statement_timeout: 300000 });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    // Keep this transaction open until pg_dump and inventory use the same snapshot.
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    const version = Number((await client.query("SELECT current_setting('server_version_num') AS version")).rows[0].version);
    if (version < 160000 || version >= 170000) throw new Error('Expected PostgreSQL16');
    const database = await inventory(client);
    const dump = path.join(root, 'database.dump');
    await run(path.join(pgBin, 'pg_dump'), ['--format=custom', '--no-owner', '--no-privileges', '--snapshot', snapshot, '--file', dump], { env: pgEnv });
    await client.query('COMMIT');
    const files = await inspectUploads(uploadsDir);
    const archive = path.join(root, 'uploads.tar.gz');
    await run('tar', ['-czf', archive, '-C', uploadsDir, '.'], { env: { PATH: process.env.PATH, LANG: 'C', COPYFILE_DISABLE: '1' } });
    // Detect changes during archival rather than silently claiming a coherent upload copy.
    if (JSON.stringify(files) !== JSON.stringify(await inspectUploads(uploadsDir))) throw new Error('Uploads changed during backup; retry');
    const artifacts = [];
    for (const name of ['database.dump', 'uploads.tar.gz']) {
      const file = path.join(root, name); await fs.chmod(file, 0o600);
      const stat = await fs.stat(file);
      if (stat.size > 5 * 1024 ** 3) throw new Error('Artifact exceeds single-upload limit');
      artifacts.push({ name, bytes: stat.size, sha256: await sha256(file) });
    }
    const manifest = { format: 1, createdAt: new Date().toISOString(), postgresMajor: 16, database, files, artifacts };
    await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
    // A manifest is the commit marker: incomplete runs never upload it.
    for (const name of ['database.dump', 'uploads.tar.gz', 'manifest.json']) await upload(name, path.join(root, name));
    return { tables: database.tables.length, files: files.length, bytes: artifacts.reduce((n, a) => n + a.bytes, 0) };
  } finally { await client.end().catch(() => {}); await fs.rm(root, { recursive: true, force: true }); }
}

async function main() {
  process.umask(0o077);
  const backendDir = process.env.LALIA_BACKEND_DIR;
  const bucket = process.env.LALIA_BACKUP_BUCKET;
  if (!backendDir || !/^lalia-backups-\d{12}-us-east-2$/.test(bucket || '')) throw new Error('Missing or invalid backup configuration');
  const requireBackend = backendRequire(backendDir);
  const env = requireBackend('dotenv').parse(await fs.readFile(path.join(backendDir, '.env')));
  const pgEnv = pgEnvironment(env.DATABASE_URL);
  const { Client } = requireBackend('pg');
  const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 15000, statement_timeout: 300000 });
  let uploadsDir;
  try {
    await client.connect();
    const row = (await client.query("SELECT storage_driver, storage_local_dir FROM v2_platform_storage_settings WHERE id='default'")).rows[0];
    if ((row?.storage_driver || env.STORAGE_DRIVER || 'local').trim().toLowerCase() !== 'local') throw new Error('Backup requires local storage; update backup policy before switching storage driver');
    uploadsDir = path.resolve(row?.storage_local_dir || env.STORAGE_LOCAL_DIR || path.join(backendDir, 'uploads'));
  } finally { await client.end(); }
  // Never archive the backend itself, its parent, or a directory outside its upload tree.
  const canonicalUploads = await fs.realpath(path.join(backendDir, 'uploads'));
  if (await fs.realpath(uploadsDir) !== canonicalUploads) throw new Error('Unexpected uploads path; explicit operator review required');
  const { S3Client, PutObjectCommand } = requireBackend('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: 'us-east-2' }); // default chain; unit disables static/env credential sources
  const prefix = `lalia/daily/${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}/`;
  try {
    const result = await createBackup({ backendDir, connection: { connectionString: env.DATABASE_URL }, pgEnv, uploadsDir, upload: async (name, file) => {
      const digest = await sha256(file);
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: prefix + name, Body: createReadStream(file), ContentLength: (await fs.stat(file)).size, ServerSideEncryption: 'AES256', ChecksumSHA256: Buffer.from(digest, 'hex').toString('base64') }));
    } });
    const stamp = '/var/lib/lalia-backup/last-success.json';
    await fs.writeFile(stamp + '.tmp', JSON.stringify({ completedAt: new Date().toISOString(), prefix }), { mode: 0o600 });
    await fs.rename(stamp + '.tmp', stamp);
    console.log(JSON.stringify({ status: 'backup_complete', prefix, ...result }));
  } finally { s3.destroy(); }
}
if (require.main === module) main().catch(() => { console.error('Backup failed; no complete recovery point was confirmed. Inspect configuration and rerun.'); process.exitCode = 1; });
module.exports = { createBackup };
