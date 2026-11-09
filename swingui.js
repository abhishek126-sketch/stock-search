'use strict';
// ===== Swing-trade setups (Indian stocks): home tab "📈 Swing setups" + card on the stock page =====
// Levels come from scripts/swing.js, run after the evening refresh that applies NSE/BSE official closing prices.
const SWT = { breakout: '🚀 Breakout', pullback: '↩️ Pullback' };
const SWS = { ready: ['Ready', '#15803d', '#dcfce7'], watch: ['Watch', '#a16207', '#fef9c3'], avoid: ['Avoid', '#b91c1c', '#fee2e2'] };
const SWDEF = { st: 'ready', t: '', cap: 'All', cf: false, cash: 100000, riskPct: 1 };
let SWF = Object.assign({}, SWDEF, LS.get('swf', {}));
const swSave = () => LS.set('swf', SWF);
const swDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
const swNext = iso => { if (!iso) return ''; let d = new Date(iso + 'T12:00:00Z'); do { d = new Date(d.getTime() + 864e5); } while ([0, 6].includes(d.getUTCDay())); return d.toISOString().slice(0, 10); };
// quantity so that a stop-out loses about riskPct% of capital, capped by the capital itself
const swQty = (e, sl) => { if (!(e > sl) || !(SWF.cash > 0)) return null; const q = Math.floor(Math.min(SWF.cash * SWF.riskPct / 100 / (e - sl), SWF.cash / e)); return q > 0 ? q : 0; };
const swBadge = st => { const s = SWS[st]; return s ? `<span class="tag" style="background:${s[2]};color:${s[1]};margin-left:0;font-weight:700">${s[0]}</span>` : ''; };
const SW_RULES = `<ul style="margin:4px 0;padding-left:18px">
  <li><b>Trend filter:</b> close above the 50-DMA, 50-DMA above the 200-DMA, and the 200-DMA rising — long setups only.</li>
  <li><b>🚀 Breakout:</b> close within 2% of (or above) the 20-session high. Buy only if the next session trades <b>above the trigger</b> (that high + a tick). Stronger when volume is ≥ 1.5× the 20-day average.</li>
  <li><b>↩️ Pullback:</b> close back near the 20-EMA (−2% … +3%) with RSI 40–60, still above the 50-DMA. Buy only if the next session trades <b>above today's high</b>.</li>
  <li><b>Stop-loss:</b> below the lowest low of the last 5 sessions, never more than about 2–2.5 × ATR(14) below the entry.</li>
  <li><b>Targets:</b> T1 = 2 × the risk, T2 = 3 × the risk above the entry (reward : risk 2:1 and 3:1). Many traders book part at T1 and trail the stop.</li>
  <li><b>Watch</b> = trend is fine but the 52-week high is too close (under 1.5R) or RSI is above 80. <b>Avoid</b> = turnover under ₹2 Cr/day, penny (&lt; ₹50), ASM/GSM surveillance, results within 7 days, or stale price data.</li>
  <li><b>Position size:</b> quantity = (capital × risk %) ÷ (entry − stop), so a stop-out costs about your chosen risk %.</li></ul>`;
const SW_DISC = `<div class="disc" style="margin-top:8px"><b>Educational tool, not a recommendation.</b> These levels come from fixed technical rules applied to official closing prices; they don't know news, order flow or your situation. Gaps at the open can skip past a stop. Check the chart yourself, use a stop-loss, risk only a small part of your capital per trade, and consult a SEBI-registered adviser before trading.</div>`;

