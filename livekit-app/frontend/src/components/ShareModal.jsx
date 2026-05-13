import { useState } from 'react';
import { Copy, Check, Smartphone, Laptop } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';

function ShareModal({ shareableLink, shareableLinkNetwork, hostCode, onClose }) {
  const [copiedLink, setCopiedLink] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);

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
    } catch (err) {
      toast.error('Failed to copy');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-border/80 bg-card">
        <DialogHeader>
          <DialogTitle>Share meeting</DialogTitle>
        </DialogHeader>
        <div className="flex justify-center rounded-lg bg-white p-4">
          <QRCodeSVG value={shareableLink} size={200} />
        </div>
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Laptop className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Direct link</span>
            </div>
            <div className="flex items-center gap-2">
              <Input type="text" value={shareableLink} readOnly className="font-mono text-xs" />
              <Button type="button" variant="secondary" size="icon" onClick={() => copyToClipboard(shareableLink, 'direct')}>
                {copiedLink === 'direct' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          {shareableLinkNetwork && (
            <div>
              <div className="mb-1 flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Network link (same Wi‑Fi)</span>
              </div>
              <div className="flex items-center gap-2">
                <Input type="text" value={shareableLinkNetwork} readOnly className="font-mono text-xs" />
                <Button type="button" variant="secondary" size="icon" onClick={() => copyToClipboard(shareableLinkNetwork, 'network')}>
                  {copiedLink === 'network' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}
        </div>
        {hostCode && (
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="mb-2 text-sm text-muted-foreground">Host code (rejoining)</p>
            <div className="flex items-center gap-2">
              <span className="font-mono text-2xl font-bold text-primary">{hostCode}</span>
              <Button type="button" variant="secondary" size="icon" className="ml-auto" onClick={() => copyToClipboard(hostCode, 'code')}>
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
