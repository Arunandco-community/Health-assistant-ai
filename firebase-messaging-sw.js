/* ============================================================
   firebase-messaging-sw.js
   Place this file at your PROJECT ROOT (same folder as index.html)
   This Service Worker handles FCM background push notifications.
   ============================================================ */

// ── Firebase SDK versions (must match what index.html loads) ──
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// ── Your Firebase project config ──────────────────────────────
// IMPORTANT: Replace these values with your actual Firebase config
// Get from: Firebase Console → Project Settings → General → Your apps → Config
firebase.initializeApp({
    apiKey:            "AIzaSyD-YOUR-API-KEY",
    authDomain:        "ai-health-assistant-3938-9326b.firebaseapp.com",
    projectId:         "ai-health-assistant-3938-9326b",
    storageBucket:     "ai-health-assistant-3938-9326b.appspot.com",
    messagingSenderId: "YOUR-SENDER-ID",
    appId:             "YOUR-APP-ID"
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
