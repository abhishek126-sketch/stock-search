#!/usr/bin/env node
'use strict';
// Earnings-momentum swing scan for NSE stocks (run by data.yml after swing.js). Educational, rule-based, not advice.
//
// 1. Screen (the user's criteria, as on Screener):
//      quarterly net profit growth vs the same quarter a year ago > 25%       (x/<SYM>.json pr — scripts/results.js)
//      5-year net profit growth (CAGR, latest March year vs 5 years before) > 24%
//      ROCE > 15%                                                             (summary row roce)
//      price > 85% of the 52-week high
//      average volume over the last month (21 sessions) > 5,00,000 shares
//      excluded: banks, finance and real estate (sector Financial Services / Real Estate)
//    Profit = profit attributable to the company's shareholders (consolidated when filed), as Screener shows it.
//    A loss turning into a profit counts as growth (Screener passes these too).
// 2. Chart read of each passing stock (daily bars):
//      VCP           each pullback in the last ~60 sessions shallower than the one before (e.g. 15% → 10% → 6%),
//                    last one ≤ 12%, within 8% of the base high
//      Tight range   last 10 sessions within ~8% (or 2.5 × ATR), within 6% of the 52-week high
//      Pullback      close within −3% … +2% of the 20-day EMA (or the 50-DMA) on light volume (last 5 sessions
//                    < 80% of the 50-day average), trend still up
//      Extended      more than 7% above the 20-day EMA or RSI > 75 → wait for a pullback or a new base
//    Entry trigger : VCP / tight → a close above the base high (pivot) on volume ≥ 1.5× the 1-month average;
//                    pullback → a close above the higher of the last session's high and the 20-day EMA.
//    Stop-loss     : below the lowest low of the last 5 sessions (last 10 if that is closer than 1 ATR),
//                    never more than 2.5 × ATR below the trigger.
//    Rank          : setup quality (VCP > tight > pullback), tight risk, volume drying up, closeness to the
//                    52-week high, relative strength and earnings growth; promoter pledge > 20% is penalised.
// Writes momentum.json (list for the app's Swing tab → Earnings momentum).
const fs = require('fs'), path = require('path');
const I = require('../indicators.js');
const OUT = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const IST = 19800, DAY = 86400, now = Math.floor(Date.now() / 1000);
const istDate = t => new Date((t + IST) * 1000).toISOString().slice(0, 10);
const r2 = v => Math.round(v * 100) / 100, r1 = v => Math.round(v * 10) / 10;
const tickUp = v => Math.ceil(v / 0.05 - 1e-9) * 0.05, tickDn = v => Math.floor(v / 0.05 + 1e-9) * 0.05;
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const sma = I.sma, ema = I.ema, rsi = I.rsi, atr = I.atr;
const RULES = { qg: 25, g5: 24, roce: 15, hi: 0.85, vol: 5e5 };
const EXCL = /^(Financial Services|Real Estate)$/i;

// growth % from a to b; a loss turning into a profit counts as growth ('turn')
const growth = (now_, then_) => now_ == null || then_ == null ? null : then_ > 0 ? 100 * (now_ / then_ - 1) : now_ > 0 ? Infinity : null;
// drops misread quarters: sales > 8x the median quarter, or (median ≥ ₹20 Cr) under 1/8 of it — same rule as
// build_data.py good_quarters (e.g. HATSUN Jun-2025 ₹46,599 Cr vs ~₹2,500 Cr)
function goodQuarters(q) {
  const rv = q.map(r => r[2]).filter(v => typeof v === 'number' && v > 0).sort((a, b) => a - b);
  if (rv.length < 4) return q; const m = rv[rv.length >> 1];
  return q.filter(r => !(typeof r[2] === 'number' && r[2] > 0 && (r[2] > 8 * m || (m >= 2e8 && r[2] < m / 8))));
}
function fundamentals(pr) {
  if (!pr) return { pending: true };                                     // not read by results.js yet
  if (!pr.q || !pr.qe) return { known: false, why: 'no results filings on NSE' };
  const Q = new Map(goodQuarters(pr.q)), le = pr.qe, ya = (+le.slice(0, 4) - 1) + le.slice(4);
  const qg = growth(Q.get(le), Q.get(ya));
  const G = pr.g5; let g5 = null;
  if (G && G.a && G.z) g5 = G.z[1] > 0 && G.a[1] > 0 ? 100 * (Math.pow(G.a[1] / G.z[1], 1 / 5) - 1) : G.a[1] > 0 && G.z[1] <= 0 ? Infinity : null;
  const why = [];
  if (qg === null) why.push(Q.has(le) ? `no profit figure for the quarter a year before ${le} on NSE (new listing?)` : `profit for ${le} not readable`);
  if (g5 === null) why.push(G ? 'profit 5 years ago not usable' : 'no results from 5 years ago on NSE (listed later or renamed?)');
  return { known: qg !== null && g5 !== null, qg, g5, qe: le, ya, qNow: Q.get(le), qThen: Q.get(ya), b: G ? G.b : pr.b, fy: G && G.a[0], why: why.join('; ') };
}

