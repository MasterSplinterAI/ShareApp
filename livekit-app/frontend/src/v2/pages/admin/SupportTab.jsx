import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Bug, Lightbulb, MessageCircle, RefreshCw, Sparkles } from 'lucide-react';
import { v2Support } from '../../../services/apiV2';
import { ChatMessageContent } from '../../../lib/chatMarkdown';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Label } from '../../../components/ui/label';
import { Badge } from '../../../components/ui/badge';
import { cn } from '../../../lib/utils';
import { fmtDateTime } from './formatters';
import {
  actionGuideClass,
  categoryMeta,
  countByStatus,
  formatUserContext,
  getActionGuide,
  pendingProposal,
  proposalActions,
  proposalDetailFields,
  refreshIntervalMs,
  sortTickets,
  statusMeta,
} from './supportAdminUi';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'pending_review', label: 'Needs approval' },
  { value: 'ai_reviewing', label: 'AI working' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'waiting_user', label: 'Waiting on user' },
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
];

const CATEGORY_FILTERS = [
  { value: '', label: 'All types', icon: null },
  { value: 'customer_support', label: 'CS', icon: MessageCircle },
  { value: 'bug_report', label: 'Bug', icon: Bug },
  { value: 'feature_request', label: 'Feature', icon: Lightbulb },
];

function LiveDot({ active }) {
  if (!active) return null;
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
    </span>
  );
}

