/* ============================================================
   firebase-messaging-sw.js
   Place this file at your PROJECT ROOT (same folder as index.html)
   This Service Worker handles FCM background push notifications.
   ============================================================ */

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey:            "AIzaSyAe6sNvLbaypl5WHDNWZDgar4_5mH8CG_8",
    authDomain:        "ai-health-assistant-3938-9326b.firebaseapp.com",
    projectId:         "ai-health-assistant-3938-9326b",
    storageBucket:     "ai-health-assistant-3938-9326b.firebasestorage.app",
    messagingSenderId: "16856935869",
    appId:             "1:16856935869:web:cfc82b9ce6fc50a7f136d4"
});

const messaging = firebase.messaging();

/* ── Background message handler ──────────────────────────────
   Fires when the app is in the background or closed.
   ──────────────────────────────────────────────────────────── */
messaging.onBackgroundMessage(function(payload) {
    console.log('[SW] Background message received:', payload);

    const { title, body } = payload.notification || {};
    const { childName, vaccineList, isUrgent } = payload.data || {};

    const notifTitle = title || (isUrgent === 'true'
        ? `⚠️ URGENT: ${childName}'s Vaccine Due Tomorrow!`
        : `💉 Vaccine Reminder — ${childName}`);

    const notifBody = body || `${vaccineList} — Please visit your nearest clinic.`;

    return self.registration.showNotification(notifTitle, {
        body:     notifBody,
        icon:     '/icons/icon-192x192.png',
        badge:    '/icons/badge-72x72.png',
        tag:      'vaccine-reminder',
        renotify: true,
        data:     payload.data || {},
        actions:  [
            { action: 'open',    title: '📱 Open App' },
            { action: 'dismiss', title: '✕ Dismiss'   }
        ],
        vibrate: [200, 100, 200]
    });
});

/* ── Notification click → open / focus the app ─────────────── */
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    if (event.action === 'dismiss') return;
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(wins) {
            for (const w of wins) {
                if (w.url.includes(self.location.origin) && 'focus' in w) return w.focus();
            }
            if (clients.openWindow) return clients.openWindow('/');
        })
    );
});
