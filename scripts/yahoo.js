'use strict';
// Shared 5-year daily OHLCV loader (Yahoo chart API), used by planstats.js. Same logic as backtest.js's loader.
// Returns { t, o, h, l, c, v } arrays (epoch seconds, prices rounded to 2 dp) or null if the symbol is unknown.
const r2 = v => Math.round(v * 100) / 100;

// BT_CACHE=<folder>: reuse files saved in the last 5 days (local history tests; same cache format as backtest.js)
const fs = require('fs'), path = require('path'), CACHE = process.env.BT_CACHE || null;
async function yahoo(sym) {
  const cf = CACHE && path.join(CACHE, sym.replace(/[^A-Za-z0-9.^_-]/g, '_') + '.json');
  if (cf && fs.existsSync(cf) && Date.now() - fs.statSync(cf).mtimeMs < 5 * 864e5) return JSON.parse(fs.readFileSync(cf, 'utf8'));
  let e; for (let k = 0; k < 4; k++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5y&interval=1d`, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' }, signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return null; if (r.status === 429) throw new Error('429');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const ch = (await r.json()).chart.result[0], q = ch.indicators.quote[0], t = ch.timestamp || [];
      const out = { t: [], o: [], h: [], l: [], c: [], v: [] };
      for (let i = 0; i < t.length; i++) { const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]; if ([o, h, l, c].some(x => x == null || !(x > 0)) || h < l) continue;
        out.t.push(t[i]); out.o.push(r2(o)); out.h.push(r2(Math.max(h, o, c))); out.l.push(r2(Math.min(l, o, c))); out.c.push(r2(c)); out.v.push(q.volume[i] || 0); }
      return out;
    } catch (x) { e = x; await new Promise(r => setTimeout(r, (x.message === '429' ? 8000 : 1500) * Math.pow(2, k))); }
  }
  throw e;
}

// run fn over items with n workers; a failed item gives null
async function pool(items, n, fn) { const res = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { res[k] = await fn(items[k]); } catch (e) { res[k] = null; } } })); return res; }

module.exports = { yahoo, pool };
