'use strict';
// Page wiring that used to sit in inline <script> blocks and onclick="" attributes in index.html. Moved here (audit
// 23 Nov 2026) so the Content-Security-Policy in index.html can forbid inline scripts: then text from outside (filings,
// news, Yahoo names) that slipped into the page unescaped still could not run code or read the token in localStorage.
// Loaded last, after every other script and the go-to-top button.
(() => {
  // header height → CSS variable (sticky offsets)
  const h = document.querySelector('header'), f = () => document.documentElement.style.setProperty('--hh', h.getBoundingClientRect().height + 'px');
  f(); addEventListener('resize', f); window.ResizeObserver && new ResizeObserver(f).observe(h);
})();
(() => {
  const home = document.getElementById('homeBtn'), logo = document.getElementById('logo');
  [home, logo].forEach(b => b.onclick = () => goHome());
  logo.onkeydown = e => e.key === 'Enter' && goHome();
  const al = document.getElementById('alertsBtn'); if (al) al.onclick = () => showAlerts();
  // links / buttons that close the dialog they sit in (were onclick="this.closest('dialog').close()")
  document.addEventListener('click', e => { const el = e.target.closest && e.target.closest('[data-close]'); if (el) { const d = el.closest('dialog'); if (d) d.close(); } });
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(r => {
  // when a new version is deployed, reload once so the fresh code is used (instead of waiting for the next launch)
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !window._swReloaded) { window._swReloaded = true; location.reload(); } });
  setInterval(() => r.update().catch(() => {}), 30 * 60e3);
}).catch(() => {});
// "Install" button: shown when the browser offers app install (Chrome / Edge on PC and Android)
(() => {
  let ev = null; const b = document.getElementById('instBtn');
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); ev = e; b.style.display = 'inline-block'; });
  addEventListener('appinstalled', () => { b.style.display = 'none'; ev = null; });
  b.onclick = async () => { if (!ev) return; ev.prompt(); try { await ev.userChoice; } catch { } ev = null; b.style.display = 'none'; };
})();
// go-to-top button
(() => {
  const b = document.getElementById('topBtn'), f = () => b.classList.toggle('on', scrollY > 400);
  addEventListener('scroll', f, { passive: true }); f();
  b.onclick = () => scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
})();
