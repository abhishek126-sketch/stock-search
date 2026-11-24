// US results dates for the AVWAP card's "Results" anchor on US stock pages → data/usearn.json
//   { built, src: 'Finnhub', mode, e: { 'AAPL': [['2026-10-29', 'amc'], ...] } }   (newest last, up to 6 per stock)
// hour: 'bmo' before the open, 'amc' after the close, 'dmh' during market hours, '' unknown.
// Source: Finnhub earnings calendar (FINNHUB_KEY secret). Yahoo's calendarEvents only has the NEXT date, and the free
// Finnhub plan returns only about a month of past dates, so each run merges into the previous file and dates collect
// over time. Without a key, or if Finnhub fails, the previous file is kept unchanged. The key is never printed.
'use strict';
const fs = require('fs'), path = require('path');
const OUT = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(OUT, 'usearn.json');
const KEY = (process.env.FINNHUB_KEY || '').trim();
const DAYS = +(process.env.USEARN_DAYS || 45);      // how far back to ask each run
const PROBE = process.env.USEARN_PROBE !== '0';     // also ask 60–130 days back once, to log how much history the plan gives
const KEEP = 6;

const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const ymd = t => new Date(t).toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fget(p) {
  const u = 'https://finnhub.io/api/v1/' + p + (p.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(KEY);
  for (let t = 0; t < 4; t++) {
    let r;
    try { r = await fetch(u, { signal: AbortSignal.timeout(20000) }); }
    catch (e) { if (t === 3) throw new Error(e.name || 'fetch failed'); await sleep(3000); continue; }   // message never has the URL/token
    if (r.status === 429) { await sleep(5000 * (t + 1)); continue; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  throw new Error('rate limited');
}

// Finnhub class shares use '.', the app (Yahoo) uses '-': BRK.B → BRK-B
const toApp = s => String(s || '').toUpperCase().replace(/\./g, '-');

async function main() {
  const prev = read(FILE) || {};
  const E = {};
  for (const [s, v] of Object.entries(prev.e || {})) if (Array.isArray(v)) E[s] = v.filter(r => Array.isArray(r) && /^\d{4}-\d{2}-\d{2}$/.test(r[0]));
  const done = (mode, extra) => {
    const o = { built: Math.floor(Date.now() / 1000), src: 'Finnhub', mode, n: Object.keys(E).length, ...extra, e: E };
    fs.writeFileSync(FILE, JSON.stringify(o));
    console.log('usearn:', mode, 'stocks with dates', o.n, extra ? JSON.stringify(extra) : '');
  };
  if (!KEY) { if (prev.e) done('no-key (kept previous)'); else console.log('usearn: no FINNHUB_KEY, nothing written'); return; }

  // US stocks in the app (summary rows: first field = symbol)
  const sum = read(path.join(OUT, 'summary.json'));
  const rows = sum && (sum.rows || sum.r) || [];
  const US = new Set(rows.map(r => Array.isArray(r) ? r[0] : r && r.s).filter(s => s && !/\.(NS|BO)$/.test(s) && !s.startsWith('^')));
  if (!US.size) { console.log('usearn: no US symbols in summary.json — kept previous'); if (prev.e) done('no-universe (kept previous)'); return; }

  const today = ymd(Date.now());
  const windows = [];
  for (let back = DAYS; back > 0; back -= 7) windows.push([ymd(Date.now() - back * 864e5), ymd(Date.now() - Math.max(0, back - 7) * 864e5)]);
  if (PROBE) windows.push([ymd(Date.now() - 130 * 864e5), ymd(Date.now() - 60 * 864e5)]);
  let got = 0, matched = 0, added = 0, oldest = null, probeRows = 0, err = 0, ok = 0;
  for (const [i, [from, to]] of windows.entries()) {
    let j;
    try { j = await fget(`calendar/earnings?from=${from}&to=${to}`); }
    catch (e) {
      err++; console.log('usearn: window', from, to, 'failed:', e.message);
      if (/HTTP 40[13]/.test(e.message)) break;   // bad key / not allowed on this plan
      continue;
    }
    ok++;
    const cal = (j && j.earningsCalendar) || [];
    const isProbe = PROBE && i === windows.length - 1;
    if (isProbe) probeRows = cal.length;
    got += cal.length;
    for (const r of cal) {
      if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.date || '') || r.date > today) continue;
      if (!oldest || r.date < oldest) oldest = r.date;
      const s = toApp(r.symbol);
      if (!US.has(s)) continue;
      matched++;
      const h = ['bmo', 'amc', 'dmh'].includes(r.hour) ? r.hour : '';
      const L = E[s] || (E[s] = []);
      const k = L.findIndex(x => x[0] === r.date);
      if (k < 0) { L.push([r.date, h]); added++; } else if (h && !L[k][1]) L[k][1] = h;
    }
    await sleep(1100);   // free plan: 60 calls/min
  }
  for (const s of Object.keys(E)) { E[s].sort((a, b) => a[0] < b[0] ? -1 : 1); E[s] = E[s].slice(-KEEP); if (!E[s].length) delete E[s]; }
  if (!ok) { done('error (kept previous)', { err }); return; }
  done('live', { rows: got, matched, added, oldest, probe60to130d: probeRows, err, universe: US.size });
}

main().catch(e => { console.log('usearn failed:', e.message); process.exit(0); });
