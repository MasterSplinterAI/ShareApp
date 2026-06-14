import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Bug, ChevronLeft, Lightbulb, LifeBuoy, MessageCircle, Send, X } from 'lucide-react';
import { v2Support } from '../services/apiV2';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { cn } from '../lib/utils';

const textareaClass =
  'flex w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const CATEGORIES = [
  { id: 'customer_support', label: 'Support', icon: MessageCircle },
  { id: 'bug_report', label: 'Bug', icon: Bug },
  { id: 'feature_request', label: 'Feature', icon: Lightbulb },
];

const FEATURE_INTRO =
  "Hi! I'll help refine your feature idea before we send it to the team. What problem are you trying to solve?";

function collectContext(extra = {}) {
  return {
    url: typeof window !== 'undefined' ? window.location.href : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    ...extra,
  };
}

function statusLabel(status) {
  if (status === 'waiting_user') return 'Reply waiting';
  if (status === 'ai_reviewing') return 'AI reviewing';
  if (status === 'pending_review') return 'Pending review';
  if (status === 'resolved' || status === 'closed') return 'Closed';
  return status.replace(/_/g, ' ');
}

function ChatBubble({ message }) {
  const isStaff = message.authorType === 'staff' || message.authorType === 'agent';
  const isUser = message.authorType === 'user';
  return (
    <div className={cn('flex flex-col gap-0.5', isUser ? 'items-end' : 'items-start')}>
      {isStaff && (
        <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Parley Support
        </span>
      )}
      <div
        className={cn(
          'max-w-[92%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words',
          isStaff && 'rounded-bl-md bg-muted text-foreground',
          isUser && 'rounded-br-md bg-primary text-primary-foreground',
          !isStaff && !isUser && 'bg-muted/60 text-muted-foreground'
        )}
      >
        {message.body}
      </div>
    </div>
  );
}

function CoachBubble({ message }) {
  return (
    <ChatBubble
      message={{
        authorType: message.role === 'user' ? 'user' : 'agent',
        body: message.body,
      }}
    />
  );
}

