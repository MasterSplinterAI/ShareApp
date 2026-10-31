import { useEffect, useState } from 'react';
import { Copy, Check, Smartphone, Laptop, Phone, Share2, Send } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { v2Calls, v2Contacts } from '../services/apiV2';

function ShareModal({
  shareableLink,
  shareableLinkNetwork,
  hostCode,
  meetingId,
  roomName,
  onClose,
}) {
  const [copiedLink, setCopiedLink] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [ringingId, setRingingId] = useState(null);
  const [rungIds, setRungIds] = useState(() => new Set());
  const [quickEmail, setQuickEmail] = useState('');
  const [quickName, setQuickName] = useState('');

  const hasAuthToken =
    typeof localStorage !== 'undefined' && Boolean(localStorage.getItem('v2_token'));
  const canNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    if (!hasAuthToken) return;
    v2Contacts
      .list()
      .then((res) => setContacts(res.contacts || []))
      .catch(() => {});
  }, [hasAuthToken]);

  const copyToClipboard = async (text, type) => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'code') {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      } else {
        setCopiedLink(type);
        setTimeout(() => setCopiedLink(null), 2000);
      }
      toast.success('Copied to clipboard!');
    } catch {
      toast.error('Failed to copy');
    }
  };

  const handleNativeShare = async () => {
    if (!canNativeShare) {
      copyToClipboard(shareableLink, 'direct');
      return;
    }
    try {
      await navigator.share({
        title: 'Join my Lalia call (live translation)',
        text: 'Tap to join my call with live translation and captions:',
        url: shareableLink,
      });
    } catch {
      /* user canceled share sheet */
    }
  };

  const handleRingContact = async (contact) => {
    if (ringingId) return;
    setRingingId(contact.id);
    try {
      await v2Calls.start({
        contactId: contact.id,
        meetingId: meetingId || undefined,
        roomName: roomName || undefined,
      });
      setRungIds((prev) => new Set([...prev, contact.id]));
      toast.success(`Ringing ${contact.name} & sent join link!`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not ring contact');
    } finally {
      setRingingId(null);
    }
  };

  const handleRingByEmail = async (e) => {
    e.preventDefault();
    const email = quickEmail.trim();
    if (!email || !email.includes('@')) {
      toast.error('Enter a valid email address');
      return;
    }
    setRingingId('email');
    try {
      const res = await v2Calls.start({
        email,
        name: quickName.trim() || undefined,
        meetingId: meetingId || undefined,
        roomName: roomName || undefined,
      });
      if (res.contact) {
        setContacts((prev) => {
          const filtered = prev.filter((c) => c.id !== res.contact.id);
          return [res.contact, ...filtered];
        });
        setRungIds((prev) => new Set([...prev, res.contact.id]));
      }
      setQuickEmail('');
      setQuickName('');
      toast.success(`Ringing ${res.contact?.name || email} & sent join link!`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not ring email');
    } finally {
      setRingingId(null);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto border-border/80 bg-card">
        <DialogHeader>
          <DialogTitle>Invite or ring into call</DialogTitle>
          <DialogDescription>
            Ring a contact directly in the app, or share a guest link for anyone joining via web or mobile.
          </DialogDescription>
        </DialogHeader>

        {hasAuthToken && (meetingId || roomName) && (
          <div className="space-y-3 rounded-xl border border-border/80 bg-muted/20 p-3.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ring a contact into this call
            </p>

            {contacts.length > 0 && (
              <div className="max-h-36 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border/70 bg-background">
                {contacts.map((c) => {
                  const isRinging = ringingId === c.id;
                  const wasRung = rungIds.has(c.id);
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-2 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-foreground">{c.name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{c.email}</p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={wasRung ? 'secondary' : 'default'}
                        className={`h-7 shrink-0 gap-1 px-2.5 text-xs ${
                          wasRung ? '' : 'bg-emerald-600 text-white hover:bg-emerald-500'
                        }`}
                        disabled={Boolean(ringingId)}
                        onClick={() => handleRingContact(c)}
                      >
                        <Phone className="h-3 w-3" />
                        {isRinging ? 'Ringing…' : wasRung ? 'Ring again' : 'Ring'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            <form onSubmit={handleRingByEmail} className="space-y-2">
              <div className="flex gap-2">
                <Input
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  placeholder="Name (optional)"
                  className="h-9 text-xs"
                />
                <Input
                  type="email"
                  value={quickEmail}
                  onChange={(e) => setQuickEmail(e.target.value)}
                  placeholder="Ring or invite email…"
                  className="h-9 text-xs"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                className="w-full gap-1.5 text-xs"
                disabled={Boolean(ringingId)}
              >
                <Send className="h-3.5 w-3.5" />
                {ringingId === 'email' ? 'Ringing…' : 'Ring & email join link'}
              </Button>
            </form>
          </div>
        )}

        <div className="space-y-3">
          {canNativeShare && (
            <Button
              type="button"
              className="w-full gap-2"
              onClick={handleNativeShare}
            >
              <Share2 className="h-4 w-4" />
              Share guest link (Messages, WhatsApp…)
            </Button>
          )}

          <div>
            <div className="mb-1 flex items-center gap-2">
              <Laptop className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Guest link (joins via web or app)</span>
            </div>
            <div className="flex items-center gap-2">
              <Input type="text" value={shareableLink} readOnly aria-label="Direct link" className="font-mono text-xs" />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="shrink-0"
                onClick={() => copyToClipboard(shareableLink, 'direct')}
                aria-label={copiedLink === 'direct' ? 'Direct link copied' : 'Copy direct link'}
                title="Copy direct link"
              >
                {copiedLink === 'direct' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {shareableLinkNetwork && shareableLinkNetwork !== shareableLink && (
            <div>
              <div className="mb-1 flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Network link (same Wi‑Fi)</span>
              </div>
              <div className="flex items-center gap-2">
                <Input type="text" value={shareableLinkNetwork} readOnly aria-label="Network link" className="font-mono text-xs" />
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="shrink-0"
                  onClick={() => copyToClipboard(shareableLinkNetwork, 'network')}
                  aria-label={copiedLink === 'network' ? 'Network link copied' : 'Copy network link'}
                  title="Copy network link"
                >
                  {copiedLink === 'network' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-center rounded-lg border border-border/60 bg-white p-3">
          <QRCodeSVG value={shareableLink} size={148} />
        </div>

        {hostCode && (
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="mb-1 text-xs text-muted-foreground">Host code (rejoining)</p>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xl font-bold tracking-wider text-primary">{hostCode}</span>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="ml-auto shrink-0"
                onClick={() => copyToClipboard(hostCode, 'code')}
                aria-label={copiedCode ? 'Host code copied' : 'Copy host code'}
                title="Copy host code"
              >
                {copiedCode ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ShareModal;
