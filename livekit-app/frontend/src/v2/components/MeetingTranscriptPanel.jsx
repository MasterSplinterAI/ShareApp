import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, FileDown, FileText, Loader2, Mail, RefreshCw, Search, Sparkles } from 'lucide-react';
import { v2Meetings } from '../../services/apiV2';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';

function formatTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function templateLabel(id, templates) {
  return templates.find((t) => t.id === id)?.label || id;
}

export default function MeetingTranscriptPanel({
  meetingId,
  lineCount,
  storeTranscripts,
  onDownloadJson,
  onDownloadTxt,
}) {
  const [tab, setTab] = useState('view');
  const [lines, setLines] = useState([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [search, setSearch] = useState('');
  const [speakerFilter, setSpeakerFilter] = useState('all');

  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('executive_summary');
  const [customInstructions, setCustomInstructions] = useState('');
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState(null);
  const [reports, setReports] = useState([]);

  const loadLines = useCallback(async () => {
    if (!meetingId || !lineCount) return;
    setLoadingLines(true);
    try {
      const { lines: fetched } = await v2Meetings.getTranscript(meetingId);
      setLines(fetched || []);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not load transcript');
    } finally {
      setLoadingLines(false);
    }
  }, [meetingId, lineCount]);

  const loadReports = useCallback(async () => {
    if (!meetingId) return;
    try {
      const { reports: r } = await v2Meetings.listTranscriptReports(meetingId);
      setReports(r || []);
    } catch {
      setReports([]);
    }
  }, [meetingId]);

  useEffect(() => {
    v2Meetings
      .getTranscriptTemplates()
      .then((r) => setTemplates(r.templates || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'view' && lineCount > 0 && lines.length === 0) {
      loadLines();
    }
    if (tab === 'insights') {
      loadReports();
    }
  }, [tab, lineCount, lines.length, loadLines, loadReports]);

  const speakers = useMemo(() => {
    const set = new Set();
    for (const l of lines) {
      if (l.participant_identity) set.add(l.participant_identity);
    }
    return [...set].sort();
  }, [lines]);

  const filteredLines = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lines.filter((l) => {
      if (speakerFilter !== 'all' && l.participant_identity !== speakerFilter) return false;
      if (!q) return true;
      const hay = [l.original_text, l.translated_text, l.participant_identity].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [lines, search, speakerFilter]);

  const runSynthesis = async (regenerate = false) => {
    if (!meetingId) return;
    setGenerating(true);
    try {
      const r = await v2Meetings.synthesizeTranscript(meetingId, {
        templateId,
        customInstructions: customInstructions.trim() || undefined,
        regenerate,
      });
      setReport(r.report);
      if (!r.cached) toast.success('Report generated');
      else toast.success('Loaded cached report');
      loadReports();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not generate report');
    } finally {
      setGenerating(false);
    }
  };

  const [exporting, setExporting] = useState(null);
  const [emailTo, setEmailTo] = useState('');
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [inviteGuests, setInviteGuests] = useState([]);
  const [selectedInviteEmails, setSelectedInviteEmails] = useState(() => new Set());
  const [loadingInviteGuests, setLoadingInviteGuests] = useState(false);

  const inviteEmailOptions = useMemo(() => {
    const seen = new Set();
    const opts = [];
    for (const g of inviteGuests) {
      const email = String(g.email || '')
        .trim()
        .toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      opts.push({ email, id: g.id });
    }
    return opts;
  }, [inviteGuests]);

  const loadInviteGuests = useCallback(async () => {
    if (!meetingId) return;
    setLoadingInviteGuests(true);
    try {
      const data = await v2Meetings.listEmailInvites(meetingId);
      const guests = data.guests || [];
      setInviteGuests(guests);
      const emails = [
        ...new Set(
          guests
            .map((g) => String(g.email || '').trim().toLowerCase())
            .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
        ),
      ];
      setSelectedInviteEmails(new Set(emails));
    } catch {
      setInviteGuests([]);
      setSelectedInviteEmails(new Set());
    } finally {
      setLoadingInviteGuests(false);
    }
  }, [meetingId]);

  useEffect(() => {
    if (emailOpen) loadInviteGuests();
  }, [emailOpen, loadInviteGuests]);

  const toggleInviteEmail = (email) => {
    setSelectedInviteEmails((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const setAllInviteEmails = (checked) => {
    if (checked) {
      setSelectedInviteEmails(new Set(inviteEmailOptions.map((o) => o.email)));
    } else {
      setSelectedInviteEmails(new Set());
    }
  };

  const downloadReport = async (format) => {
    if (!report?.id) return;
    setExporting(format);
    try {
      const res = await v2Meetings.exportTranscriptReport(meetingId, report.id, format);
      const blob = new Blob([res.data], {
        type: format === 'md' ? 'text/markdown' : 'application/pdf',
      });
      const dispo = res.headers?.['content-disposition'] || '';
      const match = dispo.match(/filename="([^"]+)"/);
      const filename = match?.[1] || `meeting-report.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  const sendReportEmail = async () => {
    const extra = emailTo
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const invalidExtra = extra.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (invalidExtra.length) {
      toast.error(`Invalid email: ${invalidExtra[0]}`);
      return;
    }
    const recipients = [...new Set([...selectedInviteEmails, ...extra])];
    if (!recipients.length) {
      toast.error('Select at least one invitee or enter an email address');
      return;
    }
    setEmailSending(true);
    try {
      await v2Meetings.emailTranscriptReport(meetingId, report.id, recipients);
      toast.success(
        recipients.length === 1 ? `Report sent to ${recipients[0]}` : `Report sent to ${recipients.length} recipients`
      );
      setEmailOpen(false);
      setEmailTo('');
    } catch (e) {
      const data = e.response?.data;
      toast.error(data?.message || data?.error || 'Email failed');
    } finally {
      setEmailSending(false);
    }
  };

  const copyReport = async () => {
    if (!report?.content_markdown) return;
    try {
      await navigator.clipboard.writeText(report.content_markdown);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Could not copy');
    }
  };

  if (!storeTranscripts) {
    return (
      <p className="text-sm text-muted-foreground">
        Transcript storage is off for this meeting. Enable &quot;Save transcript on server&quot; in Access &amp; policy to
        capture and view lines here.
      </p>
    );
  }

  if (!lineCount || lineCount <= 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No saved transcript lines yet. Lines appear when the host is in the meeting with storage enabled.
      </p>
    );
  }

  return (
    <Tabs value={tab} onValueChange={setTab} className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="view">View</TabsTrigger>
        <TabsTrigger value="insights">Insights</TabsTrigger>
        <TabsTrigger value="export">Export</TabsTrigger>
      </TabsList>

      <TabsContent value="view" className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Search transcript"
              placeholder="Search transcript…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {speakers.length > 1 && (
            <Select value={speakerFilter} onValueChange={setSpeakerFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Speaker" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All speakers</SelectItem>
                {speakers.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Refresh transcript"
            onClick={loadLines}
            disabled={loadingLines}
          >
            {loadingLines ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {filteredLines.length} of {lineCount} lines
          {filteredLines.length < lineCount && lines.length < lineCount ? ' (loaded subset — refresh for latest)' : ''}
        </p>
        <div className="max-h-[min(420px,50vh)] overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-3">
          {loadingLines && lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading transcript…</p>
          ) : filteredLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lines match your filters.</p>
          ) : (
            <ul className="space-y-3">
              {filteredLines.map((l, i) => (
                <li key={`${l.recorded_at}-${l.participant_identity}-${i}`} className="text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-medium text-foreground">{l.participant_identity || 'Unknown'}</span>
                    <span className="text-xs text-muted-foreground">{formatTime(l.recorded_at)}</span>
                  </div>
                  <p className="mt-0.5 text-foreground/90">{l.original_text}</p>
                  {l.translated_text && l.translated_text !== l.original_text && (
                    <p className="mt-0.5 text-muted-foreground italic">{l.translated_text}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </TabsContent>

      <TabsContent value="insights" className="space-y-4">
        <div className="space-y-2">
          <Label>Report type</Label>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(templates.length ? templates : [{ id: 'executive_summary', label: 'Executive summary' }]).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="custom-instructions">Additional instructions (optional)</Label>
          <textarea
            id="custom-instructions"
            rows={3}
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            placeholder="e.g. Only list dates and actionable items; ignore small talk."
            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            maxLength={1000}
          />
          <p className="text-xs text-muted-foreground">
            AI analyzes saved transcript lines. Results are cached until you regenerate or the transcript grows.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" className="gap-1.5" onClick={() => runSynthesis(false)} disabled={generating}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {generating ? 'Generating…' : 'Generate report'}
          </Button>
          {report && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => runSynthesis(true)} disabled={generating}>
                Regenerate
              </Button>
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={copyReport}>
                <Copy className="h-4 w-4" />
                Copy
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={!report.id || exporting === 'pdf'}
                onClick={() => downloadReport('pdf')}
              >
                {exporting === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                PDF
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={!report.id || exporting === 'md'}
                onClick={() => downloadReport('md')}
              >
                {exporting === 'md' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                .md
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={!report.id}
                onClick={() => setEmailOpen((v) => !v)}
              >
                <Mail className="h-4 w-4" />
                Email
              </Button>
            </>
          )}
        </div>
        {report && emailOpen && (
          <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-sm">Meeting invitees</Label>
                {inviteEmailOptions.length > 0 && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => setAllInviteEmails(true)}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:underline"
                      onClick={() => setAllInviteEmails(false)}
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
              {loadingInviteGuests ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading invitees…
                </p>
              ) : inviteEmailOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No email invitees on this meeting yet. Add addresses below, or invite guests from the meeting page
                  first.
                </p>
              ) : (
                <ul className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-border/50 bg-background/60 p-2">
                  {inviteEmailOptions.map((opt) => {
                    const checked = selectedInviteEmails.has(opt.email);
                    return (
                      <li key={opt.email}>
                        <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted/50">
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 rounded border-border accent-primary"
                            checked={checked}
                            onChange={() => toggleInviteEmail(opt.email)}
                          />
                          <span className="truncate">{opt.email}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-email-extra" className="text-sm">
                Additional emails
              </Label>
              <Input
                id="report-email-extra"
                aria-label="Additional recipient emails"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="colleague@company.com, another@company.com"
                className="h-9"
                onKeyDown={(e) => e.key === 'Enter' && !emailSending && sendReportEmail()}
              />
              <p className="text-xs text-muted-foreground">Comma-separated is fine. PDF attaches to one email.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" className="gap-1.5" disabled={emailSending} onClick={sendReportEmail}>
                {emailSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Send PDF
                {(() => {
                  const n = [
                    ...new Set([
                      ...selectedInviteEmails,
                      ...emailTo
                        .split(/[,;\s]+/)
                        .map((e) => e.trim().toLowerCase())
                        .filter(Boolean),
                    ]),
                  ].length;
                  return n > 0 ? ` (${n})` : '';
                })()}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={emailSending} onClick={() => setEmailOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {report?.content_markdown && (
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <p className="mb-2 text-xs text-muted-foreground">
              {templateLabel(report.template_id, templates)} · {report.line_count} lines ·{' '}
              {report.created_at ? new Date(report.created_at).toLocaleString() : ''}
            </p>
            <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm text-foreground dark:prose-invert">
              {report.content_markdown}
            </div>
          </div>
        )}
        {reports.length > 1 && (
          <div className="space-y-2 border-t border-border/60 pt-3">
            <p className="text-xs font-medium text-muted-foreground">Previous reports</p>
            <ul className="space-y-1">
              {reports.slice(0, 5).map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="rounded text-left text-sm text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() => setReport(r)}
                  >
                    {templateLabel(r.template_id, templates)} — {new Date(r.created_at).toLocaleString()}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </TabsContent>

      <TabsContent value="export" className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Download the full saved transcript ({lineCount} lines) as JSON or plain text.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onDownloadJson}>
            <FileDown className="h-4 w-4" />
            Download JSON
          </Button>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onDownloadTxt}>
            <FileDown className="h-4 w-4" />
            Download .txt
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  );
}
