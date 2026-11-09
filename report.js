'use strict';
// ===== 25-point research report (rule-based, transparent; never invents data) =====
const RN = v => isNum(v) ? v : undefined;
const pct1 = v => isNum(v) ? (v * 100).toFixed(1) + '%' : '<span class="mut">n/a</span>';
const nn = (v, d = 1) => isNum(v) ? v.toFixed(d) : '<span class="mut">n/a</span>';
const lin = (v, bad, good) => isNum(v) ? Math.max(0, Math.min(1, (v - bad) / (good - bad))) : undefined;
const strip = h => String(h).replace(/<[^>]+>/g, '');
const how = t => `<details class="how"><summary>How calculated</summary><div class="mut">${t}</div></details>`;
const RSEC = (n, id, title, body, open) => `<details class="card sec rpt" id="${id}" data-n="${n}" ${open ? 'open' : ''}><summary><h2><span class="rn">${n}</span> ${title}</h2></summary>${body}</details>`;
const inner = h => { const i = h.indexOf('</summary>'), j = h.lastIndexOf('</details>'); return i > 0 && j > i ? h.slice(i + 10, j) : h; };
const ema = (a, n) => { const k = 2 / (n + 1), o = []; let e; a.forEach((x, i) => { e = i ? x * k + e * (1 - k) : x; o.push(e); }); return o; };
const stdev = a => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function scoreTable(C) {
  const av = C.filter(c => isNum(c.s)), W = C.reduce((s, c) => s + c.w, 0), Wa = av.reduce((s, c) => s + c.w, 0);
  const score = Wa >= W * 0.4 ? av.reduce((s, c) => s + c.w * c.s, 0) / Wa * 100 : undefined;
  return { score, cov: Wa / W, C };
}
const bar = s => `<div class="score"><span class="bar"><i style="width:${isNum(s) ? s : 0}%;background:${!isNum(s) ? '#cbd5e1' : s >= 65 ? '#16a34a' : s >= 45 ? '#eab308' : '#dc2626'}"></i></span><span class="v">${isNum(s) ? Math.round(s) + '/100' : '<span class="mut">n/a</span>'}</span></div>`;
function scoreHTML(T, intro, note) {
  return `${intro ? `<p>${intro}</p>` : ''}${bar(T.score)}<p class="mut">Data coverage ${(T.cov * 100).toFixed(0)}% of criteria weight${T.cov < 1 ? ' — missing criteria are excluded, not guessed' : ''}${!isNum(T.score) ? ' (needs ≥ 40% to score)' : ''}.</p>
  <div class="tw"><table><tr><th>Criterion</th><th>Value</th><th>Points</th></tr>${T.C.map(c => `<tr><td style="white-space:normal">${c.n}<br><small class="mut">${c.rule}</small></td><td>${c.v === undefined ? '<span class="mut">n/a</span>' : c.v}</td><td>${isNum(c.s) ? (c.s * c.w).toFixed(1) + ' / ' + c.w : '<span class="mut">– / ' + c.w + '</span>'}</td></tr>`).join('')}</table></div>
  ${how('Each criterion earns 0 → full points on a linear scale between the stated "poor" and "good" thresholds. Score = points earned ÷ points available × 100. ' + (note || ''))}`;
}

