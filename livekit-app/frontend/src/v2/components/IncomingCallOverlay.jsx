import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Phone, PhoneOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { v2Calls, v2Push } from '../../services/apiV2';
import { isNativeApp } from '../../lib/nativePlatform';
import { Button } from '../../components/ui/button';

let sharedAudioCtx = null;
let audioUnlockInstalled = false;

export function unlockIncomingCallAudio() {
  if (typeof window === 'undefined') return;
  // On native iOS/Android, native CallKit / RingtoneManager handles ringing without HTML5/WebAudio
  if (
    window.LaliaIOS ||
    window.webkit?.messageHandlers?.laliaIOS ||
    window.LaliaAndroid
  ) {
    return;
  }
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx && !sharedAudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

function ensureAudioUnlockListeners() {
  if (typeof window === 'undefined' || audioUnlockInstalled) return;
  audioUnlockInstalled = true;
  const events = ['touchstart', 'pointerdown', 'click', 'keydown'];
  const handler = () => {
    unlockIncomingCallAudio();
  };
  events.forEach((ev) => {
    window.addEventListener(ev, handler, { passive: true, capture: true });
  });
}

function playRingChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioCtx();
    }
    const ctx = sharedAudioCtx;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;

    const playTone = (freq, startOffset, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.22, now + startOffset + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration);
    };

    playTone(587.33, 0, 0.22); // D5
    playTone(880.0, 0.24, 0.32); // A5
    playTone(587.33, 0.68, 0.22); // D5
    playTone(1174.66, 0.92, 0.34); // D6
  } catch {
    /* AudioContext may be blocked before user gesture */
  }
}

function notifyNativeIosRing(call) {
  if (typeof window === 'undefined' || !call) return false;
  let handled = false;
  try {
    if (typeof window.LaliaIOS?.ringIncomingCall === 'function') {
      window.LaliaIOS.ringIncomingCall(
        call.callerName || 'Someone',
        call.joinUrl || '',
        call.id || ''
      );
      handled = true;
    }
    if (window.webkit?.messageHandlers?.laliaIOS?.postMessage) {
      window.webkit.messageHandlers.laliaIOS.postMessage({
        action: 'ringIncomingCall',
        callId: call.id || '',
        callerName: call.callerName || 'Someone',
        joinUrl: call.joinUrl || '',
        roomName: call.roomName || '',
      });
      handled = true;
    }
  } catch {
    /* ignore */
  }
  return handled;
}

function stopNativeIosRing(callId = '') {
  if (typeof window === 'undefined') return;
  try {
    window.LaliaIOS?.stopIncomingCallRing?.(callId);
    window.webkit?.messageHandlers?.laliaIOS?.postMessage?.({
      action: 'stopRing',
      callId: callId || '',
    });
  } catch {
    /* ignore */
  }
}

function extractJoinPath(joinUrl, roomName, autoJoin = false) {
  let path = `/join/${encodeURIComponent(roomName)}`;
  try {
    const url = new URL(joinUrl, window.location.origin);
    path = `${url.pathname}${url.search || ''}`;
  } catch {
    /* fallback to /join/:roomName */
  }
  if (autoJoin) {
    path += path.includes('?') ? '&autoJoin=1' : '?autoJoin=1';
  }
  return path;
}

