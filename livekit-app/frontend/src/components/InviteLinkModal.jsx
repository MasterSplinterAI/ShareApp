import { useRef, useState } from 'react';
import { Copy, Check, Share2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';

/**
 * Copy/Share triggered by direct user gesture (fixes mobile Safari clipboard).
 */
function InviteLinkModal({ inviteLink, onClose }) {
  const inputRef = useRef(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e) => {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast.success('Link copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      inputRef.current?.select();
      toast.success('Link selected — long-press to copy');
    }
  };

  const handleShare = async (e) => {
    e.preventDefault();
    if (!navigator.share) {
      handleCopy(e);
      return;
    }
    try {
      await navigator.share({
        title: 'Join JarMetals Conference',
        text: 'Join my JarMetals Conference meeting – video with real-time translation and captions',
        url: inviteLink,
      });
      toast.success('Shared!');
    } catch (err) {
      if (err.name !== 'AbortError') {
        handleCopy(e);
      }
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-border/80 bg-card">
        <DialogHeader>
          <DialogTitle>Invite link created</DialogTitle>
          <DialogDescription>Share this link with others to invite them to your meeting.</DialogDescription>
        </DialogHeader>
        <Input ref={inputRef} type="text" value={inviteLink} readOnly className="font-mono text-sm select-all" />
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {typeof navigator !== 'undefined' && navigator.share && (
            <Button type="button" className="gap-2" onClick={handleShare}>
              <Share2 className="h-4 w-4" />
              Share
            </Button>
          )}
          <Button type="button" variant="secondary" className="gap-2" onClick={handleCopy}>
            {copied ? (
              <>
                <Check className="h-4 w-4 text-emerald-500" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Copy
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default InviteLinkModal;
