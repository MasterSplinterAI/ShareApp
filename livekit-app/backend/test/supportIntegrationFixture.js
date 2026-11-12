'use strict';
process.on('disconnect', () => process.exit(1));
// Child fixture only: no production boot, .env, network providers, or non-test DB.
const [mode, certificateDirectory, hubKey, reset] = process.argv.slice(2);
if (!['pg', 'sqlite'].includes(mode) || !certificateDirectory?.startsWith('/private/tmp/task7-')) throw Error('Invalid fixture arguments');
require('./supportIsolation').prepareSupportTest();
Object.assign(process.env, { OPS_HUB_URL: 'http://127.0.0.1:5397', OPS_HUB_SECRET_KEY: hubKey, OPS_HUB_SUPPORT_MODE: 'central', OPS_HUB_BUSINESS_ID: 'lalia' });
const ready = (async () => {
  if (reset === 'reset') {
    if (mode === 'pg') { const { Pool } = require('pg'); const p = new Pool({ connectionString: process.env.DATABASE_URL }); await p.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public'); await p.end(); }
    else await require('node:fs/promises').rm(process.env.V2_DB_PATH, { force: true });
  }
  const db = require('../db/v2Database'); await db.initDatabase();
  const sdk = require('@rhule/ops-sdk');
  const recovery = require('../lib/supportRecoveryDatabase');
  const authority = require('../lib/supportAuthority');
  const auth = require('../lib/authAdapter');
  if (reset === 'reset') {
    await db.run("INSERT INTO v2_users(id,email,password_hash,display_name) VALUES('journey-user','journey@fixture.test','unused','Journey customer')");
    await db.run("INSERT INTO v2_organizations(id,name) VALUES('journey-org','Journey organization')");
    await db.run("INSERT INTO v2_org_members(user_id,org_id,role) VALUES('journey-user','journey-org','owner')");
    await require('@quill/support-core').ensureSchema(db);
  }
  const { createShareAppSupportRouter, ensureSupportSchema } = require('../lib/supportKit');
  await ensureSupportSchema();
  const router = createShareAppSupportRouter();
  const express = require('express'), app = express(); app.use(express.json());
  app.use('/v2/support', (req, res, next) => Promise.resolve(router.handler(req, res, next)).catch(next));
  const fs = require('node:fs');
  const server = require('node:https').createServer({ key: fs.readFileSync(certificateDirectory + '/key.pem'), cert: fs.readFileSync(certificateDirectory + '/cert.pem') }, app);
  await new Promise(resolve => server.listen(5396, '127.0.0.1', resolve));
  router.startReplay();
  return { db, sdk, authority, recovery, router, token: auth.signSession({ sub: 'journey-user', orgId: 'journey-org', role: 'admin' }) };
})();
process.on('message', async ({ id, command, data }) => {
  try {
    const c = await ready; let value;
    if (command === 'ready') value = { token: c.token, pid: process.pid };
    else if (command === 'query') value = await c.db.all(data.sql, data.params || []);
    else if (command === 'stop-replay') { c.router.stopReplay(); value = true; }
    else if (command === 'authority') value = await c.authority.hostSupportAuthority.read();
    else if (command === 'export') {
      const exporter = require('../scripts/export-support-history');
      if (mode === 'pg') process.env.SUPPORT_EXPORT_DATABASE_URL = process.env.DATABASE_URL;
      else process.env.SUPPORT_EXPORT_SQLITE_PATH = process.env.V2_DB_PATH;
      const connection = await exporter.connectExportDatabase();
      let concurrentWrite;
      const checkpoint = async () => { if (data.consistency && !concurrentWrite) concurrentWrite = c.db.run("UPDATE support_messages SET body='Concurrent source revision' WHERE id='source-message'").then(() => true, () => false); };
      try { value = await exporter.exportHistory(connection, { businessId: 'lalia', generation: data.generation, freezeId: data.freezeId, catalogs: exporter.CATALOGS, checkpoint, docsRoot: require('node:path').resolve(__dirname, '../docs/support'), ...(data.freezeId ? { verifyFreeze: async () => { const response = await fetch('http://127.0.0.1:5397/api/v1/support/authority', { headers: { 'X-Ops-Key': hubKey, 'X-Ops-Tenant': 'lalia' } }); if (!response.ok) throw Error('Live authority unavailable'); const a = await response.json(); if (a.state !== 'frozen' || !a.acceptanceClosed || a.freezeId !== data.freezeId) throw Error('Expected sealed live authority'); } } : {}) }); }
      finally { await connection.close(); }
      if (concurrentWrite && !await concurrentWrite) await c.db.run("UPDATE support_messages SET body='Concurrent source revision' WHERE id='source-message'");
    } else if (command === 'restore') {
      const db = c.recovery.getSupportRecoveryDatabase(); const backup = await c.sdk.createSupportRestoreBackup(db, 'lalia');
      value = await c.sdk.applySupportReverseDelta(db, data.artifact, backup.id, () => c.authority.hostSupportAuthority.read());
    } else throw Error('Unknown fixture command: ' + command);
    process.send({ id, value });
  } catch (error) { process.send({ id, error: error.stack }); }
});
ready.then(() => process.send({ event: 'ready' }), error => { console.error(error); process.exit(1); });
