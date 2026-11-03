'use strict';
// ===== Extended sections: peers, sector, news, red flags, intrinsic value, CANSLIM, screener views =====
let SUMMARY = null, MARKET = null;
async function ensureSummary() {
  if (SUMMARY) return;
  try { const [s, m] = await Promise.all([getJSON(DATA + 'summary.json'), getJSON(DATA + 'market.json').catch(() => null)]); SUMMARY = s; MARKET = m; } catch (e) { SUMMARY = { rows: [], built: 0, err: e.message }; }
}
const median = a => { a = a.filter(isNum).sort((x, y) => x - y); if (!a.length) return; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const mktOf = s => s.endsWith('.NS') || s.endsWith('.BSE') ? 'IN' : 'US';
const isFinD = d => /financial/i.test(d.sector || '') && /bank|insur|credit|capital markets|mortgage|financial conglomerates|asset management/i.test(d.industry || d.sector || '') || /bank/i.test(d.industry || '');
const fx = (v, d = 1) => isNum(v) ? v.toFixed(d) : '<span class="mut">n/a</span>';
const pc = v => isNum(v) ? (v * 100).toFixed(0) + '%' : '<span class="mut">n/a</span>';
const sec = (id, title, body, open) => `<details class="card sec" id="${id}" ${open === false ? '' : 'open'}><summary><h2>${title}</h2></summary>${body}</details>`;
const sumAsOf = () => SUMMARY && SUMMARY.built ? new Date(SUMMARY.built * 1000).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) + ' IST' : 'n/a';

// ---- Peers ----
function peerRows(d) {
  if (!SUMMARY || !SUMMARY.rows.length) return { rows: [], basis: '' };
  const mk = mktOf(d.symbol), all = SUMMARY.rows.filter(r => mktOf(r.s) === mk);
  let basis = 'industry', rows = d.industry ? all.filter(r => r.ind === d.industry) : [];
  if (rows.length < 4 && d.sector) { basis = 'sector'; rows = all.filter(r => r.sec === d.sector); }
  return { rows, basis };
}
function peersSection(d) {
  const { rows, basis } = peerRows(d);
  if (rows.length < 2) return sec('s-peers', '👥 Peer comparison', `<p>${NA} — no same-industry peers in the built-in list (${d.symbol.endsWith('.NS') ? 'NIFTY 500' : 'S&P 500'}).</p>`);
  const byM = rows.slice().sort((a, b) => (b.mcap || 0) - (a.mcap || 0)); const rank = byM.findIndex(r => r.s === d.symbol) + 1;
  let show = byM.slice(0, 12); if (rank > 12) show.push(byM[rank - 1]);
  const cols = [['p', 'Price', (v, r) => fmtP(v, r.c)], ['mcap', 'M.cap', (v, r) => fmtBig(v, r.c)], ['pe', 'P/E', v => fx(v)], ['pb', 'P/B', v => fx(v, 2)], ['roe', 'ROE', pc], ['roce', 'ROCE', pc], ['de', 'D/E', v => fx(v, 2)], ['revG', 'Rev CAGR', pc], ['niG', 'Profit CAGR', pc], ['r1y', '1Y ret', v => isNum(v) ? sgnPct(v) : '<span class="mut">n/a</span>']];
  const better = { pe: -1, pb: -1, de: -1 };
  const rk = {}; for (const [k] of cols.slice(2)) { const v = rows.filter(r => isNum(r[k])).sort((a, b) => (better[k] || 1) * (b[k] - a[k])); const i = v.findIndex(r => r.s === d.symbol); rk[k] = i >= 0 ? `${i + 1}/${v.length}` : '–'; }
  return sec('s-peers', `👥 Peer comparison <span class="mut">(${rows.length} ${basis} peers)</span>`, `
  <p class="mut">Same ${basis}: <b>${esc(basis === 'industry' ? d.industry : d.sector)}</b> (Yahoo classification) within the app's ${mktOf(d.symbol) === 'IN' ? 'NIFTY 500' : 'S&P 500'} list. ${esc(d.name)} ranks <b>#${rank || '–'} of ${rows.length}</b> by market cap.</p>
  <div class="tw"><table class="pt"><tr><th>Company</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr>
  ${show.map(r => `<tr class="${r.s === d.symbol ? 'hl' : ''}" data-s="${esc(r.s)}"><td>${esc(r.s.replace(/\.NS$/, ''))}<br><small class="mut">${esc((r.n || '').slice(0, 22))}</small></td>${cols.map(([k, , f]) => `<td>${f(r[k], r)}</td>`).join('')}</tr>`).join('')}
  <tr class="rk"><td><b>${esc(d.symbol.replace(/\.NS$/, ''))} rank</b></td><td></td><td>#${rank}</td>${cols.slice(2).map(([k]) => `<td>${rk[k]}</td>`).join('')}</tr></table></div>
  <p class="src">Ranks: lower P/E, P/B, D/E rank better; higher for the rest. Growth = multi-year CAGR from annual statements. Source: Yahoo Finance snapshot ${sumAsOf()}. Tap a row to open.</p>`);
}

