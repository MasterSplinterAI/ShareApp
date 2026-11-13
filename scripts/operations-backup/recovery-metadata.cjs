'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const crypto = require('node:crypto');

function exactKeys(value, names) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === names.slice().sort().join('|');
}
function validateRecoveryMetadata(value) {
  const backend = value?.backend;
  if (!exactKeys(value, ['format', 'backend']) || value.format !== 1 || !exactKeys(backend, ['secretArn', 'versionId', 'keyGeneration']) ||
      !/^arn:aws:secretsmanager:us-east-2:690248313257:secret:lalia\/prod\/recovery\/backend-[A-Za-z0-9]{6}$/.test(backend.secretArn) ||
      !/^[A-Za-z0-9-]{32,64}$/.test(backend.versionId) || !/^key-generation-[a-f0-9]{24}$/.test(backend.keyGeneration)) {
    throw new Error('Invalid nonsecret recovery metadata schema');
  }
  return { format: 1, backend: { secretArn: backend.secretArn, versionId: backend.versionId, keyGeneration: backend.keyGeneration } };
}
function assertRecoveryGeneration(value, settingsKey) {
  const reference = validateRecoveryMetadata(value);
  if (typeof settingsKey !== 'string' || !settingsKey.trim() || reference.backend.keyGeneration !== 'key-generation-' + crypto.createHash('sha256').update(settingsKey.trim()).digest('hex').slice(0, 24)) {
    throw new Error('Recovery key generation does not match backup configuration');
  }
}
async function readRecoveryMetadata(file = '/etc/lalia-backup-recovery.json') {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022) || stat.size > 2048) throw new Error('Recovery metadata must be a root-owned protected regular file');
    return validateRecoveryMetadata(JSON.parse(await handle.readFile('utf8')));
  } finally { await handle.close(); }
}
module.exports = { validateRecoveryMetadata, assertRecoveryGeneration, readRecoveryMetadata };
