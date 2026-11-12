'use strict';
// ===== 🧭 Daily plan + 📒 My trades (Swing tab) and the plan card on the stock page =====
// Plan data: data/plan.json (scripts/plan.js every evening, rules in scripts/planrules.js; odds from scripts/planstats.js).
// Your capital, limits and trades stay on this device (localStorage); trade alerts use your private 🔔 Alerts list.
let PLAN = null;
async function planLoad(force) { if (!PLAN || force) { try { PLAN = await getJSON(DATA + 'plan.json'); } catch (e) { PLAN = { err: e.message }; } } return PLAN; }
const PL_REG = { A: ['#15803d', '#dcfce7'], B: ['#15803d', '#dcfce7'], C: ['#a16207', '#fef9c3'], D: ['#c2410c', '#ffedd5'], E: ['#b91c1c', '#fee2e2'] };
const PL_SET = { breakout: '🚀 Breakout', pullback: '↩️ Pullback', continuation: '📈 Trend continuation', early: '🌱 Early-stage trend', none: '— No setup' };
const PL_GK = { breakout: 'breakout', pullback: 'pullback', continuation: 'contin', early: 'earlystage' };
const PL_REJ = { e20: '20 EMA below 50 EMA', p50: 'price below 50 EMA', p200: 'price below 200 EMA', rs: 'weak relative strength', liq: 'poor liquidity', vol: 'abnormal volatility', para: 'parabolic / extended', penny: 'penny / micro-cap', pump: 'pump-and-dump pattern', surv: 'exchange surveillance', pledge: 'heavy promoter pledge' };
const plSym = s => String(s || '').replace(/\.(NS|BO)$/, '');
const inr = v => isNum(v) ? '₹' + Math.round(v).toLocaleString('en-IN') : '–';
const inr2 = v => isNum(v) ? '₹' + r2s(v) : '–';
const sgn = (v, d = 1) => isNum(v) ? (v > 0 ? '+' : '') + (+v).toFixed(d) : '–';
const pctS = v => isNum(v) ? Math.round(v * 100) + '%' : '–';
const plMaxPos = cap => cap < 50000 ? 3 : cap <= 200000 ? 5 : cap <= 1000000 ? 8 : 10;
const plBadge = cls => { const c = PL_REG[cls] || PL_REG.C; return `<span class="tag" style="background:${c[1]};color:${c[0]};margin-left:0;font-weight:700">${cls}</span>`; };
const plGrade = g => `<span class="tag" style="margin-left:0;font-weight:700;background:${g === 'A+' || g === 'A' ? '#dcfce7' : g === 'B' ? '#fef9c3' : '#fee2e2'};color:${g === 'A+' || g === 'A' ? '#15803d' : g === 'B' ? '#a16207' : '#b91c1c'}">${esc(g)}</span>`;
const plDef = () => { if (!isNum(SWF.maxRisk)) SWF.maxRisk = 5; if (!isNum(SWF.posPct)) SWF.posPct = 25; if (!PlanPort.BROKERS[SWF.broker] && SWF.broker !== 'other') SWF.broker = 'groww'; };
// your broker's charges (planport.js) and a one-line description of them
const plCosts = () => PlanPort.costsFor(SWF.broker, SWF.brk);
const plCostTxt = c => `${c.brkPct ? `brokerage ${+(c.brkPct * 100).toFixed(2)}% per order (min ₹${c.brkMin}, max ₹${c.brkMax})` : `brokerage ₹${c.brk || 0} per order`}, DP charge ₹${(+c.dp || 0).toFixed(2)} per stock per selling day`;
// shape of the signal-day candle (indicators.js candle): where it closed in the day's range, body, upper wick
const PL_CLB = { hi: 'Top quarter (75–100%)', mid: 'Upper half (50–74%)', lo: 'Lower half (0–49%)' };
const plClBand = cl => cl == null ? null : cl >= 75 ? 'hi' : cl >= 50 ? 'mid' : 'lo';
const plCdlTxt = c => c ? `closed at <b>${c.cl}%</b> of the day's range (${c.cl >= 75 ? 'near the high — buyers held control' : c.cl >= 50 ? 'upper half' : 'lower half — sellers pushed it back from the high'}) · ${c.up ? 'green' : 'red'} body ${c.body}% · upper wick ${c.uw}%${c.uw >= 40 ? ' <span class="dn">(selling into the rise)</span>' : ''}` : 'no range that day';
// GTT order tickets to paste into the broker app (prices on the ₹0.05 tick)
const plTick = v => (Math.round(v / 0.05) * 0.05).toFixed(2);
function plTicket(b) {
  const pl = b.plan, q = b.q, h = Math.floor(q / 2), sl = `stop-loss trigger ₹${plTick(pl.SL)} (limit ₹${plTick(pl.SL * 0.99)})`;
  const L = [`${plSym(b.s)} — NSE, Delivery (CNC)`, `1) Tonight: GTT BUY ${q} share${q === 1 ? '' : 's'} · trigger ₹${plTick(pl.E)} · limit ₹${plTick(pl.E * 1.005)}`, '2) After it buys, the same evening:'];
  if (h >= 1 && q - h >= 1) { L.push(`   GTT OCO SELL ${h} · ${sl} · target trigger ₹${plTick(pl.T1)} (Target 1)`); L.push(`   GTT SELL ${q - h} · ${sl} — raise it to ₹${plTick(pl.E)} (breakeven) once a day closes at or above ₹${plTick(pl.be)}`); }
  else L.push(`   GTT OCO SELL ${q} · ${sl} · target trigger ₹${plTick(pl.T1)} (Target 1)`);
  L.push(`   Risk ≈ ₹${Math.round(b.risk).toLocaleString('en-IN')} + charges ≈ ₹${Math.round(b.fees).toLocaleString('en-IN')}`);
  return L.join('\n');
}
async function plCopy(text, btn) {
  // the Clipboard API can stay pending (permission prompt, embedded/automated browsers): give it 1.5 s, then the old way
  let ok = false; try { ok = await Promise.race([navigator.clipboard.writeText(text).then(() => true), new Promise(r => setTimeout(() => r(false), 1500))]); } catch { }
  if (!ok) try { const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;top:0;opacity:0'; document.body.appendChild(t); t.select(); ok = document.execCommand('copy'); t.remove(); } catch { }
  const old = btn.dataset.lab || (btn.dataset.lab = btn.textContent); btn.textContent = ok ? '✔ Copied' : 'Copy by hand ↓'; setTimeout(() => { btn.textContent = old; }, 1800);
  if (!ok) {   // show the text, selected, so it can be copied by hand (long-press → Copy on a phone)
    const d = trDlg(); d.innerHTML = `<h2 style="margin-top:0">📋 GTT orders</h2><p class="mut" style="font-size:13px">Your browser didn't allow automatic copying. The text is selected — copy it (Ctrl+C, or long-press → Copy).</p>
      <textarea readonly style="width:100%;height:260px;box-sizing:border-box;font:13px/1.4 monospace;padding:8px;border:1px solid var(--line);border-radius:8px">${esc(text)}</textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn" id="cpX">Close</button></div>`;
    d.showModal(); d.querySelector('#cpX').onclick = () => d.close(); const ta = d.querySelector('textarea'); ta.focus(); ta.select();
  }
}

// ---------- My trades storage (this device only) ----------
const TR = () => LS.get('mytrades', { v: 1, trades: [] });
const trSave = t => LS.set('mytrades', t);
const trRem = t => t.qty - (t.sold || []).reduce((s, x) => s + x.q, 0);
const trOpen = () => TR().trades.filter(t => !t.exit && trRem(t) > 0);

// ---------- portfolio construction (capital-dependent, so done here) ----------
function planBuild(P) {
  plDef();
  const cap = +SWF.cash || 0, reg = P.market.regime, open = trOpen();
  const B = PlanPort.buildPortfolio(P.buy.map(b => ({ ...b, theme: swSec(b).sec })), { capital: cap, riskPct: SWF.riskPct, maxRisk: SWF.maxRisk, posPct: SWF.posPct, exposure: reg.exposure,
    open: open.map(t => ({ s: t.s, theme: swSec({ s: t.s }).sec, qty: trRem(t), entry: t.entry, sl: t.sl })), costs: plCosts() });
  B.skipped = B.skipped.map(([b, w]) => [b, w === 'already held' ? 'already in 📒 My trades' : w]);
  return { ...B, reg };
}
// history test (scripts/backtest.js → backtest.json) and paper portfolio (scripts/track.js → track.json)
let PLBT = null, PLTR = null;
async function plEvidenceLoad() { const g = async f => { try { return await getJSON(DATA + f); } catch { return null; } }; if (!PLBT) PLBT = await g('backtest.json'); if (!PLTR) PLTR = await g('track.json'); }
const plConfBand = c => c < 55 ? '<55' : c < 60 ? '55-59' : c < 65 ? '60-64' : c < 70 ? '65-69' : c < 75 ? '70-74' : '75+';
const plRef = () => PLBT && PLBT.runs ? (PLBT.runs.find(r => r.capital === 100000) || PLBT.runs[0]) : null;
function plSpark(series, w = 320, h = 70) {   // [[label, [[date, value]...], colour]] → small line chart
  const all = series.flatMap(x => x[1].map(p => p[1])), lo = Math.min(...all), hi = Math.max(...all);
  const line = (pts, col) => `<polyline fill="none" stroke="${col}" stroke-width="2" points="${pts.map((p, i) => `${(i / Math.max(1, pts.length - 1) * w).toFixed(1)},${(h - (p[1] - lo) / Math.max(1e-9, hi - lo) * h).toFixed(1)}`).join(' ')}"/>`;
  return `<svg viewBox="0 -4 ${w} ${h + 8}" style="width:100%;max-width:${w}px;height:${h + 8}px" role="img" aria-label="equity curve">${series.map(x => line(x[1], x[2])).join('')}</svg>
    <div class="mut" style="font-size:12px">${series.map(x => `<span style="color:${x[2]}">━</span> ${esc(x[0])}`).join(' · ')}</div>`;
}
function plEvidence() {
  const BT = PLBT, TR = PLTR, ref = plRef(); if (!ref) return '';
  const t = ref.trades || {}, beat = ref.cagr >= BT.nifty.cagr, edge = (t.avgR ?? 0) > 0.05;
  const tone = edge && beat ? ['#15803d', '#dcfce7', '✅'] : edge || ref.ret > 0 ? ['#a16207', '#fef9c3', '⚠️'] : ['#b91c1c', '#fee2e2', '⛔'];
  const verdict = edge && beat ? 'The rules made money after costs and beat simply holding Nifty in the history test.'
    : `The rules have <b>not shown an edge after costs</b>: ${sgn(t.avgR, 2)}R per trade, ${ref.cagr}% a year vs ${BT.nifty.cagr}% for simply holding Nifty. Treat the plan as <b>paper trades</b> until the paper portfolio below proves otherwise — or risk very little (0.25–0.5% a trade).`;
  const row = r => `<tr><td style="text-align:left">${inr(r.capital)}</td><td>${inr(r.end)}</td><td class="${r.ret >= 0 ? 'up' : 'dn'}">${sgn(r.ret)}%</td><td>${r.cagr}%</td><td class="dn">${r.maxDD}%</td><td>${r.trades.n}</td><td>${pctS(r.trades.win)}</td><td>${sgn(r.trades.avgR, 2)}R <small class="mut">(${sgn(r.trades.avgRg, 2)} before costs)</small></td><td>${r.trades.pf ?? '–'}</td><td>${inr(r.fees)}</td></tr>`;
  const grp = (o, lab) => Object.entries(o || {}).sort((x, y) => y[1].n - x[1].n).map(([k, v]) => `<tr><td style="text-align:left">${lab ? lab(k) : esc(k)}</td><td>${v.n}</td><td>${pctS(v.win)}</td><td class="${v.avgR > 0 ? 'up' : 'dn'}">${sgn(v.avgR, 2)}R</td></tr>`).join('');
  const n0 = BT.nifty.curve[0][1], nifty = BT.nifty.curve.map(([d, v]) => [d, v / n0 * ref.capital]);
  let trHTML = '<p class="mut">The paper portfolio starts with tonight\'s plan.</p>';
  if (TR && TR.sum) { const s = TR.sum, tt = s.trades || {};
    trHTML = `<p style="margin:0 0 4px">Started <b>${swDate(TR.start)}</b> with ${inr(TR.capital)} (1% risk a trade, ${esc(PlanPort.COSTS.label)} charges from 13 Nov 2026 — ₹0 brokerage before) and trades every evening's plan by itself — no real money. Now <b>${inr(s.end)}</b> (<span class="${s.ret >= 0 ? 'up' : 'dn'}">${sgn(s.ret, 2)}%</span>)${TR.niftyRet != null ? ` vs Nifty ${sgn(TR.niftyRet, 2)}%` : ''} · ${tt.n || 0} closed trade${tt.n === 1 ? '' : 's'}${tt.n ? `, ${pctS(tt.win)} won, ${sgn(tt.avgR, 2)}R a trade after costs` : ''} · open: ${(TR.openView || []).map(p => `${esc(plSym(p.s))} ${p.rem} @ ${inr2(p.entry)}`).join(', ') || 'none'} · paper orders for the next session: ${(TR.pendingView || []).map(o => esc(plSym(o.s))).join(', ') || 'none'}.</p>
      <p class="mut" style="font-size:12.5px">${(tt.n || 0) < 40 ? `It needs about 40 closed trades (2–4 months) before its result means much${tt.n ? ` — ${tt.n} so far` : ''}.` : 'Enough trades to start judging the rules on live data.'}</p>`; }
  return `<div class="card" id="plev" style="border-left:4px solid ${tone[0]}"><h2>🧪 Evidence check: does this plan make money?</h2>
    <p style="background:${tone[1]};color:${tone[0]};padding:8px 10px;border-radius:8px;margin:0 0 8px">${tone[2]} ${verdict}</p>
    <h3 style="margin:6px 0 4px">History test <small class="mut">(${swDate(BT.from)} → ${swDate(BT.to)}, ${BT.stocks} stocks, every evening rebuilt with today's rules)</small></h3>
    ${plSpark([[`₹1 lakh following the plan → ${inr(ref.end)}`, ref.curve, '#2563eb'], [`₹1 lakh in Nifty → ${inr(nifty[nifty.length - 1][1])}`, nifty, '#94a3b8']])}
    <div class="tw"><table class="pt" id="plbt"><tr><th style="text-align:left">Capital</th><th>Ended</th><th>Return</th><th>A year</th><th>Worst fall</th><th>Trades</th><th>Won</th><th>Per trade${swq('expectancy')}</th><th>Profit factor</th><th>Charges</th></tr>${BT.runs.map(row).join('')}
      <tr><td style="text-align:left">Nifty (hold)</td><td>–</td><td class="${BT.nifty.ret >= 0 ? 'up' : 'dn'}">${sgn(BT.nifty.ret)}%</td><td>${BT.nifty.cagr}%</td><td class="dn">${BT.nifty.maxDD}%</td><td colspan="5" class="mut" style="text-align:left">buy and hold, no trading</td></tr></table></div>
    <details class="how"><summary>What worked and what didn't (₹1 lakh run)</summary><div style="display:flex;flex-wrap:wrap;gap:10px">
      <div class="tw"><table class="pt pls"><tr><th style="text-align:left">Setup</th><th>Trades</th><th>Won</th><th>Per trade</th></tr>${grp(ref.bySetup, k => PL_SET[k] || esc(k))}</table></div>
      <div class="tw"><table class="pt pls"><tr><th style="text-align:left">Confidence${swq('tconf')}</th><th>Trades</th><th>Won</th><th>Per trade</th></tr>${grp(ref.byConf)}</table></div>
      <div class="tw"><table class="pt pls"><tr><th style="text-align:left">Market</th><th>Trades</th><th>Won</th><th>Per trade</th></tr>${grp(ref.byRegime, k => esc(k + ' ' + ({ A: 'Strong Bull', B: 'Bull', C: 'Neutral', D: 'Weak', E: 'Bear' }[k] || '')))}</table></div>
      ${ref.byClose ? `<div class="tw"><table class="pt pls"><tr><th style="text-align:left">Signal-day close${swq('clv')}</th><th>Trades</th><th>Won</th><th>Per trade</th></tr>${grp(ref.byClose, k => PL_CLB[k] || esc(k))}</table></div>` : ''}
      <div class="tw"><table class="pt pls"><tr><th style="text-align:left">Exit</th><th>Trades</th><th>Won</th><th>Per trade</th></tr>${grp(ref.byExit)}</table></div></div>
      <p class="mut" style="font-size:12.5px">How it was tested: every past evening the plan was rebuilt with the same code as tonight's and traded next morning with GTT buy-stops (limit +0.5%; a gap above the limit = no fill), stops and targets during the day (gap through a stop = sold at the open; stop and target on one candle = stop first), breakeven at +1R, half at T1, trailing under the 20 EMA, a 15-session time stop, and real charges (STT, stamp duty, exchange and SEBI fees, GST, ${BT.costs && BT.costs.label ? esc(BT.costs.label) + ': ' : ''}${plCostTxt(BT.costs || { brk: 0, dp: 15.93 })}). <b>It flatters the rules:</b> only stocks still listed and liquid today were tested (companies that collapsed are missing), and market cap / pledge / surveillance are today's. Real results are likely worse. Rebuilt every week.</p></details>
    <h3 style="margin:8px 0 4px">Paper portfolio <small class="mut">(forward test from ${TR && TR.start ? swDate(TR.start) : 'today'})</small></h3>${trHTML}</div>`;
}
// ---------- your capital and limits: one bar on both views, saved on this device, change any time ----------
const plBar = () => `<div class="card" style="padding:10px 12px"><div class="swbar" style="margin:0"><b style="font-size:14px">💰 Your capital</b>
  <label class="mut" style="font-size:13px">₹ <input type="number" id="pl-cash" min="0" step="1000" value="${SWF.cash}" aria-label="Capital in rupees"></label>
  <label class="mut" style="font-size:13px">Risk / trade %${swq('riskpct')} <input type="number" id="pl-risk" min="0.1" max="5" step="0.1" value="${SWF.riskPct}" style="width:64px"></label>
  <label class="mut" style="font-size:13px">Max total risk %${swq('portrisk')} <input type="number" id="pl-mrisk" min="0.5" max="20" step="0.5" value="${SWF.maxRisk}" style="width:64px"></label>
  <label class="mut" style="font-size:13px">Max per stock % <input type="number" id="pl-pos" min="5" max="100" step="5" value="${SWF.posPct}" style="width:64px"></label>
  <label class="mut" style="font-size:13px">Broker${swq('charges')} <select id="pl-brkr" style="padding:7px;border:1px solid var(--line);border-radius:8px;font-size:14px;background:#fff">${[['groww', 'Groww'], ['zerodha', 'Zerodha'], ['other', 'Other']].map(([k, n]) => `<option value="${k}"${SWF.broker === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
  ${SWF.broker === 'other' ? `<label class="mut" style="font-size:13px">Brokerage ₹ / order <input type="number" id="pl-brk" min="0" max="100" step="1" value="${+SWF.brk || 0}" style="width:64px"></label>` : ''}</div>
  <p class="mut" style="font-size:12.5px;margin:4px 0 0">→ risk ≈ ${inr(SWF.cash * SWF.riskPct / 100)} a trade, at most ${inr(SWF.cash * SWF.maxRisk / 100)} on all open trades, at most ${inr(SWF.cash * SWF.posPct / 100)} in one stock. Charges: ${esc(plCosts().label)} — ${plCostTxt(plCosts())}${SWF.broker === 'groww' ? ' (fund your Groww account normally: paying from a UPI-mandate balance costs 1% brokerage)' : ''}. Saved on this device; change it any time — the plan and quantities update at once.</p></div>`;
function plBarWire(box, re) {
  const num = (id, f) => { const el = box.querySelector(id); if (el) el.onchange = e => { f(+e.target.value); swSave(); re(); }; };
  num('#pl-cash', v => SWF.cash = Math.max(0, v || 0)); num('#pl-risk', v => SWF.riskPct = Math.min(5, Math.max(0.1, v || 1)));
  num('#pl-mrisk', v => SWF.maxRisk = Math.min(20, Math.max(0.5, v || 5))); num('#pl-pos', v => SWF.posPct = Math.min(100, Math.max(5, v || 25)));
  num('#pl-brk', v => SWF.brk = Math.max(0, Math.min(100, v || 0)));
  const bs = box.querySelector('#pl-brkr'); if (bs) bs.onchange = e => { SWF.broker = e.target.value; swSave(); re(); };
}

// ---------- the Daily plan view ----------
async function renderPlan(box) {
  plDef();
  box.innerHTML = `${swMode()}<p class="mut">Loading the daily plan…</p>`; swModeWire(box);
  const P = await planLoad(); if (typeof ensureSummary === 'function') await ensureSummary(); await plEvidenceLoad();
  if (!P || P.err || !P.market) { box.innerHTML = `${swMode()}<p>${NA} — the daily plan hasn't been built yet; it appears after the next evening refresh (about 20:30 IST).</p>`; swModeWire(box); return; }
  const M = P.market, reg = M.regime, B = planBuild(P), ST = P.stats && P.stats.by, stale = (Date.now() - Date.parse(P.asOf + 'T15:30:00+05:30')) / 864e5 > 4;
  const ix = M.indices || [], vix = ix.find(x => /VIX/.test(x.name)), oi = M.fiiOI;
  const bullet = w => `<li class="${w[0] === '+' ? 'ok' : w[0] === '−' ? 'flag' : ''}">${w[0] === '+' ? '✔' : w[0] === '−' ? '✘' : '•'} ${esc(w[1])}</li>`;
  const ixRow = x => `<tr><td style="text-align:left">${esc(x.name)}</td><td><b>${r2s(x.close)}</b></td><td class="${x.chg >= 0 ? 'up' : 'dn'}">${sgn(x.chg, 2)}%</td><td>${/VIX/.test(x.name) ? '–' : `${x.close > x.e20 ? '✔' : '✘'} ${x.close > x.e50 ? '✔' : '✘'} ${x.close > x.e200 ? '✔' : '✘'}`}</td><td>${x.rsi}</td><td>${/VIX/.test(x.name) ? '–' : sgn(x.offHi) + '%'}</td><td>${sgn(x.r1m)}%</td></tr>`;
  const br = M.breadth || {};
  const oiTxt = oi && oi.fii ? `FIIs hold <b>${oi.fii.longPct}% long</b> in index futures (${oi.fii.long.toLocaleString('en-IN')} long vs ${oi.fii.short.toLocaleString('en-IN')} short contracts${oi.prev && oi.prev.fii ? `; ${sgn(oi.fii.longPct - oi.prev.fii.longPct)} pts since ${swDate(oi.prev.d)}` : ''})${swq('fiioi')} — ${oi.fii.longPct < 35 ? 'they are still betting on a fall, so the rally is not backed by FII futures buying' : oi.fii.longPct > 60 ? 'they are positioned for a rise' : 'mixed positioning'}. DIIs: ${oi.dii ? oi.dii.longPct + '% long' : '–'}.` : 'FII/DII futures positions not available today.';
  const secT = (M.secs || []).slice(0, 4).map(s => `${esc(s.sec)} ${sgn(s.r3m)}%`).join(', '), secB = (M.secs || []).slice(-3).map(s => `${esc(s.sec)} ${sgn(s.r3m)}%`).join(', ');
  // --- sections ---
  const S1 = `<div class="card"><h2>1 · Market summary <span class="mut">(close of ${swDate(P.asOf)})</span></h2>
    <p style="font-size:17px;margin:0 0 6px">${plBadge(reg.cls)} <b>${esc(reg.label)}</b>${swq('regime')} · confidence <b>${reg.conf}</b>/100 · maximum exposure <b>${reg.exposure}%</b>${swq('expcap')} <small class="mut">(market score ${reg.score}/100)</small></p>
    <ul style="margin:4px 0 8px;padding-left:18px;list-style:none">${reg.why.map(bullet).join('')}</ul>
    ${reg.crossIn ? `<p class="mut" style="font-size:13px">If Nifty holds near ${r2s(reg.nifty.close)}, its 50 EMA would cross above the 200 EMA in about <b>${reg.crossIn} sessions</b> — a step towards a Bull market.</p>` : ''}
    <div class="tw"><table class="pt" id="plix"><tr><th style="text-align:left">Index</th><th>Close</th><th>Day</th><th>&gt; 20 / 50 / 200 EMA${swq('ema')}</th><th>RSI${swq('rsi')}</th><th>From 52-wk high</th><th>1 month</th></tr>${ix.map(ixRow).join('')}</table></div>
    <p style="font-size:14px;margin:8px 0 4px"><b>Breadth${swq('breadth')}</b> (${br.n} liquid NSE stocks): ${pctS(br.above20)} above their 20 EMA, <b>${pctS(br.above50)}</b> above the 50 EMA, ${pctS(br.above200)} above the 200 EMA; only ${pctS(br.aligned)} have the full 20 &gt; 50 &gt; 200 stack. Today ${br.adv} rose, ${br.dec} fell.
     ${br.r1m ? `Last month: large caps ${sgn(br.r1m.large)}%, mid ${sgn(br.r1m.mid)}%, small ${sgn(br.r1m.small)}% (typical stock)${br.r1m.large - br.r1m.small > 5 ? ' — <b>a narrow, large-cap-led rally</b>' : ''}.` : ''}</p>
    <p style="font-size:14px;margin:4px 0"><b>Sector rotation</b> (3 months): leading ${secT || '–'} · lagging ${secB || '–'}. Strongest industries: ${(M.indTop || []).slice(0, 6).map(x => esc(x.ind)).join(', ')}.</p>
    <p style="font-size:14px;margin:4px 0"><b>Institutions:</b> ${oiTxt} Daily FII/DII <i>cash</i> buying and selling: <a href="https://www.nseindia.com/reports/fii-dii" target="_blank" rel="noopener">NSE FII/DII report ↗</a> <small class="mut">(NSE doesn't let servers fetch it, so open it yourself)</small>.</p></div>`;

  const allocLo = B.expCap / B.nMax, allocHi = Math.min(B.posCap, B.expCap / Math.max(1, Math.min(B.nMax, 3)));
  const S2 = `<div class="card"><h2>2 · Portfolio recommendation</h2>
    <ul style="margin:4px 0;padding-left:18px">
     <li>Up to <b>${B.nMax} positions</b>${swq('maxpos')} for ${inr(B.cap)} (rule: under ₹50k → 3, ₹50k–2L → 5, ₹2L–10L → 8, above → 10).</li>
     <li>${esc(reg.label)} market → invest at most <b>${reg.exposure}%</b> = <b>${inr(B.expCap)}</b>; keep the rest in cash.</li>
     <li>Risk per trade <b>${inr(B.riskAmt)}</b> (${SWF.riskPct}%); all open trades together at most <b>${inr(B.maxRiskAmt)}</b> (${SWF.maxRisk}%).</li>
     <li>Ideal size per position about <b>${inr(allocLo)}–${inr(allocHi)}</b>, never more than ${SWF.posPct}% (${inr(B.posCap)}) in one stock.</li>
     ${B.nOpen ? `<li>Already in 📒 My trades: ${B.nOpen} open (${inr(B.openInv)} invested, ${inr(B.openRisk)} at risk) — counted against these limits.</li>` : ''}</ul>
    ${B.picks.length ? `<p><b>${B.picks.length} new trade${B.picks.length === 1 ? '' : 's'}</b> qualify for ${swDate(P.next)}${B.picks.length < 3 && reg.exposure <= 50 ? ' — few on purpose: the market is not giving many clean setups' : ''}.</p>`
      : `<p style="font-size:16px"><b>🟡 NO TRADE for ${swDate(P.next)}.</b> No stock passes every rule${P.buy.length ? ' within your limits' : ''}. Cash is a position — waiting costs nothing.</p>`}</div>`;

  const prob = pr => pr ? `${pctS(pr.T1)} / ${pctS(pr.T2)} / ${pctS(pr.T3)} / ${pctS(pr.T4)}` : '–';
  const pick = (b, i) => { const pl = b.plan, pr = pl.prob;
    return `<div class="card" style="border-left:4px solid #15803d"><h3 style="margin:0 0 4px">#${i + 1} <a href="#" data-s="${esc(b.s)}">${esc(plSym(b.s))}</a> <small class="mut">${esc((b.n || '').slice(0, 40))} · ${esc(swSec(b).sec || b.sec || '')}${b.cap ? ' · ' + esc(b.cap) : ''}</small></h3>
     <p style="margin:0 0 6px">Trend ${plGrade(b.grade)}${swq('tgrade')} <small class="mut">${b.ts}/100</small> · ${PL_SET[b.setup]}${swq(PL_GK[b.setup])} <small class="mut">score ${b.ss}/100${swq('setupsc')}</small> · confidence <b>${b.conf}</b>/100${swq('tconf')}</p>
     <p style="margin:0 0 4px;font-size:14px"><b>Trend in plain words:</b> ${esc(b.tn.join('; '))}.</p>
     <p style="margin:0 0 4px;font-size:14px"><b>Why this setup:</b> ${esc(b.sw.join('; '))}${pl.moved ? `; the trigger sits just above the 52-week high ${inr2(b.hi52)}, so you buy only if it makes a new high` : ''}.</p>
     ${b.cdl !== undefined ? `<p style="margin:0 0 4px;font-size:14px"><b>Signal-day candle${swq('clv')}:</b> ${plCdlTxt(b.cdl)}.${(() => { const r = plRef(), k = b.cdl && plClBand(b.cdl.cl), x = r && r.byClose && k && r.byClose[k]; return x ? ` <span class="mut">History test, ${PL_CLB[k].replace(/ \(.*/, '').toLowerCase()} closes: ${x.n} trades, won ${pctS(x.win)}, ${sgn(x.avgR, 2)}R each.</span>` : ''; })()}</p>` : ''}
     ${b.warn.length ? `<p class="dn" style="margin:0 0 4px;font-size:13.5px">⚠ ${b.warn.map(esc).join(' · ')}</p>` : ''}
     <div class="tw"><table class="pt plk"><tr><th>Entry${swq('trigger')}</th><th>Aggressive</th><th><b>Normal ✔</b></th><th>Conservative</th><th>Ideal</th></tr><tr><td></td><td>${inr2(pl.ent.aggr)}<br><small class="mut">at the open</small></td><td><b>${inr2(pl.ent.norm)}</b><br><small class="mut">buy-stop</small></td><td>${inr2(pl.ent.cons)}<br><small class="mut">after a close above</small></td><td>${inr2(pl.ent.ideal[0])}–${r2s(pl.ent.ideal[1])}<br><small class="mut">${b.setup === 'breakout' ? 'retest' : 'dip to 20 EMA'}</small></td></tr>
      <tr><th>Stop-loss${swq('stoploss')}</th><th>Technical</th><th><b>Structural ✔</b></th><th>Conservative</th><th>Risk / share</th></tr><tr><td></td><td>${inr2(pl.stops.tech)}</td><td><b class="dn">${inr2(pl.SL)}</b></td><td>${inr2(pl.stops.cons)}</td><td>${inr2(pl.R)} <small class="dn">(${pl.Rpct}%)</small></td></tr>
      <tr><th>Targets${swq('rmult')}</th><th>T1 (2R)</th><th>T2 (3R)</th><th>T3 (4R)</th><th>T4 (6R)</th></tr><tr><td><small class="mut">chance*</small></td><td class="up">${inr2(pl.T1)}<br><small>${pr ? pctS(pr.T1) : ''}</small></td><td class="up">${inr2(pl.T2)}<br><small>${pr ? pctS(pr.T2) : ''}</small></td><td class="up">${inr2(pl.T3)}<br><small>${pr ? pctS(pr.T3) : ''}</small></td><td class="up">${inr2(pl.T4)}<br><small>${pr ? pctS(pr.T4) : ''}</small></td></tr></table></div>
     <p style="margin:6px 0 4px;font-size:14px"><b>Wrong if${swq('invalid')}:</b> ${esc(pl.inval)}. <span class="mut">Expected holding: ${pr && pr.days ? `about ${pr.days} sessions to T1, up to 8 weeks for the rest` : '3 days to 8 weeks'}.</span></p>
     ${(() => { const r = plRef(); if (!r) return ''; const x = r.bySetup && r.bySetup[b.setup], c = r.byConf && r.byConf[plConfBand(b.conf)];
       return `<p class="mut" style="margin:4px 0;font-size:13px">🧪 History test: ${x ? `${PL_SET[b.setup].replace(/^\S+ /, '').toLowerCase()} trades ${x.n}, won ${pctS(x.win)}, ${sgn(x.avgR, 2)}R each` : 'no comparable trades'}${c ? ` · confidence ${plConfBand(b.conf)}: ${c.n} trades, ${sgn(c.avgR, 2)}R each` : ''} (after costs).</p>`; })()}
     <p style="margin:4px 0 0"><button class="btn" data-pllog="${esc(b.s)}">📒 Log as my trade</button> <button class="btn sec" data-plcopy="${esc(b.s)}">📋 Copy GTT orders</button> <small class="mut">Buy ${b.q} share${b.q === 1 ? '' : 's'} = ${inr(b.cost)}, max loss ${inr(b.risk)} + charges ≈ ${inr(b.fees)} <span title="the limit that set the quantity">(set by ${esc(b.bind)})</span></small></p></div>`; };
  const S3 = `<h2 style="margin:14px 0 6px">3 · Top ranked opportunities</h2>${B.picks.length ? B.picks.map(pick).join('') : '<p class="mut">None today.</p>'}
    ${B.skipped.length ? `<details class="how"><summary>${B.skipped.length} more passed the rules but are not in the portfolio</summary><ul style="padding-left:18px">${B.skipped.map(([b, w]) => `<li><a href="#" data-s="${esc(b.s)}">${esc(plSym(b.s))}</a> ${plGrade(b.grade)} ${PL_SET[b.setup]} · buy above ${inr2(b.plan.E)}, stop ${inr2(b.plan.SL)} — <span class="mut">${esc(w)}</span></li>`).join('')}</ul></details>` : ''}`;

  const S4 = B.picks.length ? `<div class="card"><h2>4 · Position sizing${swq('possize')}</h2><p class="mut" style="font-size:13px;margin:0 0 6px">Quantity = risk amount ÷ (entry − stop), then cut to fit the per-stock, exposure and total-risk limits.</p>
    <div class="tw"><table class="pt" id="plsz"><tr><th style="text-align:left">#</th><th>Entry</th><th>Stop</th><th>Risk/share</th><th>Qty</th><th>Capital</th><th>% of capital</th><th>Max loss</th><th>Charges${swq('charges')}</th></tr>
    ${B.picks.map((b, i) => `<tr><td style="text-align:left">${i + 1}. ${esc(plSym(b.s))}</td><td>${inr2(b.plan.E)}</td><td>${inr2(b.plan.SL)}</td><td>${inr2(b.plan.R)}</td><td><b>${b.q}</b></td><td>${inr(b.cost)}</td><td>${(b.cost / B.cap * 100).toFixed(1)}%</td><td class="dn">${inr(b.risk)}</td><td>${inr(b.fees)} <small class="mut">(${Math.round(b.feesR * 100)}% of risk)</small></td></tr>`).join('')}</table></div>
    <p class="mut" style="font-size:12.5px;margin:4px 0 0">Charges = STT, stamp duty, exchange and SEBI fees, GST, ${esc(plCosts().label)} ${plCostTxt(plCosts())} — buying once and selling in two halves. Change the broker in 💰 Your capital above. A trade whose charges would eat more than 15% of its risk is skipped.</p></div>` : '';

  const newInv = B.picks.reduce((s, b) => s + b.cost, 0), newRisk = B.picks.reduce((s, b) => s + b.risk, 0);
  const rT1 = B.picks.reduce((s, b) => s + b.q * (b.plan.T1 - b.plan.E), 0), rT2 = B.picks.reduce((s, b) => s + b.q * (b.plan.T2 - b.plan.E), 0);
  const fees = B.picks.reduce((s, b) => s + b.fees, 0), avgR = plRef() ? plRef().trades.avgR : ST && ST.all ? ST.all.avgR : null;
  const S5 = `<div class="card"><h2>5 · Risk dashboard${B.picks.length ? ' <span class="mut">(if every order fills)</span>' : ''}</h2><div class="kv">
    <div><span>Total capital</span><b>${inr(B.cap)}</b></div><div><span>Invested${B.nOpen ? ' (incl. open trades)' : ''}</span><b>${inr(B.inv)}</b></div><div><span>Cash remaining</span><b>${inr(B.cap - B.inv)}</b></div>
    <div><span>Portfolio exposure</span><b>${(B.inv / Math.max(1, B.cap) * 100).toFixed(1)}%</b> <small class="mut">cap ${reg.exposure}%</small></div><div><span>Total risk</span><b class="dn">${inr(B.risk)}</b> <small class="mut">${(B.risk / Math.max(1, B.cap) * 100).toFixed(2)}% (limit ${SWF.maxRisk}%)</small></div>
    <div><span>Worst case${swq('gaprisk')}</span><b class="dn">≈ ${inr(B.risk * 1.5)}</b> <small class="mut">if stocks gap through their stops</small></div>
    ${B.picks.length ? `<div><span>Charges (buy + sell)${swq('charges')}</span><b>≈ ${inr(fees)}</b> <small class="mut">${(fees / Math.max(1, newRisk) * 100).toFixed(0)}% of the risk</small></div><div><span>Reward at T1 / T2 after charges</span><b class="up">${inr(rT1 - fees)} / ${inr(rT2 - fees)}</b></div><div><span>Reward : risk</span><b>${((rT1 - fees) / Math.max(1, newRisk)).toFixed(1)} : 1 at T1</b></div>
    ${isNum(avgR) ? `<div><span>History test, per trade after charges${swq('expectancy')}</span><b class="${avgR > 0 ? 'up' : 'dn'}">${sgn(avgR, 2)}R ≈ ${inr(avgR * newRisk)} on these trades</b> <small class="mut">average, not a promise — see 🧪 Evidence check</small></div>` : ''}` : ''}</div></div>`;

  const gttL = E => '₹' + r2s(Math.round(E * 1.005 / 0.05) * 0.05);
  const W = P.watch.filter(w => !B.picks.some(b => b.s === w.s)).slice(0, 15), AV = P.avoid.slice(0, 15);
  const S6 = `<div class="card"><h2>6 · Tomorrow morning action plan <span class="mut">(${swDate(P.next)})</span></h2>
    <h3 style="margin:6px 0 4px">🟢 BUY TOMORROW</h3>${B.picks.length ? `<p class="mut" style="font-size:13px;margin:0 0 4px">Place these tonight as GTT${swq('gtt')} buy orders (trigger → limit). If a stock never trades above its trigger, nothing happens — that's fine.</p>
    <p style="margin:0 0 6px"><button class="btn" id="plcopyall">📋 Copy all orders</button> <small class="mut">— the exact GTT buy, stop-loss and target orders for each stock, to paste into a note or check against your broker app</small></p>
    <div class="tw"><table class="pt" id="plbuy"><tr><th style="text-align:left">Stock</th><th>GTT trigger → limit</th><th>Stop-loss</th><th>Target T1 / T2</th><th>Qty</th><th>Capital</th><th>Confidence</th><th>Close in range${swq('clv')}</th><th></th></tr>
    ${B.picks.map(b => `<tr data-s="${esc(b.s)}"><td style="text-align:left"><b>${esc(plSym(b.s))}</b></td><td>${inr2(b.plan.E)} → ${gttL(b.plan.E)}</td><td class="dn">${inr2(b.plan.SL)}</td><td class="up">${inr2(b.plan.T1)} / ${inr2(b.plan.T2)}</td><td><b>${b.q}</b></td><td>${inr(b.cost)}</td><td>${b.conf}/100</td><td>${b.cdl ? b.cdl.cl + '%' : '–'}</td><td><button class="btn sec" data-plcopy="${esc(b.s)}" title="Copy this stock's GTT orders" style="padding:4px 7px;font-size:13px">📋</button></td></tr>`).join('')}</table></div>
    <p class="mut" style="font-size:13px">When a buy fills, set the sell orders the same evening: a GTT OCO${swq('oco')} for half the shares (stop-loss + Target 1) and a GTT stop-loss for the other half — 📋 copies them with exact prices. Then log the trade in 📒 My trades. No OCO in your app? Place the stop and the target as two separate GTT sells and cancel the other when one fills. A stop's limit sits 1% under its trigger; if the price opens below that limit, sell at market.</p>` : '<p><b>Nothing.</b> No order to place.</p>'}
    <h3 style="margin:10px 0 4px">🟡 WATCHLIST <small class="mut">(strong trends, not buyable yet)</small></h3>${W.length ? `<ul style="padding-left:18px;margin:0">${W.map(w => `<li><a href="#" data-s="${esc(w.s)}">${esc(plSym(w.s))}</a> ${plGrade(w.grade)} <small class="mut">${PL_SET[w.setup]} · ${inr2(w.p)}, ${sgn(w.ext20)}% vs 20 EMA, RSI ${w.rsi}</small> — ${esc(w.wait)}</li>`).join('')}</ul>` : '<p class="mut">None.</p>'}
    <h3 style="margin:10px 0 4px">🔴 AVOID <small class="mut">(shown by the app's other scans, but fail a rule)</small></h3>${AV.length ? `<ul style="padding-left:18px;margin:0">${AV.map(a => `<li><a href="#" data-s="${esc(a.s)}">${esc(plSym(a.s))}</a> <small class="mut">${esc((a.tags || []).join(', '))}</small> — ${esc(a.why.join('; '))}</li>`).join('')}</ul>` : '<p class="mut">None.</p>'}
    ${P.counts && P.counts.rej ? `<p class="mut" style="font-size:12.5px;margin-top:6px">Of ${P.counts.checked} liquid stocks checked, ${P.counts.passed} passed every rule. Rejections: ${Object.entries(P.counts.rej).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${PL_REJ[k] || k} ${v}`).join(' · ')} (a stock can fail several).</p>` : ''}</div>`;

  const S7 = `<div class="card"><h2>7 · Trade management plan</h2>
    ${B.picks.length ? `<div class="tw"><table class="pt" id="plmg"><tr><th style="text-align:left">Stock</th><th>Stop to breakeven${swq('breakeven')} when it closes ≥</th><th>Sell half at T1${swq('partial')}</th><th>Then trail${swq('trail')}</th><th>Time stop${swq('timestop')}</th></tr>
     ${B.picks.map(b => `<tr><td style="text-align:left">${esc(plSym(b.s))}</td><td>${inr2(b.plan.be)} → stop ${inr2(b.plan.E)}</td><td>${Math.floor(b.q / 2) || b.q} sh @ ${inr2(b.plan.T1)}</td><td>close below 20 EMA / 5-day low</td><td>15 sessions without +1R</td></tr>`).join('')}</table></div>` : ''}
    <ul style="padding-left:18px;margin:6px 0">
     <li><b>Breakeven:</b> once a stock closes 1R above your entry, move the stop up to the entry — the trade can no longer lose money.</li>
     <li><b>Partial profit:</b> sell half at T1 (2R). <b>Trail</b> the rest: exit on a daily close below the 20 EMA or the last 5-day low, whichever is higher.</li>
     <li><b>Exit completely</b> when the trailing stop is hit, at T3, if the stock hasn't reached +1R within 15 sessions, or tighten all stops if Nifty closes below its 20 EMA${reg.nifty ? ` (≈ ${r2s(reg.nifty.e20)})` : ''}.</li>
     <li><b>Gap up</b> past your limit price: the order doesn't fill — don't chase; look again in the evening. <b>Gap down</b> below your stop after you bought: sell at the open, don't hold and hope.</li></ul></div>`;

  const minus = reg.why.filter(w => w[0] === '−').map(w => w[1]);
  const para = (P.avoid || []).filter(a => (a.code || []).includes('para') || (a.code || []).includes('pump')).slice(0, 4).map(a => plSym(a.s));
  const LESSONS = ['Even good setups lose about 55–60% of the time. You make money because a win (2–3R) is bigger than a loss (1R). Keep every loss small and the same size.',
    'The stop-loss is decided before you buy, never after. Moving it lower to avoid a loss turns a small loss into a big one.',
    'Cash is a position. On days with no clean setup, the best trade is no trade.',
    'Size comes from the stop, not from how sure you feel: quantity = risk ÷ (entry − stop).',
    'Buy strength that is resting (a pullback or a tight base), not strength that is sprinting (a stock already up 20% this month).',
    'Write down why you entered. When the reason is gone (the invalidation level breaks), the trade is over.',
    'Three stocks from one sector are one big trade. Spread risk across sectors.'];
  const S8 = `<div class="card"><h2>8 · Trading coach notes</h2><ol style="padding-left:18px">
    <li><b>Why these trades:</b> ${B.picks.length ? `${B.picks.map(b => `${esc(plSym(b.s))} (${esc(PL_SET[b.setup].replace(/^\S+ /, ''))}, trend ${b.grade})`).join(', ')} — clean uptrends with a clear line where the trade is wrong; you only buy if the market proves the move by trading above the trigger.` : 'none qualified — the rules protect you from forcing trades.'}</li>
    <li><b>Biggest risks:</b> ${minus.length ? esc(minus.slice(0, 3).join('; ')) + '.' : 'nothing unusual in the market today.'}${B.picks.some(b => b.plan.Rpct > 6) ? ' Some stops are wide (over 6%) — the quantity is smaller to keep the rupee risk the same.' : ''}</li>
    <li><b>Common beginner mistakes:</b> buying stocks that already shot up, moving the stop lower, putting too much in one "sure" trade, and buying several stocks from the same sector.</li>
    <li><b>What not to do tomorrow:</b> don't buy at the open just because the market is green; don't risk more than ${inr(B.riskAmt)} on any trade${para.length ? `; don't chase ${para.map(esc).join(', ')}` : ''}; don't add watchlist stocks before their condition is met.</li>
    <li><b>Today's lesson:</b> ${esc(LESSONS[Math.floor(Date.parse(P.asOf) / 864e5) % LESSONS.length])}</li></ol></div>`;

  const stT = ST ? `<div class="tw"><table class="pt"><tr><th style="text-align:left">Setup</th><th>Trades</th><th>+2R first</th><th>+3R</th><th>+4R</th><th>+6R</th><th>−1R first</th><th>Avg result*</th><th>Won</th></tr>${['breakout', 'pullback', 'continuation', 'all'].filter(k => ST[k]).map(k => { const s = ST[k]; return `<tr><td style="text-align:left">${k === 'all' ? '<b>All</b>' : PL_SET[k]}</td><td>${s.n.toLocaleString('en-IN')}</td><td>${pctS(s.p2)}</td><td>${pctS(s.p3)}</td><td>${pctS(s.p4)}</td><td>${pctS(s.p6)}</td><td>${pctS(s.lose)}</td><td>${sgn(s.avgR, 2)}R</td><td>${pctS(s.win)}</td></tr>`; }).join('')}</table></div>
    <p class="mut" style="font-size:12.5px">*History check${swq('winrate')}: ${P.stats.from} to ${P.stats.to}, ${P.stats.stocks} of today's liquid NSE stocks, daily closes only, no costs. "Avg result" follows the management plan above (breakeven at +1R, half at +2R, trail on the 20 EMA, 15-session time stop). Stocks delisted since then are missing, so real odds are a little worse. Refreshed weekly.</p>` : '<p class="mut">History check not run yet.</p>';
  const S9 = `<details class="how"><summary>How the plan is built</summary><div class="mut"><ul style="margin:4px 0;padding-left:18px">
    <li><b>Market:</b> Nifty's position vs its 20 / 50 / 200 EMA and their direction, breadth (share of liquid stocks above the 50 EMA), India VIX, how stretched Nifty is, distance from its high → A Strong Bull (100% exposure), B Bull (75%), C Neutral (50%), D Weak (25%), E Bear (0–10%).</li>
    <li><b>Rejected</b> if: 20 EMA below 50 EMA · price below the 50 or 200 EMA · relative strength under ${P.rules.minRs} or weaker than Nifty over 3 months · turnover under ₹${P.rules.minTurnover / 1e7} Cr a day · average daily move over ${P.rules.maxAtrPct}% · up over ${P.rules.maxRun20}% in 20 sessions, over ${P.rules.maxExt20}% above the 20 EMA or RSI over ${P.rules.maxRsi} · price under ₹${P.rules.minPrice} or market cap under ₹${P.rules.minMcap / 1e7} Cr · volume over ${P.rules.pumpVr}× with +${P.rules.pumpR5}% in 5 days · exchange surveillance · promoter pledge over 50% · reward to the 52-week high under ${P.rules.minRR}R.</li>
    <li><b>Trend grade</b> (A+ ≥ 85, A ≥ 75, B ≥ 60, C ≥ 45, D): EMA stack, rising 200 / 50 EMA, higher highs and lows, relative strength, nearness to the 52-week high, RSI, industry strength.</li>
    <li><b>Setups:</b> 🚀 breakout (close above the 20-session high after a base of ≤ 14%, volume ≥ 1.3×) · ↩️ pullback (back at the 20 EMA, RSI 40–60) · 📈 trend continuation (higher highs and lows, 0–8% above the 20 EMA, RSI 55–70) · 🌱 early-stage trend (20 EMA just crossed the 50 EMA). Only A+ / A with a setup score above ${P.rules.minSetupScore} can be bought${P.rules.minCloseLoc != null ? `, and only when the signal day closed in the top quarter of its range (≥ ${P.rules.minCloseLoc}%)${swq('clv')} — in the history test that turned a losing ₹1 lakh plan into a winning one` : ''}.</li>
    <li><b>Entry</b> = a buy-stop just above today's high (above the 52-week high if that is within 2%). <b>Stop</b> = below the swing low (5 sessions; 10 for pullbacks), kept between 1 and 2.5 average daily ranges and at most 8%. <b>Targets</b> = 2R, 3R, 4R, 6R.</li>
    <li><b>Portfolio:</b> best confidence first, one stock per sector, within your position, per-stock, exposure and total-risk limits.</li></ul>${stT}</div></details>`;

  box.innerHTML = `${swMode()}<div class="nogq"><style>.swbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}.swbar input{padding:7px;border:1px solid var(--line);border-radius:8px;font-size:14px;background:#fff;width:110px}#plix td,#plix th,#plsz td,#plsz th,#plbuy td,#plbuy th,.plk td,.plk th{text-align:right}#plmg td{text-align:right}</style>
    <p style="margin:0 0 6px">Your daily plan${swq('regime')} from the close of <b>${swDate(P.asOf)}</b> — for <b>${swDate(P.next)}</b>. <span class="mut">Rebuilt every evening after the official closing prices.</span>${stale ? ' <span class="doubt" style="text-decoration:none">⚠ more than 4 days old</span>' : ''}</p>
    ${plBar()}${plEvidence()}${S1}${S2}${S3}${S4}${S5}${S6}${S7}${S8}${S9}${SW_DISC}</div>`;
  swModeWire(box);
  const re = () => { swSave(); const y = window.scrollY; renderPlan(box).then(() => window.scrollTo(0, y)); };
  plBarWire(box, re);
  box.querySelectorAll('[data-plcopy]').forEach(b => b.onclick = e => { e.preventDefault(); e.stopPropagation(); const p = B.picks.find(x => x.s === b.dataset.plcopy); if (p) plCopy(plTicket(p), b); });
  const ca = box.querySelector('#plcopyall'); if (ca) ca.onclick = () => plCopy(`GTT orders for ${swDate(P.next)} — capital ${inr(B.cap)}, risk ${inr(B.riskAmt)} a trade, ${plCosts().label} charges (plan from the close of ${swDate(P.asOf)})\n\n` + B.picks.map((b, i) => `#${i + 1} ` + plTicket(b)).join('\n\n'), ca);
  box.querySelectorAll('[data-pllog]').forEach(b => b.onclick = e => { e.preventDefault(); e.stopPropagation(); const p = B.picks.find(x => x.s === b.dataset.pllog); if (p) tradeDialog(null, p, () => { SWF.mode = 'trades'; swSave(); renderSwing(box); }); });
}

// ---------- 📒 My trades ----------
function trDlg() { let d = document.getElementById('trDlg'); if (!d) { d = document.createElement('dialog'); d.id = 'trDlg'; d.style.cssText = 'max-width:480px;width:94vw;border:1px solid var(--line);border-radius:12px;padding:16px'; document.body.appendChild(d); } return d; }
const trIn = (id, label, val, extra = '') => `<label class="mut" style="display:block;margin-top:6px;font-size:13px">${label}<input id="${id}" value="${esc(val ?? '')}" ${extra} style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;font-size:15px;box-sizing:border-box"></label>`;
// new trade (from a plan pick or by hand) or edit an existing one
function tradeDialog(id, pick, done) {
  const A = TR(), t = id ? A.trades.find(x => x.id === id) : null, d = trDlg();
  const today = new Date(Date.now() + 19800e3).toISOString().slice(0, 10);
  const v = t || (pick ? { s: pick.s, n: pick.n, setup: pick.setup, date: PLAN && PLAN.next && PLAN.next <= today ? PLAN.next : today, entry: pick.plan.E, qty: pick.q, sl: pick.plan.SL, t1: pick.plan.T1, t2: pick.plan.T2, alerts: true, note: '' } : { s: '', date: today, alerts: true });
  d.innerHTML = `<h2 style="margin-top:0">📒 ${t ? 'Edit trade' : 'Log a trade'}</h2>
    ${trIn('trS', 'Stock symbol (NSE)', plSym(v.s), t ? 'disabled' : 'placeholder="e.g. JSWSTEEL" autocapitalize="characters"')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 8px">${trIn('trD', 'Buy date', v.date, 'type="date"')}${trIn('trE', 'Buy price ₹', v.entry, 'inputmode="decimal"')}
    ${trIn('trQ', 'Quantity', v.qty, 'inputmode="numeric"')}${trIn('trSL', 'Stop-loss ₹', v.sl, 'inputmode="decimal"')}
    ${trIn('trT1', 'Target 1 ₹ (blank = 2R)', v.t1, 'inputmode="decimal"')}${trIn('trT2', 'Target 2 ₹ (blank = 3R)', v.t2, 'inputmode="decimal"')}</div>
    ${trIn('trN', 'Note (why you bought)', v.note, 'maxlength="120"')}
    <label class="mut" style="display:flex;gap:6px;align-items:center;margin-top:8px;font-size:13.5px"><input type="checkbox" id="trA" ${v.alerts ? 'checked' : ''}> Phone alerts: stop hit, move stop to breakeven, T1 reached${typeof AK_ON === 'function' && !AK_ON() ? ' <span class="dn">(set up the private alerts key on 🔔 Alerts first)</span>' : ''}</label>
    <p class="mut" id="trMsg" style="min-height:1.2em"></p><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn sec" id="trX">Cancel</button><button class="btn" id="trOk">Save</button></div>`;
  d.showModal(); d.querySelector('#trX').onclick = () => d.close();
  d.querySelector('#trOk').onclick = async () => {
    const g = k => d.querySelector(k).value.trim(), nm = k => typeof parseAmount === 'function' ? parseAmount(g(k)) : +g(k).replace(/,/g, '');
    let s = (t ? t.s : g('#trS').toUpperCase().replace(/\s+/g, '')); if (s && !/\.(NS|BO)$/.test(s)) s += '.NS';
    const e = nm('#trE'), q = Math.floor(nm('#trQ')), sl = nm('#trSL'), msg = d.querySelector('#trMsg');
    if (!s || !(e > 0) || !(q > 0) || !(sl > 0) || !(sl < e)) { msg.textContent = 'Fill in the stock, a buy price, a quantity and a stop-loss below the buy price.'; return; }
    const R = e - sl, t1 = nm('#trT1') > e ? nm('#trT1') : Math.round((e + 2 * R) / 0.05) * 0.05, t2 = nm('#trT2') > e ? nm('#trT2') : Math.round((e + 3 * R) / 0.05) * 0.05;
    const row = SUMMARY && SUMMARY.rows ? SUMMARY.rows.find(r => r.s === s) : null;
    const A2 = TR(), base = t ? A2.trades.find(x => x.id === t.id) : { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), s, n: (pick && pick.n) || (row && row.n) || plSym(s), setup: (pick && pick.setup) || 'manual', sold: [], exit: null, sl0: sl, log: [] };
    Object.assign(base, { date: g('#trD'), entry: e, qty: q, sl, t1: Math.round(t1 * 100) / 100, t2: Math.round(t2 * 100) / 100, note: g('#trN'), alerts: d.querySelector('#trA').checked });
    if (!t) { base.R0 = R; base.sl0 = sl; A2.trades.unshift(base); } else base.log.push([new Date().toISOString().slice(0, 10), 'edited']);
    trSave(A2); msg.textContent = 'Saved on this device.'; const m = await tradeAlertsSync(); if (m) msg.textContent += ' ' + m;
    setTimeout(() => { d.close(); done && done(); }, m ? 1800 : 500);
  };
}
// alerts for open trades: id 'tr-<trade>-<kind>' so they can be replaced; uses the 🔔 Alerts list and its sync
async function tradeAlertsSync() {
  if (typeof AL !== 'function' || typeof alertsPush !== 'function') return '';
  const A = AL(), before = JSON.stringify(A.alerts.filter(a => String(a.id).startsWith('tr-')).map(a => [a.id, a.v, a.type]));
  const keep = A.alerts.filter(a => !String(a.id).startsWith('tr-')), add = [], ver = Math.floor(Date.now() / 1000);
  for (const t of trOpen()) {
    if (!t.alerts) continue; const nm = plSym(t.s), R0 = t.R0 || (t.entry - t.sl0), mk = (k, type, v, note) => add.push({ id: `tr-${t.id}-${k}`, s: t.s, type, v: Math.round(v * 100) / 100, note: '📒 ' + note, ver, trig: null, trigP: null });
    mk('sl', 'below', t.sl, `${nm}: stop-loss hit — sell / record the exit`);
    if (t.sl < t.entry) mk('be', 'above', t.entry + R0, `${nm}: +1R — move the stop to breakeven ₹${r2s(t.entry)}`);
    if (!(t.sold || []).length) mk('t1', 'above', t.t1, `${nm}: Target 1 — sell half, trail the rest`);
  }
  const old = Object.fromEntries(A.alerts.map(a => [a.id, a]));
  for (const a of add) { const o = old[a.id]; if (o && o.v === a.v && o.type === a.type) { a.ver = o.ver; a.trig = o.trig; a.trigP = o.trigP; } }
  A.alerts = keep.concat(add); LS.set('alerts', A);
  if (JSON.stringify(add.map(a => [a.id, a.v, a.type])) === before) return '';
  return await alertsPush();
}
// latest close, 20 EMA, 5-day low and sessions held for a trade (from the stock's data file)
const TRD = {};
async function trData(s) {
  if (TRD[s] && Date.now() - TRD[s].t < 10 * 60e3) return TRD[s].v;
  let v = null; try { const d = await getJSON(DATA + 's/' + encodeURIComponent(s) + '.json'); const c = d.hist.map(h => h[1]); let e = c.slice(0, 20).reduce((a, x) => a + x, 0) / 20; for (let i = 20; i < c.length; i++) e = c[i] * 2 / 21 + e * 19 / 21;
    v = { close: c[c.length - 1], e20: e, lo5: Math.min(...(d.ohlc || []).slice(-5).map(x => x[3])), hist: d.hist.slice(-80) }; } catch { }
  TRD[s] = { t: Date.now(), v }; return v;
}
function trAdvice(t, x, price) {
  const R0 = t.R0 || (t.entry - t.sl0), rem = trRem(t), sold = (t.sold || []).length > 0;
  const since = x ? x.hist.filter(h => new Date((h[0] + 19800) * 1000).toISOString().slice(0, 10) > t.date) : [];
  const best = Math.max(price, ...since.map(h => h[1])), bestR = (best - t.entry) / R0, nS = since.length, cl = x ? x.close : price;
  const trail = x ? Math.round(Math.max(x.e20, x.lo5) / 0.05) * 0.05 : null;
  if (price <= t.sl) return ['dn', `🔴 At or below the stop ${inr2(t.sl)} — sell and record the exit`];
  if (sold && x && cl < x.e20) return ['dn', `🔴 Closed below the 20 EMA ${inr2(x.e20)} — exit the remaining ${rem}`];
  if (!sold && price >= t.t1) return ['up', `🟢 Target 1 reached — sell about half (${Math.floor(rem / 2) || rem}) and trail the rest`];
  if (t.sl < t.entry && bestR >= 1) return ['up', `🟡 Up 1R — move the stop to breakeven ${inr2(t.entry)}`];
  if (sold && trail && trail > t.sl && trail < price) return ['up', `🟡 Trail: raise the stop to ${inr2(trail)} (20 EMA / 5-day low)`];
  if (nS >= 15 && bestR < 1) return ['dn', `🟠 Time stop: ${nS} sessions without +1R — exit or tighten`];
  return ['mut', `✔ Hold — stop ${inr2(t.sl)}${nS ? ` · ${nS} session${nS === 1 ? '' : 's'} held` : ''}`];
}
function sellDialog(id, full, done) {
  const A = TR(), t = A.trades.find(x => x.id === id); if (!t) return; const d = trDlg(), rem = trRem(t), [p] = typeof curPrice === 'function' ? curPrice(t.s) : [];
  const today = new Date(Date.now() + 19800e3).toISOString().slice(0, 10);
  d.innerHTML = `<h2 style="margin-top:0">${full ? '✅ Close trade' : '➗ Sell part'} — ${esc(plSym(t.s))}</h2><p class="mut">${rem} share${rem === 1 ? '' : 's'} open, bought at ${inr2(t.entry)}</p>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 8px">${trIn('slD', 'Date', today, 'type="date"')}${trIn('slQ', 'Quantity', full ? rem : Math.floor(rem / 2) || rem, `inputmode="numeric" ${full ? 'disabled' : ''}`)}${trIn('slP', 'Price ₹', isNum(p) ? r2s(p).replace(/,/g, '') : '', 'inputmode="decimal"')}</div>
    <p class="mut" id="slMsg"></p><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn sec" id="slX">Cancel</button><button class="btn" id="slOk">Save</button></div>`;
  d.showModal(); d.querySelector('#slX').onclick = () => d.close();
  d.querySelector('#slOk').onclick = async () => {
    const q = full ? rem : Math.floor(+d.querySelector('#slQ').value), pr = typeof parseAmount === 'function' ? parseAmount(d.querySelector('#slP').value) : +d.querySelector('#slP').value, dt = d.querySelector('#slD').value;
    if (!(q >= 1 && q <= rem) || !(pr > 0)) { d.querySelector('#slMsg').textContent = `Enter a quantity from 1 to ${rem} and the price you sold at.`; return; }
    const A2 = TR(), t2 = A2.trades.find(x => x.id === id); t2.sold = (t2.sold || []).concat({ d: dt, q, p: pr });
    if (trRem(t2) <= 0) t2.exit = { d: dt }; else if (t2.sl < t2.entry) { /* keep the stop; the advice will suggest breakeven / trail */ }
    trSave(A2); const m = await tradeAlertsSync(); d.querySelector('#slMsg').textContent = 'Saved.' + (m ? ' ' + m : ''); setTimeout(() => { d.close(); done && done(); }, m ? 1500 : 400);
  };
}
function stopDialog(id, sug, done) {
  const A = TR(), t = A.trades.find(x => x.id === id); if (!t) return; const d = trDlg();
  d.innerHTML = `<h2 style="margin-top:0">🛡 Update stop — ${esc(plSym(t.s))}</h2><p class="mut">Now ${inr2(t.sl)} · bought ${inr2(t.entry)}. Only ever move a stop up.</p>${trIn('stV', 'New stop ₹', sug || t.sl, 'inputmode="decimal"')}
    <p class="mut" id="stMsg"></p><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn sec" id="stX">Cancel</button><button class="btn" id="stOk">Save</button></div>`;
  d.showModal(); d.querySelector('#stX').onclick = () => d.close();
  d.querySelector('#stOk').onclick = async () => {
    const v = typeof parseAmount === 'function' ? parseAmount(d.querySelector('#stV').value) : +d.querySelector('#stV').value;
    if (!(v > 0)) { d.querySelector('#stMsg').textContent = 'Enter a price.'; return; }
    if (v < t.sl && !confirm2(d)) return;
    const A2 = TR(), t2 = A2.trades.find(x => x.id === id); (t2.log = t2.log || []).push([new Date().toISOString().slice(0, 10), `stop ${t2.sl} → ${v}`]); t2.sl = v; trSave(A2);
    const m = await tradeAlertsSync(); d.querySelector('#stMsg').textContent = 'Saved.' + (m ? ' ' + m : ''); setTimeout(() => { d.close(); done && done(); }, m ? 1500 : 400);
  };
}
// lowering a stop: ask once (inline, no browser dialog)
function confirm2(d) { const m = d.querySelector('#stMsg'); if (m.dataset.ok) return true; m.dataset.ok = '1'; m.innerHTML = '<span class="dn">That is <b>lower</b> than the current stop — it adds risk. Press Save again if you really mean it.</span>'; return false; }

