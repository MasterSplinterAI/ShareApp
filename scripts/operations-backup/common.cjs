'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

function backendRequire(backendDir) { return createRequire(path.join(path.resolve(backendDir), 'package.json')); }
function pgEnvironment(databaseUrl) {
  const u = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || [...u.searchParams.keys()].some(k => k !== 'sslmode')) throw new Error('Unsupported database URL');
  if (!u.pathname.slice(1) || !u.hostname) throw new Error('Incomplete database URL');
  return { PATH: process.env.PATH, LANG: 'C', PGHOST: u.hostname, PGPORT: u.port || '5432', PGDATABASE: decodeURIComponent(u.pathname.slice(1)), PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGSSLMODE: u.searchParams.get('sslmode') || 'prefer', PGCONNECT_TIMEOUT: '15' };
}
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs = 300000, killGraceMs = 2000, ...spawnOptions } = options;
    const child = spawn(command, args, { ...spawnOptions, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let exceeded = false; let timedOut = false; let forceKill;
    const timer = setTimeout(() => {
      timedOut = true; child.kill('SIGTERM');
      forceKill = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
    }, timeoutMs);
    function clearTimers() { clearTimeout(timer); clearTimeout(forceKill); }
    child.stdout.on('data', d => { output += d; if (output.length > 8 * 1024 * 1024) { exceeded = true; child.kill('SIGTERM'); } });
    // Never echo child stderr: PostgreSQL/tar errors can contain customer values or credentials.
    child.stderr.resume();
    child.on('error', () => { clearTimers(); reject(new Error(`${path.basename(command)} could not start`)); });
    child.on('close', code => { clearTimers(); return code === 0 && !exceeded && !timedOut ? resolve(output) : reject(new Error(`${path.basename(command)} ${timedOut ? 'timed out' : `failed (status ${code})`}`)); });
  });
}
async function sha256(file) {
  const handle = await fs.open(file, 'r');
  try { const h = crypto.createHash('sha256'); for await (const chunk of handle.createReadStream()) h.update(chunk); return h.digest('hex'); }
  finally { await handle.close(); }
}
async function inspectUploads(root) {
  const entries = [];
  async function walk(relative) {
    const absolute = path.join(root, relative);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('Uploads must contain only regular files and directories; no symlinks');
    if (relative.split(path.sep).some(p => /^\.env(?:\.|$)/i.test(p))) throw new Error('Secret env file in uploads');
    if (stat.isDirectory()) { for (const name of (await fs.readdir(absolute)).sort()) await walk(path.join(relative, name)); }
    else entries.push({ name: relative.split(path.sep).join('/'), bytes: stat.size, sha256: await sha256(absolute) });
  }
  await walk(''); return entries;
}
async function verifyArtifacts(root, manifest) {
  if (!Array.isArray(manifest.artifacts)) throw new Error('Invalid artifact manifest');
  for (const item of manifest.artifacts) {
    if (!['database.dump', 'uploads.tar.gz'].includes(item.name) || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Invalid artifact name or checksum');
    const file = path.join(root, item.name); const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size !== item.bytes || await sha256(file) !== item.sha256) throw new Error('Artifact checksum mismatch');
  }
}
function identifier(value) { return '"' + value.replace(/"/g, '""') + '"'; }
async function inventory(client) {
  const { rows: tables } = await client.query("SELECT n.nspname AS schema, c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' ORDER BY 1,2");
  for (const table of tables) table.rows = (await client.query(`SELECT count(*)::text AS count FROM ${identifier(table.schema)}.${identifier(table.name)}`)).rows[0].count;
  const { rows: constraints } = await client.query("SELECT n.nspname AS schema, c.relname AS table, con.conname AS name, con.contype AS type, con.convalidated AS validated, pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' ORDER BY 1,2,3");
  return { tables, constraints };
}
function assertInventory(expected, actual) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Restored database inventory mismatch');
}
module.exports = { backendRequire, pgEnvironment, run, sha256, inspectUploads, verifyArtifacts, inventory, assertInventory };
