const { applyMarketingProjection, ensureMarketingAuthority, readMarketingAuthority, runMarketingTransfer } = require('@rhule/marketing-core');
const { verifyMarketingCredential, verifyOpsWebhookSignature } = require('@rhule/ops-sdk');
const { consentDatabase } = require('./consent');

const businessId = 'lalia';
const centralOrigin = () => (process.env.MARKETING_OPSHUB_ORIGIN || 'https://ops.lalia.cloud').replace(/\/$/,'');
const authority = () => readMarketingAuthority(consentDatabase,businessId);

async function initializeMarketingAuthority() {
  await ensureMarketingAuthority(consentDatabase,businessId,'legacy');
}

async function refreshMarketingProjection() {
  if ((await authority())?.mode !== 'cache') return false;
  const key = process.env.MARKETING_OPSHUB_PEER_KEY;
  if (!key) throw new Error('Marketing projection credential is missing');
  const response = await fetch(`${centralOrigin()}/api/v1/marketing/published-projection`, {
    headers: { 'X-Marketing-Peer-Key': key }, signal: AbortSignal.timeout(6000), redirect: 'error',
  });
  if (!response.ok) throw new Error('Marketing projection is unavailable');
  const raw = await response.text();
  const signature = response.headers.get('x-marketing-signature');
  if (!signature || !(await verifyOpsWebhookSignature(raw,signature,key))) throw new Error('Marketing projection signature is invalid');
  return applyMarketingProjection(consentDatabase,businessId,JSON.parse(raw));
}

function startMarketingProjectionRefresh() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await refreshMarketingProjection(); }
    catch { console.warn('[marketing] Keeping the last verified published snapshot'); }
    finally { running = false; }
  };
  const timer = setInterval(tick,30_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}

function cachedHeroImageUrl(value) {
  const source = `${centralOrigin()}/api/v1/marketing/media/`;
  return value.startsWith(source) ? `/marketing/media/${value.slice(source.length)}` : value;
}

async function forwardVerifiedProviderEvent(tenant, event) {
  const current = await authority();
  if (tenant !== businessId || current?.mode !== 'cache') return false;
  const key = process.env.MARKETING_OPSHUB_PEER_KEY;
  if (!key) throw new Error('Marketing callback credential is missing');
  const response = await fetch(`${centralOrigin()}/api/v1/marketing/forwarded-event`, {
    method:'POST', headers:{'Content-Type':'application/json','X-Marketing-Peer-Key':key},
    body: JSON.stringify({generation:Number(current.generation),event}),
    signal: AbortSignal.timeout(6000), redirect:'error',
  });
  if (!response.ok) throw new Error('Marketing callback was not accepted');
  return true;
}

async function marketingTransferHandler(req,res) {
  if (!verifyMarketingCredential(process.env.MARKETING_MIGRATION_KEY,req.get('x-marketing-migration-key'))) return res.sendStatus(403);
  try {
    const result = await runMarketingTransfer(consentDatabase,businessId,'legacy',req.body);
    if (req.body?.action === 'freeze' && req.body.generation === 1) await require('./marketingPublicPages').captureStaticBaseline();
    return res.json(result);
  } catch (error) {
    console.warn('[marketing] transfer refused:', error.message);
    return res.status(409).json({error:'Marketing transfer refused. Check authority generation and reconciliation.'});
  }
}

async function forwardMarketingSubscribe(req,res,next) {
  try {
    if ((await authority())?.mode !== 'cache') return next();
    const response = await fetch(`${centralOrigin()}/api/v1/marketing/subscribe`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(req.body ?? {}),
      signal:AbortSignal.timeout(8000), redirect:'error',
    });
    return res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(await response.text());
  } catch {
    return res.status(503).json({error:'Subscription is temporarily unavailable'});
  }
}

module.exports = { authority, initializeMarketingAuthority, refreshMarketingProjection, startMarketingProjectionRefresh, cachedHeroImageUrl, forwardVerifiedProviderEvent, marketingTransferHandler, forwardMarketingSubscribe };
