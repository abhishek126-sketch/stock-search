#!/usr/bin/env node
'use strict';
// Official NSE daily extras, run by data.yml right after build_data.py (free NSE files, no keys):
//   1. Delivery %  — from NSE's end-of-day file (sec_bhavdata_full_DDMMYYYY.csv: DELIV_QTY, DELIV_PER). Keeps a rolling
//      store of the last 25 sessions in data/deliv.json, fetching only sessions it doesn't have.
//      Summary row: dp = latest delivery %, dpA = 20-session average, dpD = date. Stock file: deliv = [[date, %, traded qty]].
//   2. Corporate actions — dividends, bonus, splits, rights, buybacks, demergers (NSE corporates-corporateActions, one
//      request for 2 years back to 3 months ahead). Stock file: ca = [[exDate, subject]]; summary row: caN = [next ex-date
//      within 30 days, short label].
const fs = require('fs'), path = require('path');
const OUT = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9' };
const IST = 19800e3, KEEP = 25;
const ymd = d => d.toISOString().slice(0, 10);
const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
const iso = s => { const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(String(s || '').trim()); return m ? `${m[3]}-${MON[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}` : ''; };
const ddmmyyyy = d => d.slice(8, 10) + d.slice(5, 7) + d.slice(0, 4);
async function get(url, hdr = {}, tries = 2) {
  let e; for (let i = 0; i < tries; i++) { try { const r = await fetch(url, { headers: { ...UA, ...hdr }, signal: AbortSignal.timeout(30000) }); if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); } catch (x) { e = x; await new Promise(r => setTimeout(r, 2000)); } }
  throw e;
}
async function delivery() {
  const fp = path.join(OUT, 'deliv.json');
  let st = { days: [], sym: {} }; try { st = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { }
  const have = new Set(st.days), today = new Date(Date.now() + IST); let got = 0;
  // weekdays of the last ~40 calendar days, newest first, stop once KEEP sessions are covered
  for (let i = 0; i < 40 && st.days.filter(d => d > ymd(new Date(today - 40 * 864e5))).length < KEEP + 5; i++) {
    const d = ymd(new Date(today - i * 864e5)); if ([0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay()) || have.has(d)) continue;
    let csv; try { csv = await get(`https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy(d)}.csv`); } catch (e) { console.log('deliv', d, e.message); continue; }
    if (!csv || !/DELIV_PER/.test(csv.slice(0, 300))) continue;                  // holiday or not published yet
    const lines = csv.trim().split(/\r?\n/), h = lines[0].split(',').map(s => s.trim()), ix = k => h.indexOf(k);
    const iS = ix('SYMBOL'), iR = ix('SERIES'), iQ = ix('TTL_TRD_QNTY'), iD = ix('DELIV_PER'), iT = ix('DATE1');
    // the session date inside the file: on a holiday NSE publishes a file named for that day holding the previous
    // session (sec_bhavdata_full_10112026.csv = 09-Nov-2026 on Diwali Balipratipada) — never file it under the holiday
    const td = iT >= 0 && lines[1] ? iso(lines[1].split(',')[iT]) : d;
    if (!td) continue;
    if (td !== d || have.has(td)) { have.add(d); continue; }
    for (const l of lines.slice(1)) {
      const c = l.split(',').map(s => s.trim()); if (!['EQ', 'BE', 'BZ', 'SM', 'ST'].includes(c[iR])) continue;
      const p = parseFloat(c[iD]); if (!isFinite(p)) continue;
      (st.sym[c[iS]] = st.sym[c[iS]] || []).push([d, p, +c[iQ] || 0]);
    }
    st.days.push(d); have.add(d); got++;
  }
  // clean-up for days filed before the date check: a "session" whose traded quantities equal the previous session's
  // for the most-traded stocks is the previous session's file under a holiday's name — drop it
  const sig = d => ['RELIANCE', 'HDFCBANK', 'INFY', 'TCS', 'ITC'].map(s => ((st.sym[s] || []).find(r => r[0] === d) || [])[2]).join('|');
  const ds = [...new Set(st.days)].sort();
  for (let k = 1; k < ds.length; k++) { const a = sig(ds[k]); if (a.replace(/\|/g, '') && a === sig(ds[k - 1])) { console.log('delivery: dropped', ds[k], '(copy of', ds[k - 1] + ')'); st.days = st.days.filter(x => x !== ds[k]); } }
  st.days = [...new Set(st.days)].sort().slice(-KEEP);
  const keep = new Set(st.days);
  for (const s in st.sym) { const a = st.sym[s].filter(r => keep.has(r[0])).sort((x, y) => x[0] < y[0] ? -1 : 1); const u = []; for (const r of a) if (!u.length || u[u.length - 1][0] !== r[0]) u.push(r); if (u.length) st.sym[s] = u; else delete st.sym[s]; }
  fs.writeFileSync(fp, JSON.stringify(st));
  console.log('delivery: sessions', st.days.length, 'new', got, 'latest', st.days[st.days.length - 1], 'symbols', Object.keys(st.sym).length);
  return st;
}
async function actions() {
  const home = await fetch('https://www.nseindia.com/', { headers: { ...UA, Accept: 'text/html' } }).catch(() => null);
  const ck = home && home.headers.getSetCookie ? home.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') : '';
  const f = d => ymd(d).split('-').reverse().join('-'), now = new Date(Date.now() + IST);
  const t = await get(`https://www.nseindia.com/api/corporates-corporateActions?index=equities&from_date=${f(new Date(now - 730 * 864e5))}&to_date=${f(new Date(+now + 92 * 864e5))}`, { Cookie: ck, Referer: 'https://www.nseindia.com/', Accept: 'application/json' }, 3);
  const j = JSON.parse(t || '[]'), by = {};
  for (const x of Array.isArray(j) ? j : []) { const e = iso(x.exDate), s = String(x.subject || '').replace(/\s+/g, ' ').trim(); if (e && s && x.symbol) (by[x.symbol] = by[x.symbol] || []).push([e, s.slice(0, 120)]); }
  for (const s in by) by[s].sort((a, b) => a[0] < b[0] ? 1 : -1);
  console.log('corporate actions:', j.length, 'for', Object.keys(by).length, 'symbols');
  return by;
}
// short label for the list badge
const caShort = s => /bonus/i.test(s) ? 'Bonus ' + ((/\d+\s*:\s*\d+/.exec(s) || [''])[0]) : /split|sub-?division/i.test(s) ? 'Split' : /rights/i.test(s) ? 'Rights' : /buy ?back/i.test(s) ? 'Buyback' : /demerger/i.test(s) ? 'Demerger' : /dividend/i.test(s) ? 'Dividend' + ((/Rs\.?\s*([\d.]+)|Re\.?\s*([\d.]+)/i.exec(s) || []).slice(1).filter(Boolean).map(v => ' ₹' + v)[0] || '') : s.slice(0, 20);
async function main() {
  let dl = null, ca = null;
  try { dl = await delivery(); } catch (e) { console.log('delivery failed:', e.message); }
  try { ca = await actions(); } catch (e) { console.log('corporate actions failed:', e.message); }
  if (!dl && !ca) return;
  const sp = path.join(OUT, 'summary.json'), S = JSON.parse(fs.readFileSync(sp, 'utf8'));
  const today = ymd(new Date(Date.now() + IST)), in30 = ymd(new Date(Date.now() + IST + 30 * 864e5));
  let nd = 0, nc = 0;
  for (const row of S.rows) {
    if (!/\.NS$/.test(row.s)) continue;
    const b = row.s.slice(0, -3), dv = dl && dl.sym[b], ac = ca && ca[b];
    delete row.dp; delete row.dpA; delete row.dpD; delete row.caN;
    if (dv && dv.length) { const l = dv[dv.length - 1], a = dv.slice(-21, -1); row.dp = l[1]; row.dpD = l[0]; if (a.length >= 5) row.dpA = Math.round(a.reduce((s, r) => s + r[1], 0) / a.length * 10) / 10; nd++; }
    const nx = ac && ac.filter(r => r[0] >= today && r[0] <= in30).pop(); if (nx) { row.caN = [nx[0], caShort(nx[1])]; nc++; }
    const fp = path.join(OUT, 's', row.s + '.json'); if (!fs.existsSync(fp) || (!dv && !ac)) continue;
    try { const d = JSON.parse(fs.readFileSync(fp, 'utf8')); if (dv) d.deliv = dv.slice(-20); if (ac) d.ca = ac.slice(0, 40); fs.writeFileSync(fp, JSON.stringify(d)); } catch { }
  }
  fs.writeFileSync(sp, JSON.stringify(S));
  console.log('rows with delivery %', nd, '| with an ex-date in the next 30 days', nc);
}
if (require.main === module) main();
module.exports = { caShort };