function chart(d) {
  const hist = d.hist || [], c = hist.map(h => h[1]); let b = (d.ohlc || []).filter(x => x[4] > 0);
  if (c.length < 60 || b.length < 30) return null;
  const last = hist[hist.length - 1];
  if (istDate(b[b.length - 1][0]) < istDate(last[0])) b = b.concat([[last[0], last[1], last[1], last[1], last[1], 0]]);
  const n = b.length, C = last[1], H = b.map(x => x[2]), L = b.map(x => x[3]), V = b.map(x => x[5]);
  const e20 = ema(c, 20), s50 = sma(c, 50), s200 = sma(c, 200), R = rsi(c), A = atr(b.slice(-40));
  const hi52 = Math.max(...c.slice(-250), ...H.slice(-250), ...(Array.isArray(d.hl52) && d.hl52[0] > 0 ? [d.hl52[0]] : [])),   // + full-year intraday high (build_data.py hl52)
       vol21 = avg(V.slice(-22, -1).filter(v => v > 0)), vol50 = avg(V.slice(-51, -1).filter(v => v > 0)), vol5 = avg(V.slice(-5).filter(v => v > 0));
  const depth = (a, z) => { a = Math.max(0, a); if (z - a < 3) return null; const hh = Math.max(...H.slice(a, z)), ll = Math.min(...L.slice(a, z)); return 100 * (hh - ll) / hh; };
  const d1 = depth(n - 60, n - 30), d2 = depth(n - 30, n - 10), d3 = depth(n - 10, n);
  const hi10 = Math.max(...H.slice(-10)), lo5 = Math.min(...L.slice(-5)), lo10 = Math.min(...L.slice(-10)), hiBase = Math.max(...H.slice(-30));
  return { asOf: istDate(last[0]), C, e20, s50, s200, R, A, hi52, vol21, vol50, vol5, d1, d2, d3, hi10, lo5, lo10, hiBase, lastH: Math.max(b[n - 1][2], C), n };
}

function setup(k) {
  const o = { why: [], warn: [] }, pc = (a, b) => ((a / b - 1) * 100);
  const up = k.s50 && k.C > k.s50 && (!k.s200 || k.s50 > k.s200);
  const ext = pc(k.C, k.e20) > 7 || k.R > 75;
  const atrP = 100 * k.A / k.C;
  const vcp = k.d1 != null && k.d2 != null && k.d3 != null && k.d1 > k.d2 && k.d2 > k.d3 && k.d3 <= 12 && k.C >= k.hiBase * 0.92;
  const tight = k.d3 != null && (k.d3 <= 8 || k.d3 <= 2.5 * atrP) && k.C >= k.hi52 * 0.94;
  const nearE = pc(k.C, k.e20) >= -3 && pc(k.C, k.e20) <= 2, nearS = k.s50 && pc(k.C, k.s50) >= -3 && pc(k.C, k.s50) <= 2;
  const dry = k.vol5 && k.vol50 && k.vol5 < 0.8 * k.vol50;
  const pull = (nearE || nearS) && dry && (up || (k.s50 && k.s200 && k.s50 > k.s200));
  if (ext) { o.t = 'extended'; o.why.push(k.R > 75 ? `RSI ${Math.round(k.R)} — overbought` : `${r1(pc(k.C, k.e20))}% above the 20-day EMA ${r2(k.e20)}`); o.wait = `wait for a pullback towards the 20-day EMA (${r2(k.e20)}) or a new tight base`; }
  else if (vcp && up) { o.t = 'vcp'; o.why.push(`pullbacks getting shallower: ${r1(k.d1)}% → ${r1(k.d2)}% → ${r1(k.d3)}%`); }
  else if (tight && up) { o.t = 'tight'; o.why.push(`last 10 sessions within ${r1(k.d3)}%, ${r1(-pc(k.C, k.hi52))}% below the 52-week high`); }
  else if (pull) { o.t = 'pullback'; o.why.push(`pulled back to the ${nearE ? `20-day EMA ${r2(k.e20)}` : `50-DMA ${r2(k.s50)}`} on light volume (last 5 sessions ${Math.round(100 * k.vol5 / k.vol50)}% of the 50-day average)`); }
  else { o.t = 'none'; o.why.push(!up ? 'not in an uptrend (needs close > 50-DMA > 200-DMA)' : `no tight base yet: last 10 sessions moved ${r1(k.d3)}%`); }
  if (dry && o.t !== 'pullback') o.why.push(`volume drying up (last 5 sessions ${Math.round(100 * k.vol5 / k.vol50)}% of the 50-day average)`);
  if (o.t === 'vcp' || o.t === 'tight' || o.t === 'pullback') {
    const pivot = o.t === 'pullback' ? Math.max(k.lastH, k.e20) : Math.max(k.hi10, k.C);
    o.e = r2(tickUp(pivot * 1.001));
    let stop = k.lo5; if (o.e - stop < k.A) stop = k.lo10;
    if (o.e - stop > 2.5 * k.A) stop = o.e - 2.5 * k.A;
    o.sl = r2(tickDn(stop * 0.999)); o.rp = r2(100 * (o.e - o.sl) / o.e);
    o.volNeed = Math.round(1.5 * k.vol21);
    o.trig = o.t === 'pullback' ? `a close above ₹${o.e} (back over the ${o.e > k.lastH * 1.002 ? '20-day EMA' : 'last session\'s high'}), ideally on rising volume`
      : `a close above ₹${o.e} (the base high) on volume ≥ ${(o.volNeed / 1e5).toFixed(1)} lakh shares (1.5× the 1-month average)`;
    if (k.hi52 > o.e * 1.005 && k.hi52 < o.e * 1.04) o.warn.push(`52-week high ₹${r2(k.hi52)} is only ${r1(pc(k.hi52, o.e))}% above the trigger`);
    if (o.rp > 8) o.warn.push(`wide stop (${o.rp}%) — size the position smaller`);
  }
  return o;
}

