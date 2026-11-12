'use strict';
// One definition of the price indicators. The chart (app.js), the research report (report.js),
// the DMA screen (dmasetup.js) and the evening scans (swing.js, momentum.js, planrules.js) all call this.
// EMA is seeded with the SMA of the first N values, then k = 2/(N+1). RSI and ATR use Wilder's smoothing.
// Relative strength is O'Neil's weighted 3/6/12-month return, ranked 1–99 inside one market (build_data.py).
// Bars for ATR are [time, open, high, low, close, volume].
// Wrapped in its own scope: in the browser it only adds window.IND. Top-level function names here (sma, rsi…)
// would clash with app.js's `const sma = IND.sma …` and stop app.js from loading (SyntaxError, 12 Nov 2026).
(function () {

function sma(values, n, end) {
  const z = end == null ? values.length : end;
  if (!(n > 0) || z < n || z > values.length) return null;
  let s = 0;
  for (let i = z - n; i < z; i++) s += values[i];
  return s / n;
}

function smaSeries(values, n) {
  const out = new Array(values.length).fill(null);
  if (!(n > 0)) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function emaSeries(values, n) {
  const k = 2 / (n + 1), out = new Array(values.length).fill(null);
  if (!(n > 0) || values.length < n) return out;
  let e = 0;
  for (let i = 0; i < n; i++) e += values[i];
  e /= n;
  out[n - 1] = e;
  for (let i = n; i < values.length; i++) { e = values[i] * k + e * (1 - k); out[i] = e; }
  return out;
}

function lastNum(series) {
  for (let i = series.length - 1; i >= 0; i--) if (series[i] != null) return series[i];
  return null;
}

function ema(values, n) { return lastNum(emaSeries(values, n)); }

function rsiSeries(values, n = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = values[i] - values[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  out[n] = l ? 100 - 100 / (1 + g / l) : 100;
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l ? 100 - 100 / (1 + g / l) : 100;
  }
  return out;
}

function rsi(values, n = 14) { return lastNum(rsiSeries(values, n)); }

// Wilder ATR. Needs more than n bars. Seed is the mean of the first n true ranges.
function atr(bars, n = 14) {
  if (!bars || bars.length <= n) return null;
  const tr = [];
  for (let i = 1; i < bars.length; i++) {
    const hi = bars[i][2], lo = bars[i][3], prev = bars[i - 1][4];
    tr.push(Math.max(hi - lo, Math.abs(hi - prev), Math.abs(lo - prev)));
  }
  let a = 0;
  for (let i = 0; i < n; i++) a += tr[i];
  a /= n;
  for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return a;
}

// MACD on closes. Signal is the 9-period EMA of the MACD line, starting once both EMAs exist.
function macd(values, fast = 12, slow = 26, signal = 9) {
  const f = emaSeries(values, fast), s = emaSeries(values, slow), line = [];
  for (let i = 0; i < values.length; i++) if (f[i] != null && s[i] != null) line.push(f[i] - s[i]);
  const sig = emaSeries(line, signal), j = line.length - 1;
  if (j < 0 || sig[j] == null) return { macd: null, signal: null, hist: null };
  return { macd: line[j], signal: sig[j], hist: line[j] - sig[j] };
}

// 0.4 × 3-month + 0.2 × 6-month + 0.4 × 1-year. A missing longer return falls back to the shorter one.
function rsScore(k) {
  if (k == null || k.r3m == null || !isFinite(k.r3m)) return null;
  const r6 = k.r6m == null || !isFinite(k.r6m) ? k.r3m : k.r6m;
  const r1 = k.r1y == null || !isFinite(k.r1y) ? r6 : k.r1y;
  return 0.4 * k.r3m + 0.2 * r6 + 0.4 * r1;
}

// Python 3 round(): half goes to the even integer. Ranks sit on .5 often enough to matter.
function pyRound(x) {
  const neg = x < 0, a = Math.abs(x), f = Math.floor(a), d = a - f;
  const r = Math.abs(d - 0.5) < 1e-9 ? (f % 2 === 0 ? f : f + 1) : (d > 0.5 ? f + 1 : f);
  return neg ? -r : r;
}

// rows: { s, r3m, r6m, r1y, market: 'IN' | 'US' }. Returns { symbol: rank 1–99 }. Ties keep input order.
function rsRanks(rows) {
  const out = {};
  for (const market of ['IN', 'US']) {
    const scored = [];
    for (const r of rows) { if (r.market !== market) continue; const v = rsScore(r); if (v != null) scored.push([r.s, v]); }
    scored.sort((a, b) => a[1] - b[1]);
    const n = scored.length;
    scored.forEach(([s], i) => { out[s] = pyRound(1 + 98 * i / Math.max(1, n - 1)); });
  }
  return out;
}

// Shape of one daily candle [t, o, h, l, c, v], all as % of the day's range: cl = where it closed (0 = at the low,
// 100 = at the high), body = |close − open|, uw / lw = upper / lower wick; up = closed at or above the open.
// `close` overrides the bar's close (the official close can be newer than the bar). null when there was no range.
function candle(bar, close) {
  if (!bar) return null;
  const o = bar[1], c = close != null && isFinite(close) ? close : bar[4];
  if (!(o > 0) || !(c > 0)) return null;
  const h = Math.max(bar[2], o, c), l = Math.min(bar[3], o, c), r = h - l;
  if (!(r > 0)) return null;
  const pc = x => Math.round(x / r * 100);
  return { cl: pc(c - l), body: pc(Math.abs(c - o)), uw: pc(h - Math.max(o, c)), lw: pc(Math.min(o, c) - l), up: c >= o };
}

// Stan Weinstein's stage (Secrets for Profiting in Bull and Bear Markets, 1988) from WEEKLY closes and the
// 30-week simple average. hist = [[unix seconds, close], …] daily. The 30-week line is "rising" / "falling" when it
// moved more than 1% over the last 4 weeks, otherwise flat; a flat line is a top (3) after a rise of more than 3%
// over the 22 weeks before, else a base (1) — unless the price is more than 5% below it (still declining, 4).
//   2 advancing: above a rising line · 4 declining: below a falling line · 3 topping / 1 basing: flat line
//   below a rising line = stage 2 being tested · above a falling line = a possible base (stage 1), not an uptrend yet
function weinstein(hist) {
  const W = []; let key = null;
  for (const h of hist || []) {
    const t = h[0], c = h[1]; if (!(c > 0)) continue;
    const day = Math.floor((t + 19800) / 86400), wk = day - ((day + 3) % 7);   // Monday of that week (IST)
    if (wk === key) W[W.length - 1] = c; else { W.push(c); key = wk; }
  }
  if (W.length < 40) return null;
  const ma = smaSeries(W, 30), n = W.length - 1, m = ma[n], m4 = ma[n - 4], m26 = ma[Math.max(29, n - 26)];
  const slope = (m / m4 - 1) * 100, prior = (m4 / m26 - 1) * 100, p = W[n], above = p >= m;
  const rising = slope > 1, falling = slope < -1;
  let stage, note = '';
  if (rising) { stage = 2; if (!above) note = 'below a still-rising 30-week line — the uptrend is being tested'; }
  else if (falling) { stage = above ? 1 : 4; if (above) note = 'back above a still-falling 30-week line — a possible base, not an uptrend yet'; }
  else if (p < m * 0.95) { stage = 4; note = 'the 30-week line is flattening, but the price is still well below it'; }
  else { stage = prior > 3 ? 3 : 1; if (stage === 1 && p > m * 1.05) note = 'pushing above its base — stage 2 starts when the 30-week line turns up'; }
  const r1 = x => Math.round(x * 10) / 10;
  return { stage, note, ma30w: Math.round(m * 100) / 100, slope4w: r1(slope), dist: r1((p / m - 1) * 100), weeks: W.length };
}

const API = { sma, smaSeries, emaSeries, ema, rsiSeries, rsi, atr, macd, rsScore, rsRanks, pyRound, candle, weinstein };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.IND = API;
})();
