'use strict';
// ===== SWOT: strengths, weaknesses, opportunities, threats — built only from data the app already holds
// (NSE results / Yahoo statements, price history, the app's valuation models, NSE filings, shareholding, pledge,
// surveillance, swing and earnings-momentum scans). Nothing is copied from Moneycontrol, Screener or other sites.
// Strengths / weaknesses = the business itself; opportunities / threats = price, valuation and events around it.
const SWOTK = [['S', '💪 Strengths', '#166534', '#f0fdf4', '#bbf7d0'], ['W', '🩹 Weaknesses', '#92400e', '#fffbeb', '#fde68a'],
  ['O', '🌱 Opportunities', '#1e40af', '#eff6ff', '#bfdbfe'], ['T', '⛈️ Threats', '#991b1b', '#fef2f2', '#fecaca']];
// rule texts from analyse() / reportSections() that are about price or valuation, not the business
const SWOT_OPP = /P\/E of .* is low|near book value|Dividend yield|above its 200-day|PEG .* reasonably priced|below the median of .* intrinsic/i;
const SWOT_THR = /P\/E of .* is high|below its 200-day|Very volatile|above the median intrinsic|red flags raised/i;
const swFd = s => s ? new Date((typeof s === 'number' ? s * 1000 : Date.parse(s + 'T00:00:00'))).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

// part built when the report renders (no filings needed)
function swotBase(d, k, R, pros, cons, watch) {
  const L = { S: [], W: [], O: [], T: [] }, add = (q, t, src) => L[q].push({ t, src });
  const fin = d.fundNSE ? 'NSE results' : 'Yahoo Finance', c = d.currency, P = d.price;
  for (const p of pros) SWOT_OPP.test(p) ? add('O', p, /200-day/.test(p) ? 'price chart' : 'valuation') : add('S', p, /200-day|RSI/.test(p) ? 'price chart' : fin);
  for (const p of cons) SWOT_THR.test(p) ? add('T', p, /200-day|volatile/i.test(p) ? 'price chart' : /red flags/.test(p) ? 'app checks' : 'valuation') : add('W', p, fin);
  for (const w of watch || []) {
    if (/overbought/.test(w)) add('T', w, 'price chart');
    else if (/^Death cross/.test(w)) add('T', w, 'price chart');
    else if (/^Golden cross/.test(w)) add('O', w, 'price chart');
  }
  // valuation versus the sector median
  const S = R && R.S;
  if (S && isNum(S.pe) && isNum(k.pe) && k.pe > 0 && !k.loss) {
    if (k.pe > 1.5 * S.pe) add('T', `Valued at ${k.pe.toFixed(1)}× earnings, ${(k.pe / S.pe).toFixed(1)}× its sector median (${S.pe.toFixed(1)}×) — less room for disappointment.`, 'valuation');
    else if (k.pe < 0.7 * S.pe) add('O', `Valued at ${k.pe.toFixed(1)}× earnings versus a sector median of ${S.pe.toFixed(1)}× — cheaper than peers.`, 'valuation');
  }
  // analysts (same currency only)
  const a = d.analyst;
  if (a && isNum(a.tMean) && isNum(P) && P > 0 && (!a.currency || a.currency === c) && (!isNum(a.n) || a.n >= 3)) {
    const up = a.tMean / P - 1;
    if (up > 0.15) add('O', `Analysts' average 12-month target ${fmtP(a.tMean, c)} is ${Math.round(up * 100)}% above the price${isNum(a.n) ? ` (${a.n} analysts)` : ''}.`, 'Yahoo analyst data');
    else if (up < -0.1) add('T', `Analysts' average 12-month target ${fmtP(a.tMean, c)} is ${Math.round(-up * 100)}% below the price${isNum(a.n) ? ` (${a.n} analysts)` : ''}.`, 'Yahoo analyst data');
  }
  // swing setup
  const sw = d.swing;
  if (sw && sw.t && sw.st === 'ready') add('O', `Swing setup ready: ${sw.t === 'breakout' ? 'breakout' : 'pullback'} — buy only above ₹${sw.e}, stop-loss ₹${sw.sl}.`, 'swing scan');
  // results soon
  const now = Date.now() / 1000, ed = ((d.profile && d.profile.earnDates) || []).find(t => t > now - 86400 && t < now + 10 * 86400);
  if (ed) add('T', `Results due around ${swFd(ed)} — the price can gap either way.`, 'results calendar');
  return L;
}

