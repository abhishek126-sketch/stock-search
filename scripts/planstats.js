#!/usr/bin/env node
'use strict';
// Weekly history check for the 🧭 Daily plan (run by data.yml; skips itself if the last check is < 6 days old, FORCE=1 overrides).
// Replays the plan's Buy signals (planrules.evaluate, the same rules as the live plan) over ~3 years of daily prices of today's liquid NSE stocks.
// The 5-year OHLCV history comes from Yahoo (scripts/yahoo.js), because the app's own files keep only 80 bars of OHLC.
//   entry  = next session's close, only if it closes above the signal close (stands in for "trades above the trigger")
//   1R     = 2 × the average daily close-to-close move, kept between 3% and 8% of the entry
//   first touch on closes within 40 sessions: −1R or +2R / +3R / +4R / +6R
//   managed result (the plan's trade-management rules): stop to breakeven after +1R, sell half at +2R, trail the rest
//   under the 20 EMA, time stop after 15 sessions without +1R, exit after 40 sessions.
// Caveats (shown in the app): closing prices only, no costs, today's listed stocks only (survivorship bias).
// Safety: the file is written only if the run covered enough stocks and signals; otherwise the last good file is kept.
const fs = require('fs'), path = require('path');
const P = require('./planrules.js');
const { yahoo, pool } = require('./yahoo.js');
const OUT = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const now = Math.floor(Date.now() / 1000), FILE = path.join(OUT, 'planstats.json');
const MIN_STOCKS = 100, MIN_SIGNALS = 200;
const IST = 19800;
const dkey = t => new Date((t + IST) * 1000).toISOString().slice(0, 10);

async function main() {
  try { const o = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (!process.env.FORCE && now - o.built < 6 * 86400) { console.log('planstats: fresh (' + new Date(o.built * 1000).toISOString().slice(0, 10) + ') - skipped'); return; } } catch { }
  const S = JSON.parse(fs.readFileSync(path.join(OUT, 'summary.json'), 'utf8'));
  const NI = await yahoo('NIFTYBEES.NS'); if (!NI || NI.c.length < 400) throw new Error('Nifty proxy history unavailable');
  const NIdx = new Map(NI.t.map((t, i) => [dkey(t), i])), NC = NI.c;
  const uni = S.rows.filter(r => /\.NS$/.test(r.s) && (r.mcap || 0) >= P.RULES.minMcap && r.p >= P.RULES.minPrice && !String(r.cap || '').startsWith('ETF'));
  const got = await pool(uni, 6, u => yahoo(u.s));
  const A = {}; const add = (k, o) => { const a = A[k] = A[k] || { n: 0, w2: 0, w3: 0, w4: 0, w6: 0, lose: 0, d2: 0, R: 0, win: 0 }; a.n++; for (const x of ['w2', 'w3', 'w4', 'w6', 'lose']) if (o[x]) a[x]++; if (o.w2) a.d2 += o.d2; a.R += o.R; if (o.R > 0) a.win++; };
  let used = 0, first = null, lastD = null;
  uni.forEach((r, k) => {
    const y = got[k]; if (!y || y.c.length < 400) return;
    const vb = y.v.slice(-50).filter(v => v > 0); if (!vb.length || vb.reduce((s, v) => s + v, 0) / vb.length * r.p < P.RULES.minTurnover) return;
    const T = y.t, C = y.c, bars = y.t.map((t, i) => [t, y.o[i], y.h[i], y.l[i], y.c[i], y.v[i]]), pairs = y.t.map((t, i) => [t, y.c[i]]);
    used++;
    const E20 = P.emaS(C, 20), E50 = P.emaS(C, 50), E200 = P.emaS(C, 200), R = P.rsiS(C);
    const start = Math.max(260, C.length - 760); let skip = 0;
    for (let i = start; i < C.length - 41; i++) {
      if (i < skip) continue;
      const ni = NIdx.get(dkey(T[i])); if (ni == null || ni < 63) continue;
      if (!(C[i + 1] > C[i])) continue;
      if (!(C[i] > E50[i] && C[i] > E200[i] && E20[i] > E50[i])) continue;      // evaluate() rejects these: skip the full check
      // the live plan's own rules (trend grade, setup score, candle, volume, room), run on the data known on that day only:
      // no 52-week high from today, today's industry rank not used (industry points are left out of the history)
      const di = { hist: pairs.slice(0, i + 1), ohlc: bars.slice(Math.max(0, i - 79), i + 1) };
      const sig = P.evaluate(di, r, null, { niftyR3m: NC[ni] / NC[ni - 63] - 1, stats: null, regimeScore: undefined, now: T[i] });
      if (!sig || !sig.buy) continue;
      const lab = sig.setup;
      let mv = 0; for (let k2 = i - 13; k2 <= i; k2++) mv += Math.abs(C[k2] / C[k2 - 1] - 1); mv /= 14;
      const E = C[i + 1], Rr = E * Math.min(0.08, Math.max(0.03, 2 * mv));
      const o = { R: 0 }; let stop = E - Rr, rem = 1, best = 0, done = false;
      for (let j = i + 2; j <= i + 41 && !done; j++) {
        const c = C[j], g = (c - E) / Rr; best = Math.max(best, g);
        if (!o.lose && !o.w2 && g <= -1) o.lose = 1;
        if (!o.w2 && !o.lose && g >= 2) { o.w2 = 1; o.d2 = j - i - 1; }
        if (o.w2 && g >= 3) o.w3 = 1; if (o.w2 && g >= 4) o.w4 = 1; if (o.w2 && g >= 6) o.w6 = 1;
        // managed exit
        if (c <= stop) { o.R += rem * g; rem = 0; done = true; break; }
        if (best >= 1 && stop < E) stop = E;
        if (rem === 1 && g >= 2) { o.R += 0.5 * g; rem = 0.5; }
        if (rem === 0.5 && c < E20[j]) { o.R += rem * g; rem = 0; done = true; break; }
        if (j - i - 1 >= 15 && best < 1) { o.R += rem * g; rem = 0; done = true; break; }
        if (j === i + 41) { o.R += rem * g; rem = 0; done = true; }
      }
      add(lab, o); add('all', o); skip = i + 10;
      const dt = dkey(T[i]); if (!first || dt < first) first = dt; if (!lastD || dt > lastD) lastD = dt;
    }
  });
  const signals = A.all ? A.all.n : 0;
  const f3 = v => Math.round(v * 1000) / 1000, by = {};
  for (const [k, a] of Object.entries(A)) by[k] = { n: a.n, p2: f3(a.w2 / a.n), p3: f3(a.w3 / a.n), p4: f3(a.w4 / a.n), p6: f3(a.w6 / a.n), lose: f3(a.lose / a.n), days: a.w2 ? Math.round(a.d2 / a.w2) : null, avgR: f3(a.R / a.n), win: f3(a.win / a.n) };
  console.log('planstats: stocks', used, 'signals', signals, JSON.stringify(by));
  if (used < MIN_STOCKS || signals < MIN_SIGNALS) { console.log(`planstats: run too small (${used} stocks, ${signals} signals; needs ${MIN_STOCKS} / ${MIN_SIGNALS}) - last good file kept`); process.exitCode = 1; return; }
  fs.writeFileSync(FILE, JSON.stringify({ built: now, from: first, to: lastD, stocks: used, by }));
}
if (require.main === module) main().catch(e => { console.log('planstats failed:', e.message); process.exitCode = 1; });