async function renderSwing(box) {
  if (!SUMMARY || !SUMMARY.rows.length) { box.innerHTML = `<p>${NA} — summary data could not be loaded.</p>`; return; }
  const asOf = SUMMARY.swingAsOf || '', all = SUMMARY.rows.filter(r => r.sw && r.sw.t && /\.(NS|BO)$/.test(r.s));
  const caps = ['All', 'Large', 'Mid', 'Small', 'Micro', 'Other'], cnt = st => all.filter(r => r.sw.st === st).length;
  let rows = all.filter(r => (SWF.st === 'all' || r.sw.st === SWF.st) && (!SWF.t || r.sw.t === SWF.t) && (SWF.cap === 'All' || r.cap === SWF.cap) && (!SWF.cf || r.sw.cf));
  rows.sort((a, b) => (b.sw.sc || 0) - (a.sw.sc || 0));
  const stale = asOf && (Date.now() - Date.parse(asOf + 'T15:30:00+05:30')) / 864e5 > 4;
  box.innerHTML = `<div class="nogq"><style>.swbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}.swbar select,.swbar input{padding:7px;border:1px solid var(--line);border-radius:8px;font-size:14px;background:#fff}.swbar input[type=number]{width:110px}#swt td:not(:first-child),#swt th:not(:first-child){text-align:right}</style>
  <p style="margin:0 0 6px">${asOf ? `Setups from the close of <b>${swDate(asOf)}</b> — for the next session, <b>${swDate(swNext(asOf))}</b>.` : 'No swing setups computed yet — they appear after the next evening refresh.'} <span class="mut">Recomputed every evening once NSE/BSE publish official closing prices (normally by 20:30 IST).</span>${stale ? ' <span class="doubt" style="text-decoration:none">⚠ these setups are more than 4 days old</span>' : ''}</p>
  <div class="tabs">${[['ready', 'Ready'], ['watch', 'Watch'], ['avoid', 'Avoid'], ['all', 'All']].map(([k, l]) => `<button data-swst="${k}" class="${SWF.st === k ? 'on' : ''}">${l} <small>${k === 'all' ? all.length : cnt(k)}</small></button>`).join('')}</div>
  <div class="swbar"><select id="swt-t"><option value="">All setups</option><option value="breakout" ${SWF.t === 'breakout' ? 'selected' : ''}>🚀 Breakouts</option><option value="pullback" ${SWF.t === 'pullback' ? 'selected' : ''}>↩️ Pullbacks</option></select>
   <select id="swt-cap">${caps.map(c => `<option value="${c}" ${SWF.cap === c ? 'selected' : ''}>${c === 'All' ? 'All sizes' : c === 'Other' ? 'Other listed' : c + ' cap'}</option>`).join('')}</select>
   <label class="mut" style="font-size:13px;display:flex;gap:4px;align-items:center"><input type="checkbox" id="swt-cf" ${SWF.cf ? 'checked' : ''}> Volume-confirmed only</label></div>
  <div class="swbar"><label class="mut" style="font-size:13px">Capital ₹ <input type="number" id="swt-cash" min="0" step="1000" value="${SWF.cash}"></label><label class="mut" style="font-size:13px">Risk per trade % <input type="number" id="swt-risk" min="0.1" max="5" step="0.1" value="${SWF.riskPct}" style="width:70px"></label><span class="mut" style="font-size:12px">→ quantity so a stop-out loses ≈ ₹${Math.round(SWF.cash * SWF.riskPct / 100).toLocaleString('en-IN')}</span></div>
  <p><b>${rows.length}</b> setup${rows.length === 1 ? '' : 's'}${SWF.st !== 'all' ? ' · ' + SWS[SWF.st][0] : ''}.</p>
  ${rows.length ? `<div class="tw"><table class="pt" id="swt"><tr><th>Stock</th><th>Setup</th><th>Buy above</th><th>Stop-loss</th><th>Target 1 / 2</th><th>Qty</th><th>Score</th></tr>${rows.slice(0, 150).map(r => { const w = r.sw, q = swQty(w.e, w.sl);
    return `<tr data-s="${esc(r.s)}"><td class="nogq" style="white-space:normal">${esc((r.n || r.s).slice(0, 28))} ${swBadge(w.st)}<br><small class="mut">${esc(r.s.replace(/\.(NS|BO)$/, ''))}${r.cap ? ' · ' + esc(r.cap) : ''}</small></td><td style="white-space:normal">${SWT[w.t] || '–'}${w.t === 'breakout' ? `<br><small class="${w.cf ? 'up' : 'mut'}">${w.cf ? 'volume ✔' : 'needs volume'}</small>` : ''}</td><td><b>₹${w.e}</b></td><td>₹${w.sl}<br><small class="dn">−${w.rp}%</small></td><td>₹${w.t1}<br><small class="mut">₹${w.t2}</small></td><td>${q === null ? '–' : q.toLocaleString('en-IN')}${q ? `<br><small class="mut">₹${Math.round(q * w.e).toLocaleString('en-IN')}</small>` : ''}</td><td>${w.sc ?? '–'}</td></tr>`; }).join('')}</table></div>`
    : `<p class="mut">No ${SWF.st === 'all' ? '' : SWS[SWF.st][0].toLowerCase() + ' '}setups match these filters.</p>`}
  <details class="how"><summary>How the setups are found</summary><div class="mut">${SW_RULES}<p>Score (0–100) ranks setups by trend strength, relative strength vs the market, volume or RSI confirmation, how tight the stop is, room to the 52-week high and the CANSLIM backdrop. Tap a stock for its full setup and reasons.</p></div></details>${SW_DISC}</div>`;
  const re = () => { swSave(); const y = window.scrollY; renderSwing(box).then(() => window.scrollTo(0, y)); };
  box.querySelectorAll('[data-swst]').forEach(b => b.onclick = () => { SWF.st = b.dataset.swst; re(); });
  box.querySelector('#swt-t').onchange = e => { SWF.t = e.target.value; re(); };
  box.querySelector('#swt-cap').onchange = e => { SWF.cap = e.target.value; re(); };
  box.querySelector('#swt-cf').onchange = e => { SWF.cf = e.target.checked; re(); };
  box.querySelector('#swt-cash').onchange = e => { SWF.cash = Math.max(0, +e.target.value || 0); re(); };
  box.querySelector('#swt-risk').onchange = e => { SWF.riskPct = Math.min(5, Math.max(0.1, +e.target.value || 1)); re(); };
}

