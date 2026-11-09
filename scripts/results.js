#!/usr/bin/env node
'use strict';
// Quarterly and annual net profit for NSE stocks, read from the companies' own results filings on NSE (XBRL).
// Run by corp.yml after build_corp.py. Feeds the earnings-momentum scan (scripts/momentum.js).
//
//   Recent results (from 2025): NSE "integrated filing" feed — one XBRL per quarter, current-period figures only
//   Older results              : NSE "corporates-financial-results" feed (stopped at Dec 2024), Quarterly and Annual
// Basis: consolidated when the company files consolidated results for its latest quarter, else standalone; one basis
// throughout so growth is compared like for like. Net profit = ProfitLossForPeriod (incl. minority interest), the
// figure Screener's "PAT" uses.
//
// Stores in data/x/<SYM>.json:
//   pr = { b: 'C'|'S', q: [[quarterEnd, profit]], fy: [[yearEnd, profit]], qe: latest quarter seen, t: checked (unix) }
// Only filings not read before are fetched, so after the first pass each company costs one list call per run,
// plus 1 XBRL when it has published a new quarter.
const fs = require('fs'), path = require('path');
const OUT = process.env.DATA_DIR || path.join(__dirname, '..', 'data'), XD = path.join(OUT, 'x'), CD = path.join(OUT, 'corp');
const PRV = 1;   // reader version: bump when the parsing changes, so every company is re-read
const MAXSEC = +(process.env.RES_MAXSEC || 900), T0 = Date.now(), RECHECK = 3 * 86400;   // re-check each company's filing list every 3 days
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
  // older filings (to 2024) often leave the period contexts undefined ("OneD", "FourD") and state the dates as facts
  const fact = tag => { const o = {}; for (const m of x.matchAll(new RegExp(`<[\\w-]+:${tag}\\b[^>]*contextRef="([^"]+)"[^>]*>\\s*([\\d-]{10})\\s*<`, 'g'))) o[m[1]] = m[2]; return o; };
  const fs_ = fact('DateOfStartOfReportingPeriod'), fe_ = fact('DateOfEndOfReportingPeriod');
  for (const id in fs_) if (!ctx[id] && fe_[id]) ctx[id] = fs_[id] + '..' + fe_[id];
  // profit attributable to the company's own shareholders when filed (what Screener shows), else profit for the period.
  // Amounts are in rupees in both formats (the "level of rounding" field only describes the PDF).
  const val = tag => { const o = {}; for (const m of x.matchAll(new RegExp(`<[\\w-]+:${tag}\\b[^>]*contextRef="([^"]+)"[^>]*>\\s*([-0-9.Ee]+)\\s*<`, 'g'))) if (ctx[m[1]] && !(ctx[m[1]] in o)) o[ctx[m[1]]] = +m[2]; return o; };
  const own = val('ProfitOrLossAttributableToOwnersOfParent');
  let tot = val('ProfitLossForPeriod'); if (!Object.keys(tot).length) tot = val('NetProfitLossForThePeriod');
  const out = {};
  for (const k of new Set([...Object.keys(tot), ...Object.keys(own)])) out[k] = own[k] ? own[k] : tot[k] ?? own[k];
  return out;
}
async function readXbrl(url) {
  const x = await get(url, false, 2); D.xbrl++;
  const p = profits(x); if (!Object.keys(p).length) D.noProfit++;
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
  const Q = new Map(pr.q || []), FY = new Map(pr.fy || []);
  const cache = new Map();                                  // xbrl url -> parsed profits (each file read at most once)
  const read = async f => {
    if (!cache.has(f.u)) { try { cache.set(f.u, await readXbrl(f.u)); } catch (e) { cache.set(f.u, {}); D.xbrlFail++; if (D.errs.length < 8) D.errs.push(sym + ' ' + String(e.message).slice(0, 60)); } }
    return cache.get(f.u);
  };
  const split = p => { const q = new Map(), y = new Map();
    for (const [k, v] of Object.entries(p)) { const [s, e] = k.split('..'), len = days(s, e);
      if (len > 80 && len < 100) q.set(e, v); else if (len > 350 && len < 380 && e.endsWith('-03-31')) y.set(e, v); }
    return { q, y }; };
  // find a value: try each candidate filing (original first, then revisions; new feed, then old) until one has it
  const find = async (basis, date, kind, srcs) => {
    for (const src of srcs) for (const f of fl.filter(f => f.b === basis && f.qe === date && f.src === src)) {
      const v = split(await read(f))[kind].get(date); if (v !== undefined) return v;
    }
    return undefined;
  };
  // wanted: latest quarter, same quarter a year earlier, latest full year (Mar) and the year 5 years before it
  const lastFY = latest >= latest.slice(0, 4) + '-03-31' ? latest.slice(0, 4) + '-03-31' : (+latest.slice(0, 4) - 1) + '-03-31';
  const fy5 = (+lastFY.slice(0, 4) - 5) + '-03-31', yago = (+latest.slice(0, 4) - 1) + latest.slice(4);
  // some filings carry only the year-to-date figure: then quarter = YTD to this quarter − YTD to the previous quarter
  const prevQ = d => ({ '03-31': [-1, '12-31'], '06-30': null, '09-30': [0, '06-30'], '12-31': [0, '09-30'] })[d.slice(5)];
  const fyStart = d => (d.slice(5) === '03-31' ? +d.slice(0, 4) - 1 : +d.slice(0, 4)) + '-04-01';
  const ytd = async (basis, d) => {
    for (const src of ['int', 'old']) for (const f of fl.filter(f => f.b === basis && f.qe === d && f.src === src)) {
      const v = (await read(f))[fyStart(d) + '..' + d]; if (v !== undefined) return v;
    }
    return undefined;
  };
  const derive = async (basis, d) => {
    const p = prevQ(d); if (!p) return undefined;            // Apr–Jun: the quarter is the YTD, nothing to derive
    const pd = (+d.slice(0, 4) + p[0]) + '-' + p[1], a = await ytd(basis, d), z = await ytd(basis, pd) ?? (p[1] === '06-30' ? await find(basis, pd, 'q', ['int', 'old']) : undefined);
    return a !== undefined && z !== undefined ? a - z : undefined;
  };
  for (const d of [latest, yago]) if (!Q.has(d)) { const v = (await find(b, d, 'q', ['int', 'old'])) ?? (await derive(b, d)); if (v !== undefined) Q.set(d, v); }
  // the March-quarter filing carries the full year too
  for (const d of [lastFY, fy5]) if (!FY.has(d)) { const v = await find(b, d, 'y', ['ann', 'int', 'old']); if (v !== undefined) FY.set(d, v); }
  // 5-year growth needs both ends on one basis: when the old year exists only standalone (common before 2022), use standalone for both
  let g5 = pr.g5 && pr.g5.a && pr.g5.a[0] === lastFY ? pr.g5 : null;
  if (!g5) {
    if (FY.has(lastFY) && FY.has(fy5)) g5 = { b, a: [lastFY, FY.get(lastFY)], z: [fy5, FY.get(fy5)] };
    else if (FY.has(lastFY)) {
      const o = b === 'C' ? 'S' : 'C', z = await find(o, fy5, 'y', ['ann', 'old', 'int']);
      if (z !== undefined) { const a = await find(o, lastFY, 'y', ['int', 'ann', 'old']); if (a !== undefined) g5 = { b: o, a: [lastFY, a], z: [fy5, z] }; }
    }
  }
  const qs = [...Q.entries()].sort().slice(-8), fys = [...FY.entries()].sort().slice(-8);
  return { b, q: qs, fy: fys, g5, qe: latest, t: Math.floor(Date.now() / 1000), v: PRV };
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
