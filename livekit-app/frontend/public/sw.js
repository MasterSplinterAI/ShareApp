/* Lalia Service Worker — handles incoming call Web Push notifications */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Incoming Lalia Call', body: event.data.text() };
  }

  const title = data.title || 'Incoming Lalia Call';
  const options = {
    body: data.body || 'Tap to answer with live translation',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'lalia-incoming-call',
    renotify: true,
    requireInteraction: true,
    vibrate: [300, 150, 300, 150, 500],
    data: {
      joinUrl: data.joinUrl || '/v2/app',
      callId: data.callId || null,
    },
    actions: [
      { action: 'answer', title: 'Answer Call' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.joinUrl || '/v2/app';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.focus();
            if ('navigate' in client && targetUrl) {
              return client.navigate(targetUrl);
            }
            return client;
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return null;
      })
  );
});
