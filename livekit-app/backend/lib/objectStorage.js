/**
 * Object storage drivers for durable product files (org uploads, branding logos).
 * Keys always include org isolation: v2/{orgId}/...
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Readable } = require('stream');
const { getResolvedStorageConfig } = require('./v2StorageSettings');

let cachedDriver = null;
let cachedSignature = null;

function objectKey(orgId, relativePath) {
  const safeOrg = String(orgId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const rel = String(relativePath || '')
    .replace(/^\/+/, '')
    .split('/')
    .map((p) => path.basename(p))
    .filter(Boolean)
    .join('/');
  return `v2/${safeOrg}/${rel}`;
}

function brandingObjectKey(orgId, fileName) {
  return objectKey(orgId, `branding/${path.basename(fileName)}`);
}

function fileObjectKey(orgId, storedName) {
  return objectKey(orgId, path.basename(storedName));
}

class LocalDriver {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  absolutePath(key) {
    const full = path.resolve(this.rootDir, key);
    const root = path.resolve(this.rootDir);
    if (!full.startsWith(root + path.sep) && full !== root) {
      throw new Error('Invalid storage key');
    }
    return full;
  }

  async put(key, data, _opts = {}) {
    const full = this.absolutePath(key);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await fsp.writeFile(full, buf);
    return { key, bytes: buf.length };
  }

  async getStream(key) {
    const full = this.absolutePath(key);
    if (!fs.existsSync(full)) return null;
    return fs.createReadStream(full);
  }

  async getBytes(key) {
    const full = this.absolutePath(key);
    if (!fs.existsSync(full)) return null;
    return fsp.readFile(full);
  }

  async delete(key) {
    const full = this.absolutePath(key);
    try {
      await fsp.unlink(full);
      return true;
    } catch (e) {
      if (e.code === 'ENOENT') return false;
      throw e;
    }
  }

  async exists(key) {
    return fs.existsSync(this.absolutePath(key));
  }
}

class S3Driver {
  constructor(config) {
    this.config = config;
    // Lazy-require so local-only installs don't need AWS SDK until S3 is used
    const { S3Client, HeadBucketCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } =
      require('@aws-sdk/client-s3');
    this._HeadBucketCommand = HeadBucketCommand;
    this._HeadObjectCommand = HeadObjectCommand;
    this._GetObjectCommand = GetObjectCommand;
    this._DeleteObjectCommand = DeleteObjectCommand;

    const clientConfig = {
      region: config.region || 'us-east-2',
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            }
          : undefined,
    };
    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
      clientConfig.forcePathStyle = config.forcePathStyle !== false;
    } else if (config.forcePathStyle) {
      clientConfig.forcePathStyle = true;
    }
    this.client = new S3Client(clientConfig);
    this.bucket = config.bucket;
    this.keyPrefix = (config.prefix || '').replace(/^\/+|\/+$/g, '');
  }

  fullKey(key) {
    if (!this.keyPrefix) return key;
    return `${this.keyPrefix}/${key}`.replace(/\/+/g, '/');
  }

  async put(key, data, opts = {}) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const { Upload } = require('@aws-sdk/lib-storage');
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: this.fullKey(key),
        Body: buf,
        ContentType: opts.contentType || 'application/octet-stream',
      },
    });
    await upload.done();
    return { key, bytes: buf.length };
  }

  async getStream(key) {
    try {
      const out = await this.client.send(
        new this._GetObjectCommand({
          Bucket: this.bucket,
          Key: this.fullKey(key),
        })
      );
      return out.Body;
    } catch (e) {
      if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async getBytes(key) {
    const stream = await this.getStream(key);
    if (!stream) return null;
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async delete(key) {
    try {
      await this.client.send(
        new this._DeleteObjectCommand({
          Bucket: this.bucket,
          Key: this.fullKey(key),
        })
      );
      return true;
    } catch (e) {
      if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return false;
      throw e;
    }
  }

  async exists(key) {
    try {
      await this.client.send(
        new this._HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.fullKey(key),
        })
      );
      return true;
    } catch (e) {
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return false;
      throw e;
    }
  }

  async headBucket() {
    await this.client.send(new this._HeadBucketCommand({ Bucket: this.bucket }));
  }
}

function configSignature(cfg) {
  return JSON.stringify({
    driver: cfg.driver,
    localDir: cfg.localDir,
    bucket: cfg.bucket,
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey ? '***' : null,
    prefix: cfg.prefix,
  });
}

function createDriverFromConfig(cfg) {
  if (cfg.driver === 's3') {
    if (!cfg.bucket) {
      throw new Error('S3 storage selected but no bucket configured');
    }
    return new S3Driver(cfg);
  }
  return new LocalDriver(cfg.localDir);
}

async function getObjectStorage({ fresh = false } = {}) {
  const cfg = await getResolvedStorageConfig({ fresh });
  const sig = configSignature(cfg);
  if (!fresh && cachedDriver && cachedSignature === sig) {
    return { driver: cachedDriver, config: cfg };
  }
  cachedDriver = createDriverFromConfig(cfg);
  cachedSignature = sig;
  return { driver: cachedDriver, config: cfg };
}

function resetObjectStorage() {
  cachedDriver = null;
  cachedSignature = null;
}

async function testStorageConnection(overrides = {}) {
  const base = await getResolvedStorageConfig({ fresh: true });
  const { buildConfigFromOverrides } = require('./v2StorageSettings');
  const cfg = buildConfigFromOverrides(base, overrides);
  if (cfg.driver !== 's3') {
    const dir = cfg.localDir;
    try {
      await fsp.mkdir(dir, { recursive: true });
      const probe = path.join(dir, `.storage-probe-${Date.now()}`);
      await fsp.writeFile(probe, 'ok');
      await fsp.unlink(probe);
      return { ok: true, driver: 'local', message: `Local directory writable: ${dir}` };
    } catch (e) {
      return { ok: false, driver: 'local', error: e.message || 'Local directory not writable' };
    }
  }
  if (!cfg.bucket) {
    return { ok: false, driver: 's3', error: 'Bucket name is required' };
  }
  if (!cfg.accessKeyId || !cfg.secretAccessKey) {
    return { ok: false, driver: 's3', error: 'Access key ID and secret access key are required' };
  }
  try {
    const driver = new S3Driver(cfg);
    await driver.headBucket();
    return {
      ok: true,
      driver: 's3',
      message: `Connected to bucket "${cfg.bucket}"${cfg.endpoint ? ` via ${cfg.endpoint}` : ''}`,
    };
  } catch (e) {
    return {
      ok: false,
      driver: 's3',
      error: e.message || 'HeadBucket failed',
    };
  }
}

async function putOrgObject(orgId, relativePath, data, opts = {}) {
  const { driver } = await getObjectStorage();
  const key = objectKey(orgId, relativePath);
  return driver.put(key, data, opts);
}

async function streamOrgObject(orgId, relativePath) {
  const { driver } = await getObjectStorage();
  const key = objectKey(orgId, relativePath);
  return driver.getStream(key);
}

async function deleteOrgObject(orgId, relativePath) {
  const { driver } = await getObjectStorage();
  const key = objectKey(orgId, relativePath);
  return driver.delete(key);
}

async function orgObjectExists(orgId, relativePath) {
  const { driver } = await getObjectStorage();
  const key = objectKey(orgId, relativePath);
  return driver.exists(key);
}

/** Pipe a readable stream (or buffer) to Express response. */
async function pipeObjectToResponse(streamOrNull, res, { contentType, contentDisposition, cacheControl } = {}) {
  if (!streamOrNull) {
    return false;
  }
  if (contentType) res.setHeader('Content-Type', contentType);
  if (contentDisposition) res.setHeader('Content-Disposition', contentDisposition);
  if (cacheControl) res.setHeader('Cache-Control', cacheControl);

  if (Buffer.isBuffer(streamOrNull)) {
    res.end(streamOrNull);
    return true;
  }
  if (typeof streamOrNull.pipe === 'function') {
    streamOrNull.pipe(res);
    return true;
  }
  // AWS SDK v3 sometimes returns async iterable
  if (Readable.from && streamOrNull[Symbol.asyncIterator]) {
    Readable.from(streamOrNull).pipe(res);
    return true;
  }
  const buf = await streamOrNull.transformToByteArray?.();
  if (buf) {
    res.end(Buffer.from(buf));
    return true;
  }
  return false;
}

module.exports = {
  LocalDriver,
  S3Driver,
  getObjectStorage,
  resetObjectStorage,
  testStorageConnection,
  objectKey,
  brandingObjectKey,
  fileObjectKey,
  putOrgObject,
  streamOrgObject,
  deleteOrgObject,
  orgObjectExists,
  pipeObjectToResponse,
  createDriverFromConfig,
};
