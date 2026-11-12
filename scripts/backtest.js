#!/usr/bin/env node
'use strict';
// History test of the whole 🧭 Daily plan pipeline (weekly in data.yml; skips itself when < 6 days old, FORCE=1 overrides).
// For every past session it rebuilds the evening plan with the SAME code as the live plan (planrules.evaluate,
// classifyMarket) and trades it with the SAME portfolio and trade-management rules as the app (planport.js):
//   evening   market regime (Nifty, breadth, VIX) → reject rules → grade / setup / confidence → buy list → portfolio
//             (positions by capital, exposure cap, 1% risk, 5% total risk, 25% per stock, one per sector, cost check)
//   next day  GTT buy-stop at the trigger, limit +0.5% (gap above the limit = no fill); stop and T1 / T3 intraday
//             (gap through the stop fills at the open; stop and target on one bar → stop first); breakeven after +1R,
//             trail under the 20 EMA / 5-day low after T1, time stop after 15 sessions, max 8 weeks
//   costs     STT, stamp duty, exchange / SEBI fees, GST, DP charge per sell (planport.COSTS)
// Daily open / high / low / close / volume: Yahoo, 5 years, for today's liquid NSE stocks (+ Nifty 50, India VIX).
// Honest limits (shown in the app): today's stocks only (delisted / collapsed ones missing → results look better than
// reality), market cap / promoter pledge / surveillance as of today, no results-date gaps filter, one trade per stock.
const fs = require('fs'), path = require('path');
const P = require('./planrules.js'), PP = require('../planport.js'), SE = require('./simengine.js');
const OUT = process.env.DATA_DIR || path.join(__dirname, '..', 'data'), CACHE = process.env.BT_CACHE || null;
const FILE = path.join(OUT, 'backtest.json'), now = Math.floor(Date.now() / 1000), IST = 19800;
const CAPITALS = [30000, 100000, 500000];
const BT_V = 2;   // output format; 2 = byClose (signal-day close location). A new format or new costs rebuild at once.
const ist = t => new Date((t + IST) * 1000).toISOString().slice(0, 10);
const r2 = v => Math.round(v * 100) / 100;
const med = a => { const b = a.filter(x => x != null && isFinite(x)).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };

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
      if (cf) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(cf, JSON.stringify(out)); }
      return out;
    } catch (x) { e = x; await new Promise(r => setTimeout(r, (x.message === '429' ? 8000 : 1500) * (k + 1))); }
  }
  throw e;
}
async function pool(items, n, fn) { const res = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { res[k] = await fn(items[k]); } catch (e) { res[k] = null; } } })); return res; }

