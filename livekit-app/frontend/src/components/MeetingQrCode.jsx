import { useRef, useState } from 'react';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { Check, Copy, Download, Maximize2, QrCode, Share2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

export function QrCodeShareCard({
  url,
  title = 'Scan to join on Lalia',
  subtitle = 'Point any phone camera at this QR code to join in browser or app',
  compact = false,
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const canvasWrapRef = useRef(null);

  if (!url) return null;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Copied join link!');
    } catch {
      toast.error('Could not copy link');
    }
  };

  const handleDownloadPng = () => {
    try {
      const canvas = canvasWrapRef.current?.querySelector('canvas');
      if (!canvas) {
        toast.error('Could not generate QR image');
        return;
      }
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'lalia-meeting-qr.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success('Downloaded QR code');
    } catch {
      toast.error('Could not download QR code');
    }
  };

  return (
    <>
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border/70 bg-muted/20 p-3.5">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="group relative flex items-center justify-center rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Tap to enlarge QR code"
          aria-label="Enlarge QR code"
        >
          <QRCodeSVG
            value={url}
            size={compact ? 136 : 164}
            level="M"
            includeMargin={false}
          />
          <span className="pointer-events-none absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-md bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
            <Maximize2 className="h-2.5 w-2.5" />
            Enlarge
          </span>
        </button>

        {/* Hidden high-res canvas for crisp PNG downloads */}
        <div ref={canvasWrapRef} className="hidden" aria-hidden="true">
          <QRCodeCanvas value={url} size={512} level="H" includeMargin />
        </div>

        <div className="text-center">
          <p className="text-xs font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-xs"
            onClick={() => setExpanded(true)}
          >
            <Maximize2 className="h-3 w-3" />
            Expand QR
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-xs"
            onClick={handleDownloadPng}
          >
            <Download className="h-3 w-3" />
            Download PNG
          </Button>
        </div>
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm border-border/80 bg-card text-center">
          <DialogHeader>
            <DialogTitle className="text-center">{title}</DialogTitle>
            <DialogDescription className="text-center">
              Anyone can scan this QR code with their phone camera to join via web browser or the Lalia app.
            </DialogDescription>
          </DialogHeader>
          <div className="mx-auto flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-5 shadow-md">
            <QRCodeSVG value={url} size={240} level="M" includeMargin={false} />
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">{url}</p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={handleCopyLink}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={handleDownloadPng}
            >
              <Download className="h-3.5 w-3.5" />
              Download PNG
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function QrCodeDialogButton({
  url,
  meetingTitle,
  variant = 'outline',
  size = 'sm',
  className = '',
  label = 'QR code',
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const canvasWrapRef = useRef(null);

  if (!url) return null;

  const canNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Copied guest link!');
    } catch {
      toast.error('Could not copy link');
    }
  };

  const handleDownload = () => {
    try {
      const canvas = canvasWrapRef.current?.querySelector('canvas');
      if (!canvas) return;
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${(meetingTitle || 'lalia-meeting').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-qr.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success('Downloaded QR code');
    } catch {
      toast.error('Could not download QR code');
    }
  };

  const handleShare = async () => {
    if (!canNativeShare) {
      handleCopy();
      return;
    }
    try {
      await navigator.share({
        title: meetingTitle ? `Join "${meetingTitle}" on Lalia` : 'Join my Lalia meeting',
        text: 'Scan or tap to join with live multilingual translation:',
        url,
      });
    } catch {
      /* user canceled */
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
      >
        <QrCode className="h-4 w-4 shrink-0" />
        {label ? <span>{label}</span> : null}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm border-border/80 bg-card text-center">
          <DialogHeader>
            <DialogTitle className="text-center">
              {meetingTitle ? `Scan to join "${meetingTitle}"` : 'Scan to join meeting'}
            </DialogTitle>
            <DialogDescription className="text-center">
              Guests can scan this QR code with their phone camera to join immediately in their mobile browser or the Lalia app.
            </DialogDescription>
          </DialogHeader>

          <div className="mx-auto flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-5 shadow-md">
            <QRCodeSVG value={url} size={232} level="M" includeMargin={false} />
          </div>

          <div ref={canvasWrapRef} className="hidden" aria-hidden="true">
            <QRCodeCanvas value={url} size={512} level="H" includeMargin />
          </div>

          <p className="truncate rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
            {url}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <Button type="button" size="sm" className="gap-1.5 text-xs" onClick={handleCopy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={handleDownload}
            >
              <Download className="h-3.5 w-3.5" />
              Download PNG
            </Button>
            {canNativeShare && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={handleShare}
              >
                <Share2 className="h-3.5 w-3.5" />
                Share
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
