import { useRef, useState } from 'react';
import { X, Copy, Check, Share2 } from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * Modal for displaying a created invite link.
 * Copy/Share are triggered by direct user gesture (button tap), which fixes
 * navigator.clipboard.writeText() failing on mobile Safari - that API requires
 * synchronous execution within a user gesture and fails when called after async ops.
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
      // Fallback: select text so user can manually copy (works on mobile)
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-white">Invite Link Created</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-gray-400 text-sm mb-3">
          Share this link with others to invite them to your meeting.
        </p>
        <div className="flex gap-2 mb-4">
          <input
            ref={inputRef}
            type="text"
            value={inviteLink}
            readOnly
            className="flex-1 bg-gray-700 text-gray-300 px-3 py-2 rounded text-sm font-mono select-all"
          />
        </div>
        <div className="flex gap-2">
          {navigator.share && (
            <button
              onClick={handleShare}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Share2 className="w-4 h-4" />
              Share
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-green-400" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default InviteLinkModal;
