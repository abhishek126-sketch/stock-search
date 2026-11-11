#!/usr/bin/env node
'use strict';
// Forward test ("paper portfolio") of the 🧭 Daily plan, run by data.yml right after plan.js. Every evening:
//   1. the sessions since the last run are traded with last evening's GTT orders and the open positions
//      (same simulator as the history test: scripts/simengine.js + planport.js, real daily bars from data/s, costs)
//   2. tonight's plan becomes the orders for the next session (same portfolio rules as the app)
// Reference account: ₹1,00,000, 1% risk per trade, 5% total risk, 25% per stock, brokerage ₹0 + DP charge.
// A job that runs twice for the same close (backup slots, re-runs) redoes that session from the saved snapshot,
// so nothing is counted twice and corrected data (e.g. a repaired candle) is used.
// Writes data/track.json. Nothing here is a real order.
const fs = require('fs'), path = require('path');
const PP = require('../planport.js'), SE = require('./simengine.js'), P = require('./planrules.js');
const OUT = process.env.DATA_DIR || path.join(__dirname, '..', 'data'), FILE = path.join(OUT, 'track.json');
const START_CAPITAL = 100000, OPTS = { riskPct: 1, maxRisk: 5, posPct: 25 };
const ist = t => new Date((t + 19800) * 1000).toISOString().slice(0, 10);
const readJ = f => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch { return null; } };
const clone = o => JSON.parse(JSON.stringify(o));
const DOCS = {};
function doc(s) { if (!(s in DOCS)) DOCS[s] = readJ('s/' + s + '.json'); return DOCS[s]; }
function barOn(s, day) { const d = doc(s); if (!d) return null; return (d.ohlc || []).find(b => ist(b[0]) === day) || null; }
function indOn(s, day) {
  const d = doc(s); if (!d) return null;
  const c = (d.hist || []).filter(h => ist(h[0]) <= day).map(h => h[1]), e = P.emaS(c, 20), oh = (d.ohlc || []).filter(b => ist(b[0]) <= day).slice(-5);
  return { e20: e[e.length - 1], lo5: oh.length ? Math.min(...oh.map(b => b[3])) : null };
}
function planOrders(plan) {
  return { exposure: plan.market.regime.exposure, cls: plan.market.regime.cls,
    buy: (plan.buy || []).map(b => ({ s: b.s, plan: b.plan, conf: b.conf, theme: PP.themeOf(b.ind, b.sec), setup: b.setup, grade: b.grade })) };
}
function main() {
  const plan = readJ('plan.json'); if (!plan || !plan.asOf || !plan.market) { console.log('track: no plan - skipped'); return; }
  const D = plan.asOf; let st = readJ('track.json');
  if (!st || !st.book) {
    const B = SE.newBook(START_CAPITAL, { costs: PP.COSTS }); B.curve.push([D, START_CAPITAL]);
    SE.placeOrders(B, planOrders(plan), OPTS);
    st = { v: 1, start: D, capital: START_CAPITAL, opts: OPTS, asOf: D, book: B, prev: null, plans: [[D, plan.buy.length, plan.market.regime.cls, B.pending.map(o => o.s)]] };
    console.log('track: started on', D, 'with ₹' + START_CAPITAL, '| orders for the next session:', B.pending.map(o => o.s).join(' ') || 'none');
  } else {
    if (D < st.asOf) { console.log('track: plan', D, 'is older than the book', st.asOf, '- skipped'); return; }
    if (D === st.asOf) {                                   // the same close again: redo it from the snapshot
      if (!st.prev) { const B = SE.newBook(st.capital, { costs: PP.COSTS }); B.curve.push([D, st.capital]); st.book = B; }
      else st.book = clone(st.prev.book);
      st.plans = st.plans.filter(p => p[0] !== D);
      if (!st.prev) { SE.placeOrders(st.book, planOrders(plan), st.opts); st.plans.push([D, plan.buy.length, plan.market.regime.cls, st.book.pending.map(o => o.s)]); fs.writeFileSync(FILE, JSON.stringify(summary(st, plan))); console.log('track: re-placed the first orders for', D); return; }
    }
    const from = D === st.asOf ? st.prev.asOf : st.asOf;
    if (D !== st.asOf) st.prev = { asOf: st.asOf, book: clone(st.book) };
    const B = st.book;
    // sessions after `from` up to D, from the bars of every stock involved (held or ordered)
    const syms = [...new Set([...B.open.map(p => p.s), ...B.pending.map(o => o.s)])];
    const days = [...new Set(syms.flatMap(s => ((doc(s) || {}).ohlc || []).map(b => ist(b[0])).filter(d => d > from && d <= D)))].sort();
    if (!days.length) days.push(D);
    for (const day of days) {
      const bars = {}, ind = {};
      for (const s of new Set([...B.open.map(p => p.s), ...B.pending.map(o => o.s)])) { const b = barOn(s, day); if (b) { bars[s] = b; ind[s] = indOn(s, day); } }
      SE.advance(B, day, bars, ind);
    }
    SE.placeOrders(B, planOrders(plan), st.opts);
    st.asOf = D; st.plans.push([D, plan.buy.length, plan.market.regime.cls, B.pending.map(o => o.s)]); st.plans = st.plans.slice(-400);
    console.log('track:', from, '→', D, '| sessions', days.join(','), '| equity ₹' + B.curve[B.curve.length - 1][1], '| open', B.open.map(p => p.s).join(' ') || '-', '| closed', B.closed.length, '| next orders', B.pending.map(o => o.s).join(' ') || 'none');
  }
  fs.writeFileSync(FILE, JSON.stringify(summary(st, plan)));
}
// what the app shows (the book itself stays in the file so tomorrow can continue it)
function summary(st, plan) {
  const B = st.book, nifty = (plan.market.indices || []).find(i => i.sym === '^NSEI');
  const m = readJ('market.json'), nh = ((m && m.IN && m.IN.hist) || []).map(h => [ist(h[0]), h[1]]).filter(h => h[0] >= st.start);
  const n0 = nh.length ? nh[0][1] : null, nNow = nifty ? nifty.close : nh.length ? nh[nh.length - 1][1] : null;
  return { ...st, built: Math.floor(Date.now() / 1000), sum: SE.summarize(B), niftyRet: n0 && nNow ? Math.round((nNow / n0 - 1) * 10000) / 100 : null,
    openView: B.open.map(p => ({ s: p.s, d0: p.d0, entry: p.entry, qty: p.qty, rem: p.rem, sl: p.sl, T1: p.T1, last: p.last, half: p.half, days: p.days, setup: p.setup, conf: p.conf })),
    pendingView: B.pending.map(o => ({ s: o.s, E: o.E, SL: o.SL, T1: o.T1, q: o.q, conf: o.conf })) };
}
main();
