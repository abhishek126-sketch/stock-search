'use strict';
// Paper trading book for the 🧭 Daily plan: used by the history test (scripts/backtest.js) and the forward tracker
// (scripts/track.js). One session at a time, in the order a real trader lives it:
//   1. this morning's GTT buy-stops (placed last evening from the plan) fill or don't  2. stops / targets during the day
//   3. after the close: breakeven / trail / time-stop decisions, equity marked at the close  4. evening: new plan → new orders.
const PP = require('../planport.js');
const r2 = v => Math.round(v * 100) / 100;

function newBook(capital, opts = {}) { return { capital, cash: capital, open: [], pending: [], closed: [], curve: [], fees: 0, missed: 0, filled: 0, opts }; }
const equity = (B, px) => B.cash + B.open.reduce((s, p) => s + p.rem * (px(p.s) ?? p.last ?? p.entry), 0);

// bars: sym → [t, o, h, l, c, v] for this session (missing = no trade); ind: sym → {e20, lo5} after this close
function advance(B, day, bars, ind) {
  const costs = B.opts.costs || PP.COSTS, done = [];
  const exitTrade = (p, sells) => { for (const x of sells) { const v = x.qty * x.px, f = PP.sellCost(v, costs); B.cash += v - f; B.fees += f; p.fees += f; p.sells.push([day, x.qty, r2(x.px), x.why]); } };
  // 1. fills of the orders placed last evening
  for (const o of B.pending) {
    const bar = bars[o.s]; if (!bar) { B.missed++; continue; }
    const px = PP.fillBuy(o.E, bar); if (px == null) { B.missed++; continue; }
    let q = o.q; while (q > 0 && q * px + PP.buyCost(q * px, costs) > B.cash) q--;
    if (!q) { B.missed++; continue; }
    const f = PP.buyCost(q * px, costs); B.cash -= q * px + f; B.fees += f; B.filled++;
    const p = { s: o.s, theme: o.theme, setup: o.setup, grade: o.grade, conf: o.conf, regime: o.regime, cl: o.cl, d0: day, plannedE: o.E, entry: px, qty: q, rem: q, sl: o.SL, sl0: o.SL, R0: px - o.SL, T1: o.T1, T3: o.T3, half: false, best: px, days: 0, fees: f, sells: [], last: px };
    // the entry day: only what happened after the entry counts (buy at px, then the rest of the bar)
    exitTrade(p, PP.manageDay(p, [bar[0], px, bar[2], bar[3], bar[4], bar[5]], ind[o.s]));
    p.last = bar[4]; (p.rem > 0 ? B.open : done).push(p);
  }
  B.pending = [];
  // 2. positions held from earlier sessions
  for (const p of B.open.slice()) {
    if (p.d0 === day) continue;
    const bar = bars[p.s]; if (!bar) continue;                  // no trade today (holiday for this stock / suspended)
    exitTrade(p, PP.manageDay(p, bar, ind[p.s])); p.last = bar[4];
    if (p.rem <= 0) { B.open.splice(B.open.indexOf(p), 1); done.push(p); }
  }
  for (const p of done) {
    const gross = p.sells.reduce((s, x) => s + x[1] * (x[2] - p.entry), 0), net = gross - p.fees, risk = p.qty * p.R0;
    B.closed.push({ s: p.s, setup: p.setup, grade: p.grade, conf: p.conf, regime: p.regime, cl: p.cl, theme: p.theme, d0: p.d0, d1: day, days: p.days, entry: r2(p.entry), plannedE: p.plannedE, qty: p.qty, sl0: p.sl0,
      gross: r2(gross), fees: r2(p.fees), net: r2(net), R: r2(net / risk), Rg: r2(gross / risk), exit: p.sells[p.sells.length - 1][3], sells: p.sells });
  }
  // 3. mark to the close
  B.curve.push([day, Math.round(equity(B, s => bars[s] ? bars[s][4] : null))]);
}
// 4. the evening plan → orders for the next session. plan: {exposure, cls, buy:[{s, plan:{E,SL,R,T1,T3}, conf, theme, setup, grade}]}
function placeOrders(B, plan, o = {}) {
  const eq = B.curve.length ? B.curve[B.curve.length - 1][1] : B.cash;
  const res = PP.buildPortfolio(plan.buy, { capital: eq, riskPct: o.riskPct ?? 1, maxRisk: o.maxRisk ?? 5, posPct: o.posPct ?? 25, exposure: plan.exposure,
    open: B.open.map(p => ({ s: p.s, theme: p.theme, qty: p.rem, entry: p.entry, sl: p.sl })), costs: B.opts.costs || PP.COSTS, maxCostR: o.maxCostR });
  B.pending = res.picks.map(b => ({ s: b.s, theme: b.theme, setup: b.setup, grade: b.grade, conf: b.conf, regime: plan.cls, cl: b.cdl ? b.cdl.cl : null, E: b.plan.E, SL: b.plan.SL, T1: b.plan.T1, T3: b.plan.T3, q: b.q }));
  return res;
}