// part that needs the stock's exchange data (x/<SYM>.json) and the earnings-momentum scan
function swotCorp(d, x, mom) {
  const L = { S: [], W: [], O: [], T: [] }, add = (q, t, src) => L[q].push({ t, src });
  if (!x) return L;
  const pl = x.pledge, plSrc = pl && pl.src === 'shp' ? 'shareholding filing' : 'NSE pledge data';
  if (pl && isNum(pl.pp) && pl.pp > 5) add('T', `${pl.pp.toFixed(1)}% of promoter shares are pledged${pl.pp > 25 ? ' — serious: lenders can sell them if the price falls' : ''}.`, plSrc);
  const pr = x.prom || [];
  if (pr.length >= 2) {
    const b = pr[pr.length - 1], a = pr[Math.max(0, pr.length - 5)], ch = b[1] - a[1];
    if (ch <= -1) add('T', `Promoters cut their stake from ${a[1].toFixed(1)}% to ${b[1].toFixed(1)}% over ${pr.length - 1 - Math.max(0, pr.length - 5)} quarters.`, 'NSE shareholding');
    else if (ch >= 1) add('S', `Promoters raised their stake from ${a[1].toFixed(1)}% to ${b[1].toFixed(1)}%.`, 'NSE shareholding');
    if (b[1] >= 50 && ch > -1) add('S', `Promoters own ${b[1].toFixed(1)}% — strong owner commitment.`, 'NSE shareholding');
    else if (b[1] > 0 && b[1] < 25) add('W', `Promoters own only ${b[1].toFixed(1)}%.`, 'NSE shareholding');
  }
  const inst = (x.inst || []).filter(q => isNum(q[1]));
  if (inst.length >= 2) { const a = inst[inst.length - 2], b = inst[inst.length - 1], ch = b[1] - a[1];
    if (ch >= 1) add('S', `Foreign investors (FIIs) raised their holding from ${a[1].toFixed(1)}% to ${b[1].toFixed(1)}% last quarter.`, 'NSE shareholding');
    else if (ch <= -1) add('T', `Foreign investors (FIIs) cut their holding from ${a[1].toFixed(1)}% to ${b[1].toFixed(1)}% last quarter.`, 'NSE shareholding'); }
  const sv = x.surv || (d.penny && d.penny.surv);
  if (sv) add('T', `Under exchange surveillance (${esc(sv)}) — stricter trading rules and higher margins apply.`, 'NSE surveillance list');
  if ((x.aud || []).length) add('T', `${x.audBad ? 'Auditor resigned' : 'Auditor changed'} (${swFd(x.aud[0].d)}) — read the reason in the filing.`, 'exchange filing');
  // filings of the last 6 months: growth plans, orders, legal matters
  if (typeof growthCats === 'function') {
    const since = new Date(Date.now() - 183 * 864e5).toISOString().slice(0, 10), F = (x.ann || []).filter(a => a.d >= since).map(a => ({ ...a, g: growthCats(a.t, a.g) }));
    const one = (key, q, what) => { const m = F.filter(a => a.g.has(key)); if (!m.length) return;
      const l = m[0], txt = l.t.length > 110 ? l.t.slice(0, 107) + '…' : l.t;
      add(q, `${m.length} ${what} filing${m.length === 1 ? '' : 's'} in the last 6 months — latest ${swFd(l.d)}: ${l.u ? `<a href="${esc(safeUrl(l.u))}" target="_blank" rel="noopener">${esc(txt)}</a>` : esc(txt)}`, 'exchange filing'); };
    one('order', 'O', 'order / contract'); one('expansion', 'O', 'expansion / new-business'); one('legal', 'T', 'legal / regulatory');
  }
  // earnings-momentum scan
  const r = mom && mom.list && mom.list.find(z => z.s === d.symbol);
  if (r) add('O', `Passes your earnings-momentum screen (latest-quarter profit ${r.qg === 'turn' ? 'loss → profit' : '+' + r.qg + '%'}, 5-year ${r.g5 === 'turn' ? 'loss → profit' : r.g5 + '% a year'})${['vcp', 'tight', 'pullback'].includes(r.t) ? ' with an actionable chart setup' : ''}.`, 'momentum scan');
  return L;
}

function swotHTML(base, corp, state) {
  const all = {}; for (const [q] of SWOTK) all[q] = [...(base[q] || []), ...((corp && corp[q]) || [])];
  const n = q => all[q].length;
  const box = ([q, title, col, bg, bd]) => `<div style="background:${bg};border:1px solid ${bd};border-radius:12px;padding:10px 12px">
    <h3 style="margin:0 0 6px;font-size:15px;color:${col}">${title} <span class="mut" style="font-weight:400">(${n(q)})</span></h3>
    ${n(q) ? `<ul style="margin:0;padding-left:18px">${all[q].map(i => `<li style="margin:4px 0">${i.t} <small class="mut">· ${esc(i.src)}</small></li>`).join('')}</ul>` : `<p class="mut" style="margin:0;font-size:13px">None found by the rules.</p>`}</div>`;
  const note = state === 'loading' ? '<p class="mut" style="font-size:12.5px;margin:8px 0 0">⏳ Loading exchange data — promoter, pledge, FII, order and legal points will be added in a moment.</p>'
    : state === 'bse' ? '<p class="mut" style="font-size:12.5px;margin:8px 0 0">BSE-only stock: promoter-holding, pledge and FII points are not available (BSE blocks automated downloads).</p>' : '';
  return `<style>.swotg{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:640px){.swotg{grid-template-columns:1fr}}</style>
    <div class="swotg">${SWOTK.map(box).join('')}</div>${note}
    <p class="mut" style="font-size:12px;margin:8px 0 0">Built automatically from this app's own data — the source is shown after each point. <b>Strengths / weaknesses</b> are about the business; <b>opportunities / threats</b> about price, valuation and events. Moneycontrol's own SWOT is on its stock page (🔎 Full analysis → Moneycontrol). Educational, not advice.</p>`;
}

// called by corpLoad once x/<SYM>.json has arrived: redraw the SWOT with the filing-based points
async function swotUpdate(d, x) {
  const el = document.getElementById('swotbox'); if (!el || !d._swot) return;
  let mom = typeof MOM !== 'undefined' ? MOM : null;
  if (!mom && /\.NS$/.test(d.symbol)) { try { mom = await getJSON(DATA + 'momentum.json'); if (typeof MOM !== 'undefined' && !MOM) MOM = mom; } catch { } }
  if (CUR !== d || !document.getElementById('swotbox')) return;
  const corp = swotCorp(d, x, mom); d._swot.corp = corp;
  el.innerHTML = swotHTML(d._swot.base, corp, d.symbol.endsWith('.BO') ? 'bse' : '');
  const h = document.querySelector('#r-swot .swotn'); if (h) h.textContent = swotCount(d._swot.base, corp);
}
const swotCount = (b, c) => SWOTK.map(([q]) => q + ' ' + ((b[q] || []).length + ((c && c[q]) || []).length)).join(' · ');
