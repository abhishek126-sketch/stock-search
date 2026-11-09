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

const swMode = () => `<div class="tabs" style="margin-bottom:6px">${[['trend', '📈 Trend setups'], ['mom', '🚀 Earnings momentum']].map(([k, l]) => `<button data-swmode="${k}" class="${(SWF.mode || 'trend') === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const swModeWire = box => box.querySelectorAll('[data-swmode]').forEach(b => b.onclick = () => { SWF.mode = b.dataset.swmode; swSave(); renderSwing(box); });

async function renderSwing(box) {
  if (SWF.mode === 'mom') return renderMomentum(box);
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
  <p><b>${rows.length}</b> setup${rows.length === 1 ? '' : 's'}${SWF.st !== 'all' ? ' · ' + SWS[SWF.st][0] : ''}.</p>
  ${rows.length ? `<div class="tw"><table class="pt" id="swt"><tr><th>Stock</th><th>Setup${swq('breakout')}</th><th>Buy above${swq('trigger')}</th><th>Stop-loss${swq('stoploss')}</th><th>Target 1 / 2${swq('rmult')}</th><th>Qty${swq('possize')}</th><th>Score${swq('swsc')}</th></tr>${rows.slice(0, 150).map(r => { const w = r.sw, q = swQty(w.e, w.sl);
    return `<tr data-s="${esc(r.s)}"><td class="nogq" style="white-space:normal">${esc((r.n || r.s).slice(0, 28))} ${swBadge(w.st)}<br><small class="mut">${esc(r.s.replace(/\.(NS|BO)$/, ''))}${r.cap ? ' · ' + esc(r.cap) : ''}</small></td><td style="white-space:normal">${SWT[w.t] || '–'}${w.t === 'breakout' ? `<br><small class="${w.cf ? 'up' : 'mut'}">${w.cf ? 'volume ✔' : 'needs volume'}</small>` : ''}</td><td><b>₹${w.e}</b></td><td>₹${w.sl}<br><small class="dn">−${w.rp}%</small></td><td>₹${w.t1}<br><small class="mut">₹${w.t2}</small></td><td>${q === null ? '–' : q.toLocaleString('en-IN')}${q ? `<br><small class="mut">₹${Math.round(q * w.e).toLocaleString('en-IN')}</small>` : ''}</td><td>${w.sc ?? '–'}</td></tr>`; }).join('')}</table></div>`
    : `<p class="mut">No ${SWF.st === 'all' ? '' : SWS[SWF.st][0].toLowerCase() + ' '}setups match these filters.</p>`}
  <details class="how"><summary>How the setups are found</summary><div class="mut">${SW_RULES()}<p>Score (0–100) ranks setups by trend strength, relative strength vs the market, volume or RSI confirmation, how tight the stop is, room to the 52-week high and the CANSLIM backdrop. Tap a stock for its full setup and reasons.</p></div></details>${SW_DISC}</div>`;
  const re = () => { swSave(); const y = window.scrollY; renderSwing(box).then(() => window.scrollTo(0, y)); };
  swModeWire(box);
  box.querySelectorAll('[data-swst]').forEach(b => b.onclick = () => { SWF.st = b.dataset.swst; re(); });
  box.querySelector('#swt-t').onchange = e => { SWF.t = e.target.value; re(); };
  box.querySelector('#swt-cap').onchange = e => { SWF.cap = e.target.value; re(); };
  box.querySelector('#swt-cf').onchange = e => { SWF.cf = e.target.checked; re(); };
  box.querySelector('#swt-cash').onchange = e => { SWF.cash = Math.max(0, +e.target.value || 0); re(); };
  box.querySelector('#swt-risk').onchange = e => { SWF.riskPct = Math.min(5, Math.max(0.1, +e.target.value || 1)); re(); };
}

// ===== Earnings-momentum scan (scripts/momentum.js → momentum.json; profits from scripts/results.js) =====
const MOT = { vcp: ['🌀 VCP', 'Volatility contraction: each pullback shallower than the last, volume drying up — a base tightening before a breakout'], tight: ['📏 Tight range', 'Price held in a narrow range near the 52-week high'], pullback: ['↩️ Pullback', 'Dipped back to the 20-day EMA / 50-DMA on light volume, trend intact'], extended: ['⏳ Extended', 'Strong, but too far above its averages to buy now — wait'], none: ['— No setup', 'Passes the screen but no clean chart setup yet'] };
let MOM = null;
const moPct = v => v === 'turn' ? 'loss → profit' : v == null ? '?' : v + '%';
async function renderMomentum(box) {
  if (!MOM) { box.innerHTML = `${swMode()}<p class="mut">Loading…</p>`; swModeWire(box); try { MOM = await getJSON(DATA + 'momentum.json'); } catch (e) { MOM = { err: e.message }; } }
  const m = MOM, f = SWF.mof || 'act';
  if (!m || m.err || !m.list) { box.innerHTML = `${swMode()}<p>${NA} — the earnings-momentum scan hasn't run yet; it appears after the next evening refresh.</p>`; swModeWire(box); return; }
  const act = m.list.filter(r => ['vcp', 'tight', 'pullback'].includes(r.t)), rows = f === 'act' ? act : f === 'all' ? m.list : null;
  const R = m.rules || {}, cov = m.coverage;
  const tr = r => { const q = r.e ? swQty(r.e, r.sl) : null;
    return `<tr data-s="${esc(r.s)}"><td class="nogq" style="white-space:normal">${esc((r.n || r.s).slice(0, 28))}<br><small class="mut">${esc(r.s.replace(/\.NS$/, ''))}${r.cap ? ' · ' + esc(r.cap) : ''}</small></td>
      <td style="white-space:normal"><span title="${esc(MOT[r.t][1])}">${MOT[r.t][0]}</span><br><small class="mut">${esc((r.why || [])[0] || '')}</small>${isNum(r.dp) ? `<br><small class="${isNum(r.dpA) && r.dp >= 1.3 * r.dpA ? 'up' : 'mut'}">Delivery ${r.dp}%${isNum(r.dpA) ? ` (avg ${r.dpA}%)` : ''}</small>` : ''}${(r.warn || []).map(w => `<br><small class="dn">⚠ ${esc(w)}</small>`).join('')}</td>
      <td>${r.e ? `<b>₹${r.e}</b><br><small class="mut">${r.t === 'pullback' ? 'close above' : 'close above, vol ≥ ' + (r.volNeed / 1e5).toFixed(1) + ' L'}</small>` : `<small class="mut">${esc(r.wait || '–')}</small>`}</td>
      <td>${r.sl ? `₹${r.sl}<br><small class="dn">−${r.rp}%</small>` : '–'}</td><td>${q === null ? '–' : q.toLocaleString('en-IN')}</td>
      <td><small>Qtr ${moPct(r.qg)}<br>5 yr ${moPct(r.g5)}<br>ROCE ${r.roce}%</small></td><td>${r.sc}</td></tr>`; };
  box.innerHTML = `${swMode()}<div class="nogq"><style>#mot td:not(:first-child):not(:nth-child(2)),#mot th:not(:first-child):not(:nth-child(2)){text-align:right}</style>
  <p style="margin:0 0 6px">Stocks passing your earnings-momentum screen${m.asOf ? `, with chart setups from the close of <b>${swDate(m.asOf)}</b> — for <b>${swDate(swNext(m.asOf))}</b>` : ''}.</p>
  ${m.cnt && m.cnt.pending ? `<p class="doubt" style="text-decoration:none;font-size:13px">⚠ Profit figures are still being read from NSE filings (${cov ? `${cov.have} of ${cov.of} companies so far` : 'first pass'}); ${m.cnt.pending} stocks that pass the price, volume and ROCE tests are not checked yet. The list fills in over the next few runs.</p>` : ''}
  <p class="mut" style="font-size:13px;margin:0 0 6px">Screen: quarterly profit growth &gt; ${R.qg}% · 5-year profit growth &gt; ${R.g5}% a year · ROCE${swq('roce')} &gt; ${R.roce}% · price &gt; ${Math.round(R.hi * 100)}% of the 52-week high · 1-month average volume &gt; ${(R.vol / 1e5).toFixed(0)} lakh shares · no banks, finance or real estate.</p>
  <div class="tabs">${[['act', 'Actionable', act.length], ['all', 'All passing', m.list.length], ['unk', "Couldn't check", (m.unchecked || []).length]].map(([k, l, n]) => `<button data-mof="${k}" class="${f === k ? 'on' : ''}">${l} <small>${n}</small></button>`).join('')}</div>
  ${rows ? (rows.length ? `<div class="tw"><table class="pt" id="mot"><tr><th>Stock</th><th>Setup</th><th>Entry trigger${swq('trigger')}</th><th>Stop-loss${swq('stoploss')}</th><th>Qty${swq('possize')}</th><th>Growth</th><th>Rank score</th></tr>${rows.map(tr).join('')}</table></div>` : '<p class="mut">No stock has a clean setup today.</p>')
    : `<p class="mut" style="font-size:13px">These pass the price, volume and ROCE tests, but NSE doesn't hold the profit figures needed for the growth tests — usually a company listed in the last few years (its earlier results are in the IPO prospectus, not NSE filings) or one that changed its name. Check them on Screener before trading.</p>
       <div class="tw"><table class="pt"><tr><th>Stock</th><th>Qtr growth</th><th>5-yr growth</th><th>What's missing</th></tr>${(m.unchecked || []).map(r => `<tr data-s="${esc(r.s)}"><td class="nogq">${esc((r.n || r.s).slice(0, 28))}<br><small class="mut">${esc(r.s.replace(/\.NS$/, ''))}</small></td><td>${moPct(r.qg)}</td><td>${moPct(r.g5)}</td><td style="white-space:normal"><small class="mut">${esc(r.why)}</small></td></tr>`).join('')}</table></div>`}
  <details class="how"><summary>How this scan works</summary><div class="mut"><ul style="margin:4px 0;padding-left:18px">
   <li><b>Profits</b> come from each company's own results filed on NSE: profit attributable to shareholders, consolidated where filed. Quarterly growth compares the latest quarter with the same quarter a year earlier; 5-year growth is the yearly rate from 5 years before to the latest March year. A loss turning into a profit counts as growth.${cov ? ` Read so far for ${cov.have} of ${cov.of} NSE companies.` : ''}</li>
   <li><b>🌀 VCP:</b> the last three pullbacks (over ~60 sessions) each shallower, the last one ≤ 12%, price within 8% of the base high. <b>📏 Tight range:</b> last 10 sessions within ~8% and within 6% of the 52-week high. <b>↩️ Pullback:</b> back at the 20-day EMA or 50-DMA with the last 5 sessions' volume under 80% of normal.</li>
   <li><b>Entry:</b> for VCP / tight range, a close above the base high on volume at least 1.5× the 1-month average; for a pullback, a close back above the last session's high and the 20-day EMA.</li>
   <li><b>Stop-loss:</b> below the lowest low of the last 5 sessions (10 if that's too close), never more than 2.5 × ATR below the entry. Quantity uses the capital and risk % from the Trend setups view.</li>
   <li><b>Rank:</b> setup quality, how tight the stop is, volume drying up, closeness to the 52-week high, relative strength and earnings growth; promoter pledge over 20%, surveillance or results within a week lower it.</li></ul></div></details>${SW_DISC}</div>`;
  swModeWire(box);
  box.querySelectorAll('[data-mof]').forEach(b => b.onclick = () => { SWF.mof = b.dataset.mof; swSave(); renderMomentum(box); });
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
