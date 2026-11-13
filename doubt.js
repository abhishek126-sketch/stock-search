'use strict';
// ===== Data-doubt flags: values that look inconsistent or uncertain are shown in RED with ⚠ and the reason =====
// Rules are simple and conservative; a flag means "verify before relying on this", not "this is wrong".
const DQ_LABEL = { price: 'Price', pe: 'P/E', eps: 'EPS', pb: 'P/B', ret1y: '1-yr return', hist: 'Price history & chart', roe: 'ROE', roce: 'ROCE', dy: 'Dividend yield', de: 'Debt / equity' };
let DQ = {};
const dqEx = s => typeof isEx === 'function' ? isEx(s) : (s === 'NSE' || s === 'BSE');
const dqDay = t => typeof istDay === 'function' ? istDay(t) : '';
const dqDate = t => new Date(t * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// biggest one-day move in the last ~400 days of daily closes: [ratio, time] (splits/bonuses not adjusted look like this)
function dqJump(hist) {
  let best = null; const now = hist.length ? hist[hist.length - 1][0] : 0;
  for (let i = 1; i < hist.length; i++) {
    if (hist[i][0] < now - 400 * DAY || !(hist[i - 1][1] > 0)) continue;
    const r = hist[i][1] / hist[i - 1][1]; if ((r > 1.8 || r < 0.55) && (!best || Math.abs(Math.log(r)) > Math.abs(Math.log(best[0])))) best = [r, hist[i][0]];
  }
  return best;
}

function doubtsFor(d, k) {
  const D = {}, c = d.currency, P = d.price, add = (f, why) => { D[f] = D[f] ? D[f] + ' ' + why : why; }, ck = d.check;
  // price: Yahoo frozen/stale, sources disagree, or no recent trade
  const yq = typeof QUOTES !== 'undefined' && QUOTES && QUOTES.q && QUOTES.q[d.symbol];
  // not doubtful when the price is the exchange's official close for its own session (the refresh applied it on top of a
  // frozen Yahoo quote - DIGIKORE.NS SME, 13 Nov 2026: ₹33.00 = NSE close, flagged red as "frozen")
  const exOk = d.exClose && d.exClose.day && isNum(d.priceTime) && dqDay(d.priceTime) === d.exClose.day;
  const frozen = !exOk && (d.staleFixed || (yq && isNum(yq[2]) && Date.now() / 1000 - yq[2] > 20 * DAY));
  if (frozen) add('price', `Yahoo Finance's 'current price' is frozen${yq && isNum(yq[0]) ? ` at ${fmtP(yq[0], c)} from ${dqDate(yq[2])}` : ' at an old value'}, so ${ck && dqEx(ck.src) ? ck.src + "'s official close" : 'the latest daily close'} is shown instead.`);
  else if (ck && ck.st === 'mm' && isNum(ck.d)) add('price', `Sources disagree: Yahoo Finance ${fmtP(dqEx(d.priceSrc) ? d.yPrice : d.price, c)} vs ${ck.src} ${fmtP(ck.p, c)} (${(ck.d * 100).toFixed(1)}% apart).`);
  else if (dqEx(d.priceSrc) && d.yTime && ck && dqDay(d.yTime) !== dqDay(ck.t)) add('price', `Yahoo Finance's price was out of date (${dqDate(d.yTime)}); ${ck.src}'s official close is shown instead.`);
  if (isNum(d.priceTime) && Date.now() / 1000 - d.priceTime > 10 * DAY) add('price', `Last trade data is from ${dqDate(d.priceTime)} — the stock may be suspended or very thinly traded.`);
  // history: a one-day jump usually means an unadjusted split / bonus
  const j = dqJump(d.hist || []);
  if (j) { const why = `Price moved ${j[0] > 1 ? '+' : ''}${((j[0] - 1) * 100).toFixed(0)}% in one day on ${dqDate(j[1])} — possibly a split or bonus not adjusted in the data, so returns, 52-week range and moving averages may be wrong.`; add('hist', why); add('ret1y', 'See price history.'); }
  if (isNum(k.ret1y) && (k.ret1y > 3 || k.ret1y < -0.9)) add('ret1y', `Extreme 1-year return (${(k.ret1y * 100).toFixed(0)}%) — check for a split, bonus or data error.`);
  // valuation
  if (!k.loss && isNum(k.pe)) {
    if (k.pe < 2 || k.pe > 300) add('pe', `Unusually ${k.pe < 2 ? 'low' : 'high'} P/E (${k.pe.toFixed(1)}) — earnings or share count may not match the price (e.g. after a split).`);
    if (k.peAsOf) { const pAt = priceAt(d.hist || [], Date.parse(k.peAsOf) / 1000 + DAY); if (pAt && isNum(P) && Math.abs(P / pAt - 1) > 0.3) add('pe', `This is Yahoo's own P/E from ${k.peAsOf}; the price has moved ${((P / pAt - 1) * 100).toFixed(0)}% since, and it isn't recalculated.`); }
  }
  if (D.pe && k.epsDerived) add('eps', 'Worked out from the doubtful P/E.');
  if (isNum(k.pb) && k.pb > 0 && (k.pb < 0.05 || k.pb > 100)) add('pb', `Unusual P/B (${k.pb.toFixed(2)}) — book value may not match the share count.`);
  if (isNum(k.roe) && Math.abs(k.roe) > 1) add('roe', `ROE beyond ±100% (${(k.roe * 100).toFixed(0)}%) — usually tiny or distorted equity; treat with caution.`);
  if (isNum(k.roce) && Math.abs(k.roce) > 1.5) add('roce', `ROCE beyond ±150% (${(k.roce * 100).toFixed(0)}%) — capital base looks distorted.`);
  if (isNum(k.dy) && k.dy > 0.15) add('dy', `Dividend yield above 15% (${(k.dy * 100).toFixed(1)}%) — often a one-off special dividend or a price/dividend mismatch.`);
  if (isNum(k.de) && k.de > 10) add('de', `Debt/equity above 10 (${k.de.toFixed(1)}) — equity is tiny or the figures don't match.`);
  return D;
}
// wrap a rendered value: red + ⚠ when the current stock has a doubt for that field
const dq = (f, html) => DQ[f] ? `<span class="doubt" title="${esc(DQ[f])}">${html} ⚠</span>` : html;
function doubtBanner() {
  const ks = Object.keys(DQ); if (!ks.length) return '';
  return `<div class="dqbox nogq"><b>⚠ ${ks.length} value${ks.length > 1 ? 's' : ''} on this page look${ks.length > 1 ? '' : 's'} inconsistent</b> — shown in <span class="doubt">red with ⚠</span>${typeof gq === 'function' ? gq('doubt') : ''}. Please verify on NSE / BSE before relying on ${ks.length > 1 ? 'them' : 'it'}.
    <ul>${ks.map(f => `<li><b>${DQ_LABEL[f] || f}:</b> ${esc(DQ[f])}</li>`).join('')}</ul></div>`;
}
// list rows (Browse / Score filter): reasons by field, from the one-line summary + the price check
function rowDoubts(r) {
  const W = {}, ck = r.ck || (typeof CHECK !== 'undefined' && CHECK && CHECK.s && CHECK.s[r.s]);
  const yq = typeof QUOTES !== 'undefined' && QUOTES && QUOTES.q && QUOTES.q[r.s];
  if (yq && isNum(yq[2]) && Date.now() / 1000 - yq[2] > 20 * DAY) W.p = `Yahoo's price is frozen since ${dqDate(yq[2])}`;
  else if (ck && ck.st === 'mm' && isNum(ck.d)) W.p = `Yahoo and ${ck.src} prices differ by ${(ck.d * 100).toFixed(1)}%`;
  if (r.pe > 0 && (r.pe < 2 || r.pe > 300)) W.pe = `unusual P/E ${r.pe.toFixed(1)}`;
  if (isNum(r.r1y) && (r.r1y > 3 || r.r1y < -0.9)) W.r1y = `extreme 1-year return ${(r.r1y * 100).toFixed(0)}%`;
  if (isNum(r.roe) && Math.abs(r.roe) > 1) W.roe = `ROE ${(r.roe * 100).toFixed(0)}%`;
  if (isNum(r.pb) && r.pb > 0 && (r.pb < 0.05 || r.pb > 100)) W.pb = `unusual P/B ${r.pb.toFixed(2)}`;
  return W;
}
const rowDoubtTag = W => { const v = Object.values(W); return v.length ? ` <span class="doubt" title="${esc('Check this data: ' + v.join('; '))}">⚠</span>` : ''; };