// ---- summary statistics
function maxDD(curve) { let pk = -Infinity, dd = 0; for (const [, v] of curve) { pk = Math.max(pk, v); dd = Math.min(dd, v / pk - 1); } return dd; }
function cagr(curve) { if (curve.length < 2) return null; const y = (Date.parse(curve[curve.length - 1][0]) - Date.parse(curve[0][0])) / 31557600000; return y > 0 ? Math.pow(curve[curve.length - 1][1] / curve[0][1], 1 / y) - 1 : null; }
function tradeStats(T) {
  if (!T.length) return { n: 0 };
  const w = T.filter(t => t.net > 0), l = T.filter(t => t.net <= 0), sum = (a, f) => a.reduce((s, t) => s + f(t), 0);
  const gW = sum(w, t => t.net), gL = -sum(l, t => t.net);
  return { n: T.length, win: r2(w.length / T.length * 1000) / 1000, avgR: r2(sum(T, t => t.R) / T.length), avgRg: r2(sum(T, t => t.Rg) / T.length), avgWinR: w.length ? r2(sum(w, t => t.R) / w.length) : null, avgLossR: l.length ? r2(sum(l, t => t.R) / l.length) : null,
    pf: gL ? r2(gW / gL) : null, net: Math.round(sum(T, t => t.net)), fees: Math.round(sum(T, t => t.fees)), days: Math.round(sum(T, t => t.days) / T.length) };
}
function summarize(B) {
  const c = B.curve, T = B.closed, by = f => { const g = {}; for (const t of T) { const k = f(t); if (k != null) (g[k] = g[k] || []).push(t); } return Object.fromEntries(Object.entries(g).map(([k, a]) => [k, tradeStats(a)])); };
  const confBand = t => t.conf == null ? null : t.conf < 55 ? '<55' : t.conf < 60 ? '55-59' : t.conf < 65 ? '60-64' : t.conf < 70 ? '65-69' : t.conf < 75 ? '70-74' : '75+';
  // where the signal-day candle closed in its range: top quarter / upper half / lower half (does a strong close help?)
  const clBand = t => t.cl == null ? null : t.cl >= 75 ? 'hi' : t.cl >= 50 ? 'mid' : 'lo';
  const ex = c.length ? c.map(([d, v], i) => 0) : [];
  return { capital: B.capital, end: c.length ? c[c.length - 1][1] : B.capital, ret: c.length ? r2((c[c.length - 1][1] / B.capital - 1) * 100) : 0, cagr: cagr(c) == null ? null : r2(cagr(c) * 100), maxDD: r2(maxDD(c) * 100),
    trades: tradeStats(T), filled: B.filled, missed: B.missed, fees: Math.round(B.fees), bySetup: by(t => t.setup), byGrade: by(t => t.grade), byConf: by(confBand), byRegime: by(t => t.regime), byClose: by(clBand),
    byExit: by(t => t.exit.replace(/ \(.*/, '')), open: B.open.length };
}
module.exports = { newBook, advance, placeOrders, summarize, tradeStats, maxDD, cagr, equity };