function buildReport(d, k, A) {
  const f = d.fund || {}, pr = d.profile || {}, fin = isFinD(d), india = mktOf(d.symbol) === 'IN', P = d.price, c = d.currency, R = { fin, india };
  const L = key => f[key] || [], byDate = key => Object.fromEntries(L(key));
  const S = SUMMARY && d.sector ? sectorStats(mktOf(d.symbol), d.sector) : null; R.S = S && S.rows.length >= 3 ? S : null;
  const rev = L('annualTotalRevenue'), ni = L('annualNetIncome'), eqM = byDate('annualStockholdersEquity'), opM = byDate('annualOperatingIncome'), gpM = byDate('annualGrossProfit');
  R.roeS = ni.filter(x => eqM[x[0]] > 0).map(x => [x[0], x[1] / eqM[x[0]]]);
  R.nmS = ni.map(x => { const r = rev.find(y => y[0] === x[0]); return r && r[1] > 0 ? [x[0], x[1] / r[1]] : null; }).filter(Boolean);
  R.omS = rev.filter(x => isNum(opM[x[0]]) && x[1] > 0).map(x => [x[0], opM[x[0]] / x[1]]);
  R.gmS = rev.filter(x => isNum(gpM[x[0]]) && x[1] > 0).map(x => [x[0], gpM[x[0]] / x[1]]);
  const ae = L('annualDilutedEPS'); R.epsCAGR = ae.length >= 3 && ae[0][1] > 0 && last(ae)[1] > 0 ? Math.pow(last(ae)[1] / ae[0][1], 1 / (days(last(ae)[0], ae[0][0]) / 365.25)) - 1 : undefined;
  R.g = isNum(R.epsCAGR) ? R.epsCAGR : isNum(k.niCAGR) ? k.niCAGR : undefined; R.gSrc = isNum(R.epsCAGR) ? `annual EPS CAGR over ${ae.length} FY` : isNum(k.niCAGR) ? 'net profit CAGR' : '';
  const ca = last(L('annualCurrentAssets')), cl = last(L('annualCurrentLiabilities'));
  R.cr = ca && cl && ca[0] === cl[0] && cl[1] > 0 ? ca[1] / cl[1] : RN(pr.currentRatio);
  const eb = last(L('annualEBIT')), ie = last(L('annualInterestExpense')); R.icov = eb && ie && ie[1] > 0 ? eb[1] / ie[1] : undefined;
  const fcfA = L('annualFreeCashFlow'), ocfA = L('annualOperatingCashFlow'), capA = L('annualCapitalExpenditure'), rdA = L('annualResearchAndDevelopment');
  R.fcf = last(fcfA) ? last(fcfA)[1] : undefined; R.fcfAllPos = fcfA.length ? fcfA.every(x => x[1] > 0) : undefined;
  R.ocfNi = ocfA.length && ni.length ? (n => ocfA.slice(-n).reduce((s, x) => s + x[1], 0) / ni.slice(-n).reduce((s, x) => s + x[1], 0))(Math.min(3, ocfA.length, ni.length)) : undefined;
  R.rd = last(rdA) && rev.length && last(rev)[1] > 0 ? last(rdA)[1] / last(rev)[1] : undefined;
  R.capexOcf = last(capA) && last(ocfA) && last(ocfA)[1] > 0 ? Math.abs(last(capA)[1]) / last(ocfA)[1] : undefined;
  const now = Date.now() / 1000, divs = d.divs || []; R.dps = divs.filter(x => x[0] >= now - 365 * DAY).reduce((s, x) => s + x[1], 0);
  R.divYears = [1, 2, 3, 4].filter(y => divs.some(x => x[0] < now - (y - 1) * 365 * DAY && x[0] >= now - y * 365 * DAY)).length;
  R.payout = isNum(k.eps) && k.eps > 0 && R.dps >= 0 ? R.dps / k.eps : undefined;
  R.sgr = isNum(k.roe) && isNum(R.payout) ? k.roe * Math.max(0, 1 - R.payout) : undefined;
  R.netCash = isNum(pr.cash) && isNum(pr.debt) ? pr.cash - pr.debt : undefined;
  R.ev = isNum(k.mcap) && isNum(pr.debt) && isNum(pr.cash) ? k.mcap + pr.debt - pr.cash : undefined;
  R.evEbit = isNum(R.ev) && eb && eb[1] > 0 && !fin ? R.ev / eb[1] : undefined;
  R.ps = isNum(k.mcap) && rev.length && last(rev)[1] > 0 ? k.mcap / last(rev)[1] : undefined;
  R.fcfy = isNum(k.mcap) && isNum(R.fcf) && !fin ? R.fcf / k.mcap : undefined;
  R.peHist = L('trailingPeRatio').filter(x => x[1] > 0); R.pbHist = L('trailingPbRatio').filter(x => x[1] > 0);
  // technicals
  const hist = d.hist || [], cls = hist.map(x => x[1]), T = R.T = {};
  T.d20 = sma(cls, 20); T.d50 = k.dma50; T.d200 = k.dma200; T.rsi = k.rsi;
  if (cls.length > 60) { const e12 = ema(cls, 12), e26 = ema(cls, 26), m = e12.map((x, i) => x - e26[i]), s = ema(m, 9); T.macd = last(m); T.sig = last(s); T.hist = T.macd - T.sig; }
  const yr = hist.filter(x => x[0] >= now - 400 * DAY), piv = [];
  for (let i = 5; i < yr.length - 5; i++) { const w = yr.slice(i - 5, i + 6).map(x => x[1]); if (yr[i][1] === Math.max(...w)) piv.push(['H', yr[i][1], yr[i][0]]); if (yr[i][1] === Math.min(...w)) piv.push(['L', yr[i][1], yr[i][0]]); }
  T.sup = piv.filter(x => x[1] < P).sort((a, b) => b[1] - a[1]).slice(0, 2); T.res = piv.filter(x => x[1] > P).sort((a, b) => a[1] - b[1]).slice(0, 2);
  const rets = []; for (let i = Math.max(1, cls.length - 252); i < cls.length; i++) rets.push(Math.log(cls[i] / cls[i - 1]));
  T.vol = rets.length > 100 ? stdev(rets) * Math.sqrt(252) : undefined;
  const mdd = a => { let pk = -Infinity, m = 0; for (const x of a) { pk = Math.max(pk, x); m = Math.min(m, x / pk - 1); } return m; };
  T.mdd1 = yr.length > 150 ? mdd(hist.filter(x => x[0] >= now - 365 * DAY).map(x => x[1])) : undefined; T.mdd5 = cls.length > 500 ? mdd(cls) : undefined; T.mddYears = cls.length > 500 ? Math.round((last(hist)[0] - hist[0][0]) / 365 / DAY) : undefined;
  T.fromHi = isNum(k.hi52) ? P / k.hi52 - 1 : undefined;
  const M = MARKET && MARKET[mktOf(d.symbol)];
  if (isNum(pr.beta)) { T.beta = pr.beta; T.betaSrc = 'Yahoo Finance'; }
  else if (M && M.hist && M.hist.length > 150) { const dm = new Map(hist.map(x => [Math.floor((x[0] + 19800) / DAY), x[1]])); const pairs = []; let pi = null;
    for (const [t, v] of M.hist) { const sv = dm.get(Math.floor((t + 19800) / DAY)); if (sv && pi) pairs.push([Math.log(sv / pi[1]), Math.log(v / pi[0])]); pi = sv ? [v, sv] : null; }
    if (pairs.length > 120) { const mx = pairs.reduce((s, p) => s + p[1], 0) / pairs.length, my = pairs.reduce((s, p) => s + p[0], 0) / pairs.length; const cov = pairs.reduce((s, p) => s + (p[0] - my) * (p[1] - mx), 0), vr = pairs.reduce((s, p) => s + (p[1] - mx) ** 2, 0); T.beta = cov / vr; T.betaSrc = `computed vs ${india ? 'NIFTY 50' : 'S&P 500'}, ${pairs.length} daily returns`; } }
  const v = d.vol || {}; T.udr = RN(v.udr); T.volRatio = isNum(v.last) && v.avg50 > 0 ? v.last / v.avg50 : undefined;
  R.tech = scoreTable([{ n: 'Price above 200-DMA', w: 25, s: isNum(T.d200) ? +(P > T.d200) : undefined, v: isNum(T.d200) ? sgnPct(P / T.d200 - 1) : undefined, rule: 'long-term trend' },
    { n: '50-DMA above 200-DMA', w: 15, s: isNum(T.d50) && isNum(T.d200) ? +(T.d50 > T.d200) : undefined, v: isNum(T.d50) && isNum(T.d200) ? (T.d50 > T.d200 ? 'yes' : 'no') : undefined, rule: 'medium-term trend' },
    { n: 'Price above 50-DMA', w: 15, s: isNum(T.d50) ? +(P > T.d50) : undefined, v: isNum(T.d50) ? sgnPct(P / T.d50 - 1) : undefined, rule: 'short/medium trend' },
    { n: 'RSI(14) in healthy 40–70 zone', w: 15, s: isNum(T.rsi) ? (T.rsi >= 40 && T.rsi <= 70 ? 1 : T.rsi > 70 ? 0.5 : lin(T.rsi, 20, 40)) : undefined, v: isNum(T.rsi) ? T.rsi.toFixed(0) : undefined, rule: '> 70 overbought = half points; < 40 scaled down' },
    { n: 'MACD above signal line', w: 15, s: isNum(T.hist) ? +(T.hist > 0) : undefined, v: isNum(T.hist) ? T.macd.toFixed(2) + ' vs ' + T.sig.toFixed(2) : undefined, rule: 'momentum' },
    { n: '1-year return positive', w: 15, s: lin(k.ret1y, -0.2, 0.2), v: isNum(k.ret1y) ? sgnPct(k.ret1y) : undefined, rule: 'poor −20% → good +20%' }]);
  const CW = { C: 20, A: 20, N: 10, S: 10, L: 15, I: 10, M: 15 }, cs = d.canslim;
  R.cans = cs ? scoreTable('CANSLIM'.split('').map(l => ({ n: `<b>${l}</b>${gq('cs' + l)} ${CSN[l]}`, w: CW[l], s: cs.L[l].s === 'na' ? undefined : +(cs.L[l].s === 'pass'), v: cs.L[l].s === 'na' ? undefined : cs.L[l].s === 'pass' ? '<span class="up">✔ pass</span>' : '<span class="dn">✘ fail</span>', rule: esc(cs.L[l].why) }))) : null;
  const big = india ? 2e11 : 2e9, pe = k.loss ? undefined : k.pe, pb = k.pb;
  R.graham = scoreTable([
    { n: 'Adequate size (market cap)', w: 12.5, s: isNum(k.mcap) ? lin(k.mcap, big / 4, big) : undefined, v: isNum(k.mcap) ? fmtBig(k.mcap, c) : undefined, rule: `good ≥ ${india ? '₹20,000 Cr' : '$2B'}; poor ≤ ¼ of that` },
    { n: 'Current ratio ≥ 2', w: 12.5, s: fin ? undefined : lin(R.cr, 1, 2), v: fin ? 'n/m (financial)' : isNum(R.cr) ? R.cr.toFixed(2) : undefined, rule: 'poor 1.0 → good 2.0 (not applied to banks/financials)' },
    { n: 'Low debt (debt/equity)', w: 12.5, s: fin ? undefined : k.negEquity ? 0 : lin(k.de, 1, 0.5), v: fin ? 'n/m (financial)' : isNum(k.de) ? k.de.toFixed(2) : undefined, rule: 'Graham: long-term debt ≤ net current assets; proxy: D/E good ≤ 0.5, poor ≥ 1.0' },
    { n: 'Earnings stability (no loss years)', w: 12.5, s: ni.length >= 3 ? ni.filter(x => x[1] > 0).length / ni.length : undefined, v: ni.length ? `${ni.filter(x => x[1] > 0).length}/${ni.length} FY profitable` : undefined, rule: `Graham asks 10 years; only ${ni.length} FY available from free data` },
    { n: 'Dividend record', w: 12.5, s: d.divs ? R.divYears / 4 : undefined, v: d.divs ? `paid in ${R.divYears} of last 4 years` : undefined, rule: 'Graham asks 20 years of uninterrupted dividends; ~5y history available' },
    { n: 'EPS growth', w: 12.5, s: lin(R.epsCAGR, 0, 0.03), v: isNum(R.epsCAGR) ? sgnPct(R.epsCAGR) + '/yr' : undefined, rule: 'Graham: +33% over 10 yrs (≈3%/yr); good ≥ 3%/yr, poor ≤ 0' },
    { n: 'P/E ≤ 15', w: 12.5, s: k.loss ? 0 : lin(pe, 25, 15), v: k.loss ? 'loss' : isNum(pe) ? pe.toFixed(1) : undefined, rule: 'good ≤ 15, poor ≥ 25' },
    { n: 'P/E × P/B ≤ 22.5', w: 12.5, s: k.loss ? 0 : isNum(pe) && isNum(pb) ? lin(pe * pb, 45, 22.5) : undefined, v: isNum(pe) && isNum(pb) ? (pe * pb).toFixed(1) : undefined, rule: 'good ≤ 22.5, poor ≥ 45' }]);
  const roes = R.roeS.map(x => x[1]), nms = R.nmS.map(x => x[1]);
  R.buffett = scoreTable([
    { n: 'ROE consistency', w: 20, s: roes.length >= 2 ? Math.min(lin(avg(roes), 0.08, 0.18), lin(Math.min(...roes), 0.05, 0.15)) : lin(k.roe, 0.08, 0.18), v: roes.length ? roes.map(x => (x * 100).toFixed(0) + '%').join(' → ') : isNum(k.roe) ? pct1(k.roe) : undefined, rule: 'avg ROE good ≥ 18% and every year ≥ 15%' },
    { n: 'Net margin level', w: 15, s: lin(isNum(k.npmFY) ? k.npmFY : k.npm, 0.04, 0.15), v: isNum(isNum(k.npmFY) ? k.npmFY : k.npm) ? pct1(isNum(k.npmFY) ? k.npmFY : k.npm) : undefined, rule: 'poor ≤ 4% → good ≥ 15%' },
    { n: 'Margin stability', w: 10, s: nms.length >= 3 ? lin(stdev(nms) / Math.abs(avg(nms) || 1), 0.5, 0.1) : undefined, v: nms.length >= 3 ? nms.map(x => (x * 100).toFixed(1) + '%').join(' → ') : undefined, rule: 'variation of annual net margin; low variation suggests pricing power' },
    { n: 'Low debt', w: 15, s: fin ? undefined : k.negEquity ? 0 : lin(k.de, 1, 0.3), v: fin ? 'n/m (financial)' : isNum(k.de) ? k.de.toFixed(2) : undefined, rule: 'D/E good ≤ 0.3, poor ≥ 1.0' },
    { n: 'Free cash flow every year', w: 15, s: fin ? undefined : fcfA.length >= 2 ? fcfA.filter(x => x[1] > 0).length / fcfA.length : undefined, v: fin ? 'n/m (financial)' : fcfA.length ? `${fcfA.filter(x => x[1] > 0).length}/${fcfA.length} FY positive` : undefined, rule: 'share of years with positive FCF' },
    { n: 'Owner earnings yield', w: 15, s: fin ? undefined : lin(R.fcfy, 0.01, 0.05), v: fin ? 'n/m (financial)' : isNum(R.fcfy) ? pct1(R.fcfy) : undefined, rule: 'owner earnings ≈ OCF − capex (FCF) ÷ market cap; poor ≤ 1%, good ≥ 5%' },
    { n: 'Moat proxy (high returns / gross margin)', w: 10, s: fin ? lin(k.roe, 0.1, 0.17) : isNum(k.roce) || R.gmS.length ? Math.max(lin(k.roce, 0.1, 0.25) || 0, lin(R.gmS.length ? last(R.gmS)[1] : undefined, 0.2, 0.45) || 0) : undefined, v: fin ? `ROE ${pct1(k.roe)}` : `ROCE ${pct1(k.roce)}${R.gmS.length ? ' · gross margin ' + pct1(last(R.gmS)[1]) : ''}`, rule: 'ROCE ≥ 25% or gross margin ≥ 45% suggests a moat (banks: ROE ≥ 17%)' }]);
  const om0 = R.omS[0], om1 = last(R.omS);
  R.fisher = scoreTable([
    { n: 'Multi-year revenue growth', w: 25, s: lin(isNum(k.revCAGR) ? k.revCAGR : k.revGrowthFY, 0, 0.15), v: isNum(k.revCAGR) ? sgnPct(k.revCAGR) + `/yr (${k.cagrYears}y)` : undefined, rule: 'poor ≤ 0 → good ≥ 15%/yr' },
    { n: 'Recent growth (latest quarter revenue YoY)', w: 15, s: lin(k.lqRevYoY, 0, 0.15), v: isNum(k.lqRevYoY) ? sgnPct(k.lqRevYoY) : undefined, rule: 'is growth continuing? poor ≤ 0 → good ≥ 15%' },
    { n: 'Operating-margin trend', w: 20, s: R.omS.length >= 2 ? lin(om1[1] - om0[1], -0.03, 0.02) : undefined, v: R.omS.length >= 2 ? `${pct1(om0[1])} → ${pct1(om1[1])}` : undefined, rule: 'Fisher wants improving margins; poor −3 pts → good +2 pts' },
    { n: 'R&D intensity', w: 15, s: isNum(R.rd) ? lin(R.rd, 0, 0.05) : undefined, v: isNum(R.rd) ? pct1(R.rd) + ' of revenue' : undefined, rule: 'good ≥ 5% of revenue; n/a when R&D is not reported' },
    { n: 'Reinvestment capacity (sustainable growth)', w: 15, s: lin(R.sgr, 0.04, 0.15), v: isNum(R.sgr) ? pct1(R.sgr) : undefined, rule: 'ROE × (1 − dividend payout); good ≥ 15%' },
    { n: 'Profit growing faster than sales', w: 10, s: isNum(k.niCAGR) && isNum(k.revCAGR) ? lin(k.niCAGR - k.revCAGR, -0.05, 0.02) : undefined, v: isNum(k.niCAGR) && isNum(k.revCAGR) ? `${sgnPct(k.niCAGR)} vs ${sgnPct(k.revCAGR)}` : undefined, rule: 'operating leverage: profit CAGR − revenue CAGR' }]);
  const cyc = /energy|basic materials/i.test(d.sector || '') || /steel|metal|mining|auto|chemical|cement|oil|airline|shipping|aluminum|copper|paper/i.test(d.industry || '');
  const niLast = last(ni), niPrev = ni.length > 1 ? ni[ni.length - 2] : null; let cat, catWhy;
  if (niLast && niPrev && niPrev[1] < 0 && niLast[1] > 0 || k.loss && ni.some(x => x[1] > 0)) { cat = 'Turnaround'; catWhy = 'recent swing between losses and profits'; }
  else if (isNum(pb) && pb > 0 && pb < 1 && !k.loss) { cat = 'Asset play'; catWhy = `P/B ${pb.toFixed(2)} below 1 — market values it under book`; }
  else if (cyc) { cat = 'Cyclical'; catWhy = `profits in ${esc(d.industry || d.sector)} typically follow the economic/commodity cycle`; }
  else if (isNum(R.g)) { cat = R.g < 0.06 ? 'Slow grower' : R.g <= 0.15 ? 'Stalwart' : 'Fast grower'; catWhy = `earnings growth ${sgnPct(R.g)}/yr (${R.gSrc}); < 6% slow, 6–15% stalwart, > 15% fast`; }
  else { cat = 'Not classifiable'; catWhy = 'earnings growth not available'; }
  R.lcat = cat; R.lcatWhy = catWhy;
  const gy = isNum(R.g) ? R.g * 100 + (k.dy || 0) * 100 : undefined; R.peg = isNum(pe) && isNum(gy) && gy > 0 ? pe / gy : undefined;
  const inv = L('annualInventory'), invG = inv.length > 1 && inv[inv.length - 2][1] > 0 ? last(inv)[1] / inv[inv.length - 2][1] - 1 : undefined;
  R.lynch = scoreTable([
    { n: 'PEG (P/E ÷ (growth + dividend yield))', w: 40, s: k.loss ? 0 : isNum(R.peg) ? lin(R.peg, 2, 1) : isNum(gy) && gy <= 0 ? 0 : undefined, v: isNum(R.peg) ? R.peg.toFixed(2) + (isNum(pr.peg) ? ` <small class="mut">(Yahoo PEG ${pr.peg.toFixed(2)})</small>` : '') : isNum(gy) && gy <= 0 ? 'growth ≤ 0' : undefined, rule: 'Lynch: ≤ 1 attractive, ≥ 2 expensive' },
    { n: 'Growth in the sweet spot', w: 20, s: isNum(R.g) ? (R.g > 0.4 ? 0.5 : lin(R.g, 0, 0.2)) : undefined, v: isNum(R.g) ? sgnPct(R.g) + '/yr' : undefined, rule: '20–40%/yr ideal; > 40% hard to sustain (half points)' },
    { n: 'Balance sheet (debt/equity)', w: 15, s: fin ? undefined : k.negEquity ? 0 : lin(k.de, 1, 0.35), v: fin ? 'n/m (financial)' : isNum(k.de) ? k.de.toFixed(2) : undefined, rule: 'good ≤ 0.35, poor ≥ 1.0' },
    { n: 'P/E not stretched', w: 10, s: k.loss ? 0 : lin(pe, 40, 20), v: k.loss ? 'loss' : isNum(pe) ? pe.toFixed(1) : undefined, rule: 'good ≤ 20, poor ≥ 40' },
    { n: 'Inventory not outrunning sales', w: 15, s: isNum(invG) && isNum(k.revGrowthFY) ? lin(invG - k.revGrowthFY, 0.15, 0) : undefined, v: isNum(invG) && isNum(k.revGrowthFY) ? `${sgnPct(invG)} vs sales ${sgnPct(k.revGrowthFY)}` : undefined, rule: 'inventory growth − sales growth; good ≤ 0, poor ≥ +15 pts' }]);
  const iv = R.iv = ivCompute(d, k), vs = iv.vals.slice().sort((a, b) => a - b), q = p => { const i = (vs.length - 1) * p, lo = Math.floor(i); return vs[lo] + (vs[Math.ceil(i)] - vs[lo]) * (i - lo); };
  R.fv = vs.length ? { low: q(0.25), base: q(0.5), high: q(0.75), n: vs.length } : null;
  R.mos = R.fv ? (R.fv.base - P) / R.fv.base : undefined;
  const negN = d.news && d.news.items ? d.news.items.filter(x => x.g.includes('neg')).length : undefined; R.negN = negN;
  R.risk = scoreTable([
    { n: 'Volatility (1y, annualised)', w: 20, s: lin(T.vol, 0.18, 0.5), v: isNum(T.vol) ? pct1(T.vol) : undefined, rule: 'low 18% → high 50%' },
    { n: 'Beta', w: 15, s: lin(T.beta, 0.7, 1.6), v: isNum(T.beta) ? T.beta.toFixed(2) + ` <small class="mut">(${T.betaSrc})</small>` : undefined, rule: 'low 0.7 → high 1.6' },
    { n: `Max drawdown (${T.mddYears || 5}y)`, w: 15, s: isNum(T.mdd5) ? lin(-T.mdd5, 0.2, 0.6) : undefined, v: isNum(T.mdd5) ? pct1(T.mdd5) : undefined, rule: 'low −20% → high −60%' },
    { n: 'Leverage', w: 20, s: fin ? undefined : k.negEquity ? 1 : isNum(R.icov) && R.icov < 3 ? 1 : lin(k.de, 0.3, 1.5), v: fin ? 'n/m (financial)' : `D/E ${isNum(k.de) ? k.de.toFixed(2) : 'n/a'} · interest cover ${isNum(R.icov) ? R.icov.toFixed(1) + '×' : 'n/a'}`, rule: 'D/E low 0.3 → high 1.5; interest cover < 3× = max risk' },
    { n: 'Ownership concentration / free float', w: 10, s: lin(pr.insiders, 0.5, 0.8), v: isNum(pr.insiders) ? pct1(pr.insiders) + ' insiders/promoters' : undefined, rule: 'low 50% → high 80% insider holding (thin free float); business concentration not available' },
    { n: 'News risk (negative headlines, 90d)', w: 20, s: lin(negN, 0, 6), v: isNum(negN) ? negN + ' headlines' : undefined, rule: 'unverified keyword tagging; 0 → 6+' }]);
  R.parts = [['Fundamentals (pillars)', isNum(A.overall) ? A.overall * 10 : undefined, 20], ['Buffett quality', R.buffett.score, 20], ['Graham value', R.graham.score, 10], ['Fisher growth', R.fisher.score, 15], ['Lynch GARP', R.lynch.score, 15], ['CANSLIM', R.cans && R.cans.score, 10], ['Technicals', R.tech.score, 10]];
  const pa = R.parts.filter(p => isNum(p[1])), pw = pa.reduce((s, p) => s + p[2], 0);
  R.comp = pw >= 50 ? pa.reduce((s, p) => s + p[1] * p[2], 0) / pw : undefined;
  R.flags = redFlagCount(d, k);
  const lv = ['Avoid for now', 'Hold / watch', 'Accumulate gradually', 'Accumulate'];
  let li = !isNum(R.comp) ? -1 : R.comp >= 68 ? 3 : R.comp >= 55 ? 2 : R.comp >= 42 ? 1 : 0; const adj = [];
  if (li > 0 && isNum(R.mos) && R.mos < -0.5) { li--; adj.push(`price is ${Math.round(-R.mos * 100)}% above the base fair value → one notch down`); }
  if (li > 0 && R.flags >= 4) { li--; adj.push(`${R.flags} red flags → one notch down`); }
  if (li > 1 && isNum(R.risk.score) && R.risk.score >= 70) { li--; adj.push('high risk score → one notch down'); }
  R.verdict = li < 0 ? 'Insufficient data' : lv[li]; R.vcol = ['#fee2e2', '#fef9c3', '#ecfccb', '#dcfce7'][li] || '#e2e8f0'; R.adj = adj;
  R.styles = [['Value (Graham)', R.graham.score], ['Quality compounder (Buffett)', R.buffett.score], ['Long-term growth (Fisher)', R.fisher.score], ['GARP (Lynch)', R.lynch.score], ['Momentum growth (CANSLIM)', R.cans && R.cans.score]].filter(x => isNum(x[1])).sort((a, b) => b[1] - a[1]);
  R.dividendFit = isNum(k.dy) && k.dy >= 0.025 && R.divYears >= 4;
  const spe = R.S && isNum(R.S.pe) ? R.S.pe : undefined;
  const defG = isNum(R.g) ? Math.max(0, Math.min(25, +(R.g * 100).toFixed(1))) : isNum(k.revCAGR) ? Math.max(0, Math.min(25, +(k.revCAGR * 100).toFixed(1))) : undefined;
  const defPE = isNum(pe) && pe > 0 ? +(isNum(spe) ? Math.min(pe, Math.max(spe, pe * 0.8)) : pe).toFixed(1) : undefined;
  R.cdef = { g: defG, pe: defPE, y: 5, dy: isNum(k.dy) ? +(k.dy * 100).toFixed(2) : 0 };
  return R;
}
function redFlagCount(d, k) { try { return (redFlagsSection(d, k).match(/<li class="flag">/g) || []).length; } catch (e) { return 0; } }

