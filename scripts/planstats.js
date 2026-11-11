#!/usr/bin/env node
'use strict';
// Weekly history check for the 🧭 Daily plan (run by data.yml; skips itself if the last check is < 6 days old, FORCE=1 overrides).
// Replays the plan's setups (planrules.labelClose) over ~3 years of daily closes of today's liquid NSE stocks:
//   entry  = next session's close, only if it closes above the signal close (stands in for "trades above the trigger")
//   1R     = 2 × the average daily close-to-close move, kept between 3% and 8% of the entry
//   first touch on closes within 40 sessions: −1R or +2R / +3R / +4R / +6R
//   managed result (the plan's trade-management rules): stop to breakeven after +1R, sell half at +2R, trail the rest
//   under the 20 EMA, time stop after 15 sessions without +1R, exit after 40 sessions.
// Caveats (shown in the app): closing prices only, no costs, today's listed stocks only (survivorship bias).
const fs = require('fs'), path = require('path');
const P = require('./planrules.js');
const OUT = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const now = Math.floor(Date.now() / 1000), FILE = path.join(OUT, 'planstats.json');
function main() {
  try { const o = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (!process.env.FORCE && now - o.built < 6 * 86400) { console.log('planstats: fresh (' + new Date(o.built * 1000).toISOString().slice(0, 10) + ') - skipped'); return; } } catch { }
  const S = JSON.parse(fs.readFileSync(path.join(OUT, 'summary.json'), 'utf8'));
  const NB = JSON.parse(fs.readFileSync(path.join(OUT, 's', 'NIFTYBEES.NS.json'), 'utf8')).hist; const NT = new Map(NB.map((x, i) => [x[0], i])), NC = NB.map(x => x[1]);
  const uni = S.rows.filter(r => /\.NS$/.test(r.s) && (r.mcap || 0) >= P.RULES.minMcap && r.p >= P.RULES.minPrice && !String(r.cap || '').startsWith('ETF'));
  const A = {}; const add = (k, o) => { const a = A[k] = A[k] || { n: 0, w2: 0, w3: 0, w4: 0, w6: 0, lose: 0, d2: 0, R: 0, win: 0 }; a.n++; for (const x of ['w2', 'w3', 'w4', 'w6', 'lose']) if (o[x]) a[x]++; if (o.w2) a.d2 += o.d2; a.R += o.R; if (o.R > 0) a.win++; };
  let used = 0, first = null, lastD = null;
  for (const r of uni) {
    let d; try { d = JSON.parse(fs.readFileSync(path.join(OUT, 's', r.s + '.json'), 'utf8')); } catch { continue; }
    const vb = (d.ohlc || []).slice(-50).map(x => x[5]).filter(v => v > 0); if (!vb.length || vb.reduce((s, v) => s + v, 0) / vb.length * r.p < P.RULES.minTurnover) continue;
    const T = d.hist.map(x => x[0]), C = d.hist.map(x => x[1]); if (C.length < 400) continue; used++;
    const E20 = P.emaS(C, 20), E50 = P.emaS(C, 50), E200 = P.emaS(C, 200), R = P.rsiS(C);
    const start = Math.max(260, C.length - 760); let skip = 0;
    for (let i = start; i < C.length - 41; i++) {
      if (i < skip) continue;
      const ni = NT.get(T[i]); if (ni == null || ni < 63) continue;
      const lab = P.labelClose(C, i, E20, E50, E200, R, NC[ni] / NC[ni - 63] - 1); if (!lab) continue;
      if (!(C[i + 1] > C[i])) continue;
      let mv = 0; for (let k = i - 13; k <= i; k++) mv += Math.abs(C[k] / C[k - 1] - 1); mv /= 14;
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
      const dt = new Date(T[i] * 1000).toISOString().slice(0, 10); if (!first || dt < first) first = dt; if (!lastD || dt > lastD) lastD = dt;
    }
  }
  const f3 = v => Math.round(v * 1000) / 1000, by = {};
  for (const [k, a] of Object.entries(A)) by[k] = { n: a.n, p2: f3(a.w2 / a.n), p3: f3(a.w3 / a.n), p4: f3(a.w4 / a.n), p6: f3(a.w6 / a.n), lose: f3(a.lose / a.n), days: a.w2 ? Math.round(a.d2 / a.w2) : null, avgR: f3(a.R / a.n), win: f3(a.win / a.n) };
  fs.writeFileSync(FILE, JSON.stringify({ built: now, from: first, to: lastD, stocks: used, by }));
  console.log('planstats: stocks', used, 'signals', A.all ? A.all.n : 0, JSON.stringify(by));
}
if (require.main === module) main();