async function renderTrades(box) {
  plDef();
  box.innerHTML = `${swMode()}<p class="mut">Loading your trades…</p>`; swModeWire(box);
  if (typeof ensureSummary === 'function') await ensureSummary(); if (typeof loadQuotes === 'function' && typeof QUOTES !== 'undefined' && !QUOTES) { try { await loadQuotes(false); } catch { } }
  const A = TR(), open = A.trades.filter(t => !t.exit && trRem(t) > 0), closed = A.trades.filter(t => t.exit || trRem(t) <= 0);
  const px = t => { const q = typeof curPrice === 'function' ? curPrice(t.s) : []; if (isNum(q[0])) return q[0]; const r = SUMMARY && SUMMARY.rows ? SUMMARY.rows.find(x => x.s === t.s) : null; return r ? r.p : null; };
  const X = {}; await Promise.all(open.map(async t => { X[t.s] = await trData(t.s); }));
  const realised = t => (t.sold || []).reduce((s, x) => s + x.q * (x.p - t.entry), 0);
  let inv = 0, risk = 0, unr = 0;
  const rowO = t => { const p = px(t), rem = trRem(t), R0 = t.R0 || (t.entry - t.sl0), x = X[t.s], [cls, adv] = trAdvice(t, x, isNum(p) ? p : t.entry);
    inv += rem * t.entry; risk += Math.max(0, t.entry - t.sl) * rem; const u = isNum(p) ? rem * (p - t.entry) : 0; unr += u;
    const sug = /raise the stop to ₹([\d,.]+)/.exec(adv) || /breakeven ₹([\d,.]+)/.exec(adv);
    return `<tr><td style="text-align:left;white-space:normal"><a href="#" data-s="${esc(t.s)}"><b>${esc(plSym(t.s))}</b></a><br><small class="mut">${esc(PL_SET[t.setup] || t.setup || '')}${t.note ? ' · ' + esc(t.note) : ''}</small></td>
      <td>${swDate(t.date)}<br><small>${rem}${rem !== t.qty ? '/' + t.qty : ''} @ ${inr2(t.entry)}</small></td><td>${inr2(p)}<br><small class="${u >= 0 ? 'up' : 'dn'}">${sgn(u, 0)} ₹ · ${isNum(p) ? sgn((p - t.entry) / R0, 1) + 'R' : ''}</small></td>
      <td>${inr2(t.sl)}<br><small class="mut">T1 ${inr2(t.t1)}</small></td><td style="white-space:normal;text-align:left"><span class="${cls}">${esc(adv)}</span>${t.alerts ? ' <small title="phone alerts on">🔔</small>' : ''}</td>
      <td style="white-space:nowrap"><button class="btn sec" data-trstop="${t.id}" data-sug="${sug ? sug[1].replace(/,/g, '') : ''}" title="Update stop">🛡</button> <button class="btn sec" data-trpart="${t.id}" title="Sell part">➗</button> <button class="btn sec" data-trclose="${t.id}" title="Close trade">✅</button> <button class="btn sec" data-tredit="${t.id}" title="Edit">✎</button></td></tr>`; };
  const openHTML = open.length ? `<div class="tw"><table class="pt" id="trt"><tr><th style="text-align:left">Stock</th><th>Bought</th><th>Now · P&amp;L</th><th>Stop · T1</th><th style="text-align:left">What to do</th><th></th></tr>${open.map(rowO).join('')}</table></div>` : '<p class="mut">No open trades. Log one from 🧭 Daily plan ("📒 Log as my trade") or add it here.</p>';
  // journal
  const J = closed.map(t => { const R0 = t.R0 || (t.entry - t.sl0), q = (t.sold || []).reduce((s, x) => s + x.q, 0), pl = realised(t), avgX = q ? (t.sold || []).reduce((s, x) => s + x.q * x.p, 0) / q : null;
    return { t, pl, R: q ? pl / (R0 * t.qty) : 0, avgX, end: (t.exit && t.exit.d) || ((t.sold || []).slice(-1)[0] || {}).d }; });
  const wins = J.filter(j => j.pl > 0), tot = J.reduce((s, j) => s + j.pl, 0), avgR = J.length ? J.reduce((s, j) => s + j.R, 0) / J.length : null;
  const bySet = {}; for (const j of J) { const k = j.t.setup || 'manual'; (bySet[k] = bySet[k] || []).push(j); }
  const jHTML = J.length ? `<div class="kv"><div><span>Closed trades</span><b>${J.length}</b></div><div><span>Win rate${swq('winrate')}</span><b>${Math.round(wins.length / J.length * 100)}%</b></div><div><span>Average result</span><b class="${avgR >= 0 ? 'up' : 'dn'}">${sgn(avgR, 2)}R</b></div><div><span>Total P&amp;L</span><b class="${tot >= 0 ? 'up' : 'dn'}">${sgn(tot, 0)} ₹</b></div></div>
    <p class="mut" style="font-size:13px">By setup: ${Object.entries(bySet).map(([k, a]) => `${esc(PL_SET[k] || k)} ${a.length} trade${a.length === 1 ? '' : 's'}, ${Math.round(a.filter(j => j.pl > 0).length / a.length * 100)}% won, ${sgn(a.reduce((s, j) => s + j.R, 0) / a.length, 2)}R`).join(' · ')}${J.length < 20 ? ' — under 20 trades says little; keep logging.' : ''}</p>
    <div class="tw"><table class="pt" id="trj"><tr><th style="text-align:left">Stock</th><th>Bought</th><th>Sold (avg)</th><th>P&amp;L</th><th>R</th><th></th></tr>${J.map(j => `<tr><td style="text-align:left"><a href="#" data-s="${esc(j.t.s)}">${esc(plSym(j.t.s))}</a><br><small class="mut">${esc(PL_SET[j.t.setup] || j.t.setup || '')}</small></td><td>${swDate(j.t.date)}<br><small>${j.t.qty} @ ${inr2(j.t.entry)}</small></td><td>${swDate(j.end)}<br><small>${inr2(j.avgX)}</small></td><td class="${j.pl >= 0 ? 'up' : 'dn'}">${sgn(j.pl, 0)} ₹</td><td>${sgn(j.R, 2)}</td><td><button class="btn sec" data-trdel="${j.t.id}" title="Delete">🗑</button></td></tr>`).join('')}</table></div>` : '<p class="mut">No closed trades yet. Your win rate and average R by setup appear here.</p>';
  const cap = +SWF.cash || 0;
  box.innerHTML = `${swMode()}<div class="nogq"><style>.swbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}.swbar input{padding:7px;border:1px solid var(--line);border-radius:8px;font-size:14px;background:#fff;width:110px}#trt td,#trt th,#trj td,#trj th{text-align:right}#trt .btn,#trj .btn{padding:4px 7px;font-size:13px}</style>
    ${plBar()}<div class="card"><h2>📒 My trades <span class="mut">(open)</span></h2>
     <div class="kv"><div><span>Capital</span><b>${inr(cap)}</b></div><div><span>Invested</span><b>${inr(inv)}</b> <small class="mut">${cap ? (inv / cap * 100).toFixed(1) + '%' : ''}</small></div><div><span>Cash</span><b>${inr(cap - inv)}</b></div><div><span>Open risk</span><b class="dn">${inr(risk)}</b> <small class="mut">${cap ? (risk / cap * 100).toFixed(2) + '%' : ''}</small></div><div><span>Unrealised P&amp;L</span><b class="${unr >= 0 ? 'up' : 'dn'}">${sgn(unr, 0)} ₹</b></div></div>
     ${openHTML}<p style="margin:8px 0 0"><button class="btn" id="trAdd">➕ Add a trade</button></p>
     <p class="mut" style="font-size:12.5px">"What to do" checks each trade against the management plan: stop hit → exit · up 1R → stop to breakeven · T1 → sell half · after that, trail under the 20 EMA / 5-day low · 15 sessions without +1R → time stop. Prices: latest quote; 20 EMA and 5-day low: last close.</p></div>
    <div class="card"><h2>📊 Trade journal</h2>${jHTML}</div>
    <div class="card"><h2>💾 Backup</h2><p class="mut" style="font-size:13px">Your trades are stored only on this device (not on GitHub, not in the public app). Download a backup now and then, and use it to move them to another phone or PC.</p>
     <p><button class="btn sec" id="trExp">⬇ Download backup</button> <label class="btn sec" style="cursor:pointer">⬆ Restore from file<input type="file" id="trImp" accept=".json,application/json" hidden></label> <span class="mut" id="trBk"></span></p></div>${SW_DISC}</div>`;
  swModeWire(box);
  const re = () => { const y = window.scrollY; renderTrades(box).then(() => window.scrollTo(0, y)); };
  plBarWire(box, re);
  box.querySelector('#trAdd').onclick = () => tradeDialog(null, null, re);
  box.querySelectorAll('[data-tredit]').forEach(b => b.onclick = () => tradeDialog(b.dataset.tredit, null, re));
  box.querySelectorAll('[data-trpart]').forEach(b => b.onclick = () => sellDialog(b.dataset.trpart, false, re));
  box.querySelectorAll('[data-trclose]').forEach(b => b.onclick = () => sellDialog(b.dataset.trclose, true, re));
  box.querySelectorAll('[data-trstop]').forEach(b => b.onclick = () => stopDialog(b.dataset.trstop, b.dataset.sug, re));
  box.querySelectorAll('[data-trdel]').forEach(b => b.onclick = () => { if (b.dataset.sure) { const A2 = TR(); A2.trades = A2.trades.filter(t => t.id !== b.dataset.trdel); trSave(A2); re(); } else { b.dataset.sure = 1; b.textContent = 'Delete?'; } });
  box.querySelector('#trExp').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(TR(), null, 1)], { type: 'application/json' })); a.download = 'my-trades-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  box.querySelector('#trImp').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const j = JSON.parse(await f.text()); if (!j || !Array.isArray(j.trades)) throw new Error('not a trades backup');
    const A2 = TR(), ids = new Set(A2.trades.map(t => t.id)); let n = 0; for (const t of j.trades) if (t && t.id && t.s && !ids.has(t.id)) { A2.trades.push(t); n++; } trSave(A2); box.querySelector('#trBk').textContent = `Restored ${n} trade${n === 1 ? '' : 's'}.`; await tradeAlertsSync(); setTimeout(re, 900); }
    catch (x) { box.querySelector('#trBk').textContent = '⚠ ' + x.message; } };
}