// ---- Sector ----
function sectorStats(mk, sector) {
  const rows = SUMMARY.rows.filter(r => mktOf(r.s) === mk && r.sec === sector);
  const md = k => median(rows.map(r => r[k]));
  return { rows, pe: median(rows.map(r => r.pe).filter(v => v > 0)), pb: md('pb'), roe: md('roe'), roce: md('roce'), de: md('de'), revG: md('revG'), niG: md('niG'), r1y: md('r1y'), r3m: md('r3m') };
}
function sectorSection(d, k) {
  if (!SUMMARY || !d.sector) return sec('s-sector', '🏭 Sector analysis', `<p>${NA}</p>`);
  const S = sectorStats(mktOf(d.symbol), d.sector); if (S.rows.length < 3) return sec('s-sector', '🏭 Sector analysis', `<p>${NA} — too few sector stocks in the list.</p>`);
  const me = SUMMARY.rows.find(r => r.s === d.symbol) || {};
  const line = (lbl, key, f, lowGood) => { const a = me[key], m = S[key]; const cmp = isNum(a) && isNum(m) ? ((lowGood ? a < m : a > m) ? '<span class="up">better</span>' : '<span class="dn">worse</span>') : ''; return `<tr><td>${lbl}</td><td>${f(a)}</td><td>${f(m)}</td><td>${cmp}</td></tr>`; };
  const by = S.rows.filter(r => isNum(r.r1y)).sort((a, b) => b.r1y - a.r1y);
  const li = r => `<li><a href="#${encodeURIComponent(r.s)}" data-s="${esc(r.s)}">${esc(r.s.replace(/\.NS$/, ''))}</a> ${sgnPct(r.r1y)}</li>`;
  return sec('s-sector', `🏭 Sector analysis <span class="mut">(${esc(d.sector)}, ${S.rows.length} stocks)</span>`, `
  <div class="tw"><table><tr><th>Metric</th><th>${esc(d.symbol.replace(/\.NS$/, ''))}</th><th>Sector median</th><th></th></tr>
  ${line('P/E', 'pe', v => fx(v), true)}${line('P/B', 'pb', v => fx(v, 2), true)}${line('ROE', 'roe', pc)}${line('ROCE', 'roce', pc)}${line('Debt/equity', 'de', v => fx(v, 2), true)}${line('Revenue CAGR', 'revG', pc)}${line('Profit CAGR', 'niG', pc)}${line('3M return', 'r3m', pc)}${line('1Y return', 'r1y', pc)}</table></div>
  <div class="grid two"><div><b>Top 1Y performers</b><ul>${by.slice(0, 5).map(li).join('')}</ul></div><div><b>Bottom 1Y performers</b><ul>${by.slice(-5).reverse().map(li).join('')}</ul></div></div>
  <button class="btn sec" data-sector="${esc(mktOf(d.symbol) + '|' + d.sector)}">Browse whole sector →</button>
  <p class="src">Medians over ${S.rows.length} ${mktOf(d.symbol) === 'IN' ? 'NIFTY 500' : 'S&P 500'} stocks in Yahoo sector "${esc(d.sector)}" (P/E median excludes loss-makers). Snapshot ${sumAsOf()}.</p>`);
}

// ---- News ----
function newsSection(d) {
  const n = d.news;
  if (!n || !n.items) return sec('s-news', '📰 Plans, orders & negative news', `<p>${NA} — no headlines fetched for this stock.</p>`);
  const it = n.items, grp = g => it.filter(x => x.g.includes(g));
  const row = x => `<li><a href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.t)}</a><br><small class="mut">${esc(x.s)} · ${dstr(x.d)}</small></li>`;
  const block = (t, a) => `<h3>${t} <span class="mut">(${a.length})</span></h3>${a.length ? `<ul class="news">${a.slice(0, 10).map(row).join('')}</ul>` : `<p class="mut">None found in last 90 days' headlines (not available ≠ none exist).</p>`}`;
  const other = it.filter(x => !x.g.length);
  return sec('s-news', `📰 Plans, orders & negative news <span class="mut">(${it.length} headlines)</span>`, `
  <p class="disc" style="margin-top:0">⚠️ <b>Automated keyword tagging from news headlines — unverified.</b> A headline may be mis-tagged, about a different company with a similar name, or outdated. Always open the article and check exchange filings (NSE/BSE announcements / SEC 8-K).</p>
  ${block('🔴 Negative news', grp('neg'))}${block('📦 Orders & contracts', grp('ord'))}${block('🚀 Expansion, plans & guidance', grp('plan'))}
  ${other.length ? `<details><summary class="mut">Other recent headlines (${other.length})</summary><ul class="news">${other.map(row).join('')}</ul></details>` : ''}
  <p class="src">Source: ${esc(n.source)} search <code>${esc(n.q)}</code>, fetched ${new Date(n.asOf * 1000).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} IST. Headlines belong to their publishers.</p>`);
}

