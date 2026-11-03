import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isNativeApp, isStandalonePwa, getNativePlatform } from '../lib/nativePlatform';
import { v2Push } from '../services/apiV2';

function extractInAppPath(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const normalized = rawUrl.replace(/^lalia:\/\//i, 'https://lalia.cloud/');
    const url = new URL(normalized);
    const path = `${url.pathname || '/'}${url.search || ''}${url.hash || ''}`;
    return path.startsWith('/') ? path : `/${path}`;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function ensureWebPushRegistered() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return;
  }
  const token = localStorage.getItem('v2_token');
  if (!token) return;

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const perm = await Notification.requestPermission().catch(() => 'default');
      if (perm !== 'granted') return;
    } else if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      return;
    }

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { publicKey } = await v2Push.vapidPublicKey();
      if (!publicKey) return;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    if (sub) {
      await v2Push.subscribe(sub.toJSON ? sub.toJSON() : sub);
    }
  } catch {
    /* ignore if browser blocks push in current context */
  }
}

export default function NativeAppBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    const html = document.documentElement;
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    const isIosDevice = /iPhone|iPad|iPod/i.test(ua);
    const native = isNativeApp();
    const standalone = isStandalonePwa();

    if (native) {
      html.setAttribute('data-native-app', 'true');
      html.setAttribute('data-native-platform', getNativePlatform());
    }
    if (isIosDevice && (native || standalone)) {
      html.setAttribute('data-ios-standalone', 'true');
    }

    const syncAndroidToken = () => {
      try {
        const token = localStorage.getItem('v2_token') || '';
        window.LaliaAndroid?.setAuthToken?.(token);
      } catch {
        /* ignore */
      }
    };
    syncAndroidToken();
    ensureWebPushRegistered();
    const tokenSyncId = setInterval(syncAndroidToken, 4000);

    // Re-attempt Web Push registration after first user tap if permission was 'default'
    const onFirstInteraction = () => {
      ensureWebPushRegistered();
      window.removeEventListener('click', onFirstInteraction);
    };
    window.addEventListener('click', onFirstInteraction, { once: true });

    if (!native) {
      return () => {
        clearInterval(tokenSyncId);
        window.removeEventListener('click', onFirstInteraction);
        html.removeAttribute('data-ios-standalone');
      };
    }

    const capApp = window.Capacitor?.Plugins?.App;
    const listeners = [];

    if (capApp && typeof capApp.addListener === 'function') {
      Promise.resolve(
        capApp.addListener('appUrlOpen', (event) => {
          const target = extractInAppPath(event?.url);
          if (target) {
            navigate(target);
          }
        })
      )
        .then((handle) => {
          if (handle) listeners.push(handle);
        })
        .catch(() => {});

      Promise.resolve(
        capApp.addListener('backButton', ({ canGoBack }) => {
          if (canGoBack && window.history.length > 1) {
            window.history.back();
          } else if (typeof capApp.exitApp === 'function') {
            capApp.exitApp();
          }
        })
      )
        .then((handle) => {
          if (handle) listeners.push(handle);
        })
        .catch(() => {});
    }

    return () => {
      clearInterval(tokenSyncId);
      window.removeEventListener('click', onFirstInteraction);
      html.removeAttribute('data-native-app');
      html.removeAttribute('data-native-platform');
      html.removeAttribute('data-ios-standalone');
      listeners.forEach((h) => {
        try {
          h?.remove?.();
        } catch {
          /* ignore */
        }
      });
    };
  }, [navigate]);

  return null;
}
