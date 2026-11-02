const CACHE = 'stock-search-v7';
const ASSETS = ['./', 'index.html', 'app.js', 'ext.js', 'live.js', 'glossary.js', 'report.js', 'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== CACHE + '-data').map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin === location.origin) {
    // app shell: cache-first
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return res; })));
  } else if ((u.hostname === 'raw.githubusercontent.com' || u.hostname === 'cdn.jsdelivr.net')) {
    // market data: network-first, fall back to last cached copy when offline
    const key = u.origin + u.pathname; // ignore cache-buster query so polling doesn't grow the cache
    e.respondWith(fetch(e.request).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE + '-data').then(c => c.put(key, cp)); } return res; }).catch(() => caches.match(key)));
  }
});