// ---- Red flags ----
function redFlagsSection(d, k) {
  const f = d.fund || {}, pr = d.profile || {}, fin = isFinD(d), out = [];
  const L = key => f[key] || [], lv = key => last(L(key)), pv = key => { const a = L(key); return a.length > 1 ? a[a.length - 2] : null; };
  const add = (st, t, why) => out.push({ st, t, why });
  // leverage
  if (fin) add('na', 'Debt / equity', 'Not meaningful for banks/financials (deposits & borrowings are their raw material).');
  else if (k.negEquity) add('flag', 'Negative shareholders\' equity', 'Book liabilities exceed assets.');
  else if (isNum(k.de)) add(k.de > 1 ? 'flag' : 'ok', 'Debt / equity', `${k.de.toFixed(2)} (flag if > 1.0)`); else add('na', 'Debt / equity', 'not available');
  // cash flow vs profit
  const ocf = L('annualOperatingCashFlow'), ni = L('annualNetIncome');
  if (fin) add('na', 'Operating cash flow vs profit', 'Not meaningful for banks/financials.');
  else if (ocf.length && ni.length) { const n = Math.min(3, ocf.length, ni.length), so = ocf.slice(-n).reduce((s, x) => s + x[1], 0), sn = ni.slice(-n).reduce((s, x) => s + x[1], 0);
    add(so < 0 ? 'flag' : so < 0.8 * sn ? 'flag' : 'ok', 'Operating cash flow vs net profit', `${n}-yr cumulative OCF ${fmtBig(so, d.currency)} vs profit ${fmtBig(sn, d.currency)} (flag if OCF < 80% of profit or negative)`); }
  else add('na', 'Operating cash flow vs profit', 'not available');
  // FCF
  if (!fin) { const fcf = lv('annualFreeCashFlow'); if (fcf) add(fcf[1] < 0 ? 'flag' : 'ok', 'Free cash flow (latest FY)', fmtBig(fcf[1], d.currency)); else add('na', 'Free cash flow', 'not available'); }
  // revenue decline
  const rv = lv('annualTotalRevenue'), rp = pv('annualTotalRevenue');
  if (rv && rp) add(rv[1] < rp[1] ? 'flag' : 'ok', 'Revenue trend (latest FY)', `${sgnPct(rv[1] / rp[1] - 1)} vs previous year`); else add('na', 'Revenue trend', 'not available');
  // margins
  const nv = lv('annualNetIncome'), np = pv('annualNetIncome');
  if (rv && rp && nv && np && rv[1] > 0 && rp[1] > 0) { const m1 = nv[1] / rv[1], m0 = np[1] / rp[1]; add(m1 < m0 - 0.02 ? 'flag' : 'ok', 'Net margin trend', `${(m0 * 100).toFixed(1)}% → ${(m1 * 100).toFixed(1)}% (flag if down > 2 pts)`); } else add('na', 'Net margin trend', 'not available');
  const qo = L('quarterlyOperatingIncome'), qr = L('quarterlyTotalRevenue');
  if (qo.length >= 2 && qr.length >= 2) { const mm = qo.slice(-2).map(o => { const r = qr.find(x => x[0] === o[0]); return r && r[1] ? o[1] / r[1] : undefined; }); if (mm.every(isNum)) add(mm[1] < mm[0] - 0.03 ? 'flag' : 'ok', 'Operating margin (last 2 quarters)', `${(mm[0] * 100).toFixed(1)}% → ${(mm[1] * 100).toFixed(1)}% (flag if down > 3 pts)`); }
  // interest coverage
  const eb = lv('annualEBIT'), ie = lv('annualInterestExpense');
  if (fin) add('na', 'Interest coverage', 'Not meaningful for banks/financials.');
  else if (eb && ie && ie[1] > 0) { const c = eb[1] / ie[1]; add(c < 3 ? 'flag' : 'ok', 'Interest coverage (EBIT / interest)', `${c.toFixed(1)}× (flag if < 3×)`); } else add('na', 'Interest coverage', ie ? 'negligible interest expense' : 'not available');
  // receivables / inventory vs sales
  const gr = key => { const a = lv(key), b = pv(key); return a && b && b[1] > 0 ? a[1] / b[1] - 1 : undefined; }, sg = gr('annualTotalRevenue');
  for (const [key, lbl] of [['annualAccountsReceivable', 'Receivables'], ['annualInventory', 'Inventory']]) { const g = gr(key); if (isNum(g) && isNum(sg)) add(g > sg + 0.1 ? 'flag' : 'ok', `${lbl} growth vs sales growth`, `${sgnPct(g)} vs ${sgnPct(sg)} (flag if > sales + 10 pts)`); else if (!fin) add('na', `${lbl} vs sales`, 'not available'); }
  // dilution
  const sh = gr('annualDilutedAverageShares'); if (isNum(sh)) add(sh > 0.03 ? 'flag' : 'ok', 'Share dilution (latest FY)', `${sgnPct(sh)} change in diluted shares (flag if > +3%)`); else add('na', 'Share dilution', 'not available');
  // negative news count
  const nn = d.news && d.news.items ? d.news.items.filter(x => x.g.includes('neg')).length : undefined; if (isNum(nn)) add(nn >= 3 ? 'flag' : 'ok', 'Negative-keyword headlines (90 days)', `${nn} (flag if ≥ 3; unverified keyword tagging)`);
  const india = mktOf(d.symbol) === 'IN';
  add('na', india ? 'Promoter pledge' : 'Insider pledging', india ? `not available from the free data source — check <a href="https://www.screener.in/company/${encodeURIComponent(d.symbol.replace(/\.NS$/, ''))}/consolidated/#shareholding" target="_blank" rel="noopener">Screener shareholding</a> or NSE shareholding filings.` : 'not available');
  if (isNum(pr.insiders)) add('info', india ? 'Insider / promoter holding (Yahoo)' : 'Insider holding', `${(pr.insiders * 100).toFixed(1)}%`);
  add('na', 'Auditor changes / qualifications', 'not available from the free data source — check the annual report.');
  const flags = out.filter(x => x.st === 'flag').length, ic = { flag: '🚩', ok: '✅', na: '▫️', info: 'ℹ️' };
  return sec('s-flags', `🚩 Red flags <span class="mut">(${flags} flagged)</span>`, `<ul class="flags">${out.map(x => `<li class="${x.st}">${ic[x.st]} <b>${x.t}</b> — ${x.why}</li>`).join('')}</ul>
  <p class="src">Computed only from reported data (Yahoo Finance annual/quarterly statements${d.news ? ', Google News headlines' : ''}); "not available" items were not checked. A flag is a prompt to investigate, not a conclusion.</p>`);
}

