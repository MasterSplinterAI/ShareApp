import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { HardDrive, Loader2 } from 'lucide-react';
import { v2Admin } from '../../../services/apiV2';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';

function StatusBadge({ ok, label }) {
  return (
    <Badge variant={ok ? 'default' : 'secondary'} className={ok ? 'bg-emerald-600 hover:bg-emerald-600' : ''}>
      {label}
    </Badge>
  );
}

export function StorageTab() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [driverPref, setDriverPref] = useState('inherit');
  const [localDir, setLocalDir] = useState('');
  const [bucket, setBucket] = useState('');
  const [region, setRegion] = useState('us-east-2');
  const [endpoint, setEndpoint] = useState('');
  const [prefix, setPrefix] = useState('');
  const [forcePathStyle, setForcePathStyle] = useState('inherit');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [auditReason, setAuditReason] = useState('');

  const applySettings = (data) => {
    setConfig(data);
    const s = data?.settings || {};
    setDriverPref(s.storageDriverPreference || 'inherit');
    setLocalDir(s.storageLocalDir || '');
    setBucket(s.storageS3Bucket || '');
    setRegion(s.storageS3Region || 'us-east-2');
    setEndpoint(s.storageS3Endpoint || '');
    setPrefix(s.storageS3Prefix || '');
    if (s.storageS3ForcePathStylePreference === true) setForcePathStyle('true');
    else if (s.storageS3ForcePathStylePreference === false) setForcePathStyle('false');
    else setForcePathStyle('inherit');
    setAccessKeyId('');
    setSecretAccessKey('');
    setClearSecret(false);
  };

  const reload = () => {
    setLoading(true);
    return v2Admin
      .storageConfig()
      .then(applySettings)
      .catch(() => toast.error('Failed to load storage config'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
  }, []);

  const effectiveDriver =
    driverPref === 'inherit' ? config?.activeDriver || config?.settings?.storageDriver : driverPref;
  const showS3 = effectiveDriver === 's3';

  const buildBody = () => {
    const body = {
      reason: auditReason.trim(),
      storageDriver: driverPref === 'inherit' ? null : driverPref,
      storageLocalDir: localDir.trim() || null,
      storageS3Bucket: bucket.trim() || null,
      storageS3Region: region.trim() || null,
      storageS3Endpoint: endpoint.trim() || null,
      storageS3Prefix: prefix.trim() || null,
      storageS3ForcePathStyle:
        forcePathStyle === 'inherit' ? null : forcePathStyle === 'true',
    };
    if (accessKeyId.trim()) body.storageS3AccessKeyId = accessKeyId.trim();
    if (clearSecret) body.clearStorageS3SecretAccessKey = true;
    else if (secretAccessKey.trim()) body.storageS3SecretAccessKey = secretAccessKey.trim();
    return body;
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const body = buildBody();
      delete body.reason;
      const result = await v2Admin.testStorage(body);
      toast.success(result.message || 'Connection OK');
    } catch (e) {
      toast.error(e.response?.data?.error || e.response?.data?.message || 'Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const saveSettings = async () => {
    if (auditReason.trim().length < 4) {
      toast.error('Audit reason required (4+ characters).');
      return;
    }
    if (effectiveDriver === 's3' && !bucket.trim()) {
      toast.error('Bucket name is required for S3 / R2.');
      return;
    }
    setSaving(true);
    try {
      await v2Admin.patchStorageConfig(buildBody());
      toast.success('Storage settings saved — live for new uploads');
      setAuditReason('');
      await reload();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save storage settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !config) {
    return <p className="text-sm text-muted-foreground">Loading storage configuration…</p>;
  }

  const settings = config?.settings || {};

  return (
    <div className="space-y-4">
      <Card className="app-card border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <HardDrive className="h-5 w-5" />
            Object storage
          </CardTitle>
          <CardDescription>
            Configure where durable uploads (branding logos, org files) are stored. Admin settings override server{' '}
            <code>.env</code>. Switching to S3 applies to <strong>new</strong> uploads only — existing local files are
            not migrated automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              ok={Boolean(config?.activeDriver)}
              label={`Active: ${config?.activeDriver || 'local'}`}
            />
            {settings.source && <Badge variant="secondary">Config source: {settings.source}</Badge>}
            {settings.hasStorageS3SecretAccessKey && (
              <Badge variant="outline">
                Secret: {settings.storageS3SecretAccessKeyMasked || '••••'}
                {settings.usingEnvSecret ? ' (env)' : ''}
              </Badge>
            )}
          </div>

          <form
            className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveSettings();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="storage-driver">Driver</Label>
              <select
                id="storage-driver"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={driverPref}
                onChange={(e) => setDriverPref(e.target.value)}
              >
                <option value="inherit">Inherit from env (default local)</option>
                <option value="local">Local disk</option>
                <option value="s3">S3 / R2 / MinIO</option>
              </select>
            </div>

            {(effectiveDriver === 'local' || driverPref === 'local') && (
              <div className="space-y-2">
                <Label htmlFor="storage-local-dir">Local directory (optional override)</Label>
                <Input
                  id="storage-local-dir"
                  value={localDir}
                  onChange={(e) => setLocalDir(e.target.value)}
                  placeholder={settings.storageLocalDir || './uploads'}
                />
              </div>
            )}

            {showS3 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="storage-bucket">Bucket *</Label>
                  <Input
                    id="storage-bucket"
                    value={bucket}
                    onChange={(e) => setBucket(e.target.value)}
                    placeholder="my-shareapp-uploads"
                    required={effectiveDriver === 's3'}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="storage-region">Region</Label>
                  <Input
                    id="storage-region"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    placeholder="us-east-2"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="storage-endpoint">Endpoint (R2 / MinIO)</Label>
                  <Input
                    id="storage-endpoint"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    placeholder="https://xxx.r2.cloudflarestorage.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="storage-prefix">Key prefix (optional)</Label>
                  <Input
                    id="storage-prefix"
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    placeholder="shareapp"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="storage-path-style">Force path-style</Label>
                  <select
                    id="storage-path-style"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={forcePathStyle}
                    onChange={(e) => setForcePathStyle(e.target.value)}
                  >
                    <option value="inherit">Auto (on when endpoint set)</option>
                    <option value="true">On</option>
                    <option value="false">Off</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="storage-access-key">Access key ID</Label>
                  <Input
                    id="storage-access-key"
                    value={accessKeyId}
                    onChange={(e) => setAccessKeyId(e.target.value)}
                    placeholder={
                      settings.hasStorageS3AccessKeyId
                        ? `Saved: ${settings.storageS3AccessKeyId || '••••'}`
                        : 'Access key'
                    }
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="storage-secret">Secret access key</Label>
                  <Input
                    id="storage-secret"
                    type="password"
                    value={secretAccessKey}
                    onChange={(e) => {
                      setSecretAccessKey(e.target.value);
                      setClearSecret(false);
                    }}
                    placeholder={
                      settings.hasStorageS3SecretAccessKey
                        ? `Configured (${settings.storageS3SecretAccessKeyMasked || '••••'}) — leave blank to keep`
                        : 'Secret key'
                    }
                    autoComplete="new-password"
                    disabled={clearSecret}
                  />
                  {settings.hasStorageS3SecretAccessKey && (
                    <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={clearSecret}
                        onChange={(e) => {
                          setClearSecret(e.target.checked);
                          if (e.target.checked) setSecretAccessKey('');
                        }}
                      />
                      Clear saved secret
                    </label>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Secret is encrypted at rest (AES-256-GCM). Never returned in plaintext after save.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="storage-reason">Audit reason *</Label>
              <Input
                id="storage-reason"
                value={auditReason}
                onChange={(e) => setAuditReason(e.target.value)}
                placeholder="e.g. Switch staging uploads to R2"
                required
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={testConnection} disabled={testing || saving}>
                {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Test connection
              </Button>
              <Button type="submit" disabled={saving || testing}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save & go live
              </Button>
            </div>
          </form>

          {settings.updatedAt && (
            <p className="text-xs text-muted-foreground">
              Last updated {new Date(settings.updatedAt).toLocaleString()}
              {settings.updatedBy ? ` by ${settings.updatedBy}` : ''}
            </p>
          )}

          <div className="rounded-md border border-border/50 bg-background/60 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Bucket setup tip</p>
            <p className="mt-1">
              Create a private bucket, then grant the API user:{' '}
              <code>s3:PutObject</code>, <code>s3:GetObject</code>, <code>s3:DeleteObject</code>,{' '}
              <code>s3:HeadBucket</code> (and <code>s3:ListBucket</code> if your provider requires it for HeadBucket).
              For Cloudflare R2, use the S3 API endpoint and leave region as <code>auto</code> or{' '}
              <code>us-east-1</code>.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default StorageTab;
