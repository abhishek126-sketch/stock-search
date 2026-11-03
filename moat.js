'use strict';
// ===== Moat estimate: transparent rule-based score from the snapshot data (not an expert rating) =====
Object.assign(GL, {
  gm: ['Gross margin', '(Revenue − direct cost of goods) ÷ revenue. A high, steady gross margin often means customers pay for the brand or product, not just its cost.', 'Revenue ₹100, cost of goods ₹40 → gross margin 60%.'],
  roa: ['ROA (return on assets)', 'Net profit ÷ total assets. Used for banks/insurers, where ROCE does not apply; above ~1% is good for a bank.', 'Profit ₹2,000 Cr on assets ₹1,50,000 Cr → ROA 1.3%.'],
  mstab: ['Margin stability', 'How much the yearly operating margin moves around (standard deviation, in percentage points). Small swings suggest pricing power and a durable business.', 'Margins 20%, 21%, 19%, 20% → swing ≈ 0.8 pp (stable).'],
  srank: ['Size rank in sector', "The company's market-cap rank among the stocks of the same sector in this app's list. Leaders often enjoy scale advantages.", 'Rank 2 of 45 banks = second-largest.'],
  rdur: ['Revenue growth durability', 'Whether sales grew in (almost) every year, not just on average. Steady growth suggests lasting demand.', 'Revenue up in 4 of 4 years with 9% CAGR → durable.'],
  ppow: ['Pricing power', 'The ability to raise prices without losing customers. A hint: gross margin is high and has held up or risen over the years despite cost inflation.', 'Gross margin 55% now vs 53% three-year average → holding up.'],
  msrc: ['Moat source', 'Where a durable advantage usually comes from: brand, network effects, switching costs, cost advantage, intangibles/licences (patents, approvals, regulation), or efficient scale (a market that only supports a few players).', 'A payments network gains value as more users join → network effects.'],
});
function mSeries(f, a, b, fn) { const A = f[a] || [], B = Object.fromEntries((f[b] || []).map(x => [x[0], x[1]])); return A.filter(x => B[x[0]] != null).map(x => [x[0], fn(x[1], B[x[0]])]).filter(x => isNum(x[1])); }
const mMed = a => { a = a.filter(isNum).slice().sort((x, y) => x - y); if (!a.length) return; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const mSd = a => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
function moatSourceHint(d) {
  const s = (d.sector || '') + ' | ' + (d.industry || '');
  const R = [[/Banks|Insurance|Asset Management|Capital Markets|Credit Services|Financial/i, ['Switching costs', 'Cost advantage (cheap deposits / scale)', 'Licences']],
    [/Financial Data|Exchange/i, ['Network effects', 'Licences']], [/Software|Information Technology Services|IT Services/i, ['Switching costs', 'Intangibles (know-how, client relationships)']],
    [/Internet|Interactive Media|Communication Services|Telecom/i, ['Network effects', 'Efficient scale']], [/Semiconductor/i, ['Intangibles (IP)', 'Cost advantage (scale)']],
    [/Drug|Pharma|Biotech|Medical|Health/i, ['Intangibles (patents, approvals)', 'Brand']], [/Utilities|Utility|Oil & Gas Midstream|Airports|Railroad|Infrastructure/i, ['Efficient scale', 'Licences / regulation']],
    [/Household|Personal|Beverage|Tobacco|Packaged|Confection|Apparel|Luxury|Specialty Chemicals|Paint|Restaurants|Consumer Defensive|Consumer Cyclical/i, ['Brand (intangibles)', 'Distribution reach']],
    [/Steel|Cement|Building Materials|Aluminum|Mining|Metals|Oil & Gas|Chemicals|Basic Materials|Energy/i, ['Cost advantage', 'Efficient scale']],
    [/Auto|Industrial|Machinery|Aerospace|Electrical/i, ['Brand', 'Switching costs', 'Cost advantage']]];
  for (const [re, v] of R) if (re.test(s)) return v; return ['Depends on the company — no typical source for this sector'];
}
function moatCalc(d, k) {
  const f = d.fund || {}, pr = d.profile || {}, fin = typeof isFinD === 'function' && isFinD(d), F = [];
  const peers = SUMMARY ? SUMMARY.rows.filter(r => r.sec && r.sec === d.sector && mktOf(r.s) === mktOf(d.symbol) && !(r.cap || '').startsWith('ETF')) : [];
  const pc = v => isNum(v) ? (v * 100).toFixed(1) + '%' : 'n/a', add = (n, g, val, pass, rule) => F.push({ n, g, val, pass, rule });
  const roe = mSeries(f, 'annualNetIncome', 'annualStockholdersEquity', (a, b) => b > 0 ? a / b : null).slice(-5).map(x => x[1]);
  add('ROE consistency', 'roe', roe.length >= 3 ? `min ${pc(Math.min(...roe))}, median ${pc(mMed(roe))} (${roe.length} yrs)` : 'n/a', roe.length >= 3 ? Math.min(...roe) >= 0.12 && mMed(roe) >= 0.15 : null, 'every year ≥ 12% and median ≥ 15%');
  if (fin) {
    const roa = mSeries(f, 'annualNetIncome', 'annualTotalAssets', (a, b) => b > 0 ? a / b : null).slice(-5).map(x => x[1]);
    add('Return on assets (financials)', 'roa', roa.length >= 2 ? `median ${(mMed(roa) * 100).toFixed(2)}%` : 'n/a', roa.length >= 2 ? mMed(roa) >= 0.012 : null, 'median ≥ 1.2% (banks / insurers)');
  } else {
    const ta = Object.fromEntries((f.annualTotalAssets || []).map(x => [x[0], x[1]]));
    const roce = mSeries(f, 'annualEBIT', 'annualCurrentLiabilities', (e, cl) => e).map(([dt, e]) => { const cl = (f.annualCurrentLiabilities || []).find(x => x[0] === dt); const ce = ta[dt] != null && cl ? ta[dt] - cl[1] : null; return ce > 0 ? e / ce : null; }).filter(isNum).slice(-5);
    add('ROCE consistency', 'roce', roce.length >= 3 ? `min ${pc(Math.min(...roce))}, median ${pc(mMed(roce))}` : 'n/a', roce.length >= 3 ? Math.min(...roce) >= 0.12 && mMed(roce) >= 0.15 : null, 'every year ≥ 12% and median ≥ 15%');
    const gm = pr.grossMargins, pgm = mMed(peers.filter(r => r.s !== d.symbol && r.gm > 0).map(r => r.gm));
    add('Gross margin vs peers', 'gm', isNum(gm) && gm > 0 ? `${pc(gm)} vs peer median ${pc(pgm)}` : 'n/a', isNum(gm) && gm > 0 ? (gm >= 0.5 || (isNum(pgm) && gm >= pgm + 0.05)) : null, '≥ 50%, or ≥ peer median + 5 pp');
  }
  const om = pr.opMargins, pom = mMed(peers.filter(r => r.s !== d.symbol && isNum(r.om)).map(r => r.om));
  add('Operating margin vs peers', 'opm', isNum(om) ? `${pc(om)} vs peer median ${pc(pom)}` : 'n/a', isNum(om) ? om >= 0.15 && (!isNum(pom) || om >= pom) : null, '≥ 15% and ≥ peer median');
  const oms = mSeries(f, 'annualOperatingIncome', 'annualTotalRevenue', (a, b) => b > 0 ? a / b : null).slice(-5).map(x => x[1]);
  if (!fin) add('Margin stability', 'mstab', oms.length >= 3 ? `operating margin swings ±${(mSd(oms) * 100).toFixed(1)} pp over ${oms.length} yrs` : 'n/a', oms.length >= 3 ? mSd(oms) <= 0.03 && Math.min(...oms) > 0 : null, 'yearly swing ≤ 3 pp and never loss-making');
  const rk = peers.filter(r => isNum(r.mcap)).sort((a, b) => b.mcap - a.mcap), pos = rk.findIndex(r => r.s === d.symbol);
  add('Size rank in sector', 'srank', pos >= 0 ? `#${pos + 1} of ${rk.length} in ${d.sector}` : 'n/a', pos >= 0 && rk.length >= 3 ? pos < 3 || pos < rk.length * 0.1 : null, 'top 3 or top 10% by market cap');
  const rev = (f.annualTotalRevenue || []).slice(-5).map(x => x[1]).filter(isNum);
  if (rev.length >= 3) { const ups = rev.slice(1).filter((v, i) => v > rev[i]).length, n = rev.length - 1, cg = rev[0] > 0 ? (rev[n] / rev[0]) ** (1 / n) - 1 : null;
    add('Revenue growth durability', 'rdur', `grew in ${ups} of ${n} yrs, CAGR ${pc(cg)}`, ups >= n - (n >= 4 ? 1 : 0) && isNum(cg) && cg >= 0.05, `grew in ≥ ${n >= 4 ? n - 1 : n} of ${n} yrs and CAGR ≥ 5%`); }
  else add('Revenue growth durability', 'rdur', 'n/a', null, 'grew almost every year and CAGR ≥ 5%');
  if (!fin) add('Low debt', 'de', k.negEquity ? 'negative equity' : isNum(k.de) ? 'debt/equity ' + k.de.toFixed(2) : 'n/a', k.negEquity ? false : isNum(k.de) ? k.de < 0.5 : null, 'debt/equity < 0.5');
  if (!fin) { const gms = mSeries(f, 'annualGrossProfit', 'annualTotalRevenue', (a, b) => b > 0 ? a / b : null).slice(-4).map(x => x[1]);
    if (gms.length >= 3) { const lastG = gms[gms.length - 1], avg = gms.slice(0, -1).reduce((s, x) => s + x, 0) / (gms.length - 1);
      add('Pricing power hint', 'ppow', `gross margin ${pc(lastG)} vs ${pc(avg)} earlier avg`, lastG >= 0.35 && lastG >= avg - 0.01, 'gross margin ≥ 35% and held up (≥ earlier average − 1 pp)'); }
    else add('Pricing power hint', 'ppow', 'n/a', null, 'gross margin ≥ 35% and held up'); }
  const ev = F.filter(x => x.pass !== null), ps = ev.filter(x => x.pass).length, sh = ev.length ? ps / ev.length : null;
  const rating = ev.length < 4 ? 'Not enough data' : sh >= 0.75 && ev.length >= 5 ? 'Wide' : sh >= 0.5 ? 'Narrow' : 'None';
  return { F, ps, ev: ev.length, sh, rating, src: moatSourceHint(d), fin };
}
function moatSection(d, k) {
  const M = moatCalc(d, k), col = { Wide: '#dcfce7', Narrow: '#fef9c3', None: '#fee2e2' }[M.rating] || '#f1f5f9';
  const ic = p => p === true ? '✅' : p === false ? '❌' : '<span class="mut">–</span>';
  return sec('s-moat', `🏰 Moat${gq('moat')} <span class="mut">(${M.rating}${M.ev ? ` · ${M.ps}/${M.ev}` : ''})</span>`, `
  <div class="verdict" style="background:${col}">Moat estimate: ${M.rating}${M.ev ? ` — ${M.ps} of ${M.ev} checks passed` : ''}</div>
  <div class="tw"><table class="nogq"><tr><th>Factor</th><th>Value</th><th>Pass?</th></tr>${M.F.map(x => `<tr><td style="white-space:normal">${esc(x.n)}${gq(x.g)}<br><small class="mut">${esc(x.rule)}</small></td><td style="white-space:normal">${esc(x.val)}</td><td>${ic(x.pass)}</td></tr>`).join('')}</table></div>
  <p><b>Likely moat source${gq('msrc')} for this sector:</b> ${M.src.map(esc).join(' · ')}</p>
  ${how(`Wide = at least 75% of the evaluable checks pass (with ≥ 5 evaluable); Narrow = at least 50%; None = below 50%; fewer than 4 evaluable checks = not enough data. "–" means the data was not available and the check is skipped. ${M.fin ? 'For banks/insurers, ROCE, gross margin, margin stability, pricing power and debt checks do not apply; return on assets is used instead.' : ''} Peers = stocks of the same sector and market in this app's list.`)}
  <p class="disc" style="margin:8px 0 0">⚠️ This is an automatic estimate from a few public numbers, not an expert moat rating (such as Morningstar's). Real moats depend on things data cannot show — brand strength, regulation, management, competition. Use it as a starting point for your own research.</p>`);
}