let CAGRA = {};
function cagrCalc(d, k, R) {
  const a = CAGRA[d.symbol] = Object.assign({}, R.cdef, CAGRA[d.symbol] || {}), pe = k.loss ? undefined : k.pe, P = d.price;
  if (!(isNum(k.eps) && k.eps > 0 && isNum(pe) && isNum(a.g) && isNum(a.pe) && a.pe > 0 && a.y > 0)) return { a };
  const epsF = k.eps * Math.pow(1 + a.g / 100, a.y), pF = epsF * a.pe, price = Math.pow(pF / P, 1 / a.y) - 1, rer = Math.pow(a.pe / pe, 1 / a.y) - 1;
  return { a, epsF, pF, price, rer, tot: price + a.dy / 100 };
}
function cagrBody(d, k, R) {
  const X = cagrCalc(d, k, R), a = X.a, c = d.currency, inp = (key, l, st) => `<label>${l}<input type="number" step="${st || 0.5}" data-cg="${key}" value="${isNum(a[key]) ? a[key] : ''}"></label>`;
  return `<div class="ivin">${inp('g', 'EPS growth %/yr')}${inp('pe', 'Exit P/E')}${inp('y', 'Years', 1)}${inp('dy', 'Dividend yield %', 0.1)}<button class="btn sec" id="cgReset">Reset</button></div>
  ${isNum(X.tot) ? `<div class="kv"><div><span>Expected total return (CAGR)</span><b class="${X.tot >= 0 ? 'up' : 'dn'}">${sgnPct(X.tot)}/yr</b></div><div><span>from earnings growth</span><b>${sgnPct(a.g / 100)}</b></div><div><span>from re-rating (P/E ${k.pe.toFixed(1)} → ${a.pe})</span><b>${sgnPct(X.rer)}</b></div><div><span>from dividends</span><b>${sgnPct(a.dy / 100)}</b></div><div><span>Implied price in ${a.y} years</span><b>${fmtP(X.pF, c)}</b></div><div><span>Implied EPS in ${a.y} years</span><b>${fmtP(X.epsF, c)}</b></div></div>`
  : `<p>${NA} — needs positive EPS, a P/E and a growth assumption (enter one above).</p>`}
  ${how(`Future EPS = EPS (TTM ${fmtP(k.eps, c)}) × (1 + growth)^years. Future price = future EPS × exit P/E. Price CAGR = (future price ÷ today's price)^(1/years) − 1; total ≈ price CAGR + dividend yield. Defaults: growth = ${R.gSrc || 'revenue CAGR'} capped at 0–25%; exit P/E = current P/E pulled toward the sector median${R.S && isNum(R.S.pe) ? ' (' + R.S.pe.toFixed(1) + ')' : ''} but not below 80% of today's; dividend yield = current. Assumptions, not forecasts — edit them.`)}`;
}
function bindReport(d, k, R) {
  const box = $('#cgBody');
  if (box) { box.oninput = e => { const t = e.target; if (!t.dataset.cg) return; const v = parseFloat(t.value); if (!isFinite(v)) return; CAGRA[d.symbol][t.dataset.cg] = v; const key = t.dataset.cg; box.innerHTML = cagrBody(d, k, R); box.querySelector(`[data-cg="${key}"]`).focus(); };
    box.onclick = e => { if (e.target.id === 'cgReset') { delete CAGRA[d.symbol]; box.innerHTML = cagrBody(d, k, R); } }; }
  const pdf = $('#pdfBtn'); if (pdf) pdf.onclick = () => downloadPDF(d);
  const ea = $('#expAll'); if (ea) ea.onclick = e => { e.preventDefault(); const all = [...document.querySelectorAll('#view details.rpt')], open = all.some(x => !x.open); all.forEach(x => x.open = open); ea.textContent = open ? 'Collapse all' : 'Expand all'; };
}
function scenarios(d, k, R) {
  const P = d.price, vol = R.T.vol, X = cagrCalc(d, k, R);
  const g = isNum(X.a && X.a.g) ? X.a.g / 100 : isNum(k.revCAGR) ? k.revCAGR : undefined;
  if (!isNum(vol) || !isNum(g)) return null;
  const dy = k.dy || 0, pull = R.fv ? Math.max(-0.15, Math.min(0.15, (R.fv.base / P - 1) / 3)) : 0;
  const baseR = Math.max(-0.25, Math.min(0.35, g + dy + pull)), sd = Math.max(0.12, vol);
  const sc = { bear: P * Math.max(0.2, 1 + baseR - sd), base: P * (1 + baseR), bull: P * (1 + baseR + sd) };
  let pb = 25, pu = 25; const why = [], sh = (b, u, t) => { pb += b; pu += u; why.push(t); };
  if (isNum(R.comp)) { if (R.comp >= 65) sh(-5, 5, `composite ${Math.round(R.comp)} ≥ 65: bull +5, bear −5`); else if (R.comp < 45) sh(5, -5, `composite ${Math.round(R.comp)} < 45: bear +5, bull −5`); }
  if (isNum(R.T.d200)) { if (P > R.T.d200) sh(-3, 3, 'price above 200-DMA: bull +3, bear −3'); else sh(3, -3, 'price below 200-DMA: bear +3, bull −3'); }
  if (isNum(R.mos)) { if (R.mos > 0.2) sh(-4, 4, 'margin of safety > 20%: bull +4, bear −4'); else if (R.mos < -0.3) sh(4, -4, 'price > 30% above fair value: bear +4, bull −4'); }
  if (R.flags >= 3) sh(4, -2, `${R.flags} red flags: bear +4, bull −2`);
  if (isNum(R.risk.score) && R.risk.score >= 65) sh(3, 0, 'high risk score: bear +3');
  pb = Math.max(10, Math.min(45, pb)); pu = Math.max(10, Math.min(45, pu));
  const pbase = 100 - pb - pu, ev = (sc.bear * pb + sc.base * pbase + sc.bull * pu) / 100;
  return { sc, p: { bear: pb, base: pbase, bull: pu }, ev, baseR, sd, g, dy, pull, why };
}
function confidence(d, k, R) {
  const pr = d.profile || {}, F = [['P/E', k.loss ? 0 : k.pe], ['P/B', k.pb], ['EPS', k.eps], ['ROE', k.roe], ['ROCE', R.fin ? 0 : k.roce], ['Debt/equity', R.fin ? 0 : k.de], ['Revenue CAGR', k.revCAGR], ['Profit CAGR', k.niCAGR], ['Latest-quarter growth', k.lqRevYoY], ['Free cash flow', R.fin ? 0 : R.fcf], ['Current ratio', R.fin ? 0 : R.cr], ['Interest coverage', R.fin ? 0 : R.icov], ['200-DMA', R.T.d200], ['Volatility', R.T.vol], ['Beta', R.T.beta], ['Fair value', R.fv && R.fv.base], ['Analyst data', d.analyst ? 1 : undefined], ['News', d.news ? 1 : undefined], ['CANSLIM', d.canslim ? 1 : undefined], ['Sector medians', R.S ? 1 : undefined], ['Business description', pr.summary ? 1 : undefined], ['Next results date', (pr.earnDates || []).length ? 1 : undefined]];
  const missing = F.filter(x => !isNum(x[1])).map(x => x[0]), comp = 1 - missing.length / F.length;
  const sc = R.parts.map(p => p[1]).filter(isNum), agree = isNum(R.comp) && sc.length >= 3 ? sc.filter(s => (s >= 50) === (R.comp >= 50)).length / sc.length : undefined;
  const level = comp >= 0.85 && agree >= 0.7 ? 'High' : comp < 0.6 || !isNum(agree) || agree < 0.5 ? 'Low' : 'Medium';
  const why = `${(comp * 100).toFixed(0)}% of the key fields are available${missing.length ? ` (missing: ${missing.join(', ')})` : ''}; ${isNum(agree) ? `${Math.round(agree * sc.length)} of ${sc.length} scoring components point the same way as the composite` : 'too few components to judge agreement'}. ${level === 'High' ? 'The signals are well supported and mostly agree.' : level === 'Low' ? 'Treat the verdict with extra caution.' : 'Some data gaps or disagreement — read the conflicts section.'}`;
  return { level, comp, agree, missing, why, n: F.length };
}

function reportSections(d, k, A) {
  const R = buildReport(d, k, A), c = d.currency, P = d.price, f = d.fund || {}, pr = d.profile || {}, name = esc(d.name), base = esc(d.symbol.replace(/\.(NS|BO)$/, ''));
  d._R = R; const T = R.T, S = R.S, sc = scenarios(d, k, R), X = cagrCalc(d, k, R), out = [];
  const sv = s => isNum(s) ? Math.round(s) + '/100' : 'n/a';
  // 1 Executive summary
  const pros = A.pros.slice(), cons = A.cons.slice();
  if (isNum(R.mos) && R.mos > 0.2) pros.push(`Trades ${Math.round(R.mos * 100)}% below the median of ${R.fv.n} intrinsic-value estimates.`);
  if (isNum(R.mos) && R.mos < -0.3) cons.push(`Trades ${Math.round(-R.mos * 100)}% above the median intrinsic-value estimate (${fmtP(R.fv.base, c)}).`);
  if (isNum(R.buffett.score) && R.buffett.score >= 70) pros.push(`High Buffett-style quality score (${sv(R.buffett.score)}): consistent returns and cash generation.`);
  if (R.fcfAllPos === true && !R.fin) pros.push('Generated positive free cash flow in every available year.');
  if (R.fcfAllPos === false && !R.fin) cons.push('Free cash flow was negative in at least one recent year.');
  if (isNum(R.icov) && R.icov < 3) cons.push(`Thin interest coverage (${R.icov.toFixed(1)}×).`);
  if (isNum(T.vol) && T.vol > 0.45) cons.push(`Very volatile (${pct1(T.vol)} annualised).`);
  if (R.flags >= 3) cons.push(`${R.flags} red flags raised by the automated checks (section 15).`);
  if (isNum(R.peg) && R.peg <= 1 && !k.loss) pros.push(`PEG ${R.peg.toFixed(2)} — growth looks reasonably priced (Lynch).`);
  const conf = confidence(d, k, R);
  const exec = `${name} (${base}${d.industry ? ', ' + esc(d.industry) : d.sector ? ', ' + esc(d.sector) : ''}) trades at ${fmtP(P, c)}${isNum(k.ret1y) ? `, ${k.ret1y >= 0 ? 'up' : 'down'} ${Math.abs(k.ret1y * 100).toFixed(0)}% over one year` : ''}${isNum(k.mcap) ? `, with a market cap of ${fmtBig(k.mcap, c)}` : ''}. ${k.loss ? 'It is loss-making on a trailing basis.' : isNum(k.pe) ? `It is valued at ${k.pe.toFixed(1)}× trailing earnings${S && isNum(S.pe) ? ` versus a sector median of ${S.pe.toFixed(1)}×` : ''}.` : 'P/E is not available.'} ${isNum(k.revCAGR) ? `Revenue has grown about ${(k.revCAGR * 100).toFixed(0)}% a year over ~${k.cagrYears} years` : 'Multi-year revenue growth is not available'}${isNum(k.roe) ? ` and return on equity is ${(k.roe * 100).toFixed(0)}%` : ''}${R.fin ? '' : isNum(k.de) ? `, with debt/equity of ${k.de.toFixed(2)}` : ''}. On the rule-based scores it rates ${sv(R.buffett.score)} for quality, ${sv(R.graham.score)} for Graham value, ${sv(R.fisher.score)} for growth, ${sv(R.lynch.score)} for GARP, ${R.cans ? sv(R.cans.score) : 'n/a'} on CANSLIM and ${sv(R.tech.score)} on technicals, for a composite of <b>${sv(R.comp)}</b> → <b>${R.verdict}</b>. ${R.fv ? `The intrinsic-value methods give a base fair value of about ${fmtP(R.fv.base, c)} (range ${fmtP(R.fv.low, c)}–${fmtP(R.fv.high, c)}), a margin of safety of ${Math.round(R.mos * 100)}%.` : 'Fair value could not be estimated.'} ${pros.length ? 'Main positive: ' + strip(pros[0]) : ''} ${cons.length ? 'Main concern: ' + strip(cons[0]) : ''} Confidence in this read: <b>${conf.level}</b>.`;
  out.push(RSEC(1, 'r-exec', '🧾 Executive summary', `<div class="verdict" style="background:${R.vcol}">${R.verdict}${isNum(R.comp) ? ` — composite ${Math.round(R.comp)}/100` : ''}</div><p>${exec}</p><button class="btn" id="pdfBtn">⬇ Download PDF report</button><p class="mut" style="font-size:12px">Generated automatically from data; educational, not personal investment advice.</p>`, true));
  // 2 Investment analysis
  const scoreRow = (n, s) => `<div class="score"><span class="l">${n}</span><span class="bar"><i style="width:${isNum(s) ? s * 10 : 0}%;background:${!isNum(s) ? '#cbd5e1' : s >= 7 ? '#16a34a' : s >= 4.5 ? '#eab308' : '#dc2626'}"></i></span><span class="v">${isNum(s) ? s.toFixed(1) + '/10' : '<span class="mut">n/a</span>'}</span></div>`;
  const omL = last(R.omS), om0 = R.omS[0];
  out.push(RSEC(2, 'r-analysis', '🔎 Investment analysis', `
   <h3>Business</h3><p>${pr.summary ? esc(pr.summary) + (pr.summary.length >= 690 ? '…' : '') : NA + ' — business description not available from the source yet.'}</p>
   <p class="mut">${esc(d.sector || 'sector n/a')} · ${esc(d.industry || 'industry n/a')}${pr.employees ? ' · ' + Number(pr.employees).toLocaleString('en-IN') + ' employees' : ''} · Market cap ${fmtBig(k.mcap, c)}</p>
   <h3>Growth</h3><p>${isNum(k.revCAGR) ? `Revenue CAGR ${pct1(k.revCAGR)} and net-profit CAGR ${pct1(k.niCAGR)} over ~${k.cagrYears} years.` : 'Multi-year growth not available.'} ${isNum(k.revGrowthFY) ? `Last fiscal year: revenue ${sgnPct(k.revGrowthFY)}, profit ${sgnPct(k.niGrowthFY)}.` : ''} ${k.lqDate ? `Latest quarter (${qlabel(k.lqDate)}): revenue ${sgnPct(k.lqRevYoY)} YoY, profit ${sgnPct(k.lqNiYoY)} YoY.` : ''}</p>
   <h3>Profitability</h3><p>ROE ${pct1(k.roe)}${R.fin ? '' : `, ROCE ${pct1(k.roce)}`}, net margin ${pct1(isNum(k.npmFY) ? k.npmFY : k.npm)}${omL ? `, operating margin ${pct1(omL[1])}${om0 && om0 !== omL ? ` (FY${om0[0].slice(0, 4)}: ${pct1(om0[1])})` : ''}` : ''}.${R.roeS.length > 1 ? ` ROE by year: ${R.roeS.map(x => 'FY' + x[0].slice(0, 4) + ' ' + (x[1] * 100).toFixed(0) + '%').join(', ')}.` : ''}</p>
   <h3>Balance sheet</h3><p>${R.fin ? 'Bank/financial: leverage is structural; judge asset quality (NPAs), capital adequacy and deposit franchise from filings (not available here).' : `Debt/equity ${k.negEquity ? 'negative equity' : nn(k.de, 2)}, current ratio ${nn(R.cr, 2)}, interest coverage ${isNum(R.icov) ? R.icov.toFixed(1) + '×' : 'n/a'}.`} ${isNum(R.netCash) ? `Cash ${fmtBig(pr.cash, c)} vs debt ${fmtBig(pr.debt, c)} → net ${R.netCash >= 0 ? 'cash' : 'debt'} ${fmtBig(Math.abs(R.netCash), c)}.` : ''} ${!R.fin && isNum(R.ocfNi) ? `Operating cash flow was ${(R.ocfNi * 100).toFixed(0)}% of reported profit over the last 3 years.` : ''}</p>
   <h3>Pillar scores</h3>${Object.entries(A.S).map(([n, s]) => scoreRow(n, s)).join('')}${A.style ? `<p><b>Profile:</b> ${esc(A.style)}</p>` : ''}
   ${how('Each pillar is scored 0–10. <b>Valuation</b>: P/E (≈10 → high, ≈60 → low), P/B, dividend yield. <b>Growth</b>: multi-year revenue & profit CAGR (or last FY) and latest-quarter YoY. <b>Profitability</b>: ROE, ROCE (non-financials), net margin. <b>Balance sheet</b>: debt/equity (not for banks). <b>Momentum</b>: price vs 50/200-DMA, RSI, 1-year return. Overall = average of available pillars (needs ≥ 3).')}`, true));
  out.push(RSEC(3, 'r-pos', `✅ Key positives <span class="mut">(${pros.length})</span>`, `<ul class="pros">${pros.map(x => `<li>${x}</li>`).join('') || '<li class="mut">None flagged by the rules.</li>'}</ul>`));
  out.push(RSEC(4, 'r-neg', `⚠️ Key negatives <span class="mut">(${cons.length})</span>`, `<ul class="cons">${cons.map(x => `<li>${x}</li>`).join('') || '<li class="mut">None flagged by the rules.</li>'}</ul>`));
  out.push(RSEC(5, 'r-cs', `📊 CANSLIM score <span class="mut">(${R.cans ? sv(R.cans.score) : 'n/a'})</span>`, R.cans ? scoreHTML(R.cans, `William O'Neil's growth checklist, weighted C 20 · A 20 · N 10 · S 10 · L 15 · I 10 · M 15 (${d.canslim.score}/${d.canslim.of} letters pass).`, strip(inner(canslimSection(d)).split('<p class="src">')[1] || '')) : `<p>${NA} — CANSLIM is computed only for stocks in the built-in list.</p>`));
  out.push(RSEC(6, 'r-graham', `🛡️ Graham safety-first value score <span class="mut">(${sv(R.graham.score)})</span>`, scoreHTML(R.graham, 'Benjamin Graham\'s defensive-investor criteria (The Intelligent Investor), 8 equal-weight tests.', 'Free data covers ~4 fiscal years and ~5 years of dividends, so Graham\'s 10/20-year history tests are approximated over the available period.')));
  out.push(RSEC(7, 'r-buffett', `🏰 Buffett durability & quality score <span class="mut">(${sv(R.buffett.score)})</span>`, scoreHTML(R.buffett, 'Durable, high-return businesses with little debt that turn profits into cash.', 'A moat is not directly observable; high, stable margins and returns are used as proxies.') + (typeof moatCalc === 'function' ? (M => `<p><b>Moat estimate: ${M.rating}</b>${M.ev ? ` (${M.ps}/${M.ev} rule checks)` : ''} · likely source: ${M.src.map(esc).join(', ')}. <a href="#" data-jump="s-moat">Factor details</a></p>`)(moatCalc(d, k)) : '')));
  out.push(RSEC(8, 'r-fisher', `🌱 Fisher long-term growth quality <span class="mut">(${sv(R.fisher.score)})</span>`, scoreHTML(R.fisher, 'Philip Fisher looked for sustained sales growth, improving margins, research effort and the ability to reinvest.', 'Qualitative "scuttlebutt" points (management depth, sales organisation, labour relations) cannot be measured from data — read concalls and annual reports.')));
  out.push(RSEC(9, 'r-lynch', `🎯 Lynch GARP score <span class="mut">(${sv(R.lynch.score)})</span>`, `<div class="verdict" style="background:#e0f2fe">Lynch category: <b>${R.lcat}</b>${gq('lynch')} <span class="mut" style="font-weight:400">— ${R.lcatWhy}</span></div>` + scoreHTML(R.lynch, '', `PEG = P/E ÷ (EPS growth % + dividend yield %), growth = ${R.gSrc || 'n/a'}. Category: turnaround if profit swung from loss; asset play if P/B < 1; cyclical by sector/industry; otherwise by growth rate.`)));
  // 10 Technicals
  const lvl = a => a.length ? a.map(x => `${fmtP(x[1], c)} <small class="mut">(${dstr(x[2])})</small>`).join(', ') : '<span class="mut">none in last ~13 months</span>';
  const trend = isNum(T.d200) && isNum(T.d50) ? (P > T.d50 && T.d50 > T.d200 ? 'Uptrend' : P < T.d50 && T.d50 < T.d200 ? 'Downtrend' : 'Sideways / mixed') : 'n/a';
  out.push(RSEC(10, 'r-tech', `📈 Technicals <span class="mut">(${sv(R.tech.score)} · ${trend})</span>`, `<div class="kv">
   <div><span>20 / 50 / 200 DMA</span><b>${fmtP(T.d20, c)} / ${fmtP(T.d50, c)} / ${fmtP(T.d200, c)}</b></div><div><span>RSI (14)</span><b>${nn(T.rsi, 0)}</b></div>
   <div><span>MACD (12,26,9)</span><b>${isNum(T.macd) ? `${T.macd.toFixed(2)} vs signal ${T.sig.toFixed(2)} ${T.hist > 0 ? '<span class="up">▲</span>' : '<span class="dn">▼</span>'}` : NA}</b></div>
   <div><span>Support (swing lows)</span><b>${lvl(T.sup)}</b></div><div><span>Resistance (swing highs)</span><b>${lvl(T.res)}</b></div>
   <div><span>From 52-wk high</span><b>${isNum(T.fromHi) ? sgnPct(T.fromHi) : NA}</b></div>
   <div><span>Volume: last vs 50-day avg</span><b>${isNum(T.volRatio) ? T.volRatio.toFixed(2) + '×' : NA}</b></div><div><span>Up/down volume ratio (50d)</span><b>${nn(T.udr, 2)}</b></div>
   ${k.cross ? `<div><span>${k.cross === 'golden' ? 'Golden cross' : 'Death cross'}</span><b>${dstr(k.crossT)}</b></div>` : ''}</div>
   ${scoreHTML(R.tech, '', 'Support/resistance = the two nearest swing lows below / swing highs above the price; a swing point is the lowest/highest close within ±5 sessions, over ~13 months of daily closes. MACD = EMA12 − EMA26; signal = EMA9 of MACD. Volume from the last 50 sessions.')}`));
  // 11 Valuation
  const hs = a => a.length >= 3 ? { min: Math.min(...a.map(x => x[1])), med: median(a.map(x => x[1])), max: Math.max(...a.map(x => x[1])), from: a[0][0] } : null, ph = hs(R.peHist), bh = hs(R.pbHist);
  const vrow = (l, cur, h, sm) => `<tr><td>${l}</td><td>${cur}</td><td>${h || '<span class="mut">n/a</span>'}</td><td>${sm === undefined ? '<span class="mut">n/a</span>' : sm}</td></tr>`;
  out.push(RSEC(11, 'r-val', '⚖️ Valuation', `<div class="tw"><table><tr><th>Multiple</th><th>Now</th><th>Own history (min / median / max)</th><th>Sector median</th></tr>
   ${vrow('P/E', k.loss ? 'loss' : nn(k.pe), ph ? `${ph.min.toFixed(1)} / ${ph.med.toFixed(1)} / ${ph.max.toFixed(1)} <small class="mut">since ${ph.from.slice(0, 7)}</small>` : '', S && isNum(S.pe) ? S.pe.toFixed(1) : undefined)}
   ${vrow('P/B', nn(k.pb, 2), bh ? `${bh.min.toFixed(2)} / ${bh.med.toFixed(2)} / ${bh.max.toFixed(2)}` : '', S && isNum(S.pb) ? S.pb.toFixed(2) : undefined)}
   ${vrow('EV / EBIT', R.fin ? 'n/m' : nn(R.evEbit))}${vrow('P/S', nn(R.ps, 2))}${vrow('FCF yield', R.fin ? 'n/m' : pct1(R.fcfy))}${vrow('Dividend yield', pct1(k.dy))}${vrow('PEG', nn(R.peg, 2))}</table></div>
   <p>${ph && isNum(k.pe) && !k.loss ? `P/E is ${k.pe > ph.med * 1.15 ? 'above' : k.pe < ph.med * 0.85 ? 'below' : 'close to'} its own median (${ph.med.toFixed(1)}) in the available history${S && isNum(S.pe) ? ` and ${k.pe > S.pe * 1.15 ? 'above' : k.pe < S.pe * 0.85 ? 'below' : 'close to'} the sector median` : ''}.` : ''}</p>
   ${how('Own history uses the source\'s trailing P/E and P/B snapshots (about 10 quarterly points, so "history" is short). EV = market cap + total debt − cash. FCF yield = latest FY free cash flow ÷ market cap. Sector medians are across this app\'s stock universe.')}
   <h3>Sector context</h3>${inner(sectorSection(d, k))}`));
  out.push(RSEC(12, 'r-peers', '👥 Peer comparison', inner(peersSection(d))));
  return { R, sc, X, conf, out, T, S };
}

function fullReport(d, k, A) {
  const Z = reportSections(d, k, A), { R, sc, X, conf, out, T, S } = Z, c = d.currency, P = d.price, f = d.fund || {}, pr = d.profile || {};
  const sv = s => isNum(s) ? Math.round(s) + '/100' : 'n/a';
  out.push(RSEC(13, 'r-risk', `🌪️ Risk analysis <span class="mut">(risk ${sv(R.risk.score)}, higher = riskier)</span>`, scoreHTML(R.risk, `1-year max drawdown: ${isNum(T.mdd1) ? pct1(T.mdd1) : 'n/a'}. A higher score means <b>more</b> risk.`, 'Segment, customer and geographic concentration are not available from the free data source.')));
  // 14 Catalysts
  const it = d.news && d.news.items || [], cat = it.filter(x => x.g.includes('ord') || x.g.includes('plan')).slice(0, 8), ed = (pr.earnDates || []).filter(x => x > Date.now() / 1000 - 3 * DAY);
  out.push(RSEC(14, 'r-cat', '🚀 Catalysts', `<ul>${ed.length ? `<li>📅 Next results date (Yahoo): <b>${ed.map(x => dstr(x)).join(' – ')}</b></li>` : '<li class="mut">Next results date: not available.</li>'}${pr.exDiv && pr.exDiv > Date.now() / 1000 ? `<li>💸 Ex-dividend date: <b>${dstr(pr.exDiv)}</b></li>` : ''}${k.cross === 'golden' ? `<li>📈 Golden cross on ${dstr(k.crossT)}</li>` : ''}
   ${cat.map(x => `<li>${x.g.includes('ord') ? '📦' : '🚀'} <a href="${esc(safeUrl(x.u))}" target="_blank" rel="noopener">${esc(x.t)}</a> <small class="mut">${esc(x.s)} · ${dstr(x.d)}</small></li>`).join('') || '<li class="mut">No order/plan headlines tagged in the last 90 days.</li>'}</ul>
   <p class="mut" style="font-size:12px">Headline tags are automated and unverified — confirm in exchange filings.</p>
   <details><summary class="mut">All tagged news (plans, orders & negative)</summary>${inner(newsSection(d))}</details>`));
  // 15 Red flags extended
  const extra = [], ex = (st, t, why) => extra.push(`<li class="${st}">${st === 'flag' ? '🚩' : '⚠️'} <b>${t}</b> — ${why}</li>`);
  if (!R.fin && isNum(R.cr) && R.cr < 1) ex('flag', 'Current ratio below 1', `${R.cr.toFixed(2)} — short-term liabilities exceed short-term assets`);
  if (isNum(T.vol) && T.vol > 0.45) ex('flag', 'High volatility', `${pct1(T.vol)} annualised (flag if > 45%)`);
  if (isNum(T.mdd1) && T.mdd1 < -0.35) ex('flag', 'Deep 1-year drawdown', `${pct1(T.mdd1)} (flag if worse than −35%)`);
  if (isNum(T.d200) && P < T.d200 * 0.85) ex('flag', 'Far below 200-DMA', `${sgnPct(P / T.d200 - 1)} (flag if > 15% below)`);
  if (!k.loss && isNum(k.pe) && S && isNum(S.pe) && k.pe > 2 * S.pe) ex('flag', 'Valuation stretched vs sector', `P/E ${k.pe.toFixed(1)} > 2× sector median ${S.pe.toFixed(1)}`);
  if (isNum(T.beta) && T.beta > 1.5) ex('flag', 'High beta', T.beta.toFixed(2) + ' (flag if > 1.5)');
  if (ed.length && ed[0] - Date.now() / 1000 < 14 * DAY) ex('warn', 'Results due soon', `${dstr(ed[0])} — event risk: the price can gap either way`);
  A.watch.forEach(w => ex('warn', 'Watch', w));
  const nfl = R.flags + extra.filter(x => x.includes('class="flag"')).length;
  out.push(RSEC(15, 'r-flags', `🚩 Red flags & warnings <span class="mut">(${nfl} flagged)</span>`, inner(redFlagsSection(d, k)).replace('</ul>', extra.join('') + '</ul>')));
  out.push(RSEC(16, 'r-cagr', `📐 Expected CAGR (3–5 years) <span class="mut">(${isNum(X.tot) ? sgnPct(X.tot) + '/yr' : 'n/a'})</span>`, `<div id="cgBody">${cagrBody(d, k, R)}</div><p class="disc">Model arithmetic on editable assumptions — not a forecast or promise of returns.</p>`));
  out.push(RSEC(17, 'r-fv', `💰 Fair value range <span class="mut">(${R.fv ? fmtP(R.fv.low, c) + ' – ' + fmtP(R.fv.high, c) : 'n/a'})</span>`, `${R.fv ? `<div class="kv"><div><span>Low (25th percentile)</span><b>${fmtP(R.fv.low, c)}</b></div><div><span>Base (median)</span><b>${fmtP(R.fv.base, c)}</b></div><div><span>High (75th percentile)</span><b>${fmtP(R.fv.high, c)}</b></div><div><span>Price</span><b>${fmtP(P, c)}</b></div><div><span>Margin of safety vs base</span><b class="${R.mos >= 0 ? 'up' : 'dn'}">${Math.round(R.mos * 100)}%</b></div></div>` : `<p>${NA}</p>`}
   ${how(`Low/base/high = 25th/50th/75th percentile of the ${R.fv ? R.fv.n : 0} intrinsic-value methods below that produced a positive value (quartiles damp outliers). Edit the assumptions in the methods table to see the effect (the range above refreshes on next render).`)}
   <h3>Methods (intrinsic value)</h3><div id="ivBody">${ivBody(d, k)}</div>`));
  const strt = analystCard(d).replace(/^<div class="card"><h2>[^<]*<\/h2>/, '<div>');
  out.push(RSEC(18, 'r-scen', '🎲 12-month target scenarios & probabilities', sc ? `<p class="disc" style="margin-top:0">⚠️ <b>Model-generated estimates</b>, not predictions or price targets — rule-based arithmetic from growth, valuation gap and historical volatility.</p>
   <div class="scen">${['bear', 'base', 'bull'].map(x => `<div class="sc ${x}"><b>${x[0].toUpperCase() + x.slice(1)}</b><span class="px2">${fmtP(sc.sc[x], c)}</span><span>${sgnPct(sc.sc[x] / P - 1)}</span><span class="pp">${sc.p[x]}% probability</span></div>`).join('')}</div>
   <p>Probability-weighted value: <b>${fmtP(sc.ev, c)}</b> (${sgnPct(sc.ev / P - 1)}).</p>
   ${how(`Base return = expected EPS growth ${sgnPct(sc.g)} + dividend yield ${sgnPct(sc.dy)} + ⅓ of the gap to base fair value (capped ±15%: ${sgnPct(sc.pull)}) = ${sgnPct(sc.baseR)} (capped −25%…+35%). Bear / bull = base ∓ one standard deviation of annual returns (volatility ${pct1(T.vol)}, minimum 12%). Probabilities start at 25 / 50 / 25 and shift by rules: ${sc.why.join('; ') || 'no adjustments'}; each tail capped at 10–45%.`)}
   <h3>Street view (analysts)</h3>${strt}` : `<p>${NA} — needs volatility and a growth estimate.</p><h3>Street view (analysts)</h3>${strt}`, true));
  out.push(RSEC(19, 'r-rec', '🧭 Final recommendation & style fit', `<div class="verdict" style="background:${R.vcol}">${R.verdict}${isNum(R.comp) ? ` <span style="font-weight:400">(composite ${Math.round(R.comp)}/100)</span>` : ''}</div>
   <div class="tw"><table><tr><th>Component</th><th>Score</th><th>Weight</th></tr>${R.parts.map(p => `<tr><td>${p[0]}</td><td>${sv(p[1])}</td><td>${p[2]}</td></tr>`).join('')}</table></div>
   ${R.adj.length ? `<p><b>Adjustments:</b> ${R.adj.join('; ')}.</p>` : ''}
   <p><b>Best style fit:</b> ${R.styles.length ? R.styles.slice(0, 2).map(x => `${x[0]} (${Math.round(x[1])})`).join(', ') : 'n/a'}${R.dividendFit ? '; also suits <b>income/dividend</b> investors' : ''}. Lynch category: ${R.lcat}.${R.styles.length && last(R.styles)[1] < 40 ? ` Poor fit for ${last(R.styles)[0]} investors.` : ''}</p>
   ${how('Composite = weighted average of available components (needs ≥ 50% of weight). Verdict: ≥ 68 Accumulate · 55–68 Accumulate gradually · 42–55 Hold / watch · < 42 Avoid for now; then one notch down if price is > 50% above base fair value, ≥ 4 red flags, or risk score ≥ 70.')}
   <div class="disc"><b>Educational, not personal investment advice.</b> This verdict is produced by fixed rules on public data that may be delayed, incomplete or wrong; it does not know your goals, risk tolerance, time horizon or taxes. Verify with company filings (NSE/BSE/SEC) and consult a SEBI-registered investment adviser before investing.</div>`, true));
  // 20 Checklist
  const ck = [], C = (t, ok, v) => ck.push([t, ok, v]);
  C('Profitable (TTM)', k.loss ? false : isNum(k.eps) ? k.eps > 0 : undefined, isNum(k.eps) ? fmtP(k.eps, c) : undefined);
  C('ROE ≥ 15%', isNum(k.roe) ? k.roe >= 0.15 : undefined, isNum(k.roe) ? pct1(k.roe) : undefined);
  C('Debt/equity ≤ 1', R.fin ? 'na' : k.negEquity ? false : isNum(k.de) ? k.de <= 1 : undefined, R.fin ? 'n/m' : isNum(k.de) ? k.de.toFixed(2) : undefined);
  C('Interest coverage ≥ 3×', R.fin ? 'na' : isNum(R.icov) ? R.icov >= 3 : undefined, R.fin ? 'n/m' : isNum(R.icov) ? R.icov.toFixed(1) + '×' : undefined);
  C('Positive free cash flow (latest FY)', R.fin ? 'na' : isNum(R.fcf) ? R.fcf > 0 : undefined, R.fin ? 'n/m' : isNum(R.fcf) ? fmtBig(R.fcf, c) : undefined);
  C('Cash flow backs profits (OCF ≥ 80% of profit, 3y)', R.fin ? 'na' : isNum(R.ocfNi) ? R.ocfNi >= 0.8 : undefined, R.fin ? 'n/m' : isNum(R.ocfNi) ? (R.ocfNi * 100).toFixed(0) + '%' : undefined);
  C('Revenue grew last FY', isNum(k.revGrowthFY) ? k.revGrowthFY > 0 : undefined, isNum(k.revGrowthFY) ? sgnPct(k.revGrowthFY) : undefined);
  C('Profit grew last FY', isNum(k.niGrowthFY) ? k.niGrowthFY > 0 : undefined, isNum(k.niGrowthFY) ? sgnPct(k.niGrowthFY) : undefined);
  C('P/E ≤ sector median', k.loss ? false : isNum(k.pe) && S && isNum(S.pe) ? k.pe <= S.pe : undefined, isNum(k.pe) && S && isNum(S.pe) ? `${k.pe.toFixed(1)} vs ${S.pe.toFixed(1)}` : undefined);
  C('Price ≤ base fair value', isNum(R.mos) ? R.mos >= 0 : undefined, R.fv ? `${fmtP(P, c)} vs ${fmtP(R.fv.base, c)}` : undefined);
  C('Price above 200-DMA', isNum(T.d200) ? P > T.d200 : undefined, isNum(T.d200) ? fmtP(T.d200, c) : undefined);
  C('≤ 2 red flags (core checks)', R.flags <= 2, String(R.flags));
  C('Pays a dividend', d.divs ? R.dps > 0 : undefined, isNum(k.dy) ? pct1(k.dy) : undefined);
  const pass = ck.filter(x => x[1] === true).length, tested = ck.filter(x => x[1] === true || x[1] === false).length;
  out.push(RSEC(20, 'r-check', `☑️ Investment checklist <span class="mut">(${pass}/${tested} pass)</span>`, `<ul class="flags">${ck.map(([t, ok, v]) => `<li class="${ok === true ? 'ok' : ok === false ? 'flag' : 'na'}">${ok === true ? '✅' : ok === false ? '❌' : '▫️'} <b>${t}</b> — ${v === undefined ? 'not available' : v}${ok === 'na' ? ' (not applicable)' : ''}</li>`).join('')}</ul>`));
  // 21 Monitoring
  const qo = (f.quarterlyOperatingIncome || []).slice(-1)[0], qr = qo && (f.quarterlyTotalRevenue || []).find(x => x[0] === qo[0]), qom = qr && qr[1] ? qo[1] / qr[1] : undefined, NAs = '<span class="mut">n/a</span>';
  const mon = [['Revenue growth YoY (latest qtr)', sgnPct(k.lqRevYoY), 'Stays positive; compare with management guidance'], ['Net profit growth YoY (latest qtr)', sgnPct(k.lqNiYoY), 'Grows at least in line with revenue'], ['Operating margin (latest qtr)', pct1(qom), 'Within ±2 pts of the current level'], ['EPS (TTM)', fmtP(k.eps, c), 'Rising quarter after quarter'], ['ROE', pct1(k.roe), 'Stays ≥ 15%'], ['Debt/equity', R.fin ? 'n/m' : nn(k.de, 2), 'Not rising materially'], ['OCF ÷ net profit (3y)', isNum(R.ocfNi) ? (R.ocfNi * 100).toFixed(0) + '%' : NAs, 'Stays ≥ 80%'], ['Free cash flow (FY)', R.fin ? 'n/m' : fmtBig(R.fcf, c), 'Stays positive'], ['P/E vs sector', isNum(k.pe) && S && isNum(S.pe) ? `${k.pe.toFixed(1)} vs ${S.pe.toFixed(1)}` : NAs, 'Premium justified by growth'], [R.india ? 'Promoter holding / pledge' : 'Insider holding', isNum(pr.insiders) ? pct1(pr.insiders) + (R.india ? ' (pledge n/a)' : '') : NAs, 'No sharp fall; pledge near zero (check exchange filings)'], ['Institutional holding', pct1(pr.institutions), 'Stable or rising'], ['Negative headlines (90d)', isNum(R.negN) ? R.negN : NAs, 'Verify any new ones in filings'], ['Price vs 200-DMA', isNum(T.d200) ? sgnPct(P / T.d200 - 1) : NAs, 'Holds above the long-term average']];
  out.push(RSEC(21, 'r-mon', '🔁 Quality monitoring (track each quarter)', `<div class="tw"><table><tr><th>Metric</th><th>Current</th><th>What to look for</th></tr>${mon.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td style="white-space:normal">${r[2]}</td></tr>`).join('')}</table></div><p class="src">Current values from the latest refresh; results ${k.lqDate ? 'through ' + qlabel(k.lqDate) : 'n/a'}.</p>`));
  // 22 Thesis break
  const tb = ['Revenue falls year-on-year for <b>2 consecutive quarters</b> (latest: ' + sgnPct(k.lqRevYoY) + ')'];
  if (isNum(qom)) tb.push(`Quarterly operating margin drops below <b>${((qom - 0.03) * 100).toFixed(1)}%</b> (now ${pct1(qom)}, i.e. −3 pts)`);
  if (isNum(k.roe)) tb.push(`ROE falls below <b>${(Math.max(0.1, k.roe - 0.05) * 100).toFixed(0)}%</b> (now ${pct1(k.roe)})`);
  if (!R.fin && isNum(k.de)) tb.push(`Debt/equity rises above <b>${Math.max(1, k.de + 0.5).toFixed(2)}</b> (now ${k.de.toFixed(2)})`);
  if (!R.fin && isNum(R.ocfNi)) tb.push(`Operating cash flow falls below <b>80%</b> of profit over 3 years (now ${(R.ocfNi * 100).toFixed(0)}%)`);
  if (isNum(k.eps) && k.eps > 0) tb.push(`TTM EPS falls below <b>${fmtP(k.eps * 0.85, c)}</b> (−15% from ${fmtP(k.eps, c)})`);
  if (isNum(T.d200)) tb.push(`Price closes below <b>${fmtP(T.d200 * 0.9, c)}</b> (10% under the 200-DMA)${T.sup.length ? ` or breaks support at ${fmtP(last(T.sup)[1], c)}` : ''}`);
  if (S && isNum(S.pe) && isNum(k.pe) && !k.loss) tb.push(`P/E expands above <b>${(Math.max(k.pe, S.pe) * 1.5).toFixed(1)}</b> without matching earnings growth`);
  tb.push(R.india ? 'Promoter pledge rises materially, or promoter holding falls > 5 pts in a quarter (check NSE shareholding)' : 'Large insider selling, or a material SEC 8-K (restatement, auditor change)');
  tb.push('Any verified governance event: auditor resignation/qualification, regulator action, accounting restatement');
  out.push(RSEC(22, 'r-break', '🧨 Thesis break conditions', `<ul>${tb.map(x => `<li>${x}</li>`).join('')}</ul>${how('Triggers are set relative to today\'s values (margin −3 pts; ROE −5 pts with a 10% floor; D/E +0.5 with a floor of 1.0; EPS −15%; 10% below the 200-DMA; P/E 1.5× the higher of own/sector). They are prompts to re-examine, not automatic sell rules.')}`));
  out.push(RSEC(23, 'r-conf', `🎚️ Confidence <span class="mut">(${conf.level})</span>`, `<div class="kv"><div><span>Data completeness</span><b>${(conf.comp * 100).toFixed(0)}%</b></div><div><span>Signal agreement</span><b>${isNum(conf.agree) ? (conf.agree * 100).toFixed(0) + '%' : 'n/a'}</b></div></div><p>${conf.why}</p>${how('Completeness = share of ' + conf.n + ' key fields available. Agreement = share of scored components on the same side of 50 as the composite. High: completeness ≥ 85% and agreement ≥ 70%. Low: completeness < 60% or agreement < 50%. Otherwise Medium.')}`));
  const dt = t => t ? new Date(t * 1000).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) + ' IST' : 'n/a';
  out.push(RSEC(24, 'r-src', '🗂️ Data sources & gaps', `<ul>
   <li><b>Price & history:</b> Yahoo Finance chart API (daily closes, ~5 years) — last price ${dt(d.priceTime)}; quotes refreshed every ~5 min in market hours (may be delayed ~15 min).</li>
   <li><b>Financial statements:</b> Yahoo Finance fundamentals-timeseries (≈4 fiscal years, ≈5 quarters) — fetched ${dt(d.fetched)}${d.fx && d.fx.rate ? `; converted ${esc(d.fx.from)}→${esc(d.fx.to)} at ${d.fx.rate}` : ''}.</li>
   <li><b>Profile, ownership, beta, results date, analyst ratings:</b> Yahoo Finance quoteSummary — ${dt(pr.asOf || (d.analyst && d.analyst.asOf))}.</li>
   <li><b>News:</b> ${d.news ? `Google News RSS, ${dt(d.news.asOf)}` : 'not available'}.</li>
   <li><b>Sector/peer medians & relative strength:</b> this app's snapshot of ${R.india ? 'NIFTY 500' : 'S&P 500'} stocks, ${sumAsOf()}.</li></ul>
   <h3>Missing for this stock</h3><p>${conf.missing.length ? conf.missing.join(', ') : 'none of the tracked fields'}.</p>
   <h3>Never available from these free sources</h3><p class="mut">Promoter pledge, segment/customer/geographic split, management guidance and concall commentary, NPAs/capital adequacy for banks, 10-year statement history, auditor remarks, related-party transactions. Check annual reports, exchange filings and Screener/Moneycontrol.</p>`));
  // 25 Conflicts
  const cf = [], hi = s => isNum(s) && s >= 60, lo = s => isNum(s) && s < 40, an = d.analyst;
  if ((hi(R.graham.score) || (isNum(R.mos) && R.mos > 0.2)) && lo(R.tech.score)) cf.push(`<b>Value vs trend:</b> looks cheap (Graham ${sv(R.graham.score)}${isNum(R.mos) ? ', margin of safety ' + Math.round(R.mos * 100) + '%' : ''}) but technicals are weak (${sv(R.tech.score)}) — the market may be pricing in a problem, or it is a value opportunity before a turn.`);
  if (hi(R.tech.score) && isNum(R.mos) && R.mos < -0.3) cf.push(`<b>Momentum vs valuation:</b> strong trend (${sv(R.tech.score)}) while the price is ${Math.round(-R.mos * 100)}% above base fair value.`);
  if (hi(R.buffett.score) && lo(R.graham.score)) cf.push(`<b>Quality vs price:</b> high quality (Buffett ${sv(R.buffett.score)}) but expensive on Graham's tests (${sv(R.graham.score)}) — typical of premium compounders.`);
  if (hi(R.fisher.score) && R.cans && lo(R.cans.score)) cf.push(`<b>Long-term vs short-term growth:</b> Fisher ${sv(R.fisher.score)} but CANSLIM ${sv(R.cans.score)} — recent quarters / price action lag the long-term record.`);
  if (R.cans && hi(R.cans.score) && lo(R.graham.score)) cf.push('<b>Growth vs value styles:</b> passes growth-momentum screens but fails value screens.');
  if (an && isNum(an.mean)) { const same = !an.currency || an.currency === c, up = isNum(an.tMean) && same ? an.tMean / P - 1 : undefined;
    if (an.mean <= 2.2 && /Avoid|Hold/.test(R.verdict)) cf.push(`<b>Analysts vs model:</b> analysts lean bullish (mean ${an.mean.toFixed(2)}${isNum(up) ? ', mean target ' + sgnPct(up) : ''}) while this model says "${R.verdict}".`);
    if (an.mean >= 3 && /Accumulate/.test(R.verdict)) cf.push(`<b>Analysts vs model:</b> analysts are cautious (mean ${an.mean.toFixed(2)}) while this model says "${R.verdict}".`);
    if (isNum(an.tMean) && R.fv && same && Math.abs(an.tMean / R.fv.base - 1) > 0.3) cf.push(`<b>Analyst target vs fair value:</b> mean target ${fmtP(an.tMean, c)} vs model base fair value ${fmtP(R.fv.base, c)} (${sgnPct(an.tMean / R.fv.base - 1)} apart).`); }
  if (isNum(k.niGrowthFY) && k.niGrowthFY > 0.1 && isNum(R.ocfNi) && R.ocfNi < 0.8 && !R.fin) cf.push(`<b>Profits vs cash:</b> profit grew ${sgnPct(k.niGrowthFY)} but cash flow covered only ${(R.ocfNi * 100).toFixed(0)}% of profits.`);
  if (isNum(k.lqNiYoY) && isNum(k.niCAGR) && Math.sign(k.lqNiYoY) !== Math.sign(k.niCAGR) && Math.abs(k.lqNiYoY) > 0.1) cf.push(`<b>Recent vs long-run earnings:</b> latest-quarter profit ${sgnPct(k.lqNiYoY)} YoY vs multi-year CAGR ${sgnPct(k.niCAGR)}.`);
  const plans = it.filter(x => x.g.includes('ord') || x.g.includes('plan')).length; if (plans >= 3 && (R.negN || 0) >= 3) cf.push(`<b>Mixed news flow:</b> ${plans} order/plan headlines and ${R.negN} negative headlines in 90 days.`);
  out.push(RSEC(25, 'r-conf2', `⚔️ Conflicts between signals <span class="mut">(${cf.length})</span>`, cf.length ? `<ul>${cf.map(x => `<li>${x}</li>`).join('')}</ul>` : '<p>No major disagreements between the signals tracked here.</p>'));
  const nav = ['Summary', 'Analysis', 'Positives', 'Negatives', 'CANSLIM', 'Graham', 'Buffett', 'Fisher', 'Lynch', 'Technicals', 'Valuation', 'Peers', 'Risk', 'Catalysts', 'Red flags', 'CAGR', 'Fair value', 'Scenarios', 'Verdict', 'Checklist', 'Monitor', 'Thesis break', 'Confidence', 'Sources', 'Conflicts'];
  const ids = out.map(h => h.match(/id="([^"]+)"/)[1]);
  return { R, html: `<div class="card navc">${nav.map((t, i) => `<a href="#" data-jump="${ids[i]}">${i + 1}. ${t}</a>`).join('')}<a href="#glossary">📖 Glossary</a><a href="#" id="expAll">Expand all</a></div>` + out.join('') };
}

// ---------- PDF (jsPDF + autotable, vendored) ----------
function downloadPDF(d) {
  if (!window.jspdf) { alert('PDF library not loaded (offline?). Try again online.'); return; }
  const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: 'pt', format: 'a4' }), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40;
  const map = [[/₹/g, 'Rs '], [/[−–—]/g, '-'], [/×/g, 'x'], [/≥/g, '>='], [/≤/g, '<='], [/÷/g, '/'], [/√/g, 'sqrt'], [/▲/g, '+'], [/▼/g, '-'], [/[✔✅]/g, '[ok]'], [/[✘❌🚩]/g, '[!]'], [/[‘’]/g, "'"], [/[“”]/g, '"'], [/…/g, '...'], [/⅓/g, '1/3'], [/¼/g, '1/4'], [/→/g, '->'], [/≈/g, '~'], [/∓/g, '-/+']];
  const clean = s => { s = String(s); for (const [a, b] of map) s = s.replace(a, b); return s.replace(/[^\x00-\xFF]/g, '').replace(/\s+/g, ' ').trim(); };
  let y = M; const need = h => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const text = (t, size = 9, bold = false, col = 20) => { t = clean(t); if (!t) return; doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(col); for (const ln of doc.splitTextToSize(t, W - 2 * M)) { need(size + 3); doc.text(ln, M, y); y += size + 3; } };
  text(`${d.name} (${d.symbol}) - 25-point research report`, 15, true);
  text(`Generated ${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} IST by Stock Search | price ${fmtP(d.price, d.currency)} | rule-based, educational, not personal investment advice.`, 8, false, 90); y += 6;
  document.querySelectorAll('#view details.rpt').forEach(sec => {
    const cl = sec.cloneNode(true); cl.querySelectorAll('.gq, button, input, .ivin, script').forEach(x => x.remove());
    const sm = cl.querySelector('summary'); need(30); y += 6; text(sm.textContent, 12, true, 15); sm.remove();
    const walk = el => { for (const ch of el.children) {
      const tg = ch.tagName.toUpperCase();
      if (tg === 'TABLE') { doc.autoTable({ html: ch, startY: y, margin: { left: M, right: M }, styles: { fontSize: 7.5, cellPadding: 2.5, overflow: 'linebreak' }, headStyles: { fillColor: [15, 118, 110] }, didParseCell: c => { c.cell.text = c.cell.text.map(clean); } }); y = doc.lastAutoTable.finalY + 6; }
      else if (tg === 'UL' || tg === 'OL') [...ch.children].forEach(li => text('- ' + li.textContent, 8.5));
      else if (tg === 'DETAILS') { const s = ch.querySelector('summary'); if (s && /How calculated/.test(s.textContent)) text(ch.textContent, 7.5, false, 100); else { if (s) s.remove(); walk(ch); } }
      else if (tg === 'H3') { y += 2; text(ch.textContent, 10, true, 40); }
      else if (tg === 'SVG') { }
      else if (ch.querySelector('table, ul, h3, details')) walk(ch);
      else text(ch.textContent, 8.5);
    } };
    walk(cl);
  });
  const gk = typeof glossTermsIn === 'function' ? [...new Set([].concat(...[...document.querySelectorAll('#view details.rpt, #view #s-moat')].map(glossTermsIn)))].sort((a, b) => GL[a][0].localeCompare(GL[b][0])) : [];
  if (gk.length) { doc.addPage(); y = M; text(`Glossary of terms used in this report (${gk.length})`, 12, true, 15); y += 2;
    doc.autoTable({ startY: y, margin: { left: M, right: M }, head: [['Term', 'Plain meaning', 'Good / bad']], body: gk.map(k => [GL[k][0], GL[k][1] + (GL[k][2] ? ' e.g. ' + GL[k][2] : ''), GL[k][3] || '']).map(r => r.map(clean)), styles: { fontSize: 7, cellPadding: 2.2, overflow: 'linebreak' }, columnStyles: { 0: { cellWidth: 95, fontStyle: 'bold' }, 2: { cellWidth: 140 } }, headStyles: { fillColor: [15, 118, 110] } }); }
  const n = doc.internal.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7); doc.setTextColor(120); doc.text(`Educational only - not personal investment advice. Consult a SEBI-registered adviser. Page ${i}/${n}`, M, H - 20); }
  doc.save(`${d.symbol.replace(/\W/g, '_')}_report.pdf`);
}
