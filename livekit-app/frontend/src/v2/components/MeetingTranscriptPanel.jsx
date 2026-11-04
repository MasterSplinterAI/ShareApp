import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, FileDown, FileText, Loader2, Mail, RefreshCw, Search, Sparkles, Users } from 'lucide-react';
import { v2Meetings, v2Contacts } from '../../services/apiV2';
import { Badge } from '../../components/ui/badge';
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
  initialTab = 'view',
  onDownloadJson,
  onDownloadTxt,
}) {
  const [tab, setTab] = useState(initialTab === 'insights' ? 'insights' : 'view');
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

  useEffect(() => {
    if (initialTab === 'insights') {
      setTab('insights');
    }
  }, [initialTab]);

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
      const list = r || [];
      setReports(list);
      setReport((prev) => prev || list[0] || null);
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
    if (lineCount > 0) {
      loadReports();
    }
  }, [lineCount, loadReports]);

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
      if (!r.cached) toast.success('AI insights generated');
      else toast.success('Loaded saved AI report');
      loadReports();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not generate report');
    } finally {
      setGenerating(false);
    }
  };

  const [exporting, setExporting] = useState(null);
  const [emailTo, setEmailTo] = useState('');
  const [emailNote, setEmailNote] = useState('');
  const [includeTranscriptInEmail, setIncludeTranscriptInEmail] = useState(true);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [sessionParticipants, setSessionParticipants] = useState([]);
  const [savedContacts, setSavedContacts] = useState([]);
  const [selectedRecipientEmails, setSelectedRecipientEmails] = useState(() => new Set());
  const [loadingRecipients, setLoadingRecipients] = useState(false);

  const participantOptions = useMemo(() => {
    const seen = new Set();
    const opts = [];
    for (const p of sessionParticipants) {
      const email = String(p.email || '').trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      opts.push({
        email,
        name: p.name || email.split('@')[0],
        role: p.role || 'Participant',
      });
    }
    return opts;
  }, [sessionParticipants]);

  const contactOptions = useMemo(() => {
    const participantSet = new Set(participantOptions.map((p) => p.email));
    const seen = new Set();
    const opts = [];
    for (const c of savedContacts) {
      const email = String(c.email || '').trim().toLowerCase();
      if (!email || participantSet.has(email) || seen.has(email)) continue;
      seen.add(email);
      opts.push({
        email,
        name: c.name || email.split('@')[0],
        isTeammate: Boolean(c.isTeammate),
      });
    }
    return opts;
  }, [savedContacts, participantOptions]);

  const loadRecipientOptions = useCallback(async () => {
    if (!meetingId) return;
    setLoadingRecipients(true);
    try {
      const [inviteData, contactsData] = await Promise.all([
        v2Meetings.listEmailInvites(meetingId).catch(() => ({ guests: [], participants: [] })),
        v2Contacts.list().catch(() => ({ contacts: [] })),
      ]);

      const rawParticipants =
        Array.isArray(inviteData.participants) && inviteData.participants.length > 0
          ? inviteData.participants
          : (inviteData.guests || []).map((g) => ({
              email: g.email,
              name: String(g.email || '').split('@')[0],
              role: 'Invited guest',
            }));

      setSessionParticipants(rawParticipants);
      setSavedContacts(contactsData.contacts || []);

      const defaultChecked = [
        ...new Set(
          rawParticipants
            .map((p) => String(p.email || '').trim().toLowerCase())
            .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
        ),
      ];
      setSelectedRecipientEmails(new Set(defaultChecked));
    } catch {
      setSessionParticipants([]);
      setSavedContacts([]);
      setSelectedRecipientEmails(new Set());
    } finally {
      setLoadingRecipients(false);
    }
  }, [meetingId]);

  useEffect(() => {
    if (emailOpen) loadRecipientOptions();
  }, [emailOpen, loadRecipientOptions]);

  const toggleRecipientEmail = (email) => {
    setSelectedRecipientEmails((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const setAllParticipantEmails = (checked) => {
    setSelectedRecipientEmails((prev) => {
      const next = new Set(prev);
      for (const p of participantOptions) {
        if (checked) next.add(p.email);
        else next.delete(p.email);
      }
      return next;
    });
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
    const recipients = [...new Set([...selectedRecipientEmails, ...extra])];
    if (!recipients.length) {
      toast.error('Select at least one participant/contact or enter an email address');
      return;
    }
    setEmailSending(true);
    try {
      await v2Meetings.emailTranscriptReport(meetingId, report.id, recipients, {
        includeTranscript: includeTranscriptInEmail,
        note: emailNote.trim() || undefined,
      });
      toast.success(
        recipients.length === 1
          ? `Insights sent to ${recipients[0]}`
          : `Insights sent to ${recipients.length} recipients`
      );
      setEmailOpen(false);
      setEmailTo('');
      setEmailNote('');
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
        No saved transcript lines yet. Lines appear automatically as people speak during the call or meeting.
      </p>
    );
  }

  const totalSelectedCount = [
    ...new Set([
      ...selectedRecipientEmails,
      ...emailTo
        .split(/[,;\s]+/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ]),
  ].length;

  return (
    <Tabs value={tab} onValueChange={setTab} className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="view">Transcript ({lineCount})</TabsTrigger>
        <TabsTrigger value="insights" className="gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          AI Insights &amp; Email
        </TabsTrigger>
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
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            onClick={() => setTab('insights')}
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI Insights &amp; Email
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
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Insight template</Label>
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
          <div className="space-y-1.5">
            <Label htmlFor="custom-instructions">Custom focus (optional)</Label>
            <Input
              id="custom-instructions"
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder="e.g. Highlight action items, dates & pricing decisions"
              maxLength={1000}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" className="gap-1.5" onClick={() => runSynthesis(false)} disabled={generating}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {generating ? 'Generating…' : report ? 'Generate selected template' : 'Generate AI insights'}
          </Button>
          {report && (
            <>
              <Button
                type="button"
                size="sm"
                variant={emailOpen ? 'default' : 'secondary'}
                className="gap-1.5 font-medium"
                disabled={!report.id}
                onClick={() => setEmailOpen((v) => !v)}
              >
                <Mail className="h-4 w-4 text-primary" />
                Send via Email
              </Button>
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
            </>
          )}
        </div>

        {report && emailOpen && (
          <div className="space-y-4 rounded-xl border border-primary/30 bg-primary/[0.03] p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-foreground">
                  Email AI Insights &amp; Report
                </h4>
                <p className="text-xs text-muted-foreground">
                  Select call/meeting participants, pick from your saved contacts, or add any email address.
                </p>
              </div>
              {participantOptions.length > 0 && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs font-medium text-primary hover:underline"
                    onClick={() => setAllParticipantEmails(true)}
                  >
                    Select all participants
                  </button>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:underline"
                    onClick={() => setSelectedRecipientEmails(new Set())}
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>

            {loadingRecipients ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading participants &amp; contacts…
              </p>
            ) : (
              <div className="space-y-3">
                {participantOptions.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Call / Meeting Participants
                    </Label>
                    <ul className="grid gap-1.5 sm:grid-cols-2">
                      {participantOptions.map((opt) => {
                        const checked = selectedRecipientEmails.has(opt.email);
                        return (
                          <li key={opt.email}>
                            <label
                              className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors ${
                                checked
                                  ? 'border-primary/50 bg-primary/10 text-foreground'
                                  : 'border-border/60 bg-background/80 text-muted-foreground hover:bg-muted/40'
                              }`}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 shrink-0 rounded border-border accent-primary"
                                  checked={checked}
                                  onChange={() => toggleRecipientEmail(opt.email)}
                                />
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-foreground">{opt.name}</p>
                                  <p className="truncate text-[11px] text-muted-foreground">{opt.email}</p>
                                </div>
                              </div>
                              <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                                {opt.role}
                              </Badge>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {contactOptions.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      Other Contacts &amp; Teammates
                    </Label>
                    <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-border/60 bg-background/60 p-2">
                      {contactOptions.map((c) => {
                        const checked = selectedRecipientEmails.has(c.email);
                        return (
                          <button
                            key={c.email}
                            type="button"
                            onClick={() => toggleRecipientEmail(c.email)}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                              checked
                                ? 'border-primary bg-primary text-primary-foreground font-medium'
                                : 'border-border/70 bg-background text-foreground hover:bg-muted'
                            }`}
                          >
                            <span>{c.name}</span>
                            <span className={checked ? 'text-primary-foreground/80' : 'text-muted-foreground'}>
                              ({c.email})
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="report-email-extra" className="text-xs font-medium">
                  Additional email addresses
                </Label>
                <Input
                  id="report-email-extra"
                  aria-label="Additional recipient emails"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="client@company.com, teammate@company.com"
                  className="h-9"
                  onKeyDown={(e) => e.key === 'Enter' && !emailSending && sendReportEmail()}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="report-email-note" className="text-xs font-medium">
                  Personal note (optional)
                </Label>
                <Input
                  id="report-email-note"
                  value={emailNote}
                  onChange={(e) => setEmailNote(e.target.value)}
                  placeholder="e.g. Great speaking today — here are our action items!"
                  className="h-9"
                  maxLength={500}
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border/70 bg-background/80 px-3 py-2 text-xs">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 rounded border-border accent-primary"
                checked={includeTranscriptInEmail}
                onChange={(e) => setIncludeTranscriptInEmail(e.target.checked)}
              />
              <span className="font-medium text-foreground">
                Include bilingual transcript (<code>.txt</code> attachment + preview) alongside the AI Insights PDF
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" className="gap-1.5" disabled={emailSending} onClick={sendReportEmail}>
                {emailSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Send Insights Email{totalSelectedCount > 0 ? ` (${totalSelectedCount})` : ''}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={emailSending} onClick={() => setEmailOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {report?.content_markdown && (
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {templateLabel(report.template_id, templates)} · {report.line_count} lines ·{' '}
                {report.created_at ? new Date(report.created_at).toLocaleString() : ''}
              </p>
              {!emailOpen && (
                <button
                  type="button"
                  onClick={() => setEmailOpen(true)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <Mail className="h-3.5 w-3.5" />
                  Email to participants or others
                </button>
              )}
            </div>
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