export default function HelpPanel({ open, onOpenChange, isLoggedIn, userEmail }) {
  const [step, setStep] = useState('home');
  const [category, setCategory] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [myTickets, setMyTickets] = useState([]);
  const [activeTicket, setActiveTicket] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');
  const [replySending, setReplySending] = useState(false);
  const [guestEmail, setGuestEmail] = useState('');
  const scrollRef = useRef(null);

  const [supportBody, setSupportBody] = useState('');
  const [bugTitle, setBugTitle] = useState('');
  const [bugSteps, setBugSteps] = useState('');
  const [bugExpected, setBugExpected] = useState('');
  const [bugActual, setBugActual] = useState('');
  const [bugSeverity, setBugSeverity] = useState('medium');
  const [featureProblem, setFeatureProblem] = useState('');
  const [featureSolution, setFeatureSolution] = useState('');
  const [featurePriority, setFeaturePriority] = useState('nice_to_have');
  const [featureChatMessages, setFeatureChatMessages] = useState([]);
  const [featureChatDraft, setFeatureChatDraft] = useState('');
  const [featureCoachBusy, setFeatureCoachBusy] = useState(false);
  const [featureDraft, setFeatureDraft] = useState({
    problem: '',
    solution: '',
    priority: 'nice_to_have',
    subject: '',
  });
  const [featureReady, setFeatureReady] = useState(false);

  const unreadCount = useMemo(
    () => myTickets.filter((t) => t.status === 'waiting_user').length,
    [myTickets]
  );

  const reloadTickets = useCallback(() => {
    if (!isLoggedIn) return Promise.resolve();
    return v2Support
      .listTickets()
      .then((r) => setMyTickets(r.tickets || []))
      .catch(() => {});
  }, [isLoggedIn]);

  const loadThread = useCallback(async (ticketId) => {
    setThreadLoading(true);
    try {
      const data = await v2Support.getTicket(ticketId);
      setActiveTicket(data.ticket);
      setThreadMessages(data.messages || []);
    } catch {
      toast.error('Could not load conversation');
    } finally {
      setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    reloadTickets();
  }, [open, reloadTickets]);

  useEffect(() => {
    if (step !== 'thread' || !activeTicket?.id) return;
    loadThread(activeTicket.id);
    const ms = activeTicket.status === 'ai_reviewing' ? 3000 : 20000;
    const id = setInterval(() => loadThread(activeTicket.id), ms);
    return () => clearInterval(id);
  }, [step, activeTicket?.id, activeTicket?.status, loadThread]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [threadMessages, featureChatMessages, step]);

  const resetFlow = () => {
    setStep('home');
    setCategory(null);
    setActiveTicket(null);
    setThreadMessages([]);
    setReplyDraft('');
    setSupportBody('');
    setBugTitle('');
    setBugSteps('');
    setBugExpected('');
    setBugActual('');
    setFeatureProblem('');
    setFeatureSolution('');
    setFeatureChatMessages([]);
    setFeatureChatDraft('');
    setFeatureCoachBusy(false);
    setFeatureDraft({ problem: '', solution: '', priority: 'nice_to_have', subject: '' });
    setFeatureReady(false);
  };

  const close = () => {
    resetFlow();
    onOpenChange(false);
  };

  const openThread = (ticket) => {
    setActiveTicket(ticket);
    setStep('thread');
  };

  const pickCategory = (id) => {
    setCategory(id);
    if (id === 'feature_request') {
      setFeatureChatMessages([{ role: 'agent', body: FEATURE_INTRO }]);
      setFeatureDraft({ problem: '', solution: '', priority: 'nice_to_have', subject: '' });
      setFeatureReady(false);
      setFeatureChatDraft('');
      setStep('feature-chat');
      return;
    }
    setStep('compose');
  };

  const sendFeatureChat = async (e) => {
    e.preventDefault();
    const text = featureChatDraft.trim();
    if (!text || featureCoachBusy) return;
    const userMsg = { role: 'user', body: text };
    const nextMessages = [...featureChatMessages, userMsg];
    setFeatureChatMessages(nextMessages);
    setFeatureChatDraft('');
    setFeatureCoachBusy(true);
    try {
      const result = await v2Support.coachFeature({
        category: 'feature_request',
        messages: nextMessages,
      });
      setFeatureChatMessages((prev) => [...prev, { role: 'agent', body: result.reply }]);
      if (result.draft) {
        setFeatureDraft(result.draft);
        if (result.draft.problem) setFeatureProblem(result.draft.problem);
        if (result.draft.solution) setFeatureSolution(result.draft.solution);
        if (result.draft.priority) setFeaturePriority(result.draft.priority);
      }
      setFeatureReady(Boolean(result.readyToSubmit));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not reach coach');
      setFeatureChatMessages((prev) => prev.slice(0, -1));
      setFeatureChatDraft(text);
    } finally {
      setFeatureCoachBusy(false);
    }
  };

  const submitFeatureTicket = async () => {
    const problem = (featureDraft.problem || featureProblem).trim();
    if (!problem) {
      toast.error('Describe the problem first');
      return;
    }
    if (!isLoggedIn && !guestEmail.trim()) {
      toast.error('Enter your email below before submitting');
      return;
    }
    setSubmitting(true);
    try {
      const data = await v2Support.createTicket({
        category: 'feature_request',
        problem,
        solution: (featureDraft.solution || featureSolution).trim(),
        priority: featureDraft.priority || featurePriority,
        subject: featureDraft.subject || problem.slice(0, 120),
        context: collectContext(),
        ...(isLoggedIn ? {} : { guestEmail: guestEmail.trim() }),
      });
      toast.success(`Feature request #${data.ticket.publicNumber} submitted`);
      await reloadTickets();
      if (isLoggedIn) {
        setThreadMessages(data.messages || []);
        openThread(data.ticket);
      } else {
        setStep('guest-done');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not submit');
    } finally {
      setSubmitting(false);
    }
  };

  const submitTicket = async (e) => {
    e.preventDefault();
    if (!isLoggedIn && !guestEmail.trim()) {
      toast.error('Email is required');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        category,
        context: collectContext(),
        ...(isLoggedIn ? {} : { guestEmail: guestEmail.trim() }),
      };
      if (category === 'customer_support') {
        payload.body = supportBody.trim();
      } else if (category === 'bug_report') {
        payload.title = bugTitle.trim();
        payload.steps = bugSteps.trim();
        payload.expected = bugExpected.trim();
        payload.actual = bugActual.trim();
        payload.severity = bugSeverity;
      }

      const data = await v2Support.createTicket(payload);
      toast.success(`Ticket #${data.ticket.publicNumber} submitted`);
      await reloadTickets();
      if (isLoggedIn) {
        setThreadMessages(data.messages || []);
        openThread(data.ticket);
      } else {
        setStep('guest-done');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not submit');
    } finally {
      setSubmitting(false);
    }
  };

  const sendReply = async (e) => {
    e.preventDefault();
    if (!activeTicket?.id || !replyDraft.trim()) return;
    setReplySending(true);
    try {
      await v2Support.addMessage(activeTicket.id, { body: replyDraft.trim() });
      setReplyDraft('');
      await loadThread(activeTicket.id);
      await reloadTickets();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not send');
    } finally {
      setReplySending(false);
    }
  };

  const categoryMeta = CATEGORIES.find((c) => c.id === category);
  const canReply =
    isLoggedIn &&
    activeTicket &&
    activeTicket.status !== 'closed' &&
    activeTicket.status !== 'resolved';

  const headerTitle =
    step === 'thread' && activeTicket
      ? `#${activeTicket.publicNumber} · ${activeTicket.subject || 'Support'}`
      : step === 'feature-chat'
        ? 'Feature idea'
        : step === 'compose' && categoryMeta
          ? categoryMeta.label
          : 'Help & support';

  return (
    <>
      {open && (
        <div
          className="fixed bottom-24 right-4 z-50 flex max-h-[min(32rem,calc(100vh-7rem))] w-[min(100vw-2rem,24rem)] flex-col overflow-hidden rounded-2xl border border-border/80 bg-background shadow-2xl sm:right-6"
          role="dialog"
          aria-label="Help and support chat"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2.5">
            {(step === 'compose' || step === 'thread' || step === 'feature-chat') && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => {
                  if (step === 'thread') {
                    setStep('home');
                    setActiveTicket(null);
                  } else {
                    setStep('home');
                  }
                }}
                aria-label="Back"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <LifeBuoy className="h-4 w-4 shrink-0 text-primary" />
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{headerTitle}</p>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={close} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
            {step === 'home' && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Hi{userEmail ? ` — questions for ${userEmail.split('@')[0]}` : ''}. How can we help?
                </p>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => pickCategory(item.id)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/40 hover:bg-primary/5"
                      >
                        <Icon className="h-3.5 w-3.5 text-primary" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
                {isLoggedIn && myTickets.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your conversations</p>
                    <ul className="mt-2 space-y-1.5">
                      {myTickets.slice(0, 8).map((t) => (
                        <li key={t.id}>
                          <button
                            type="button"
                            onClick={() => openThread(t)}
                            className={cn(
                              'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50',
                              t.status === 'waiting_user'
                                ? 'border-primary/40 bg-primary/5'
                                : 'border-border/60'
                            )}
                          >
                            <span className="min-w-0 truncate">
                              <span className="font-medium">#{t.publicNumber}</span>{' '}
                              <span className="text-muted-foreground">{t.subject || t.category}</span>
                            </span>
                            <span className="shrink-0 text-[10px] capitalize text-muted-foreground">
                              {statusLabel(t.status)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {step === 'compose' && categoryMeta && (
              <form id="help-compose-form" onSubmit={submitTicket} className="space-y-3">
                {!isLoggedIn && (
                  <div className="space-y-1.5">
                    <Label htmlFor="help-guest-email" className="text-xs">
                      Email
                    </Label>
                    <Input
                      id="help-guest-email"
                      type="email"
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                      required
                      autoComplete="email"
                      placeholder="you@company.com"
                    />
                  </div>
                )}

                {category === 'customer_support' && (
                  <textarea
                    className={textareaClass}
                    value={supportBody}
                    onChange={(e) => setSupportBody(e.target.value)}
                    rows={5}
                    required
                    placeholder="How can we help?"
                  />
                )}

                {category === 'bug_report' && (
                  <>
                    <Input
                      value={bugTitle}
                      onChange={(e) => setBugTitle(e.target.value)}
                      required
                      placeholder="Bug title"
                    />
                    <Select value={bugSeverity} onValueChange={setBugSeverity}>
                      <SelectTrigger>
                        <SelectValue placeholder="Severity" />
                      </SelectTrigger>
                      <SelectContent className="z-[60]">
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                    <textarea
                      className={textareaClass}
                      value={bugSteps}
                      onChange={(e) => setBugSteps(e.target.value)}
                      rows={2}
                      placeholder="Steps to reproduce"
                    />
                    <textarea
                      className={textareaClass}
                      value={bugActual}
                      onChange={(e) => setBugActual(e.target.value)}
                      rows={2}
                      placeholder="What happened?"
                    />
                  </>
                )}

              </form>
            )}

            {step === 'feature-chat' && (
              <div className="space-y-3">
                {!isLoggedIn && (
                  <div className="space-y-1.5">
                    <Label htmlFor="feature-guest-email" className="text-xs">
                      Email (for updates)
                    </Label>
                    <Input
                      id="feature-guest-email"
                      type="email"
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                      autoComplete="email"
                      placeholder="you@company.com"
                    />
                  </div>
                )}
                {featureChatMessages.map((m, i) => (
                  <CoachBubble key={`${i}-${m.role}`} message={m} />
                ))}
                {featureCoachBusy && (
                  <p className="text-xs italic text-muted-foreground">Parley Support is typing…</p>
                )}
                {featureReady && (
                  <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
                    Ready to submit — tap <strong>Submit feature request</strong> below when you are happy with the summary.
                  </p>
                )}
              </div>
            )}

            {step === 'guest-done' && (
              <p className="text-sm text-muted-foreground">
                Thanks — we received your message and will reply by email.
              </p>
            )}

            {step === 'thread' && (
              <div className="space-y-3">
                {threadLoading && threadMessages.length === 0 && (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                )}
                {threadMessages.map((m) => (
                  <ChatBubble key={m.id} message={m} />
                ))}
                {activeTicket?.status === 'ai_reviewing' && (
                  <p className="text-xs italic text-muted-foreground">Parley Support is typing…</p>
                )}
                {activeTicket?.status === 'waiting_user' && threadMessages.length > 0 && (
                  <p className="text-center text-xs text-primary">New reply from our team</p>
                )}
              </div>
            )}
          </div>

          {step === 'feature-chat' && (
            <div className="shrink-0 space-y-2 border-t border-border/60 p-3">
              {featureReady && (
                <Button type="button" className="w-full gap-2" disabled={submitting} onClick={submitFeatureTicket}>
                  <Send className="h-4 w-4" />
                  {submitting ? 'Submitting…' : 'Submit feature request'}
                </Button>
              )}
              <form onSubmit={sendFeatureChat} className="flex gap-2">
                <input
                  type="text"
                  value={featureChatDraft}
                  onChange={(e) => setFeatureChatDraft(e.target.value)}
                  placeholder="Describe your idea…"
                  className="min-w-0 flex-1 rounded-full border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  maxLength={4000}
                  disabled={featureCoachBusy}
                />
                <Button
                  type="submit"
                  size="icon"
                  className="shrink-0 rounded-full"
                  disabled={featureCoachBusy || !featureChatDraft.trim()}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </div>
          )}

          {step === 'compose' && (
            <div className="shrink-0 border-t border-border/60 p-3">
              <Button type="submit" form="help-compose-form" className="w-full gap-2" disabled={submitting}>
                <Send className="h-4 w-4" />
                {submitting ? 'Sending…' : 'Send'}
              </Button>
            </div>
          )}

          {step === 'thread' && canReply && (
            <form onSubmit={sendReply} className="flex shrink-0 gap-2 border-t border-border/60 p-3">
              <input
                type="text"
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                placeholder="Reply…"
                className="min-w-0 flex-1 rounded-full border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                maxLength={8000}
              />
              <Button type="submit" size="icon" className="shrink-0 rounded-full" disabled={replySending || !replyDraft.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          )}
        </div>
      )}

      <HelpLauncher open={open} unreadCount={unreadCount} onClick={() => onOpenChange(!open)} />
    </>
  );
}

export function HelpLauncher({ open, unreadCount, onClick, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? 'Close help chat' : 'Open help chat'}
      aria-expanded={open}
      className={cn(
        'fixed bottom-6 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-border/60 bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:right-6',
        open && 'scale-95 opacity-90',
        className
      )}
    >
      {open ? <X className="h-6 w-6" /> : <LifeBuoy className="h-6 w-6" />}
      {!open && unreadCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  );
}

/** @deprecated use HelpLauncher inside HelpPanel */
export function HelpTriggerButton({ onClick, className }) {
  return (
    <Button type="button" variant="outline" size="sm" className={cn('gap-2', className)} onClick={onClick} aria-label="Help and support">
      <LifeBuoy className="h-4 w-4" />
      Help
    </Button>
  );
}