// stock page card
function swingCard(d) {
  const o = d.swing; if (!o || d.etf || !/\.(NS|BO)$/.test(d.symbol)) return '';
  const head = `<h2>📈 Swing setup <span class="mut">(next session${o.asOf ? ' after ' + swDate(o.asOf) : ''})</span></h2>`;
  const why = (o.why || []).map(w => `<li>${esc(w)}</li>`).join(''), warn = (o.warn || []).map(w => `<li class="dn">⚠ ${esc(w)}</li>`).join('');
  if (!o.t) return `<div class="card nogq" id="swing">${head}<p><b>No setup</b> ${o.st === 'watch' ? swBadge('watch') : ''}</p><ul>${why}${o.watch ? `<li>${esc(o.watch)}</li>` : ''}${warn}</ul><p class="src">Rules: see the 📈 Swing setups tab. Educational only.</p></div>`;
  const q = swQty(o.e, o.sl), r = o.e - o.sl;
  return `<div class="card nogq" id="swing">${head}
   <p style="margin:0 0 6px">${swBadge(o.st)} <b>${SWT[o.t]}</b>${o.t === 'breakout' ? (o.conf ? ' <span class="up">· volume confirmed</span>' : ' <span class="mut">· needs a high-volume move</span>') : ''} · score <b>${o.sc}</b>/100${o.st === 'watch' && o.watch ? ` <span class="mut">— ${esc(o.watch)}</span>` : ''}</p>
   <div class="kv"><div><span>Buy above (trigger)</span><b style="font-size:20px">₹${o.e}</b></div><div><span>Stop-loss</span><b class="dn">₹${o.sl} <small>(−${o.riskPct}%)</small></b></div><div><span>Target 1 (2R)</span><b class="up">₹${o.t1}</b></div><div><span>Target 2 (3R)</span><b class="up">₹${o.t2}</b></div><div><span>Risk per share</span><b>₹${r2s(r)}</b></div><div><span>Quantity <small class="mut">(₹${(+SWF.cash).toLocaleString('en-IN')} capital, ${SWF.riskPct}% risk)</small></span><b>${q === null ? '–' : q.toLocaleString('en-IN')}</b></div></div>
   <ul style="margin-top:8px">${why}${warn}</ul>
   <p class="mut" style="font-size:12.5px">Last close ₹${o.close} · 20-EMA ₹${o.e20} · 50-DMA ₹${o.s50} · 200-DMA ₹${o.s200} · RSI ${o.rsi} · ATR ₹${o.atr} · 20-session high ₹${o.hi20} · 52-week high ₹${o.hi52}. Change capital and risk % in the 📈 Swing setups tab.</p>
   ${SW_DISC}</div>`;
}
const r2s = v => (Math.round(v * 100) / 100).toLocaleString('en-IN');
