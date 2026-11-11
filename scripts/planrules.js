'use strict';
// ===== 🧭 Daily plan: the user's swing-trading framework as code =====
// Used by scripts/plan.js (every evening, after the official closes) and scripts/planstats.js (weekly history check).
// Educational and rule-based: fixed technical rules on official closing prices, not advice.
//
// Framework (from the user, 11 Nov 2026): trend > risk management > entry > profit; cash is a valid position.
//   Market regime  A Strong Bull 100% · B Bull 75% · C Neutral 50% · D Weak 25% · E Bear 0–10% maximum exposure.
//   Positions      capital < ₹50k → 3 · ₹50k–2L → 5 · ₹2L–10L → 8 · above → 10.
//   Reject         20 EMA < 50 EMA · price < 50 EMA · price < 200 EMA · weak relative strength · poor liquidity ·
//                  abnormal volatility · recent parabolic move · reward:risk < 1:2 · penny · pump-and-dump (+ surveillance).
//   Buy            trend grade A+ or A and a setup score above 75; risk 1% of capital per trade, 5% in total.

const RULES = {
  minTurnover: 1e8,     // ₹10 Cr average daily turnover (50 sessions)
  minMcap: 1e10,        // ₹1,000 Cr market cap
  minPrice: 50,
  maxAtrPct: 4,         // average daily range (ATR14) above 4% of the price = abnormal volatility (stops would hit the 8% cap)
  maxRun20: 25,         // parabolic: up more than 25% in 20 sessions …
  maxExt20: 12,         // … or more than 12% above the 20 EMA …
  maxRsi: 78,           // … or RSI above 78
  minRs: 70,            // relative-strength percentile (the app's RS)
  pumpVr: 5, pumpR5: 20,// volume > 5× average with +20% in 5 sessions
  minRR: 2,
  buyGrades: ['A+', 'A'], minSetupScore: 75,
  stopMinAtr: 1, stopMaxAtr: 2.5, stopMaxPct: 8,
};
const REGIMES = { A: ['Strong Bull', 100], B: ['Bull', 75], C: ['Neutral', 50], D: ['Weak', 25], E: ['Bear', 10] };
const maxPositions = cap => cap < 50000 ? 3 : cap <= 200000 ? 5 : cap <= 1000000 ? 8 : 10;

const r2 = v => Math.round(v * 100) / 100;
const tickUp = v => Math.ceil(v / 0.05 - 1e-9) * 0.05, tickDn = v => Math.floor(v / 0.05 + 1e-9) * 0.05;
const tk = v => r2(Math.round(v / 0.05) * 0.05);
const inrS = v => '₹' + Number(tk(v)).toLocaleString('en-IN', { maximumFractionDigits: 2 });   // ₹1,288.8 (Indian grouping) in the plan's own text
function emaS(a, n) { const k = 2 / (n + 1), o = new Array(a.length).fill(null); if (a.length < n) return o; let e = a.slice(0, n).reduce((s, x) => s + x, 0) / n; o[n - 1] = e; for (let i = n; i < a.length; i++) { e = a[i] * k + e * (1 - k); o[i] = e; } return o; }
function rsiS(a, n = 14) { const o = new Array(a.length).fill(null); if (a.length <= n) return o; let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = a[i] - a[i - 1]; d > 0 ? g += d : l -= d; } g /= n; l /= n; o[n] = l ? 100 - 100 / (1 + g / l) : 100;
  for (let i = n + 1; i < a.length; i++) { const d = a[i] - a[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; o[i] = l ? 100 - 100 / (1 + g / l) : 100; } return o; }
