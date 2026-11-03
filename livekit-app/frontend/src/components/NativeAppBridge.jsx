import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isNativeApp, isStandalonePwa, getNativePlatform } from '../lib/nativePlatform';

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
    const tokenSyncId = setInterval(syncAndroidToken, 4000);

    if (!native) {
      return () => {
        clearInterval(tokenSyncId);
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
