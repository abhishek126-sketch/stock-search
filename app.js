'use strict';
const qs = new URLSearchParams(location.search);
const DATA = qs.get('data') || 'https://raw.githubusercontent.com/abhishek126-sketch/stock-search/data/data/';
const $ = s => document.querySelector(s);
const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('storage full/blocked', k, e); } } };
let INDEX = [], CUR = null, RANGE = '1Y', SHOW_DMA = true;
const NA = '<span class="mut">not available</span>';
const isNum = v => typeof v === 'number' && isFinite(v);
const DAY = 86400;

// ---------- formatting ----------
function cur(c) { return c === 'INR' ? '₹' : c === 'USD' ? '$' : (c ? c + ' ' : ''); }
function fmtBig(v, c) {
  if (!isNum(v)) return NA; const s = v < 0 ? '-' : ''; v = Math.abs(v);
  if (c === 'INR') { if (v >= 1e7) return s + '₹' + (v / 1e7).toLocaleString('en-IN', { maximumFractionDigits: v >= 1e11 ? 0 : 1 }) + ' Cr'; return s + '₹' + v.toLocaleString('en-IN'); }
  const p = cur(c); if (v >= 1e12) return s + p + (v / 1e12).toFixed(2) + 'T'; if (v >= 1e9) return s + p + (v / 1e9).toFixed(2) + 'B'; if (v >= 1e6) return s + p + (v / 1e6).toFixed(1) + 'M'; return s + p + v.toLocaleString();
}
const fmtP = (v, c) => isNum(v) ? cur(c) + v.toLocaleString(c === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : NA;
const fmtX = (v, d = 1) => isNum(v) ? v.toFixed(d) + '×' : NA;
const fmtPct = (v, d = 1) => isNum(v) ? (v * 100).toFixed(d) + '%' : NA;
const sgnPct = v => isNum(v) ? `<span class="${v >= 0 ? 'up' : 'dn'}">${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%</span>` : '<span class="mut">–</span>';
const dstr = t => new Date(t * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const qlabel = iso => { const d = new Date(iso + 'T00:00:00Z'); return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function err(m) { const e = $('#msg'); e.innerHTML = m; e.style.display = m ? 'block' : 'none'; }

// ---------- data loading ----------
async function getJSON1(u) { const r = await fetch(u, { cache: 'no-cache' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
const RAW = 'https://raw.githubusercontent.com/abhishek126-sketch/stock-search/data/', CDN = 'https://cdn.jsdelivr.net/gh/abhishek126-sketch/stock-search@data/';
async function getJSON(u) {
  let e0; for (let i = 0; i < 3; i++) { try { return await getJSON1(u); } catch (e) { e0 = e; if (/HTTP 404/.test(e.message) && !u.startsWith(RAW)) break; await new Promise(r => setTimeout(r, 600 * (i + 1))); } }
  if (u.startsWith(RAW)) { try { const d = await getJSON1(u.replace(RAW, CDN)); d._viaCDN = true; return d; } catch { } }  // fallback mirror (may lag up to ~12 h)
  throw e0;
}
async function loadIndex() {
  try {
    const d = await getJSON(DATA + 'index.json'); INDEX = d.symbols;
    $('#dsinfo').textContent = `${INDEX.length.toLocaleString()} stocks in built-in list (all NSE mainboard + active BSE-only stocks, S&P 500, ETFs; new listings added by the nightly refresh). Data snapshot built ${new Date(d.built * 1000).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.`;
  } catch (e) { $('#dsinfo').textContent = 'Could not load the stock list (offline?). ' + (LS.get('avkey', '') ? 'Alpha Vantage search still works.' : ''); }
  renderChips();
}
function renderChips() {
  const fav = LS.get('fav', []); const picks = ['RELIANCE.NS', 'TCS.NS', 'ITC.NS', 'HDFCBANK.NS', 'INFY.NS', 'AAPL', 'MSFT', 'NVDA'];
  $('#chips').innerHTML = (fav.length ? fav.map(s => `<button data-s="${esc(s)}">⭐ ${esc(s)}</button>`).join('') : '') + picks.filter(p => !fav.includes(p)).map(s => `<button data-s="${s}">${s}</button>`).join('');
  $('#chips').querySelectorAll('button').forEach(b => b.onclick = () => openSym(b.dataset.s));
}

// Alpha Vantage (optional, user's own key)
async function av(params) {
  const key = LS.get('avkey', ''); if (!key) throw new Error('No Alpha Vantage key set (Settings).');
  const d = await getJSON('https://www.alphavantage.co/query?' + new URLSearchParams({ ...params, apikey: key }));
  if (d.Note || d.Information) throw new Error('Alpha Vantage: ' + (d.Note || d.Information));
  if (d['Error Message']) throw new Error('Alpha Vantage: symbol not found / not supported.');
  return d;
}
const avNum = v => (v === undefined || v === null || v === 'None' || v === '-' || v === '') ? undefined : +v;
async function loadAV(sym) {
  const ck = 'av:' + sym, c = LS.get(ck, null); if (c && Date.now() - c.t < 6 * 3600e3) return c.d;
  const daily = await av({ function: 'TIME_SERIES_DAILY', symbol: sym, outputsize: 'compact' });
  const weekly = await av({ function: 'TIME_SERIES_WEEKLY', symbol: sym });
  let ov = {}, inc = {}, ern = {};
  try { ov = await av({ function: 'OVERVIEW', symbol: sym }); } catch { }
  if (ov && ov.Symbol) { try { inc = await av({ function: 'INCOME_STATEMENT', symbol: sym }); } catch { } try { ern = await av({ function: 'EARNINGS', symbol: sym }); } catch { } }
  const dly = Object.entries(daily['Time Series (Daily)'] || {}).map(([d, v]) => [Date.parse(d) / 1000, +v['4. close']]).sort((a, b) => a[0] - b[0]);
  const wk = Object.entries(weekly['Weekly Time Series'] || {}).map(([d, v]) => [Date.parse(d) / 1000, +v['4. close']]).sort((a, b) => a[0] - b[0]);
  const first = dly.length ? dly[0][0] : Infinity;
  const hist = wk.filter(x => x[0] < first && x[0] > Date.now() / 1000 - 5.2 * 365 * DAY).concat(dly);
  if (!hist.length) throw new Error('No price data from Alpha Vantage for ' + sym);
  const fund = {};
  const qi = (inc.quarterlyReports || []).slice(0, 12).reverse();
  if (qi.length) { fund.quarterlyTotalRevenue = qi.map(r => [r.fiscalDateEnding, avNum(r.totalRevenue)]).filter(x => isNum(x[1])); fund.quarterlyNetIncome = qi.map(r => [r.fiscalDateEnding, avNum(r.netIncome)]).filter(x => isNum(x[1])); }
  const qe = (ern.quarterlyEarnings || []).slice(0, 12).reverse(); if (qe.length) fund.quarterlyDilutedEPS = qe.map(r => [r.fiscalDateEnding, avNum(r.reportedEPS)]).filter(x => isNum(x[1]));
  const ai = (inc.annualReports || []).slice(0, 4).reverse(); if (ai.length) { fund.annualTotalRevenue = ai.map(r => [r.fiscalDateEnding, avNum(r.totalRevenue)]).filter(x => isNum(x[1])); fund.annualNetIncome = ai.map(r => [r.fiscalDateEnding, avNum(r.netIncome)]).filter(x => isNum(x[1])); fund.annualEBIT = ai.map(r => [r.fiscalDateEnding, avNum(r.ebit)]).filter(x => isNum(x[1])); }
  const d = { symbol: sym, name: ov.Name || sym, exchange: ov.Exchange || (sym.endsWith('.BSE') ? 'BSE' : ''), currency: ov.Currency || (sym.endsWith('.BSE') ? 'INR' : 'USD'), sector: ov.Sector || '',
    price: hist[hist.length - 1][1], prevClose: hist.length > 1 ? hist[hist.length - 2][1] : undefined, priceTime: hist[hist.length - 1][0], hist, divs: [], fund,
    ov: { mcap: avNum(ov.MarketCapitalization), pe: avNum(ov.PERatio), pb: avNum(ov.PriceToBookRatio), eps: avNum(ov.EPS), dy: avNum(ov.DividendYield), roe: avNum(ov.ReturnOnEquityTTM) },
    source: 'Alpha Vantage (your API key)', fetched: Date.now() / 1000 };
  LS.set(ck, { t: Date.now(), d }); return d;
}
async function liveQuote() {
  if (!CUR) return; const s = CUR.symbol.match(/\.(NS|BO)$/) ? CUR.symbol.replace('.NS', '.BSE') : CUR.symbol;
  const b = $('#liveBtn'); b.disabled = true; b.textContent = 'Fetching…';
  try {
    const g = (await av({ function: 'GLOBAL_QUOTE', symbol: s }))['Global Quote'] || {};
    if (!g['05. price']) throw new Error('Live quote not available for ' + s + ' on Alpha Vantage.');
    CUR.price = +g['05. price']; CUR.prevClose = +g['08. previous close']; CUR.liveNote = `Live quote via Alpha Vantage (${esc(s)}, last trading day ${esc(g['07. latest trading day'])})`;
    render();
  } catch (e) { err(esc(e.message)); b.disabled = false; b.textContent = '↻ Live price'; }
}

// ---------- search ----------
let sugIdx = -1;
function search(q) {
  q = q.trim().toUpperCase(); if (!q) return [];
  const out = [];
  for (const r of INDEX) { const s = r[0].toUpperCase(), base = s.replace(/\.(NS|BO)$/, ''), n = r[1].toUpperCase();
    let sc = base === q ? 100 : s === q ? 99 : base.startsWith(q) ? 80 - base.length : n.startsWith(q) ? 60 : n.includes(' ' + q) ? 45 : n.includes(q) || s.includes(q) ? 30 : 0;
    if (sc) out.push([sc, r]); }
  return out.sort((a, b) => b[0] - a[0]).slice(0, 12).map(x => x[1]);
}
let avTimer;
function showSug() {
  const q = $('#q').value, list = search(q), el = $('#sug'); sugIdx = -1;
  let h = list.map(r => `<div data-s="${esc(r[0])}"><b>${esc(r[0].replace(/\.(NS|BO)$/, ''))}</b> ${esc(r[1])}<br><small>${esc(r[2])}${r[3] ? ' · ' + esc(r[3]) : ''}</small></div>`).join('');
  if (q.trim() && LS.get('avkey', '')) h += `<div data-av="${esc(q.trim())}"><small>🔎 Search more (BSE / other US) via Alpha Vantage for “${esc(q.trim())}”</small></div>`;
  else if (q.trim() && !list.length) h = `<div><small>Not in the built-in list (all NSE mainboard + active BSE-only stocks, S&P 500, ETFs). Brand-new listings appear after the next full refresh. Add a free Alpha Vantage key in Settings to search all BSE / US stocks.</small></div>`;
  el.innerHTML = h; el.style.display = h ? 'block' : 'none';
  el.querySelectorAll('div[data-s]').forEach(d => d.onclick = () => openSym(d.dataset.s));
  el.querySelectorAll('div[data-av]').forEach(d => d.onclick = () => avSearch(d.dataset.av));
}
async function avSearch(q) {
  const el = $('#sug'); el.innerHTML = '<div><small>Searching Alpha Vantage…</small></div>';
  try { const m = (await av({ function: 'SYMBOL_SEARCH', keywords: q })).bestMatches || [];
    const ok = m.filter(x => /United States|India/.test(x['4. region']));
    el.innerHTML = ok.length ? ok.map(x => `<div data-a="${esc(x['1. symbol'])}"><b>${esc(x['1. symbol'])}</b> ${esc(x['2. name'])}<br><small>${esc(x['4. region'])} · ${esc(x['3. type'])} <span class="tag">Alpha Vantage</span></small></div>`).join('') : '<div><small>No US/India matches.</small></div>';
    el.querySelectorAll('div[data-a]').forEach(d => d.onclick = () => openSym(d.dataset.a, true));
  } catch (e) { el.innerHTML = `<div><small>${esc(e.message)}</small></div>`; }
}
$('#q').addEventListener('input', showSug);
$('#q').addEventListener('keydown', e => {
  const items = [...$('#sug').querySelectorAll('div[data-s],div[data-av],div[data-a]')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sugIdx = Math.max(0, Math.min(items.length - 1, sugIdx + (e.key === 'ArrowDown' ? 1 : -1))); items.forEach((d, i) => d.classList.toggle('act', i === sugIdx)); }
  if (e.key === 'Enter') { (items[sugIdx] || items[0])?.click(); }
  if (e.key === 'Escape') $('#sug').style.display = 'none';
});
document.addEventListener('click', e => { if (!e.target.closest('.sbox')) $('#sug').style.display = 'none'; });

async function openSym(sym, viaAV) {
  $('#sug').style.display = 'none'; $('#q').value = ''; $('#q').blur(); err('');
  $('#home').hidden = true; const v = $('#view'); v.hidden = false; v.innerHTML = '<div class="card">Loading ' + esc(sym) + '…</div>';
  navTo('#' + encodeURIComponent(sym) + (viaAV ? '~av' : ''));
  try {
    await ensureSummary();
    const inIdx = INDEX.some(r => r[0] === sym);
    CUR = (!viaAV && (inIdx || !INDEX.length)) ? await getJSON(DATA + 's/' + encodeURIComponent(sym) + '.json') : await loadAV(sym);
    if (typeof applyQuote === 'function') applyQuote(CUR);
    render();
  } catch (e) { v.innerHTML = ''; err(`Could not load <b>${esc(sym)}</b>: ${esc(e.message)}`); $('#home').hidden = false; }
}
// history: each page change adds one entry (Android back steps back through pages); same-hash navigations don't duplicate
function navTo(hash) { if (decodeURIComponent(location.hash) !== decodeURIComponent(hash)) history.pushState(null, '', hash || location.pathname + location.search); }
function goHome(fromHistory) { $('#view').hidden = true; $('#view').innerHTML = ''; $('#home').hidden = false; CUR = null; $('#q').value = ''; $('#sug').style.display = 'none'; err(''); if (!fromHistory) navTo(''); window.scrollTo(0, 0); renderChips(); updFav(); renderLists(LISTTAB); }
let LISTTAB = 'cap';

// ---------- analytics ----------
const last = a => a && a.length ? a[a.length - 1] : undefined;
function sma(c, n) { if (c.length < n) return; let s = 0; for (let i = c.length - n; i < c.length; i++) s += c[i]; return s / n; }
function smaSeries(c, n) { const o = new Array(c.length); let s = 0; for (let i = 0; i < c.length; i++) { s += c[i]; if (i >= n) s -= c[i - n]; o[i] = i >= n - 1 ? s / n : null; } return o; }
function rsi(c, n = 14) { if (c.length < n + 1) return; let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; d > 0 ? g += d : l -= d; } g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); }
const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
function priceAt(hist, t) { let p; for (const [ts, c] of hist) { if (ts <= t) p = c; else break; } return p; }

function compute(d) {
  const f = d.fund || {}, k = {}, price = d.price, hist = d.hist || [], now = d.priceTime || hist.length && last(hist)[0];
  const closes = hist.map(x => x[1]);
  // daily-only closes for technicals (AV weekly prefix excluded)
  let daily = hist; if (d.source && d.source.startsWith('Alpha')) { const i = hist.findIndex((x, j) => j > 0 && x[0] - hist[j - 1][0] < 5 * DAY); daily = i > 0 ? hist.slice(i - 1) : hist; }
  const dc = daily.map(x => x[1]);
  k.chg = isNum(price) && isNum(d.prevClose) ? price - d.prevClose : undefined; k.chgPct = isNum(k.chg) ? k.chg / d.prevClose : undefined;
  const yr = hist.filter(x => x[0] >= now - 365 * DAY).map(x => x[1]);
  if (yr.length > 150) { k.hi52 = Math.max(...yr, price || -Infinity); k.lo52 = Math.min(...yr, price || Infinity); }
  k.dma50 = sma(dc, 50); k.dma200 = sma(dc, 200); k.rsi = rsi(dc.slice(-250));
  const p1y = priceAt(hist, now - 365 * DAY); if (p1y && hist[0][0] < now - 360 * DAY) k.ret1y = price / p1y - 1;
  const p6m = priceAt(hist, now - 182 * DAY); if (p6m && hist[0][0] < now - 180 * DAY) k.ret6m = price / p6m - 1;
  const ds50 = smaSeries(dc, 50), ds200 = smaSeries(dc, 200);
  // recent golden / death cross within ~60 sessions
  for (let i = dc.length - 1; i > Math.max(200, dc.length - 60); i--) { if (ds50[i] && ds200[i] && ds50[i - 1] && ds200[i - 1]) { if (ds50[i] > ds200[i] && ds50[i - 1] <= ds200[i - 1]) { k.cross = 'golden'; k.crossT = daily[i][0]; break; } if (ds50[i] < ds200[i] && ds50[i - 1] >= ds200[i - 1]) { k.cross = 'death'; k.crossT = daily[i][0]; break; } } }
  // quarterly table
  const rev = f.quarterlyTotalRevenue || [], ni = f.quarterlyNetIncome || [], eps = f.quarterlyDilutedEPS || [];
  const dates = [...new Set([...rev, ...ni, ...eps].map(x => x[0]))].sort();
  const m = a => Object.fromEntries(a); const R = m(rev), N = m(ni), E = m(eps);
  const find = (dt, lo, hi) => dates.find(x => x < dt && days(dt, x) >= lo && days(dt, x) <= hi);
  k.quarters = dates.map(dt => { const pq = find(dt, 75, 105), py = find(dt, 350, 380);
    const g = (M, p) => p && isNum(M[dt]) && isNum(M[p]) && M[p] !== 0 ? (M[dt] - M[p]) / Math.abs(M[p]) : undefined;
    return { dt, rev: R[dt], ni: N[dt], eps: E[dt], revQoQ: g(R, pq), revYoY: g(R, py), niQoQ: g(N, pq), niYoY: g(N, py), epsYoY: g(E, py) }; }).slice(-8);
  // TTM EPS only if last 4 quarters are contiguous
  const ed = eps.slice(-4); if (ed.length === 4 && ed.every((x, i) => i === 0 || (days(x[0], ed[i - 1][0]) > 75 && days(x[0], ed[i - 1][0]) < 105)) && days(ed[3][0], new Date().toISOString()) < 220) k.epsTTM = ed.reduce((s, x) => s + x[1], 0);
  const ov = d.ov || {};
  const tPE = last(f.trailingPeRatio), tPB = last(f.trailingPbRatio), tMC = last(f.trailingMarketCap);
  if (isNum(ov.pe)) k.pe = ov.pe; else if (isNum(k.epsTTM) && k.epsTTM > 0) k.pe = price / k.epsTTM; else if (tPE) { k.pe = tPE[1]; k.peAsOf = tPE[0]; }
  if (isNum(ov.eps)) k.eps = ov.eps; else if (isNum(k.epsTTM)) k.eps = k.epsTTM; else if (isNum(k.pe) && k.pe > 0) { k.eps = price / k.pe; k.epsDerived = true; }
  if (isNum(k.eps) && k.eps < 0) k.loss = true;
  if (isNum(ov.pb)) k.pb = ov.pb; else if (tPB) { const pAt = priceAt(hist, Date.parse(tPB[0]) / 1000 + DAY); k.pb = pAt ? tPB[1] * price / pAt : tPB[1]; }
  if (isNum(ov.mcap)) k.mcap = ov.mcap; else if (tMC) { const pAt = priceAt(hist, Date.parse(tMC[0]) / 1000 + DAY); k.mcap = pAt ? tMC[1] * price / pAt : tMC[1]; }
  if (isNum(ov.dy)) k.dy = ov.dy; else if (d.divs && hist.length && hist[0][0] < now - 365 * DAY) { const s = d.divs.filter(x => x[0] >= now - 365 * DAY).reduce((a, x) => a + x[1], 0); k.dy = s / price; }
  // annual-based ratios (latest fiscal year)
  const aNI = last(f.annualNetIncome), aEq = f.annualStockholdersEquity || [], aD = last(f.annualTotalDebt), aE = last(f.annualEBIT), aTA = last(f.annualTotalAssets), aCL = last(f.annualCurrentLiabilities);
  const eqL = last(aEq), eqP = aEq.length > 1 ? aEq[aEq.length - 2] : null;
  if (isNum(ov.roe)) k.roe = ov.roe; else if (aNI && eqL && eqL[1] > 0) k.roe = aNI[1] / (eqP && eqP[1] > 0 ? (eqL[1] + eqP[1]) / 2 : eqL[1]);
  if (aE && aTA && aCL && aTA[0] === aCL[0] && aTA[1] - aCL[1] > 0) k.roce = aE[1] / (aTA[1] - aCL[1]);
  if (aD && eqL && eqL[1] > 0 && aD[0] === eqL[0]) k.de = aD[1] / eqL[1];
  if (eqL && eqL[1] <= 0) k.negEquity = true;
  k.fy = aNI ? aNI[0] : undefined;
  const ar = f.annualTotalRevenue || [], an = f.annualNetIncome || [];
  const cagr = (a) => { if (a.length < 2) return; const x = a[0][1], y = last(a)[1], n = days(last(a)[0], a[0][0]) / 365.25; return x > 0 && y > 0 && n >= 0.9 ? Math.pow(y / x, 1 / n) - 1 : undefined; };
  k.revCAGR = cagr(ar); k.niCAGR = cagr(an); k.cagrYears = ar.length > 1 ? Math.round(days(last(ar)[0], ar[0][0]) / 365.25) : undefined;
  if (ar.length > 1) { const a = ar[ar.length - 2][1], b = last(ar)[1]; if (a > 0) k.revGrowthFY = b / a - 1; }
  if (an.length > 1) { const a = an[an.length - 2][1], b = last(an)[1]; if (a > 0) k.niGrowthFY = b / a - 1; }
  const lq = last(k.quarters.filter(q => isNum(q.revYoY) || isNum(q.niYoY))); if (lq) { k.lqDate = lq.dt; k.lqRevYoY = lq.revYoY; k.lqNiYoY = lq.niYoY; }
  const lastQ = last(k.quarters); if (lastQ && isNum(lastQ.rev) && isNum(lastQ.ni) && lastQ.rev > 0) k.npm = lastQ.ni / lastQ.rev;
  if (aNI && ar.length && last(ar)[0] === aNI[0] && last(ar)[1] > 0) k.npmFY = aNI[1] / last(ar)[1];
  return k;
}

// ---------- rule-based scorecard ----------
const clamp = v => Math.max(0, Math.min(10, v));
const avg = a => { a = a.filter(isNum); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : undefined; };
const lerp = (v, x0, y0, x1, y1) => clamp(y0 + (y1 - y0) * (Math.max(Math.min(v, Math.max(x0, x1)), Math.min(x0, x1)) - x0) / (x1 - x0));
function analyse(d, k) {
  const pros = [], cons = [], watch = [], india = d.currency === 'INR', S = {};
  const fin = /financial|bank/i.test(d.sector || '') || /BANK|FINANCE|FINSERV/i.test(d.name || '');
  // Valuation
  const v = [];
  if (k.loss) { v.push(1); cons.push('Company is loss-making on a trailing basis, so P/E is not meaningful and valuation rests on future recovery.'); }
  else if (isNum(k.pe)) { const fair = india ? 25 : 22; v.push(lerp(k.pe, 10, 9.5, 60, 1));
    if (k.pe < fair * 0.6) pros.push(`P/E of ${k.pe.toFixed(1)} is low versus the broad ${india ? 'Indian' : 'US'} market (~${fair}) — could be value, or the market expects weaker earnings ahead.`);
    else if (k.pe > fair * 1.8) cons.push(`P/E of ${k.pe.toFixed(1)} is high — the price already assumes strong future growth; disappointments can hit the stock hard.`); }
  if (isNum(k.pb) && k.pb > 0) { v.push(lerp(k.pb, 1, 9, 12, 1)); if (k.pb < 1.2) pros.push(`Trades near book value (P/B ${k.pb.toFixed(2)}).`); }
  if (isNum(k.dy) && k.dy > 0) { v.push(lerp(k.dy, 0, 4, 0.04, 9)); if (k.dy >= 0.025) pros.push(`Dividend yield of ${(k.dy * 100).toFixed(1)}% provides some income.`); }
  S.Valuation = avg(v);
  // Growth
  const g = [];
  if (isNum(k.revCAGR)) g.push(lerp(k.revCAGR, -0.05, 1, 0.2, 10)); else if (isNum(k.revGrowthFY)) g.push(lerp(k.revGrowthFY, -0.05, 1, 0.2, 10));
  if (isNum(k.niCAGR)) g.push(lerp(k.niCAGR, -0.1, 1, 0.25, 10)); else if (isNum(k.niGrowthFY)) g.push(lerp(k.niGrowthFY, -0.1, 1, 0.25, 10));
  if (isNum(k.lqRevYoY)) g.push(lerp(k.lqRevYoY, -0.1, 1, 0.2, 10));
  if (isNum(k.lqNiYoY)) g.push(lerp(k.lqNiYoY, -0.2, 1, 0.25, 10));
  S.Growth = avg(g);
  if (isNum(k.revCAGR) && k.revCAGR > 0.12) pros.push(`Revenue has compounded ~${(k.revCAGR * 100).toFixed(0)}%/yr over ~${k.cagrYears} years.`);
  if (isNum(k.revCAGR) && k.revCAGR < 0.03) cons.push(`Revenue growth has been sluggish (~${(k.revCAGR * 100).toFixed(1)}%/yr over ~${k.cagrYears} years).`);
  if (isNum(k.lqNiYoY) && k.lqNiYoY > 0.15) pros.push(`Latest quarter (${qlabel(k.lqDate)}) net profit up ${(k.lqNiYoY * 100).toFixed(0)}% year-on-year.`);
  if (isNum(k.lqNiYoY) && k.lqNiYoY < -0.1) cons.push(`Latest quarter (${qlabel(k.lqDate)}) net profit down ${(-k.lqNiYoY * 100).toFixed(0)}% year-on-year.`);
  // Profitability
  const p = [];
  if (isNum(k.roe)) { p.push(lerp(k.roe, 0, 1, 0.25, 10)); if (k.roe >= 0.18) pros.push(`High return on equity (${(k.roe * 100).toFixed(0)}%) — management earns good returns on shareholders' money.`); if (k.roe < 0.08) cons.push(`Low return on equity (${(k.roe * 100).toFixed(1)}%).`); }
  if (isNum(k.roce) && !fin) { p.push(lerp(k.roce, 0, 1, 0.25, 10)); if (k.roce >= 0.2) pros.push(`Strong ROCE (${(k.roce * 100).toFixed(0)}%) — efficient use of capital.`); }
  const pm = isNum(k.npmFY) ? k.npmFY : k.npm; if (isNum(pm)) p.push(lerp(pm, 0, 2, 0.2, 10));
  S.Profitability = avg(p);
  // Balance sheet
  const b = [];
  if (k.negEquity) { b.push(1); cons.push('Shareholders\' equity is negative (liabilities exceed book assets) — check why (buybacks vs losses).'); }
  else if (isNum(k.de) && !fin) { b.push(lerp(k.de, 0, 10, 2, 1)); if (k.de < 0.3) pros.push(`Low debt (debt/equity ${k.de.toFixed(2)}).`); if (k.de > 1.2) cons.push(`High leverage (debt/equity ${k.de.toFixed(2)}) — more sensitive to interest rates and downturns.`); }
  if (fin && isNum(k.de)) watch.push('For banks/financials, debt/equity is structurally high and not comparable with other sectors; look at NPAs, CASA, capital adequacy instead.');
  S['Balance sheet'] = avg(b);
  // Momentum / trend
  const m = [], price = d.price;
  if (isNum(k.dma200)) { m.push(price > k.dma200 ? 7.5 : 3); (price > k.dma200 ? pros : cons).push(`Price is ${price > k.dma200 ? 'above' : 'below'} its 200-day average (${fmtP(k.dma200, d.currency)}) — long-term trend ${price > k.dma200 ? 'up' : 'weak'}.`); }
  if (isNum(k.dma50)) m.push(price > k.dma50 ? 7 : 3.5);
  if (isNum(k.dma50) && isNum(k.dma200)) m.push(k.dma50 > k.dma200 ? 7 : 3);
  if (isNum(k.rsi)) { m.push(k.rsi > 75 ? 4.5 : k.rsi < 25 ? 4 : lerp(k.rsi, 30, 4, 65, 8)); if (k.rsi > 70) watch.push(`RSI ${k.rsi.toFixed(0)} — short-term overbought; chasing after a sharp run-up carries pullback risk.`); if (k.rsi < 30) watch.push(`RSI ${k.rsi.toFixed(0)} — oversold; can bounce, but falling stocks can keep falling.`); }
  if (isNum(k.ret1y)) m.push(lerp(k.ret1y, -0.3, 1, 0.4, 10));
  if (k.cross) watch.push(`${k.cross === 'golden' ? 'Golden cross' : 'Death cross'} (50-DMA crossed ${k.cross === 'golden' ? 'above' : 'below'} 200-DMA) on ${dstr(k.crossT)}.`);
  if (isNum(k.hi52) && price < k.hi52 * 0.75) watch.push(`Trading ${((1 - price / k.hi52) * 100).toFixed(0)}% below its 52-week high.`);
  S['Momentum'] = avg(m);
  const an = d.analyst;
  if (an && (an.key || isNum(an.mean))) { const up = isNum(an.tMean) && isNum(price) && an.currency === d.currency ? an.tMean / price - 1 : undefined;
    watch.unshift(`Analyst consensus (Yahoo Finance, ${isNum(an.n) ? an.n + ' analysts' : 'count n/a'}): <b>${esc(recLabel(an))}</b>${isNum(up) ? `, mean target implies ${(up >= 0 ? '+' : '') + (up * 100).toFixed(0)}% from today` : ''}. Sell-side views are often optimistic and change quickly — treat as one input, not a verdict; not included in the score.`); }
  const avail = Object.values(S).filter(isNum), overall = avail.length >= 3 ? avg(Object.values(S)) : undefined;
  if (Math.abs(k.chgPct || 0) > 0.08) watch.push(`Unusually large one-day move (${(k.chgPct * 100).toFixed(1)}%) — check news / corporate actions (splits, bonuses, results) before reading too much into it.`);
  if (k.epsDerived) watch.push('EPS shown is derived from the reported trailing P/E (quarterly EPS history incomplete).');
  if (!avail.length) watch.push('Too little data to score this stock.');
  watch.push('Rules ignore sector context, management quality, governance, and future guidance — read the latest results, concall and annual report.');
  let verdict, col;
  if (!isNum(overall)) { verdict = 'Insufficient data for an overall score'; col = '#e2e8f0'; }
  else if (overall >= 7) { verdict = 'Strong fundamentals & trend on these rules'; col = '#dcfce7'; }
  else if (overall >= 5.5) { verdict = 'Mixed-to-positive profile'; col = '#ecfccb'; }
  else if (overall >= 4) { verdict = 'Mixed profile — some clear weaknesses'; col = '#fef9c3'; }
  else { verdict = 'Weak profile on these rules — higher risk'; col = '#fee2e2'; }
  // style hint
  let style = '';
  if (isNum(S.Valuation) && isNum(S.Growth)) style = S.Growth >= 6.5 && S.Valuation < 4.5 ? 'Looks like a "quality growth at a premium price" stock — returns depend on growth continuing.' : S.Valuation >= 6.5 && S.Growth < 4.5 ? 'Looks like a "cheap but slow" (value / possible value-trap) stock — check whether earnings are stabilising.' : S.Valuation >= 6 && S.Growth >= 6 ? 'Reasonable valuation with healthy growth — the rarer combination screens look for.' : '';
  return { S, overall, verdict, col, pros, cons, watch, style };
}

// ---------- external links & analysts ----------
// 'Full analysis' buttons for Indian stocks: outbound links only (nothing is copied from these sites).
// Direct pages come from data/x/<SYM>.json 'links' (Moneycontrol page + BSE code via ISIN, Tickertape slug); search URLs until then.
function fullAnalysisLinks(d, L) {
  const bse = d.symbol.endsWith('.BO'), sym = d.symbol.slice(0, -3), code = L.bc || (bse && ((d.penny && d.penny.code) || (d.bse && d.bse.code) || L.code)) || '';
  const nm = (d.name || '').replace(/\b(limited|ltd\.?)\s*$/i, '').trim();
  const a = (k, u, t, sub) => `<a class="btn fa" data-fa="${k}" href="${esc(u)}" target="_blank" rel="noopener"><b>${t} ↗</b><small>${sub}</small></a>`;
  return a('sc', `https://www.screener.in/company/${encodeURIComponent(bse ? (code || sym) : sym)}/consolidated/`, 'Screener', 'financials · ratios · peers') +
    a('mc', L.mc || `https://www.moneycontrol.com/stocks/cptmarket/compsearchnew.php?search_data=&cid=&mbsearch_str=&topsearch_type=1&search_str=${encodeURIComponent(nm || sym)}`, 'Moneycontrol', L.mc ? 'stock page' : 'search') +
    (bse ? '' : a('nse', `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(sym)}`, 'NSE', 'official quote')) +
    (code ? a('bse', `https://www.bseindia.com/stock-share-price/x/x/${code}/`, 'BSE', 'official quote · filings') : '') +
    a('tt', L.tt || `https://www.tickertape.in/stocks?search=${encodeURIComponent(sym)}`, 'Tickertape', L.tt ? 'stock page' : 'search');
}
function extLinks(d) {
  const a = (u, t) => `<a class="btn sec" href="${esc(u)}" target="_blank" rel="noopener">${t} ↗</a>`;
  const nm = (d.name || '').replace(/\b(limited|ltd\.?|inc\.?|corporation|corp\.?)\s*$/i, '').trim();
  if (d.symbol.match(/\.(NS|BO)$/)) return fullAnalysisLinks(d, {});
  if (d.symbol.endsWith('.BSE')) { const c = d.symbol.slice(0, -4);
    return a(`https://www.screener.in/search/?q=${encodeURIComponent(nm || c)}`, 'Search on Screener') + a(`https://www.moneycontrol.com/stocks/cptmarket/compsearchnew.php?search_data=&cid=&mbsearch_str=&topsearch_type=1&search_str=${encodeURIComponent(nm || c)}`, 'Open in Moneycontrol'); }
  return a(`https://finance.yahoo.com/quote/${encodeURIComponent(d.symbol)}/`, 'Open in Yahoo Finance');
}
const REC = { strong_buy: 'Strong Buy', buy: 'Buy', hold: 'Hold', underperform: 'Underperform', sell: 'Sell', strong_sell: 'Strong Sell' };
function recLabel(a) { const k = a.key ? (REC[a.key] || a.key) : null; return k ? k + (isNum(a.mean) ? ` (mean ${a.mean.toFixed(2)} on 1 = Strong Buy … 5 = Strong Sell)` : '') : isNum(a.mean) ? `mean ${a.mean.toFixed(2)} (1 = Strong Buy … 5 = Strong Sell)` : 'not available'; }
function analystCard(d) {
  const a = d.analyst, c = d.currency;
  if (!a) return `<div class="card"><h2>🧑‍💼 What analysts say</h2><p>${NA} — no analyst coverage data from the source for this stock.</p></div>`;
  let h = `<div class="card"><h2>🧑‍💼 What analysts say</h2><div class="kv"><div><span>Consensus</span><b>${a.key ? esc(REC[a.key] || a.key) : NA}</b></div><div><span>Mean rating (1 best – 5 worst)</span><b>${isNum(a.mean) ? a.mean.toFixed(2) : NA}</b></div><div><span>Analysts</span><b>${isNum(a.n) ? a.n : NA}</b></div></div>`;
  const t = a.trend;
  if (t) { const cols = [['strongBuy', 'Strong Buy', '#15803d'], ['buy', 'Buy', '#4ade80'], ['hold', 'Hold', '#facc15'], ['sell', 'Sell', '#f87171'], ['strongSell', 'Strong Sell', '#b91c1c']], tot = cols.reduce((s, x) => s + t[x[0]], 0);
    h += `<p class="mut" style="margin:10px 0 4px">Current-month ratings (${tot})</p><div style="display:flex;height:22px;border-radius:6px;overflow:hidden">${cols.filter(x => t[x[0]]).map(x => `<div title="${x[1]}: ${t[x[0]]}" style="width:${t[x[0]] / tot * 100}%;background:${x[2]};color:#000;font-size:11px;text-align:center;line-height:22px">${t[x[0]]}</div>`).join('')}</div>
    <div class="mut" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px">${cols.map(x => `<span><i style="display:inline-block;width:9px;height:9px;background:${x[2]};border-radius:2px"></i> ${x[1]} ${t[x[0]]}</span>`).join('')}</div>`; }
  else h += `<p class="mut">Rating breakdown: not available.</p>`;
  const same = !a.currency || a.currency === c, P = d.price;
  if (isNum(a.tLow) && isNum(a.tHigh) && same) { const lo = Math.min(a.tLow, P), hi = Math.max(a.tHigh, P), X = v => ((v - lo) / (hi - lo || 1) * 100).toFixed(1) + '%';
    const up = v => isNum(v) ? ` (${sgnPct(v / P - 1)})` : '';
    h += `<p class="mut" style="margin:12px 0 4px">12-month price targets vs current price</p><div style="position:relative;height:30px;margin:0 8px"><div style="position:absolute;top:13px;left:${X(a.tLow)};width:calc(${X(a.tHigh)} - ${X(a.tLow)});height:6px;background:#99f6e4;border-radius:3px"></div>
     ${isNum(a.tMean) ? `<div title="Mean target" style="position:absolute;top:7px;left:${X(a.tMean)};width:3px;height:18px;background:#0f766e"></div>` : ''}<div title="Current price" style="position:absolute;top:4px;left:calc(${X(P)} - 6px);font-size:14px">▼</div></div>
     <div class="kv"><div><span>Low target</span><b>${fmtP(a.tLow, c)}${up(a.tLow)}</b></div><div><span>Mean target</span><b>${fmtP(a.tMean, c)}${up(a.tMean)}</b></div><div><span>Median target</span><b>${fmtP(a.tMed, c)}${up(a.tMed)}</b></div><div><span>High target</span><b>${fmtP(a.tHigh, c)}${up(a.tHigh)}</b></div><div><span>Current price</span><b>${fmtP(P, c)}</b></div></div>`; }
  else h += `<p class="mut">Price targets: not available${!same ? ' (reported in a different currency)' : ''}.</p>`;
  return h + `<div class="src">Source: Yahoo Finance analyst data (recommendationTrend / financialData), as of ${new Date(a.asOf * 1000).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} IST. Implied upside = target ÷ current price − 1. Analyst opinions are third-party views, not advice.</div></div>`;
}

// ---------- chart ----------
function drawChart() {
  const svg = $('#chart'); if (!svg || !CUR) return; const W = svg.clientWidth || 600, H = 260, pad = { l: 8, r: 54, t: 10, b: 22 };
  const span = { '1M': 31, '6M': 183, '1Y': 366, '5Y': 1830 }[RANGE], h = CUR.hist, end = last(h)[0];
  const closes = h.map(x => x[1]), d50 = smaSeries(closes, 50), d200 = smaSeries(closes, 200);
  const idx = h.map((x, i) => i).filter(i => h[i][0] >= end - span * DAY); if (idx.length < 2) { svg.innerHTML = ''; return; }
  const pts = idx.map(i => h[i]); const vals = pts.map(x => x[1]);
  const dm = SHOW_DMA && RANGE !== '1M' && !(CUR.source || '').startsWith('Alpha') ? idx.flatMap(i => [d50[i], d200[i]]).filter(isNum) : [];
  let lo = Math.min(...vals, ...dm), hi = Math.max(...vals, ...dm); const pd = (hi - lo) * 0.06 || 1; lo -= pd; hi += pd;
  const t0 = pts[0][0], t1 = last(pts)[0], X = t => pad.l + (W - pad.l - pad.r) * (t - t0) / (t1 - t0 || 1), Y = v => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
  const path = a => a.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('');
  const up = last(vals) >= vals[0], col = up ? '#15803d' : '#b91c1c';
  let g = ''; for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, y = Y(v); g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" stroke="#e2e8f0"/><text x="${W - pad.r + 4}" y="${y + 4}" font-size="10" fill="#64748b">${v >= 1000 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(v < 10 ? 2 : 1)}</text>`; }
  for (let i = 0; i <= 3; i++) { const t = t0 + (t1 - t0) * i / 3; g += `<text x="${Math.min(X(t), W - pad.r - 30)}" y="${H - 6}" font-size="10" fill="#64748b" text-anchor="${i === 0 ? 'start' : 'middle'}">${new Date(t * 1000).toLocaleDateString('en-GB', RANGE === '5Y' ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' })}</text>`; }
  let ov = '';
  if (dm.length) { const s50 = idx.filter(i => isNum(d50[i])).map(i => [h[i][0], d50[i]]), s200 = idx.filter(i => isNum(d200[i])).map(i => [h[i][0], d200[i]]);
    if (s50.length > 1) ov += `<path d="${path(s50)}" fill="none" stroke="#f59e0b" stroke-width="1.3"/>`; if (s200.length > 1) ov += `<path d="${path(s200)}" fill="none" stroke="#6366f1" stroke-width="1.3"/>`; }
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `${g}<path d="${path(pts)}L${X(t1)} ${H - pad.b}L${X(t0)} ${H - pad.b}Z" fill="${col}" opacity=".08"/><path d="${path(pts)}" fill="none" stroke="${col}" stroke-width="1.8"/>${ov}<g id="cx" style="display:none"><line id="cxl" y1="${pad.t}" y2="${H - pad.b}" stroke="#94a3b8" stroke-dasharray="3 3"/><circle id="cxc" r="4" fill="${col}"/></g>`;
  const rch = ((last(vals) / vals[0]) - 1);
  $('#rchg').innerHTML = `${RANGE} change: ${sgnPct(rch)}` + (dm.length ? ' &nbsp;<span style="color:#f59e0b">— 50-DMA</span> <span style="color:#6366f1">— 200-DMA</span>' : '');
  const tip = $('#tip');
  const move = e => { const r = svg.getBoundingClientRect(), x = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) * W / r.width;
    let best = 0, bd = Infinity; pts.forEach((p, i) => { const dd = Math.abs(X(p[0]) - x); if (dd < bd) { bd = dd; best = i; } });
    const p = pts[best]; $('#cx').style.display = ''; $('#cxl').setAttribute('x1', X(p[0])); $('#cxl').setAttribute('x2', X(p[0])); $('#cxc').setAttribute('cx', X(p[0])); $('#cxc').setAttribute('cy', Y(p[1]));
    tip.innerHTML = `${dstr(p[0])}: <b>${fmtP(p[1], CUR.currency)}</b> ${sgnPct(p[1] / vals[0] - 1)} vs start`; };
  const leave = () => { $('#cx').style.display = 'none'; tip.innerHTML = '&nbsp;'; };
  svg.onmousemove = move; svg.ontouchstart = move; svg.ontouchmove = move; svg.onmouseleave = leave; svg.ontouchend = leave;
}

// ---------- render ----------
function render() {
  const d = CUR, k = compute(d), A = d.etf ? null : analyse(d, k), c = d.currency, v = $('#view'); updFav(); const RPT = d.etf ? { html: etfBody(d, k), R: null } : fullReport(d, k, A);
  const base = d.symbol.replace(/\.(NS|BO)$/, '');
  // doubtful values (inconsistent / uncertain data) are shown in red with ⚠ — see doubt.js
  if (typeof doubtsFor === 'function') DQ = doubtsFor(d, k); const Q = typeof dq === 'function' ? dq : (f, h) => h;
  const scoreRow = (n, s) => `<div class="score"><span class="l">${n}</span><span class="bar"><i style="width:${isNum(s) ? s * 10 : 0}%;background:${!isNum(s) ? '#cbd5e1' : s >= 7 ? '#16a34a' : s >= 4.5 ? '#eab308' : '#dc2626'}"></i></span><span class="v">${isNum(s) ? s.toFixed(1) + '/10' : '<span class="mut">n/a</span>'}</span></div>`;
  const q = k.quarters, unit = c === 'INR' ? 'Cr' : 'M', div = c === 'INR' ? 1e7 : 1e6;
  const qn = x => isNum(x) ? (x / div).toLocaleString(c === 'INR' ? 'en-IN' : 'en-US', { maximumFractionDigits: 0 }) : '<span class="mut">n/a</span>';
  const ageH = (Date.now() / 1000 - (d.fetched || 0)) / 3600;
  const KEYCARD = d.etf ? '' : `   <div class="card"><h2>Key numbers</h2><div class="kv">
    <div><span>Market cap</span><b>${fmtBig(k.mcap, c)}</b></div>
    <div><span>P/E (TTM)</span><b>${k.loss ? 'n/m (loss)' : isNum(k.pe) ? Q('pe', k.pe.toFixed(1)) : NA}</b></div>
    <div><span>P/B</span><b>${isNum(k.pb) ? Q('pb', k.pb.toFixed(2)) : NA}</b></div>
    <div><span>EPS (TTM)${k.epsDerived ? '*' : ''}</span><b>${isNum(k.eps) ? Q('eps', fmtP(k.eps, c)) : fmtP(k.eps, c)}</b></div>
    <div><span>Dividend yield</span><b>${isNum(k.dy) ? Q('dy', fmtPct(k.dy, 2)) : NA}</b></div>
    <div><span>52-wk high / low</span><b>${isNum(k.hi52) ? Q('hist', fmtP(k.hi52, c) + ' / ' + fmtP(k.lo52, c)) : NA}</b></div>
    <div><span>ROE ${k.fy ? '(FY ' + k.fy.slice(0, 4) + ')' : ''}</span><b>${isNum(k.roe) ? Q('roe', fmtPct(k.roe)) : fmtPct(k.roe)}</b></div>
    <div><span>ROCE ${k.fy ? '(FY ' + k.fy.slice(0, 4) + ')' : ''}</span><b>${isNum(k.roce) ? Q('roce', fmtPct(k.roce)) : fmtPct(k.roce)}</b></div>
    <div><span>Debt / equity</span><b>${k.negEquity ? 'negative equity' : isNum(k.de) ? Q('de', k.de.toFixed(2)) : NA}</b></div>
    <div><span>50 / 200 DMA</span><b>${isNum(k.dma50) || isNum(k.dma200) ? Q('hist', `${isNum(k.dma50) ? fmtP(k.dma50, c) : NA} / ${isNum(k.dma200) ? fmtP(k.dma200, c) : NA}`) : `${NA} / ${NA}`}</b></div>
    <div><span>RSI (14)</span><b>${isNum(k.rsi) ? k.rsi.toFixed(0) : NA}</b></div>
    <div><span>1-yr return</span><b>${isNum(k.ret1y) ? Q('ret1y', sgnPct(k.ret1y)) : NA}</b></div>
   </div></div>`;
  const QUARTCARD = d.etf ? '' : `  <div class="card"><h2>Quarterly results <span class="mut">(${c === 'INR' ? '₹ Crore' : cur(c) + ' million'}; EPS in ${cur(c)})</span></h2>
   ${q.length ? `<div class="tw"><table><tr><th>Quarter</th><th>Revenue</th><th>QoQ</th><th>YoY</th><th>Net profit</th><th>QoQ</th><th>YoY</th><th>EPS</th><th>EPS YoY</th></tr>
   ${q.slice().reverse().map(r => `<tr><td>${qlabel(r.dt)}</td><td>${qn(r.rev)}</td><td>${sgnPct(r.revQoQ)}</td><td>${sgnPct(r.revYoY)}</td><td>${qn(r.ni)}</td><td>${sgnPct(r.niQoQ)}</td><td>${sgnPct(r.niYoY)}</td><td>${isNum(r.eps) ? r.eps.toFixed(2) : '<span class="mut">n/a</span>'}</td><td>${sgnPct(r.epsYoY)}</td></tr>`).join('')}</table></div>
   <p class="mut">${q.length < 8 ? `Only ${q.length} quarter(s) available from the data source; growth is shown only where the matching earlier quarter exists (– = not available). ` : ''}Figures as reported by the source (consolidated where provided).${d.fx ? (d.fx.rate ? ` Statements reported in ${esc(d.fx.from)}; converted to ${esc(d.fx.to)} at today's rate ${d.fx.rate} (growth rates unaffected; absolute values approximate).` : ` Statements reported in ${esc(d.fx.from)} and could not be converted — fundamentals omitted.`) : ''}</p>` : `<p>${NA} — no quarterly results from the data source for this stock.</p>`}
  </div>`;
  v.innerHTML = `
  <div class="card"><a href="#" id="back" class="mut">← Back</a>
   <div style="margin-top:6px"><b style="font-size:20px">${esc(d.name)}</b><span class="tag">${esc(base)}</span>${typeof capBadge === 'function' ? capBadge(d.cap || capOf(d.symbol)) : ''}${d.penny ? `<span class="tag capb" style="background:#a16207;color:#fff">Penny</span>${d.penny.surv ? survTag(d.penny.surv) : ''}` : ''} <span class="mut">${esc(d.exchange || '')}${d.sector ? ' · ' + esc(d.sector) : ''}</span></div>
   <div style="margin-top:4px"><span class="px">${Q('price', fmtP(d.price, c))}</span><span class="chg ${k.chg >= 0 ? 'up' : 'dn'}">${isNum(k.chg) ? (k.chg >= 0 ? '▲ +' : '▼ ') + k.chg.toFixed(2) + ' (' + (k.chgPct * 100).toFixed(2) + '%)' : ''}</span></div>
   <div class="mut">${d.liveNote ? d.liveNote : `Last price ${d.priceTime ? 'as of ' + new Date(d.priceTime * 1000).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) + ' IST' : ''} · fundamentals ${ageH < 1 ? 'under 1 h' : Math.round(ageH) + ' h'} old · price may be delayed ~5–15 min`}</div>
   ${d.penny ? PENNYWARN.replace('(shown as a red tag)', d.penny.surv ? `— <b>this stock is currently flagged: ${esc(d.penny.surv)}</b> (NSE list)` : d.penny.src === 'BSE' ? '— ASM/GSM status for BSE-only stocks is not available here; check bseindia.com' : '— not on NSE\'s current ASM/GSM lists') : ''}
   ${typeof srcLine === 'function' ? srcLine(d) : ''}
   ${typeof doubtBanner === 'function' ? doubtBanner() : ''}
   ${d.symbol.match(/\.(NS|BO)$/) ? `<div class="fullan"><h3 class="nogq">🔎 Full analysis <span class="mut">— open this stock on trusted sites (new tab)</span></h3><div class="links" id="falinks">${extLinks(d)}</div></div>` : `<div class="links">${extLinks(d)}</div>`}
   <button class="btn sec" id="alBtn" style="margin-top:8px">🔔 Set alert</button>${(AL().alerts || []).some(a => a.s === d.symbol) ? ` <a href="#alerts" class="mut">${AL().alerts.filter(a => a.s === d.symbol).length} alert(s) — manage</a>` : ''}
   ${LS.get('avkey', '') ? '<button class="btn sec" id="liveBtn" style="margin-top:8px">↻ Live price</button>' : ''}
  </div>
  <div class="grid two">
   <div class="card"><h2>${Q('hist', 'Price chart')}</h2><div class="tabs" id="rng">${['1D', '1W', '1M', '6M', '1Y', '5Y'].map(r => `<button class="${r === RANGE ? 'on' : ''}">${r}</button>`).join('')}<button id="dmaT" class="${SHOW_DMA ? 'on' : ''}">DMA</button></div>
    <div class="mut" id="tip">&nbsp;</div><svg id="chart"></svg><div class="mut" id="rchg"></div></div>
   ${d.etf ? etfKeyCard(d, k) : KEYCARD}
  </div>
  ${typeof autoSection === 'function' ? autoSection(d, k, A, RPT.R) : ''}
  ${typeof corpPlaceholder === 'function' ? corpPlaceholder(d) : ''}
  ${d.etf ? '' : QUARTCARD}
  ${d.etf ? '' : (typeof moatSection === 'function' ? moatSection(d, k) : '')}
  ${RPT.html}`;
  $('#back').onclick = e => { e.preventDefault(); goHome(); };
  $('#rng').querySelectorAll('button').forEach(b => b.onclick = () => { if (b.id === 'dmaT') SHOW_DMA = !SHOW_DMA; else RANGE = b.textContent; const y = window.scrollY; d._keepScroll = true; render(); window.scrollTo(0, y); });
  if ($('#liveBtn')) $('#liveBtn').onclick = liveQuote;
  if (!d.etf) { bindIV(d, k); bindReport(d, k, RPT.R); } autoGloss(v);
  v.querySelectorAll('[data-jump]').forEach(a => a.onclick = e => { e.preventDefault(); const t = document.getElementById(a.dataset.jump); if (t.tagName === 'DETAILS') t.open = true; t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  if (typeof corpLoad === 'function' && !d.etf) corpLoad(d, k, RPT.R, A); else if (typeof autoUpdate === 'function' && d.etf) autoUpdate(d, k, A, RPT.R, {}); drawChart(); if (!d._keepScroll) window.scrollTo(0, 0); d._keepScroll = false;
}
window.addEventListener('resize', () => { clearTimeout(window._rz); window._rz = setTimeout(drawChart, 150); });

// ---------- watchlist & settings ----------
function updFav() { const f = LS.get('fav', []); $('#favBtn').style.visibility = CUR ? 'visible' : 'hidden'; if (CUR) $('#favBtn').textContent = f.includes(CUR.symbol) ? '★' : '☆'; }
$('#favBtn').onclick = () => { if (!CUR) return; let f = LS.get('fav', []); f = f.includes(CUR.symbol) ? f.filter(x => x !== CUR.symbol) : [CUR.symbol, ...f].slice(0, 20); LS.set('fav', f); updFav(); };
$('#setBtn').onclick = () => { $('#avkey').value = LS.get('avkey', ''); $('#ghpat').value = LS.get('ghpat', ''); $('#fullRef').checked = LS.get('fullRefresh', false); if (typeof AL === 'function') { const t = AL().topic; $('#ntfyTopic').textContent = t; $('#ntfyLink').href = 'https://ntfy.sh/' + t; } $('#dlg').showModal(); };
$('#saveSet').onclick = () => { LS.set('avkey', $('#avkey').value.trim()); LS.set('ghpat', $('#ghpat').value.trim()); LS.set('fullRefresh', $('#fullRef').checked); $('#dlg').close(); if (CUR) render(); };
$('#clrCache').onclick = () => { Object.keys(localStorage).filter(k => k.startsWith('av:')).forEach(k => localStorage.removeItem(k)); $('#clrCache').textContent = 'Cleared'; };
$('#dlg').addEventListener('click', e => { if (e.target === $('#dlg')) $('#dlg').close(); });

loadIndex().then(() => { const h = decodeURIComponent(location.hash.slice(1)); if (h === 'glossary') showGlossary(); else if (h === 'alerts') showAlerts(); else if (h.startsWith('sector:')) openSector(h.slice(7)); else if (h) { const [sy, jump] = h.split('@'); openSym(sy.replace(/~av$/, ''), sy.endsWith('~av')).then(() => { const t = jump && document.getElementById(jump); if (t) { t.open = true; window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY - 160); } }); } renderLists(LISTTAB); });
window.addEventListener('popstate', () => { if (!location.hash) goHome(true); });
window.addEventListener('hashchange', () => { const h = decodeURIComponent(location.hash.slice(1)); if (!h) return goHome(true); if (h === 'glossary') return showGlossary(); if (h === 'alerts') return showAlerts(); if (h.startsWith('sector:')) openSector(h.slice(7)); else { const sy = h.split('@')[0].replace(/~av$/, ''); if (!CUR || CUR.symbol !== sy) openSym(sy, h.split('@')[0].endsWith('~av')); } });
document.querySelectorAll('#ltabs button').forEach(b => b.onclick = () => { LISTTAB = b.dataset.t; document.querySelectorAll('#ltabs button').forEach(x => x.classList.toggle('on', x === b)); renderLists(LISTTAB); });
updFav();
document.getElementById('tokHow').onclick = e => { e.preventDefault(); document.getElementById('dlg').close(); document.getElementById('tokHelp').showModal(); };
