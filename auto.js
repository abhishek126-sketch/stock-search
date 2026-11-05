// ===== Auto analysis: plain-language write-up generated in the browser from data already loaded on the page =====
// Rule-based only. Every number comes from this page's data (Yahoo statements, NSE/BSE exchange files, the app's
// 25-point report, moat check and sector snapshot). Lines whose data is missing are skipped and listed under "Data missing".
// Nothing is copied from Screener, Moneycontrol or any other site.
function autoSection(d, k, A, R) {
  return `<div class="card" id="autox">${autoHTML(d, k, A, R, null)}</div>`;
}
function autoUpdate(d, k, A, R, x) { const el = document.getElementById('autox'); if (!el) return; el.innerHTML = autoHTML(d, k, A, R, x || {}); autoGloss(el); }
function autoHTML(d, k, A, R, x) {
  const c = d.currency, P = d.price, india = /\.(NS|BO)$/.test(d.symbol), bse = d.symbol.endsWith('.BO'), f = d.fund || {}, pr = d.profile || {};
  const fin = typeof isFinD === 'function' && isFinD(d), miss = [], pc = (v, n = 0) => (v * 100).toFixed(n) + '%', sp = (v, n = 0) => (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(n) + '%';
  const P_ = [], S = (t, arr) => arr.length ? `<h3 class="nogq">${t}</h3><p>${arr.join(' ')}</p>` : '';
  const need = (v, name) => { if (!isNum(v)) miss.push(name); return isNum(v); };
  const strengths = [], concerns = [], watch = [];
  // --- Business & growth
  const bg = [];
  if (d.industry || d.sector) bg.push(`${esc(d.name)} is in the ${esc(d.industry || d.sector)}${d.industry && d.sector ? ' industry (' + esc(d.sector) + ' sector)' : ' sector'}.`);
  if (need(k.revCAGR, 'multi-year revenue growth')) { bg.push(`Revenue ${k.revCAGR >= 0 ? 'grew' : 'shrank'} about ${pc(Math.abs(k.revCAGR), 1)} a year over roughly ${k.cagrYears} years.`); if (k.revCAGR > 0.12) strengths.push('steady double-digit revenue growth'); if (k.revCAGR < 0.03) concerns.push('slow revenue growth'); }
  else if (isNum(k.revGrowthFY)) bg.push(`Revenue changed ${sp(k.revGrowthFY, 1)} in the latest financial year.`);
  if (need(k.niCAGR, 'multi-year profit growth')) bg.push(`Net profit ${k.niCAGR >= 0 ? 'grew' : 'shrank'} about ${pc(Math.abs(k.niCAGR), 1)} a year over the same period.`);
  else if (isNum(k.niGrowthFY)) bg.push(`Net profit changed ${sp(k.niGrowthFY, 1)} in the latest financial year.`);
  if (k.lqDate && (isNum(k.lqRevYoY) || isNum(k.lqNiYoY))) { bg.push(`In the latest quarter (${qlabel(k.lqDate)}), ${isNum(k.lqRevYoY) ? 'revenue was ' + sp(k.lqRevYoY) : ''}${isNum(k.lqRevYoY) && isNum(k.lqNiYoY) ? ' and ' : ''}${isNum(k.lqNiYoY) ? 'net profit ' + sp(k.lqNiYoY) : ''} versus a year earlier.`);
    if (isNum(k.lqNiYoY) && k.lqNiYoY < -0.1) concerns.push('profit fell in the latest quarter'); if (isNum(k.lqNiYoY) && k.lqNiYoY > 0.15) strengths.push('strong latest-quarter profit growth'); }
  else miss.push('quarterly growth');
  // --- Profitability
  const pf = [];
  if (need(k.roe, 'ROE')) { pf.push(`Return on equity (ROE) was ${pc(k.roe, 1)}${k.fy ? ' in FY ' + k.fy.slice(0, 4) : ''}${k.roe >= 0.18 ? ' — high' : k.roe < 0.08 ? ' — low' : ' — moderate'}.`); if (k.roe >= 0.18) strengths.push('high ROE'); if (k.roe < 0.08) concerns.push('low ROE'); }
  if (!fin && need(k.roce, 'ROCE')) { pf.push(`ROCE was ${pc(k.roce, 1)}${k.roce >= 0.2 ? ', showing efficient use of capital' : k.roce < 0.1 ? ', which is weak' : ''}.`); if (k.roce >= 0.2) strengths.push('strong ROCE'); }
  const npm = isNum(k.npmFY) ? k.npmFY : k.npm; if (need(npm, 'net profit margin')) pf.push(`Net profit margin is about ${pc(npm, 1)}${isNum(k.npmFY) ? ' (latest year)' : ' (latest quarter)'}.`);
  if (isNum(pr.opMargins)) pf.push(`Operating margin is ${pc(pr.opMargins, 1)}.`);
  if (k.loss) { pf.push('The company is loss-making on a trailing basis.'); concerns.push('trailing losses'); }
  // --- Balance sheet & cash flow
  const bs = [];
  if (fin) bs.push('As a bank or financial company, its debt is part of the business model, so debt/equity is not a useful test; asset quality (bad loans) and capital adequacy matter more and are not available here.');
  else if (k.negEquity) { bs.push('Shareholders\' equity is negative — liabilities exceed book assets.'); concerns.push('negative equity'); }
  else if (need(k.de, 'debt / equity')) { bs.push(`Debt/equity is ${k.de.toFixed(2)}${k.de < 0.3 ? ' — low debt' : k.de > 1 ? ' — high leverage' : ' — moderate'}.`); if (k.de < 0.3) strengths.push('low debt'); if (k.de > 1) concerns.push('high debt'); }
  if (R && !fin) {
    if (isNum(R.icov)) bs.push(`Interest coverage is ${R.icov.toFixed(1)}x.`);
    if (isNum(R.cr)) bs.push(`Current ratio is ${R.cr.toFixed(2)}.`);
    if (need(R.fcf, 'free cash flow')) { bs.push(`Free cash flow in the latest year was ${fmtBig(R.fcf, c)}${R.fcfAllPos === true ? ', and it was positive in every year available' : R.fcfAllPos === false ? ', but it was negative in at least one recent year' : ''}.`); if (R.fcfAllPos === true) strengths.push('consistent free cash flow'); if (R.fcfAllPos === false) concerns.push('uneven free cash flow'); }
    if (isNum(R.ocfNi) && R.ocfNi < 0) { bs.push('Operating cash flow and reported profit had opposite signs over the last few years — read the cash-flow statement.'); concerns.push('profits not backed by cash'); }
    else if (isNum(R.ocfNi)) { bs.push(`Operating cash flow covered ${pc(R.ocfNi)} of reported profit over up to 3 years${R.ocfNi < 0.8 ? ' — profits are not fully backed by cash' : ''}.`); if (R.ocfNi < 0.8 && R.ocfNi >= 0) concerns.push('profits not fully backed by cash'); }
  }
  // --- Valuation
  const va = [];
  if (k.loss) va.push('P/E is not meaningful because of losses.');
  else if (need(k.pe, 'P/E')) va.push(`The stock trades at a P/E of ${k.pe.toFixed(1)}.`);
  if (need(k.pb, 'P/B')) va.push(`P/B is ${k.pb.toFixed(2)}.`);
  if (R && R.peHist && R.peHist.length >= 3 && isNum(k.pe) && !k.loss) { const a = R.peHist.map(z => z[1]).sort((p, q) => p - q), med = a[Math.floor(a.length / 2)];
    va.push(`Versus its own history since ${String(R.peHist[0][0]).slice(0, 4)}, the median P/E was ${med.toFixed(1)} (range ${a[0].toFixed(1)}–${last(a).toFixed(1)}), so today's P/E is ${k.pe > med * 1.15 ? 'above' : k.pe < med * 0.85 ? 'below' : 'close to'} its usual level.`); }
  else miss.push('P/E history');
  const peers = typeof SUMMARY !== 'undefined' && SUMMARY ? SUMMARY.rows.filter(r => r.sec && r.sec === d.sector && r.s !== d.symbol && /\.(NS|BO)$/.test(r.s) === india && r.pe > 0) : [];
  if (peers.length >= 3 && isNum(k.pe) && !k.loss) { const a = peers.map(r => r.pe).sort((p, q) => p - q), med = a[Math.floor(a.length / 2)];
    va.push(`Among ${peers.length} ${esc(d.sector)} peers in the app's ${india ? 'Indian' : 'S&P 500'} list, the median P/E is ${med.toFixed(1)}; this stock is ${k.pe > med * 1.15 ? 'more expensive' : k.pe < med * 0.85 ? 'cheaper' : 'roughly in line'} on that measure.`); }
  else miss.push('peer P/E comparison');
  if (isNum(k.dy) && k.dy > 0) va.push(`Dividend yield is ${pc(k.dy, 2)}.`);
  if (R && isNum(R.peg)) va.push(`PEG is ${R.peg.toFixed(2)}.`);
  // --- Ownership (exchange data, Indian stocks)
  const ow = [];
  if (india) {
    if (x === null) ow.push('<span class="mut">Loading promoter holding and pledge data…</span>');
    else {
      const pm = x.prom || []; if (pm.length >= 2) { const a = pm[Math.max(0, pm.length - 5)], b = last(pm), ch = b[1] - a[1];
        ow.push(`Promoters hold ${b[1].toFixed(2)}% of the company, ${Math.abs(ch) < 0.1 ? 'little changed' : ch > 0 ? 'up ' + ch.toFixed(2) + ' points' : 'down ' + (-ch).toFixed(2) + ' points'} over the last ${pm.length - 1 - Math.max(0, pm.length - 5)} quarter(s).`);
        if (ch <= -1) concerns.push('promoters reduced their stake'); if (b[1] < 25) watch.push('low promoter holding'); }
      else if (pm.length === 1) ow.push(`Promoters hold ${pm[0][1].toFixed(2)}%.`); else miss.push('promoter holding');
      const pl = x.pledge; if (pl && !pl.none && isNum(pl.pp)) { ow.push(`${pl.pp.toFixed(1)}% of promoter shares are pledged.`); if (pl.pp > 5) concerns.push('promoter pledge above 5%'); }
      else if (pl && pl.none) ow.push('No promoter pledge is disclosed on NSE.'); else miss.push('promoter pledge');
      const dl = x.deals || []; if (dl.length) ow.push(`${dl.length} bulk/block deal(s) have been recorded since ${esc(x.dealsSince || 'collection began')}.`);
    }
  }
  // --- Technical picture
  const te = [];
  if (need(k.dma200, '200-day average')) te.push(`The price (${fmtP(P, c)}) is ${sp(P / k.dma200 - 1, 1)} ${P >= k.dma200 ? 'above' : 'below'} its 200-day moving average${isNum(k.dma50) ? ` and ${sp(P / k.dma50 - 1, 1)} ${P >= k.dma50 ? 'above' : 'below'} its 50-day average` : ''} — the long-term trend is ${P >= k.dma200 ? (isNum(k.dma50) && k.dma50 >= k.dma200 ? 'up' : 'mixed') : (isNum(k.dma50) && k.dma50 < k.dma200 ? 'down' : 'mixed')}.`);
  if (k.cross) te.push(`A ${k.cross === 'golden' ? 'golden cross' : 'death cross'} happened on ${dstr(k.crossT)}.`);
  if (need(k.rsi, 'RSI')) te.push(`RSI is ${k.rsi.toFixed(0)}${k.rsi > 70 ? ' (overbought zone)' : k.rsi < 30 ? ' (oversold zone)' : ' (neutral range)'}.`);
  if (need(k.hi52, '52-week range')) { const pos = k.hi52 > k.lo52 ? (P - k.lo52) / (k.hi52 - k.lo52) : 0.5; te.push(`It sits ${pc(pos)} of the way up its 52-week range (${fmtP(k.lo52, c)} – ${fmtP(k.hi52, c)}).`); }
  if (isNum(k.ret1y)) te.push(`One-year return: ${sp(k.ret1y, 1)}.`);
  if (isNum(k.rsi) && k.rsi > 70) watch.push('short-term overbought RSI'); if (isNum(k.hi52) && P < k.hi52 * 0.75) watch.push(`trading ${pc(1 - P / k.hi52)} below its 52-week high`);
  // --- Risks
  const rk = [];
  if (d.penny) rk.push('This is a penny stock: low liquidity and higher risk of price manipulation.');
  const sv = (x && x.surv) || (d.penny && d.penny.surv); if (sv) { rk.push(`It is on the exchange surveillance list (${esc(sv)}), which means extra trading restrictions.`); concerns.push('on ASM/GSM surveillance'); }
  if (x && x.aud && x.aud.length) { rk.push(`An auditor ${x.audBad ? 'resignation' : 'change'} was filed recently.`); concerns.push('auditor change'); }
  if (R && R.flags) rk.push(`The 25-point report below raises ${R.flags} red flag(s).`);
  if (Math.abs(k.chgPct || 0) > 0.08) rk.push(`Today's move of ${sp(k.chgPct, 1)} is unusually large — check news and corporate actions.`);
  if (fin) rk.push('Financial companies carry credit risk that the free data here cannot measure.');
  if (bse) rk.push('As a BSE-only stock, NSE shareholding/pledge data and BSE deal data are not available here.');
  // --- Scores
  const sc = [];
  if (R && isNum(R.comp)) sc.push(`On the app's 25-point rule-based report the composite score is ${Math.round(R.comp)}/100 (higher = more of the rules met).`); else miss.push('25-point composite score');
  if (A && isNum(A.overall)) sc.push(`The quick scorecard rates it ${A.overall.toFixed(1)}/10 overall.`);
  if (typeof moatCalc === 'function' && !d.etf) { try { const M = moatCalc(d, k); if (M.ev >= 4) { sc.push(`The moat check passes ${M.ps} of ${M.ev} tests, suggesting ${M.rating === 'Wide' ? 'a wide' : M.rating === 'Narrow' ? 'a narrow' : 'no clear'} moat on the numbers.`); if (M.rating === 'Wide') strengths.push('signs of a durable moat'); } else miss.push('moat check'); } catch (e) { } }
  if (A && A.style) sc.push(esc(A.style));
  // --- Summary
  const uniq = a => [...new Set(a)];
  const sum = `<div class="verdict" style="background:#f1f5f9;font-weight:400">${[
    strengths.length ? `<b>Strengths:</b> ${uniq(strengths).join(', ')}.` : `<b>Strengths:</b> ${d.etf ? 'an ETF is judged mainly on its index, costs and tracking — see the ETF cards below.' : 'none stand out on the available data.'}`,
    concerns.length ? `<b>Concerns:</b> ${uniq(concerns).join(', ')}.` : '<b>Concerns:</b> no major concerns on the available data.',
    `<b>What to watch:</b> ${uniq(watch.concat(d.etf ? ['tracking difference vs its index', 'expense ratio'] : ['next quarterly results', india ? 'shareholding and pledge changes' : 'guidance changes'])).join(', ')}.`].join('<br>')}</div>`;
  const body = (d.etf ? '' : S('Business &amp; growth', bg) + S('Profitability', pf) + S('Balance sheet &amp; cash flow', bs) + S('Valuation', va) + S('Ownership', ow)) + S('Technical picture', te) + S('Risks', rk) + S('Scores', sc);
  const um = d.etf ? [] : uniq(miss);
  return `<h2 class="nogq">🤖 Auto analysis <span class="mut">(generated automatically from this page's data)</span></h2>${sum}${body}
   ${um.length ? `<p class="mut"><b>Data missing:</b> ${um.join(', ')} — skipped above.</p>` : ''}
   <p class="src">⚠️ Educational only — not investment advice and not a buy/sell recommendation. Written by fixed rules from free data (Yahoo Finance statements, NSE/BSE exchange files, this app's sector snapshot); it can be incomplete or out of date. Always read the company's filings and consult a SEBI-registered adviser before investing.</p>`;
}
