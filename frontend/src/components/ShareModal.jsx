import { useState, useEffect } from 'react';
import { generateQRCode } from '../utils/qrGenerator';

const ShareModal = ({ isOpen, onClose, meetingId, shareableLink, shareableLinkNetwork, hostCode }) => {
  const [qrCode, setQrCode] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Use network link for QR code if available, otherwise use localhost link
    const linkForQR = shareableLinkNetwork || shareableLink;
    if (isOpen && linkForQR) {
      generateQRCode(linkForQR)
        .then(setQrCode)
        .catch(console.error);
    }
  }, [isOpen, shareableLink, shareableLinkNetwork]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareableLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleShare = async () => {
    // Use network link if available for sharing
    const linkToShare = shareableLinkNetwork || shareableLink;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join my meeting',
          text: 'Join my video meeting',
          url: linkToShare,
        });
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Share failed:', error);
        }
      }
    } else {
      // Copy network link if available
      try {
        await navigator.clipboard.writeText(linkToShare);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (error) {
        console.error('Failed to copy:', error);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-gray-800">Share Meeting</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          {/* Meeting Link - Network Access */}
          {shareableLinkNetwork && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Share Link (for other devices on your network)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={shareableLinkNetwork}
                  readOnly
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-blue-50 text-sm font-mono"
                />
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(shareableLinkNetwork);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    } catch (error) {
                      console.error('Failed to copy:', error);
                    }
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Use this link to share with others on your local network
              </p>
            </div>
          )}

          {/* Meeting Link - Localhost */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Meeting Link (localhost)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={shareableLink}
                readOnly
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm font-mono"
              />
              <button
                onClick={handleCopyLink}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Meeting ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Meeting ID
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={meetingId}
                readOnly
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm font-mono"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(meetingId);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Copy
              </button>
            </div>
          </div>

          {/* Host Code (if provided) */}
          {hostCode && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Host Code (for rejoin)
              </label>
              <div className="px-4 py-2 border border-gray-300 rounded-lg bg-blue-50 text-sm font-mono text-blue-800">
                {hostCode}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Save this code to rejoin as host later
              </p>
            </div>
          )}

          {/* QR Code */}
          {qrCode && (
            <div className="flex flex-col items-center pt-4 border-t">
              <p className="text-sm font-medium text-gray-700 mb-2">Scan to join</p>
              <img src={qrCode} alt="QR Code" className="w-48 h-48 border border-gray-300 rounded-lg" />
            </div>
          )}

          {/* Share Button */}
          <div className="pt-4">
            <button
              onClick={handleShare}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              {navigator.share ? 'Share via...' : 'Copy Link'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShareModal;

