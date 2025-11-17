import { useState } from 'react';
import { X, Copy, Check, Smartphone, Laptop } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';

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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-white">Share Meeting</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* QR Code */}
        <div className="bg-white p-4 rounded-lg mb-6 flex justify-center">
          <QRCodeSVG value={shareableLink} size={200} />
        </div>

        {/* Shareable Links */}
        <div className="space-y-3 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Laptop className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-400">Direct Link</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={shareableLink}
                readOnly
                className="flex-1 bg-gray-700 text-gray-300 px-3 py-2 rounded text-sm font-mono"
              />
              <button
                onClick={() => copyToClipboard(shareableLink, 'direct')}
                className="bg-gray-700 hover:bg-gray-600 p-2 rounded transition-colors"
              >
                {copiedLink === 'direct' ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4 text-gray-300" />
                )}
              </button>
            </div>
          </div>

          {shareableLinkNetwork && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Smartphone className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-400">Network Link (Same WiFi)</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={shareableLinkNetwork}
                  readOnly
                  className="flex-1 bg-gray-700 text-gray-300 px-3 py-2 rounded text-sm font-mono"
                />
                <button
                  onClick={() => copyToClipboard(shareableLinkNetwork, 'network')}
                  className="bg-gray-700 hover:bg-gray-600 p-2 rounded transition-colors"
                >
                  {copiedLink === 'network' ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4 text-gray-300" />
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Host Code */}
        {hostCode && (
          <div className="bg-gray-700 rounded-lg p-4">
            <p className="text-sm text-gray-300 mb-2">Your host code (for rejoining):</p>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-mono font-bold text-blue-400">{hostCode}</span>
              <button
                onClick={() => copyToClipboard(hostCode, 'code')}
                className="ml-auto bg-gray-600 hover:bg-gray-500 p-2 rounded transition-colors"
              >
                {copiedCode ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4 text-gray-300" />
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ShareModal;
