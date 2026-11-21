#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
async function checkFreshness(file, now = Date.now()) {
  const stamp = JSON.parse(await fs.readFile(file, 'utf8'));
  const age = now - Date.parse(stamp.completedAt);
  if (!Number.isFinite(age) || age < -300000 || age > 26 * 3600000) throw new Error('Backup freshness check failed');
  return { status: 'backup_fresh', ageHours: Math.max(0, Math.round(age / 360000) / 10) };
}
if (require.main === module) checkFreshness('/var/lib/lalia-backup/last-success.json').then(result => console.log(JSON.stringify(result))).catch(() => { console.error('Backup freshness failed: no completed backup within26hours. Inspect lalia-backup.service.'); process.exitCode = 1; });
module.exports = { checkFreshness };
