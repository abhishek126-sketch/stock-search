'use strict';
// ===== Live refresh: quotes overlay, 60-s polling, manual refresh, "Update now" via workflow_dispatch =====
const REPO = 'abhishek126-sketch/stock-search';
let QUOTES = null, META = null, LIVE_BUSY = false, CHECK = null;
const bust = u => u + (u.includes('?') ? '&' : '?') + 't=' + Date.now();
const tIST = s => new Date(s * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
function applyQuote(d) {
  // safety net: a "current price" more than 3 days older than the latest daily close is a frozen Yahoo quote -> use that close
  if (d.hist && d.hist.length && isNum(d.hist[d.hist.length - 1][1]) && (d.priceTime || 0) < d.hist[d.hist.length - 1][0] - 3 * DAY) {
    const h = d.hist; d.price = h[h.length - 1][1]; d.priceTime = h[h.length - 1][0]; if (h.length > 1) d.prevClose = h[h.length - 2][1];
  }
  const q = QUOTES && QUOTES.q && QUOTES.q[d.symbol]; if (!q || !d.hist || !d.hist.length) return d;
  const [p, pc, t] = q; if (!isNum(p) || !t || t <= (d.priceTime || 0)) return d;
  d.price = p; if (isNum(pc)) d.prevClose = pc; d.priceTime = t; d.liveNote = null; d.quoteFrom = QUOTES.built;
  const lastT = d.hist[d.hist.length - 1][0];
  if (new Date(t * 1000).toDateString() === new Date(lastT * 1000).toDateString()) d.hist[d.hist.length - 1] = [lastT, p]; else if (t > lastT) d.hist.push([t, p]);
  return d;
}
async function loadQuotes(force) {
  await Promise.all([getJSON(bust(DATA + 'quotes.json')).then(x => QUOTES = x).catch(() => { }),
    getJSON(bust(DATA + 'check.json')).then(x => CHECK = x).catch(() => { })]);
  renderCheck();
}
// ---- second-source cross-check (NSE for India, Finnhub for US) ----
const istDay = t => t ? new Date(t * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : '';
// an Indian exchange's own price (NSE for .NS stocks, BSE for BSE-only .BO stocks)
const isEx = s => s === 'NSE' || s === 'BSE';
// returns preferred [price, prevClose, time, source, checkEntry] given Yahoo values
function prefQuote(sym, p, pc, t) {
  const c = CHECK && CHECK.s && CHECK.s[sym];
  // After the close: the exchange's official closing price for the same session always wins (even when it agrees within 1%);
  // it is also used whenever it is from a later session than Yahoo's price (Yahoo stale / missing a session)
  if (c && isEx(c.src) && isNum(c.p) && ((c.mode === 'eod' && istDay(c.t) === istDay(t)) || (c.st === 'mm' && c.mode === 'live') || (c.t || 0) > (t || 0) + 12 * 3600)) return [c.p, isNum(c.pc) ? c.pc : pc, c.mode === 'live' || (c.t || 0) > (t || 0) ? c.t : t, c.src, c];
  return [p, pc, t, 'Yahoo', c];
}
function applyCheck(d) {
  const [p, pc, t, src, c] = prefQuote(d.symbol, d.price, d.prevClose, d.priceTime);
  if (isEx(src)) { d.yPrice = d.price; d.yTime = d.priceTime; d.price = p; d.prevClose = pc; d.priceTime = t; const h = d.hist;
    if (h && h.length && istDay(h[h.length - 1][0]) === istDay(t)) h[h.length - 1] = [h[h.length - 1][0], p]; else if (h && h.length && t > h[h.length - 1][0]) h.push([t, p]); }
  d.priceSrc = src; d.check = c || null; return d;
}
const dPlain = iso => iso ? new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
function srcLine(d) {
  const c = d.check, ccy = d.currency, us = !/\.(NS|BO)$/.test(d.symbol);
  const what = c ? (isEx(c.src) ? (c.mode === 'live' ? c.src + "'s live price" : c.src + "'s official closing price for " + dPlain(istDay(c.t))) : "Finnhub's price") : '';
  if (isEx(d.priceSrc) && c && c.st !== 'mm') return d.yTime && istDay(d.yTime) === istDay(c.t)
    ? `<div class="mut"><span class="up">✔</span> Price is ${what} (market closed)${c.st === 'ok' ? ` · Yahoo Finance agreed within 1% (${fmtP(d.yPrice, ccy)})` : ''}.</div>`
    : `<div class="mut">Price is ${what} (${fmtP(c.p, ccy)}). Yahoo Finance's latest price is older${d.yTime ? ' (' + dPlain(istDay(d.yTime)) + ')' : ''}, so ${c.src}'s is shown.</div>`;
  // no cross-check row (NSE SME / some BSE stocks), but the refresh already set the exchange's official close for this session
  if ((!c || !c.st) && d.exClose && isEx(d.exClose.ex) && istDay(d.priceTime) === d.exClose.day)
    return `<div class="mut"><span class="up">✔</span> Price is ${d.exClose.ex}'s official closing price for ${dPlain(d.exClose.day)}.</div>`;
  if (!c || !c.st) return `<div class="mut">Price from Yahoo Finance. ${us ? (CHECK && CHECK.fh && CHECK.fh.mode === 'no-key' ? 'Not double-checked (US price check is off until a Finnhub key is added).' : 'Not double-checked yet — US stocks are checked a few at a time.') : 'Not double-checked yet.'}</div>`;
  if (c.st === 'ok') return `<div class="mut">Price from Yahoo Finance · <span class="up">✔ matches</span> ${what} (${fmtP(c.p, ccy)}).</div>`;
  const yq = QUOTES && QUOTES.q && QUOTES.q[d.symbol], frozen = yq && isNum(yq[2]) && Date.now() / 1000 - yq[2] > 20 * DAY;
  if (frozen) return `<div class="mut doubt" style="text-decoration:none">⚠ Yahoo Finance's price is frozen at ${fmtP(yq[0], ccy)} (from ${dPlain(istDay(yq[2]))}); ${what} is ${fmtP(c.p, ccy)}. Showing ${isEx(c.src) ? c.src : 'the exchange'}'s price.</div>`;
  return `<div class="mut doubt" style="text-decoration:none">⚠ Yahoo shows ${fmtP(isEx(d.priceSrc) ? d.yPrice : d.price, ccy)} but ${what} is ${fmtP(c.p, ccy)} (${(c.d * 100).toFixed(1)}% apart). ${isEx(d.priceSrc) ? `Showing ${d.priceSrc}'s price.` : "Showing Yahoo's newer price."}</div>`;
}
function renderCheck() {
  const el = document.getElementById('dcheck'); if (!el) return;
  if (!CHECK) { el.innerHTML = '<h2>🔎 Data check</h2><p class="mut">The price double-check isn\'t available yet.</p>'; return; }
  const n = CHECK.nse || {}, f = CHECK.fh || {}, mm = CHECK.mm || [], S = CHECK.s || {};
  const nUs = Object.values(S).filter(v => v.src === 'Finnhub').length;
  const b = CHECK.bse || {};
  const nseTxt = (n.mode === 'live' ? `Indian prices are double-checked against NSE's live prices (${n.n} stocks).` : n.mode === 'eod' ? `During market hours prices come from Yahoo every 5 minutes. After the close, NSE stocks show NSE's official closing price (latest: ${dPlain(n.date)}, ${n.n} stocks)` : "Indian price check: NSE couldn't be reached this time; prices come from Yahoo.")
    + (n.mode === 'eod' ? (b.mode === 'eod' ? ` and BSE-only stocks show BSE's (latest: ${dPlain(b.date)}, ${b.n} stocks).` : '; BSE-only stocks: BSE\'s closing file wasn\'t available this time, so they show Yahoo\'s price.') : '');
  const fhTxt = f.mode === 'live' ? `US prices are double-checked against Finnhub, a few stocks at a time (${nUs} checked in the last day).` : f.mode === 'no-key' ? 'US price check: off until a Finnhub key is added.' : "US price check: Finnhub isn't responding right now.";
  const mmTxt = mm.length ? `${mm.length} stock${mm.length > 1 ? 's' : ''} differ by more than 1% between sources — for Indian stocks we show the exchange's price.` : 'All checked prices agree (within 1%).';
  const row = s => { const c = S[s]; return `<tr data-s="${esc(s)}"><td>${esc(s.replace(/\.(NS|BO)$/, ''))}</td><td>${esc(c.src)}</td><td>${fmtP(c.p, s.match(/\.(NS|BO)$/) ? 'INR' : 'USD')}</td><td>${(c.d * 100).toFixed(1)}%</td></tr>`; };
  el.innerHTML = `<h2>🔎 Data check <span class="mut">(${CHECK.nOk} ✔ match · ${mm.length} ⚠ differ)</span></h2><p class="mut">${nseTxt}<br>${fhTxt}<br>${mmTxt}<br>Last checked ${tIST(CHECK.built)} IST.</p>
  ${mm.length ? `<details><summary class="mut">Show the ${mm.length} stocks that differ</summary><div class="tw"><table class="pt"><tr><th>Stock</th><th>Checked against</th><th>Their price</th><th>Gap vs Yahoo</th></tr>${mm.map(row).join('')}</table></div></details>` : ''}`;
  el.querySelectorAll('[data-s]').forEach(r => r.onclick = () => openSym(r.dataset.s));
}
// is a market session open right now? India 09:15–15:30 IST, US ≈ 19:00–02:30 IST (Mon–Fri; exchange holidays not known)
function marketOpen() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const m = +p.hour * 60 + +p.minute, wd = p.weekday, wk = !['Sat', 'Sun'].includes(wd);
  if (wk && m >= 555 && m <= 930) return 'India';
  if ((wk && m >= 1140) || (m <= 150 && !['Sun', 'Mon'].includes(wd))) return 'US';
  return '';
}
function setStatus(extra) {
  const el = $('#live'); if (!el) return;
  const ts = META ? Math.max(META.quotes || 0, META.full || 0) : (QUOTES && QUOTES.built);
  const qt = META ? META.quotes : (QUOTES && QUOTES.built), mk = marketOpen(), age = qt ? Math.round((Date.now() / 1000 - qt) / 60) : 0;
  const stale = mk && age > 25 ? ` · <span style="color:var(--warn)">⚠ ${mk} market is open but prices are ${age >= 120 ? Math.round(age / 60) + ' h' : age + ' min'} old — tap ⚡ Update now</span>` : '';
  el.querySelector('.st').innerHTML = (ts ? `Updated <b>${tIST(ts)} IST</b>` : 'Update time n/a') + ` · checking every minute${stale}${extra ? ' · ' + extra : ''}`;
}
async function checkMeta(manual) {
  if (LIVE_BUSY) return; LIVE_BUSY = true;
  try {
    const m = await getJSON1(bust(DATA + 'meta.json'));
    const newQ = !META || m.quotes > (META.quotes || 0), newF = META && m.full > (META.full || 0);
    const first = !META; META = m;
    if (newF) { SUMMARY = null; await ensureSummary(); try { const d = await getJSON1(bust(DATA + 'index.json')); INDEX = d.symbols; } catch { } }
    if (newQ || newF || manual) await loadQuotes(true);
    if (CUR && !first && (newQ || newF || manual) && INDEX.some(r => r[0] === CUR.symbol)) {
      const y = window.scrollY, open = [...document.querySelectorAll('#view details')].map(x => x.open);
      let d = CUR; if (newF || manual) { try { d = await getJSON1(bust(DATA + 's/' + encodeURIComponent(CUR.symbol) + '.json')); } catch { } }
      CUR = applyQuote(d); CUR._keepScroll = true; render(); window.scrollTo(0, y);
      document.querySelectorAll('#view details').forEach((x, i) => { if (open[i] !== undefined) x.open = open[i]; });
    }
    setStatus(manual ? 'refreshed' : '');
  } catch (e) { setStatus('<span class="dn">check failed (offline?)</span>'); }
  LIVE_BUSY = false;
}
setInterval(() => { if (document.visibilityState === 'visible') checkMeta(false); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkMeta(false); });

// ---- Update now (workflow_dispatch with the user's own fine-grained token) ----
async function gh(path, opt = {}) {
  const tok = LS.get('ghpat', '');
  const r = await fetch('https://api.github.com/repos/' + REPO + path, { ...opt, headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + tok, 'X-GitHub-Api-Version': '2022-11-28', ...(opt.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (!r.ok) { let m = ''; try { m = (await r.json()).message; } catch { } throw new Error(r.status === 401 ? 'Token invalid or expired (401).' : r.status === 403 || r.status === 404 ? `Token lacks access (needs this repo + Actions: Read and write) — ${r.status} ${m}` : `GitHub API ${r.status} ${m}`); }
  return r.status === 204 ? null : r.json();
}
async function updateNow() {
  const btn = $('#updBtn');
  if (!LS.get('ghpat', '')) { $('#tokHelp').showModal(); return; }
  const wf = LS.get('fullRefresh', false) ? 'data.yml' : 'quotes.yml', t0 = Date.now() - 15000;
  btn.disabled = true; const done = msg => { btn.disabled = false; btn.textContent = '⚡ Update now'; setStatus(msg); };
  try {
    btn.textContent = 'Starting…';
    await gh(`/actions/workflows/${wf}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
    let run = null;
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const rs = await gh(`/actions/workflows/${wf}/runs?event=workflow_dispatch&per_page=5`);
      run = (rs.workflow_runs || []).find(x => Date.parse(x.created_at) >= t0) || run;
      if (!run) { btn.textContent = 'Queued…'; continue; }
      const secs = Math.round((Date.now() - Date.parse(run.created_at)) / 1000);
      btn.textContent = (run.status === 'completed' ? 'Finishing…' : run.status === 'in_progress' ? 'Running…' : 'Queued…') + ` ${secs}s`;
      if (run.status === 'completed') break;
    }
    if (!run || run.status !== 'completed') return done('<span class="dn">update still running — will appear automatically</span>');
    if (run.conclusion !== 'success') return done(`<span class="dn">update ${esc(run.conclusion)}</span> <a href="${esc(safeUrl(run.html_url))}" target="_blank" rel="noopener">log</a>`);
    for (let i = 0; i < 6; i++) { const before = META && META.quotes; await checkMeta(true); if (META && META.quotes !== before) break; await new Promise(r => setTimeout(r, 5000)); }
    done('✔ updated just now');
  } catch (e) { done(`<span class="dn">${esc(e.message)}</span>`); }
}
$('#refBtn').onclick = () => checkMeta(true);
$('#updBtn').onclick = updateNow;
document.querySelectorAll('[data-tokset]').forEach(b => b.onclick = () => { $('#tokHelp').close(); $('#setBtn').click(); });
// boot: overlay quotes before first render
const _applyQuote = applyQuote; applyQuote = d => applyCheck(_applyQuote(d));
const _openSym = openSym;
openSym = async function (sym, viaAV) { if (!QUOTES) await loadQuotes(false); return _openSym(sym, viaAV); };
checkMeta(false);