// symbols that pass the cheap tests (sector, ROCE, near 52-week high, volume) — results.js reads their profits first,
// so the scan fills in within one run instead of waiting for the alphabetical pass over ~2,700 companies
function candidates() {
  const out = { pass: [], roce: [] };
  let S; try { S = JSON.parse(fs.readFileSync(path.join(OUT, 'summary.json'), 'utf8')); } catch { return out; }
  for (const row of S.rows || []) {
    if (!/\.NS$/.test(row.s) || String(row.cap || '').startsWith('ETF') || EXCL.test(row.sec || '')) continue;
    if (!(row.roce > RULES.roce / 100)) continue;
    let d; try { d = JSON.parse(fs.readFileSync(path.join(OUT, 's', row.s + '.json'), 'utf8')); } catch { continue; }
    const k = chart(d);
    (k && k.C > RULES.hi * k.hi52 && k.vol21 > RULES.vol ? out.pass : out.roce).push(row.s.slice(0, -3));
  }
  return out;
}

function main() {
  const sp = path.join(OUT, 'summary.json'), S = JSON.parse(fs.readFileSync(sp, 'utf8'));
  const pass = [], unk = [], cnt = { nse: 0, excl: 0, fund: 0, roce: 0, hi: 0, vol: 0, pass: 0, unknown: 0 };
  let asOf = '';
  for (const row of S.rows) {
    if (!/\.NS$/.test(row.s) || String(row.cap || '').startsWith('ETF')) continue;
    cnt.nse++;
    if (EXCL.test(row.sec || '')) { cnt.excl++; continue; }
    if (!(row.roce > RULES.roce / 100)) continue; cnt.roce++;
    let d, x = {}; try { d = JSON.parse(fs.readFileSync(path.join(OUT, 's', row.s + '.json'), 'utf8')); } catch { continue; }
    try { x = JSON.parse(fs.readFileSync(path.join(OUT, 'x', row.s + '.json'), 'utf8')); } catch { }
    const k = chart(d); if (!k) continue;
    if (!(k.C > RULES.hi * k.hi52)) continue; cnt.hi++;
    if (!(k.vol21 > RULES.vol)) continue; cnt.vol++;
    const f = fundamentals(x.pr);
    if (f.pending) { cnt.pending = (cnt.pending || 0) + 1; continue; }
    const base = { s: row.s, n: row.n, cap: row.cap, ind: row.ind || row.sec || '', roce: r1(row.roce * 100), p: r2(k.C), offHi: r1(100 * (k.C / k.hi52 - 1)), vol: Math.round(k.vol21), rs: row.rs, pledge: x.pledge && typeof x.pledge.pp === 'number' ? x.pledge.pp : null, surv: x.surv || row.sv || null };
    if (!f.known) {
      // unknown on one test but already failing the other → it's a fail, not "unchecked"
      if ((f.qg != null && f.qg <= RULES.qg) || (f.g5 != null && f.g5 <= RULES.g5)) continue;
      cnt.unknown++; unk.push({ ...base, qg: f.qg == null ? null : f.qg === Infinity ? 'turn' : r1(f.qg), g5: f.g5 == null ? null : f.g5 === Infinity ? 'turn' : r1(f.g5), why: f.why }); continue;
    }
    if (!(f.qg > RULES.qg && f.g5 > RULES.g5)) continue;
    cnt.fund++; cnt.pass++;
    if (k.asOf > asOf) asOf = k.asOf;
    const o = setup(k);
    if (base.pledge > 20) o.warn.push(`${base.pledge}% of promoter shares pledged`);
    if (base.surv) o.warn.push(`under exchange surveillance (${base.surv})`);
    const ed = ((d.profile && d.profile.earnDates) || []).find(t => t > now - DAY && t < now + 7 * DAY); if (ed) o.warn.push(`results due ${istDate(ed)} — gap risk`);
    const cx = row.caN && row.caN[0] <= istDate(now + 7 * DAY) ? row.caN : null; if (cx) o.warn.push(`ex-date ${cx[0]}: ${cx[1]}${/Bonus|Split|Rights|Demerger/.test(cx[1]) ? ' — price adjusts; re-set stop and targets' : ''}`);
    // delivery % (NSE): today's well above the 20-session average on a setup = genuine buying
    const dHi = isFinite(row.dp) && isFinite(row.dpA) && row.dpA > 0 && row.dp >= 1.3 * row.dpA;
    if (isFinite(row.dp) && isFinite(row.dpA)) o.why.push(`delivery ${row.dp}% (20-session average ${row.dpA}%)${dHi ? ' — buyers taking delivery' : ''}`);
    // rank score
    let sc = { vcp: 40, tight: 32, pullback: 26, extended: 8, none: 0 }[o.t];
    if (o.rp) sc += Math.max(0, 20 - Math.max(0, o.rp - 3) * 4);
    if (k.vol5 && k.vol50) sc += Math.max(0, Math.min(10, (1 - k.vol5 / k.vol50) * 25));
    sc += Math.max(0, 10 + base.offHi);                                   // 0% off the high = 10, 10% off = 0
    sc += isFinite(row.rs) ? row.rs * 0.1 : 5;
    sc += Math.min(10, ((isFinite(f.qg) ? Math.min(f.qg, 150) : 100) + (isFinite(f.g5) ? Math.min(f.g5, 80) * 2 : 120)) / 30);
    if (base.pledge > 20) sc -= 10; if (base.surv) sc -= 20; if (ed) sc -= 10;
    if (dHi) sc += 5;
    pass.push({ ...base, qg: f.qg === Infinity ? 'turn' : r1(f.qg), g5: f.g5 === Infinity ? 'turn' : r1(f.g5), qe: f.qe, fy: f.fy, b: f.b,
      t: o.t, e: o.e, sl: o.sl, rp: o.rp, volNeed: o.volNeed, trig: o.trig, wait: o.wait, why: o.why, warn: o.warn, sc: Math.round(Math.max(0, sc)),
      dp: row.dp, dpA: row.dpA, caN: row.caN, e20: r2(k.e20), s50: r2(k.s50), rsi: Math.round(k.R), hi52: r2(k.hi52), dep: [k.d1, k.d2, k.d3].map(v => v == null ? null : r1(v)) });
  }
  const order = { vcp: 0, tight: 0, pullback: 0, extended: 1, none: 2 };
  pass.sort((a, b) => order[a.t] - order[b.t] || b.sc - a.sc);
  unk.sort((a, b) => b.vol - a.vol);
  const res = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, 'corp', 'results.json'), 'utf8')); } catch { return null; } })();
  fs.writeFileSync(path.join(OUT, 'momentum.json'), JSON.stringify({ built: now, asOf, rules: RULES, cnt, coverage: res && { have: res.have, of: res.of }, list: pass, unchecked: unk.slice(0, 80) }));
  console.log('momentum:', JSON.stringify(cnt), '| actionable', pass.filter(p => order[p.t] === 0).length);
}
if (require.main === module) main();
module.exports = { setup, chart, fundamentals, candidates };
