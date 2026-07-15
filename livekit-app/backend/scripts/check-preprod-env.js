#!/usr/bin/env node
/**
 * Read-only env / readiness probe for staging or production cutover.
 * Usage (from backend dir, with .env loaded by the process or exported):
 *   node scripts/check-preprod-env.js
 *
 * Exit 0 = critical gates pass; exit 1 = one or more critical failures.
 */
const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 0) continue;
    const key = trimmed.slice(0, i).trim();
    let val = trimmed.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv();

const WEAK = new Set([
  'change-me-in-production-v2',
  'change-me-in-production',
  'change-me',
  'changeme',
  'secret',
  'password',
  'jwt-secret',
  'jwt_secret',
  'your-secret-here',
  'replace-with-long-random-string',
  'dev-secret',
  'development',
  'test',
  'test-secret',
]);

const rows = [];
function check(name, ok, { critical = true, detail = '' } = {}) {
  rows.push({ name, ok: Boolean(ok), critical, detail });
}

const jwt = String(process.env.JWT_SECRET_V2 || process.env.JWT_SECRET || '').trim();
check('JWT_SECRET_V2 present', Boolean(jwt));
check('JWT not placeholder', jwt && !WEAK.has(jwt) && !WEAK.has(jwt.toLowerCase()));
check('JWT length ≥ 32', jwt.length >= 32);

const stripeSecret = process.env.STRIPE_SECRET_KEY || '';
const stripeWh = process.env.STRIPE_WEBHOOK_SECRET || '';
check('Stripe secret available (env or Admin DB)', Boolean(stripeSecret), {
  critical: false,
  detail: 'May live only in Admin → Billing DB',
});
check('Stripe webhook secret available (env or Admin DB)', Boolean(stripeWh), {
  critical: false,
  detail: 'May live only in Admin → Billing DB',
});

const resendKey = process.env.RESEND_API_KEY || '';
const resendWh = process.env.RESEND_WEBHOOK_SECRET || '';
check('Resend API key available (env or Admin DB)', Boolean(resendKey), {
  critical: false,
  detail: 'May live only in Admin → Communications DB',
});
check('Resend webhook secret available (env or Admin DB)', Boolean(resendWh), {
  critical: false,
  detail: 'Required in production for inbound RSVP; may be Admin DB only',
});

const intervalRaw = process.env.V2_OVERAGE_SETTLEMENT_INTERVAL_MS;
const isProdLike =
  process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'staging';
const intervalMs =
  intervalRaw !== undefined && intervalRaw !== ''
    ? Number(intervalRaw)
    : isProdLike
      ? 3600000
      : 0;
check(
  'Overage settlement scheduler enabled',
  intervalMs > 0,
  {
    critical: isProdLike,
    detail: intervalMs > 0 ? `${intervalMs}ms` : 'set V2_OVERAGE_SETTLEMENT_INTERVAL_MS or APP_ENV=staging',
  }
);

check('LIVEKIT_URL set', Boolean(process.env.LIVEKIT_URL));
check('LIVEKIT_API_KEY set', Boolean(process.env.LIVEKIT_API_KEY));
check('LIVEKIT_API_SECRET set', Boolean(process.env.LIVEKIT_API_SECRET));
check(
  'LIVEKIT_URL looks like staging (heuristic)',
  !/livekit\.cloud$/i.test(String(process.env.LIVEKIT_URL || '')) ||
    /staging|test|dev/i.test(String(process.env.LIVEKIT_URL || '')),
  {
    critical: false,
    detail: 'Confirm staging uses a separate LiveKit project from production',
  }
);

console.log('Preprod env check\n');
let failedCritical = 0;
for (const r of rows) {
  const mark = r.ok ? 'OK  ' : r.critical ? 'FAIL' : 'WARN';
  if (!r.ok && r.critical) failedCritical += 1;
  console.log(`[${mark}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}

console.log(
  `\n${failedCritical ? 'CRITICAL GATES FAILED' : 'Critical gates passed'} (${rows.filter((r) => r.ok).length}/${rows.length} checks ok)`
);
process.exit(failedCritical ? 1 : 0);
