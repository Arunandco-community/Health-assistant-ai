/* ═══════════════════════════════════════════════════════════════════════════
   firebase-messaging-sw.js  — AI Health Assistant
   Place this file at PROJECT ROOT (same level as server.js and index.html).
   Railway serves it at: https://your-app.railway.app/firebase-messaging-sw.js

   This Service Worker handles push notifications when the app is CLOSED or
   in the background. Firebase requires this file to be named exactly this.
   ═══════════════════════════════════════════════════════════════════════════ */

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

/* ── Same Firebase config as index.html ──────────────────────────────────── */
firebase.initializeApp({
    apiKey:            "AIzaSyAe6sNvLbaypl5WHDNWZDgar4_5mH8CG_8",
    authDomain:        "ai-health-assistant-3938-9326b.firebaseapp.com",
    projectId:         "ai-health-assistant-3938-9326b",
    storageBucket:     "ai-health-assistant-3938-9326b.firebasestorage.app",
    messagingSenderId: "16856935869",
    appId:             "1:16856935869:web:cfc82b9ce6fc50a7f136d4"
});

const messaging = firebase.messaging();

/* ── Background message handler ─────────────────────────────────────────── */
messaging.onBackgroundMessage(function(payload) {
    console.log('[SW] Background FCM message received:', payload);

    const notificationTitle = payload.notification?.title || '💉 Vaccine Reminder';
    const notificationBody  = payload.notification?.body  || 'You have a pending vaccine.';

    const notificationOptions = {
        body:  notificationBody,
        icon:  '/icon.png',      /* optional: add icon.png to project root */
        badge: '/badge.png',     /* optional: small monochrome badge icon */
        tag:   'vaccine-reminder',
        renotify: true,
        requireInteraction: true,  /* keeps notification visible until dismissed */
        data: payload.data || {},
        actions: [
            { action: 'open',   title: '📋 Open App' },
            { action: 'close',  title: '✕ Dismiss'  }
        ]
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});

/* ── Notification click handler ─────────────────────────────────────────── */
self.addEventListener('notificationclick', function(event) {
    event.notification.close();

    if (event.action === 'close') return;

    /* Open or focus the app when user taps the notification */
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            for (const client of clientList) {
                if (client.url && 'focus' in client) {
                    return client.focus();
                }
            }
            /* No open window — open a new one */
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});
