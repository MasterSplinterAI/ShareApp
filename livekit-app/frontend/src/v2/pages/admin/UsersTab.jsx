import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { v2Admin } from '../../../services/apiV2';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { cn } from '../../../lib/utils';
import { fmtDateTime, fmtMins } from './formatters';
import { SuspendedBadge, DisabledBadge } from './shared';
import { AuditReasonField } from './AuditReasonField';
import { useAuditReason, orgKey } from './useAuditReason';

function matchesQuery(u, q) {
  if (!q) return true;
  return [u.email, u.display_name, u.org_name].some((v) => (v || '').toLowerCase().includes(q));
}

export function UsersTab({ users = [], onReload, onSelectOrg }) {
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const { auditReason, auditReasonError, auditInputRef, updateAuditReason, requireAuditReason } =
    useAuditReason(selectedUserId);

  const loadDetail = (userId) =>
    v2Admin
      .userDetail(userId)
      .then(setDetail)
      .catch(() => toast.error('Failed to load user detail'));

  useEffect(() => {
    if (!selectedUserId) {
      setDetail(null);
      return;
    }
    setDetail(null);
    loadDetail(selectedUserId);
  }, [selectedUserId]);

  const runAction = async (label, fn) => {
    const reason = requireAuditReason(selectedUserId);
    if (!reason) return;
    setBusy(true);
    try {
      await fn(reason);
      toast.success(label);
      await loadDetail(selectedUserId);
      onReload?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const isDisabled = Boolean(detail?.user?.disabled_at);
  const q = search.trim().toLowerCase();

  return (
    <div className="space-y-4">
      <Card className="app-card overflow-hidden border-border/60">
        <CardHeader>
          <CardTitle className="text-lg">Users</CardTitle>
          <CardDescription>
            Every registered user. Click a row to open support actions (disable/enable, password reset).
          </CardDescription>
          <Input
            aria-label="Search users"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
                <th className="px-4 py-3 font-medium">Workspace</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium" title="Org participant-minutes this month">
                  Part.-min (month)
                </th>
                <th className="px-4 py-3 font-medium">Signed up</th>
              </tr>
            </thead>
            <tbody>
              {users.filter((u) => matchesQuery(u, q)).map((u) => (
                <tr
                  key={u.id}
                  className={cn(
                    'cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/30',
                    selectedUserId === u.id && 'bg-primary/5'
                  )}
                  onClick={() => setSelectedUserId(u.id)}
                >
                  <td className="px-4 py-3 font-medium">
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {u.email}
                      {u.disabled_at && <DisabledBadge />}
                      {u.org_suspended_at && <SuspendedBadge />}
                    </span>
                  </td>
                  <td className="px-4 py-3">{u.display_name || '—'}</td>
                  <td className="px-4 py-3">
                    {u.org_name ? (
                      u.org_account_type === 'personal' ? u.display_name || u.org_name : u.org_name
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
                  <td className="px-4 py-3 text-muted-foreground">{(u.created_at || '').slice(0, 10)}</td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={7}>
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {selectedUserId && detail && (
        <Card key={orgKey(selectedUserId)} className="app-card border-primary/30">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {detail.user?.email}
              {isDisabled && <DisabledBadge />}
              {detail.membership?.suspended_at && <SuspendedBadge />}
            </CardTitle>
            <CardDescription>
              {detail.user?.display_name || 'No display name'} · Signed up{' '}
              {(detail.user?.created_at || '').slice(0, 10)} · Last login{' '}
              {detail.user?.last_login_at ? fmtDateTime(detail.user.last_login_at) : 'never'}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm lg:col-span-2">
              <h3 className="font-medium">Membership</h3>
              {detail.membership?.org_id ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <div className="text-xs text-muted-foreground">Organization</div>
                    <button
                      type="button"
                      className="text-left font-medium text-primary hover:underline"
                      onClick={() => onSelectOrg?.(detail.membership.org_id)}
                    >
                      {detail.membership.org_name || detail.membership.org_id}
                    </button>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Role</div>
                    <div>{detail.membership.role || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Plan</div>
                    <div>
                      {detail.membership.plan_id || '—'}
                      {detail.membership.is_comp === 1 ? ' (comp)' : ''}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Billing status</div>
                    <div>{detail.membership.billing_status || '—'}</div>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">No organization membership.</p>
              )}
              {detail.usageThisMonth != null && (
                <p className="text-xs text-muted-foreground">
                  Org usage this month: {fmtMins(detail.usageThisMonth.meetingMinutes ?? detail.usageThisMonth)}
                </p>
              )}
              {detail.communicationPrefs && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Marketing email:</span>
                  {detail.communicationPrefs.marketingEmail ? (
                    <Badge className="bg-emerald-600 hover:bg-emerald-600">Opted in</Badge>
                  ) : (
                    <Badge variant="secondary">Opted out</Badge>
                  )}
                  {detail.communicationPrefs.prefsUpdatedAt && (
                    <span className="text-muted-foreground">
                      · Updated {fmtDateTime(detail.communicationPrefs.prefsUpdatedAt)}
                    </span>
                  )}
                </div>
              )}
            </div>

            {detail.recentMeetings?.length > 0 && (
              <div className="rounded-lg border border-border/60 p-4 lg:col-span-2">
                <h3 className="font-medium mb-2">Recent meetings</h3>
                <ul className="text-xs space-y-1 max-h-40 overflow-y-auto">
                  {detail.recentMeetings.map((m) => (
                    <li key={m.id} className="flex justify-between gap-2">
                      <span className="truncate">{m.title || m.id.slice(0, 8)}</span>
                      <span className="text-muted-foreground shrink-0">
                        {m.status} · {(m.created_at || '').slice(0, 10)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="lg:col-span-2">
              <AuditReasonField
                auditKey={selectedUserId}
                value={auditReason[orgKey(selectedUserId)] ?? ''}
                onChange={(v) => updateAuditReason(selectedUserId, v)}
                error={auditReasonError}
                inputRef={auditInputRef}
                label="Audit reason"
              />
            </div>

            <div className="flex flex-wrap gap-2 lg:col-span-2">
              {isDisabled ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    runAction('User enabled', (reason) => v2Admin.enableUser(selectedUserId, { reason }))
                  }
                >
                  Enable user
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    runAction('User disabled', (reason) => v2Admin.disableUser(selectedUserId, { reason }))
                  }
                >
                  Disable user
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  runAction('Password reset sent', (reason) =>
                    v2Admin.sendPasswordReset(selectedUserId, { reason })
                  )
                }
              >
                Send password reset
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default UsersTab;
