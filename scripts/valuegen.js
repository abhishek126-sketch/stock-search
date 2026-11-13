#!/usr/bin/env node
'use strict';
// Fair value + "fundamentally strong" for every Indian stock -> data/value.json, run by data.yml after nsedaily.js.
// Used by the 💎 value alerts (scripts/alerts.py, every ~5 min) and the Score filter's "💎 Near fair value" view.
// It runs the app's OWN code - ext.js ivCompute() (DCF, Graham number, Graham growth formula, sector P/E, EPV, dividend
// discount, justified P/B; fair value = median of the methods that give a value, as on the stock page) and score.js
// scoreRow() (Quality / Overall) - in a Node sandbox with small stand-ins for the browser, so the alert price and the
// stock page always agree. Default assumptions (India: 12% discount, 5% terminal growth, AAA 7.5%).
//   value.json: { built, rule, s: { SYM: [fairValue, methods, quality, overall, strong 0/1] } }
// Strong ("Balanced", chosen 14 Nov 2026): Quality >= 70, Overall >= 60, profitable, promoter pledge <= 10%, not under
// exchange surveillance, market cap >= Rs 1,000 Cr, fair value from at least 3 methods. Pledge unknown (no promoter
// group, e.g. ICICIBANK) does not count against it.
// One-off guard: P/E below 3 or profit growing over 60% a year (3-year CAGR) means last year's profit is probably a one-off
// (KIRIINDUS P/E 0.5 after a settlement gain, ASHOKA 1.4, JSWDULUX 3.9) - every earnings-based fair value is then far too
// high (89% "below fair value"), so such stocks are not called strong. Cheap but steady ones (PFC, RECLTD, COALINDIA) stay.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..'), OUT = process.env.DATA_DIR || path.join(ROOT, 'data');
const STRONG = { q: 70, ov: 60, maxPledge: 10, minMcap: 1e10, minMethods: 3, minPE: 3, maxProfitCagr: 0.6 };
const RULE = 'Quality ≥ 70 · Overall ≥ 60 · profitable · promoter pledge ≤ 10% · not under exchange surveillance · market cap ≥ ₹1,000 Cr · fair value from ≥ 3 methods · no one-off profit (P/E ≥ 3, profit growth ≤ 60% a year)';

function sandbox(summary) {
  const ctx = vm.createContext({ console, document: { addEventListener() { }, querySelector() { return null; } }, window: {}, localStorage: null });
  vm.runInContext(`'use strict';
    const LS = { get: (k, d) => d, set() { } };
    const isNum = v => typeof v === 'number' && isFinite(v);
    const last = a => a && a.length ? a[a.length - 1] : undefined;
    const esc = s => String(s ?? '');
    const fmtBig = v => String(Math.round(v)), fmtP = v => String(v);
    const DATA = '';`, ctx, { filename: 'shims.js' });
  for (const f of ['ext.js', 'score.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  ctx.__S = summary; vm.runInContext('SUMMARY = __S;', ctx);
  return ctx;
}

function main() {
  const t0 = Date.now(), S = JSON.parse(fs.readFileSync(path.join(OUT, 'summary.json'), 'utf8')), ctx = sandbox(S);
  const out = {}; let n = 0, nStrong = 0, nFail = 0;
  for (const row of S.rows) {
    if (!/\.(NS|BO)$/.test(row.s) || String(row.cap || '').startsWith('ETF')) continue;
    let d; try { d = JSON.parse(fs.readFileSync(path.join(OUT, 's', row.s + '.json'), 'utf8')); } catch { continue; }
    if (d.etf) continue;
    try {
      // the stock page's inputs for Indian stocks: TTM EPS, ROE and revenue CAGR (the same NSE-corrected figures)
      const k = { eps: row.eps, roe: row.roe, revCAGR: row.revG };
      d.price = row.p;
      const R = ctx.ivCompute(d, k), fv = R.med, m = R.vals.length;
      if (!(fv > 0)) continue;
      const sc = ctx.scoreRow(row), q = sc.q, ov = sc.ov;
      const pledge = typeof row.pp === 'number' ? row.pp : row.plz ? 0 : null;
      const strong = q >= STRONG.q && ov >= STRONG.ov && row.eps > 0 && (pledge === null || pledge <= STRONG.maxPledge) && !row.sv
        && (row.mcap || 0) >= STRONG.minMcap && m >= STRONG.minMethods
        && row.pe >= STRONG.minPE && !(row.niG > STRONG.maxProfitCagr);
      out[row.s] = [Math.round(fv * 100) / 100, m, q == null ? null : Math.round(q), ov == null ? null : Math.round(ov), strong ? 1 : 0];
      n++; if (strong) nStrong++;
    } catch (e) { nFail++; if (nFail <= 5) console.log('value', row.s, String(e.message).slice(0, 120)); }
  }
  fs.writeFileSync(path.join(OUT, 'value.json'), JSON.stringify({ built: Math.floor(Date.now() / 1000), rule: RULE, s: out }));
  const below = Object.entries(out).filter(([s, v]) => v[4] && S.rows.find(r => r.s === s).p <= v[0]).length;
  console.log(`value: fair value for ${n} Indian stocks, ${nStrong} strong (${below} of them at or below fair value), ${nFail} failed, ${Math.round((Date.now() - t0) / 1000)} s`);
}
if (require.main === module) main();
module.exports = { STRONG, RULE };
