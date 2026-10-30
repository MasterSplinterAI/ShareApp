const path = require('path');
const db = require('../db/v2Database');
const { encryptSecret, decryptSecret, maskSecret } = require('./secretCrypto');

const SETTINGS_ID = 'default';
let cache = null;
let cacheAt = 0;
const CACHE_MS = 3000;

function envTrim(key) {
  const v = process.env[key];
  return v && String(v).trim() ? String(v).trim() : null;
}

function envDriver() {
  const d = (envTrim('STORAGE_DRIVER') || 'local').toLowerCase();
  return d === 's3' ? 's3' : 'local';
}

function envBool(key) {
  const v = envTrim(key);
  if (v == null) return null;
  const l = v.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(l)) return true;
  if (['0', 'false', 'no', 'off'].includes(l)) return false;
  return null;
}

function defaultLocalDir() {
  return path.join(__dirname, '..', 'uploads');
}

async function loadDbRow() {
  return db.get(`SELECT * FROM v2_platform_storage_settings WHERE id = ?`, [SETTINGS_ID]);
}

function decryptDbSecret(row) {
  if (!row?.storage_s3_secret_access_key) return null;
  try {
    return decryptSecret(row.storage_s3_secret_access_key);
  } catch (e) {
    console.warn('[v2StorageSettings] Failed to decrypt S3 secret:', e.message);
    return null;
  }
}

/**
 * Resolve effective storage config. DB wins over env; null driver in DB = inherit env.
 */
function mergeSettings(row) {
  const dbDriverRaw = row?.storage_driver != null ? String(row.storage_driver).trim().toLowerCase() : null;
  const dbDriver = dbDriverRaw === 'local' || dbDriverRaw === 's3' ? dbDriverRaw : null;

  const dbLocalDir = row?.storage_local_dir ? String(row.storage_local_dir).trim() : null;
  const dbBucket = row?.storage_s3_bucket ? String(row.storage_s3_bucket).trim() : null;
  const dbRegion = row?.storage_s3_region ? String(row.storage_s3_region).trim() : null;
  const dbEndpoint = row?.storage_s3_endpoint ? String(row.storage_s3_endpoint).trim() : null;
  const dbPrefix = row?.storage_s3_prefix ? String(row.storage_s3_prefix).trim() : null;
  const dbAccessKey = row?.storage_s3_access_key_id ? String(row.storage_s3_access_key_id).trim() : null;
  const dbSecret = decryptDbSecret(row);

  let dbForcePathStyle = null;
  if (row && row.storage_s3_force_path_style !== null && row.storage_s3_force_path_style !== undefined) {
    dbForcePathStyle = Boolean(row.storage_s3_force_path_style);
  }

  const driver = dbDriver || envDriver();
  const localDir = dbLocalDir || envTrim('STORAGE_LOCAL_DIR') || defaultLocalDir();
  const bucket = dbBucket || envTrim('STORAGE_S3_BUCKET');
  const region = dbRegion || envTrim('STORAGE_S3_REGION') || 'us-east-2';
  const endpoint = dbEndpoint || envTrim('STORAGE_S3_ENDPOINT');
  const prefix = (dbPrefix || envTrim('STORAGE_S3_PREFIX') || '').replace(/^\/+|\/+$/g, '');
  const accessKeyId = dbAccessKey || envTrim('STORAGE_S3_ACCESS_KEY_ID');
  const secretAccessKey = dbSecret || envTrim('STORAGE_S3_SECRET_ACCESS_KEY');

  const envForce = envBool('STORAGE_S3_FORCE_PATH_STYLE');
  let forcePathStyle;
  if (dbForcePathStyle !== null) {
    forcePathStyle = dbForcePathStyle;
  } else if (envForce !== null) {
    forcePathStyle = envForce;
  } else {
    forcePathStyle = Boolean(endpoint);
  }

  let source = 'environment';
  if (row) {
    const hasDb =
      dbDriver != null ||
      dbLocalDir ||
      dbBucket ||
      dbRegion ||
      dbEndpoint ||
      dbPrefix ||
      dbAccessKey ||
      dbSecret ||
      dbForcePathStyle !== null;
    source = hasDb ? 'database' : 'environment';
    if (hasDb && (envTrim('STORAGE_DRIVER') || envTrim('STORAGE_S3_BUCKET'))) {
      source = 'mixed';
    }
  }

  return {
    driver,
    driverPreference: dbDriver, // null = inherit
    localDir,
    bucket,
    region,
    endpoint: endpoint || null,
    forcePathStyle,
    forcePathStylePreference:
      row && row.storage_s3_force_path_style !== null && row.storage_s3_force_path_style !== undefined
        ? Boolean(row.storage_s3_force_path_style)
        : null,
    accessKeyId,
    secretAccessKey,
    prefix,
    source,
    dbRow: row,
    hasDbSecret: Boolean(dbSecret),
    hasEnvSecret: Boolean(envTrim('STORAGE_S3_SECRET_ACCESS_KEY')),
    updatedAt: row?.updated_at || null,
    updatedBy: row?.updated_by || null,
  };
}

