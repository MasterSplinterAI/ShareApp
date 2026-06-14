import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Bug, Lightbulb, LifeBuoy, MessageCircle, Send } from 'lucide-react';
import { v2Support } from '../services/apiV2';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from './ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { cn } from '../lib/utils';

const textareaClass =
  'flex w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background';

const CATEGORIES = [
  {
    id: 'customer_support',
    label: 'Customer support',
    description: 'Questions about using Parley',
    icon: MessageCircle,
  },
  {
    id: 'bug_report',
    label: 'Bug report',
    description: 'Something is broken',
    icon: Bug,
  },
  {
    id: 'feature_request',
    label: 'Feature request',
    description: 'Suggest an improvement',
    icon: Lightbulb,
  },
];

function collectContext(extra = {}) {
  return {
    url: typeof window !== 'undefined' ? window.location.href : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    ...extra,
  };
}

export default function HelpPanel({ open, onOpenChange, isLoggedIn, userEmail }) {
  const [step, setStep] = useState('pick');
  const [category, setCategory] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdTicket, setCreatedTicket] = useState(null);
  const [myTickets, setMyTickets] = useState([]);
  const [guestEmail, setGuestEmail] = useState('');

  const [supportBody, setSupportBody] = useState('');
  const [bugTitle, setBugTitle] = useState('');
  const [bugSteps, setBugSteps] = useState('');
  const [bugExpected, setBugExpected] = useState('');
  const [bugActual, setBugActual] = useState('');
  const [bugSeverity, setBugSeverity] = useState('medium');
  const [featureProblem, setFeatureProblem] = useState('');
  const [featureSolution, setFeatureSolution] = useState('');
  const [featurePriority, setFeaturePriority] = useState('nice_to_have');

  useEffect(() => {
    if (!open) return;
    if (isLoggedIn) {
      v2Support
        .listTickets()
        .then((r) => setMyTickets(r.tickets || []))
        .catch(() => {});
    }
  }, [open, isLoggedIn]);

  const resetForm = () => {
    setStep('pick');
    setCategory(null);
    setCreatedTicket(null);
    setSupportBody('');
    setBugTitle('');
    setBugSteps('');
    setBugExpected('');
    setBugActual('');
    setFeatureProblem('');
    setFeatureSolution('');
  };

  const handleOpenChange = (next) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  const pickCategory = (id) => {
    setCategory(id);
    setStep('form');
  };

  const submit = async (e) => {
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
      } else {
        payload.problem = featureProblem.trim();
        payload.solution = featureSolution.trim();
        payload.priority = featurePriority;
      }

      const data = await v2Support.createTicket(payload);
      setCreatedTicket(data.ticket);
      setStep('done');
      toast.success(`Ticket #${data.ticket.publicNumber} submitted`);
      if (isLoggedIn) {
        v2Support
          .listTickets()
          .then((r) => setMyTickets(r.tickets || []))
          .catch(() => {});
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not submit');
    } finally {
      setSubmitting(false);
    }
  };

  const categoryMeta = CATEGORIES.find((c) => c.id === category);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <LifeBuoy className="h-5 w-5 text-primary" />
            Help & support
          </SheetTitle>
          <SheetDescription>
            Report bugs, request features, or ask for help. Our team will follow up by email.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-2">
          {step === 'pick' && (
            <>
              <div className="grid gap-2">
                {CATEGORIES.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => pickCategory(item.id)}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border border-border/80 bg-card p-3 text-left transition-colors',
                        'hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                      )}
                    >
                      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                      <span>
                        <span className="block text-sm font-medium text-foreground">{item.label}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{item.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {isLoggedIn && myTickets.length > 0 && (
                <div className="border-t border-border/60 pt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your requests</p>
                  <ul className="mt-2 space-y-2">
                    {myTickets.slice(0, 5).map((t) => (
                      <li
                        key={t.id}
                        className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm"
                      >
                        <span className="font-medium">#{t.publicNumber}</span>{' '}
                        <span className="text-muted-foreground">{t.subject || t.category}</span>
                        <span className="ml-2 text-xs capitalize text-muted-foreground">{t.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {step === 'form' && categoryMeta && (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <Button type="button" variant="ghost" size="sm" className="w-fit px-0" onClick={() => setStep('pick')}>
                ← Back
              </Button>
              <p className="text-sm font-medium text-foreground">{categoryMeta.label}</p>

              {!isLoggedIn && (
                <div className="space-y-2">
                  <Label htmlFor="help-guest-email">Your email</Label>
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
              {isLoggedIn && (
                <p className="text-xs text-muted-foreground">
                  Submitting as <span className="text-foreground">{userEmail}</span>
                </p>
              )}

              {category === 'customer_support' && (
                <div className="space-y-2">
                  <Label htmlFor="support-body">How can we help?</Label>
                  <textarea
                    id="support-body"
                    className={textareaClass}
                    value={supportBody}
                    onChange={(e) => setSupportBody(e.target.value)}
                    rows={6}
                    required
                    placeholder="Describe your question or issue…"
                  />
                </div>
              )}

              {category === 'bug_report' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="bug-title">Title</Label>
                    <Input id="bug-title" value={bugTitle} onChange={(e) => setBugTitle(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bug-severity">Severity</Label>
                    <Select value={bugSeverity} onValueChange={setBugSeverity}>
                      <SelectTrigger id="bug-severity">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bug-steps">Steps to reproduce</Label>
                    <textarea
                      id="bug-steps"
                      className={textareaClass}
                      value={bugSteps}
                      onChange={(e) => setBugSteps(e.target.value)}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bug-expected">Expected behavior</Label>
                    <textarea
                      id="bug-expected"
                      className={textareaClass}
                      value={bugExpected}
                      onChange={(e) => setBugExpected(e.target.value)}
                      rows={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bug-actual">Actual behavior</Label>
                    <textarea
                      id="bug-actual"
                      className={textareaClass}
                      value={bugActual}
                      onChange={(e) => setBugActual(e.target.value)}
                      rows={2}
                    />
                  </div>
                </>
              )}

              {category === 'feature_request' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="feature-problem">What problem does this solve?</Label>
                    <textarea
                      id="feature-problem"
                      className={textareaClass}
                      value={featureProblem}
                      onChange={(e) => setFeatureProblem(e.target.value)}
                      rows={4}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="feature-solution">Proposed solution (optional)</Label>
                    <textarea
                      id="feature-solution"
                      className={textareaClass}
                      value={featureSolution}
                      onChange={(e) => setFeatureSolution(e.target.value)}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="feature-priority">Priority</Label>
                    <Select value={featurePriority} onValueChange={setFeaturePriority}>
                      <SelectTrigger id="feature-priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nice_to_have">Nice to have</SelectItem>
                        <SelectItem value="important">Important</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              <Button type="submit" className="w-full gap-2" disabled={submitting}>
                <Send className="h-4 w-4" />
                {submitting ? 'Submitting…' : 'Submit'}
              </Button>
            </form>
          )}

          {step === 'done' && createdTicket && (
            <div className="space-y-4">
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
                <p className="font-medium text-foreground">Ticket #{createdTicket.publicNumber} received</p>
                <p className="mt-2 text-muted-foreground">
                  We&apos;ll review your request and reply by email. You&apos;ll also get a Telegram alert on our side.
                </p>
              </div>
              <Button type="button" variant="outline" className="w-full" onClick={resetForm}>
                Submit another
              </Button>
              <Button type="button" className="w-full" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function HelpTriggerButton({ onClick, className }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn('gap-2', className)}
      onClick={onClick}
      aria-label="Help and support"
    >
      <LifeBuoy className="h-4 w-4" />
      Help
    </Button>
  );
}