// ---------- stock page: plan card (filled after plan.json loads) ----------
function planCardPh(d) {
  if (!d || d.etf || !/\.NS$/.test(d.symbol || '')) return '';
  setTimeout(() => planCardFill(d), 0);
  return `<div class="card nogq" id="plancard"><h2>🧭 Daily plan${swq('regime')}</h2><p class="mut">Loading…</p></div>`;
}
async function planCardFill(d) {
  const P = await planLoad(), el = document.getElementById('plancard'); if (!el || typeof CUR !== 'undefined' && CUR && CUR !== d) return;
  if (!P || P.err || !P.g) { el.innerHTML = `<h2>🧭 Daily plan</h2><p class="mut">The daily plan isn't available yet.</p>`; return; }
  const s = d.symbol, g = P.g[s], full = P.buy.find(x => x.s === s) || P.watch.find(x => x.s === s), av = P.avoid.find(x => x.s === s), held = trOpen().find(t => t.s === s);
  const head = `<h2>🧭 Daily plan${swq('regime')} <span class="mut">(close of ${swDate(P.asOf)})</span></h2>`;
  let h;
  if (!g) h = `<p class="mut">Not checked — the plan only looks at NSE stocks with at least 260 sessions of history and ₹1 Cr a day of trading.</p>`;
  else if (g[0] === '-') { const codes = (g[6] || '').split(',').filter(Boolean); h = `<p><b>🔴 Rejected</b> by the plan's rules:</p><ul>${(av ? av.why : codes.map(c => PL_REJ[c] || c)).map(w => `<li>${esc(w)}</li>`).join('')}</ul>`; }
  else if (full) { const b = full, pl = b.plan;
    h = `<p style="margin:0 0 6px">${b.buy ? '<b class="up">🟢 On the buy list</b>' : '<b>🟡 Watchlist</b>'} · trend ${plGrade(b.grade)}${swq('tgrade')} <small class="mut">${b.ts}/100</small> · ${PL_SET[b.setup]}${b.ss ? ` <small class="mut">score ${b.ss}</small>` : ''} · confidence ${b.conf}/100</p>
      <p style="font-size:14px;margin:0 0 4px">${esc(b.tn.join('; '))}.</p>${b.buy ? '' : `<p style="font-size:14px;margin:0 0 4px"><b>Next:</b> ${esc(b.wait)}.</p>`}
      ${pl && b.buy ? `<div class="kv"><div><span>Buy above</span><b>${inr2(pl.E)}</b></div><div><span>Stop</span><b class="dn">${inr2(pl.SL)} <small>(−${pl.Rpct}%)</small></b></div><div><span>T1 / T2</span><b class="up">${inr2(pl.T1)} / ${inr2(pl.T2)}</b></div><div><span>Wrong if</span><b style="font-size:13px;font-weight:500">${esc(pl.inval)}</b></div></div>` : ''}
      ${b.cdl !== undefined ? `<p style="font-size:14px;margin:4px 0"><b>Last candle${swq('clv')}:</b> ${plCdlTxt(b.cdl)}.</p>` : ''}
      ${b.warn.length ? `<p class="dn" style="font-size:13px">⚠ ${b.warn.map(esc).join(' · ')}</p>` : ''}
      ${(b.tags || []).length ? `<p class="mut" style="font-size:13px;margin:4px 0 0">Also picked by the app's other scans: ${esc(b.tags.join(', '))} — details in the cards below.</p>` : ''}`; }
  else h = `<p>Passed the reject rules · trend ${plGrade(g[0])} <small class="mut">${g[5]}/100</small> · ${PL_SET[g[1]] || ''} — not strong enough for the watchlist.</p>`;
  el.innerHTML = head + h + (held ? `<p style="margin:6px 0 0">📒 You hold ${trRem(held)} @ ${inr2(held.entry)}, stop ${inr2(held.sl)} — see My trades in the Swing tab.</p>` : '') + `<p class="src">Market: ${plBadge(P.market.regime.cls)} ${esc(P.market.regime.label)}, max exposure ${P.market.regime.exposure}%. Full plan: 🧭 Daily plan in the Swing tab. Educational, not a recommendation.</p>`;
}

// ---------- stock page: earnings-momentum card (the scan that used to be its own Swing view) ----------
function momCardPh(d) {
  if (!d || d.etf || !/\.NS$/.test(d.symbol || '')) return '';
  setTimeout(() => momCardFill(d), 0);
  return `<div class="card nogq" id="momcard"><h2>🚀 Earnings momentum${swq('momscan')}</h2><p class="mut">Loading…</p></div>`;
}
async function momCardFill(d) {
  let m = typeof MOM !== 'undefined' ? MOM : null;
  if (!m) { try { m = await getJSON(DATA + 'momentum.json'); if (typeof MOM !== 'undefined') MOM = m; } catch (e) { m = null; } }
  const el = document.getElementById('momcard'); if (!el || typeof CUR !== 'undefined' && CUR && CUR !== d) return;
  const head = `<h2>🚀 Earnings momentum${swq('momscan')}${m && m.asOf ? ` <span class="mut">(close of ${swDate(m.asOf)})</span>` : ''}</h2>`;
  if (!m || !m.list) { el.innerHTML = head + '<p class="mut">The earnings-momentum scan isn\'t available yet.</p>'; return; }
  const R = m.rules || {}, rules = `quarterly profit growth &gt; ${R.qg}% · 5-year profit growth &gt; ${R.g5}% a year · ROCE &gt; ${R.roce}% · price &gt; ${Math.round((R.hi || 0.85) * 100)}% of the 52-week high · average volume &gt; ${((R.vol || 5e5) / 1e5).toFixed(0)} lakh shares · no banks, finance or real estate`;
  const r = m.list.find(x => x.s === d.symbol), u = (m.unchecked || []).find(x => x.s === d.symbol);
  let h;
  if (r) { const q = r.e ? swQty(r.e, r.sl) : null, lab = (typeof MOT !== 'undefined' && MOT[r.t]) ? MOT[r.t] : [r.t, ''];
    h = `<p style="margin:0 0 6px"><b class="up">✔ Passes your earnings-momentum screen</b> · setup <b>${lab[0]}</b> <small class="mut">${esc(lab[1])}</small> · rank ${r.sc}/100</p>
      <div class="kv"><div><span>Quarterly profit growth</span><b>${moPct(r.qg)}</b></div><div><span>5-year profit growth</span><b>${moPct(r.g5)} a year</b></div><div><span>ROCE</span><b>${r.roce}%</b></div><div><span>From 52-week high</span><b>${r.offHi}%</b></div>
      ${r.e ? `<div><span>Entry trigger${swq('pivot')}</span><b>${inr2(r.e)}</b></div><div><span>Stop-loss</span><b class="dn">${inr2(r.sl)} <small>(−${r.rp}%)</small></b></div><div><span>Quantity${swq('possize')}</span><b>${q === null ? '–' : q.toLocaleString('en-IN')}</b> <small class="mut">(${inr(SWF.cash)}, ${SWF.riskPct}% risk)</small></div>` : ''}</div>
      ${r.trig ? `<p style="font-size:14px;margin:6px 0 2px"><b>Buy on:</b> ${esc(r.trig)}.</p>` : r.wait ? `<p style="font-size:14px;margin:6px 0 2px"><b>Wait:</b> ${esc(r.wait)}.</p>` : ''}
      <ul style="margin:4px 0">${(r.why || []).map(w => `<li>${esc(w)}</li>`).join('')}${(r.warn || []).map(w => `<li class="dn">⚠ ${esc(w)}</li>`).join('')}</ul>`; }
  else if (u) h = `<p><b>? Couldn't check</b> — ${esc(u.why)}. It passes the price, volume and ROCE tests (ROCE ${u.roce}%); check its profit history yourself.</p>`;
  else h = `<p><b>Not on the list</b> — it doesn't pass every test of the screen.</p>`;
  el.innerHTML = head + h + `<p class="src">Screen: ${rules}. Profits from the company's NSE results filings. Educational, not a recommendation.</p>`;
}

// ---------- glossary terms used here ----------
if (typeof GL !== 'undefined') Object.assign(GL, {
  regime: ['Market regime', 'A label for the state of the whole market — Strong Bull, Bull, Neutral, Weak or Bear — from where Nifty is versus its averages, how many stocks are rising, and how nervous traders are (India VIX). It decides how much of your money may be invested at all.', 'Nifty above a rising 200 EMA, 70% of stocks above their 50 EMA, VIX 13 → Strong Bull, up to 100% invested.', 'Good: trade more in Bull markets. Bad: buying a lot when the market is Weak or Bear — most stocks fall with it.'],
  expcap: ['Maximum exposure', 'The most of your capital that should be in stocks at once, set by the market regime: Strong Bull 100%, Bull 75%, Neutral 50%, Weak 25%, Bear 0–10%. The rest stays as cash.', '₹50,000 capital in a Neutral market → at most ₹25,000 in stocks.', 'Good: following it — cash protects you when the market turns. Bad: being fully invested in a weak market.'],
  tgrade: ['Trend grade', 'A school-style grade (A+, A, B, C, D) for how healthy a stock\'s uptrend is: averages stacked in order and rising, higher highs and lows, strength versus other stocks, closeness to its 52-week high, and a strong industry. Only A+ and A are bought.', 'Price > 20 > 50 > 200 EMA, all rising, RS 90, 2% from its high → A+.', 'Good: A+ / A. Bad: C / D — the trend is weak or broken; a "cheap" price there is often a trap.'],
  setupsc: ['Setup score', 'A 0–100 score for how clean the entry pattern is: for a breakout, how tight the base was, how strong the breakout day and its volume; for a pullback, how close to the 20 EMA, whether volume dried up and today\'s candle. Only setups above 75 are bought.', 'Tight 5% base, breakout on 2× volume, close near the high → score 85.', 'Good: above 75. Bad: below 60 — a messy pattern that fails more often.'],
  tconf: ['Confidence score', 'A rule-based 0–100 summary of a trade: trend grade, setup score, market regime and the historical hit rate of that setup, minus points for warnings (results due, pledge, wide stop). It ranks trades; it is not a probability.', 'A+ trend, setup 90, Neutral market, no warnings → about 70.', 'Higher is better, but even 80 can lose — the stop-loss is what protects you.'],
  contin: ['Trend continuation', 'A stock in a steady uptrend (higher highs and higher lows) that is resting a little above its 20 EMA. You buy when it moves above the latest high, betting the trend carries on.', 'Stock rising for 2 months, pauses 3 days just under its high, then breaks above it.', 'Good: calm, orderly trend, RSI 55–70. Bad: a stock far above its averages — that is extended, not continuing.'],
  earlystage: ['Early-stage trend', 'A stock whose 20 EMA has just crossed above its 50 EMA while above the 200 EMA — a trend may be starting. Too early to rate highly, so it goes on the watchlist.', '20 EMA crossed the 50 EMA three days ago after a long sideways phase.', 'Good: crossover with rising volume and strength. Bad: crossovers in a falling market often fail.'],
  invalid: ['Invalidation level', 'The price that proves the trade idea wrong. Decide it before buying; when it breaks, exit without arguing. Your stop-loss sits just beyond it.', 'Breakout above ₹500: wrong if it closes back below ₹490, inside the old range.', 'Good: a clear, chart-based level. Bad: "I\'ll sell if it falls a lot" — that is not a plan.'],
  breakeven: ['Breakeven stop', 'Moving the stop-loss up to your buy price once the trade is well in profit (here: after it closes 1R above the entry). From then on the trade can\'t lose money.', 'Bought ₹100, stop ₹95 (R = ₹5). Price closes at ₹105 → move the stop to ₹100.', 'Good: protects profits. Bad: doing it too early (after a ₹1 rise) — normal wiggles stop you out.'],
  partial: ['Partial profit', 'Selling part of a position (here half, at Target 1 = 2R) and keeping the rest for a bigger move. It locks in a gain and makes the rest easier to hold.', '20 shares bought ₹100, stop ₹95: sell 10 at ₹110 (2R), trail the other 10.', 'Good: steady results. Bad: selling everything at the first small profit — big winners pay for the losers.'],
  trail: ['Trailing stop', 'A stop-loss that you raise as the price rises, but never lower — here, below the 20 EMA or the last 5-day low, whichever is higher, checked once a day after the close.', 'Price ₹130, 20 EMA ₹121, 5-day low ₹124 → stop goes up to ₹124.', 'Good: lets winners run. Bad: a trail so tight that normal dips stop you out.'],
  timestop: ['Time stop', 'Exiting a trade that goes nowhere: if it hasn\'t reached +1R within about 15 sessions, the idea isn\'t working and the money is better used elsewhere.', 'Bought 3 weeks ago, still around the entry price → close it.', 'Good: frees money and attention. Bad: holding a dead trade for months "until it comes back".'],
  gtt: ['GTT order', 'Good-Till-Triggered: an order you place in your broker\'s app that waits (up to a year) until the price reaches the trigger, then sends a buy or sell order. Ideal when you check the market only once a day.', 'GTT buy: trigger ₹1,372.50, limit ₹1,379.50 — it buys only if the price trades above ₹1,372.50 and not above ₹1,379.50.', 'Good: no need to watch the screen. Bad: a gap above the limit means no fill (on purpose — don\'t chase); a stop-loss GTT with a limit can stay unsold if the price opens below that limit.'],
  oco: ['OCO (one-cancels-other)', 'Two linked GTT sell orders: a stop-loss below and a target above. When one fills, the other is cancelled automatically.', 'Stop ₹1,312 and target ₹1,493 for the same shares — whichever comes first.', 'Good: the exit plan runs on its own. Bad: forgetting to update it after moving the stop.'],
  expectancy: ['Expectancy', 'The average result per trade, in R (multiples of the amount you risk): win rate × average win − loss rate × average loss. Positive means the method makes money over many trades.', '40% wins of +2.5R and 60% losses of −1R → 0.4×2.5 − 0.6×1 = +0.4R per trade.', 'Good: clearly above 0. Bad: below 0 — no amount of discipline makes a losing method profitable.'],
  winrate: ['Win rate', 'The share of trades that make money. In trend trading it is usually only 35–50% — the method works because the average win is bigger than the average loss.', '10 trades: 4 winners → 40% win rate.', 'Good: judged together with the average win and loss. Bad: chasing a high win rate by taking tiny profits and big losses.'],
  fiioi: ['FII index-futures positions', 'NSE publishes every evening how many Nifty / Bank Nifty futures contracts foreign investors (FIIs) hold long (betting on a rise) and short (betting on a fall). The long share shows their positioning.', 'FIIs 31% long, 69% short → they are mostly positioned for a fall.', 'Rising long share with the market = rally backed by big money. A rally while FIIs stay short can reverse when they cover or add shorts.'],
  maxpos: ['Maximum positions', 'How many stocks to hold at once for your capital, so each position is big enough to matter but no single stock can hurt you badly: under ₹50k → 3, ₹50k–2L → 5, ₹2L–10L → 8, above → 10.', '₹50,000 → up to 5 positions of about ₹7,000–12,500.', 'Good: a few well-chosen trades. Bad: 15 tiny positions you can\'t follow.'],
  portrisk: ['Total (portfolio) risk', 'What you would lose if every open trade hit its stop at the same time. Kept at most 5% of capital, so even a bad week is survivable.', '5 trades each risking 1% → 5% total risk.', 'Good: 2–5%. Bad: above 10% — one market fall can wipe out months of gains.'],
  charges: ['Trading charges', 'What a delivery trade costs besides the share price: STT 0.1% on buying and on selling, stamp duty 0.015% on buying, small exchange and SEBI fees with GST, and a DP charge each day you sell a stock from your demat account (Groww ₹23.60, Zerodha ₹15.93), plus brokerage (Groww: 0.1% per order, at least ₹5 and at most ₹20; Zerodha: ₹0 for delivery).', 'Groww, buy and sell ₹10,000 of shares in one go: about ₹24 + ₹46 = ₹70. Sell in two halves on different days: one more DP charge and a second ₹5 minimum brokerage, about ₹100 in all.', 'They matter most for small positions: ₹100 on a trade risking ₹500 is 20% of the risk. The plan skips trades where charges eat more than 15% of the risk.'],
  clv: ['Close location (candle strength)', 'Where the day\'s closing price sits between the day\'s low and high: 100% = closed at the high, 0% = at the low. Body = the gap between open and close; upper wick = how far the price fell back from the day\'s high.', 'Low ₹100, high ₹110, open ₹102, close ₹108 → close location 80%, body 60%, upper wick 20%.', 'Good: a close in the top quarter (75%+) — buyers kept control to the end. The daily plan buys only these: in its history test (869 stocks, 2023–26, Groww charges) trades after a top-quarter close made money and the rest mostly did not. Warning: a long upper wick — sellers met the rise.'],
  breadth: ['Market breadth', 'How many stocks are taking part in a market move, for example the share of stocks above their 50-day average. An index can rise on a few big stocks while most stocks fall.', 'Nifty +12% in a month but only 54% of stocks above their 50 EMA → narrow rally.', 'Good: above 60–65% and rising. Bad: index up while breadth falls — the rally is thin.'],
});
