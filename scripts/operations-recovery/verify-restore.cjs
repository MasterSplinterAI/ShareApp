#!/usr/bin/env node
'use strict';
// This imports backup helpers and pg only. Never import application settings,
// routes, support/consent modules, or any module that starts background jobs.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const tools = process.env.LALIA_BACKUP_TOOLS || path.resolve(__dirname, '../operations-backup');
const { withCluster } = require(path.join(tools, 'restore-drill.cjs'));
const { backendRequire, run, verifyArtifacts, inspectUploads, inventory, assertInventory } = require(path.join(tools, 'common.cjs'));

function verifyEncryptedValue(value, settingsKey) {
  let key; let plaintext;
  try {
    if (typeof settingsKey !== 'string' || !settingsKey.trim() || typeof value !== 'string' || !value.startsWith('enc:v1:')) throw new Error();
    const parts = value.slice(7).split(':');
    if (parts.length !== 3) throw new Error();
    const [iv, tag, ciphertext] = parts.map(x => Buffer.from(x, 'base64'));
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    key = crypto.createHash('sha256').update(settingsKey.trim()).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag);
    const first = decipher.update(ciphertext);
    try { plaintext = Buffer.concat([first, decipher.final()]); } finally { first.fill(0); }
    return true;
  } catch { throw new Error('Encrypted settings verification failed'); }
  finally { key?.fill(0); plaintext?.fill(0); }
}
const identifier = value => '"' + value.replace(/"/g, '""') + '"';
async function verifyStoredSettings(client, settingsKey) {
  // Query only settings tables; do not scan customer transcripts or support data.
  const { rows: columns } = await client.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('v2_platform_email_settings','v2_platform_billing_settings','v2_platform_storage_settings','v2_platform_push_settings') AND data_type IN ('text','character varying') ORDER BY table_name,ordinal_position");
  let count = 0;
  for (const column of columns) {
    const { rows } = await client.query(`SELECT ${identifier(column.column_name)} AS value FROM public.${identifier(column.table_name)} WHERE ${identifier(column.column_name)} LIKE 'enc:v1:%'`);
    for (const row of rows) { verifyEncryptedValue(row.value, settingsKey); count++; }
  }
  if (!count) throw new Error('No encrypted settings found; recovered key is unverified');
  return { encryptedValues: count, authenticatedValues: count, allAuthenticated: true };
}
async function verifyRestore({ artifactsDir, backendDir, settingsKey, pgBin = '/usr/lib/postgresql/16/bin' }) {
  const manifest = JSON.parse(await fs.readFile(path.join(artifactsDir, 'manifest.json'), 'utf8'));
  if (manifest.format !== 1 || manifest.postgresMajor !== 16 || manifest.artifacts?.length !== 2 || new Set(manifest.artifacts.map(x => x.name)).size !== 2) throw new Error('Invalid recovery manifest');
  await verifyArtifacts(artifactsDir, manifest);
  const { Client } = backendRequire(backendDir)('pg');
  return withCluster(pgBin, async cluster => {
    await run(path.join(pgBin, 'pg_restore'), ['--exit-on-error', '--no-owner', '--no-privileges', '--dbname=postgres', path.resolve(artifactsDir, 'database.dump')], { env: cluster.env });
    const client = new Client({ ...cluster.connection, statement_timeout: 300000, connectionTimeoutMillis: 10000 });
    await client.connect();
    try {
      const actual = await inventory(client); assertInventory(manifest.database, actual);
      await client.query('BEGIN READ ONLY');
      const result = await verifyStoredSettings(client, settingsKey);
      await client.query('ROLLBACK');
      const output = path.join(cluster.root, 'uploads'); await fs.mkdir(output, { mode: 0o700 });
      await run('python3', [path.join(tools, 'safe-extract.py'), path.resolve(artifactsDir, 'uploads.tar.gz'), output]);
      if (JSON.stringify(await inspectUploads(output)) !== JSON.stringify(manifest.files)) throw new Error('Restored upload inventory mismatch');
      return { status: 'restore_and_key_verified', tables: actual.tables.length, constraints: actual.constraints.length, previouslyUnvalidatedConstraints: actual.constraints.filter(x => !x.validated).length, files: manifest.files.length, ...result, artifactChecksumsVerified: true, manifestHadRecoveryReference: Boolean(manifest.recovery), applicationStarted: false, providerCalls: false };
    } finally { await client.end(); }
  });
}
if (require.main === module) {
  process.umask(0o077);
  (async () => {
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) { size += chunk.length; if (size > 16384) throw new Error('Unexpected recovery input size'); chunks.push(chunk); }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const result = await verifyRestore({ artifactsDir: process.argv[2], backendDir: '/var/www/share-app-staging/livekit-app/backend', settingsKey: input.settingsKey });
    input.settingsKey = undefined;
    console.log(JSON.stringify(result));
  })().catch(() => { console.error('Isolated restore/key verification failed; private details withheld'); process.exitCode = 1; });
}
module.exports = { verifyEncryptedValue, verifyStoredSettings, verifyRestore };
