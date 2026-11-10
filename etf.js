'use strict';
// ===== ETF pages: fund facts, holdings, returns and a short rule-based ETF summary (stock-only sections hidden) =====
Object.assign(GL, {
  etf: ['ETF (exchange-traded fund)', 'A fund that holds a basket of assets (an index, gold, bonds…) and trades on the exchange like a share.', 'Buying 1 unit of NIFTYBEES gives you a slice of all 50 Nifty companies.', 'A cheap, simple way to own a whole index; check expense ratio, volume and tracking.'],
  aum: ['AUM / total assets', 'Total money managed by the fund. Bigger funds are usually more liquid and less likely to close.', 'AUM $500B = very large; under $50M = small.', 'Above ₹1,000 Cr is comfortable; very small funds can trade thinly or close.'],
  er: ['Expense ratio', 'Yearly fee the fund deducts from its assets, as a % of your investment. Lower is better for index funds.', '0.10% on ₹1,00,000 = ₹100 a year.', 'Below 0.2% is excellent for index ETFs; above 0.5% is costly.'],
  nav: ['NAV (net asset value)', 'Value of everything the fund holds, per unit, calculated by the fund house (in India published daily on AMFI).', 'Holdings worth ₹267 per unit → NAV ₹267.', 'The ETF\'s market price should stay very close to its NAV.'],
  prem: ['Premium / discount to NAV', 'How far the market price is above (premium) or below (discount) the NAV. Large gaps mean you may overpay or get less when selling.', 'Price ₹270, NAV ₹267 → 1.1% premium.', 'Within ±0.5% is normal; above 1–2% premium means you are overpaying — wait or use another ETF.'],
  ytd: ['YTD (year to date)', 'Return since 1 January of this year.', 'Up 8% YTD = 8% higher than on 1 Jan.', 'Good for a quick check; judge a fund over 3–5 years, not one year.'],
});
const etfMkt = d => d.symbol.match(/\.(NS|BO)$/) ? 'IN' : 'US';
function etfKeyCard(d, k) {
  const e = d.etf || {}, c = d.currency, r = (v, src) => isNum(v) ? sgnPct(v) + (src ? ' <small class="mut">(price)</small>' : '') : NA;
  return `<div class="card"><h2>ETF facts${gq('etf')}</h2><div class="kv">
    <div><span>AUM / total assets${gq('aum')}</span><b>${fmtBig(e.aum, c)}</b></div>
    <div><span>Expense ratio${gq('er')}</span><b>${isNum(e.er) ? (e.er * 100).toFixed(2) + '%' : NA}</b></div>
    <div><span>Yield</span><b>${isNum(e.yield) ? fmtPct(e.yield, 2) : NA}</b></div>
    <div><span>NAV${gq('nav')}${e.navDate && e.navDate !== 'Yahoo' ? ' (' + esc(e.navDate) + ')' : ''}</span><b>${fmtP(e.nav, c)}</b></div>
    <div><span>Premium / discount${gq('prem')}</span><b>${isNum(e.prem) ? `<span class="${Math.abs(e.prem) > 0.01 ? 'dn' : ''}">${e.prem >= 0 ? '+' : ''}${(e.prem * 100).toFixed(2)}%</span>` : NA}</b></div>
    <div><span>Category</span><b>${esc(e.category || e.underlying || '') || NA}</b></div>
    <div><span>1-yr return</span><b>${r(e.r1y, e.r1ySrc)}</b></div>
    <div><span>3-yr return (per yr)</span><b>${r(e.r3y, e.r3ySrc)}</b></div>
    <div><span>5-yr return (per yr)</span><b>${r(e.r5y, e.r5ySrc)}</b></div>
    <div><span>YTD${gq('ytd')}</span><b>${r(e.ytd)}</b></div>
    <div><span>52-wk high / low</span><b>${isNum(k.hi52) ? fmtP(k.hi52, c) + ' / ' + fmtP(k.lo52, c) : NA}</b></div>
    <div><span>Avg daily volume (50 d)</span><b>${isNum(e.avgVol50) ? e.avgVol50.toLocaleString(c === 'INR' ? 'en-IN' : 'en-US') : NA}</b></div>
  </div><p class="src">${esc(e.family || '')}${e.family ? ' · ' : ''}${e.assetClass ? 'Asset class: ' + esc(e.assetClass) + ' · ' : ''}${e.underlying ? 'Tracks: ' + esc(e.underlying) + ' · ' : ''}Returns marked (price) are computed from the price history (fund-reported figures not available).${etfMkt(d) === 'IN' ? ' NAV from AMFI; AUM and expense ratio for Indian ETFs are not available from the free sources — see the AMC factsheet.' : ''}</p></div>`;
}
function etfBody(d, k) {
  const e = d.etf || {}, c = d.currency, H = e.holdings || [], S = e.sectors || [], mix = e.mix || {};
  const pros = [], cons = [];
  if (isNum(e.er)) (e.er <= 0.002 ? pros : e.er >= 0.0075 ? cons : []).push(`Expense ratio ${(e.er * 100).toFixed(2)}% (${e.er <= 0.002 ? 'very low' : 'high'})`);
  if (isNum(e.aum)) (e.aum >= (c === 'INR' ? 1e10 : 1e9) ? pros : e.aum < (c === 'INR' ? 1e9 : 1e8) ? cons : []).push(`AUM ${fmtBig(e.aum, c)} (${e.aum >= (c === 'INR' ? 1e10 : 1e9) ? 'large, liquid' : 'small'})`);
  if (isNum(e.prem)) (Math.abs(e.prem) <= 0.005 ? pros : Math.abs(e.prem) > 0.01 ? cons : []).push(`Trades ${Math.abs(e.prem) <= 0.005 ? 'close to' : (e.prem > 0 ? 'at a ' : 'at a ') + (Math.abs(e.prem) * 100).toFixed(1) + '% ' + (e.prem > 0 ? 'premium to' : 'discount to')} NAV`);
  if (isNum(e.avgVol50)) (e.avgVol50 >= 100000 ? pros : e.avgVol50 < 5000 ? cons : []).push(`Average volume ${e.avgVol50.toLocaleString()} units/day (${e.avgVol50 >= 100000 ? 'liquid' : 'thinly traded — wider spreads'})`);
  if (H.length && H[0][2] > 0.15) cons.push(`Concentrated: top holding ${esc(H[0][1] || H[0][0])} is ${(H[0][2] * 100).toFixed(1)}%`);
  if (isNum(e.r5y)) (e.r5y >= 0.1 ? pros : e.r5y < 0 ? cons : []).push(`5-yr return ${(e.r5y * 100).toFixed(1)}%/yr`);
  if (/lever|ultra|3x|2x|inverse|short|bear/i.test(d.name + ' ' + (e.category || ''))) cons.push('Leveraged or inverse fund — meant for short-term trading; returns decay over time');
  if (isNum(k.dma200) && isNum(d.price)) (d.price >= k.dma200 ? pros : cons).push(`Price ${d.price >= k.dma200 ? 'above' : 'below'} its 200-day average`);
  const sum = `<div class="card"><h2>🧾 ETF summary</h2><p>${esc(d.name)} is ${e.category || e.underlying ? 'a <b>' + esc(e.category || e.underlying) + '</b> ' : 'an '}ETF${e.family ? ' from ' + esc(e.family) : ''}${e.underlying ? ', tracking <b>' + esc(e.underlying) + '</b>' : ''}. For an ETF, cost (expense ratio), size and liquidity, how closely it follows its NAV, and what it holds matter more than company valuation — so company-only sections (valuation models, growth-stock checklist, quarterly results, 25-point report and moat) are not shown.</p>
  <div class="grid two"><div><b>Strengths</b><ul class="pros">${pros.map(x => `<li>${x}</li>`).join('') || '<li class="mut">none flagged from available data</li>'}</ul></div><div><b>Watch-outs</b><ul class="cons">${cons.map(x => `<li>${x}</li>`).join('') || '<li class="mut">none flagged from available data</li>'}</ul></div></div>
  <p class="disc" style="margin:8px 0 0">Educational summary generated from public data with fixed rules — not investment advice.</p></div>`;
  const hold = H.length ? `<div class="card"><h2>Top holdings <span class="mut">(${H.length})</span></h2><div class="tw"><table class="pt"><tr><th>Holding</th><th>Weight</th></tr>${H.map(h => `<tr ${h[0] && INDEX.some(r => r[0] === h[0]) ? `data-s="${esc(h[0])}"` : ''}><td style="white-space:normal">${esc(h[1] || h[0])} <small class="mut">${esc(h[0] || '')}</small></td><td>${isNum(h[2]) ? (h[2] * 100).toFixed(2) + '%' : '–'}</td></tr>`).join('')}</table></div>
   ${S.length ? `<h3>Sector weights</h3><div class="tw"><table><tr><th>Sector</th><th>Weight</th></tr>${S.map(x => `<tr><td>${esc(x[0].replace(/_/g, ' ').replace(/^./, m => m.toUpperCase()))}</td><td>${(x[1] * 100).toFixed(1)}%</td></tr>`).join('')}</table></div>` : ''}
   ${Object.keys(mix).length ? `<p class="mut">Asset mix: ${Object.entries(mix).filter(([, v]) => v).map(([a, v]) => `${a} ${(v * 100).toFixed(1)}%`).join(' · ')}</p>` : ''}</div>`
    : `<div class="card"><h2>Top holdings</h2><p>${NA} — the free data source does not publish holdings for this ETF${etfMkt(d) === 'IN' ? ' (Indian ETFs: see the AMC monthly factsheet; it mirrors ' + esc(e.underlying || 'its index') + ')' : ''}.</p></div>`;
  return sum + hold + `<div class="card"><p class="src">Sources: ${esc(d.source || 'Yahoo Finance')}. Snapshot ${dstr(d.fetched)}.</p></div>`;
}
