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
      const r = await fetch(url, { headers: { ...UA, Cookie: cookie, Referer: 'https://www.nseindia.com/' }, signal: AbortSignal.timeout(30000) });
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
  const own = val('ProfitOrLossAttributableToOwnersOfParent');
  let tot = val('ProfitLossForPeriod'); if (!Object.keys(tot).length) tot = val('NetProfitLossForThePeriod');
  const rev = val('RevenueFromOperations');
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
  let eps = val('BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations'); if (!Object.keys(eps).length) eps = val('BasicEarningsLossPerShareFromContinuingOperations');
  // { 'start..end': { np, rev, eps } }  np = profit attributable to shareholders (else profit for the period), rupees; eps in â‚¹
  const out = {};
  for (const k of new Set([...Object.keys(tot), ...Object.keys(own)])) (out[k] = out[k] || {}).np = own[k] ? own[k] : tot[k] ?? own[k];
  for (const k in rev) (out[k] = out[k] || {}).rev = rev[k];
  for (const k in eps) (out[k] = out[k] || {}).eps = eps[k];
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
  const qs = [...Q.values()].sort((x, y) => x[0] < y[0] ? -1 : 1).slice(-8), fys = [...FY.values()].sort((x, y) => x[0] < y[0] ? -1 : 1).slice(-6);
  // EPS as filed jumps at a bonus issue or split; restate earlier EPS to today's share count (as Yahoo / Screener do):
  // shares = profit Ã· EPS; when a period's share count differs from the latest by more than 25%, EPS = profit Ã· latest shares
  const sh = r => r[1] && r[3] && Math.abs(r[3]) >= 0.05 ? r[1] / r[3] : null;
  const ref = [...qs].reverse().map(sh).find(v => v > 0) || [...fys].reverse().map(sh).find(v => v > 0);
  let adj = 0;
  if (ref) for (const r of [...qs, ...fys]) { const s = sh(r); if (s > 0 && (s / ref > 1.25 || s / ref < 0.8)) { r.push(r[3]); r[3] = Math.round(r[1] / ref * 100) / 100; adj++; } }
  return { b, q: qs, fy: fys, g5, qe: latest, t: Math.floor(Date.now() / 1000), v: PRV, ...(adj ? { epsAdj: adj } : {}) };
}
async function main() {
  const files = fs.readdirSync(XD).filter(f => f.endsWith('.NS.json'));
  const st = files.map(f => { let d = {}; try { d = JSON.parse(fs.readFileSync(path.join(XD, f), 'utf8')); } catch { } return { f, s: f.slice(0, -8), t: (d.pr && d.pr.v === PRV && d.pr.t) || 0 }; })
    .filter(x => !ONLY.length || ONLY.includes(x.s))
    .filter(x => ONLY.length || Date.now() / 1000 - x.t > RECHECK).sort((a, b) => a.t - b.t);
  console.log('results: due', st.length, 'of', files.length);
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
  await Promise.all([worker(), worker(), worker()]);
  let have = 0;
  for (const f of files) { try { const p = JSON.parse(fs.readFileSync(path.join(XD, f), 'utf8')).pr; if (p && p.q && p.q.length) have++; } catch { } }
  const cov = { built: Math.floor(Date.now() / 1000), done, due: st.length, have, of: files.length, elapsed: Math.round((Date.now() - T0) / 1000), ...D };
  try { fs.mkdirSync(CD, { recursive: true }); fs.writeFileSync(path.join(CD, 'results.json'), JSON.stringify(cov)); } catch { }
  console.log('results', JSON.stringify(cov));
}
if (require.main === module) main();
module.exports = { profits };
