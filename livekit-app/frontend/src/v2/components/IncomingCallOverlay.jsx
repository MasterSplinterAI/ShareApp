import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Phone, PhoneOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { v2Calls, v2Push } from '../../services/apiV2';
import { isNativeApp } from '../../lib/nativePlatform';
import { Button } from '../../components/ui/button';

let sharedAudioCtx = null;
let sharedRingAudio = null;
let ringWavDataUri = null;
let audioUnlockInstalled = false;

function getRingtoneWavDataUri() {
  if (ringWavDataUri) return ringWavDataUri;
  try {
    const sampleRate = 22050;
    const durationSec = 2.4;
    const numSamples = Math.floor(sampleRate * durationSec);
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    const writeStr = (offset, str) => {
      for (let i = 0; i < str.length; i += 1) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    // Two-note chime burst (D5 587.33 Hz + A5 880 Hz, repeated twice per cycle)
    const notes = [
      { start: 0.0, end: 0.22, f1: 587.33, f2: 880.0 },
      { start: 0.25, end: 0.58, f1: 880.0, f2: 1174.66 },
      { start: 0.72, end: 0.94, f1: 587.33, f2: 880.0 },
      { start: 0.97, end: 1.32, f1: 880.0, f2: 1174.66 },
    ];

    for (let i = 0; i < numSamples; i += 1) {
      const t = i / sampleRate;
      let sample = 0;
      for (const n of notes) {
        if (t >= n.start && t <= n.end) {
          const localT = t - n.start;
          const len = n.end - n.start;
          const attack = Math.min(1, localT / 0.02);
          const release = Math.min(1, (len - localT) / 0.05);
          const env = attack * release;
          sample +=
            env *
            (0.28 * Math.sin(2 * Math.PI * n.f1 * localT) +
              0.2 * Math.sin(2 * Math.PI * n.f2 * localT));
        }
      }
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(44 + i * 2, Math.floor(clamped * 32767), true);
    }

    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    ringWavDataUri = `data:audio/wav;base64,${window.btoa(binary)}`;
    return ringWavDataUri;
  } catch {
    return null;
  }
}

export function unlockIncomingCallAudio() {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx && !sharedAudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    if (!sharedRingAudio) {
      const uri = getRingtoneWavDataUri();
      if (uri) {
        const audio = new Audio(uri);
        audio.loop = true;
        audio.preload = 'auto';
        audio.playsInline = true;
        audio.volume = 0.01;
        const p = audio.play();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            audio.pause();
            audio.currentTime = 0;
            audio.volume = 1.0;
          }).catch(() => {
            audio.volume = 1.0;
          });
        } else {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = 1.0;
        }
        sharedRingAudio = audio;
      }
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

function startHtmlAudioRing() {
  try {
    if (!sharedRingAudio) {
      const uri = getRingtoneWavDataUri();
      if (uri) {
        sharedRingAudio = new Audio(uri);
        sharedRingAudio.loop = true;
        sharedRingAudio.playsInline = true;
      }
    }
    if (sharedRingAudio) {
      sharedRingAudio.volume = 1.0;
      sharedRingAudio.currentTime = 0;
      sharedRingAudio.play().catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

function stopHtmlAudioRing() {
  try {
    if (sharedRingAudio) {
      sharedRingAudio.pause();
      sharedRingAudio.currentTime = 0;
    }
  } catch {
    /* ignore */
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
  const domAudioRef = useRef(null);

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
      stopHtmlAudioRing();
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
    startHtmlAudioRing();
    playRingChime();

    if (domAudioRef.current) {
      try {
        domAudioRef.current.volume = 1.0;
        domAudioRef.current.currentTime = 0;
        const p = domAudioRef.current.play();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            v2Push.iosDebug({
              source: 'js_overlay',
              event: 'dom_audio_play_ok',
              callId: activeCallId,
              iosHandled,
              audioCtxState: sharedAudioCtx?.state || 'none',
            });
          }).catch((err) => {
            v2Push.iosDebug({
              source: 'js_overlay',
              event: 'dom_audio_play_err',
              callId: activeCallId,
              iosHandled,
              error: String(err?.message || err || 'unknown'),
              audioCtxState: sharedAudioCtx?.state || 'none',
            });
          });
        }
      } catch (err) {
        v2Push.iosDebug({
          source: 'js_overlay',
          event: 'dom_audio_exception',
          callId: activeCallId,
          error: String(err?.message || err || 'unknown'),
        });
      }
    } else {
      v2Push.iosDebug({
        source: 'js_overlay',
        event: 'ring_effect',
        callId: activeCallId,
        iosHandled,
        hasLaliaIOS: Boolean(window.LaliaIOS),
        hasWebkitHandler: Boolean(window.webkit?.messageHandlers?.laliaIOS),
        audioCtxState: sharedAudioCtx?.state || 'none',
      });
    }

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
      stopHtmlAudioRing();
      stopNativeIosRing(activeCallId);
    };
  }, [incomingCall?.id]);

  if (!incomingCall) return null;

  const handleAnswer = async () => {
    if (busy) return;
    setBusy(true);
    unlockIncomingCallAudio();
    const callId = incomingCall.id;
    stopHtmlAudioRing();
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
    stopHtmlAudioRing();
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
      <audio
        ref={domAudioRef}
        src={getRingtoneWavDataUri() || undefined}
        autoPlay
        loop
        playsInline
        className="hidden"
      />
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