async function getStorageSettings({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && cache && now - cacheAt < CACHE_MS) return cache;
  const row = await loadDbRow();
  cache = mergeSettings(row);
  cacheAt = now;
  return cache;
}

function invalidateStorageSettingsCache() {
  cache = null;
  cacheAt = 0;
}

/** Alias used by object storage + admin test. */
async function getResolvedStorageConfig(opts) {
  return getStorageSettings(opts);
}

function buildConfigFromOverrides(base, overrides = {}) {
  const next = { ...base };
  if (overrides.storageDriver === 'local' || overrides.storageDriver === 's3') {
    next.driver = overrides.storageDriver;
  } else if (overrides.storageDriver === null || overrides.storageDriver === 'inherit') {
    next.driver = envDriver();
  }
  if (overrides.storageLocalDir !== undefined && overrides.storageLocalDir !== '') {
    next.localDir = String(overrides.storageLocalDir).trim();
  }
  if (overrides.storageS3Bucket !== undefined) {
    next.bucket = String(overrides.storageS3Bucket || '').trim() || null;
  }
  if (overrides.storageS3Region !== undefined && overrides.storageS3Region !== '') {
    next.region = String(overrides.storageS3Region).trim();
  }
  if (overrides.storageS3Endpoint !== undefined) {
    next.endpoint = String(overrides.storageS3Endpoint || '').trim() || null;
  }
  if (overrides.storageS3Prefix !== undefined) {
    next.prefix = String(overrides.storageS3Prefix || '')
      .trim()
      .replace(/^\/+|\/+$/g, '');
  }
  if (overrides.storageS3AccessKeyId !== undefined && overrides.storageS3AccessKeyId !== '') {
    next.accessKeyId = String(overrides.storageS3AccessKeyId).trim();
  }
  if (overrides.storageS3SecretAccessKey !== undefined && overrides.storageS3SecretAccessKey !== '') {
    next.secretAccessKey = String(overrides.storageS3SecretAccessKey).trim();
  }
  if (overrides.storageS3ForcePathStyle === true || overrides.storageS3ForcePathStyle === false) {
    next.forcePathStyle = overrides.storageS3ForcePathStyle;
  } else if (overrides.storageS3ForcePathStyle === null || overrides.storageS3ForcePathStyle === 'inherit') {
    next.forcePathStyle = Boolean(next.endpoint);
  }
  return next;
}

