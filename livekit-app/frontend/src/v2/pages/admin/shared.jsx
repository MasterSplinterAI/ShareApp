import { cn } from '../../../lib/utils';
import { Badge } from '../../../components/ui/badge';

export function statusBadgeVariant(status) {
  switch (status) {
    case 'live':
      return 'success';
    case 'scheduled':
      return 'info';
    case 'ended':
    case 'archived':
      return 'muted';
    default:
      return 'outline';
  }
}

const MIX_COLORS = ['bg-primary', 'bg-sky-500', 'bg-amber-500', 'bg-emerald-500', 'bg-rose-500', 'bg-violet-500'];

export function MixBar({ title, items, labelKey, countKey }) {
  const rows = (items || []).filter((i) => Number(i[countKey]) > 0);
  const total = rows.reduce((sum, i) => sum + Number(i[countKey] || 0), 0);
  if (!total) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full">
        {rows.map((r, i) => (
          <div
            key={r[labelKey] ?? i}
            className={MIX_COLORS[i % MIX_COLORS.length]}
            style={{ width: `${(Number(r[countKey]) / total) * 100}%` }}
            title={`${r[labelKey] || '(none)'}: ${r[countKey]}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {rows.map((r, i) => (
          <span key={r[labelKey] ?? i} className="inline-flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', MIX_COLORS[i % MIX_COLORS.length])} />
            {r[labelKey] || '(none)'}
            <span className="tabular-nums text-muted-foreground">{r[countKey]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function fillDailySeries(rows, days, valueKey) {
  const byDay = new Map((rows || []).map((r) => [r.day, Number(r[valueKey]) || 0]));
  const series = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now - i * 86400000).toISOString().slice(0, 10);
    series.push({ day, value: byDay.get(day) || 0 });
  }
  return series;
}

export function DayBarChart({ rows, days, valueKey, unit }) {
  const series = fillDailySeries(rows, days, valueKey);
  const max = Math.max(...series.map((s) => s.value), 1);
  const labelEvery = Math.max(1, Math.ceil(series.length / 6));
  return (
    <div>
      <div className="flex h-28 items-end gap-px">
        {series.map((s) => (
          <div
            key={s.day}
            className={cn('min-w-0 flex-1 rounded-t-sm', s.value > 0 ? 'bg-primary/70 hover:bg-primary' : 'bg-muted')}
            style={{ height: `${s.value > 0 ? Math.max((s.value / max) * 100, 4) : 2}%` }}
            title={`${s.day}: ${Math.round(s.value).toLocaleString()}${unit ? ` ${unit}` : ''}`}
          />
        ))}
      </div>
      <div className="mt-1 flex gap-px text-[9px] text-muted-foreground">
        {series.map((s, i) => (
          <div key={s.day} className="min-w-0 flex-1">
            {i % labelEvery === 0 ? <span className="whitespace-nowrap">{s.day.slice(5)}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PrettyJson({ value }) {
  let text = value || '';
  try {
    text = JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    /* raw */
  }
  return <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted/40 p-2 text-xs">{text}</pre>;
}

export function SuspendedBadge() {
  return (
    <Badge variant="destructive" className="text-[10px]">
      Suspended
    </Badge>
  );
}

export function DisabledBadge() {
  return (
    <Badge variant="destructive" className="text-[10px]">
      Disabled
    </Badge>
  );
}
