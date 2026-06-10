import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { v2Admin, v2Orgs } from '../../services/apiV2';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Badge } from '../../components/ui/badge';
import { cn } from '../../lib/utils';

const COMP_LABELS = ['personal', 'friend', 'promo', 'internal'];
const AUDIT_STORAGE_PREFIX = 'v2-superadmin-audit-reason';

function orgKey(orgId) {
  return String(orgId ?? '');
}

function loadStoredAuditReason(orgId) {
  try {
    return sessionStorage.getItem(`${AUDIT_STORAGE_PREFIX}:${orgKey(orgId)}`) || '';
  } catch {
    return '';
  }
}

function persistAuditReason(orgId, value) {
  try {
    const key = `${AUDIT_STORAGE_PREFIX}:${orgKey(orgId)}`;
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* ignore quota / private mode */
  }
}

function fmtUsd(n) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
}

function fmtCents(c) {
  return fmtUsd(Number(c) / 100);
}

function fmtMins(n) {
  const v = Number(n) || 0;
  return `${Math.round(v).toLocaleString()} participant-min`;
}

function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? String(s).slice(0, 16) : d.toLocaleString();
}

/** Consistent status colors, aligned with the workspace meeting badges. */
function statusBadgeVariant(status) {
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

/** Compact horizontal stacked bar + legend for plan / billing-status mixes. */
function MixBar({ title, items, labelKey, countKey }) {
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

/** Pure CSS daily bar chart (no chart library) — bar heights scaled to the series max. */
function DayBarChart({ rows, days, valueKey, unit }) {
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

function PrettyJson({ value }) {
  let text = value || '';
  try {
    text = JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    /* show raw string */
  }
  return <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted/40 p-2 text-xs">{text}</pre>;
}

function TrendsTab() {
  const [days, setDays] = useState(30);
  const [trends, setTrends] = useState(null);

  useEffect(() => {
    v2Admin
      .trends(days)
      .then(setTrends)
      .catch(() => toast.error('Failed to load trends'));
  }, [days]);

  const charts = [
    { title: 'Signups per day', rows: trends?.signupsByDay, valueKey: 'count', unit: 'signups' },
    { title: 'Meetings created per day', rows: trends?.meetingsByDay, valueKey: 'count', unit: 'meetings' },
    { title: 'Participant-minutes per day', rows: trends?.minutesByDay, valueKey: 'minutes', unit: 'min' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Window:</span>
        <select
          aria-label="Trends time window"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {charts.map((c) => (
          <Card key={c.title} className="app-card border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{c.title}</CardTitle>
            </CardHeader>
            <CardContent>
              {trends ? (
                <DayBarChart rows={c.rows} days={days} valueKey={c.valueKey} unit={c.unit} />
              ) : (
                <p className="text-sm text-muted-foreground">Loading…</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function meetingDurationLabel(m) {
  if (m.duration_seconds != null) return `${Math.max(1, Math.round(m.duration_seconds / 60))} min`;
  if (m.started_at && m.ended_at) {
    const ms =
      new Date(`${m.ended_at.replace(' ', 'T')}Z`).getTime() - new Date(`${m.started_at.replace(' ', 'T')}Z`).getTime();
    if (ms > 0) return `~${Math.round(ms / 60000)} min`;
  }
  if (Number(m.participant_minutes) > 0) return `~${Math.round(m.participant_minutes)} part.-min`;
  return '—';
}

/** Per-meeting cost breakdown — where Gladia-vs-Deepgram (etc.) economics show. */
function MeetingCostsPanel({ meeting, detail }) {
  return (
    <Card className="app-card border-primary/30">
      <CardHeader>
        <CardTitle className="text-lg">{meeting.title || meeting.livekit_room_name || meeting.id}</CardTitle>
        <CardDescription>
          Cost events for this meeting (room <code>{meeting.livekit_room_name}</code>).
          {detail?.rollup && (
            <span className="block mt-1">
              Rollup total <strong className="tabular-nums">{fmtUsd(detail.rollup.total_cost_usd)}</strong>
              {detail.rollup.duration_seconds != null &&
                ` over ${Math.max(1, Math.round(detail.rollup.duration_seconds / 60))} min`}
              {detail.rollup.computed_at && ` — computed ${fmtDateTime(detail.rollup.computed_at)}`}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      {!detail ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading cost events…</p>
        </CardContent>
      ) : detail.events.length === 0 ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">No cost events recorded for this meeting.</p>
        </CardContent>
      ) : (
        <div className="overflow-x-auto border-t border-border/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Participant</th>
                <th className="px-4 py-3 font-medium">Units</th>
                <th className="px-4 py-3 font-medium">Unit cost</th>
                <th className="px-4 py-3 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {detail.events.map((ev) => (
                <tr key={ev.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDateTime(ev.created_at)}
                  </td>
                  <td className="px-4 py-2">{ev.event_type}</td>
                  <td className="px-4 py-2">
                    <Badge variant="outline">{ev.provider}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs">{ev.participant || '—'}</td>
                  <td className="px-4 py-2 tabular-nums">{Number(ev.units).toLocaleString()}</td>
                  <td className="px-4 py-2 tabular-nums">${Number(ev.unit_cost_usd || 0).toFixed(6)}</td>
                  <td className="px-4 py-2 tabular-nums">${Number(ev.total_cost_usd || 0).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/20 font-medium">
                <td className="px-4 py-2" colSpan={6}>
                  Sum of events
                </td>
                <td className="px-4 py-2 tabular-nums">
                  ${detail.events.reduce((s, ev) => s + Number(ev.total_cost_usd || 0), 0).toFixed(4)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

function MeetingsTab({ orgs }) {
  const [meetings, setMeetings] = useState([]);
  const [orgFilter, setOrgFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [costDetail, setCostDetail] = useState(null);

  useEffect(() => {
    const params = { limit: 100 };
    if (orgFilter) params.org_id = orgFilter;
    v2Admin
      .meetings(params)
      .then((r) => setMeetings(r.meetings || []))
      .catch(() => toast.error('Failed to load meetings'));
  }, [orgFilter]);

  useEffect(() => {
    if (!selected) {
      setCostDetail(null);
      return;
    }
    setCostDetail(null);
    v2Admin
      .meetingCosts(selected.id)
      .then(setCostDetail)
      .catch(() => toast.error('Failed to load meeting costs'));
  }, [selected]);

  return (
    <div className="space-y-4">
      <Card className="app-card overflow-hidden border-border/60">
        <CardHeader>
          <CardTitle className="text-lg">Meetings</CardTitle>
          <CardDescription>
            Latest 100 meetings across all organizations. Click a row for its per-meeting cost breakdown.
          </CardDescription>
          <select
            aria-label="Filter meetings by organization"
            className="mt-2 h-9 max-w-sm rounded-md border border-input bg-background px-2 text-sm"
            value={orgFilter}
            onChange={(e) => {
              setOrgFilter(e.target.value);
              setSelected(null);
            }}
          >
            <option value="">All organizations</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </CardHeader>
        <div className="overflow-x-auto border-t border-border/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Organization</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Scheduled</th>
                <th className="px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3 font-medium">Infra cost</th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((m) => (
                <tr
                  key={m.id}
                  className={cn(
                    'cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/30',
                    selected?.id === m.id && 'bg-primary/5'
                  )}
                  onClick={() => setSelected(m)}
                >
                  <td className="px-4 py-3 font-medium">{m.title || m.livekit_room_name || m.id.slice(0, 8)}</td>
                  <td className="px-4 py-3">{m.org_name || '—'}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusBadgeVariant(m.status)}>{m.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{(m.created_at || '').slice(0, 16)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{(m.scheduled_start || '').slice(0, 16) || '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{meetingDurationLabel(m)}</td>
                  <td className="px-4 py-3 tabular-nums">{m.total_cost_usd != null ? fmtUsd(m.total_cost_usd) : '—'}</td>
                </tr>
              ))}
              {meetings.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={7}>
                    No meetings found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {selected && <MeetingCostsPanel meeting={selected} detail={costDetail} />}
    </div>
  );
}

function GuestsTab() {
  const [data, setData] = useState(null);

  useEffect(() => {
    v2Admin
      .guests(30)
      .then(setData)
      .catch(() => toast.error('Failed to load guest ledger'));
  }, []);

  return (
    <Card className="app-card overflow-hidden border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">Participant ledger (30 days)</CardTitle>
        <CardDescription>{data?.notes || 'Join/leave activity from LiveKit lifecycle webhooks.'}</CardDescription>
      </CardHeader>
      <div className="overflow-x-auto border-t border-border/60">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/30 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Identity</th>
              <th className="px-4 py-3 font-medium">Room</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium">Left</th>
              <th className="px-4 py-3 font-medium">Duration</th>
            </tr>
          </thead>
          <tbody>
            {(data?.participants || []).map((p, i) => (
              <tr key={`${p.room}-${p.identity}-${p.joined_at}-${i}`} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 font-medium">{p.name || '—'}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{p.identity || '—'}</td>
                <td className="px-4 py-3 text-xs">{p.room}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDateTime(p.joined_at)}</td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                  {p.left_at ? fmtDateTime(p.left_at) : 'still in / unknown'}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {p.duration_minutes != null ? `${p.duration_minutes} min` : '—'}
                </td>
              </tr>
            ))}
            {data && (data.participants || []).length === 0 && (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={6}>
                  No participant activity in the window.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AuditTab() {
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    v2Admin
      .audit()
      .then((r) => setEntries(r.entries || []))
      .catch(() => toast.error('Failed to load audit log'));
  }, []);

  return (
    <Card className="app-card overflow-hidden border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">Admin audit log</CardTitle>
        <CardDescription>Last 100 superadmin actions (plan/comp/billing changes etc.).</CardDescription>
      </CardHeader>
      <div className="overflow-x-auto border-t border-border/60">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/30 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Payload</th>
              <th className="px-4 py-3 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-border/60 last:border-0 align-top">
                <td className="px-4 py-3 font-medium">{e.actor_email}</td>
                <td className="px-4 py-3">
                  <Badge variant="outline">{e.action}</Badge>
                </td>
                <td className="px-4 py-3">
                  {e.payload_json ? (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground">view payload</summary>
                      <PrettyJson value={e.payload_json} />
                    </details>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{(e.created_at || '').slice(0, 19)}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={4}>
                  No audit entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Stripe webhook ingestion health — rendered inside the Costs tab. */
function BillingHealthPanel() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    v2Admin
      .webhooks(50)
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null;

  return (
    <Card className="app-card overflow-hidden border-border/60">
      <CardHeader>
        <CardTitle className="text-lg">Billing health (webhooks)</CardTitle>
        <CardDescription>
          {data
            ? `${data.totals.total} events received all-time, ${data.totals.unprocessed} unprocessed. ${data.notes || ''}`
            : 'Loading webhook events…'}
        </CardDescription>
      </CardHeader>
      {data && (
        <div className="overflow-x-auto border-t border-border/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Received</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((ev) => (
                <tr key={ev.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3">{ev.provider}</td>
                  <td className="px-4 py-3 font-medium">{ev.type}</td>
                  <td className="px-4 py-3">
                    {ev.processed ? (
                      <Badge variant="secondary">processed</Badge>
                    ) : (
                      <Badge variant="destructive">unprocessed</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {(ev.received_at || '').slice(0, 19)}
                  </td>
                </tr>
              ))}
              {data.events.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={4}>
                    No webhook events recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function V2SuperAdmin() {
  const [allowed, setAllowed] = useState(null);
  const [tab, setTab] = useState('orgs');
  const [orgs, setOrgs] = useState([]);
  const [users, setUsers] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [kpis, setKpis] = useState(null);
  const [costs, setCosts] = useState(null);
  const [costsLoadedAt, setCostsLoadedAt] = useState(null);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [orgDetail, setOrgDetail] = useState(null);
  const [billingEdit, setBillingEdit] = useState({});
  const [auditReason, setAuditReason] = useState({});
  const [auditReasonError, setAuditReasonError] = useState(null);
  const [planEdit, setPlanEdit] = useState({});
  const [compEdit, setCompEdit] = useState({});
  const [compLabel, setCompLabel] = useState({});
  const auditInputRef = useRef(null);

  const reloadOrgs = () =>
    v2Admin.orgs().then((r) => setOrgs(r.orgs || [])).catch(() => toast.error('Failed to load orgs'));

  const reloadUsers = () =>
    v2Admin.users().then((r) => setUsers(r.users || [])).catch(() => toast.error('Failed to load users'));

  const reloadCosts = () =>
    v2Admin
      .costsSummary()
      .then((data) => {
        setCosts(data);
        setCostsLoadedAt(new Date());
      })
      .catch(() => toast.error('Failed to load costs'));

  const reloadKpis = () => v2Orgs.adminKpis().then(setKpis).catch(() => {});

  const refreshAdminData = () => {
    reloadKpis();
    reloadOrgs();
    reloadCosts();
    if (selectedOrg) {
      v2Admin.orgDetail(selectedOrg).then(setOrgDetail).catch(() => {});
    }
  };

  useEffect(() => {
    v2Orgs.adminPing().then(() => setAllowed(true)).catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    if (!allowed) return;
    reloadKpis();
    reloadOrgs();
    reloadCosts();
  }, [allowed]);

  useEffect(() => {
    if (tab === 'costs' && allowed) reloadCosts();
    if (tab === 'users' && allowed) reloadUsers();
  }, [tab, allowed]);

  useEffect(() => {
    if (!selectedOrg) {
      setOrgDetail(null);
      return;
    }
    setOrgDetail(null);
    v2Admin
      .orgDetail(selectedOrg)
      .then(setOrgDetail)
      .catch(() => toast.error('Failed to load org detail'));
  }, [selectedOrg]);

  useEffect(() => {
    if (!selectedOrg) return;
    const key = orgKey(selectedOrg);
    setAuditReason((prev) => {
      if (prev[key]) return prev;
      const stored = loadStoredAuditReason(key);
      return stored ? { ...prev, [key]: stored } : prev;
    });
  }, [selectedOrg]);

  const readAuditReasonFromDom = (orgId) => {
    const el = document.getElementById(`audit-reason-${orgKey(orgId)}`);
    return (el?.value || '').trim();
  };

  const getAuditReason = (orgId) => {
    const key = orgKey(orgId);
    const fromState = (auditReason[key] || '').trim();
    const fromDom = readAuditReasonFromDom(orgId);
    return fromDom || fromState;
  };

  const focusAuditReason = (orgId) => {
    const key = orgKey(orgId);
    setAuditReasonError(key);
    const el = auditInputRef.current || document.getElementById(`audit-reason-${key}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus({ preventScroll: true });
  };

  const requireAuditReason = (orgId) => {
    const reason = getAuditReason(orgId);
    if (reason.length >= 4) {
      setAuditReasonError(null);
      return reason;
    }
    focusAuditReason(orgId);
    toast.error('Enter an audit reason above (at least 4 characters).');
    return null;
  };

  const updateAuditReason = (orgId, value) => {
    const key = orgKey(orgId);
    setAuditReason((prev) => ({ ...prev, [key]: value }));
    persistAuditReason(key, value);
    if (auditReasonError === key) setAuditReasonError(null);
  };

  const saveBilling = async (orgId) => {
    const status = billingEdit[orgKey(orgId)];
    if (!status) return;
    const reason = requireAuditReason(orgId);
    if (!reason) return;
    try {
      await v2Orgs.adminPatchOrg(orgId, { billing_status: status, reason });
      toast.success('Billing status updated');
      reloadOrgs();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Update failed');
    }
  };

  const savePlan = async (orgId) => {
    const key = orgKey(orgId);
    const plan_id = planEdit[key] ?? orgDetail?.subscription?.plan_id;
    const reason = requireAuditReason(orgId);
    if (!plan_id) {
      toast.error('Pick a plan first.');
      return;
    }
    if (!reason) return;
    try {
      await v2Admin.setPlan(orgId, { plan_id, reason });
      toast.success('Plan updated');
      reloadOrgs();
      reloadCosts();
      reloadKpis();
      if (selectedOrg === orgId) v2Admin.orgDetail(orgId).then(setOrgDetail);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  };

  const saveComp = async (orgId) => {
    const key = orgKey(orgId);
    const reason = requireAuditReason(orgId);
    if (!reason) return;
    const isComp = compEdit[key] ?? orgDetail?.subscription?.is_comp === 1;
    try {
      await v2Admin.setComp(orgId, {
        is_comp: Boolean(isComp),
        comp_label: compLabel[key] ?? orgDetail?.subscription?.comp_label ?? 'personal',
        reason,
      });
      toast.success('Comp override saved');
      persistAuditReason(key, '');
      setAuditReason((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      reloadOrgs();
      reloadCosts();
      reloadKpis();
      if (selectedOrg === orgId) v2Admin.orgDetail(orgId).then(setOrgDetail);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed');
    }
  };

  if (allowed === null) {
    return <p className="text-sm text-muted-foreground">Checking access…</p>;
  }
  if (!allowed) {
    return (
      <Card className="max-w-xl border-border/80">
        <CardHeader>
          <CardTitle>Restricted</CardTitle>
          <CardDescription>
            Platform admin requires your email in server env <code>V2_SUPERADMIN_EMAILS</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <Link to="/v2/app">← Workspace</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/v2/app" className="text-sm font-medium text-primary hover:underline">
        ← Workspace
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Parley admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organizations are the billing unit — select one to see members, usage, and comp/plan controls.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={refreshAdminData}>
          Refresh data
        </Button>
      </div>

      <Card className="app-card border-border/60 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Instance KPIs</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Organizations</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{kpis?.orgCount ?? '—'}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Est. MRR</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {kpis?.estimatedMrrCents != null ? fmtCents(kpis.estimatedMrrCents) : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">MTD infra cost</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{fmtUsd(costs?.totals?.total_cost_usd)}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Accounts</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{kpis?.userCount ?? '—'}</div>
            <div className="text-xs text-muted-foreground">Login identities (nested under orgs)</div>
          </div>
          {(kpis?.planMix?.length > 0 || kpis?.billingStatusMix?.length > 0) && (
            <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-4">
              <MixBar title="Plan mix" items={kpis?.planMix} labelKey="plan_id" countKey="org_count" />
              <MixBar title="Billing status mix" items={kpis?.billingStatusMix} labelKey="billing_status" countKey="c" />
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="orgs">Organizations</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="meetings">Meetings</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="costs">Costs & margin</TabsTrigger>
          <TabsTrigger value="guests">Guests</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4 space-y-4">
          <Card className="app-card overflow-hidden border-border/60">
            <CardHeader>
              <CardTitle className="text-lg">Users</CardTitle>
              <CardDescription>
                Every login identity, including people who signed up without a company name (their
                workspace is auto-named “their-email&apos;s org”). Click a row to open the workspace.
              </CardDescription>
              <Input
                aria-label="Search users"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search by email, name, or organization…"
                className="mt-2 max-w-sm"
              />
            </CardHeader>
            <div className="overflow-x-auto border-t border-border/60">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Organization</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Plan</th>
                    <th className="px-4 py-3 font-medium" title="Org participant-minutes this month">
                      Part.-min (month)
                    </th>
                    <th className="px-4 py-3 font-medium">Signed up</th>
                  </tr>
                </thead>
                <tbody>
                  {users
                    .filter((u) => {
                      const q = userSearch.trim().toLowerCase();
                      if (!q) return true;
                      return [u.email, u.display_name, u.org_name]
                        .some((v) => (v || '').toLowerCase().includes(q));
                    })
                    .map((u) => {
                      const autoNamed =
                        u.org_name && u.email && u.org_name === `${u.email.split('@')[0]}'s org`;
                      return (
                        <tr
                          key={u.id}
                          className={`border-b border-border/60 last:border-0 ${u.org_id ? 'cursor-pointer hover:bg-muted/30' : 'bg-destructive/5'}`}
                          onClick={() => {
                            if (u.org_id) {
                              setTab('orgs');
                              setSelectedOrg(u.org_id);
                            }
                          }}
                        >
                          <td className="px-4 py-3 font-medium">{u.email}</td>
                          <td className="px-4 py-3">{u.display_name || '—'}</td>
                          <td className="px-4 py-3">
                            {u.org_name ? (
                              <span className="inline-flex items-center gap-1.5">
                                {u.org_name}
                                {autoNamed && (
                                  <Badge variant="outline" className="text-[10px]">
                                    no company name
                                  </Badge>
                                )}
                              </span>
                            ) : (
                              <Badge variant="destructive">no org — broken signup</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3">{u.role || '—'}</td>
                          <td className="px-4 py-3">
                            {u.plan_id || '—'}
                            {u.is_comp === 1 ? ' (comp)' : ''}
                          </td>
                          <td className="px-4 py-3 tabular-nums">{Math.round(u.mtd_meeting_minutes || 0)}</td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {(u.created_at || '').slice(0, 10)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="orgs" className="mt-4 space-y-4">
          <Card className="app-card overflow-hidden border-border/60">
            <CardHeader>
              <CardTitle className="text-lg">Organizations</CardTitle>
              <CardDescription>
                {orgs.length} workspaces — click a row for usage analytics and comp/plan controls. Participant-min =
                each person-minute in a meeting (2 people × 30 min = 60).
              </CardDescription>
            </CardHeader>
            <div className="overflow-x-auto border-t border-border/60">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Organization</th>
                    <th className="px-4 py-3 font-medium">Plan</th>
                    <th className="px-4 py-3 font-medium">Comp</th>
                    <th className="px-4 py-3 font-medium" title="Participant-minutes this calendar month">
                      Part.-min (month)
                    </th>
                    <th className="px-4 py-3 font-medium" title="Estimated infra cost for meetings ended this month">
                      Infra cost (month)
                    </th>
                    <th className="px-4 py-3 font-medium">Members</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((o) => (
                    <tr
                      key={o.id}
                      className={`cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/30 ${selectedOrg === o.id ? 'bg-primary/5' : ''}`}
                      onClick={() => setSelectedOrg(o.id)}
                    >
                      <td className="px-4 py-3 font-medium">{o.name}</td>
                      <td className="px-4 py-3">{o.plan_id || '—'}</td>
                      <td className="px-4 py-3">
                        {o.is_comp === 1 ? (
                          <Badge variant="secondary">{o.comp_label || 'comp'}</Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{Math.round(o.mtd_meeting_minutes || 0)}</td>
                      <td className="px-4 py-3 tabular-nums">{fmtUsd(o.mtd_cost_usd)}</td>
                      <td className="px-4 py-3">{o.member_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {selectedOrg && orgDetail && (
            <Card key={orgKey(selectedOrg)} className="app-card border-primary/30">
              <CardHeader>
                <CardTitle>{orgDetail.org?.name}</CardTitle>
                <CardDescription>Org ID: {orgKey(selectedOrg)}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 lg:grid-cols-2">
                {orgDetail.usageAnalytics && (
                  <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4 lg:col-span-2">
                    <div>
                      <h3 className="font-medium">Usage analytics</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Billing meter: participant-minutes (people × minutes in meetings).{' '}
                        {orgDetail.usageAnalytics.periodLabel}. Infra cost is a separate estimate from completed
                        rooms.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                      <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                        <div className="text-xs text-muted-foreground">This month</div>
                        <div className="font-semibold tabular-nums">
                          {fmtMins(orgDetail.usageAnalytics.monthToDate?.meetingMinutes)}
                        </div>
                        {orgDetail.subscription?.included_meeting_minutes != null &&
                          orgDetail.subscription?.is_comp !== 1 && (
                            <div className="text-xs text-muted-foreground">
                              of {orgDetail.subscription.included_meeting_minutes.toLocaleString()} included
                            </div>
                          )}
                      </div>
                      <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                        <div className="text-xs text-muted-foreground">All time</div>
                        <div className="font-semibold tabular-nums">
                          {fmtMins(orgDetail.usageAnalytics.allTime?.meetingMinutes)}
                        </div>
                      </div>
                      <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                        <div className="text-xs text-muted-foreground">Translation (month)</div>
                        <div className="font-semibold tabular-nums">
                          {Math.round(orgDetail.usageAnalytics.monthToDate?.translationMinutes || 0).toLocaleString()}{' '}
                          min
                        </div>
                      </div>
                      <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                        <div className="text-xs text-muted-foreground">Infra cost (month)</div>
                        <div className="font-semibold tabular-nums">{fmtUsd(orgDetail.costThisMonthUsd)}</div>
                      </div>
                    </div>
                    {(orgDetail.usageAnalytics.byDay?.length > 0 ||
                      orgDetail.usageAnalytics.byMeeting?.length > 0) && (
                      <div className="grid gap-4 lg:grid-cols-2">
                        {orgDetail.usageAnalytics.byDay?.length > 0 && (
                          <div>
                            <div className="text-xs font-medium text-muted-foreground mb-1">By day (this month)</div>
                            <ul className="text-xs space-y-0.5 max-h-32 overflow-y-auto">
                              {orgDetail.usageAnalytics.byDay.map((row) => (
                                <li key={row.day} className="flex justify-between gap-2 tabular-nums">
                                  <span>{row.day}</span>
                                  <span>{Math.round(row.meeting_minutes)} min</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {orgDetail.usageAnalytics.byMeeting?.length > 0 && (
                          <div>
                            <div className="text-xs font-medium text-muted-foreground mb-1">
                              By meeting (this month)
                            </div>
                            <ul className="text-xs space-y-0.5 max-h-32 overflow-y-auto">
                              {orgDetail.usageAnalytics.byMeeting.map((row) => (
                                <li key={row.meeting_id || row.title} className="flex justify-between gap-2">
                                  <span className="truncate">{row.title || row.meeting_id?.slice(0, 8) || '—'}</span>
                                  <span className="tabular-nums shrink-0">{Math.round(row.meeting_minutes)} min</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {orgDetail.members?.length > 0 && (
                  <div className="rounded-lg border border-border/60 p-4 lg:col-span-2">
                    <h3 className="font-medium mb-2">Members</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="text-xs text-muted-foreground">
                          <tr>
                            <th className="pb-2 font-medium">Email</th>
                            <th className="pb-2 font-medium">Role</th>
                            <th className="pb-2 font-medium">Joined</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orgDetail.members.map((m) => (
                            <tr key={m.id} className="border-t border-border/40">
                              <td className="py-2">{m.email}</td>
                              <td className="py-2">{m.role}</td>
                              <td className="py-2 text-muted-foreground text-xs">{m.created_at?.slice(0, 10) || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4 lg:col-span-2">
                  <label htmlFor={`audit-reason-${orgKey(selectedOrg)}`} className="text-sm font-medium">
                    Audit reason <span className="text-destructive">*</span>
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Required before saving comp, plan, or billing changes. Use at least 4 characters.
                  </p>
                  <Input
                    ref={auditInputRef}
                    id={`audit-reason-${orgKey(selectedOrg)}`}
                    type="text"
                    autoComplete="off"
                    placeholder="e.g. Founder account — unlimited access"
                    value={auditReason[orgKey(selectedOrg)] ?? ''}
                    onChange={(e) => updateAuditReason(selectedOrg, e.target.value)}
                    className={cn(
                      auditReasonError === orgKey(selectedOrg) &&
                        'border-destructive focus-visible:ring-destructive aria-invalid:border-destructive'
                    )}
                    aria-invalid={auditReasonError === orgKey(selectedOrg)}
                  />
                </div>
                <div className="space-y-3 rounded-lg border border-border/60 p-4">
                  <h3 className="font-medium">Comp / unlimited access</h3>
                  <p className="text-xs text-muted-foreground">
                    Toggle unlimited access for personal, friend, or promo accounts. Bypasses all usage caps.
                    Fill the audit reason above before saving.
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(compEdit[orgKey(selectedOrg)] ?? orgDetail.subscription?.is_comp === 1)}
                      onChange={(e) =>
                        setCompEdit((p) => ({ ...p, [orgKey(selectedOrg)]: e.target.checked }))
                      }
                    />
                    Unlimited (comp)
                  </label>
                  <select
                    aria-label="Comp label"
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={compLabel[orgKey(selectedOrg)] ?? orgDetail.subscription?.comp_label ?? 'personal'}
                    onChange={(e) =>
                      setCompLabel((p) => ({ ...p, [orgKey(selectedOrg)]: e.target.value }))
                    }
                  >
                    {COMP_LABELS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <Button type="button" size="sm" onClick={() => saveComp(selectedOrg)}>
                    Save comp override
                  </Button>
                </div>
                <div className="space-y-3 rounded-lg border border-border/60 p-4">
                  <h3 className="font-medium">Plan override</h3>
                  <select
                    aria-label="Plan override"
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={planEdit[orgKey(selectedOrg)] ?? orgDetail.subscription?.plan_id ?? 'free'}
                    onChange={(e) =>
                      setPlanEdit((p) => ({ ...p, [orgKey(selectedOrg)]: e.target.value }))
                    }
                  >
                    <option value="free">free</option>
                    <option value="starter">starter</option>
                    <option value="pro">pro</option>
                  </select>
                  <Button type="button" size="sm" onClick={() => savePlan(selectedOrg)}>
                    Set plan
                  </Button>
                  <div className="text-xs text-muted-foreground pt-2">
                    See usage analytics above for month vs all-time breakdown.
                  </div>
                </div>
                <div className="space-y-3 rounded-lg border border-border/60 p-4 lg:col-span-2">
                  <h3 className="font-medium">Billing status</h3>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      aria-label="Billing status"
                      className="max-w-[160px]"
                      defaultValue={orgDetail.org?.billing_status}
                      onChange={(e) =>
                        setBillingEdit((p) => ({ ...p, [orgKey(selectedOrg)]: e.target.value }))
                      }
                    />
                    <Button type="button" size="sm" variant="outline" onClick={() => saveBilling(selectedOrg)}>
                      Save billing status
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="meetings" className="mt-4">
          <MeetingsTab orgs={orgs} />
        </TabsContent>

        <TabsContent value="trends" className="mt-4">
          <TrendsTab />
        </TabsContent>

        <TabsContent value="guests" className="mt-4">
          <GuestsTab />
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <AuditTab />
        </TabsContent>

        <TabsContent value="costs" className="mt-4 space-y-4">
          <Card className="app-card overflow-hidden border-border/60">
            <CardHeader>
              <CardTitle className="text-lg">Costs & margin (month)</CardTitle>
              <CardDescription>
                Estimated infra cost for meetings that ended this calendar month vs plan revenue. Comp orgs
                show $0 revenue. Data refreshes when you open this tab — click Refresh if numbers look stale.
                {costsLoadedAt && (
                  <span className="block mt-1 text-xs">
                    Last loaded {costsLoadedAt.toLocaleTimeString()}
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <div className="overflow-x-auto border-t border-border/60">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Org</th>
                    <th className="px-4 py-3 font-medium">Plan</th>
                    <th className="px-4 py-3 font-medium">Revenue/mo</th>
                    <th className="px-4 py-3 font-medium">Infra cost (month)</th>
                    <th className="px-4 py-3 font-medium">Margin</th>
                    <th className="px-4 py-3 font-medium">Part.-min (month)</th>
                  </tr>
                </thead>
                <tbody>
                  {(costs?.byOrg || []).map((row) => (
                    <tr
                      key={row.org_id || row.org_name || 'unknown'}
                      className="border-b border-border/60 last:border-0 cursor-pointer hover:bg-muted/30"
                      onClick={() => {
                        if (row.org_id) {
                          setTab('orgs');
                          setSelectedOrg(row.org_id);
                        }
                      }}
                    >
                      <td className="px-4 py-3 font-medium">{row.org_name}</td>
                      <td className="px-4 py-3">
                        {row.plan_id}
                        {row.is_comp === 1 ? ' (comp)' : ''}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{fmtCents(row.revenue_cents)}</td>
                      <td className="px-4 py-3 tabular-nums">{fmtUsd(row.cost_usd)}</td>
                      <td className="px-4 py-3 tabular-nums">{fmtCents(row.margin_cents)}</td>
                      <td className="px-4 py-3 tabular-nums">{Math.round(row.mtd_minutes || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <BillingHealthPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
