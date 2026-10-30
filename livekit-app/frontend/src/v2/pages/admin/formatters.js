export function fmtUsd(n) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
}

export function fmtCents(c) {
  return fmtUsd(Number(c) / 100);
}

export function fmtMins(n) {
  const v = Number(n) || 0;
  return `${Math.round(v).toLocaleString()} participant-min`;
}

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? String(s).slice(0, 16) : d.toLocaleString();
}

export const BILLING_STATUSES = ['trial', 'active', 'past_due', 'suspended', 'canceled'];
