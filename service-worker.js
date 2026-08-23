// service-worker.js — BRIANE Flood Alert PWA Service Worker
const CACHE_NAME = 'briane-pwa-v1';
const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './firebase-config.js',
    './dashboard/index.html',
    './dashboard/dashboard.css',
    './dashboard/dashboard.js',
    './admin/dashboard.html',
    './admin/admin.css',
    './admin/admin-dashboard.js',
    './assets/icon.png',
    './assets/main1.png',
    './assets/favicon.ico',
    './background/weather-backgrounds.css',
    './background/background-manager.js',
    './manifest.json',
    './admin/manifest.json',
    'https://unpkg.com/lucide@latest',
    'https://cdn.jsdelivr.net/npm/chart.js'
];

// Install Event: Cache Core Static Files
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[ServiceWorker] Caching static shell assets...');
            return cache.addAll(STATIC_ASSETS).catch(err => {
                console.warn('[ServiceWorker] Pre-cache item note:', err);
            });
        })
    );
    self.skipWaiting();
});

// Activate Event: Clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(name => {
                    if (name !== CACHE_NAME) {
                        console.log('[ServiceWorker] Removing old cache:', name);
                        return caches.delete(name);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch Event: Network-First with Cache Fallback for maximum freshness
self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);

    // Skip non-GET requests and Firebase RTDB/Firestore live streams (must be real-time network)
    if (event.request.method !== 'GET' ||
        requestUrl.hostname.includes('firebaseio.com') ||
        requestUrl.hostname.includes('firestore.googleapis.com') ||
        requestUrl.hostname.includes('identitytoolkit.googleapis.com') ||
        requestUrl.hostname.includes('api.open-meteo.com')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});

// Notification Click Handler: Focus or open dashboard
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (let client of windowClients) {
                if (client.url.includes('dashboard') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('./dashboard/index.html');
            }
        })
    );
});