function atrW(b, n = 14) { if (b.length <= n) return null; const tr = b.slice(1).map((x, i) => Math.max(x[2] - x[3], Math.abs(x[2] - b[i][4]), Math.abs(x[3] - b[i][4]))); let a = tr.slice(0, n).reduce((s, x) => s + x, 0) / n; for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n; return a; }
const ret = (a, n) => a.length > n && a[a.length - 1 - n] > 0 ? a[a.length - 1] / a[a.length - 1 - n] - 1 : null;
const pc1 = v => (v * 100).toFixed(1);
// higher highs AND higher lows: last two 3-bar pivots on closes over ~60 sessions
function hhhl(c) { const W = c.slice(-62), P = []; for (let i = 3; i < W.length - 3; i++) { const s = W.slice(i - 3, i + 4); if (W[i] === Math.max(...s)) P.push(['H', W[i]]); if (W[i] === Math.min(...s)) P.push(['L', W[i]]); }
  const h = P.filter(x => x[0] === 'H').slice(-2), l = P.filter(x => x[0] === 'L').slice(-2); return h.length === 2 && l.length === 2 && h[1][1] > h[0][1] && l[1][1] > l[0][1]; }

// ---------- market regime ----------
// idx: { c: closes (≥ 210), hi52 } for Nifty 50 · breadth: { above50 (0-1) } · vix: { v, v5ago }
function classifyMarket(idx, breadth, vix) {
  const c = idx.c, n = c.length - 1, p = c[n], e20 = emaS(c, 20), e50 = emaS(c, 50), e200 = emaS(c, 200), R = rsiS(c);
  const s = { close: p, e20: e20[n], e50: e50[n], e200: e200[n], e200up: e200[n] > e200[n - 20], rsi: R[n], ext20: p / e20[n] - 1, offHi: idx.hi52 ? p / idx.hi52 - 1 : null };
  let sc = 0; const why = [];
  const pt = (ok, v, yes, no) => { if (ok) { sc += v; if (yes) why.push(['+', yes]); } else if (no) why.push(['−', no]); };
  pt(p > s.e200, 20, 'Nifty is above its 200 EMA', 'Nifty is below its 200 EMA');
  pt(s.e200up, 15, 'the 200 EMA is rising', 'the 200 EMA is still falling');
  pt(s.e50 > s.e200, 15, 'the 50 EMA is above the 200 EMA', 'the 50 EMA is still below the 200 EMA');
  pt(p > s.e50, 10, null, 'Nifty is below its 50 EMA');
  pt(s.e20 > s.e50, 10, null, 'the 20 EMA is below the 50 EMA');
  const b = breadth && breadth.above50;
  if (b != null) { if (b > 0.65) { sc += 15; why.push(['+', `broad participation: ${Math.round(b * 100)}% of liquid stocks above their 50 EMA`]); } else if (b >= 0.5) { sc += 8; why.push(['~', `only ${Math.round(b * 100)}% of liquid stocks are above their 50 EMA`]); } else if (b < 0.4) { sc -= 10; why.push(['−', `weak breadth: ${Math.round(b * 100)}% of liquid stocks above their 50 EMA`]); } else why.push(['~', `${Math.round(b * 100)}% of liquid stocks above their 50 EMA`]); }
  if (vix && vix.v) { const v = vix.v; sc += v < 14 ? 10 : v < 18 ? 5 : v < 22 ? 0 : -10; why.push([v < 18 ? '+' : v < 22 ? '~' : '−', `India VIX ${v.toFixed(1)}${v < 14 ? ' (calm)' : v < 18 ? ' (normal)' : v < 22 ? ' (nervous)' : ' (fearful)'}`]);
    if (vix.v5ago && v > vix.v5ago * 1.08 && p > c[n - 5]) { sc -= 5; why.push(['−', `VIX is rising with the market (${vix.v5ago.toFixed(1)} → ${v.toFixed(1)} in 5 sessions) — options traders expect bigger swings`]); } }
  if (s.rsi > 78 || s.ext20 > 0.05) { sc -= 5; why.push(['−', `Nifty is stretched: ${pc1(s.ext20)}% above its 20 EMA, RSI ${Math.round(s.rsi)} — chasing here has poor odds`]); }
  if (s.offHi != null && s.offHi > -0.05) { sc += 5; why.push(['+', `Nifty is within ${pc1(-s.offHi)}% of its 52-week high`]); }
  sc = Math.max(0, Math.min(100, sc));
  let cls = sc >= 80 ? 'A' : sc >= 65 ? 'B' : sc >= 45 ? 'C' : sc >= 30 ? 'D' : 'E';
  if (p < s.e200 && s.e50 < s.e200 && cls < 'D') { cls = 'D'; why.push(['−', 'capped at Weak: price and the 50 EMA are both below the 200 EMA']); }
  const edges = [80, 65, 45, 30], dist = Math.min(...edges.map(e => Math.abs(sc - e)));
  const conf = Math.round(Math.min(90, 50 + dist * 3));
  // when would the 50 EMA cross the 200 EMA if Nifty stays where it is?
  let crossIn = null; if (s.e50 < s.e200 && p > s.e200) { let a = s.e50, z = s.e200; for (let k = 1; k <= 60; k++) { a = p * 2 / 51 + a * 49 / 51; z = p * 2 / 201 + z * 199 / 201; if (a > z) { crossIn = k; break; } } }
  return { cls, label: REGIMES[cls][0], exposure: REGIMES[cls][1], score: sc, conf, why, nifty: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v])), crossIn };
}

