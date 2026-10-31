import { useEffect } from 'react';

/**
 * Keeps the device screen awake while a live meeting or demo room is active
 * so mobile users reading captions don't have their screen dim/lock mid-call.
 */
export function useMeetingWakeLock(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      return undefined;
    }

    let wakeLock = null;
    let cancelled = false;

    const requestLock = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        wakeLock = await navigator.wakeLock.request('screen');
      } catch {
        /* Wake lock can be denied in low-power mode; ignore silently */
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestLock();
      }
    };

    requestLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLock && typeof wakeLock.release === 'function') {
        wakeLock.release().catch(() => {});
      }
    };
  }, [enabled]);
}