export default function IncomingCallOverlay({ currentUser }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [incomingCall, setIncomingCall] = useState(null);
  const [busy, setBusy] = useState(false);
  const dismissedIdsRef = useRef(new Set());

  const inLiveRoom = location.pathname.startsWith('/room/');

  useEffect(() => {
    ensureAudioUnlockListeners();
  }, []);

  useEffect(() => {
    if (inLiveRoom) {
      setIncomingCall(null);
      return undefined;
    }

    let cancelled = false;

    const poll = async () => {
      const allowBackgroundPoll =
        typeof window !== 'undefined' &&
        (Boolean(window.LaliaAndroid) ||
          Boolean(window.LaliaIOS) ||
          Boolean(window.webkit?.messageHandlers?.laliaIOS) ||
          isNativeApp());
      if (cancelled || (document.visibilityState === 'hidden' && !allowBackgroundPoll)) return;
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

    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        poll();
      }
    };

    const onNativeCallDismissed = (ev) => {
      const id = ev?.detail?.callId;
      if (id) dismissedIdsRef.current.add(id);
      setIncomingCall(null);
    };

    poll();
    const id = setInterval(poll, 2500);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    window.addEventListener('focus', onVisibilityOrFocus);
    window.addEventListener('pageshow', onVisibilityOrFocus);
    window.addEventListener('lalia:ios-call-dismissed', onNativeCallDismissed);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
      window.removeEventListener('focus', onVisibilityOrFocus);
      window.removeEventListener('pageshow', onVisibilityOrFocus);
      window.removeEventListener('lalia:ios-call-dismissed', onNativeCallDismissed);
    };
  }, [inLiveRoom]);

  useEffect(() => {
    if (!incomingCall) {
      stopNativeIosRing();
      try {
        window.LaliaAndroid?.stopIncomingCallRing?.();
      } catch {
        /* ignore */
      }
      return undefined;
    }

    const activeCallId = incomingCall.id || '';

    const hasAndroidRing =
      typeof window !== 'undefined' &&
      typeof window.LaliaAndroid?.ringIncomingCall === 'function';

    if (hasAndroidRing) {
      try {
        window.LaliaAndroid.ringIncomingCall(
          incomingCall.callerName || 'Someone',
          incomingCall.joinUrl || ''
        );
      } catch {
        /* ignore */
      }
      return () => {
        try {
          window.LaliaAndroid?.stopIncomingCallRing?.();
        } catch {
          /* ignore */
        }
      };
    }

    const iosHandled = notifyNativeIosRing(incomingCall);
    v2Push.iosDebug({
      source: 'js_overlay',
      event: 'ring_effect',
      callId: activeCallId,
      iosHandled,
    });

    if (iosHandled) {
      return () => {
        stopNativeIosRing(activeCallId);
      };
    }

    playRingChime();

    try {
      navigator.vibrate?.([250, 120, 250, 120, 400]);
    } catch {
      /* ignore */
    }

    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'hidden' &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted' &&
      'serviceWorker' in navigator
    ) {
      navigator.serviceWorker.ready
        .then((reg) =>
          reg.showNotification(
            `${incomingCall.callerName || 'Someone'} is calling you on Lalia`,
            {
              body: 'Tap to answer with live translation & captions',
              icon: '/icon-192.png',
              badge: '/icon-192.png',
              tag: `lalia-call-${activeCallId || 'incoming'}`,
              renotify: true,
              requireInteraction: true,
              data: {
                joinUrl: incomingCall.joinUrl || '/v2/app',
                callId: activeCallId,
              },
            }
          )
        )
        .catch(() => {});
    }

    const chimeInterval = setInterval(() => {
      playRingChime();
      try {
        navigator.vibrate?.([250, 120, 250]);
      } catch {
        /* ignore */
      }
    }, 2400);

    return () => {
      clearInterval(chimeInterval);
      stopNativeIosRing(activeCallId);
    };
  }, [incomingCall?.id]);

  if (!incomingCall) return null;

  const handleAnswer = async () => {
    if (busy) return;
    setBusy(true);
    unlockIncomingCallAudio();
    const callId = incomingCall.id;
    stopNativeIosRing(callId);
    try {
      const res = await v2Calls.respond(callId, 'accept');
      dismissedIdsRef.current.add(callId);
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
              autoJoin: true,
            })
          );
        } catch {
          /* ignore */
        }
      }
      const targetPath = extractJoinPath(
        res.joinUrl || incomingCall.joinUrl,
        res.roomName || incomingCall.roomName,
        true
      );
      navigate(targetPath);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Call is no longer active');
      dismissedIdsRef.current.add(callId);
      setIncomingCall(null);
    } finally {
      setBusy(false);
    }
  };

  const handleDecline = async () => {
    if (busy) return;
    setBusy(true);
    const callId = incomingCall.id;
    stopNativeIosRing(callId);
    dismissedIdsRef.current.add(callId);
    setIncomingCall(null);
    try {
      await v2Calls.respond(callId, 'decline');
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const initial = (incomingCall.callerName || '?').charAt(0).toUpperCase();

  return (
    <div
      className="fixed inset-x-0 top-[max(1rem,calc(var(--safe-top,env(safe-area-inset-top,0px))+0.5rem))] z-[100] flex justify-center px-4"
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
