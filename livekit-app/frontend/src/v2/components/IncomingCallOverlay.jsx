import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Phone, PhoneOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { v2Calls } from '../../services/apiV2';
import { Button } from '../../components/ui/button';

function playRingChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const playTone = (freq, startOffset, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.12, now + startOffset + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration);
    };

    playTone(587.33, 0, 0.22); // D5
    playTone(880.0, 0.24, 0.32); // A5
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 800);
  } catch {
    /* AudioContext may be blocked before user gesture */
  }
}

function extractJoinPath(joinUrl, roomName) {
  try {
    const url = new URL(joinUrl, window.location.origin);
    return `${url.pathname}${url.search || ''}`;
  } catch {
    return `/join/${encodeURIComponent(roomName)}`;
  }
}

export default function IncomingCallOverlay({ currentUser }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [incomingCall, setIncomingCall] = useState(null);
  const [busy, setBusy] = useState(false);
  const dismissedIdsRef = useRef(new Set());

  const inLiveRoom = location.pathname.startsWith('/room/');

  useEffect(() => {
    if (inLiveRoom) {
      setIncomingCall(null);
      return undefined;
    }

    let cancelled = false;

    const poll = async () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      if (typeof localStorage === 'undefined' || !localStorage.getItem('v2_token')) return;
      try {
        const res = await v2Calls.incoming();
        if (cancelled) return;
        const active = (res?.incomingCalls || []).find(
          (c) => !dismissedIdsRef.current.has(c.id)
        );
        setIncomingCall(active || null);
      } catch {
        /* ignore transient errors */
      }
    };

    poll();
    const id = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [inLiveRoom]);

  useEffect(() => {
    if (!incomingCall) return undefined;
    playRingChime();
    try {
      navigator.vibrate?.([200, 100, 200]);
    } catch {
      /* ignore */
    }
    const chimeInterval = setInterval(() => {
      playRingChime();
    }, 2600);
    return () => clearInterval(chimeInterval);
  }, [incomingCall?.id]);

  if (!incomingCall) return null;

  const handleAnswer = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await v2Calls.respond(incomingCall.id, 'accept');
      dismissedIdsRef.current.add(incomingCall.id);
      setIncomingCall(null);
      const displayName =
        currentUser?.display_name ||
        currentUser?.displayName ||
        currentUser?.email?.split('@')[0] ||
        '';
      if (displayName) {
        try {
          sessionStorage.setItem(
            'participantInfo',
            JSON.stringify({
              participantName: displayName,
              roomName: res.roomName || incomingCall.roomName,
              isHost: false,
            })
          );
        } catch {
          /* ignore */
        }
      }
      const targetPath = extractJoinPath(
        res.joinUrl || incomingCall.joinUrl,
        res.roomName || incomingCall.roomName
      );
      navigate(targetPath);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Call is no longer active');
      dismissedIdsRef.current.add(incomingCall.id);
      setIncomingCall(null);
    } finally {
      setBusy(false);
    }
  };

  const handleDecline = async () => {
    if (busy) return;
    setBusy(true);
    dismissedIdsRef.current.add(incomingCall.id);
    setIncomingCall(null);
    try {
      await v2Calls.respond(incomingCall.id, 'decline');
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const initial = (incomingCall.callerName || '?').charAt(0).toUpperCase();

  return (
    <div
      className="fixed inset-x-0 top-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] z-[100] flex justify-center px-4"
      role="alertdialog"
      aria-label="Incoming call"
    >
      <div className="flex w-full max-w-md items-center justify-between gap-3 rounded-2xl border border-emerald-500/40 bg-slate-950/95 p-4 text-white shadow-2xl ring-1 ring-emerald-400/30 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-lg font-semibold text-emerald-300 ring-2 ring-emerald-400/60">
            <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/25" />
            <span className="relative">{initial}</span>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {incomingCall.callerName || 'Someone'} is calling…
            </p>
            <p className="truncate text-xs text-slate-300">
              Live translation &amp; captions · Tap Answer to join
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="destructive"
            className="h-10 w-10 rounded-full"
            disabled={busy}
            onClick={handleDecline}
            aria-label="Decline call"
            title="Decline"
          >
            <PhoneOff className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-10 gap-1.5 rounded-full bg-emerald-600 px-4 font-semibold text-white hover:bg-emerald-500"
            disabled={busy}
            onClick={handleAnswer}
          >
            <Phone className="h-4 w-4" />
            Answer
          </Button>
        </div>
      </div>
    </div>
  );
}