// ---- Intrinsic value ----
let IVA = {};
function ivInputs(d, k) {
  const f = d.fund || {}, pr = d.profile || {}, india = mktOf(d.symbol) === 'IN', key = d.symbol;
  const sh = pr.shares || (last(f.annualDilutedAverageShares) || [])[1];
  const eqv = (last(f.annualStockholdersEquity) || [])[1];
  const def = { r: india ? 12 : 9, tg: india ? 5 : 2.5, g: isNum(k.revCAGR) ? Math.max(0, Math.min(18, +(k.revCAGR * 100).toFixed(1))) : 8, aaa: india ? 7.5 : 5.0, tax: 25, dg: india ? 6 : 4, pg: india ? 5 : 3 };
  const a = IVA[key] = Object.assign({}, def, IVA[key] || {});
  return { a, def, sh, bvps: pr.bookValue || (eqv && sh ? eqv / sh : undefined), eqv };
}
function ivCompute(d, k) {
  const { a, sh, bvps } = ivInputs(d, k), f = d.fund || {}, fin = isFinD(d), price = d.price, pr = d.profile || {}, M = [];
  const r = a.r / 100, tg = a.tg / 100, g = a.g / 100;
  const netCash = isNum(pr.cash) && isNum(pr.debt) ? pr.cash - pr.debt : undefined;
  // DCF
  const fcfA = f.annualFreeCashFlow || [], fcf = fcfA.length ? fcfA.slice(-3).reduce((s, x) => s + x[1], 0) / Math.min(3, fcfA.length) : undefined;
  if (fin) M.push({ m: 'DCF (free cash flow)', na: 'Not applicable to banks/financials — their cash flows are dominated by deposits/loans.' });
  else if (!isNum(fcf) || !sh) M.push({ m: 'DCF (free cash flow)', na: 'FCF or share count not available' });
  else if (fcf <= 0) M.push({ m: 'DCF (free cash flow)', na: `Average FCF is negative (${fmtBig(fcf, d.currency)}) — DCF not meaningful` });
  else if (r <= tg) M.push({ m: 'DCF (free cash flow)', na: 'Discount rate must exceed terminal growth' });
  else { let pv = 0, c = fcf; for (let y = 1; y <= 10; y++) { const gy = y <= 5 ? g : g + (tg - g) * (y - 5) / 5; c *= 1 + gy; pv += c / Math.pow(1 + r, y); } const tv = c * (1 + tg) / (r - tg) / Math.pow(1 + r, 10);
    M.push({ m: 'DCF (free cash flow)', v: (pv + tv + (netCash || 0)) / sh, how: `Base FCF ${fmtBig(fcf, d.currency)} (avg of last ${Math.min(3, fcfA.length)} FY), ${a.g}% growth yrs 1–5 fading to ${a.tg}% by yr 10, discount ${a.r}%, terminal ${a.tg}%${isNum(netCash) ? ', plus net cash ' + fmtBig(netCash, d.currency) : ''}; ÷ ${(sh / 1e6).toFixed(0)}M shares. Terminal value = ${((tv / (pv + tv)) * 100).toFixed(0)}% of total.` }); }
  // Graham number
  if (isNum(k.eps) && k.eps > 0 && isNum(bvps) && bvps > 0) M.push({ m: 'Graham number', v: Math.sqrt(22.5 * k.eps * bvps), how: `√(22.5 × EPS ${k.eps.toFixed(2)} × book value/share ${bvps.toFixed(2)}) — conservative, suits stable asset-heavy firms` });
  else M.push({ m: 'Graham number', na: 'Needs positive EPS and book value' });
  // Graham revised formula
  if (isNum(k.eps) && k.eps > 0) M.push({ m: 'Graham formula (revised)', v: k.eps * (8.5 + 2 * a.g) * 4.4 / a.aaa, how: `EPS ${k.eps.toFixed(2)} × (8.5 + 2 × ${a.g}) × 4.4 ÷ ${a.aaa} (AAA/high-grade bond yield %)` });
  else M.push({ m: 'Graham formula (revised)', na: 'Needs positive EPS' });
  // P/E multiple
  const S = SUMMARY && d.sector ? sectorStats(mktOf(d.symbol), d.sector) : null;
  if (isNum(k.eps) && k.eps > 0 && S && isNum(S.pe)) M.push({ m: 'P/E multiple (sector median)', v: k.eps * S.pe, how: `EPS ${k.eps.toFixed(2)} × sector median P/E ${S.pe.toFixed(1)} (${S.rows.length} stocks)` });
  else M.push({ m: 'P/E multiple (sector median)', na: 'Needs positive EPS and sector median P/E' });
  // EPV
  const eb = (f.annualEBIT || []).slice(-3);
  if (fin) M.push({ m: 'Earnings power value (EPV)', na: 'Not applicable to banks/financials' });
  else if (eb.length && sh) { const ae = eb.reduce((s, x) => s + x[1], 0) / eb.length; if (ae > 0) M.push({ m: 'Earnings power value (EPV)', v: (ae * (1 - a.tax / 100) / r + (netCash || 0)) / sh, how: `Avg EBIT ${fmtBig(ae, d.currency)} (last ${eb.length} FY) × (1 − ${a.tax}% tax) ÷ ${a.r}% + net cash — value with zero growth` }); else M.push({ m: 'Earnings power value (EPV)', na: 'Average EBIT not positive' }); }
  else M.push({ m: 'Earnings power value (EPV)', na: 'EBIT or share count not available' });
  // DDM
  const now = Date.now() / 1000, dps = (d.divs || []).filter(x => x[0] >= now - 365 * 86400).reduce((s, x) => s + x[1], 0), dg = a.dg / 100;
  if (dps > 0 && r > dg) M.push({ m: 'Dividend discount (Gordon)', v: dps * (1 + dg) / (r - dg), how: `Last-12-month dividends ${dps.toFixed(2)} × (1 + ${a.dg}%) ÷ (${a.r}% − ${a.dg}%) — only meaningful for steady dividend payers` });
  else M.push({ m: 'Dividend discount (Gordon)', na: dps > 0 ? 'Discount rate must exceed dividend growth' : 'No dividends in the last 12 months' });
  // Justified P/B (banks especially)
  if (isNum(k.roe) && isNum(bvps) && bvps > 0 && r > a.pg / 100) { const pb = (k.roe - a.pg / 100) / (r - a.pg / 100); if (pb > 0) M.push({ m: 'Justified P/B (ROE-based)' + (fin ? ' ★ preferred for banks' : ''), v: pb * bvps, how: `(ROE ${(k.roe * 100).toFixed(1)}% − g ${a.pg}%) ÷ (r ${a.r}% − g ${a.pg}%) = ${pb.toFixed(2)}× book value/share ${bvps.toFixed(2)}` }); else M.push({ m: 'Justified P/B (ROE-based)', na: 'ROE below assumed growth' }); }
  else M.push({ m: 'Justified P/B (ROE-based)', na: 'Needs ROE and book value' });
  const vals = M.filter(x => isNum(x.v) && x.v > 0).map(x => x.v);
  return { M, a, vals, lo: vals.length ? Math.min(...vals) : undefined, hi: vals.length ? Math.max(...vals) : undefined, med: median(vals), price };
}
function ivBody(d, k) {
  const R = ivCompute(d, k), c = d.currency, P = d.price, a = R.a;
  const mos = v => isNum(v) ? `<span class="${v > P ? 'up' : 'dn'}">${((v - P) / v * 100).toFixed(0)}%</span>` : '';
  const inp = (key, lbl) => `<label>${lbl}<input type="number" step="0.5" data-iv="${key}" value="${a[key]}"></label>`;
  return `<div class="ivin">${inp('g', 'Growth yrs 1–5 %')}${inp('r', 'Discount rate %')}${inp('tg', 'Terminal growth %')}${inp('aaa', 'AAA bond yield %')}${inp('dg', 'Dividend growth %')}${inp('pg', 'Long-run growth (P/B) %')}${inp('tax', 'Tax rate %')}<button class="btn sec" id="ivReset">Reset</button></div>
  <div class="tw"><table><tr><th>Method</th><th>Value / share</th><th>Margin of safety</th></tr>${R.M.map(x => `<tr><td style="white-space:normal">${x.m}<br><small class="mut" style="white-space:normal">${x.na ? esc(x.na) : x.how}</small></td><td>${isNum(x.v) ? fmtP(x.v, c) : '<span class="mut">n/a</span>'}</td><td>${mos(x.v)}</td></tr>`).join('')}</table></div>
  ${R.vals.length ? `<p><b>Range:</b> ${fmtP(R.lo, c)} – ${fmtP(R.hi, c)} · <b>Median:</b> ${fmtP(R.med, c)} vs price ${fmtP(P, c)} → margin of safety ${mos(R.med)} <span class="mut">(${R.vals.length} methods)</span></p>` : `<p>${NA}</p>`}
  <p class="disc">Intrinsic-value models are <b>highly sensitive to assumptions</b> (try changing growth or discount rate by 2 points). Inputs come from reported statements; defaults are generic (${mktOf(d.symbol) === 'IN' ? 'India: 12% discount, 5% terminal' : 'US: 9% discount, 2.5% terminal'}), not forecasts. Margin of safety = (value − price) ÷ value. Educational only.</p>`;
}
function ivSection(d, k) { return sec('s-iv', '💰 Intrinsic value (multiple methods)', `<div id="ivBody">${ivBody(d, k)}</div>`); }
function bindIV(d, k) {
  const box = $('#ivBody'); if (!box) return;
  box.oninput = e => { const t = e.target; if (!t.dataset.iv) return; const v = parseFloat(t.value); if (!isFinite(v)) return; IVA[d.symbol][t.dataset.iv] = v; const pos = t.dataset.iv; box.innerHTML = ivBody(d, k); const n = box.querySelector(`[data-iv="${pos}"]`); n.focus(); };
  box.onclick = e => { if (e.target.id === 'ivReset') { delete IVA[d.symbol]; box.innerHTML = ivBody(d, k); } };
}

