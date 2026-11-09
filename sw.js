const CACHE = 'stock-search-v42';
const ASSETS = ['./', 'index.html', 'app.js', 'ext.js', 'live.js', 'intraday.js', 'glossary.js', 'report.js', 'alerts.js', 'moat.js', 'etf.js', 'glossary2.js', 'glossary3.js', 'corp.js', 'auto.js', 'doubt.js', 'score.js', 'swingui.js', 'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))); self.skipWaiting(); });
// market-data cache keeps one stable name across app versions, so offline data survives updates
const DATA_CACHE = 'stock-search-data';
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== DATA_CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin === location.origin) {
    // app shell: cache-first (ignore ?query so links like ?data=… still work offline)
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return res; })));
  } else if ((u.hostname === 'raw.githubusercontent.com' || u.hostname === 'cdn.jsdelivr.net')) {
    // market data: network-first, fall back to last cached copy when offline
    const key = u.origin + u.pathname; // ignore cache-buster query so polling doesn't grow the cache
    e.respondWith(fetch(e.request).then(res => { if (res.ok) { const cp = res.clone(); caches.open(DATA_CACHE).then(c => c.put(key, cp)); } return res; }).catch(() => caches.match(key).then(r => r || Response.error())));
  }
});
