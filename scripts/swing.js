#!/usr/bin/env node
'use strict';
// Swing-trade setups for Indian stocks, computed after the close from official closing prices (run by data.yml after
// build_data.py). Educational, rule-based: standard trend-following entry rules, not advice.
//
// Rules (one setup per stock, long only):
//   Trend filter : close > 50-DMA > 200-DMA and the 200-DMA rising over 20 sessions.
//   Breakout     : close within 2% below, or above, the 20-session high; buy above that high (or today's high if higher);
//                  "confirmed" when today's volume >= 1.5x the 20-session average.
//   Pullback     : close within -2%..+3% of the 20-EMA, RSI(14) 40-60, still above the 50-DMA;
//                  buy above today's high (next session must trade above it = buyers back).
//   Stop-loss    : below the lowest low of the last 5 sessions, but never more than 2.5 x ATR(14) below the entry.
//   Targets      : T1 = entry + 2R, T2 = entry + 3R (R = entry - stop); 52-week high noted as possible resistance.
//   Ready only if reward to the nearest resistance >= 1.5R and RSI <= 80; otherwise "watch" (RSI > 75 gets a warning).
//   Avoid        : turnover < Rs 2 Cr/day, penny (< Rs 50), ASM/GSM, results due within 7 days, price data older than 5 days.
// Writes: s/<SYM>.json .swing, summary.json rows .sw (compact), swing.json (list for the app's Swing setups tab).
const fs = require('fs'), path = require('path');
const OUT = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const IST = 19800, DAY = 86400, now = Math.floor(Date.now() / 1000);
const istDate = t => new Date((t + IST) * 1000).toISOString().slice(0, 10);
const r2 = v => Math.round(v * 100) / 100;
const tickUp = v => Math.ceil(v / 0.05 - 1e-9) * 0.05, tickDn = v => Math.floor(v / 0.05 + 1e-9) * 0.05;
const sma = (a, n, end = a.length) => end >= n ? a.slice(end - n, end).reduce((s, x) => s + x, 0) / n : null;
function ema(a, n) { const k = 2 / (n + 1); let e = null; for (const x of a) e = e === null ? x : x * k + e * (1 - k); return e; }
function rsi(c, n = 14) { if (c.length <= n) return null; let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; } g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); }
function atr(b, n = 14) { if (b.length <= n) return null; const tr = b.slice(1).map((x, i) => Math.max(x[2] - x[3], Math.abs(x[2] - b[i][4]), Math.abs(x[3] - b[i][4])));
  let a = tr.slice(0, n).reduce((s, x) => s + x, 0) / n; for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n; return a; }
function nextSession(t) { let d = new Date((t + IST) * 1000); do { d = new Date(d.getTime() + DAY * 1000); } while ([0, 6].includes(d.getUTCDay())); return d.toISOString().slice(0, 10); }