// ---- CANSLIM ----
const CSN = { C: 'Current quarterly EPS growth', A: 'Annual EPS growth', N: 'New highs / new catalyst', S: 'Supply & demand (volume)', L: 'Leader (relative strength)', I: 'Institutional sponsorship', M: 'Market direction' };
function canslimSection(d) {
  const c = d.canslim;
  if (!c) return sec('s-cs', '📊 CANSLIM check', `<p>${NA} — CANSLIM is computed only for stocks in the built-in list.</p>`);
  const ic = { pass: '<span class="up">✔ PASS</span>', fail: '<span class="dn">✘ FAIL</span>', na: '<span class="mut">– N/A</span>' };
  return sec('s-cs', `📊 CANSLIM check <span class="mut">(${c.score}/${c.of} pass)</span>`, `
  <div class="csl">${'CANSLIM'.split('').map(L => { const x = c.L[L]; return `<div class="csr ${x.s}"><div><b class="csL">${L}</b> ${CSN[L]} <span style="float:right">${ic[x.s]}</span></div><small>${esc(x.why)}</small></div>`; }).join('')}</div>
  <p class="src">William O'Neil's CANSLIM, mechanised with free data: C/A use Yahoo diluted EPS; N = within 15% of 52-week high; S = 50-day up/down volume ratio & share-count change; L = relative-strength percentile among this app's ${mktOf(d.symbol) === 'IN' ? 'NIFTY 500' : 'S&P 500'} stocks; I = Yahoo institutional holding %; M = ${mktOf(d.symbol) === 'IN' ? 'NIFTY 50' : 'S&P 500'} vs 50/200-DMA${MARKET && MARKET[mktOf(d.symbol)] ? ' (index as of ' + dstr(MARKET[mktOf(d.symbol)].asOf) + ')' : ''}. Educational screen, not a buy signal.</p>`);
}

