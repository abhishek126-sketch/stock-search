'use strict';
/**
 * DMA setup screen for long-term investors - works in the browser (window.DmaSetup) and in Node (require).
 *
 *   "Best"      : Price > 50 DMA > 200 DMA                       AND volume > 1.5 x average volume
 *   "Strongest" : Price > 20 DMA > 50 DMA > 200 DMA AND a recent golden cross AND volume > 1.5 x average volume
 *                 (every "Strongest" stock is also "Best")
 *
 * Definitions (all configurable through `opts`):
 *  - DMA = simple moving average of daily closes over the last N sessions, today included.
 *  - Average volume = mean of the `volLookback` (default 50) sessions BEFORE today, so today's spike does not inflate
 *    its own average. Days with zero / missing volume are skipped (holidays, bad data); at least 80% must be valid.
 *  - Volume ratio = today's volume / average volume. Use a completed session: an intraday volume is partial.
 *  - Golden cross "present" = the 50 DMA crossed from at-or-below to above the 200 DMA on one of the last
 *    `crossLookback` sessions (default 60, about 3 months; today counts as one, so sessionsAgo is 0-59), did not cross
 *    back down since, and is above it today.
 *    A cross older than that is an established uptrend, not a "recent" golden cross.
 *
 * Input: array of { date, close, volume } in any order. `date` = 'YYYY-MM-DD', Date, or a Unix time (seconds or ms).
 *   Rows with a missing / non-positive close are dropped (reported in `data.dropped`); duplicate dates keep the last.
 * Output: plain JSON (see `screenDmaSetups`). On a problem: { ok: false, error: CODE, message, ... }, never a throw.
 */
