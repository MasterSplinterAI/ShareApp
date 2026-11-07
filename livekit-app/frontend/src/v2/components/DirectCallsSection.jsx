import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format, isToday, isYesterday } from 'date-fns';
import {
  Bell,
  FileText,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Plus,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { v2Calls, v2Contacts, v2Push } from '../../services/apiV2';
import { unlockIncomingCallAudio } from './IncomingCallOverlay';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { useTranslation } from '../../lib/i18n/I18nProvider';

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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [contacts, setContacts] = useState([]);
  const [addedYou, setAddedYou] = useState([]);
  const [callHistory, setCallHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('contacts'); // 'contacts' | 'history' | 'missed'
  const [loading, setLoading] = useState(true);
  const [callingKey, setCallingKey] = useState(null);
  const [busyRequestKey, setBusyRequestKey] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [savingContact, setSavingContact] = useState(false);
  const [notifPerm, setNotifPerm] = useState(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('lalia_call_alerts_enabled') === '1') {
      return 'granted';
    }
    return typeof Notification !== 'undefined' ? Notification.permission : 'default';
  });

  const enablePushNotifications = async () => {
    unlockIncomingCallAudio();

    const hasIosBridge =
      typeof window !== 'undefined' &&
      (Boolean(window.LaliaIOS) || Boolean(window.webkit?.messageHandlers?.laliaIOS));

    if (hasIosBridge) {
      try {
        const token = localStorage.getItem('v2_token') || '';
        window.LaliaIOS?.setAuthToken?.(token);
        window.LaliaIOS?.requestNotificationPermission?.();
        window.webkit?.messageHandlers?.laliaIOS?.postMessage?.({
          action: 'requestNotificationPermission',
          token,
        });
        if (window.__laliaIosTokens?.voipToken || window.__laliaIosTokens?.apnsToken) {
          await v2Push.registerIosToken({
            voipToken: window.__laliaIosTokens.voipToken || undefined,
            apnsToken: window.__laliaIosTokens.apnsToken || undefined,
            bundleId: window.__laliaIosTokens.bundleId || 'cloud.lalia.app',
            environment: window.__laliaIosTokens.environment || 'sandbox',
          });
        }
        localStorage.setItem('lalia_call_alerts_enabled', '1');
        setNotifPerm('granted');
        toast.success('iOS call alerts & ringtone enabled!');
        return;
      } catch {
        /* fall through */
      }
    }

    if (typeof Notification === 'undefined') {
      localStorage.setItem('lalia_call_alerts_enabled', '1');
      setNotifPerm('granted');
      toast.success(
        'In-app call ringtone enabled! For lock-screen alerts without the native update, open lalia.cloud in Safari → Share → Add to Home Screen.'
      );
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      setNotifPerm(perm);
      if (perm !== 'granted') {
        toast.error('Notification permission was not granted');
        return;
      }
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        const reg = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        const { publicKey } = await v2Push.vapidPublicKey();
        if (publicKey) {
          const padding = '='.repeat((4 - (publicKey.length % 4)) % 4);
          const base64 = (publicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
          const rawData = window.atob(base64);
          const keyArray = new Uint8Array(rawData.length);
          for (let i = 0; i < rawData.length; ++i) keyArray[i] = rawData.charCodeAt(i);
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyArray,
          });
          await v2Push.subscribe(sub.toJSON ? sub.toJSON() : sub);
        }
      }
      localStorage.setItem('lalia_call_alerts_enabled', '1');
      toast.success('Call notifications enabled for this device!');
    } catch {
      toast.error('Could not enable push notifications on this device');
    }
  };

  const loadAll = () => {
    Promise.all([
      v2Contacts.list().catch(() => ({ contacts: [], addedYou: [] })),
      v2Calls.history().catch(() => ({ calls: [] })),
    ])
      .then(([cRes, hRes]) => {
        setContacts(cRes.contacts || []);
        setAddedYou(cRes.addedYou || []);
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
            const filtered = prev.filter(
              (c) =>
                c.id !== res.contact.id &&
                String(c.email || '').toLowerCase() !== String(res.contact.email || '').toLowerCase()
            );
            return [res.contact, ...filtered];
          });
          setAddedYou((prev) =>
            prev.filter(
              (r) => String(r.email || '').toLowerCase() !== String(res.contact.email || '').toLowerCase()
            )
          );
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

  const handleAcceptRequest = async (reqItem) => {
    const reqId = reqItem.requestId || reqItem.id;
    if (!reqId || busyRequestKey) return;
    setBusyRequestKey(`accept-${reqId}`);
    try {
      const res = await v2Contacts.acceptRequest(reqId, { name: reqItem.name });
      if (res.contact) {
        setContacts((prev) => {
          const filtered = prev.filter(
            (c) =>
              c.id !== res.contact.id &&
              String(c.email || '').toLowerCase() !== String(res.contact.email || '').toLowerCase()
          );
          return [res.contact, ...filtered];
        });
      }
      setAddedYou((prev) => prev.filter((r) => (r.requestId || r.id) !== reqId));
      toast.success(`Added ${reqItem.name || reqItem.email} to contacts`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not add contact');
    } finally {
      setBusyRequestKey(null);
    }
  };

  const handleDismissRequest = async (reqItem) => {
    const reqId = reqItem.requestId || reqItem.id;
    if (!reqId || busyRequestKey) return;
    setBusyRequestKey(`dismiss-${reqId}`);
    try {
      await v2Contacts.dismissRequest(reqId);
      setAddedYou((prev) => prev.filter((r) => (r.requestId || r.id) !== reqId));
    } catch {
      toast.error('Could not dismiss request');
    } finally {
      setBusyRequestKey(null);
    }
  };

  const handleAddFromCallHistory = async (call) => {
    if (!call?.counterpartEmail || busyRequestKey) return;
    const key = `hist-add-${call.id}`;
    setBusyRequestKey(key);
    try {
      const res = await v2Contacts.save({
        email: call.counterpartEmail,
        name: call.counterpartName || undefined,
      });
      if (res.contact) {
        setContacts((prev) => {
          const filtered = prev.filter(
            (c) =>
              c.id !== res.contact.id &&
              String(c.email || '').toLowerCase() !== String(res.contact.email || '').toLowerCase()
          );
          return [res.contact, ...filtered];
        });
        setAddedYou((prev) =>
          prev.filter(
            (r) =>
              String(r.email || '').toLowerCase() !== String(res.contact.email || '').toLowerCase()
          )
        );
      }
      toast.success(`Added ${call.counterpartName || call.counterpartEmail} to contacts`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save contact');
    } finally {
      setBusyRequestKey(null);
    }
  };

  const savedEmailSet = new Set(
    contacts.map((c) => String(c.email || '').trim().toLowerCase()).filter(Boolean)
  );

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
            <h2 className="text-sm font-semibold text-foreground">{t('calls.sectionTitle')}</h2>
            <p className="text-xs text-muted-foreground">
              {t('calls.sectionSubtitle')}
            </p>
          </div>
        ) : <div />}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border/80 bg-muted/30 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('contacts')}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors ${
                activeTab === 'contacts'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>
                {t('calls.contactsTab')} ({contacts.length})
              </span>
              {addedYou.length > 0 && (
                <span
                  className="rounded-full bg-primary px-1.5 py-0 text-[10px] font-semibold text-primary-foreground"
                  title={`${addedYou.length} added you`}
                >
                  +{addedYou.length}
                </span>
              )}
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
              {t('calls.callLogTab')} ({callHistory.length})
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
              {t('calls.missedTab')}
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
            {t('calls.addContact')}
          </Button>
          {notifPerm === 'default' && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={enablePushNotifications}
            >
              <Bell className="h-3.5 w-3.5 text-primary" />
              Enable call alerts
            </Button>
          )}
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
        <div className="space-y-3">
          {addedYou.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-primary/30 bg-primary/5 shadow-sm">
              <div className="flex items-center justify-between gap-2 border-b border-primary/15 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4 text-primary" />
                  <p className="text-xs font-semibold text-foreground">
                    Added you ({addedYou.length})
                  </p>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Tap + Add back to save them to your contacts
                </span>
              </div>
              <div className="divide-y divide-border/50">
                {addedYou.map((reqItem) => {
                  const reqId = reqItem.requestId || reqItem.id;
                  const initial = (reqItem.name || reqItem.email || '?')
                    .charAt(0)
                    .toUpperCase();
                  const isAccepting = busyRequestKey === `accept-${reqId}`;
                  const isDismissing = busyRequestKey === `dismiss-${reqId}`;
                  return (
                    <div
                      key={reqId}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                          {initial}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="truncate text-sm font-medium text-foreground">
                              {reqItem.name}
                            </p>
                            <Badge
                              variant="secondary"
                              className="px-1.5 py-0 text-[10px] font-medium text-primary"
                            >
                              Added you
                            </Badge>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {reqItem.email}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 gap-1.5 px-3 text-xs font-medium"
                          disabled={Boolean(busyRequestKey)}
                          onClick={() => handleAcceptRequest(reqItem)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          {isAccepting ? 'Adding…' : '+ Add back'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                          disabled={Boolean(busyRequestKey)}
                          onClick={() => handleDismissRequest(reqItem)}
                        >
                          <X className="h-3.5 w-3.5" />
                          {isDismissing ? '…' : 'Dismiss'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!loading && contacts.length === 0 && !showAddForm ? (
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
            contacts.length > 0 && (
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
          )}
        </div>
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
                  {call.direction === 'incoming' &&
                    call.counterpartEmail &&
                    !savedEmailSet.has(String(call.counterpartEmail).trim().toLowerCase()) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 px-2.5 text-xs"
                        disabled={Boolean(busyRequestKey)}
                        onClick={() => handleAddFromCallHistory(call)}
                      >
                        <UserPlus className="h-3.5 w-3.5 text-primary" />
                        {busyRequestKey === `hist-add-${call.id}` ? 'Adding…' : '+ Add contact'}
                      </Button>
                    )}
                  {call.meetingId && (
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 px-2.5 text-xs"
                    >
                      <Link to={`/v2/app/meetings/${encodeURIComponent(call.meetingId)}?tab=insights`}>
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
