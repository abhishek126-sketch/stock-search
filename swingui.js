'use strict';
// ===== Swing-trade setups (Indian stocks): home tab "📈 Swing setups" + card on the stock page =====
// Levels come from scripts/swing.js, run after the evening refresh that applies NSE/BSE official closing prices.
const SWT = { breakout: '🚀 Breakout', pullback: '↩️ Pullback' };
const SWS = { ready: ['Ready', '#15803d', '#dcfce7'], watch: ['Watch', '#a16207', '#fef9c3'], avoid: ['Avoid', '#b91c1c', '#fee2e2'] };
const SWDEF = { st: 'ready', t: '', cap: 'All', cf: false, cash: 100000, riskPct: 1 };
let SWF = Object.assign({}, SWDEF, LS.get('swf', {}));
const swSave = () => LS.set('swf', SWF);
const swq = k => typeof gq === 'function' ? gq(k) : '';   // tappable "?" with the plain-language glossary entry
const swDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
const swNext = iso => { if (!iso) return ''; let d = new Date(iso + 'T12:00:00Z'); do { d = new Date(d.getTime() + 864e5); } while ([0, 6].includes(d.getUTCDay())); return d.toISOString().slice(0, 10); };
// quantity so that a stop-out loses about riskPct% of capital, capped by the capital itself
const swQty = (e, sl) => { if (!(e > sl) || !(SWF.cash > 0)) return null; const q = Math.floor(Math.min(SWF.cash * SWF.riskPct / 100 / (e - sl), SWF.cash / e)); return q > 0 ? q : 0; };
const swBadge = st => { const s = SWS[st]; return s ? `<span class="tag" style="background:${s[2]};color:${s[1]};margin-left:0;font-weight:700">${s[0]}</span>` : ''; };
const SW_RULES = () => `<ul style="margin:4px 0;padding-left:18px">
  <li><b>Trend filter${swq('trend')}:</b> close above the 50-DMA${swq('dma')}, 50-DMA above the 200-DMA, and the 200-DMA rising — long setups only.</li>
  <li><b>🚀 Breakout${swq('breakout')}:</b> close within 2% of (or above) the 20-session high${swq('hi20')}. Buy only if the next session trades <b>above the trigger${swq('trigger')}</b> (that high + a tick). Stronger when volume is ≥ 1.5× the 20-day average${swq('volconf')}.</li>
  <li><b>↩️ Pullback${swq('pullback')}:</b> close back near the 20-EMA${swq('ema')} (−2% … +3%) with RSI${swq('rsi')} 40–60, still above the 50-DMA. Buy only if the next session trades <b>above today's high</b>.</li>
  <li><b>Stop-loss${swq('stoploss')}:</b> below the lowest low of the last 5 sessions, never more than about 2–2.5 × ATR(14)${swq('atr')} below the entry.</li>
  <li><b>Targets${swq('rmult')}:</b> T1 = 2 × the risk, T2 = 3 × the risk above the entry (reward : risk 2:1 and 3:1). Many traders book part at T1 and trail the stop.</li>
  <li><b>Watch</b> = trend is fine but the 52-week high is too close (under 1.5R) or RSI is above 80${swq('overbought')}. <b>Avoid</b> = turnover under ₹2 Cr/day${swq('liq')}, penny${swq('penny')} (&lt; ₹50), ASM/GSM${swq('asm')} surveillance, results within 7 days${swq('gaprisk')}, or stale price data.</li>
  <li><b>Position size${swq('possize')}:</b> quantity = (capital × risk %) ÷ (entry − stop), so a stop-out costs about your chosen risk %${swq('riskpct')}.</li></ul>`;
const SW_DISC = `<div class="disc" style="margin-top:8px"><b>Educational tool, not a recommendation.</b> These levels come from fixed technical rules applied to official closing prices; they don't know news, order flow or your situation. Gaps at the open can skip past a stop. Check the chart yourself, use a stop-loss, risk only a small part of your capital per trade, and consult a SEBI-registered adviser before trading.</div>`;

const swMode = () => `<div class="tabs" style="margin-bottom:6px">${[['trend', '📈 Trend setups'], ['mom', '🚀 Earnings momentum'], ['dma', '📊 DMA setups']].map(([k, l]) => `<button data-swmode="${k}" class="${(SWF.mode || 'trend') === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const swModeWire = box => box.querySelectorAll('[data-swmode]').forEach(b => b.onclick = () => { SWF.mode = b.dataset.swmode; swSave(); renderSwing(box); });

