import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format, isToday, isYesterday } from 'date-fns';
import {
  FileText,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Plus,
  Sparkles,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { v2Calls, v2Contacts } from '../../services/apiV2';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';

function parseUtcDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  const s = String(raw).trim();
  const normalized = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.test(s)
    ? `${s.replace(' ', 'T')}Z`
    : s;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatCallTimestamp(iso) {
  const d = parseUtcDate(iso);
  if (!d) return '';
  if (isToday(d)) return `Today, ${format(d, 'h:mm a')}`;
  if (isYesterday(d)) return `Yesterday, ${format(d, 'h:mm a')}`;
  return format(d, 'MMM d, h:mm a');
}

function callStatusMeta(call) {
  const isOutgoing = call.direction === 'outgoing';
  if (call.status === 'accepted') {
    return {
      label: isOutgoing ? 'Outgoing call' : 'Incoming call',
      tone: 'text-emerald-600 dark:text-emerald-400',
      badgeClass: 'text-emerald-600 dark:text-emerald-400',
      Icon: isOutgoing ? PhoneOutgoing : PhoneIncoming,
    };
  }
  if (call.status === 'missed') {
    return {
      label: isOutgoing ? 'No answer' : 'Missed call',
      tone: 'text-destructive',
      badgeClass: 'border-destructive/40 bg-destructive/10 text-destructive',
      Icon: PhoneMissed,
    };
  }
  if (call.status === 'declined') {
    return {
      label: isOutgoing ? 'Declined' : 'Declined call',
      tone: 'text-amber-600 dark:text-amber-400',
      badgeClass: 'text-amber-600 dark:text-amber-400',
      Icon: PhoneMissed,
    };
  }
  if (call.status === 'canceled') {
    return {
      label: isOutgoing ? 'Canceled' : 'Missed call',
      tone: 'text-muted-foreground',
      badgeClass: 'text-muted-foreground',
      Icon: PhoneMissed,
    };
  }
  return {
    label: 'Ringing…',
    tone: 'text-primary',
    badgeClass: 'text-primary',
    Icon: isOutgoing ? PhoneOutgoing : PhoneIncoming,
  };
}

export default function DirectCallsSection({ hostDisplayName, fullPage = false }) {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState([]);
  const [callHistory, setCallHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('contacts'); // 'contacts' | 'history' | 'missed'
  const [loading, setLoading] = useState(true);
  const [callingKey, setCallingKey] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [savingContact, setSavingContact] = useState(false);

  const loadAll = () => {
    Promise.all([
      v2Contacts.list().catch(() => ({ contacts: [] })),
      v2Calls.history().catch(() => ({ calls: [] })),
    ])
      .then(([cRes, hRes]) => {
        setContacts(cRes.contacts || []);
        setCallHistory(hRes.calls || []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAll();
  }, []);

  const missedIncomingCount = callHistory.filter(
    (c) => c.direction === 'incoming' && (c.status === 'missed' || c.status === 'canceled')
  ).length;

  const enterCallRoom = (data) => {
    const { call, meeting } = data;
    const participantName = (hostDisplayName || '').trim() || 'Host';
    const participantInfo = {
      isHost: true,
      participantName,
      hostCode: meeting.hostCode,
      shareableLink: meeting.joinUrl,
      shareableLinkNetwork: meeting.joinUrl,
      roomName: meeting.livekitRoomName,
      meetingId: meeting.id,
      inviteToken: '',
    };
    try {
      sessionStorage.setItem('participantInfo', JSON.stringify(participantInfo));
    } catch {
      /* ignore */
    }
    navigate(`/room/${encodeURIComponent(meeting.livekitRoomName)}`, {
      state: {
        ...participantInfo,
        meetingTitle: meeting.title,
        directCall: call,
      },
    });
  };

  const handleCallContact = async (contact) => {
    if (callingKey) return;
    setCallingKey(contact.id);
    try {
      const data = await v2Calls.start({ contactId: contact.id });
      toast.success(`Ringing ${contact.name}…`);
      enterCallRoom(data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not start call');
      setCallingKey(null);
    }
  };

  const handleCallByEmail = async (email, name, key) => {
    if (callingKey || !email) return;
    setCallingKey(key || email);
    try {
      const data = await v2Calls.start({ email, name: name || undefined });
      toast.success(`Ringing ${name || email}…`);
      enterCallRoom(data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not start call');
      setCallingKey(null);
    }
  };

  const handleQuickCallOrSave = async (e, mode = 'call') => {
    e?.preventDefault?.();
    const email = emailInput.trim();
    const name = nameInput.trim();
    if (!email || !email.includes('@')) {
      toast.error('Enter a valid email address');
      return;
    }

    if (mode === 'save') {
      setSavingContact(true);
      try {
        const res = await v2Contacts.save({ email, name: name || undefined });
        if (res.contact) {
          setContacts((prev) => {
            const filtered = prev.filter((c) => c.id !== res.contact.id);
            return [res.contact, ...filtered];
          });
        }
        setEmailInput('');
        setNameInput('');
        setShowAddForm(false);
        setActiveTab('contacts');
        toast.success('Saved to contacts');
      } catch (err) {
        toast.error(err.response?.data?.error || 'Could not save contact');
      } finally {
        setSavingContact(false);
      }
      return;
    }

    setCallingKey('quick');
    try {
      const data = await v2Calls.start({ email, name: name || undefined });
      toast.success(`Ringing ${data.contact?.name || email}…`);
      enterCallRoom(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not start call');
      setCallingKey(null);
    }
  };

  const handleRemoveContact = async (id, name) => {
    try {
      await v2Contacts.remove(id);
      setContacts((prev) => prev.filter((c) => c.id !== id));
      toast.success(`Removed ${name}`);
    } catch {
      toast.error('Could not remove contact');
    }
  };

  const filteredCalls =
    activeTab === 'missed'
      ? callHistory.filter(
          (c) => c.status === 'missed' || c.status === 'declined' || c.status === 'canceled'
        )
      : callHistory;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!fullPage ? (
          <div>
            <h2 className="text-sm font-semibold text-foreground">Direct calls &amp; contacts</h2>
            <p className="text-xs text-muted-foreground">
              Call contacts 1-on-1, view call history &amp; missed calls, and open AI transcripts &amp; summaries.
            </p>
          </div>
        ) : <div />}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border/80 bg-muted/30 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('contacts')}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                activeTab === 'contacts'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Contacts ({contacts.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                activeTab === 'history'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Call log ({callHistory.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('missed')}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors ${
                activeTab === 'missed'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Missed
              {missedIncomingCount > 0 && (
                <span className="rounded-full bg-destructive px-1.5 py-0 text-[10px] font-semibold text-destructive-foreground">
                  {missedIncomingCount}
                </span>
              )}
            </button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => setShowAddForm((v) => !v)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add contact
          </Button>
        </div>
      </div>

      {showAddForm && (
        <form
          onSubmit={(e) => handleQuickCallOrSave(e, 'save')}
          className="rounded-xl border border-border/80 bg-card p-4 shadow-sm space-y-3"
        >
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Name (e.g. Carlos)"
              maxLength={80}
            />
            <Input
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="Email address"
              required
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAddForm(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={savingContact || callingKey === 'quick'}
            >
              {savingContact ? 'Saving…' : 'Save contact'}
            </Button>
            <Button
              type="button"
              size="sm"
              className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500"
              disabled={savingContact || callingKey === 'quick'}
              onClick={(e) => handleQuickCallOrSave(e, 'call')}
            >
              <Phone className="h-3.5 w-3.5" />
              {callingKey === 'quick' ? 'Calling…' : 'Save & Call now'}
            </Button>
          </div>
        </form>
      )}

      {activeTab === 'contacts' ? (
        !loading && contacts.length === 0 && !showAddForm ? (
          <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-dashed border-border/80 bg-card/40 p-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Users className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No saved contacts yet</p>
                <p className="text-xs text-muted-foreground">
                  Add friends or teammates to call them in 1 tap — works whether they have the Lalia app or join via web link.
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="shrink-0 gap-1.5"
              onClick={() => setShowAddForm(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add first contact
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/80 bg-card">
            {contacts.map((contact) => {
              const initial = (contact.name || contact.email || '?').charAt(0).toUpperCase();
              const isCalling = callingKey === contact.id;
              return (
                <div
                  key={contact.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {initial}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate text-sm font-medium text-foreground">
                          {contact.name}
                        </p>
                        {contact.isTeammate && (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-medium text-primary">
                            Teammate
                          </Badge>
                        )}
                        {contact.hasAccount ? (
                          <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                            <UserCheck className="h-2.5 w-2.5" />
                            On Lalia
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground">
                            Guest link
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{contact.email}</p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 gap-1.5 bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-500"
                      disabled={Boolean(callingKey)}
                      onClick={() => handleCallContact(contact)}
                    >
                      <Phone className="h-3.5 w-3.5" />
                      {isCalling ? 'Calling…' : 'Call'}
                    </Button>
                    {contact.isSavedContact !== false && (
                      <button
                        type="button"
                        onClick={() => handleRemoveContact(contact.id, contact.name)}
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                        aria-label={`Remove ${contact.name}`}
                        title={`Remove ${contact.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : filteredCalls.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 bg-card/40 p-6 text-center">
          <p className="text-sm font-medium text-foreground">
            {activeTab === 'missed' ? 'No missed calls' : 'No call history yet'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {activeTab === 'missed'
              ? 'You’re all caught up on incoming calls.'
              : 'Direct calls you place or receive will appear here with their transcripts and AI summaries.'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/80 bg-card">
          {filteredCalls.map((call) => {
            const meta = callStatusMeta(call);
            const StatusIcon = meta.Icon;
            const isCallingBack = callingKey === `hist-${call.id}`;

            return (
              <div
                key={call.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted ${meta.tone}`}
                  >
                    <StatusIcon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-foreground">
                        {call.counterpartName}
                      </p>
                      <Badge variant="outline" className={`px-1.5 py-0 text-[10px] font-medium ${meta.badgeClass}`}>
                        {meta.label}
                      </Badge>
                      {call.transcriptLineCount > 0 && (
                        <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px] font-normal">
                          <FileText className="h-2.5 w-2.5" />
                          {call.transcriptLineCount} lines
                        </Badge>
                      )}
                      {call.reportCount > 0 && (
                        <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px] font-normal text-primary">
                          <Sparkles className="h-2.5 w-2.5" />
                          AI summary
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatCallTimestamp(call.createdAt)}
                      {call.counterpartEmail ? ` · ${call.counterpartEmail}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {call.meetingId && (
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 px-2.5 text-xs"
                    >
                      <Link to={`/v2/app/meetings/${encodeURIComponent(call.meetingId)}`}>
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                        Transcript &amp; AI
                      </Link>
                    </Button>
                  )}
                  {call.counterpartEmail && (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 gap-1.5 bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-500"
                      disabled={Boolean(callingKey)}
                      onClick={() =>
                        handleCallByEmail(
                          call.counterpartEmail,
                          call.counterpartName,
                          `hist-${call.id}`
                        )
                      }
                    >
                      <Phone className="h-3.5 w-3.5" />
                      {isCallingBack ? 'Calling…' : 'Call back'}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