function ActionGuideBanner({ ticket, proposals }) {
  const guide = getActionGuide(ticket, proposals);
  const Icon = guide.icon;
  return (
    <div className={cn('rounded-xl border p-4', actionGuideClass(guide.tone))}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background/80 shadow-sm">
          <Icon className="h-5 w-5 text-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{guide.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{guide.summary}</p>
          {guide.steps.length > 0 && (
            <ol className="mt-3 list-decimal space-y-1 pl-4 text-sm text-foreground/90">
              {guide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function UserContextCard({ context }) {
  const line = formatUserContext(context);
  const u = context?.user;
  if (!line && !u) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Submitter context</span>
      {line && <p className="mt-1">{line}</p>}
      {u?.usage && (
        <p className="mt-1">
          Usage MTD: {u.usage.meetingMinutesThisMonth} meeting min · {u.usage.translationMinutesThisMonth}{' '}
          translation min
        </p>
      )}
    </div>
  );
}

export function SupportTab({ initialTicketNumber }) {
  const [tickets, setTickets] = useState([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [knowledgeGaps, setKnowledgeGaps] = useState([]);
  const [gapSuggestions, setGapSuggestions] = useState({});
  const [suggestingGapId, setSuggestingGapId] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const replyRef = useRef(null);

  const sortedTickets = useMemo(() => sortTickets(tickets), [tickets]);
  const stats = useMemo(() => countByStatus(tickets), [tickets]);
  const pollMs = useMemo(
    () => refreshIntervalMs(tickets, detail?.ticket),
    [tickets, detail?.ticket]
  );
  const livePolling = pollMs <= 5000;

  const reloadList = useCallback(async () => {
    const params = {};
    if (filterStatus) params.status = filterStatus;
    if (filterCategory) params.category = filterCategory;
    const r = await v2Support.adminListTickets(params);
    setTickets(r.tickets || []);
    setLastRefresh(new Date());
    return r.tickets || [];
  }, [filterStatus, filterCategory]);

  const reloadDetail = useCallback(async (ticketId) => {
    if (!ticketId) return null;
    const fresh = await v2Support.adminTicketDetail(ticketId);
    setDetail(fresh);
    return fresh;
  }, []);

  const reloadGaps = useCallback(async () => {
    const r = await v2Support.adminListKnowledgeGaps({ status: 'open' });
    setKnowledgeGaps(r.gaps || []);
  }, []);

  const refreshAll = useCallback(
    async (silent = true) => {
      if (busy) return;
      setRefreshing(true);
      try {
        await reloadList();
        if (selectedId) await reloadDetail(selectedId);
        await reloadGaps();
      } catch {
        if (!silent) toast.error('Refresh failed');
      } finally {
        setRefreshing(false);
      }
    },
    [busy, reloadList, reloadDetail, reloadGaps, selectedId]
  );

  useEffect(() => {
    reloadList().catch(() => toast.error('Failed to load tickets'));
  }, [filterStatus, filterCategory, reloadList]);

  useEffect(() => {
    reloadGaps().catch(() => {});
  }, [reloadGaps]);

  useEffect(() => {
    if (!initialTicketNumber || tickets.length === 0) return;
    const match = tickets.find((t) => t.publicNumber === Number(initialTicketNumber));
    if (match) setSelectedId(match.id);
  }, [initialTicketNumber, tickets]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetail(null);
    reloadDetail(selectedId).catch(() => toast.error('Failed to load ticket'));
  }, [selectedId, reloadDetail]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      if (busy) return;
      if (replyRef.current && document.activeElement === replyRef.current) return;
      refreshAll(true);
    }, pollMs);
    return () => clearInterval(id);
  }, [pollMs, busy, refreshAll]);

  const sendReply = async (e) => {
    e.preventDefault();
    if (!reply.trim() || !selectedId) return;
    setBusy(true);
    try {
      await v2Support.adminReply(selectedId, { body: reply.trim() });
      toast.success('Reply sent to user');
      setReply('');
      await reloadDetail(selectedId);
      await reloadList();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Reply failed');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status) => {
    if (!selectedId) return;
    setBusy(true);
    try {
      await v2Support.adminPatchStatus(selectedId, { status });
      toast.success(`Marked ${status.replace(/_/g, ' ')}`);
      await reloadDetail(selectedId);
      await reloadList();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const runProposalAction = async (proposalId, action) => {
    setBusy(true);
    try {
      const result = await v2Support.adminProposalAction(proposalId, { action });
      toast.success(result.result || 'Done');
      await reloadDetail(selectedId);
      await reloadList();
      await reloadGaps();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const resolveGap = async (gapId, status) => {
    setBusy(true);
    try {
      await v2Support.adminPatchKnowledgeGap(gapId, { status });
      await reloadGaps();
      toast.success(status === 'resolved' ? 'Marked resolved in KB' : 'Dismissed');
    } catch {
      toast.error('Update failed');
    } finally {
      setBusy(false);
    }
  };

  const suggestGap = async (gapId) => {
    setSuggestingGapId(gapId);
    try {
      const result = await v2Support.adminSuggestKnowledgeGap(gapId);
      setGapSuggestions((prev) => ({ ...prev, [gapId]: result.suggestion }));
      toast.success('KB draft ready — review before adding to docs');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Suggestion failed');
    } finally {
      setSuggestingGapId(null);
    }
  };

  const copyGapDraft = async (gapId) => {
    const draft = gapSuggestions[gapId]?.draftMarkdown;
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Copy failed');
    }
  };

  const pending = detail?.ticket ? pendingProposal(detail.proposals) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            AI handles Help chat first · you approve bugs, features, and sensitive replies
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LiveDot active={livePolling} />
          <span>
            {livePolling ? 'Live refresh' : 'Auto refresh'} ·{' '}
            {lastRefresh ? `${Math.round((Date.now() - lastRefresh.getTime()) / 1000)}s ago` : '—'}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            disabled={refreshing || busy}
            onClick={() => refreshAll(false)}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => setFilterStatus('pending_review')}
          className={cn(
            'rounded-lg border px-3 py-2 text-left transition-colors',
            filterStatus === 'pending_review' ? 'border-amber-500/50 bg-amber-500/10' : 'border-border/60 hover:bg-muted/40'
          )}
        >
          <p className="text-2xl font-semibold tabular-nums text-foreground">{stats.needsAction}</p>
          <p className="text-xs text-muted-foreground">Needs your action</p>
        </button>
        <button
          type="button"
          onClick={() => setFilterStatus('ai_reviewing')}
          className={cn(
            'rounded-lg border px-3 py-2 text-left transition-colors',
            filterStatus === 'ai_reviewing' ? 'border-violet-500/50 bg-violet-500/10' : 'border-border/60 hover:bg-muted/40'
          )}
        >
          <p className="text-2xl font-semibold tabular-nums text-foreground">{stats.aiWorking}</p>
          <p className="text-xs text-muted-foreground">AI working</p>
        </button>
        <button
          type="button"
          onClick={() => setFilterStatus('waiting_user')}
          className={cn(
            'rounded-lg border px-3 py-2 text-left transition-colors',
            filterStatus === 'waiting_user' ? 'border-primary/50 bg-primary/5' : 'border-border/60 hover:bg-muted/40'
          )}
        >
          <p className="text-2xl font-semibold tabular-nums text-foreground">{stats.waitingUser}</p>
          <p className="text-xs text-muted-foreground">Waiting on user</p>
        </button>
        <button
          type="button"
          onClick={() => setFilterStatus('')}
          className={cn(
            'rounded-lg border px-3 py-2 text-left transition-colors',
            filterStatus === '' ? 'border-primary/50 bg-primary/5' : 'border-border/60 hover:bg-muted/40'
          )}
        >
          <p className="text-2xl font-semibold tabular-nums text-foreground">{tickets.length}</p>
          <p className="text-xs text-muted-foreground">In current filter</p>
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="app-card border-border/60 lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Inbox</CardTitle>
            <div className="flex flex-wrap gap-1.5 pt-2">
              {CATEGORY_FILTERS.map((c) => {
                const Icon = c.icon;
                return (
                  <Button
                    key={c.value || 'all'}
                    type="button"
                    size="sm"
                    variant={filterCategory === c.value ? 'default' : 'outline'}
                    className="h-8 gap-1"
                    onClick={() => setFilterCategory(c.value)}
                  >
                    {Icon && <Icon className="h-3.5 w-3.5" />}
                    {c.label}
                  </Button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1.5 pt-2">
              {STATUS_FILTERS.map((s) => (
                <Button
                  key={s.value || 'all'}
                  type="button"
                  size="sm"
                  variant={filterStatus === s.value ? 'default' : 'ghost'}
                  className="h-7 px-2 text-xs"
                  onClick={() => setFilterStatus(s.value)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="max-h-[36rem] space-y-2 overflow-y-auto border-t border-border/60 pt-4">
            {sortedTickets.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">No tickets match this filter.</p>
            )}
            {sortedTickets.map((t) => {
              const cat = categoryMeta(t.category);
              const CatIcon = cat.icon;
              const st = statusMeta(t.status);
              const needsYou = t.status === 'pending_review' || t.status === 'escalated';
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                    selectedId === t.id ? 'border-primary/50 bg-primary/5' : 'border-border/60 hover:bg-muted/40',
                    needsYou && selectedId !== t.id && 'border-l-4 border-l-amber-500'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">#{t.publicNumber}</span>
                    <div className="flex items-center gap-1.5">
                      {t.status === 'ai_reviewing' && (
                        <Sparkles className="h-3.5 w-3.5 animate-pulse text-violet-600" />
                      )}
                      <Badge variant="secondary" className={cn('gap-1 text-[10px]', cat.badgeClass)}>
                        <CatIcon className="h-3 w-3" />
                        {cat.short}
                      </Badge>
                    </div>
                  </div>
                  <p className="mt-1 line-clamp-2 text-foreground">{t.subject || '—'}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={st.tone === 'warning' ? 'default' : 'outline'} className="text-[10px] capitalize">
                      {st.label}
                    </Badge>
                    {t.severity && <span>Severity: {t.severity}</span>}
                    <span>{fmtDateTime(t.updatedAt || t.createdAt)}</span>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <Card className="app-card border-border/60 lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-lg">
              {detail?.ticket ? `Ticket #${detail.ticket.publicNumber}` : 'Select a ticket'}
            </CardTitle>
            {detail?.ticket && (
              <CardDescription className="flex flex-wrap items-center gap-2">
                <Badge className={cn('gap-1', categoryMeta(detail.ticket.category).badgeClass)}>
                  {categoryMeta(detail.ticket.category).label}
                </Badge>
                {detail.submitterEmail && <span>{detail.submitterEmail}</span>}
                {detail.ticket.severity && <span>· severity {detail.ticket.severity}</span>}
                {detail.ticket.priority && <span>· priority {detail.ticket.priority.replace(/_/g, ' ')}</span>}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4 border-t border-border/60 pt-4">
            {!detail?.ticket && (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Pick a ticket from the inbox — urgent items are sorted to the top.
              </p>
            )}
            {detail?.ticket && (
              <>
                <ActionGuideBanner ticket={detail.ticket} proposals={detail.proposals} />

                {pending && (
                  <div className="space-y-3 rounded-xl border-2 border-amber-500/40 bg-amber-500/5 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">Pending AI proposal</p>
                      <Badge variant="outline" className="capitalize">
                        {pending.proposalType.replace(/_/g, ' ')}
                      </Badge>
                      {typeof pending.confidence === 'number' && (
                        <span className="text-xs text-muted-foreground">{Math.round(pending.confidence * 100)}% confidence</span>
                      )}
                    </div>
                    <p className="font-medium text-foreground">{pending.summary}</p>
                    {proposalDetailFields(pending).map((f) => (
                      <div key={f.label} className="rounded-md border border-border/60 bg-background/80 p-2 text-sm">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{f.label}</p>
                        <p className="mt-1 whitespace-pre-wrap text-foreground">{f.value}</p>
                      </div>
                    ))}
                    {pending.body?.draft_reply && (
                      <div className="rounded-md border border-border/60 bg-background p-3 text-sm">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Draft reply for user
                        </p>
                        <div className="mt-2 text-foreground">
                          <ChatMessageContent text={pending.body.draft_reply} />
                        </div>
                      </div>
                    )}
                    {pending.body?.github_issue_body && (
                      <details className="rounded-md border border-border/60 bg-background p-3 text-sm">
                        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                          GitHub issue body preview
                        </summary>
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs">{pending.body.github_issue_body}</pre>
                      </details>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {proposalActions(pending).map((a) => (
                        <Button
                          key={a.action}
                          type="button"
                          size="sm"
                          variant={a.variant || 'default'}
                          disabled={busy}
                          onClick={() => runProposalAction(pending.id, a.action)}
                        >
                          {a.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                <UserContextCard context={detail.ticket.context} />

                {detail.ticket.githubIssueUrl && (
                  <p className="text-sm">
                    <a
                      href={detail.ticket.githubIssueUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      View GitHub issue →
                    </a>
                  </p>
                )}

                {(detail.proposals || []).filter((p) => p.status !== 'pending_review').length > 0 && (
                  <details className="rounded-lg border border-border/60 p-3 text-sm">
                    <summary className="cursor-pointer font-medium text-muted-foreground">
                      Previous proposals ({detail.proposals.filter((p) => p.status !== 'pending_review').length})
                    </summary>
                    <div className="mt-3 space-y-2">
                      {detail.proposals
                        .filter((p) => p.status !== 'pending_review')
                        .map((p) => (
                          <div key={p.id} className="rounded-md bg-muted/30 px-3 py-2 text-xs">
                            <span className="capitalize">{p.proposalType.replace(/_/g, ' ')}</span> ·{' '}
                            <span className="capitalize">{p.status.replace(/_/g, ' ')}</span>
                            {p.executionRef && (
                              <>
                                {' '}
                                ·{' '}
                                <a href={p.executionRef} target="_blank" rel="noreferrer" className="text-primary">
                                  link
                                </a>
                              </>
                            )}
                          </div>
                        ))}
                    </div>
                  </details>
                )}

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Conversation
                  </p>
                  <div className="max-h-72 space-y-3 overflow-y-auto rounded-lg border border-border/60 p-3">
                    {(detail.messages || []).map((m) => (
                      <div
                        key={m.id}
                        className={cn(
                          'rounded-md px-3 py-2 text-sm',
                          m.authorType === 'staff' || m.authorType === 'agent' ? 'bg-primary/10' : 'bg-muted/50'
                        )}
                      >
                        <p className="text-xs font-medium capitalize text-muted-foreground">
                          {m.authorType === 'agent' ? 'Lalia Support' : m.authorType}
                          {m.authorType === 'staff' && m.authorId ? ` · ${m.authorId}` : ''} · {fmtDateTime(m.createdAt)}
                        </p>
                        <div className="mt-1 text-foreground">
                          <ChatMessageContent text={m.body} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
                  {['resolved', 'escalated', 'closed'].map((s) =>
                    detail.ticket.status !== s ? (
                      <Button key={s} type="button" size="sm" variant="outline" disabled={busy} onClick={() => setStatus(s)}>
                        Mark {s.replace('_', ' ')}
                      </Button>
                    ) : null
                  )}
                </div>

                <form onSubmit={sendReply} className="space-y-2">
                  <Label htmlFor="support-reply">Staff reply (posts in Help chat + emails user)</Label>
                  <textarea
                    ref={replyRef}
                    id="support-reply"
                    className="flex min-h-[100px] w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Override or follow up manually…"
                  />
                  <Button type="submit" disabled={busy || !reply.trim()}>
                    {busy ? 'Sending…' : 'Send staff reply'}
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="app-card border-border/60">
        <CardHeader>
          <CardTitle className="text-lg">Knowledge gaps</CardTitle>
          <CardDescription>
            Questions the AI could not answer confidently from the knowledge base. Review weekly and add answers to{' '}
            <code className="text-xs">docs/support/</code> (especially <code className="text-xs">faq.md</code>), then
            mark resolved.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 border-t border-border/60 pt-4">
          {knowledgeGaps.length === 0 && (
            <p className="text-sm text-muted-foreground">No open gaps.</p>
          )}
          {knowledgeGaps.slice(0, 15).map((g) => {
            const suggestion = gapSuggestions[g.id];
            const suggesting = suggestingGapId === g.id;
            return (
            <div key={g.id} className="rounded-lg border border-border/60 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {g.publicNumber != null && <Badge variant="outline">#{g.publicNumber}</Badge>}
                <Badge variant="secondary" className="capitalize">
                  {g.proposalType?.replace('_', ' ') || 'gap'}
                </Badge>
                <span className="text-xs text-muted-foreground">{fmtDateTime(g.createdAt)}</span>
              </div>
              <p className="mt-2 font-medium text-foreground">{g.userQuestion}</p>
              {g.summary && <p className="mt-1 text-muted-foreground">{g.summary}</p>}
              {g.docHits?.length === 0 && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">No KB articles matched</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  disabled={busy || suggesting}
                  onClick={() => suggestGap(g.id)}
                >
                  {suggesting ? 'Researching…' : 'Suggest KB entry'}
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => resolveGap(g.id, 'resolved')}>
                  Added to KB
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => resolveGap(g.id, 'dismissed')}>
                  Dismiss
                </Button>
              </div>
              {suggestion && (
                <div className="mt-3 space-y-2 rounded-md border border-primary/20 bg-primary/5 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline">docs/support/{suggestion.targetFile}</Badge>
                    {typeof suggestion.confidence === 'number' && (
                      <Badge variant={suggestion.confidence >= 0.65 ? 'default' : 'secondary'}>
                        AI confidence {Math.round(suggestion.confidence * 100)}%
                      </Badge>
                    )}
                    {suggestion.retrieval?.wouldLikelyMatch ? (
                      <span className="text-emerald-700 dark:text-emerald-400">Likely retrievable after add</span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">Review retrieval wording</span>
                    )}
                  </div>
                  {suggestion.rationale && (
                    <p className="text-xs text-muted-foreground">{suggestion.rationale}</p>
                  )}
                  {suggestion.sources?.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Sources: {suggestion.sources.slice(0, 4).join(' · ')}
                    </p>
                  )}
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-background p-2 text-xs">
                    {suggestion.draftMarkdown}
                  </pre>
                  <Button type="button" size="sm" variant="outline" onClick={() => copyGapDraft(g.id)}>
                    Copy draft
                  </Button>
                </div>
              )}
            </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