// ===== Sector grouping: stocks from one sector tend to move together, so several setups in it are really one bet =====
const SWG = [['grp', 'Group by sector'], ['one', 'Best one per sector'], ['list', 'Plain list']];
let SECMAP = null;
// Yahoo's sectors are too broad to mean "moves together" (Consumer Cyclical = auto parts + online retail + hotels + textiles),
// so group by business theme built from the industry; the sector is the fallback
const SWTHEME = [['Pharma & biotech', /Drug Manufacturers|Biotechnology|Pharmaceutical/], ['Hospitals & health services', /Medical|Health Information|Diagnostics|Healthcare Plans/],
  ['Auto & auto parts', /^Auto|Recreational Vehicles/], ['Textiles & apparel', /Textile|Apparel Manufacturing|Footwear/], ['Retail & e-commerce', /Retail|Department Stores/], ['Jewellery & luxury', /Luxury/],
  ['Hotels, travel & leisure', /Lodging|Resorts|Travel|Leisure|Restaurants|Gambling/], ['Media & entertainment', /Entertainment|Broadcasting|Publishing|Advertising|Electronic Gaming/],
  ['Metals & mining', /Steel|Copper|Aluminum|Industrial Metals|Gold|Silver|Precious Metals|Coal|Mining/], ['Chemicals & fertilisers', /Chemical|Agricultural Inputs/],
  ['Cement & building materials', /Building Materials|Building Products/], ['Paper & packaging', /Paper|Packaging|Lumber/], ['Oil, gas & fuels', /Oil & Gas/], ['Power & utilities', /^Utilities/],
  ['Banks', /^Banks/], ['NBFCs & lenders', /Credit Services|Mortgage Finance|Financial Conglomerates/], ['Brokers, AMCs & exchanges', /Capital Markets|Asset Management|Financial Data/], ['Insurance', /Insurance/],
  ['IT services & software', /Information Technology|Software/], ['Electronics & semiconductors', /Semiconductor|Electronic|Computer Hardware|Scientific & Technical|Communication Equipment/], ['Telecom', /Telecom/],
  ['Defence & aerospace', /Aerospace|Defense/], ['Capital goods & engineering', /Electrical Equipment|Industrial Machinery|Metal Fabrication|Farm & Heavy|Industrial Distribution|Tools|Pollution/],
  ['Construction & infrastructure', /Engineering & Construction|Infrastructure Operations|Construction/],
  ['Logistics & shipping', /Marine Shipping|Trucking|Freight|Railroads|Airlines|Airports|Logistics/], ['Real estate', /Real Estate|REIT/],
  ['FMCG & food', /Packaged Foods|Household|Personal Products|Beverages|Tobacco|Confectioners|Farm Products|Food Distribution|Grocery/]];
const swSec = r => { if (!SECMAP && SUMMARY && SUMMARY.rows && SUMMARY.rows.length) SECMAP = Object.fromEntries(SUMMARY.rows.map(x => [x.s, [x.sec || '', x.ind || '']]));
  const m = SECMAP && SECMAP[r.s], sec0 = r.sec || (m && m[0]) || '', ind = (m && m[1]) || r.ind || '', th = SWTHEME.find(t => t[1].test(ind));
  return { sec: th ? th[0] : sec0, ind }; };
