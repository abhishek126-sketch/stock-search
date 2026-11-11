#!/usr/bin/env node
'use strict';
// Unit tests for scripts/planrules.js (run by check.yml). Synthetic price series, no network.
const P = require('./planrules.js');
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } else console.log('ok  ', m); };
const DAY = 86400, t0 = 1700000000;
// daily closes from a function of the session index, with OHLCV bars for the last 80 sessions
function doc(f, n = 400, vol = 2e6, lastVol = null) {
  const hist = [], ohlc = [];
  for (let i = 0; i < n; i++) { const c = f(i), t = t0 + i * DAY; hist.push([t, c]); if (i >= n - 80) ohlc.push([t, c * 0.997, c * 1.01, c * 0.99, c, i === n - 1 && lastVol ? lastVol : vol]); }
  return { hist, ohlc, hl52: null };
}
const row = (s, extra = {}) => ({ s: s + '.NS', n: s, cap: 'Large', rs: 90, mcap: 5e11, pe: 25, pp: 0, ...extra });
const ctx = { niftyR3m: 0.02, now: t0 + 400 * DAY, regimeScore: 70, stats: null, ind: { rank: 2, of: 50 } };
// steady uptrend with a small wiggle → passes the rejects, good grade
const up = doc(i => 100 * Math.pow(1.002, i) * (1 + 0.025 * Math.sin(i / 2.5)));
const a = P.evaluate(up, row('UPTREND'), null, ctx);
ok(a && a.pass, 'uptrend passes the reject rules (' + (a && (a.why || []).join('; ')) + ')');
ok(a && ['A+', 'A', 'B'].includes(a.grade), 'uptrend gets a decent trend grade (' + (a && a.grade) + ')');
if (a && a.plan) { ok(a.plan.SL < a.plan.E, 'stop below entry'); ok(Math.abs(a.plan.T1 - (a.plan.E + 2 * a.plan.R)) < 0.11, 'T1 = entry + 2R'); ok(a.plan.Rpct <= P.RULES.stopMaxPct + 0.01, 'stop no wider than ' + P.RULES.stopMaxPct + '%'); }
// downtrend → rejected for the EMA rules
const dn = doc(i => 300 * Math.pow(0.997, i));
const b = P.evaluate(dn, row('DOWN'), null, ctx);
ok(b && !b.pass && b.code.includes('p200') && b.code.includes('p50'), 'downtrend rejected: below 50 / 200 EMA');
// penny + illiquid
const pen = doc(i => 20 + i * 0.01, 400, 1000);
const c = P.evaluate(pen, row('PENNY', { mcap: 1e9 }), null, ctx);
ok(c && !c.pass && c.code.includes('penny') && c.code.includes('liq'), 'penny / illiquid rejected');
// parabolic: +60% in the last 20 sessions
const para = doc(i => i < 380 ? 100 * Math.pow(1.002, i) : 100 * Math.pow(1.002, 380) * Math.pow(1.025, i - 380));
const d = P.evaluate(para, row('PARA'), null, ctx);
ok(d && !d.pass && d.code.includes('para'), 'parabolic move rejected');
// surveillance
const e = P.evaluate(up, row('ASM'), { surv: 'ASM Stage I' }, ctx);
ok(e && !e.pass && e.code.includes('surv'), 'exchange surveillance rejected');
// market regime
const m1 = P.classifyMarket({ c: up.hist.map(h => h[1]), hi52: Math.max(...up.hist.map(h => h[1])) }, { above50: 0.7 }, { v: 12, v5ago: 12 });
ok(['A', 'B'].includes(m1.cls) && m1.exposure >= 75, 'rising market with broad breadth → Bull or Strong Bull (' + m1.cls + ' ' + m1.score + ')');
const m2 = P.classifyMarket({ c: dn.hist.map(h => h[1]), hi52: 300 }, { above50: 0.25 }, { v: 26, v5ago: 20 });
ok(m2.cls === 'E' && m2.exposure <= 10, 'falling market, weak breadth, high VIX → Bear (' + m2.cls + ' ' + m2.score + ')');
ok(P.maxPositions(40000) === 3 && P.maxPositions(50000) === 5 && P.maxPositions(500000) === 8 && P.maxPositions(2e6) === 10, 'positions by capital: 3 / 5 / 8 / 10');
if (fail) { console.log(fail + ' failed'); process.exit(1); } console.log('all plan tests passed');