// ---- Home screener views ----
let HOMEMK = 'IN';
async function renderLists(tab) {
  await ensureSummary(); const box = $('#lists'); if (!box) return;
  if (!SUMMARY.rows.length) { box.innerHTML = `<p>${NA} — summary data could not be loaded.</p>`; return; }
  const rows = SUMMARY.rows.filter(r => mktOf(r.s) === HOMEMK);
  const mkb = `<div class="tabs">${['IN', 'US'].map(m => `<button data-mk="${m}" class="${m === HOMEMK ? 'on' : ''}">${m === 'IN' ? '🇮🇳 NSE (NIFTY 500 + Microcap 250)' : '🇺🇸 US (S&P 500)'}</button>`).join('')}</div>`;
  if (tab === 'cap') return renderCaps(box);
  if (tab === 'cs') {
    const top = rows.filter(r => r.co >= 5).sort((a, b) => (b.cs / b.co) - (a.cs / a.co) || (b.rs || 0) - (a.rs || 0)).slice(0, 40);
    box.innerHTML = mkb + `<div class="tw"><table class="pt"><tr><th>Stock</th><th>CANSLIM</th><th>RS</th><th>1Y</th><th>P/E</th><th>M.cap</th></tr>${top.map(r => `<tr data-s="${esc(r.s)}"><td>${esc(r.s.replace(/\.NS$/, ''))}<br><small class="mut">${esc((r.n || '').slice(0, 24))}</small></td><td><b>${r.cs}/${r.co}</b></td><td>${r.rs ?? '–'}</td><td>${isNum(r.r1y) ? sgnPct(r.r1y) : 'n/a'}</td><td>${fx(r.pe)}</td><td>${fmtBig(r.mcap, r.c)}</td></tr>`).join('')}</table></div><p class="src">Ranked by share of CANSLIM letters passed (stocks with ≥5 letters evaluable), then relative strength. Snapshot ${sumAsOf()}. Educational screen, not recommendations.</p>`;
  } else {
    const secs = {}; rows.forEach(r => { if (r.sec) (secs[r.sec] = secs[r.sec] || []).push(r); });
    const list = Object.entries(secs).map(([s, a]) => ({ s, n: a.length, pe: median(a.map(r => r.pe).filter(v => v > 0)), r1y: median(a.map(r => r.r1y)), r3m: median(a.map(r => r.r3m)), g: median(a.map(r => r.revG)) })).sort((a, b) => (b.r1y ?? -9) - (a.r1y ?? -9));
    box.innerHTML = mkb + `<div class="tw"><table class="pt"><tr><th>Sector</th><th>#</th><th>Med P/E</th><th>Med rev CAGR</th><th>Med 3M</th><th>Med 1Y</th></tr>${list.map(x => `<tr data-sector="${esc(HOMEMK + '|' + x.s)}"><td>${esc(x.s)}</td><td>${x.n}</td><td>${fx(x.pe)}</td><td>${pc(x.g)}</td><td>${isNum(x.r3m) ? sgnPct(x.r3m) : 'n/a'}</td><td>${isNum(x.r1y) ? sgnPct(x.r1y) : 'n/a'}</td></tr>`).join('')}</table></div><p class="src">Yahoo sector classification; medians across stocks in the list. Snapshot ${sumAsOf()}. Tap a sector.</p>`;
  }
  box.querySelectorAll('[data-mk]').forEach(b => b.onclick = () => { HOMEMK = b.dataset.mk; renderLists(tab); });
}
// ---- Browse by market-cap category ----
const CAPS = [['All', 'All'], ['Large', 'Large cap', 'NIFTY 100'], ['Mid', 'Mid cap', 'NIFTY Midcap 150'], ['Small', 'Small cap', 'NIFTY Smallcap 250'], ['Micro', 'Micro cap', 'NIFTY Microcap 250'], ['US', 'US', 'S&P 500'], ['ETF-IN', 'ETF India', 'NSE-listed ETFs (official NSE list)'], ['ETF-US', 'ETF US', 'major US-listed ETFs']];
const CAPCOL = { Large: '#1d4ed8', Mid: '#7c3aed', Small: '#b45309', Micro: '#be123c', US: '#0f766e', 'ETF-IN': '#0369a1', 'ETF-US': '#4d7c0f' };
const capOf = s => { const r = SUMMARY && SUMMARY.rows.find(x => x.s === s); return r && r.cap || null; };
function capBadge(cap) { const c = CAPS.find(x => x[0] === cap); return c ? `<span class="tag capb" style="background:${CAPCOL[cap]};color:#fff" title="${esc(c[2])} constituent">${cap === 'US' ? 'S&amp;P 500' : esc(c[1])}</span>` : ''; }
let CAPF = LS.get('capf', 'All'), CAPSORT = LS.get('capsort', ['mcap', -1]), CAPQ = '', CAPN = 100;
function liveRow(r) { const q = typeof QUOTES !== 'undefined' && QUOTES && QUOTES.q && QUOTES.q[r.s]; const [p, pc, , src, ck] = typeof prefQuote === 'function' ? prefQuote(r.s, q && isNum(q[0]) ? q[0] : r.p, q && isNum(q[1]) ? q[1] : r.pc, q && q[2]) : [q && isNum(q[0]) ? q[0] : r.p, q && isNum(q[1]) ? q[1] : r.pc]; return { ...r, src, ck, lp: p, dc: isNum(p) && isNum(pc) && pc ? p / pc - 1 : null, mc: isNum(r.mcap) && isNum(r.p) && isNum(p) && r.p ? r.mcap * p / r.p : r.mcap }; }
async function renderCaps(box) {
  if (typeof QUOTES !== 'undefined' && !QUOTES && typeof loadQuotes === 'function') await loadQuotes(false);
  const all = SUMMARY.rows.filter(r => r.cap), cnt = c => c === 'All' ? all.length : all.filter(r => r.cap === c).length;
  let rows = all.filter(r => CAPF === 'All' || r.cap === CAPF).map(liveRow);
  const ql = CAPQ.toLowerCase(); if (ql) rows = rows.filter(r => r.s.toLowerCase().includes(ql) || (r.n || '').toLowerCase().includes(ql));
  const [k, dir] = CAPSORT, val = r => k === 'n' ? (r.n || r.s).toLowerCase() : k === 'p' ? r.lp : k === 'dc' ? r.dc : (isNum(r.mc) && r.c === 'INR' ? r.mc / 88 : r.mc);  // rough ₹→$ (≈88) so 'All' ranks Indian and US caps together
  rows.sort((a, b) => { const x = val(a), y = val(b); if (x == null || (typeof x === 'number' && !isFinite(x))) return 1; if (y == null || (typeof y === 'number' && !isFinite(y))) return -1; return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  const th = (key, lbl) => `<th data-sort="${key}" style="cursor:pointer;user-select:none">${lbl}${k === key ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  const shown = rows.slice(0, CAPN), cinfo = CAPS.find(x => x[0] === CAPF);
  box.innerHTML = `<div class="tabs" id="capf">${CAPS.map(([c, l]) => `<button data-cap="${c}" class="${c === CAPF ? 'on' : ''}">${c === 'US' ? '🇺🇸 US' : c === 'ETF-IN' ? '🇮🇳 ETF India' : c === 'ETF-US' ? '🇺🇸 ETF US' : l} <small>${cnt(c)}</small></button>`).join('')}</div>
  <input type="text" id="capq" placeholder="Filter by name or symbol…" value="${esc(CAPQ)}" style="margin-bottom:8px">
  <div class="tw"><table class="pt" id="capt"><tr>${th('n', 'Stock')}${th('p', 'Price')}${th('dc', 'Day %')}${th('mc', CAPF.startsWith('ETF') ? 'AUM' : CAPF === 'All' ? 'M.cap / AUM' : 'M.cap')}</tr>${shown.map(r => `<tr data-s="${esc(r.s)}"><td style="white-space:normal">${esc((r.n || r.s).slice(0, 34))} ${CAPF === 'All' ? capBadge(r.cap) : ''}<br><small class="mut">${esc(r.s.replace(/\.NS$/, ''))}</small></td><td>${fmtP(r.lp, r.c)}${r.ck && r.ck.st ? (r.ck.st === 'ok' ? ' <span class="up" title="matches ' + esc(r.ck.src) + '">✔</span>' : ' <span style="color:var(--warn)" title="Yahoo and ' + esc(r.ck.src) + ' differ by ' + (r.ck.d * 100).toFixed(1) + '%; showing ' + esc(r.src) + '\'s price">⚠</span>') : ''}</td><td>${isNum(r.dc) ? `<span class="${r.dc >= 0 ? 'up' : 'dn'}">${r.dc >= 0 ? '+' : ''}${(r.dc * 100).toFixed(2)}%</span>` : '<span class="mut">–</span>'}</td><td>${fmtBig(r.mc, r.c)}</td></tr>`).join('')}</table></div>
  ${rows.length > shown.length ? `<p style="text-align:center"><button class="btn sec" id="capMore">Show all ${rows.length}</button></p>` : ''}
  <p class="src">${rows.length} stocks${cinfo && cinfo[2] ? ' · ' + cinfo[2] + ' ' + (CAPF.startsWith('ETF') ? '' : 'constituents (official NSE lists)') : ''}. Tap a column to sort, a row to open. Prices from the latest quotes refresh${typeof QUOTES !== 'undefined' && QUOTES && QUOTES.built ? ' (' + tIST(QUOTES.built) + ' IST)' : ''}; market cap scaled to live price from snapshot ${sumAsOf()}.</p>`;
  box.querySelectorAll('[data-cap]').forEach(b => b.onclick = () => { CAPF = b.dataset.cap; LS.set('capf', CAPF); CAPN = 100; renderCaps(box); });
  box.querySelectorAll('[data-sort]').forEach(t => t.onclick = () => { const kk = t.dataset.sort; CAPSORT = [kk, CAPSORT[0] === kk ? -CAPSORT[1] : (kk === 'n' ? 1 : -1)]; LS.set('capsort', CAPSORT); renderCaps(box); });
  const mb = box.querySelector('#capMore'); if (mb) mb.onclick = () => { CAPN = 1e9; renderCaps(box); };
  const qi = box.querySelector('#capq'); qi.oninput = () => { CAPQ = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { const pos = qi.selectionStart; renderCaps(box).then(() => { const n = box.querySelector('#capq'); n.focus(); n.setSelectionRange(pos, pos); }); }, 200); };
}
async function openSector(key) {
  await ensureSummary(); const [mk, s] = key.split('|'); const S = sectorStats(mk, s);
  $('#home').hidden = true; const v = $('#view'); v.hidden = false; CUR = null; updFav(); navTo('#sector:' + encodeURIComponent(key));
  const rows = S.rows.slice().sort((a, b) => (b.mcap || 0) - (a.mcap || 0)), by = rows.filter(r => isNum(r.r1y)).sort((a, b) => b.r1y - a.r1y);
  const li = r => `<li><a href="#" data-s="${esc(r.s)}">${esc(r.s.replace(/\.NS$/, ''))}</a> ${sgnPct(r.r1y)}</li>`;
  v.innerHTML = `<div class="card"><a href="#" id="back" class="mut">← Back</a><h2 style="margin-top:6px">🏭 ${esc(s)} <span class="mut">${mk === 'IN' ? 'NSE' : 'US'} · ${rows.length} stocks</span></h2>
  <div class="kv"><div><span>Median P/E</span><b>${fx(S.pe)}</b></div><div><span>Median P/B</span><b>${fx(S.pb, 2)}</b></div><div><span>Median ROE</span><b>${pc(S.roe)}</b></div><div><span>Median revenue CAGR</span><b>${pc(S.revG)}</b></div><div><span>Median profit CAGR</span><b>${pc(S.niG)}</b></div><div><span>Median 1Y return</span><b>${isNum(S.r1y) ? sgnPct(S.r1y) : NA}</b></div></div>
  <div class="grid two" style="margin-top:8px"><div><b>Top 1Y performers</b><ul>${by.slice(0, 5).map(li).join('')}</ul></div><div><b>Bottom 1Y performers</b><ul>${by.slice(-5).reverse().map(li).join('')}</ul></div></div></div>
  <div class="card"><div class="tw"><table class="pt"><tr><th>Stock</th><th>Industry</th><th>M.cap</th><th>P/E</th><th>ROE</th><th>Rev CAGR</th><th>1Y</th><th>CANSLIM</th></tr>${rows.map(r => `<tr data-s="${esc(r.s)}"><td>${esc(r.s.replace(/\.NS$/, ''))}</td><td style="white-space:normal;text-align:left"><small>${esc(r.ind)}</small></td><td>${fmtBig(r.mcap, r.c)}</td><td>${fx(r.pe)}</td><td>${pc(r.roe)}</td><td>${pc(r.revG)}</td><td>${isNum(r.r1y) ? sgnPct(r.r1y) : 'n/a'}</td><td>${r.cs}/${r.co}</td></tr>`).join('')}</table></div>
  <p class="src">Source: Yahoo Finance snapshot ${sumAsOf()}. Educational, not investment advice.</p></div>`;
  $('#back').onclick = e => { e.preventDefault(); goHome(); };
  window.scrollTo(0, 0);
}
// global delegation for row / sector links
document.addEventListener('click', e => {
  const sct = e.target.closest('[data-sector]'); if (sct) { e.preventDefault(); openSector(sct.dataset.sector); return; }
  const r = e.target.closest('#view [data-s], #lists [data-s]'); if (r && !e.target.closest('#sug')) { e.preventDefault(); openSym(r.dataset.s); }
});