(function (root) {
  const DEFAULTS = { volLookback: 50, volMultiple: 1.5, crossLookback: 60, staleDays: 7, minValidVol: 0.8 };
  const DAY = 864e5;

  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const round = (v, d = 2) => (isNum(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

  /** Normalise a date to ms since epoch (UTC midnight for 'YYYY-MM-DD'); null if unreadable. */
  function toMs(d) {
    if (d instanceof Date) return Number.isFinite(d.getTime()) ? d.getTime() : null;
    if (isNum(d)) return d < 1e11 ? d * 1000 : d;                          // Unix seconds or ms
    if (typeof d === 'string') { const t = Date.parse(d.length === 10 ? d + 'T00:00:00Z' : d); return Number.isFinite(t) ? t : null; }
    return null;
  }
  const isoDate = ms => new Date(ms).toISOString().slice(0, 10);

  /** Clean the input: valid closes only, sorted by date, one row per day. */
  function normalise(rows) {
    if (!Array.isArray(rows)) return { error: 'BAD_INPUT', message: 'Expected an array of { date, close, volume }.' };
    const byDay = new Map(); let dropped = 0;
    for (const r of rows) {
      const t = r && toMs(r.date), c = r && +r.close;
      if (t === null || !(c > 0) || !Number.isFinite(c)) { dropped++; continue; }
      const v = r.volume == null || r.volume === '' ? null : +r.volume;
      byDay.set(isoDate(t), { t, close: c, volume: Number.isFinite(v) && v > 0 ? v : null });
    }
    const out = [...byDay.values()].sort((a, b) => a.t - b.t);
    return { rows: out, dropped, duplicates: rows.length - dropped - out.length };
  }

  /** Simple moving average series: sma[i] = mean of closes[i-n+1..i], null until n values exist. O(length). */
  function smaSeries(values, n) {
    const out = new Array(values.length).fill(null); let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i]; if (i >= n) sum -= values[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  /** Average volume of the `lookback` sessions before the last one (valid volumes only). */
  function averageVolume(rows, lookback, minValid) {
    const win = rows.slice(-1 - lookback, -1).map(r => r.volume).filter(v => v > 0);
    if (win.length < Math.ceil(lookback * minValid)) return { avg: null, valid: win.length };
    return { avg: win.reduce((s, v) => s + v, 0) / win.length, valid: win.length };
  }

  /** Most recent 50/200 cross within the last `lookback` sessions: { type: 'golden'|'death', index } or null. */
  function lastCross(s50, s200, lookback) {
    const end = s50.length - 1;
    for (let i = end; i > Math.max(0, end - lookback); i--) {
      const a0 = s50[i - 1], b0 = s200[i - 1], a1 = s50[i], b1 = s200[i];
      if (![a0, b0, a1, b1].every(isNum)) break;
      if (a0 <= b0 && a1 > b1) return { type: 'golden', index: i };
      if (a0 >= b0 && a1 < b1) return { type: 'death', index: i };
    }
    return null;
  }

  /**
   * Screen one stock.
   * @param {Array<{date:string|number|Date, close:number, volume?:number}>} rows  daily history
   * @param {{symbol?:string, livePrice?:number, asOf?:string|number|Date} & Partial<typeof DEFAULTS>} [opts]
   */
  function screenDmaSetups(rows, opts = {}) {
    const o = { ...DEFAULTS, ...opts }, sym = o.symbol || null;
    const fail = (error, message, extra = {}) => ({ ok: false, symbol: sym, error, message, ...extra });
    try {
      const n = normalise(rows); if (n.error) return fail(n.error, n.message);
      const R = n.rows, need = 200 + o.crossLookback;                 // 200 for today's 200 DMA, + lookback to see the cross
      if (R.length < 200) return fail('INSUFFICIENT_HISTORY', `Needs at least 200 sessions for a 200 DMA; has ${R.length} (listed too recently or data missing).`, { have: R.length, need: 200 });

      const closes = R.map(r => r.close), last = R[R.length - 1], i = R.length - 1;
      const s20 = smaSeries(closes, 20), s50 = smaSeries(closes, 50), s200 = smaSeries(closes, 200);
      const price = isNum(o.livePrice) && o.livePrice > 0 ? o.livePrice : last.close;
      const d20 = s20[i], d50 = s50[i], d200 = s200[i];

      const warnings = [];
      if (n.dropped) warnings.push(`${n.dropped} row(s) with a missing or invalid close were ignored.`);
      if (n.duplicates > 0) warnings.push(`${n.duplicates} duplicate date(s) - the last one was kept.`);
      const ref = o.asOf != null ? toMs(o.asOf) : Date.now();
      if (ref && (ref - last.t) / DAY > o.staleDays) warnings.push(`Latest data is from ${isoDate(last.t)} - more than ${o.staleDays} days old.`);
      if (R.length < need) warnings.push(`Only ${R.length} sessions: a golden cross can be checked over the last ${Math.max(0, R.length - 200)} sessions instead of ${o.crossLookback}.`);

      // volume
      const va = averageVolume(R, o.volLookback, o.minValidVol), cur = last.volume;
      const volRatio = va.avg && cur ? cur / va.avg : null;
      if (!va.avg) warnings.push(`Average volume needs ${Math.ceil(o.volLookback * o.minValidVol)} valid days of the last ${o.volLookback}; has ${va.valid}.`);
      if (!cur) warnings.push(`No volume for the latest session (${isoDate(last.t)}).`);
      const volOk = volRatio !== null && volRatio > o.volMultiple;

      // golden cross
      const cx = lastCross(s50, s200, o.crossLookback);
      const golden = !!cx && cx.type === 'golden' && d50 > d200;
      const gc = { present: golden, lookbackSessions: o.crossLookback,
        date: golden ? isoDate(R[cx.index].t) : null, sessionsAgo: golden ? i - cx.index : null,
        lastCrossInWindow: cx ? { type: cx.type, date: isoDate(R[cx.index].t) } : null };

      // conditions
      const c = {
        priceAbove20: price > d20, sma20Above50: d20 > d50, priceAbove50: price > d50, sma50Above200: d50 > d200,
        volumeAboveMultiple: volOk, goldenCross: golden,
      };
      const best = c.priceAbove50 && c.sma50Above200 && volOk;
      const strongest = c.priceAbove20 && c.sma20Above50 && c.sma50Above200 && golden && volOk;

      const why = [];
      if (!c.priceAbove50) why.push('price is not above the 50 DMA');
      if (!c.sma50Above200) why.push('50 DMA is not above the 200 DMA');
      if (!volOk) why.push(volRatio === null ? 'volume ratio unavailable' : `volume is ${round(volRatio)}x average (needs > ${o.volMultiple}x)`);
      if (!strongest) {
        if (!c.priceAbove20) why.push('price is not above the 20 DMA');
        if (!c.sma20Above50) why.push('20 DMA is not above the 50 DMA');
        if (!golden) why.push(cx && cx.type === 'death' ? `50 DMA crossed below the 200 DMA on ${isoDate(R[cx.index].t)}` : `no golden cross in the last ${o.crossLookback} sessions`);
      }

      return {
        ok: true, symbol: sym, asOf: isoDate(last.t), price: round(price), priceSource: price === last.close ? 'close' : 'live',
        dma: { d20: round(d20), d50: round(d50), d200: round(d200) },
        // avgTurnover = average volume x price (in the stock's currency): a spike on a stock that trades a few hundred
        // shares a day means little - for long-term screens consider requiring, e.g., >= Rs 1 crore (1e7) a day
        volume: { current: cur, average: va.avg && Math.round(va.avg), lookbackDays: o.volLookback, ratio: round(volRatio), required: o.volMultiple, avgTurnover: va.avg ? Math.round(va.avg * price) : null },
        goldenCross: gc, conditions: c,
        setups: { best, strongest },
        notMet: [...new Set(why)], warnings,
        data: { sessions: R.length, dropped: n.dropped },
      };
    } catch (e) {
      return fail('INTERNAL_ERROR', String(e && e.message || e));
    }
  }

  /**
   * Rows for screenDmaSetups from one of the app's stock files (data/s/<SYM>.json): 5 years of daily closes (hist) with
   * Yahoo's daily volume (ohlc, last 80 sessions); a session Yahoo has no volume for yet takes NSE's official traded
   * quantity (deliv rows [date, delivery %, quantity] from scripts/nsedaily.js) - the two agree within 2% on 99.8% of
   * 60,007 stock-days (11 Nov 2026). Dates are IST trading days.
   */
  function rowsFromAppDoc(d) {
    const day = t => new Date(t * 1000 + 19800e3).toISOString().slice(0, 10);
    const v = new Map((d && d.ohlc || []).filter(b => b[5] > 0).map(b => [day(b[0]), b[5]]));
    for (const r of (d && d.deliv) || []) if (Array.isArray(r) && r[2] > 0 && !v.has(r[0])) v.set(r[0], r[2]);
    return ((d && d.hist) || []).map(([t, c]) => ({ date: day(t), close: c, volume: v.get(day(t)) }));
  }

  const api = { screenDmaSetups, rowsFromAppDoc, smaSeries, averageVolume, lastCross, normalise, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DmaSetup = api;
})(typeof window !== 'undefined' ? window : globalThis);