function setup(d, row, x) {
  const hist = d.hist || [], c = hist.map(h => h[1]); let b = (d.ohlc || []).slice();
  if (c.length < 210 || b.length < 30) return { st: 'none', why: ['not enough price history'] };
  const last = hist[hist.length - 1];
  if (istDate(b[b.length - 1][0]) < istDate(last[0])) b.push([last[0], last[1], last[1], last[1], last[1], 0]);   // official close newer than the OHLC bars
  const bar = b[b.length - 1], C = last[1], H = Math.max(bar[2], C), L = Math.min(bar[3], C);
  const s50 = sma(c, 50), s200 = sma(c, 200), s200p = sma(c, 200, c.length - 20), e20 = ema(c.slice(-120), 20), R = rsi(c.slice(-120)), A = atr(b.slice(-40));
  const vols = b.slice(-21, -1).map(x => x[5]).filter(v => v > 0), av20 = vols.length >= 10 ? vols.reduce((s, v) => s + v, 0) / vols.length : null, vToday = bar[5];
  const hi20 = Math.max(...b.slice(-21, -1).map(x => x[2])), lo5 = Math.min(...b.slice(-5).map(x => x[3])), hi52 = Math.max(...c.slice(-250));
  const o = { asOf: istDate(last[0]), next: nextSession(last[0]), close: C, s50: r2(s50), s200: r2(s200), e20: r2(e20), rsi: R && Math.round(R), atr: A && r2(A), hi20: r2(hi20), hi52: r2(hi52), why: [], warn: [] };
  // things that rule a stock out for swing trading
  const turnover = av20 ? av20 * C : null;
  if (!A || !av20) o.warn.push('volume / range data incomplete');
  if (turnover !== null && turnover < 2e7) o.warn.push(`thin trading: average turnover ₹${(turnover / 1e7).toFixed(2)} Cr/day (needs ≥ ₹2 Cr)`);
  if (C < 50 || row.pn) o.warn.push('penny stock (< ₹50) — prone to manipulation and wide spreads');
  const sv = (x && x.surv) || row.sv; if (sv) o.warn.push(`under exchange surveillance (${sv})`);
  const ed = ((d.profile && d.profile.earnDates) || []).find(t => t > now - DAY && t < now + 7 * DAY); if (ed) o.warn.push(`results due ${istDate(ed)} — gap risk`);
  // NSE corporate actions (scripts/nsedaily.js): an ex-date within a week moves the price that morning
  const cx = (row.caN && row.caN[0] <= istDate(now + 7 * DAY)) ? row.caN : null; if (cx) o.warn.push(`ex-date ${cx[0]}: ${cx[1]} — price adjusts that day${/Bonus|Split|Rights|Demerger/.test(cx[1]) ? '; re-set stop and targets' : ''}`);
  if (isFinite(row.dp) && isFinite(row.dpA)) o.deliv = [row.dp, row.dpA];
  if (now - last[0] > 5 * DAY) o.warn.push(`last price is from ${istDate(last[0])} — not trading recently`);
  if (d.staleFixed) o.warn.push('price feed had a frozen value (see data checks)');
  // trend
  const up = C > s50 && s50 > s200 && s200 > s200p;
  o.trend = up ? 'up' : C < s200 && s50 < s200 ? 'down' : 'mixed';
  const pc = (a, b) => `${a >= b ? '+' : ''}${((a / b - 1) * 100).toFixed(1)}%`;
  if (!up) { o.st = 'none'; o.why.push(`${o.trend === 'down' ? 'downtrend' : 'no clear uptrend'}: close ${r2(C)} is ${pc(C, s200)} vs the 200-DMA ${r2(s200)}, 50-DMA ${r2(s50)}${s200 <= s200p ? ', 200-DMA not rising' : ''} (needs close > 50-DMA > rising 200-DMA)`); return o; }
  o.why.push(`uptrend: close ${r2(C)} > 50-DMA ${r2(s50)} > 200-DMA ${r2(s200)} (rising)`);
  // setups
  let t = null, entry, stop;
  const nearHigh = C >= hi20 * 0.98, atEma = C >= e20 * 0.98 && C <= e20 * 1.03 && R >= 40 && R <= 60 && C >= s50;
  if (nearHigh) {
    t = 'breakout'; entry = tickUp(Math.max(hi20, H) * 1.001);
    const conf = vToday && av20 && vToday >= 1.5 * av20;
    o.why.push(C > hi20 ? `closed above the 20-session high ${r2(hi20)}` : `within ${((1 - C / hi20) * 100).toFixed(1)}% of the 20-session high ${r2(hi20)}`);
    o.why.push(conf ? `volume ${(vToday / av20).toFixed(1)}× the 20-day average — confirmed` : 'volume not yet above 1.5× average — wait for a high-volume move above the trigger');
    o.conf = !!conf;
  } else if (atEma) {
    t = 'pullback'; entry = tickUp(H * 1.001);
    o.why.push(`pulled back to the 20-EMA ${r2(e20)} (close ${((C / e20 - 1) * 100).toFixed(1)}% from it), RSI ${Math.round(R)} — buy only if the next session trades above today's high`);
  }
  if (!t) {
    o.st = 'watch';
    o.watch = C > e20 * 1.03 ? `extended ${((C / e20 - 1) * 100).toFixed(1)}% above the 20-EMA — wait for a pullback towards ${r2(e20)}` : `RSI ${Math.round(R)} outside 40–60 — wait`;
    if (C < hi20 * 0.98) o.watch += `; or a breakout above ${r2(hi20)}`;
    return o;
  }
  stop = Math.min(lo5, t === 'pullback' ? e20 - 0.5 * A : lo5);
  if (entry - stop > 2.5 * A) stop = entry - 2 * A;                      // cap the risk at ~2-2.5 ATR
  stop = tickDn(stop * 0.999);
  const risk = entry - stop;
  if (!(risk > 0)) { o.st = 'watch'; o.watch = 'stop level unclear'; return o; }
  Object.assign(o, { t, e: r2(entry), sl: r2(stop), t1: r2(tickDn(entry + 2 * risk)), t2: r2(tickDn(entry + 3 * risk)), riskPct: r2(risk / entry * 100), rr: 2 });
  const room = hi52 > entry * 1.005 ? (hi52 - entry) / risk : null;      // reward available before the 52-week high
  if (room !== null && room < 2) o.warn.push(`52-week high ${r2(hi52)} is only ${room.toFixed(1)}R above the entry — may act as resistance`);
  if (o.riskPct > 8) o.warn.push(`wide stop: ${o.riskPct.toFixed(1)}% below the entry — size the position smaller`);
  if (R > 75) o.warn.push(`RSI ${Math.round(R)} — overbought; chasing is risky, a pullback entry is safer`);
  // score 0-100 (higher = cleaner setup); RS = the app's relative-strength percentile
  let sc = 0;
  sc += Math.min(25, Math.max(0, ((C / s50 - 1) * 100 + (s50 / s200 - 1) * 100) * 1.5));   // trend strength
  sc += isFinite(row.rs) ? row.rs * 0.25 : 10;                                            // relative strength vs the market
  sc += t === 'breakout' ? (o.conf ? 15 : 5) : (R >= 45 && R <= 55 ? 15 : 9);              // confirmation
  sc += Math.max(0, 15 - Math.max(0, o.riskPct - 3) * 3);                                  // tight risk
  sc += room === null || room >= 3 ? 10 : room >= 2 ? 6 : 0;                                // room to run
  sc += isFinite(row.cs) && row.co >= 5 ? (row.cs / row.co) * 10 : 5;                       // CANSLIM backdrop
  o.sc = Math.round(Math.min(100, sc));
  o.st = o.warn.some(w => /thin trading|penny|surveillance|results due|not trading|frozen|incomplete/.test(w)) ? 'avoid' : (room !== null && room < 1.5) || R > 80 ? 'watch' : 'ready';
  if (o.st === 'watch') o.watch = R > 80 ? `RSI ${Math.round(R)} is very overbought — wait for a pullback towards the 20-EMA ${r2(e20)}` : 'resistance too close for a 2:1 trade';
  return o;
}

