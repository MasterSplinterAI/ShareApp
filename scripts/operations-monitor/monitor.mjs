import https from 'node:https';

export const BUCKET = 'lalia-backups-690248313257-us-east-2';
export const PREFIX = 'lalia/daily/';
export const NAMESPACE = 'Lalia/Operations';
export const DIMENSIONS = [{ Name: 'Service', Value: 'lalia-production' }];
const HEALTH_URL = 'https://lalia.cloud/api/health';
const EXPECTED = ['database.dump', 'manifest.json', 'uploads.tar.gz'];

// Native HTTPS validates certificates and never follows redirects. The timer spans
// DNS, TLS, headers and body; the small body limit prevents unbounded allocation.
export function checkHealth({ request = https.request, timeoutMs = 6000 } = {}) {
  return new Promise(resolve => {
    let req; let done = false;
    const finish = result => { if (done) return; done = true; clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => { finish({ ok: false, status: 'timeout' }); req?.destroy(); }, timeoutMs);
    try {
      req = request(HEALTH_URL, { method: 'GET', rejectUnauthorized: true, headers: { Accept: 'application/json' } }, response => {
        response.on('error', () => finish({ ok: false, status: 'network_error' }));
        if (response.statusCode !== 200) {
          finish({ ok: false, status: `http_${Number(response.statusCode) || 0}` }); response.destroy(); return;
        }
        let bytes = 0; const chunks = [];
        response.on('data', chunk => {
          if (done) return;
          bytes += chunk.length;
          if (bytes > 4096) { finish({ ok: false, status: 'body_too_large' }); response.destroy(); return; }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (done) return;
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const ok = body?.status === 'ok' && body?.service === 'livekit-backend';
            finish({ ok, status: ok ? 'healthy' : 'unexpected_json' });
          } catch { finish({ ok: false, status: 'invalid_json' }); }
        });
      });
      req.on('error', () => finish({ ok: false, status: 'network_error' })); req.end();
    } catch { finish({ ok: false, status: 'network_error' }); req?.destroy(); }
  });
}

export function evaluateBackups(objects, now = new Date()) {
  const runs = new Map();
  for (const object of objects) {
    if (!object.Key?.startsWith(PREFIX)) continue;
    const relative = object.Key.slice(PREFIX.length);
    const slash = relative.indexOf('/');
    if (slash <= 0) continue;
    const run = relative.slice(0, slash);
    if (!runs.has(run)) runs.set(run, []);
    runs.get(run).push({ ...object, name: relative.slice(slash + 1) });
  }
  let latest = -Infinity;
  for (const objects of runs.values()) {
    if (objects.length !== 3 || objects.some(x => !(x.Size > 0))) continue;
    if (objects.map(x => x.name).sort().join('|') !== EXPECTED.join('|')) continue;
    const completed = new Date(objects.find(x => x.name === 'manifest.json').LastModified).getTime();
    if (Number.isFinite(completed) && completed <= now.getTime()) latest = Math.max(latest, completed);
  }
  if (!Number.isFinite(latest)) return { ok: false, status: 'no_complete_backup' };
  const ageHours = (now.getTime() - latest) / 3600000;
  return { ok: ageHours <= 26, status: ageHours <= 26 ? 'fresh' : 'stale', ageHours };
}

export async function checkBackups({ list, now = new Date(), timeoutMs = 12000 }) {
  const controller = new AbortController(); let timer;
  const listing = async () => {
    const objects = []; const tokens = new Set(); let token;
    do {
      const page = await list({ Bucket: BUCKET, Prefix: PREFIX, MaxKeys: 1000, ...(token ? { ContinuationToken: token } : {}) }, { abortSignal: controller.signal });
      objects.push(...(page.Contents || []));
      if (!page.IsTruncated) return evaluateBackups(objects, now);
      token = page.NextContinuationToken;
      if (!token || tokens.has(token)) return { ok: false, status: 'invalid_pagination' };
      tokens.add(token);
    } while (!controller.signal.aborted);
    return { ok: false, status: 'timeout' };
  };
  try {
    return await Promise.race([listing(), new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ ok: false, status: 'timeout' }); }, timeoutMs); })]);
  } catch { return { ok: false, status: 'listing_failed' }; }
  finally { clearTimeout(timer); }
}

export async function runMonitor({ health, backup, publish, now = new Date(), log = console.log }) {
  const settled = await Promise.allSettled([Promise.resolve().then(health), Promise.resolve().then(backup)]);
  const [api, backups] = settled.map(x => x.status === 'fulfilled' ? x.value : { ok: false, status: 'probe_failed' });
  // Only the closed operational schema is logged, never raw request/error objects.
  log(JSON.stringify({ timestamp: now.toISOString(), ApiHealthy: Boolean(api.ok), BackupFresh: Boolean(backups.ok), apiStatus: api.status, backupStatus: backups.status, ...(Number.isFinite(backups.ageHours) ? { backupAgeHours: backups.ageHours } : {}) }));
  const MetricData = ['ApiHealthy', 'BackupFresh', 'MonitorHeartbeat'].map((MetricName, index) => ({ MetricName, Dimensions: DIMENSIONS, Timestamp: now, Unit: 'Count', Value: index === 0 ? Number(Boolean(api.ok)) : index === 1 ? Number(Boolean(backups.ok)) : 1 }));
  try { await publish({ Namespace: NAMESPACE, MetricData }); }
  catch { throw new Error('metric_publication_failed'); }
  return { ApiHealthy: Boolean(api.ok), BackupFresh: Boolean(backups.ok), MonitorHeartbeat: true };
}

export async function handler() {
  // AWS's Node.js 24 runtime includes SDK v3. Deferred imports keep local tests
  // dependency-free; the deployed handler uses only these two AWS services.
  const [{ S3Client, ListObjectsV2Command }, { CloudWatchClient, PutMetricDataCommand }] = await Promise.all([import('@aws-sdk/client-s3'), import('@aws-sdk/client-cloudwatch')]);
  const s3 = new S3Client({ region: 'us-east-2', maxAttempts: 2 });
  const cloudwatch = new CloudWatchClient({ region: 'us-east-2', maxAttempts: 2 });
  const now = new Date();
  try {
    return await runMonitor({ now, health: () => checkHealth(), backup: () => checkBackups({ now, list: (input, options) => s3.send(new ListObjectsV2Command(input), options) }), publish: input => cloudwatch.send(new PutMetricDataCommand(input), { abortSignal: AbortSignal.timeout(6000) }) });
  } finally { s3.destroy(); cloudwatch.destroy(); }
}
