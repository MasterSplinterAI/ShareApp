function meterLabel(meter) {
  return meter === 'translation' ? 'translation minutes' : 'meeting participant-minutes';
}

function renderUsageAlert({
  kind,
  meter,
  orgName,
  planName,
  used,
  included,
  hardCap,
  multiplier,
  autoChargeEffective,
}) {
  const workspace = orgName || 'your workspace';
  const plan = planName || 'your plan';
  const meterName = meterLabel(meter);
  const usedR = Math.round(Number(used) || 0);
  const includedR = Math.round(Number(included) || 0);
  const hardR = Math.round(Number(hardCap) || 0);

  let subject = `${workspace}: usage update`;
  let headline = 'Usage update';
  let body = '';

  if (kind === 'running_low') {
    subject = `${workspace}: running low on ${meterName}`;
    headline = 'Running low on included minutes';
    body = `${workspace} has used ${usedR} of ${includedR} included ${meterName} on the ${plan} this month (${Math.round((usedR / Math.max(1, includedR)) * 100)}%).`;
  } else if (kind === 'soft_overage') {
    subject = `${workspace}: soft overage started (${meterName})`;
    headline = 'You are in soft overage';
    body = `${workspace} has used all ${includedR} included ${meterName}. Meetings can continue until the hard stop at ${hardR} (${multiplier}× included). Auto-charge of soft overage is ${autoChargeEffective ? 'ON' : 'OFF'} — this does not raise your hard limit.`;
  } else if (kind === 'near_hard_cap') {
    subject = `${workspace}: approaching hard usage stop`;
    headline = 'Approaching hard stop';
    body = `${workspace} has used ${usedR} of ${hardR} ${meterName} (hard limit). New meetings may be blocked and live rooms can end when you hit the limit. Upgrade or reduce usage soon.`;
  } else if (kind === 'hard_stopped') {
    subject = `${workspace}: hard usage limit reached`;
    headline = 'Hard usage limit reached';
    body = `${workspace} has reached the hard limit (${usedR}/${hardR} ${meterName}). New meetings and joins are blocked until next month or you upgrade.`;
  } else {
    body = `${workspace} usage: ${usedR} / ${includedR} included (hard cap ${hardR}).`;
  }

  const text = [headline, '', body, '', 'Open Settings → Billing in Lalia to review usage and plans.'].join('\n');
  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
      <h2 style="margin:0 0 12px">${headline}</h2>
      <p>${body}</p>
      <p style="color:#555;font-size:14px">Open <strong>Settings → Billing</strong> in Lalia to review usage and plans.</p>
    </div>
  `;
  return { subject, text, html };
}

module.exports = { renderUsageAlert };
