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

async function syncIosPushTokensIfPresent() {
  if (typeof window === 'undefined') return;
  const authToken = localStorage.getItem('v2_token');
  if (!authToken) return;

  const bag = window.__laliaIosTokens;
  if (!bag || (!bag.voipToken && !bag.apnsToken)) return;

  try {
    await v2Push.registerIosToken({
      voipToken: bag.voipToken || undefined,
      apnsToken: bag.apnsToken || undefined,
      bundleId: bag.bundleId || 'cloud.lalia.app',
      environment: bag.environment || 'sandbox',
    });
  } catch {
    /* ignore transient network errors */
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

    const syncNativeTokens = () => {
      try {
        const token = localStorage.getItem('v2_token') || '';
        window.LaliaAndroid?.setAuthToken?.(token);
        window.LaliaIOS?.setAuthToken?.(token);
        window.webkit?.messageHandlers?.laliaIOS?.postMessage?.({
          action: 'setAuthToken',
          token,
        });
      } catch {
        /* ignore */
      }
      syncIosPushTokensIfPresent();
    };
    syncNativeTokens();
    ensureWebPushRegistered();
    const tokenSyncId = setInterval(syncNativeTokens, 4000);

    if (isIosDevice) {
      v2Push.iosDebug({
        source: 'js_bridge',
        event: 'mount',
        native,
        standalone,
        hasLaliaIOS: Boolean(window.LaliaIOS),
        hasWebkitHandler: Boolean(window.webkit?.messageHandlers?.laliaIOS),
        hasIosTokens: Boolean(window.__laliaIosTokens?.voipToken || window.__laliaIosTokens?.apnsToken),
      });
    }

    const onIosPushTokens = (event) => {
      const detail = event?.detail || {};
      window.__laliaIosTokens = {
        ...(window.__laliaIosTokens || {}),
        ...detail,
      };
      syncIosPushTokensIfPresent();
    };

    const onIosCallNavigate = (event) => {
      const rawUrl = event?.detail?.joinUrl || event?.detail?.url;
      const target = extractInAppPath(rawUrl);
      if (target) {
        navigate(target);
      }
    };

    window.addEventListener('lalia:ios-push-tokens', onIosPushTokens);
    window.addEventListener('lalia:ios-call-navigate', onIosCallNavigate);

    // Re-attempt Web Push registration after first user tap if permission was 'default'
    const onFirstInteraction = () => {
      ensureWebPushRegistered();
      syncNativeTokens();
      try {
        window.webkit?.messageHandlers?.laliaIOS?.postMessage?.({
          action: 'requestNotificationPermission',
        });
      } catch {
        /* ignore */
      }
      window.removeEventListener('click', onFirstInteraction);
    };
    window.addEventListener('click', onFirstInteraction, { once: true });

    if (!native) {
      return () => {
        clearInterval(tokenSyncId);
        window.removeEventListener('click', onFirstInteraction);
        window.removeEventListener('lalia:ios-push-tokens', onIosPushTokens);
        window.removeEventListener('lalia:ios-call-navigate', onIosCallNavigate);
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
      window.removeEventListener('lalia:ios-push-tokens', onIosPushTokens);
      window.removeEventListener('lalia:ios-call-navigate', onIosCallNavigate);
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