const swGrpSel = id => `<select id="${id}" aria-label="Sector grouping">${SWG.map(([k, l]) => `<option value="${k}" ${(SWF.grp || 'grp') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>${swq('sectorrisk')}`;
// rows already sorted best-first; trFn(row, extra) -> '<tr…>'; ncol = table columns. -> { body, note }
function swGroup(rows, trFn, ncol) {
  const mode = SWF.grp || 'grp', G = new Map();
  for (const r of rows) { const { sec, ind } = swSec(r), k = sec || 'Sector not known'; if (!G.has(k)) G.set(k, []); G.get(k).push({ r, ind }); }
  const crowded = [...G].filter(([k, a]) => a.length > 1 && k !== 'Sector not known').sort((a, b) => b[1].length - a[1].length);
  const note = rows.length > 1 ? `<p class="mut" style="font-size:13px;margin:0 0 6px">${G.size} sector group${G.size === 1 ? '' : 's'}${swq('sectorrisk')}${crowded.length ? ` · <b class="dn">more than one setup in ${crowded.slice(0, 4).map(([k, a]) => `${esc(k)} (${a.length})`).join(', ')}${crowded.length > 4 ? '…' : ''}</b> — stocks in one sector usually rise and fall together, so buying several of them is one bigger bet, not several separate ones. Pick the best one or two, or split one trade's risk between them.` : ' · no overlap'}</p>` : '';
  if (mode === 'list') return { body: rows.map(r => { const c = G.get(swSec(r).sec || 'Sector not known'); return trFn(r, c && c.length > 1 && c[0].r !== r && swSec(r).sec ? `<br><small class="dn">↳ overlaps ${esc(c[0].r.s.replace(/\.(NS|BO)$/, ''))} (${esc(swSec(r).sec)})</small>` : ''); }).join(''), note };
  const groups = [...G].sort((a, b) => (a[0] === 'Sector not known') - (b[0] === 'Sector not known'));   // keeps best-first order otherwise
  const body = groups.map(([k, a]) => {
    const inds = [...new Set(a.map(x => x.ind).filter(Boolean))], n = a.length;
    const head = `<tr class="swg"><td colspan="${ncol}" style="background:var(--soft,#f1f5f9);text-align:left;white-space:normal"><b>${esc(k)}</b> <small class="mut">· ${n} setup${n === 1 ? '' : 's'}${inds.length ? ' · ' + esc(inds.slice(0, 3).join(', ')) + (inds.length > 3 ? '…' : '') : ''}</small>${n > 1 && k !== 'Sector not known' ? ` <small class="dn">· overlapping — ${mode === 'one' ? `showing the best; ${n - 1} more hidden` : 'the first is the strongest'}</small>` : ''}</td></tr>`;
    const list = mode === 'one' && k !== 'Sector not known' ? a.slice(0, 1) : a;
    return head + list.map((x, i) => trFn(x.r, (x.ind ? `<br><small class="mut">${esc(x.ind)}</small>` : '') + (i > 0 && k !== 'Sector not known' ? `<br><small class="dn" title="Same sector as ${esc((a[0].r.n || a[0].r.s).slice(0, 28))} — moves with it">↳ overlaps ${esc(a[0].r.s.replace(/\.(NS|BO)$/, ''))}</small>` : ''))).join('');
  }).join('');
  return { body, note };
}

async function renderSwing(box) {
  if (SWF.mode === 'mom') return renderMomentum(box);
  if (SWF.mode === 'dma') return renderDma(box);
  if (!SUMMARY || !SUMMARY.rows.length) { box.innerHTML = `${swMode()}<p>${NA} — summary data could not be loaded.</p>`; swModeWire(box); return; }
  const asOf = SUMMARY.swingAsOf || '', all = SUMMARY.rows.filter(r => r.sw && r.sw.t && /\.(NS|BO)$/.test(r.s));
  const caps = ['All', 'Large', 'Mid', 'Small', 'Micro', 'Other'], cnt = st => all.filter(r => r.sw.st === st).length;
  let rows = all.filter(r => (SWF.st === 'all' || r.sw.st === SWF.st) && (!SWF.t || r.sw.t === SWF.t) && (SWF.cap === 'All' || r.cap === SWF.cap) && (!SWF.cf || r.sw.cf));
  rows.sort((a, b) => (b.sw.sc || 0) - (a.sw.sc || 0));
  const stale = asOf && (Date.now() - Date.parse(asOf + 'T15:30:00+05:30')) / 864e5 > 4;
  box.innerHTML = `${swMode()}<div class="nogq"><style>.swbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}.swbar select,.swbar input{padding:7px;border:1px solid var(--line);border-radius:8px;font-size:14px;background:#fff}.swbar input[type=number]{width:110px}#swt td:not(:first-child),#swt th:not(:first-child){text-align:right}</style>
  <p style="margin:0 0 6px">${asOf ? `Swing setups${swq('swing')} from the close of <b>${swDate(asOf)}</b> — for the next session, <b>${swDate(swNext(asOf))}</b>.` : 'No swing setups computed yet — they appear after the next evening refresh.'} <span class="mut">Recomputed every evening once NSE/BSE publish official closing prices (normally by 20:30 IST).</span>${stale ? ' <span class="doubt" style="text-decoration:none">⚠ these setups are more than 4 days old</span>' : ''}</p>
  <div class="tabs">${[['ready', 'Ready'], ['watch', 'Watch'], ['avoid', 'Avoid'], ['all', 'All']].map(([k, l]) => `<button data-swst="${k}" class="${SWF.st === k ? 'on' : ''}">${l} <small>${k === 'all' ? all.length : cnt(k)}</small></button>`).join('')}<span class="mut" style="font-size:12px;align-self:center">what these mean${swq('swingst')}</span></div>
  <div class="swbar"><select id="swt-t"><option value="">All setups</option><option value="breakout" ${SWF.t === 'breakout' ? 'selected' : ''}>🚀 Breakouts</option><option value="pullback" ${SWF.t === 'pullback' ? 'selected' : ''}>↩️ Pullbacks</option></select>
   <select id="swt-cap">${caps.map(c => `<option value="${c}" ${SWF.cap === c ? 'selected' : ''}>${c === 'All' ? 'All sizes' : c === 'Other' ? 'Other listed' : c + ' cap'}</option>`).join('')}</select>
   <label class="mut" style="font-size:13px;display:flex;gap:4px;align-items:center"><input type="checkbox" id="swt-cf" ${SWF.cf ? 'checked' : ''}> Volume-confirmed only</label>${swq('volconf')}</div>
  <div class="swbar"><label class="mut" style="font-size:13px">Capital ₹ <input type="number" id="swt-cash" min="0" step="1000" value="${SWF.cash}"></label><label class="mut" style="font-size:13px">Risk per trade %${swq('riskpct')} <input type="number" id="swt-risk" min="0.1" max="5" step="0.1" value="${SWF.riskPct}" style="width:70px"></label><span class="mut" style="font-size:12px">→ quantity so a stop-out loses ≈ ₹${Math.round(SWF.cash * SWF.riskPct / 100).toLocaleString('en-IN')}</span></div>
  <div class="swbar">${swGrpSel('swt-grp')}</div>
  <p><b>${rows.length}</b> setup${rows.length === 1 ? '' : 's'}${SWF.st !== 'all' ? ' · ' + SWS[SWF.st][0] : ''}.</p>
  ${rows.length ? (() => { const g = swGroup(rows.slice(0, 150), (r, extra) => { const w = r.sw, q = swQty(w.e, w.sl);
    return `<tr data-s="${esc(r.s)}"><td class="nogq" style="white-space:normal">${esc((r.n || r.s).slice(0, 28))} ${swBadge(w.st)}<br><small class="mut">${esc(r.s.replace(/\.(NS|BO)$/, ''))}${r.cap ? ' · ' + esc(r.cap) : ''}</small>${extra}</td><td style="white-space:normal">${SWT[w.t] || '–'}${w.t === 'breakout' ? `<br><small class="${w.cf ? 'up' : 'mut'}">${w.cf ? 'volume ✔' : 'needs volume'}</small>` : ''}</td><td><b>₹${w.e}</b></td><td>₹${w.sl}<br><small class="dn">−${w.rp}%</small></td><td>₹${w.t1}<br><small class="mut">₹${w.t2}</small></td><td>${q === null ? '–' : q.toLocaleString('en-IN')}${q ? `<br><small class="mut">₹${Math.round(q * w.e).toLocaleString('en-IN')}</small>` : ''}</td><td>${w.sc ?? '–'}</td></tr>`; }, 7);
    return `${g.note}<div class="tw"><table class="pt" id="swt"><tr><th>Stock</th><th>Setup${swq('breakout')}</th><th>Buy above${swq('trigger')}</th><th>Stop-loss${swq('stoploss')}</th><th>Target 1 / 2${swq('rmult')}</th><th>Qty${swq('possize')}</th><th>Score${swq('swsc')}</th></tr>${g.body}</table></div>`; })()
    : `<p class="mut">No ${SWF.st === 'all' ? '' : SWS[SWF.st][0].toLowerCase() + ' '}setups match these filters.</p>`}
  <details class="how"><summary>How the setups are found</summary><div class="mut">${SW_RULES()}<p>Score (0–100) ranks setups by trend strength, relative strength vs the market, volume or RSI confirmation, how tight the stop is, room to the 52-week high and the CANSLIM backdrop. Tap a stock for its full setup and reasons.</p></div></details>${SW_DISC}</div>`;
  const re = () => { swSave(); const y = window.scrollY; renderSwing(box).then(() => window.scrollTo(0, y)); };
  swModeWire(box);
  box.querySelectorAll('[data-swst]').forEach(b => b.onclick = () => { SWF.st = b.dataset.swst; re(); });
  box.querySelector('#swt-t').onchange = e => { SWF.t = e.target.value; re(); };
  box.querySelector('#swt-cap').onchange = e => { SWF.cap = e.target.value; re(); };
  box.querySelector('#swt-cf').onchange = e => { SWF.cf = e.target.checked; re(); };
  box.querySelector('#swt-grp').onchange = e => { SWF.grp = e.target.value; re(); };
  box.querySelector('#swt-cash').onchange = e => { SWF.cash = Math.max(0, +e.target.value || 0); re(); };
  box.querySelector('#swt-risk').onchange = e => { SWF.riskPct = Math.min(5, Math.max(0.1, +e.target.value || 1)); re(); };
}

// ===== Earnings-momentum scan (scripts/momentum.js → momentum.json; profits from scripts/results.js) =====
const MOT = { vcp: ['🌀 VCP', 'Volatility contraction: each pullback shallower than the last, volume drying up — a base tightening before a breakout'], tight: ['📏 Tight range', 'Price held in a narrow range near the 52-week high'], pullback: ['↩️ Pullback', 'Dipped back to the 20-day EMA / 50-DMA on light volume, trend intact'], extended: ['⏳ Extended', 'Strong, but too far above its averages to buy now — wait'], none: ['— No setup', 'Passes the screen but no clean chart setup yet'] };
const MOG = { vcp: 'vcp', tight: 'tightrange', pullback: 'pullback', extended: 'extended' };   // setup → glossary key
let MOM = null;
const moPct = v => v === 'turn' ? 'loss → profit' : v == null ? '?' : v + '%';
async function renderMomentum(box) {
  if (!MOM) { box.innerHTML = `${swMode()}<p class="mut">Loading…</p>`; swModeWire(box); try { MOM = await getJSON(DATA + 'momentum.json'); } catch (e) { MOM = { err: e.message }; } }
  if (typeof ensureSummary === 'function') await ensureSummary();          // sectors for grouping
  const m = MOM, f = SWF.mof || 'act';
  if (!m || m.err || !m.list) { box.innerHTML = `${swMode()}<p>${NA} — the earnings-momentum scan hasn't run yet; it appears after the next evening refresh.</p>`; swModeWire(box); return; }
  const act = m.list.filter(r => ['vcp', 'tight', 'pullback'].includes(r.t)), rows = f === 'act' ? act : f === 'all' ? m.list : null;
  const R = m.rules || {}, cov = m.coverage;
  const tr = (r, extra = '') => { const q = r.e ? swQty(r.e, r.sl) : null;
    return `<tr data-s="${esc(r.s)}"><td class="nogq" style="white-space:normal">${esc((r.n || r.s).slice(0, 28))}<br><small class="mut">${esc(r.s.replace(/\.NS$/, ''))}${r.cap ? ' · ' + esc(r.cap) : ''}</small>${extra}</td>
      <td style="white-space:normal"><span title="${esc(MOT[r.t][1])}">${MOT[r.t][0]}</span>${swq(MOG[r.t])}<br><small class="mut">${esc((r.why || [])[0] || '')}</small>${isNum(r.dp) ? `<br><small class="${isNum(r.dpA) && r.dp >= 1.3 * r.dpA ? 'up' : 'mut'}">Delivery${swq('deliv')} ${r.dp}%${isNum(r.dpA) ? ` (avg ${r.dpA}%)` : ''}</small>` : ''}${(r.warn || []).map(w => `<br><small class="dn">⚠ ${esc(w)}</small>`).join('')}</td>
      <td>${r.e ? `<b>₹${r.e}</b><br><small class="mut">${r.t === 'pullback' ? 'close above' : 'close above, vol ≥ ' + (r.volNeed / 1e5).toFixed(1) + ' L'}</small>` : `<small class="mut">${esc(r.wait || '–')}</small>`}</td>
      <td>${r.sl ? `₹${r.sl}<br><small class="dn">−${r.rp}%</small>` : '–'}</td><td>${q === null ? '–' : q.toLocaleString('en-IN')}</td>
      <td><small>Qtr ${moPct(r.qg)}<br>5 yr ${moPct(r.g5)}<br>ROCE ${r.roce}%</small></td><td>${r.sc}</td></tr>`; };
  box.innerHTML = `${swMode()}<div class="nogq"><style>.swbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}.swbar select{padding:7px;border:1px solid var(--line);border-radius:8px;font-size:14px;background:#fff}#mot td:not(:first-child):not(:nth-child(2)),#mot th:not(:first-child):not(:nth-child(2)){text-align:right}</style>
  <p style="margin:0 0 6px">Stocks passing your earnings-momentum screen${swq('momscan')}${m.asOf ? `, with chart setups from the close of <b>${swDate(m.asOf)}</b> — for <b>${swDate(swNext(m.asOf))}</b>` : ''}.</p>
  ${m.cnt && m.cnt.pending ? `<p class="doubt" style="text-decoration:none;font-size:13px">⚠ Profit figures are still being read from NSE filings (${cov ? `${cov.have} of ${cov.of} companies so far` : 'first pass'}); ${m.cnt.pending} stocks that pass the price, volume and ROCE tests are not checked yet. The list fills in over the next few runs.</p>` : ''}
  <p class="mut" style="font-size:13px;margin:0 0 6px">Screen: quarterly profit growth &gt; ${R.qg}% · 5-year profit growth${swq('cagr')} &gt; ${R.g5}% a year · ROCE${swq('roce')} &gt; ${R.roce}% · price &gt; ${Math.round(R.hi * 100)}% of the 52-week high · 1-month average volume &gt; ${(R.vol / 1e5).toFixed(0)} lakh shares · no banks, finance or real estate.</p>
  <div class="tabs">${[['act', 'Actionable', act.length], ['all', 'All passing', m.list.length], ['unk', "Couldn't check", (m.unchecked || []).length]].map(([k, l, n]) => `<button data-mof="${k}" class="${f === k ? 'on' : ''}">${l} <small>${n}</small></button>`).join('')}</div>
  ${rows ? `<div class="swbar">${swGrpSel('mo-grp')}</div>` : ''}
  ${rows ? (rows.length ? (() => { const g = swGroup(rows, tr, 7); return `${g.note}<div class="tw"><table class="pt" id="mot"><tr><th>Stock</th><th>Setup${swq('vcp')}</th><th>Entry trigger${swq('pivot')}</th><th>Stop-loss${swq('stoploss')}</th><th>Qty${swq('possize')}</th><th>Growth${swq('yoy')}</th><th>Rank score${swq('morank')}</th></tr>${g.body}</table></div>`; })() : '<p class="mut">No stock has a clean setup today.</p>')
    : `<p class="mut" style="font-size:13px">These pass the price, volume and ROCE tests, but NSE doesn't hold the profit figures needed for the growth tests — usually a company listed in the last few years (its earlier results are in the IPO prospectus, not NSE filings) or one that changed its name. Check them on Screener before trading.</p>
       <div class="tw"><table class="pt"><tr><th>Stock</th><th>Qtr growth</th><th>5-yr growth</th><th>What's missing</th></tr>${(m.unchecked || []).map(r => `<tr data-s="${esc(r.s)}"><td class="nogq">${esc((r.n || r.s).slice(0, 28))}<br><small class="mut">${esc(r.s.replace(/\.NS$/, ''))}</small></td><td>${moPct(r.qg)}</td><td>${moPct(r.g5)}</td><td style="white-space:normal"><small class="mut">${esc(r.why)}</small></td></tr>`).join('')}</table></div>`}
  <details class="how"><summary>How this scan works</summary><div class="mut"><ul style="margin:4px 0;padding-left:18px">
   <li><b>Profits</b> come from each company's own results filed on NSE: profit attributable to shareholders, consolidated${swq('consolidated')} where filed. Quarterly growth compares the latest quarter with the same quarter a year earlier; 5-year growth is the yearly rate from 5 years before to the latest March year. A loss turning into a profit counts as growth.${cov ? ` Read so far for ${cov.have} of ${cov.of} NSE companies.` : ''}</li>
   <li><b>🌀 VCP${swq('vcp')}:</b> the last three pullbacks (over ~60 sessions) each shallower, the last one ≤ 12%, price within 8% of the base high. <b>📏 Tight range${swq('tightrange')}:</b> last 10 sessions within ~8% and within 6% of the 52-week high. <b>↩️ Pullback:</b> back at the 20-day EMA or 50-DMA with the last 5 sessions' volume under 80% of normal.</li>
   <li><b>Entry:</b> for VCP / tight range, a close above the base high on volume at least 1.5× the 1-month average; for a pullback, a close back above the last session's high and the 20-day EMA.</li>
   <li><b>Stop-loss:</b> below the lowest low of the last 5 sessions (10 if that's too close), never more than 2.5 × ATR${swq('atr')} below the entry. Quantity uses the capital and risk % from the Trend setups view.</li>
   <li><b>Rank${swq('morank')}:</b> setup quality, how tight the stop is, volume drying up, closeness to the 52-week high, relative strength and earnings growth; promoter pledge over 20%, surveillance or results within a week lower it.</li></ul></div></details>${SW_DISC}</div>`;
  swModeWire(box);
  box.querySelectorAll('[data-mof]').forEach(b => b.onclick = () => { SWF.mof = b.dataset.mof; swSave(); renderMomentum(box); });
  const mg = box.querySelector('#mo-grp'); if (mg) mg.onchange = e => { SWF.grp = e.target.value; swSave(); renderMomentum(box); };
}

// ===== DMA setups (scripts/dmascan.js → dma.json; rules in dmasetup.js) =====
let DMA = null;
const DMST = { strongest: ['Strongest', '#15803d', '#dcfce7'], best: ['Best', '#1d4ed8', '#dbeafe'] };
const dmBadge = st => { const s = DMST[st]; return s ? `<span class="tag" style="background:${s[2]};color:${s[1]};margin-left:0;font-weight:700">${s[0]}</span>` : ''; };
const dmCr = v => isNum(v) ? (v >= 1e7 ? '₹' + (v / 1e7).toFixed(v >= 1e9 ? 0 : 1) + ' Cr' : '₹' + (v / 1e5).toFixed(1) + ' L') : '–';
const DM_RULES = `<ul style="margin:4px 0;padding-left:18px">
  <li><b>Best:</b> price above the 50-DMA${swq('dma')}, 50-DMA above the 200-DMA, and the session's volume more than <b>1.5×</b> its average of the previous 50 sessions${swq('avgvol')}.</li>
  <li><b>Strongest:</b> all of that, plus price above the 20-DMA, 20-DMA above the 50-DMA, and a <b>golden cross</b>${swq('cross')} — the 50-DMA crossed above the 200-DMA within the last 60 sessions (about 3 months) and has stayed above. Every Strongest stock is also Best.</li>
  <li>DMAs are simple averages of daily closing prices (official NSE / BSE close). Volume is Yahoo's daily volume, or NSE's official traded quantity when Yahoo's isn't in yet.</li>
  <li><b>Liquid</b> = average turnover${swq('turnover')} of at least ₹1 Cr a day. A volume spike in a stock that hardly trades says little, so these are hidden unless you choose "Any turnover".</li>
  <li>Stocks with under 200 sessions of history (recent listings) or no trading for over a week are not screened.</li></ul>`;
async function renderDma(box) {
  if (!DMA) { box.innerHTML = `${swMode()}<p class="mut">Loading…</p>`; swModeWire(box); try { DMA = await getJSON(DATA + 'dma.json'); } catch (e) { DMA = { err: e.message }; } }
  if (typeof ensureSummary === 'function') await ensureSummary();
  const m = DMA;
  if (!m || m.err || !m.list) { box.innerHTML = `${swMode()}<p>${NA} — the DMA setups scan hasn't run yet; it appears after the next evening refresh.</p>`; swModeWire(box); return; }
  const st = SWF.dst || 'all', liqOnly = SWF.dliq !== false, cap = SWF.dcap || 'All', caps = ['All', 'Large', 'Mid', 'Small', 'Micro', 'Other', 'Penny'];
  const base = m.list.filter(r => (!liqOnly || r.liq) && (cap === 'All' || r.cap === cap));
  const rows = base.filter(r => st === 'all' || r.st === st), nS = base.filter(r => r.st === 'strongest').length;
  const stale = m.asOf && (Date.now() - Date.parse(m.asOf + 'T15:30:00+05:30')) / 864e5 > 4;
  const tr = (r, extra = '') => `<tr data-s="${esc(r.s)}"><td class="nogq" style="white-space:normal">${esc((r.n || r.s).slice(0, 28))} ${dmBadge(r.st)}<br><small class="mut">${esc(r.s.replace(/\.(NS|BO)$/, ''))}${r.cap ? ' · ' + esc(r.cap) : ''}</small>${extra}</td>
    <td><b>₹${r2s(r.p)}</b><br><small class="up">+${((r.p / r.d50 - 1) * 100).toFixed(1)}% vs 50-DMA</small></td>
    <td><small>20: ₹${r2s(r.d20)}<br>50: ₹${r2s(r.d50)}<br>200: ₹${r2s(r.d200)}</small></td>
    <td><b>${r.vr}×</b></td><td>${r.gc ? `${swDate(r.gc)}<br><small class="mut">${r.gcAgo} session${r.gcAgo === 1 ? '' : 's'} ago</small>` : '<small class="mut">earlier</small>'}</td><td>${dmCr(r.tov)}</td></tr>`;
  box.innerHTML = `${swMode()}<div class="nogq"><style>.swbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}.swbar select{padding:7px;border:1px solid var(--line);border-radius:8px;font-size:14px;background:#fff}#dmt td:not(:first-child),#dmt th:not(:first-child){text-align:right}</style>
  <p style="margin:0 0 6px">Moving-average trend setups${swq('dmaset')} from the close of <b>${swDate(m.asOf)}</b>. <span class="mut">Recomputed every evening after the official closing prices.</span>${stale ? ' <span class="doubt" style="text-decoration:none">⚠ more than 4 days old</span>' : ''}</p>
  <div class="tabs">${[['all', 'All', base.length], ['strongest', 'Strongest', nS], ['best', 'Best only', base.length - nS]].map(([k, l, n]) => `<button data-dst="${k}" class="${st === k ? 'on' : ''}">${l} <small>${n}</small></button>`).join('')}</div>
  <div class="swbar"><select id="dm-cap">${caps.map(c => `<option value="${c}" ${cap === c ? 'selected' : ''}>${c === 'All' ? 'All sizes' : c === 'Other' ? 'Other listed' : c === 'Penny' ? 'Penny' : c + ' cap'}</option>`).join('')}</select>
   <select id="dm-liq"><option value="1" ${liqOnly ? 'selected' : ''}>Liquid only (≥ ₹1 Cr/day)</option><option value="0" ${liqOnly ? '' : 'selected'}>Any turnover</option></select>${swq('turnover')} ${swGrpSel('dm-grp')}</div>
  ${rows.length ? (() => { const g = swGroup(rows, tr, 6); return `${g.note}<div class="tw"><table class="pt" id="dmt"><tr><th>Stock</th><th>Price</th><th>DMA${swq('dma')}</th><th>Volume vs avg${swq('avgvol')}</th><th>Golden cross${swq('cross')}</th><th>Turnover / day${swq('turnover')}</th></tr>${g.body}</table></div>`; })()
    : `<p class="mut">No stock meets ${st === 'strongest' ? 'the Strongest setup' : 'these setups'} with these filters today${liqOnly ? ' — try "Any turnover"' : ''}.</p>`}
  <p class="mut" style="font-size:12.5px">All Indian stocks screened: ${m.cnt.screened} · Best ${m.cnt.best} (liquid ${m.cnt.liquidBest}) · Strongest ${m.cnt.strongest} (liquid ${m.cnt.liquidStrongest}) · too new for a 200-DMA ${m.cnt.short}.</p>
  <details class="how"><summary>How the setups are found</summary><div class="mut">${DM_RULES}</div></details>${SW_DISC.replace('These levels come from fixed technical rules', 'These setups come from fixed moving-average rules')}</div>`;
  const re = () => { swSave(); const y = window.scrollY; renderDma(box).then(() => window.scrollTo(0, y)); };
  swModeWire(box);
  box.querySelectorAll('[data-dst]').forEach(b => b.onclick = () => { SWF.dst = b.dataset.dst; re(); });
  box.querySelector('#dm-cap').onchange = e => { SWF.dcap = e.target.value; re(); };
  box.querySelector('#dm-liq').onchange = e => { SWF.dliq = e.target.value === '1'; re(); };
  box.querySelector('#dm-grp').onchange = e => { SWF.grp = e.target.value; re(); };
}
// stock page: does this stock meet a DMA setup today? (same code as the scan, on this page's data)
function dmaCard(d) {
  if (!d || d.etf || typeof DmaSetup === 'undefined' || !/\.(NS|BO)$/.test(d.symbol || '')) return '';
  const r = DmaSetup.screenDmaSetups(DmaSetup.rowsFromAppDoc(d), { symbol: d.symbol });
  const head = `<h2>📊 DMA setup${swq('dmaset')} <span class="mut">(close of ${r.ok ? swDate(r.asOf) : '–'})</span></h2>`;
  if (!r.ok) return `<div class="card nogq" id="dmaset">${head}<p class="mut">${esc(r.message)}</p></div>`;
  const on = r.setups.strongest ? 'strongest' : r.setups.best ? 'best' : null, c = r.conditions;
  const ck = (ok, t) => `<li class="${ok ? 'ok' : 'flag'}">${ok ? '✔' : '✘'} ${t}</li>`;
  const thin = isNum(r.volume.avgTurnover) && r.volume.avgTurnover < 1e7;
  return `<div class="card nogq" id="dmaset">${head}
    <p style="margin:0 0 6px">${on ? dmBadge(on) + ` <b>meets the ${DMST[on][0]} setup</b>` : '<b>No DMA setup today</b>'}${on && !r.setups.strongest ? ' <span class="mut">(not Strongest)</span>' : ''}</p>
    <ul style="margin:4px 0;padding-left:18px">${ck(c.priceAbove50 && c.sma50Above200, `Price ₹${r2s(r.price)} &gt; 50-DMA ₹${r2s(r.dma.d50)} &gt; 200-DMA ₹${r2s(r.dma.d200)}`)}
      ${ck(c.volumeAboveMultiple, r.volume.ratio === null ? 'Volume ratio not available' : `Volume ${r.volume.ratio}× its 50-day average (needs more than 1.5×)`)}
      ${ck(c.priceAbove20 && c.sma20Above50, `Price above the 20-DMA ₹${r2s(r.dma.d20)}, 20-DMA above the 50-DMA`)}
      ${ck(c.goldenCross, r.goldenCross.present ? `Golden cross on ${swDate(r.goldenCross.date)} (${r.goldenCross.sessionsAgo} sessions ago)` : (r.goldenCross.lastCrossInWindow && r.goldenCross.lastCrossInWindow.type === 'death' ? `Death cross on ${swDate(r.goldenCross.lastCrossInWindow.date)}` : 'No golden cross in the last 60 sessions'))}</ul>
    ${thin ? `<p class="dn" style="font-size:13px">⚠ Thinly traded: about ${dmCr(r.volume.avgTurnover)} a day — a volume spike here means little.</p>` : ''}
    ${r.warnings.length ? `<p class="mut" style="font-size:12.5px">${r.warnings.map(esc).join(' ')}</p>` : ''}
    <p class="src">Best = first two lines; Strongest = all four. Rules: 📊 DMA setups in the Swing tab. Educational, not a recommendation.</p></div>`;
}

// ===== Delivery % and corporate actions (scripts/nsedaily.js, official NSE files) — stock page card =====
function nseDailyCard(d) {
  const dv = d.deliv || [], ca = d.ca || []; if (!dv.length && !ca.length) return '';
  const today = new Date(Date.now() + 19800e3).toISOString().slice(0, 10);
  let h = '';
  if (dv.length) {
    const l = dv[dv.length - 1], prev = dv.slice(-21, -1), avg = prev.length ? prev.reduce((s, r) => s + r[1], 0) / prev.length : null;
    const hi = avg && l[1] >= avg * 1.3, lo = avg && l[1] <= avg * 0.7, mx = Math.max(...dv.map(r => r[1]), 1);
    h += `<p style="margin:0 0 6px"><b>Delivery${swq('deliv')}</b> on ${swDate(l[0])}: <b>${l[1].toFixed(1)}%</b> of ${l[2].toLocaleString('en-IN')} shares traded${avg ? ` · 20-session average <b>${avg.toFixed(1)}%</b>` : ''}${hi ? ' <span class="up">· well above normal — more buyers taking delivery</span>' : lo ? ' <span class="mut">· well below normal — mostly same-day trading</span>' : ''}.</p>
      <div style="display:flex;align-items:flex-end;gap:2px;height:44px;margin:4px 0 2px" title="Delivery % per session (last ${dv.length})">${dv.map(r => `<div title="${r[0]}: ${r[1]}%" style="flex:1;background:${r === l ? 'var(--acc,#2563eb)' : '#94a3b8'};height:${Math.max(2, 44 * r[1] / mx)}px;border-radius:2px 2px 0 0"></div>`).join('')}</div>
      <p class="mut" style="font-size:12px;margin:0 0 8px">Delivery % = share of the day's traded quantity actually taken into demat accounts (the rest was bought and sold the same day). Source: NSE end-of-day file.</p>`;
  }
  if (ca.length) {
    const up = ca.filter(r => r[0] >= today).sort((a, b) => a[0] < b[0] ? -1 : 1), past = ca.filter(r => r[0] < today).slice(0, 8);
    h += `<p style="margin:6px 0 4px"><b>Corporate actions${swq('corpact')}</b> <span class="mut">(NSE; ex-date = first day the stock trades without the benefit)</span></p>
      ${up.length ? `<ul style="margin:0 0 4px">${up.map(r => `<li><b>${swDate(r[0])}</b> · ${esc(r[1])} <span class="tag" style="margin-left:4px">upcoming</span></li>`).join('')}</ul>` : ''}
      ${past.length ? `<ul class="mut" style="margin:0;font-size:13px">${past.map(r => `<li>${swDate(r[0])} · ${esc(r[1])}</li>`).join('')}</ul>` : ''}
      ${up.some(r => /bonus|split|sub-?division|rights|demerger/i.test(r[1])) ? '<p class="dn" style="font-size:13px">⚠ A bonus / split / rights / demerger changes the share price on the ex-date — adjust any stop-loss and targets.</p>' : ''}`;
  }
  return `<div class="card nogq" id="nsedaily"><h2>📦 Delivery & corporate actions</h2>${h}</div>`;
}

// stock page card
function swingCard(d) {
  const o = d.swing; if (!o || d.etf || !/\.(NS|BO)$/.test(d.symbol)) return '';
  const head = `<h2>📈 Swing setup${swq('swing')} <span class="mut">(next session${o.asOf ? ' after ' + swDate(o.asOf) : ''})</span></h2>`;
  const why = (o.why || []).map(w => `<li>${esc(w)}</li>`).join(''), warn = (o.warn || []).map(w => `<li class="dn">⚠ ${esc(w)}</li>`).join('');
  if (!o.t) return `<div class="card nogq" id="swing">${head}<p><b>No setup</b> ${o.st === 'watch' ? swBadge('watch') : ''}</p><ul>${why}${o.watch ? `<li>${esc(o.watch)}</li>` : ''}${warn}</ul><p class="src">Rules: see the 📈 Swing setups tab. Educational only.</p></div>`;
  const q = swQty(o.e, o.sl), r = o.e - o.sl;
  return `<div class="card nogq" id="swing">${head}
   <p style="margin:0 0 6px">${swBadge(o.st)}${swq('swingst')} <b>${SWT[o.t]}</b>${swq(o.t)}${o.t === 'breakout' ? (o.conf ? ` <span class="up">· volume confirmed</span>${swq('volconf')}` : ` <span class="mut">· needs a high-volume move</span>${swq('volconf')}`) : ''} · score <b>${o.sc}</b>/100${swq('swsc')}${o.st === 'watch' && o.watch ? ` <span class="mut">— ${esc(o.watch)}</span>` : ''}</p>
   <div class="kv"><div><span>Buy above (trigger)${swq('trigger')}</span><b style="font-size:20px">₹${o.e}</b></div><div><span>Stop-loss${swq('stoploss')}</span><b class="dn">₹${o.sl} <small>(−${o.riskPct}%)</small></b></div><div><span>Target 1 (2R)${swq('rmult')}</span><b class="up">₹${o.t1}</b></div><div><span>Target 2 (3R)</span><b class="up">₹${o.t2}</b></div><div><span>Risk per share (R)</span><b>₹${r2s(r)}</b></div><div><span>Quantity${swq('possize')} <small class="mut">(₹${(+SWF.cash).toLocaleString('en-IN')} capital, ${SWF.riskPct}% risk)</small></span><b>${q === null ? '–' : q.toLocaleString('en-IN')}</b></div></div>
   <ul style="margin-top:8px">${why}${warn}</ul>
   <p class="mut" style="font-size:12.5px">Last close ₹${o.close} · 20-EMA${swq('ema')} ₹${o.e20} · 50-DMA${swq('dma')} ₹${o.s50} · 200-DMA ₹${o.s200} · RSI${swq('rsi')} ${o.rsi} · ATR${swq('atr')} ₹${o.atr} · 20-session high${swq('hi20')} ₹${o.hi20} · 52-week high${swq('hi52')} ₹${o.hi52}. Change capital and risk % in the 📈 Swing setups tab.</p>
   ${SW_DISC}</div>`;
}
const r2s = v => (Math.round(v * 100) / 100).toLocaleString('en-IN');
