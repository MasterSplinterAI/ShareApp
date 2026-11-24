#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { backendRequire, run, verifyArtifacts, inspectUploads, inventory, assertInventory } = require('./common.cjs');

async function withCluster(pgBin, callback) {
  if (process.getuid?.() === 0) throw new Error('Run isolated restore as an unprivileged user');
  if (!/PostgreSQL\) 16\./.test(await run(path.join(pgBin, 'initdb'), ['--version']))) throw new Error('PostgreSQL16 tools required');
  const root = await fs.mkdtemp('/tmp/lalia-pg-drill-'); await fs.chmod(root, 0o700);
  const data = path.join(root, 'data'); const socket = path.join(root, 'socket'); await fs.mkdir(socket, { mode: 0o700 });
  let started = false;
  try {
    await run(path.join(pgBin, 'initdb'), ['-D', data, '-U', 'backup_drill', '--auth-local=trust', '--auth-host=reject', '--no-locale', '--encoding=UTF8']);
    started = true; // Even a timed-out start must attempt shutdown before cleanup.
    await run(path.join(pgBin, 'pg_ctl'), ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', `-k ${socket} -c listen_addresses='' -c unix_socket_permissions=0700`, '-w', 'start']);
    const env = { PATH: process.env.PATH, LANG: 'C', PGHOST: socket, PGPORT: '5432', PGUSER: 'backup_drill', PGDATABASE: 'postgres', PGCONNECT_TIMEOUT: '10' };
    return await callback({ root, env, connection: { host: socket, port: 5432, user: 'backup_drill', database: 'postgres' } });
  } finally {
    // If shutdown fails preserve the directory: never unlink files of a live server.
    if (started) await run(path.join(pgBin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop']);
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function restoreDrill({ backendDir, pgBin = '/usr/lib/postgresql/16/bin', artifactsDir }) {
  const manifest = JSON.parse(await fs.readFile(path.join(artifactsDir, 'manifest.json'), 'utf8'));
  if (manifest.format !== 1 || manifest.postgresMajor !== 16 || manifest.artifacts?.length !== 2 || new Set(manifest.artifacts.map(a => a.name)).size !== 2) throw new Error('Invalid recovery manifest');
  await verifyArtifacts(artifactsDir, manifest);
  const { Client } = backendRequire(backendDir)('pg');
  return withCluster(pgBin, async cluster => {
    await run(path.join(pgBin, 'pg_restore'), ['--exit-on-error', '--no-owner', '--no-privileges', '--dbname=postgres', path.resolve(artifactsDir, 'database.dump')], { env: cluster.env });
    const client = new Client(cluster.connection); await client.connect();
    try {
      const actual = await inventory(client); assertInventory(manifest.database, actual);
      const output = path.join(cluster.root, 'uploads'); await fs.mkdir(output, { mode: 0o700 });
      await run('python3', [path.join(__dirname, 'safe-extract.py'), path.resolve(artifactsDir, 'uploads.tar.gz'), output]);
      if (JSON.stringify(await inspectUploads(output)) !== JSON.stringify(manifest.files)) throw new Error('Restored uploads inventory mismatch');
      // pg_restore adds constraints after data, so validated FK/check constraints are actually enforced.
      return { status: 'restore_verified', tables: actual.tables.length, constraints: actual.constraints.length, previouslyUnvalidatedConstraints: actual.constraints.filter(c => !c.validated).length, files: manifest.files.length };
    } finally { await client.end(); }
  });
}
if (require.main === module) {
  process.umask(0o077);
  const [artifactsDir] = process.argv.slice(2);
  if (!artifactsDir || !process.env.LALIA_BACKEND_DIR) { console.error('Usage: LALIA_BACKEND_DIR=/path/to/backend node restore-drill.cjs /private/artifacts-directory'); process.exitCode = 1; }
  else restoreDrill({ backendDir: process.env.LALIA_BACKEND_DIR, pgBin: process.env.LALIA_PG_BIN || '/usr/lib/postgresql/16/bin', artifactsDir }).then(result => console.log(JSON.stringify(result))).catch(() => { console.error('Isolated restore verification failed. No production connection was used.'); process.exitCode = 1; });
}
module.exports = { withCluster, restoreDrill };