function main() {
  const sp = path.join(OUT, 'summary.json'), S = JSON.parse(fs.readFileSync(sp, 'utf8'));
  const list = []; let n = 0, ready = 0, asOf = '';
  for (const row of S.rows) {
    if (!/\.(NS|BO)$/.test(row.s) || String(row.cap || '').startsWith('ETF')) continue;
    const fp = path.join(OUT, 's', row.s + '.json'); if (!fs.existsSync(fp)) continue;
    let d, x = null; try { d = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { continue; }
    try { x = JSON.parse(fs.readFileSync(path.join(OUT, 'x', row.s + '.json'), 'utf8')); } catch { }
    let o; try { o = setup(d, row, x); } catch (e) { o = { st: 'none', why: ['error: ' + String(e.message).slice(0, 60)] }; }
    d.swing = o; fs.writeFileSync(fp, JSON.stringify(d)); n++;
    delete row.sw;
    if (o.st === 'ready' || o.st === 'watch' || o.st === 'avoid') {
      if (o.t) row.sw = { t: o.t, st: o.st, e: o.e, sl: o.sl, t1: o.t1, t2: o.t2, rp: o.riskPct, sc: o.sc, cf: o.conf ? 1 : 0 };
      else if (o.st === 'watch') row.sw = { st: 'watch' };
    }
    if (o.t && o.st !== 'none') list.push({ s: row.s, n: row.n, cap: row.cap, ...row.sw }); if (o.st === 'ready') ready++;
    if (o.asOf && o.asOf > asOf) asOf = o.asOf;
  }
  S.swingAsOf = asOf;
  fs.writeFileSync(sp, JSON.stringify(S));
  list.sort((a, b) => (b.st === 'ready') - (a.st === 'ready') || b.sc - a.sc);
  fs.writeFileSync(path.join(OUT, 'swing.json'), JSON.stringify({ built: now, asOf, next: asOf ? nextSession(Math.floor(Date.parse(asOf + 'T10:00:00Z') / 1000)) : '', n, ready, list }));
  console.log('swing: stocks', n, '| setups', list.length, '| ready', ready, '| as of', asOf);
}
if (require.main === module) main();
module.exports = { setup, nextSession };