// ---------- one stock ----------
// d: app's s/<SYM>.json · row: summary row · x: x/<SYM>.json or null · ctx: { niftyR3m, ind: {rank, of}, stats, regimeScore, now }
function evaluate(d, row, x, ctx) {
  const hist = d.hist || [], c = hist.map(h => h[1]); let b = (d.ohlc || []).slice();
  if (c.length < 260 || b.length < 60) return null;
  const last = hist[hist.length - 1];
  if (b[b.length - 1][0] < last[0] - 43200) b.push([last[0], last[1], last[1], last[1], last[1], 0]);   // official close newer than the bars
  const n = c.length - 1, p = c[n], bar = b[b.length - 1], [, o, hh, ll, , v] = bar, h = Math.max(hh, p), l = Math.min(ll, p);
  const E20 = emaS(c, 20), E50 = emaS(c, 50), E200 = emaS(c, 200), RS = rsiS(c);
  const e20 = E20[n], e50 = E50[n], e200 = E200[n], rsi = RS[n];
  const vb = b.slice(-51, -1).map(x => x[5]).filter(x => x > 0), v50 = vb.length >= 20 ? vb.reduce((s, x) => s + x, 0) / vb.length : null;
  const v5 = b.slice(-6, -1).reduce((s, x) => s + x[5], 0) / 5, vr = v50 && v ? v / v50 : null, tov = v50 ? v50 * p : 0;
  const atr = atrW(b.slice(-40)), atrp = atr / p * 100;
  const H = b.map(x => x[2]), L = b.map(x => x[3]);
  const hi20 = Math.max(...H.slice(-21, -1)), lo5 = Math.min(...L.slice(-5)), lo10 = Math.min(...L.slice(-10));
  const base = b.slice(-16, -1), bHi = Math.max(...base.map(x => x[2])), bLo = Math.min(...base.map(x => x[3])), bRng = (bHi / bLo - 1) * 100;
  const hi52 = Math.max(...c.slice(-250), ...(Array.isArray(d.hl52) && d.hl52[0] > 0 ? [d.hl52[0]] : []));
  const r20 = ret(c, 20) * 100, r5 = ret(c, 5) * 100, r3m = ret(c, 63), ext20 = (p / e20 - 1) * 100, closeLoc = (p - l) / Math.max(h - l, 1e-9);
  const rs = row.rs, mcap = row.mcap || 0, sym = row.s.replace(/\.NS$/, '');
  const S = { s: row.s, n: row.n, cap: row.cap, sec: row.sec || d.sector || '', ind: row.ind || d.industry || '', p: r2(p), chg: r2((p / c[n - 1] - 1) * 100),
    e20: tk(e20), e50: tk(e50), e200: tk(e200), rsi: Math.round(rsi), atr: r2(atr), atrp: r2(atrp), rs, vr: vr && r2(vr), tovCr: Math.round(tov / 1e7), mcapCr: Math.round(mcap / 1e7),
    hi52: r2(hi52), offHi: r2((p / hi52 - 1) * 100), r1m: r2(ret(c, 21) * 100), r3m: r2(r3m * 100), ext20: r2(ext20), pe: row.pe && r2(row.pe), roce: row.roce, pp: row.pp, dp: row.dp, dpA: row.dpA };
  // ---- 1. hard rejects (the framework's list, plus exchange surveillance) ----
  const why = [], code = [];
  const rej = (k, t) => { code.push(k); why.push(t); };
  if (e20 < e50) rej('e20', '20 EMA below 50 EMA');
  if (p < e50) rej('p50', 'price below the 50 EMA');
  if (p < e200) rej('p200', 'price below the 200 EMA');
  if (!(rs >= RULES.minRs) || r3m < ctx.niftyR3m) rej('rs', `weak relative strength (RS ${rs ?? '–'}; 3 months ${pc1(r3m)}% vs Nifty ${pc1(ctx.niftyR3m)}%)`);
  if (tov < RULES.minTurnover) rej('liq', `poor liquidity (₹${(tov / 1e7).toFixed(1)} Cr a day; needs ₹${RULES.minTurnover / 1e7} Cr)`);
  if (atrp > RULES.maxAtrPct) rej('vol', `abnormal volatility (moves ${atrp.toFixed(1)}% a day on average; limit ${RULES.maxAtrPct}%)`);
  if (r20 > RULES.maxRun20 || ext20 > RULES.maxExt20 || rsi > RULES.maxRsi) rej('para', `parabolic / extended (+${r20.toFixed(0)}% in 20 sessions, ${ext20.toFixed(0)}% above the 20 EMA, RSI ${Math.round(rsi)})`);
  if (p < RULES.minPrice || mcap < RULES.minMcap || row.pn) rej('penny', 'penny / micro-cap characteristics');
  if (vr > RULES.pumpVr && r5 > RULES.pumpR5) rej('pump', `pump-and-dump pattern (volume ${vr.toFixed(1)}× normal with +${r5.toFixed(0)}% in 5 sessions)`);
  const sv = (x && x.surv) || row.sv; if (sv) rej('surv', `under exchange surveillance (${sv})`);
  if (row.pp > 50) rej('pledge', `promoters have pledged ${row.pp}% of their shares — a forced sale can crash the price`);
  // ---- warnings (shown, lower the confidence) ----
  const warn = [];
  const ed = ((d.profile && d.profile.earnDates) || []).find(t => t > ctx.now - 86400 && t < ctx.now + 7 * 86400);
  if (ed) warn.push(`results due ${new Date((ed + 19800) * 1000).toISOString().slice(0, 10)} — the price can gap either way`);
  if (row.caN && row.caN[0] <= new Date((ctx.now + 7 * 86400 + 19800) * 1000).toISOString().slice(0, 10)) warn.push(`ex-date ${row.caN[0]}: ${row.caN[1]}`);
  if (row.pp > 20) warn.push(`promoters have pledged ${row.pp}% of their shares`); else if (row.pp > 5) warn.push(`promoter pledge ${row.pp}%`);
  const aud = x && (x.ann || []).find(a => (a.g || []).includes('auditor') && Date.parse(a.d) > (ctx.now - 120 * 86400) * 1000);
  if (aud) warn.push(`auditor change filed ${aud.d}`);
  if (row.pe > 150) warn.push(`very expensive: P/E ${Math.round(row.pe)}`);
  if (code.length) return { ...S, pass: false, code, why, warn };

  // ---- 2. trend grade ----
  let ts = 0; const tn = [];
  if (p > e20 && e20 > e50 && e50 > e200) { ts += 25; tn.push('averages stacked: price > 20 > 50 > 200 EMA'); } else if (e20 > e50 && e50 > e200) { ts += 18; tn.push('averages stacked; price dipped under the 20 EMA'); } else { ts += 8; tn.push('20 EMA above 50 EMA, but the 50 EMA is still under the 200 EMA'); }
  if (e200 > E200[n - 20]) { ts += 10; tn.push('200 EMA rising'); } else tn.push('200 EMA flat/falling');
  if (e50 > E50[n - 10]) { ts += 10; tn.push('50 EMA rising'); }
  const hl = hhhl(c); if (hl) { ts += 15; tn.push('higher highs and higher lows'); }
  ts += rs >= 85 ? 15 : rs >= 75 ? 10 : 5; tn.push(`relative strength ${rs} (beats ${rs}% of stocks)`);
  const offHi = p / hi52 - 1; if (offHi > -0.05) { ts += 10; tn.push('within 5% of the 52-week high'); } else if (offHi > -0.12) ts += 6;
  if (rsi >= 50 && rsi <= 72) ts += 5;
  const ir = ctx.ind; if (ir && ir.rank <= ir.of / 3) { ts += 10; tn.push(`strong industry (#${ir.rank} of ${ir.of})`); } else if (ir && ir.rank <= ir.of * 2 / 3) ts += 5;
  const grade = ts >= 85 ? 'A+' : ts >= 75 ? 'A' : ts >= 60 ? 'B' : ts >= 45 ? 'C' : 'D';

  // ---- 3. setup ----
  let setup = 'none', ss = 0, det = {}, sw = [];
  const isBO = p >= hi20 && bRng <= 14 && vr >= 1.3;
  const isPB = ext20 > -3.5 && ext20 < 2.5 && e20 > e50 && rsi >= 40 && rsi <= 60 && hi20 / p - 1 > 0.03;
  const isTC = !isBO && hl && ext20 >= 0 && ext20 <= 8 && rsi >= 55 && rsi <= 70;
  const crossAgo = (() => { for (let k = 1; k <= 15; k++) if (E20[n - k] <= E50[n - k]) return k; return null; })();
  if (isBO) {
    setup = 'breakout';
    det = { cons: bRng <= 6 ? 25 : bRng <= 9 ? 19 : bRng <= 12 ? 12 : 6, res: Math.max(...H.slice(-31, -1)) <= hi20 * 1.015 ? 15 : 8,
      cand: closeLoc >= 0.75 && p > o ? 15 : closeLoc >= 0.6 ? 10 : 4, vol: vr >= 2 ? 20 : vr >= 1.5 ? 14 : 8, rs: rs >= 90 ? 15 : rs >= 80 ? 11 : 7, sec: ir ? Math.round(10 * (1 - (ir.rank - 1) / ir.of)) : 4 };
    sw = [`closed above the 20-session high ${inrS(hi20)} after a ${bRng.toFixed(1)}% base`, `volume ${vr.toFixed(1)}× its 50-day average`];
  } else if (isPB) {
    setup = 'pullback';
    det = { d20: Math.abs(ext20) <= 1.5 ? 20 : 13, d50: p / e50 - 1 <= 0.06 ? 10 : 5, rsi: rsi >= 42 && rsi <= 55 ? 15 : 9, vc: v5 < 0.8 * v50 ? 15 : v5 < v50 ? 9 : 3,
      cand: p > o && closeLoc >= 0.6 ? 15 : closeLoc >= 0.5 ? 7 : 0, sup: lo10 >= e50 ? 10 : 6, tq: Math.round(ts / 100 * 15) };
    sw = [`back at the 20 EMA (${ext20 >= 0 ? '+' : ''}${ext20.toFixed(1)}%), RSI ${Math.round(rsi)}`, v5 < 0.8 * v50 ? 'volume dried up on the dip — sellers are tired' : 'volume on the dip is not much lighter than normal'];
  } else if (isTC) {
    setup = 'continuation';
    det = { al: p > e20 && e20 > e50 && e50 > e200 ? 30 : 15, hh: 25, vs: vr >= 1 && p > o ? 20 : v5 >= v50 ? 12 : 6, mq: rsi >= 58 && rsi <= 68 ? 25 : 15 };
    sw = [`orderly uptrend ${ext20.toFixed(1)}% above the 20 EMA, RSI ${Math.round(rsi)}`];
  } else if (crossAgo && p > e200 && e50 > E50[n - 5]) {
    setup = 'early';
    det = { cross: crossAgo <= 5 ? 25 : 15, rs: rs >= 85 ? 20 : 12, vol: vr >= 1.5 ? 15 : 6, base: e50 <= e200 * 1.02 ? 10 : 5 };
    sw = [`20 EMA crossed above the 50 EMA ${crossAgo} session${crossAgo === 1 ? '' : 's'} ago`];
  }
  ss = Object.values(det).reduce((s, x) => s + x, 0);

  // ---- 4. entry / stop / targets ----
  let plan = null, rrWhy = null;
  if (setup !== 'none') {
    let E = tickUp(h * 1.002 + 0.05), SLs;
    if (setup === 'breakout') SLs = Math.min(l, hi20) - 0.25 * atr;
    else if (setup === 'pullback') SLs = lo10 - 0.25 * atr;
    else SLs = lo5 - 0.25 * atr;
    const fixSL = (E, sl) => { const mx = Math.min(RULES.stopMaxAtr * atr, RULES.stopMaxPct / 100 * E); if (E - sl < RULES.stopMinAtr * atr) sl = E - RULES.stopMinAtr * atr; if (E - sl > mx) sl = E - mx; return tickDn(sl); };
    let SL = fixSL(E, SLs), R = E - SL, moved = false;
    // 52-week high just above the trigger (within 2%): the trade is a break to a new high, so the trigger moves above it.
    // Further away but closer than 2R: not enough room — wait for a close above it.
    if (hi52 > E && hi52 - E < R && hi52 <= E * 1.02) { E = tickUp(hi52 * 1.0015 + 0.05); SL = fixSL(E, SLs); R = E - SL; moved = true; }
    const room = hi52 > E * 1.003 ? (hi52 - E) / R : null;
    if (room !== null && room < RULES.minRR) rrWhy = `reward to the 52-week high ${inrS(hi52)} is only ${room.toFixed(1)}R (needs ${RULES.minRR}R)`;
    const st = (ctx.stats && ctx.stats[setup]) || null;
    const T = k => r2(tickDn(E + k * R));
    plan = { E: r2(E), SL: r2(SL), R: r2(R), Rpct: r2(R / E * 100), moved, T1: T(2), T2: T(3), T3: T(4), T4: T(6), be: T(1), room: room && r2(room),
      ent: { aggr: r2(p), norm: r2(E), cons: setup === 'breakout' ? r2(tickUp(hi20 * 1.005)) : r2(tickUp(Math.max(E, e20 * 1.01))),
        ideal: setup === 'breakout' ? [tk(hi20), tk(hi20 * 1.01)] : [tk(e20 * 0.995), tk(e20 * 1.012)] },
      stops: { tech: r2(tickDn(E - 1.5 * atr)), struct: r2(SL), cons: r2(tickDn((setup === 'continuation' ? e20 : e50) - 0.5 * atr)) },
      inval: setup === 'breakout' ? `a daily close back below ${inrS(hi20 - 0.5 * atr)} — the breakout failed and price is back inside the old range`
        : setup === 'pullback' ? `a daily close below ${inrS(Math.min(lo10, e50))} — the swing low / 50 EMA support broke`
        : setup === 'continuation' ? `a daily close below ${inrS(Math.min(lo5, e20))} — the last 5 sessions' low / 20 EMA broke`
        : `the 20 EMA falling back under the 50 EMA (${inrS(e50)})`,
      prob: st ? { T1: st.p2, T2: st.p3, T3: st.p4, T4: st.p6, lose: st.lose, days: st.days, n: st.n, avgR: st.avgR } : null };
  }
  // ---- 5. confidence (rule-based, 0-100) ----
  const p2 = plan && plan.prob ? plan.prob.T1 : 0.37;
  // wide stops (over 5% of the price) cost 3 points per extra %: same rupee risk, but the stock needs a bigger move
  const wide = plan ? Math.max(0, plan.Rpct - 5) * 3 : 0;
  const conf = Math.max(0, Math.min(100, Math.round(0.3 * ts + 0.3 * ss + 0.25 * (ctx.regimeScore ?? 50) + 15 * Math.min(1, p2 / 0.45) - 5 * warn.length - wide - (rrWhy ? 20 : 0))));
  const buy = RULES.buyGrades.includes(grade) && ['breakout', 'pullback', 'continuation'].includes(setup) && ss > RULES.minSetupScore && !rrWhy;
  // what to wait for (watchlist)
  let wait = '';
  if (!buy) wait = rrWhy ? `wait for a close above the 52-week high ${inrS(hi52)}`
    : ext20 > 3 ? `wait for a pullback towards the 20 EMA ${inrS(e20)} and a green candle`
    : setup === 'early' ? `early trend — wait for higher highs and the 50 EMA rising above the 200 EMA`
    : offHi > -0.05 ? `wait for a breakout above ${inrS(Math.max(hi20, hi52))} on volume ≥ 1.5× normal`
    : !RULES.buyGrades.includes(grade) ? `trend grade ${grade} — needs a stronger trend (A or A+)` : `no clean setup yet`;
  return { ...S, pass: true, warn, grade, ts, tn, setup, ss, det, sw, plan, rrWhy, conf, buy, wait, hl };
}