async function main() {
  try { const o = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (!process.env.FORCE && now - o.built < 6 * 86400 && o.v === BT_V && JSON.stringify(o.costs) === JSON.stringify(PP.COSTS)) { console.log('backtest: fresh (' + ist(o.built) + ') - skipped'); return; } } catch { }
  const t0 = Date.now();
  const S = JSON.parse(fs.readFileSync(path.join(OUT, 'summary.json'), 'utf8'));
  let stats = null; try { stats = JSON.parse(fs.readFileSync(path.join(OUT, 'planstats.json'), 'utf8')).by; } catch { }
  // universe: today's liquid NSE stocks (same thresholds as the plan)
  const uni = [];
  for (const r of S.rows) {
    if (!/\.NS$/.test(r.s) || String(r.cap || '').startsWith('ETF') || !((r.mcap || 0) >= P.RULES.minMcap) || !(r.p >= P.RULES.minPrice)) continue;
    let d; try { d = JSON.parse(fs.readFileSync(path.join(OUT, 's', r.s + '.json'), 'utf8')); } catch { continue; }
    const vb = (d.ohlc || []).slice(-50).map(x => x[5]).filter(v => v > 0); if (!vb.length || vb.reduce((s, v) => s + v, 0) / vb.length * r.p < P.RULES.minTurnover) continue;
    uni.push({ s: r.s, n: r.n, cap: r.cap, mcap: r.mcap, sec: r.sec || d.sector || '', ind: r.ind || d.industry || '' });
  }
  console.log('backtest: universe', uni.length);
  const [NI, VX] = await Promise.all([yahoo('^NSEI'), yahoo('^INDIAVIX')]);
  const got = await pool(uni, 6, u => yahoo(u.s));
  const ST = []; uni.forEach((u, k) => { const y = got[k]; if (!y || y.c.length < 300) return;
    const dates = y.t.map(ist), idx = new Map(dates.map((d, i) => [d, i])), pairs = y.t.map((t, i) => [t, y.c[i]]), bars = y.t.map((t, i) => [t, y.o[i], y.h[i], y.l[i], y.c[i], y.v[i]]);
    ST.push({ ...u, y, dates, idx, pairs, bars, E20: P.emaS(y.c, 20), E50: P.emaS(y.c, 50), E200: P.emaS(y.c, 200), theme: PP.themeOf(u.ind, u.sec) }); });
  console.log('backtest: price histories', ST.length, 'in', Math.round((Date.now() - t0) / 1000), 's');
  const ND = NI.t.map(ist), NC = NI.c, NH = NI.h, vix = new Map(VX ? VX.t.map((t, i) => [ist(t), VX.c[i]]) : []);
  const books = CAPITALS.map(c => SE.newBook(c, { costs: PP.COSTS })), rCount = {}, buyLen = [];
  const k0 = 300; let evals = 0;
  for (let k = k0; k < ND.length; k++) {
    const day = ND[k];
    // --- the session: fills, stops, targets, marks
    const need = new Set(); for (const B of books) { B.open.forEach(p => need.add(p.s)); B.pending.forEach(o => need.add(o.s)); }
    const bars = {}, ind = {};
    for (const s of need) { const x = ST.find(z => z.s === s), i = x && x.idx.get(day); if (i == null) continue; bars[s] = x.bars[i]; ind[s] = { e20: x.E20[i], lo5: Math.min(...x.y.l.slice(Math.max(0, i - 4), i + 1)) }; }
    for (const B of books) SE.advance(B, day, bars, ind);
    if (k === ND.length - 1) break;                                   // no next session to trade
    // --- the evening plan
    const live = []; for (const x of ST) { const i = x.idx.get(day); if (i != null && i >= 252) live.push([x, i]); }
    if (live.length < 100) continue;
    const sc = live.map(([x, i]) => { const c = x.y.c; return 0.4 * (c[i] / c[i - 63] - 1) + 0.2 * (c[i] / c[i - 126] - 1) + 0.4 * (c[i] / c[i - 252] - 1); });
    const order = sc.map((v, j) => [v, j]).sort((a, b) => a[0] - b[0]), rs = new Array(live.length); order.forEach(([, j], r) => rs[j] = Math.round(1 + 98 * r / Math.max(1, order.length - 1)));
    const G = {}; live.forEach(([x, i]) => { if (!x.ind) return; const c = x.y.c; (G[x.ind] = G[x.ind] || []).push([c[i] / c[i - 21] - 1, c[i] / c[i - 63] - 1, c[i] > x.E50[i] ? 1 : 0]); });
    const inds = Object.entries(G).filter(([, a]) => a.length >= 6).map(([k2, a]) => ({ ind: k2, sc: med(a.map(z => z[0])) * 0.4 + med(a.map(z => z[1])) * 0.4 + (a.reduce((s, z) => s + z[2], 0) / a.length - 0.5) * 0.2 })).sort((a, b) => b.sc - a.sc);
    const IR = {}; inds.forEach((z, j) => IR[z.ind] = { rank: j + 1, of: inds.length });
    const above50 = live.filter(([x, i]) => x.y.c[i] > x.E50[i]).length / live.length;
    const vx = vix.get(day), vx5 = vix.get(ND[k - 5]);
    const regime = P.classifyMarket({ c: NC.slice(0, k + 1), hi52: Math.max(...NH.slice(Math.max(0, k - 249), k + 1)) }, { above50 }, vx ? { v: vx, v5ago: vx5 } : null);
    rCount[regime.cls] = (rCount[regime.cls] || 0) + 1;
    const ctx0 = { niftyR3m: NC[k] / NC[k - 63] - 1, now: NI.t[k], stats, regimeScore: regime.score }, buy = [];
    live.forEach(([x, i], j) => {
      if (!(x.y.c[i] > x.E50[i] && x.y.c[i] > x.E200[i] && x.E20[i] > x.E50[i])) return;      // the first three reject rules, checked cheaply
      const hl = x.bars.slice(Math.max(0, i - 249), i + 1);
      const doc = { hist: x.pairs.slice(0, i + 1), ohlc: x.bars.slice(Math.max(0, i - 79), i + 1), hl52: [Math.max(...hl.map(b => b[2])), Math.min(...hl.map(b => b[3]))], profile: {} };
      const row = { s: x.s, n: x.n, cap: x.cap, rs: rs[j], mcap: x.mcap, pe: null, pp: 0, sec: x.sec, ind: x.ind };
      let o; try { o = P.evaluate(doc, row, null, { ...ctx0, ind: IR[x.ind] }); } catch { o = null; } evals++;
      if (o && o.buy) buy.push({ s: x.s, plan: o.plan, conf: o.conf, theme: x.theme, setup: o.setup, grade: o.grade, cdl: o.cdl });
    });
    buy.sort((a, b) => b.conf - a.conf); buyLen.push(buy.length);
    for (const B of books) SE.placeOrders(B, { exposure: regime.exposure, cls: regime.cls, buy: buy.slice(0, 40) });
  }
  // Nifty buy-and-hold over the same days
  const nCurve = ND.slice(k0).map((d, j) => [d, NC[k0 + j]]);
  const thin = c => c.filter((_, i) => i % 5 === 0 || i === c.length - 1);
  const runs = books.map(B => ({ ...SE.summarize(B), curve: thin(B.curve) }));
  const ref = books[1];
  const out = { v: BT_V, built: now, from: ND[k0], to: ND[ND.length - 1], sessions: ND.length - k0, stocks: ST.length, universeNote: 'today\'s liquid NSE stocks only (survivorship bias)', costs: PP.COSTS,
    rules: { riskPct: 1, maxRisk: 5, posPct: 25, maxCostR: 0.15, slip: 0.005 }, regimeDays: rCount, avgBuyList: r2(buyLen.reduce((s, x) => s + x, 0) / Math.max(1, buyLen.length)), daysNoBuy: buyLen.filter(x => !x).length,
    nifty: { ret: r2((NC[NC.length - 1] / NC[k0] - 1) * 100), cagr: r2(SE.cagr(nCurve) * 100), maxDD: r2(SE.maxDD(nCurve) * 100), curve: thin(nCurve) },
    runs, lastTrades: ref.closed.slice(-60).map(({ sells, ...t }) => t), evals, secs: Math.round((Date.now() - t0) / 1000) };
  fs.writeFileSync(FILE, JSON.stringify(out));
  console.log('backtest:', out.from, '→', out.to, '| stocks', out.stocks, '| evaluations', evals, '| regime days', JSON.stringify(rCount), '| Nifty', out.nifty.ret + '%', 'CAGR', out.nifty.cagr + '%', 'maxDD', out.nifty.maxDD + '%');
  for (const r of runs) console.log('  ₹' + r.capital.toLocaleString('en-IN'), '→ ₹' + r.end.toLocaleString('en-IN'), `(${r.ret}%, CAGR ${r.cagr}%, maxDD ${r.maxDD}%)`, '| trades', r.trades.n, 'win', r.trades.win, 'avgR net', r.trades.avgR, 'gross', r.trades.avgRg, 'PF', r.trades.pf, 'fees ₹' + r.fees, '| filled', r.filled, 'missed', r.missed);
  console.log('  by confidence (₹1L):', JSON.stringify(Object.fromEntries(Object.entries(runs[1].byConf).map(([k, v]) => [k, [v.n, v.win, v.avgR]]))));
  console.log('  by setup (₹1L):', JSON.stringify(Object.fromEntries(Object.entries(runs[1].bySetup).map(([k, v]) => [k, [v.n, v.win, v.avgR]]))), '| by regime:', JSON.stringify(Object.fromEntries(Object.entries(runs[1].byRegime).map(([k, v]) => [k, [v.n, v.win, v.avgR]]))));
  console.log('  took', out.secs, 's');
}
main().catch(e => { console.error('backtest failed:', e); process.exit(1); });