async function saveStorageSettings(actorEmail, body = {}) {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 4) {
    return { ok: false, error: 'reason required (4+ chars)' };
  }

  const row = await loadDbRow();
  const next = {
    storage_driver: row?.storage_driver ?? null,
    storage_local_dir: row?.storage_local_dir || null,
    storage_s3_bucket: row?.storage_s3_bucket || null,
    storage_s3_region: row?.storage_s3_region || null,
    storage_s3_endpoint: row?.storage_s3_endpoint || null,
    storage_s3_force_path_style:
      row && row.storage_s3_force_path_style !== null && row.storage_s3_force_path_style !== undefined
        ? row.storage_s3_force_path_style
        : null,
    storage_s3_access_key_id: row?.storage_s3_access_key_id || null,
    storage_s3_secret_access_key: row?.storage_s3_secret_access_key || null,
    storage_s3_prefix: row?.storage_s3_prefix || null,
  };

  if (body.storageDriver !== undefined) {
    if (body.storageDriver === null || body.storageDriver === '' || body.storageDriver === 'inherit') {
      next.storage_driver = null;
    } else if (body.storageDriver === 'local' || body.storageDriver === 's3') {
      next.storage_driver = body.storageDriver;
    } else {
      return { ok: false, error: 'storageDriver must be local, s3, or inherit' };
    }
  }

  if (body.storageLocalDir !== undefined) {
    next.storage_local_dir = body.storageLocalDir ? String(body.storageLocalDir).trim() : null;
  }
  if (body.storageS3Bucket !== undefined) {
    next.storage_s3_bucket = body.storageS3Bucket ? String(body.storageS3Bucket).trim() : null;
  }
  if (body.storageS3Region !== undefined) {
    next.storage_s3_region = body.storageS3Region ? String(body.storageS3Region).trim() : null;
  }
  if (body.storageS3Endpoint !== undefined) {
    next.storage_s3_endpoint = body.storageS3Endpoint ? String(body.storageS3Endpoint).trim() : null;
  }
  if (body.storageS3Prefix !== undefined) {
    next.storage_s3_prefix = body.storageS3Prefix
      ? String(body.storageS3Prefix).trim().replace(/^\/+|\/+$/g, '')
      : null;
  }
  if (body.storageS3AccessKeyId !== undefined) {
    next.storage_s3_access_key_id = body.storageS3AccessKeyId
      ? String(body.storageS3AccessKeyId).trim()
      : null;
  }

  if (body.storageS3ForcePathStyle === null || body.storageS3ForcePathStyle === 'inherit') {
    next.storage_s3_force_path_style = null;
  } else if (body.storageS3ForcePathStyle === true || body.storageS3ForcePathStyle === false) {
    next.storage_s3_force_path_style = body.storageS3ForcePathStyle ? 1 : 0;
  }

  if (body.clearStorageS3SecretAccessKey) {
    next.storage_s3_secret_access_key = null;
  } else if (body.storageS3SecretAccessKey !== undefined && body.storageS3SecretAccessKey !== '') {
    try {
      next.storage_s3_secret_access_key = encryptSecret(String(body.storageS3SecretAccessKey).trim());
    } catch (e) {
      return { ok: false, error: e.message || 'Failed to encrypt secret' };
    }
  }

  const preview = mergeSettings({
    ...next,
    storage_s3_force_path_style: next.storage_s3_force_path_style,
    updated_at: row?.updated_at,
    updated_by: row?.updated_by,
  });

  if (preview.driver === 's3' && !preview.bucket) {
    return { ok: false, error: 'S3 bucket name is required before switching to S3 storage' };
  }

  const now = new Date().toISOString();
  if (row) {
    await db.run(
      `UPDATE v2_platform_storage_settings SET
        storage_driver = ?, storage_local_dir = ?, storage_s3_bucket = ?, storage_s3_region = ?,
        storage_s3_endpoint = ?, storage_s3_force_path_style = ?, storage_s3_access_key_id = ?,
        storage_s3_secret_access_key = ?, storage_s3_prefix = ?, updated_at = ?, updated_by = ?
       WHERE id = ?`,
      [
        next.storage_driver,
        next.storage_local_dir,
        next.storage_s3_bucket,
        next.storage_s3_region,
        next.storage_s3_endpoint,
        next.storage_s3_force_path_style,
        next.storage_s3_access_key_id,
        next.storage_s3_secret_access_key,
        next.storage_s3_prefix,
        now,
        actorEmail,
        SETTINGS_ID,
      ]
    );
  } else {
    await db.run(
      `INSERT INTO v2_platform_storage_settings (
        id, storage_driver, storage_local_dir, storage_s3_bucket, storage_s3_region,
        storage_s3_endpoint, storage_s3_force_path_style, storage_s3_access_key_id,
        storage_s3_secret_access_key, storage_s3_prefix, updated_at, updated_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        SETTINGS_ID,
        next.storage_driver,
        next.storage_local_dir,
        next.storage_s3_bucket,
        next.storage_s3_region,
        next.storage_s3_endpoint,
        next.storage_s3_force_path_style,
        next.storage_s3_access_key_id,
        next.storage_s3_secret_access_key,
        next.storage_s3_prefix,
        now,
        actorEmail,
      ]
    );
  }

  invalidateStorageSettingsCache();
  try {
    const { resetObjectStorage } = require('./objectStorage');
    resetObjectStorage();
  } catch {
    /* circular-safe during boot */
  }

  const settings = await getStorageSettings({ fresh: true });
  return { ok: true, settings, reason };
}

function toAdminView(settings) {
  return {
    storageDriver: settings.driver,
    storageDriverPreference: settings.driverPreference,
    storageLocalDir: settings.localDir,
    storageS3Bucket: settings.bucket,
    storageS3Region: settings.region,
    storageS3Endpoint: settings.endpoint,
    storageS3ForcePathStyle: settings.forcePathStyle,
    storageS3ForcePathStylePreference: settings.forcePathStylePreference,
    storageS3AccessKeyId: settings.accessKeyId
      ? `${settings.accessKeyId.slice(0, 4)}…${settings.accessKeyId.slice(-4)}`
      : null,
    hasStorageS3AccessKeyId: Boolean(settings.accessKeyId),
    hasStorageS3SecretAccessKey: Boolean(settings.secretAccessKey),
    storageS3SecretAccessKeyMasked: maskSecret(settings.secretAccessKey),
    storageS3Prefix: settings.prefix || '',
    source: settings.source,
    usingEnvSecret: settings.hasEnvSecret && !settings.hasDbSecret,
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
  };
}

module.exports = {
  getStorageSettings,
  getResolvedStorageConfig,
  saveStorageSettings,
  invalidateStorageSettingsCache,
  buildConfigFromOverrides,
  mergeSettings,
  toAdminView,
  envDriver,
  defaultLocalDir,
};