// close-only setup label used by the history check (planstats.js) — same thresholds, no intraday data
function labelClose(c, i, E20, E50, E200, R, niftyRet3m) {
  const p = c[i]; if (!(p > E50[i] && p > E200[i] && E20[i] > E50[i])) return null;
  const rs3 = p / c[i - 63] - 1 - niftyRet3m; if (!(rs3 > 0)) return null;
  const ext = (p / E20[i] - 1) * 100, hi20 = Math.max(...c.slice(i - 20, i));
  const rng = (Math.max(...c.slice(i - 15, i)) / Math.min(...c.slice(i - 15, i)) - 1) * 100;
  if (ext > RULES.maxExt20 || R[i] > RULES.maxRsi || (p / c[i - 20] - 1) * 100 > RULES.maxRun20) return null;
  if (p > hi20 && rng <= 14 && ext < 10) return 'breakout';
  if (ext > -3.5 && ext < 2.5 && R[i] >= 40 && R[i] <= 60 && hi20 / p - 1 > 0.03) return 'pullback';
  const W = c.slice(i - 61, i + 1); if (hhhl(W) && ext >= 0 && ext <= 8 && R[i] >= 55 && R[i] <= 70) return 'continuation';
  return null;
}

const SETUPS = { breakout: '🚀 Breakout', pullback: '↩️ Pullback', continuation: '📈 Trend continuation', early: '🌱 Early-stage trend', none: '— No setup' };
const exp = { RULES, REGIMES, SETUPS, maxPositions, classifyMarket, evaluate, labelClose, emaS, rsiS, atrW, hhhl, r2, tickUp, tickDn };
if (typeof module !== 'undefined') module.exports = exp;
