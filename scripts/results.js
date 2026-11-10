#!/usr/bin/env node
'use strict';
// Quarterly and annual sales, net profit and EPS for NSE stocks, read from the companies' own results filings on NSE
// (XBRL). Run by corp.yml after build_corp.py. Feeds the earnings-momentum scan (scripts/momentum.js) and replaces
// Yahoo's quarterly/annual sales, profit and EPS in the evening refresh (build_data.py nse_fin), Yahoo as fallback.
//
//   Recent results (from 2025): NSE "integrated filing" feed â€” one XBRL per quarter, current-period figures only
//   Older results              : NSE "corporates-financial-results" feed (stopped at Dec 2024), Quarterly and Annual
// Basis: consolidated when the company files consolidated results for its latest quarter, else standalone; one basis
// throughout so growth is compared like for like. Net profit = ProfitLossForPeriod (incl. minority interest), the
// figure Screener's "PAT" uses.
//
// Stores in data/x/<SYM>.json:
//   pr = { b: 'C'|'S', q: [[quarterEnd, profit, sales, eps]] (last 8), fy: [[yearEnd, profit, sales, eps]] (last 6 March years),
//          g5: 5-year profit ends {b, a:[end, profit], z:[start, profit]}, qe: latest quarter seen, t: checked (unix), v }
// Only filings not read before are fetched, so after the first pass each company costs one list call per run,
// plus 1 XBRL when it has published a new quarter.
const fs = require('fs'), path = require('path');
const OUT = process.env.DATA_DIR || path.join(__dirname, '..', 'data'), XD = path.join(OUT, 'x'), CD = path.join(OUT, 'corp');
const PRV = 3;   // reader version: bump when the parsing changes, so every company is re-read
const MAXSEC = +(process.env.RES_MAXSEC || 1200), T0 = Date.now(), RECHECK = 3 * 86400;   // re-check each company's filing list every 3 days
const ONLY = (process.env.RES_SYMS || '').split(',').filter(Boolean);                      // testing: limit to these symbols
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9' };
const D = { listed: 0, checked: 0, xbrl: 0, xbrlFail: 0, noProfit: 0, errs: [] };
let cookie = '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function nseHome() {
  try { const r = await fetch('https://www.nseindia.com/', { headers: { ...UA, Accept: 'text/html' } }); cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; '); } catch (e) { console.log('nse home', e.message); }
}
async function get(url, json = true, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { ...UA, Cookie: cookie, Referer: 'https://www.nseindia.com/' }, signal: AbortSignal.timeout(20000) });
      if (r.status === 404) throw new Error('404');
      if (r.status === 401 || r.status === 403) { await nseHome(); throw new Error('HTTP ' + r.status); }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return json ? await r.json() : await r.text();
    } catch (e) { err = e; if (e.message === '404') break; await sleep(1500 + 2500 * i); }
  }
  throw err;
}
const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
const iso = s => { const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(String(s || '').trim()); return m ? `${m[3]}-${MON[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}` : ''; };
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
// net profit facts for periods without dimensions: { 'start..end': value in rupees }
function profits(x) {
  const ctx = {};
  for (const m of x.matchAll(/<(?:[\w-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?context>/g)) {
    if (/explicitMember|typedMember/.test(m[2])) continue;
    const sd = (/startDate>\s*([\d-]+)/.exec(m[2]) || [])[1], ed = (/endDate>\s*([\d-]+)/.exec(m[2]) || [])[1];
    if (sd && ed) ctx[m[1]] = sd + '..' + ed;
  }
  // older filings (to 2024) often leave the period contexts undefined ("OneD", "FourD") â€” or define them with the wrong
  // dates (Titan Dec-2023: "FourD" = Octâ€“Dec though it holds Aprâ€“Dec) â€” and state the real dates as facts: those win
  const fact = tag => { const o = {}; for (const m of x.matchAll(new RegExp(`<[\\w-]+:${tag}\\b[^>]*contextRef="([^"]+)"[^>]*>\\s*([\\d-]{10})\\s*<`, 'g'))) o[m[1]] = m[2]; return o; };
  const fs_ = fact('DateOfStartOfReportingPeriod'), fe_ = fact('DateOfEndOfReportingPeriod');
  for (const id in fs_) if (fe_[id]) ctx[id] = fs_[id] + '..' + fe_[id];
  // profit attributable to the company's own shareholders when filed (what Screener shows), else profit for the period.
  // Amounts are in rupees in both formats (the "level of rounding" field only describes the PDF).
  const val = tag => { const o = {}; for (const m of x.matchAll(new RegExp(`<[\\w-]+:${tag}\\b[^>]*contextRef="([^"]+)"[^>]*>\\s*([-0-9.Ee]+)\\s*<`, 'g'))) if (ctx[m[1]] && !(ctx[m[1]] in o)) o[ctx[m[1]]] = +m[2]; return o; };
  // banks file a different format (in-capmkt banking): profit after minority interest, 'Interest earned' as revenue
  // (what Screener shows as a bank's revenue), EPS after extraordinary items. Read since 10 Nov 2026 (were skipped).
  const any = (...t) => { for (const k of t) { const o = val(k); if (Object.keys(o).length) return o; } return {}; };
  const own = any('ProfitOrLossAttributableToOwnersOfParent', 'ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates');
  const tot = any('ProfitLossForPeriod', 'NetProfitLossForThePeriod', 'ProfitLossForThePeriod');
  const rev = any('RevenueFromOperations', 'InterestEarned');
  // sales net of excise duty, as Screener shows them (ITC, refiners): excise is filed as an "other expenses" line
  // described "Excise Duty" in a dimension context â€” same context id carries the amount
  const per = {};
  for (const m of x.matchAll(/<(?:[\w-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?context>/g)) {
    const sd = (/startDate>\s*([\d-]+)/.exec(m[2]) || [])[1], ed = (/endDate>\s*([\d-]+)/.exec(m[2]) || [])[1]; if (sd && ed) per[m[1]] = sd + '..' + ed;
  }
  for (const m of x.matchAll(/<[\w-]+:DescriptionOfOtherExpenses\b[^>]*contextRef="([^"]+)"[^>]*>\s*([^<]*)</g)) {
    if (!/excise/i.test(m[2]) || /refund|incentive|recover/i.test(m[2])) continue;
    // "OneExpenses1D" belongs to period "OneD", "FourExpenses1D" to "FourD" (older filings mis-date these sub-contexts)
    const id = m[1], bp = /^(One|Two|Three|Four|Five|Six)\w+D$/.exec(id), a = new RegExp(`<[\\w-]+:OtherExpenses\\b[^>]*contextRef="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>\\s*([-0-9.Ee]+)\\s*<`).exec(x), p = (bp && ctx[bp[1] + 'D']) || ctx[id] || per[id];
    if (a && p && rev[p] !== undefined && +a[1] > 0 && +a[1] < rev[p]) rev[p] -= +a[1];
  }
  const eps = any('BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations', 'BasicEarningsLossPerShareFromContinuingOperations', 'BasicEarningsPerShareAfterExtraordinaryItems');
  // { 'start..end': { np, rev, eps } }  np = profit attributable to shareholders (else profit for the period), rupees; eps in â‚¹
  const out = {};
  for (const k of new Set([...Object.keys(tot), ...Object.keys(own)])) (out[k] = out[k] || {}).np = own[k] ? own[k] : tot[k] ?? own[k];
  for (const k in rev) (out[k] = out[k] || {}).rev = rev[k];
  for (const k in eps) (out[k] = out[k] || {}).eps = eps[k];
  // shareholders' equity on balance-sheet dates (half-year and year-end filings): { '@YYYY-MM-DD': { eq } } - for book
  // value / P/B and bank ROE (Yahoo's bank equity includes subsidiaries' minority holders: HDFCBANK 8.17 vs ~6 lakh Cr)
  const ins = {};
  for (const m of x.matchAll(/<(?:[\w-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?context>/g)) {
    if (/explicitMember|typedMember/.test(m[2])) continue;
    const d = (/instant>\s*([\d-]+)/.exec(m[2]) || [])[1]; if (d) ins[m[1]] = '@' + d;
  }
  const iv = tag => { const o = {}; for (const m of x.matchAll(new RegExp(`<[\\w-]+:${tag}\\b[^>]*contextRef="([^"]+)"[^>]*>\\s*([-0-9.Ee]+)\\s*<`, 'g'))) if (ins[m[1]] && !(ins[m[1]] in o)) o[ins[m[1]]] = +m[2]; return o; };
  let eq = iv('EquityAttributableToOwnersOfParent');
  if (!Object.keys(eq).length) eq = iv('Equity');
  if (!Object.keys(eq).length) { const c = iv('Capital'), r = iv('ReservesAndSurplus'); for (const k in c) if (r[k] !== undefined) eq[k] = c[k] + r[k]; }
  if (!Object.keys(eq).length) { const c = iv('EquityShareCapital'), r = iv('OtherEquity'); for (const k in c) if (r[k] !== undefined) eq[k] = c[k] + r[k]; }
  for (const k in eq) if (eq[k] > 0) out[k] = { eq: eq[k] };
  return out;
}
async function readXbrl(url) {
  const x = await get(url, false, 2); D.xbrl++;
  const p = profits(x); if (!Object.values(p).some(v => v.np !== undefined)) D.noProfit++;
  return p;
}
// filings for one symbol: [{qe, b:'C'|'S', u, fy:bool}]
async function filings(sym) {
  const q = encodeURIComponent(sym), out = [];
  const a = await get(`https://www.nseindia.com/api/integrated-filing-results?index=equities&symbol=${q}&type=Integrated%20Filing-%20Financials`).catch(() => null);
  for (const r of (a && a.data) || []) {
    const qe = iso(r.qe_Date), u = r.xbrl || '';
    if (qe && /^https?:\/\/.+\.xml$/i.test(u) && /onsolidated|tandalone/.test(r.consolidated || '')) out.push({ qe, b: /^Consolidated/i.test(r.consolidated) ? 'C' : 'S', u, src: 'int', orig: !/^Revis/i.test(r.type_Sub || '') });
  }
  out.sort((a, b) => b.orig - a.orig);                  // the original filing first (what the company announced; revisions can be partial)
  for (const per of ['Quarterly', 'Annual']) {
    const o = await get(`https://www.nseindia.com/api/corporates-financial-results?index=equities&period=${per}&symbol=${q}`).catch(() => null);
    for (const r of Array.isArray(o) ? o : []) {
      const qe = iso(r.toDate), u = r.xbrl || '';
      if (qe && /^https?:\/\/.+\.xml$/i.test(u) && r.bank !== 'Y') out.push({ qe, b: r.consolidated === 'Consolidated' ? 'C' : 'S', u, src: per === 'Annual' ? 'ann' : 'old', cum: r.cumulative === 'Cumulative' });
    }
  }
  return out;
}
async function one(sym, prev) {
  const fl = await filings(sym); D.listed++;
  if (!fl.length) return { ...(prev || {}), t: Math.floor(Date.now() / 1000), none: 1 };
  const latest = fl.filter(f => f.src !== 'ann').map(f => f.qe).sort().pop();
  const b = fl.some(f => f.qe === latest && f.b === 'C' && f.src !== 'ann') ? 'C' : 'S';
  const pr = prev && prev.b === b && prev.v === PRV ? { ...prev } : { b, q: [], fy: [] };
  // rows: [periodEnd, np, rev, eps] â€” keep what was read before, fetch only what's missing
  const Q = new Map((pr.q || []).map(r => [r[0], r])), FY = new Map((pr.fy || []).map(r => [r[0], r]));
  const cache = new Map();                                  // xbrl url -> parsed facts (each file read at most once)
  const read = async f => {
    if (!cache.has(f.u)) { try { cache.set(f.u, await readXbrl(f.u)); } catch (e) { cache.set(f.u, {}); D.xbrlFail++; if (D.errs.length < 8) D.errs.push(sym + ' ' + String(e.message).slice(0, 60)); } }
    return cache.get(f.u);
  };
  const qStart = d => ({ '03-31': d.slice(0, 4) + '-01-01', '06-30': d.slice(0, 4) + '-04-01', '09-30': d.slice(0, 4) + '-07-01', '12-31': d.slice(0, 4) + '-10-01' })[d.slice(5)];
  const fyStart = d => (d.slice(5) === '03-31' ? +d.slice(0, 4) - 1 : +d.slice(0, 4)) + '-04-01';
  // facts for an exact period, from the filings for its end date (original first, then revisions; new feed, then old)
  const period = async (basis, s, e, srcs) => {
    let got;
    for (const src of srcs) for (const f of fl.filter(f => f.b === basis && f.qe === e && f.src === src)) {
      const v = (await read(f))[s + '..' + e];
      if (v && v.np !== undefined) { got = { ...v, ...(got || {}) }; if (got.rev !== undefined && got.eps !== undefined) return got; }
    }
    return got;
  };
  const prevQE = d => ({ '03-31': (+d.slice(0, 4) - 1) + '-12-31', '06-30': null, '09-30': d.slice(0, 4) + '-06-30', '12-31': d.slice(0, 4) + '-09-30' })[d.slice(5)];
  const shiftQ = (d, n) => { let x = d; for (let i = 0; i < n; i++) x = ({ '03-31': (+x.slice(0, 4) - 1) + '-12-31', '06-30': x.slice(0, 4) + '-03-31', '09-30': x.slice(0, 4) + '-06-30', '12-31': x.slice(0, 4) + '-09-30' })[x.slice(5)]; return x; };
  // one quarter: as filed, else year-to-date minus the previous quarter's year-to-date (some filings carry only YTD)
  const quarter = async (basis, d) => {
    const q = await period(basis, qStart(d), d, ['int', 'old']); if (q) return q;
    const p = prevQE(d); if (!p) return undefined;
    const a = await period(basis, fyStart(d), d, ['int', 'old']), z = p.endsWith('06-30') ? await period(basis, qStart(p), p, ['int', 'old']) : await period(basis, fyStart(p), p, ['int', 'old']);
    if (!a || !z) return undefined;
    const sub = k => a[k] !== undefined && z[k] !== undefined ? a[k] - z[k] : undefined;
    return { np: sub('np'), rev: sub('rev'), eps: sub('eps') !== undefined ? Math.round(sub('eps') * 100) / 100 : undefined };
  };
  // full year: the March-quarter filing usually carries it; some (2023â€“24) only have Janâ€“Mar â†’ Aprâ€“Dec (December filing) + Janâ€“Mar
  const year = async (basis, d) => {
    const y = await period(basis, fyStart(d), d, ['ann', 'int', 'old']); if (y) return y;
    const dec = (+d.slice(0, 4) - 1) + '-12-31', a = await period(basis, fyStart(dec), dec, ['int', 'old']), z = await quarter(basis, d);    if (!a || !z) return undefined;
    const add = k => a[k] !== undefined && z[k] !== undefined ? a[k] + z[k] : undefined;
    return { np: add('np'), rev: add('rev'), eps: add('eps') !== undefined ? Math.round(add('eps') * 100) / 100 : undefined };
  };
  const row = (d, v) => [d, v.np, v.rev ?? null, v.eps ?? null];
  // wanted: the last 8 quarters (quarterly table, TTM EPS, year-on-year growth) and the last 6 March years (growth, 5-year growth)
  const lastFY = latest >= latest.slice(0, 4) + '-03-31' ? latest.slice(0, 4) + '-03-31' : (+latest.slice(0, 4) - 1) + '-03-31';
  const fy5 = (+lastFY.slice(0, 4) - 5) + '-03-31';
  for (let i = 0; i < 8; i++) { const d = shiftQ(latest, i); if (!Q.has(d)) { const v = await quarter(b, d); if (v && v.np !== undefined) Q.set(d, row(d, v)); } }
  for (let i = 0; i <= 5; i++) { const d = (+lastFY.slice(0, 4) - i) + '-03-31'; if (!FY.has(d)) { const v = await year(b, d); if (v) FY.set(d, row(d, v)); } }
  // 5-year growth needs both ends on one basis: when the old year exists only standalone (common before 2022), use standalone for both
  let g5 = pr.g5 && pr.g5.a && pr.g5.a[0] === lastFY ? pr.g5 : null;
  if (!g5) {
    if (FY.has(lastFY) && FY.has(fy5)) g5 = { b, a: [lastFY, FY.get(lastFY)[1]], z: [fy5, FY.get(fy5)[1]] };
    else if (FY.has(lastFY)) {
      const o = b === 'C' ? 'S' : 'C', z = await year(o, fy5);
      if (z) { const a = await year(o, lastFY); if (a) g5 = { b: o, a: [lastFY, a.np], z: [fy5, z.np] }; }
    }
  }
  // shareholders' equity on the last 4 half-year / year-end balance-sheet dates (book value, P/B, bank ROE): rows [date, eq]
  const EQ = new Map((pr.eq || []).map(r => [r[0], r]));
  for (let i = 0; i < 8; i++) {
    const d = shiftQ(latest, i); if (!/-(03-31|09-30)$/.test(d) || EQ.has(d)) continue;
    for (const src of ['int', 'ann', 'old']) {
      const fi = fl.find(f => f.b === b && f.qe === d && f.src === src); if (!fi) continue;
      const v = (await read(fi))['@' + d]; if (v && v.eq > 0) { EQ.set(d, [d, v.eq]); break; }
    }
  }
  const eqs = [...EQ.values()].sort((x, y) => x[0] < y[0] ? -1 : 1).slice(-4);
  const qs = [...Q.values()].sort((x, y) => x[0] < y[0] ? -1 : 1).slice(-8), fys = [...FY.values()].sort((x, y) => x[0] < y[0] ? -1 : 1).slice(-6);
  const ca = caOf(sym), alt = {}, probe = qs.map(r => [...r]);
  restate(probe, fys.map(r => [...r]), ca, pr.alt);
  for (const d of probe.flagged || []) {
    if (pr.alt && pr.alt[d]) { alt[d] = pr.alt[d]; continue; }
    const p = prevQE(d); if (!p) continue;                                   // a June quarter is its own year-to-date
    const y1 = await period(b, fyStart(d), d, ['int', 'ann', 'old']), y0 = await period(b, fyStart(p), p, ['int', 'old']);
    if (y1 && y0) alt[d] = [y1.np != null && y0.np != null ? Math.round(y1.np - y0.np) : null, y1.eps != null && y0.eps != null ? Math.round((y1.eps - y0.eps) * 100) / 100 : null];
  }
  const adj = restate(qs, fys, ca, alt), nf = [...qs, ...fys].filter(r => r.length > 5 && r[5] != null).length;
  return { b, q: qs, fy: fys, g5, qe: latest, t: Math.floor(Date.now() / 1000), v: PRV, ...(adj ? { epsAdj: adj } : {}), ...(nf ? { npFix: nf } : {}), ...(eqs.length ? { eq: eqs } : {}), ...(Object.keys(alt).length ? { alt } : {}) };
}
// EPS on today's share count, and misread filings. Rows [end, np, rev, eps(, epsAsFiled)].
// 1. Bonus / split: EPS of periods before the ex-date is divided by the ratio (as Yahoo / Screener restate it). Ex-dates
//    and ratios come from NSE's corporate actions (nsedaily.js -> data/s/<SYM>.json 'ca', ~2 years back).
// 2. A share issue (QIP, merger, IPO, warrants) is a lasting step up in profit / EPS: earlier EPS stays as filed.
// 3. A misread figure shows as 1-2 periods whose share count (profit / EPS) is out of line with the periods on both sides.
//    Which of the two figures is wrong: first the filing's own year-to-date figures (pr.alt: this quarter's year-to-date
//    minus the previous quarter's) - the figure that agrees with them is right; when both or neither agree, the profit
//    margin: whichever is out of line with the company's other periods. Bad EPS -> profit / that period's share count; bad profit -> EPS x share count (the EPS stays as filed).
// Before this (until 10 Nov 2026) any > 25% change counted as a split: 231 of 306 restated stocks had no bonus or split,
// and a misread profit pulled the right EPS down (Groww + Screener check: COFORGE TTM EPS 44.2 vs Screener 50.7, GODREJCP
// 20.7 vs 19.3, TECHM Dec-25 profit read as Rs 199 Cr). Periods older than the action list covers keep the old test.
function caFactor(subj) {
  let m = /bonus\D*(\d+)\s*:\s*(\d+)/i.exec(subj); if (m && +m[2] > 0) return (+m[1] + +m[2]) / +m[2];
  m = /(split|sub-?division|consolidat)/i.test(subj) && /from\s*r[se]\.?\s*([\d.]+).*?to\s*r[se]\.?\s*([\d.]+)/i.exec(subj);
  return m && +m[1] > 0 && +m[2] > 0 ? +m[1] / +m[2] : null;
}
function caOf(sym) {
  try { const d = JSON.parse(fs.readFileSync(path.join(OUT, 's', sym + '.NS.json'), 'utf8')); return Array.isArray(d.ca) ? d.ca : null; } catch { return null; }
}
const shOf = r => r[1] > 0 && r[3] >= 0.05 ? r[1] / r[3] : null;                 // implied share count = profit / EPS
function restate(qs, fys, ca, alt) {
  const rows = [...qs, ...fys];
  // undo an earlier pass: r[4] = EPS as filed, r[5] = profit as filed (null when that figure was kept)
  for (const r of rows) { if (r.length > 5 && r[5] != null) r[1] = r[5]; if (r.length > 4 && r[4] != null) r[3] = r[4]; r.length = 4; }
  const ev = (ca || []).map(c => [c[0], caFactor(c[1] || '')]).filter(e => e[1] && Math.abs(e[1] - 1) > 0.01);
  // the action list covers ~730 days back (an empty list = no actions); a split before that leaves F = 1 anyway
  const covered = d => ca && (ev.length || Date.parse(d) > Date.now() - 720 * 864e5);
  let adj = 0; const set = (r, e) => { if (r.length === 4) r.push(r[3]); r[3] = Math.round(e * 100) / 100; adj++; };
  const setNp = (r, v) => { while (r.length < 5) r.push(null); r[5] = r[1]; r[1] = Math.round(v); adj++; };
  for (const list of [qs, fys]) {
    const ref = [...list].reverse().map(shOf).find(v => v > 0);
    // 1. bonus / split (skipped when the filing already counts today's shares: filed after the ex-date and restated)
    for (const r of list) {
      if (r[3] == null || !covered(r[0])) continue;
      const F = ev.filter(e => e[0] > r[0]).reduce((p, e) => p * e[1], 1); if (F === 1) continue;
      const s = shOf(r); if (s > 0 && ref && Math.abs(Math.log(s * F / ref)) >= Math.abs(Math.log(s / ref))) continue;
      set(r, r[3] / F);
    }
    // 3. misread profit or EPS: a run of 1-2 periods whose share count is > 25% off the periods on both sides, which
    //    agree (the first period: off the next two, which agree). The latest period is left to build_data.py's check against today's shares.
    const S = list.map(shOf), off = (x, y) => x > 0 && y > 0 && (x > 1.25 * y || x < 0.8 * y);
    const nb = (i, d) => { for (let j = i + d; j >= 0 && j < S.length; j += d) if (S[j] > 0) return j; return -1; };
    const bad = [];   // in order: each period is compared with the nearest earlier period that is not itself misread
    S.forEach((v, i) => { bad[i] = (() => {
      if (!(v > 0) || !covered(list[i][0]) || i === S.length - 1) return false;
      let p = nb(i, -1); while (p >= 0 && bad[p]) p = nb(p, -1);
      if (p < 0) { const n = nb(i, 1), n2 = n >= 0 ? nb(n, 1) : -1; return n2 >= 0 && off(v, S[n]) && !off(S[n], S[n2]); }
      if (!off(v, S[p])) return false;
      // a run of 1-2 periods off the period before it, followed by one back in line with that period
      for (let j = nb(i, 1), k = 0; j >= 0 && k < 2; j = nb(j, 1), k++) { if (!off(S[j], S[p])) return true; if (off(S[j], v)) return false; }
      return false;
    })(); });
    list.flagged = list.filter((r, i) => bad[i]).map(r => r[0]);   // read by one() to fetch the year-to-date check
    const margins = list.filter((r, i) => !bad[i] && S[i] > 0 && r[2] > 0).map(r => r[1] / r[2]).sort((x, y) => x - y);
    const med = margins.length ? margins[margins.length >> 1] : null;
    list.forEach((r, i) => {
      if (!bad[i]) return;
      const near = S.slice(i + 1).find((v, j) => v > 0 && !bad[i + 1 + j]) || null;
      if (!near) return;
      const lg = x => x > 0 && med > 0 ? Math.abs(Math.log(x / med)) : Infinity;
      // year-to-date check (10 Nov 2026, Groww-verified: ASALCBR Sep-25 EPS wrong; GODREJCP / TECHM / CARRARO / GARFIBRES /
      // ATUL / KANPRPLA profit wrong - in each the right figure agreed with its year-to-date difference, the wrong one not)
      const a = list === qs && alt && alt[r[0]], agree = (x, y) => typeof x === 'number' && typeof y === 'number' && Math.abs(x - y) <= 0.03 * Math.max(Math.abs(x), Math.abs(y)) + 0.011;
      const npOk = a && agree(r[1], a[0]), epsOk = a && agree(r[3], a[1]);
      if (npOk && !epsOk) { set(r, r[1] / near); return; }
      if (epsOk && !npOk) { setNp(r, r[3] * near); return; }
      // profit out of line and EPS x shares in line -> the profit is the misread figure: keep the filed EPS and put
      // the profit back as EPS x shares (TECHM Dec-25 read as Rs 199 Cr -> ~Rs 1,120 Cr; it feeds the quarterly table,
      // growth and the earnings-momentum scan)
      if (r[2] > 0 && lg(r[1] / r[2]) > lg(r[3] * near / r[2])) { setNp(r, r[3] * near); return; }
      set(r, r[1] / near);
    });
    // 4. periods older than the action list: the old test against the latest share count
    if (ref) for (const r of list) { if (covered(r[0]) || r.length > 4) continue; const s = shOf(r); if (s > 0 && (s / ref > 1.25 || s / ref < 0.8)) set(r, r[1] / ref); }
  }
  return adj;
}
async function main() {
  const files = fs.readdirSync(XD).filter(f => f.endsWith('.NS.json'));
  const st = files.map(f => { let d = {}; try { d = JSON.parse(fs.readFileSync(path.join(XD, f), 'utf8')); } catch { } return { f, s: f.slice(0, -8), t: (d.pr && d.pr.v === PRV && d.pr.t) || 0 }; })
    .filter(x => !ONLY.length || ONLY.includes(x.s))
    .filter(x => ONLY.length || Date.now() / 1000 - x.t > RECHECK);
  // order: earnings-momentum candidates first (pass sector/ROCE/52-wk-high/volume), then other ROCE > 15% stocks,
  // then everyone else; never-read before stale within each group
  let cand = { pass: [], roce: [] }; try { cand = require('./momentum').candidates(); } catch (e) { console.log('candidates', e.message); }
  const P = new Set(cand.pass), R = new Set(cand.roce), tier = s => P.has(s) ? 0 : R.has(s) ? 1 : 2;
  st.sort((a, b) => tier(a.s) - tier(b.s) || a.t - b.t);
  D.first = st.filter(x => P.has(x.s)).length;
  console.log('results: due', st.length, 'of', files.length, '— momentum candidates first:', D.first);
  await nseHome();
  let i = 0, done = 0;
  async function worker() {
    while (i < st.length && Date.now() - T0 < MAXSEC * 1000) {
      const x = st[i++], fp = path.join(XD, x.f);
      let d; try { d = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { continue; }
      try { d.pr = await one(x.s, d.pr); D.checked++; fs.writeFileSync(fp, JSON.stringify(d)); done++; }
      catch (e) { if (D.errs.length < 8) D.errs.push(x.s + ' ' + String(e.message).slice(0, 60)); }
      if (ONLY.length) console.log(x.s, JSON.stringify(d.pr));
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  let have = 0, re = 0;
  for (const f of files) {
    const fp = path.join(XD, f); let d; try { d = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { continue; }
    const p = d.pr; if (!p || !p.q || !p.q.length) continue;
    const before = JSON.stringify([p.q, p.fy]); let adj;
    try { adj = restate(p.q, p.fy || [], caOf(f.slice(0, -8)), p.alt); } catch (e) { if (D.errs.length < 8) D.errs.push(f + ' restate ' + String(e.message).slice(0, 60)); continue; }
    if (adj) p.epsAdj = adj; else delete p.epsAdj;
    const nf = [...p.q, ...(p.fy || [])].filter(r => r.length > 5 && r[5] != null).length; if (nf) p.npFix = nf; else delete p.npFix; D.npFix = (D.npFix || 0) + nf;
    if (JSON.stringify([p.q, p.fy]) !== before) { fs.writeFileSync(fp, JSON.stringify(d)); re++; }
  }
  D.restated = re;
  for (const f of files) { try { const p = JSON.parse(fs.readFileSync(path.join(XD, f), 'utf8')).pr; if (p && p.q && p.q.length) have++; } catch { } }
  const cov = { built: Math.floor(Date.now() / 1000), done, due: st.length, have, of: files.length, elapsed: Math.round((Date.now() - T0) / 1000), ...D };
  try { fs.mkdirSync(CD, { recursive: true }); fs.writeFileSync(path.join(CD, 'results.json'), JSON.stringify(cov)); } catch { }
  console.log('results', JSON.stringify(cov));
}
if (require.main === module) main();
module.exports = { profits, restate, caFactor };
