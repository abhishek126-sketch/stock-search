'use strict';
// ===== Score filter: screen every stock in the built-in list by rule-based scores (home tab "🎯 Score filter") =====
// Scores are computed in the browser from summary.json (one row per stock), using the same thresholds as the
// 25-point report wherever that data exists. Criteria that need full history (cash flow, dividends, inventory,
// R&D, margin stability) are not in the summary, so these "quick scores" can differ from the stock page's report.
const SCL = v => isNum(v) ? Math.max(0, Math.min(1, v)) : undefined;
const sLin = (v, bad, good) => isNum(v) ? SCL((v - bad) / (good - bad)) : undefined;
function sTable(C) {  // C: [weight, score 0..1 | undefined]; needs >= 40% of the weight to give a score (same rule as the report)
  const W = C.reduce((s, c) => s + c[0], 0), av = C.filter(c => isNum(c[1])), Wa = av.reduce((s, c) => s + c[0], 0);
  return Wa >= W * 0.4 ? av.reduce((s, c) => s + c[0] * c[1], 0) / Wa * 100 : undefined;
}
const SCORES = [
  ['ov', 'Overall', 'Weighted mix of the scores below: Quality 25 · Growth 20 · GARP 20 · Value 15 · CANSLIM 10 · Momentum 10 · Ownership 10 (needs at least half of that weight to have data).'],
  ['q', 'Quality', 'Buffett-style: ROE (8% → 18%), operating margin (8% → 20%), low debt (D/E 1.0 → 0.3), moat proxy (ROCE 10% → 25% or gross margin 20% → 45%; banks: ROE 10% → 17%); earnings quality: operating cash flow vs EBITDA over 3 years (40% → 70%), other income as a share of profit before tax (35% → 20% or less), operating margin vs last year (−2 → +2 pts).'],
  ['v', 'Value', 'Graham-style: adequate size, low debt (D/E 1.0 → 0.5), P/E (25 → 15), P/E × P/B (45 → 22.5), profit growth (0 → 3%/yr).'],
  ['g', 'Growth', 'Fisher-style: revenue CAGR (0 → 15%/yr), profit CAGR (0 → 15%/yr), profit growing faster than sales (−5 → +2 pts).'],
  ['l', 'GARP', 'Lynch-style: PEG = P/E ÷ profit growth % (2 → 1), growth in the 20–40% sweet spot, debt (D/E 1.0 → 0.35), P/E not stretched (40 → 20).'],
  ['c', 'CANSLIM', "Share of CANSLIM letters passed (stocks with at least 5 of 7 letters checkable)."],
  ['m', 'Momentum', 'Relative strength percentile (1–99) within the same market: 40% 3-month, 20% 6-month, 40% 1-year return.'],
  ['o', 'Ownership', 'India: promoters + FIIs + DIIs together (50% → 70%), FII + DII change in the last quarter (−1 → +1 pt), promoter stake over a year (cut of 3 pts → steady), promoter pledge (20% → none). From NSE shareholding filings.']];
const SCW = { q: 25, g: 20, l: 20, v: 15, c: 10, m: 10, o: 10 };
let SCROWS = null, SCBUILT = -1;
function scoreRow(r) {
  const fin = isFinD({ sector: r.sec, industry: r.ind }), india = mktOf(r.s) === 'IN', big = india ? 2e11 : 2e9;
  const loss = isNum(r.eps) ? r.eps <= 0 : false, pe = loss ? undefined : (r.pe > 0 ? r.pe : undefined), de = fin ? undefined : r.de;
  const o = { ...r, fin };
  // banks/financials: margins, debt and ROCE don't apply (as in the report), so Quality rests on ROE (consistency + moat proxy)
  o.q = fin ? sTable([[20, sLin(r.roe, 0.08, 0.18)], [10, sLin(r.roe, 0.1, 0.17)]])
    : sTable([[20, sLin(r.roe, 0.08, 0.18)], [15, sLin(r.om, 0.08, 0.2)], [15, sLin(de, 1, 0.3)],
      [10, isNum(r.roce) || isNum(r.gm) ? Math.max(sLin(r.roce, 0.1, 0.25) || 0, sLin(r.gm, 0.2, 0.45) || 0) : undefined],
      [10, sLin(r.cfoE, 0.4, 0.7)], [10, sLin(r.oiP, 0.35, 0.2)], [5, sLin(r.omCh, -0.02, 0.02)]]);
  o.v = sTable([[12.5, sLin(r.mcap, big / 4, big)], [12.5, sLin(de, 1, 0.5)], [12.5, loss ? 0 : sLin(pe, 25, 15)],
    [12.5, loss ? 0 : isNum(pe) && r.pb > 0 ? sLin(pe * r.pb, 45, 22.5) : undefined], [12.5, sLin(r.niG, 0, 0.03)]]);
  o.g = sTable([[25, sLin(r.revG, 0, 0.15)], [15, sLin(r.niG, 0, 0.15)], [10, isNum(r.niG) && isNum(r.revG) ? sLin(r.niG - r.revG, -0.05, 0.02) : undefined]]);
  const peg = isNum(pe) && r.niG > 0 ? pe / (r.niG * 100) : undefined;
  o.peg = peg;
  o.l = sTable([[40, loss ? 0 : isNum(peg) ? sLin(peg, 2, 1) : isNum(r.niG) && r.niG <= 0 ? 0 : undefined], [20, isNum(r.niG) ? (r.niG > 0.4 ? 0.5 : sLin(r.niG, 0, 0.2)) : undefined],
    [15, sLin(de, 1, 0.35)], [10, loss ? 0 : sLin(pe, 40, 20)]]);
  o.c = r.co >= 5 ? r.cs / r.co * 100 : undefined;
  o.m = isNum(r.rs) && (isNum(r.r3m) || isNum(r.r1y)) ? r.rs : undefined;
  // ownership (India): strong hands together, institutions adding or cutting last quarter, promoter selling, pledge
  const plg = isNum(r.pp) ? r.pp : r.plz ? 0 : undefined;
  o.strong = isNum(r.pro) && isNum(r.fii) && isNum(r.dii) ? r.pro + r.fii + r.dii : undefined;
  o.o = india ? sTable([[35, sLin(o.strong, 50, 70)], [30, sLin(r.instQ, -1, 1)], [20, sLin(r.proCh, -3, 0)], [15, sLin(plg, 20, 0)]]) : undefined;
  const parts = Object.keys(SCW).filter(k => isNum(o[k])), pw = parts.reduce((s, k) => s + SCW[k], 0);
  o.ov = pw >= 50 ? parts.reduce((s, k) => s + o[k] * SCW[k], 0) / pw : undefined;
  // promoter holding (NSE shareholding pattern; Yahoo "insiders" as an approximation when that's missing, e.g. BSE-only) and pledge
  o.proV = isNum(r.pro) ? r.pro : isNum(r.proY) ? r.proY : undefined; o.proX = !isNum(r.pro) && isNum(r.proY);
  o.plV = isNum(r.pp) ? r.pp : r.plz ? 0 : undefined;
  return o;
}
function scoreRows() {
  if (SCROWS && SCBUILT === SUMMARY.built) return SCROWS;
  SCROWS = SUMMARY.rows.filter(r => !(r.cap || '').startsWith('ETF')).map(scoreRow); SCBUILT = SUMMARY.built; return SCROWS;
}
// pro = minimum promoter holding %, pl = maximum pledge % ('' any, '0' none), proUp = promoter stake not cut by 1+ pt in a year
// fiiT = FII holding trend over ~1 year: '' any, 'inc' (+0.5 pt or more), 'dec' (−0.5 pt or more), 'flat'
const SCDEF = { mk: 'IN', cap: 'All', sec: '', min: {}, sort: ['ov', -1], q: '', pro: 0, pl: '', proUp: false, fiiT: '' };
const FII_OPTS = [['', 'FII trend: any'], ['inc', 'FII increasing ▲'], ['dec', 'FII decreasing ▼'], ['flat', 'FII flat']];
const fiiTrend = r => !isNum(r.fiiCh) ? '' : r.fiiCh >= 0.5 ? 'inc' : r.fiiCh <= -0.5 ? 'dec' : 'flat';
let SCF = Object.assign({}, SCDEF, LS.get('scf', {})), SCN = 50;
const SCPRESETS = [
  ['⭐ Top overall', { ov: 65 }, ['ov', -1]],
  ['🏰 Quality', { q: 70, v: 0 }, ['q', -1]],
  ['💰 Value', { v: 65 }, ['v', -1]],
  ['🌱 Growth', { g: 70 }, ['g', -1]],
  ['⚖️ GARP', { l: 65 }, ['l', -1]],
  ['🚀 Momentum', { m: 80, c: 55 }, ['m', -1]],
  ['🛡️ Promoter-backed', { q: 50 }, ['proV', -1], { pro: 50, pl: '5', proUp: true }, 'IN'],
  ['🌍 FIIs buying', { q: 50 }, ['fiiCh', -1], { fiiT: 'inc' }, 'IN']];
const PRO_OPTS = [0, 25, 40, 50, 60, 70, 75], PL_OPTS = [['', 'Pledge: any'], ['0', 'Pledge: none'], ['5', 'Pledge ≤ 5%'], ['10', 'Pledge ≤ 10%'], ['25', 'Pledge ≤ 25%']];
// which scores rest on which doubtful field (for red marking in the table)
const SC_USES = { pe: ['v', 'l', 'ov'], pb: ['v', 'ov'], r1y: ['m', 'c', 'ov'], roe: ['q', 'ov'], p: ['v', 'l', 'm', 'ov'] };
function scDoubt(W) { const o = {}; for (const [f, why] of Object.entries(W)) for (const k of SC_USES[f] || []) (o[k] = o[k] || []).push(why); return o; }
const scCol = s => !isNum(s) ? '#94a3b8' : s >= 65 ? '#15803d' : s >= 45 ? '#a16207' : '#b91c1c';
const scCell = s => isNum(s) ? `<b style="color:${scCol(s)}">${Math.round(s)}</b>` : '<span class="mut">–</span>';
function scSave() { LS.set('scf', SCF); }
const sgq = k => typeof gq === 'function' ? gq(k) : '';   // tappable "?" (plain-language glossary)
const SC_GK = { ov: 'scov', q: 'scq', v: 'scv', g: 'scg', l: 'garp', c: 'canslim', m: 'scm' };
function proCell(r) {
  if (!isNum(r.proV)) return '<span class="mut">–</span>';
  if (r.proX) return `<span class="doubt" title="Yahoo Finance 'insiders' — an approximation of the promoter group (NSE shareholding data not available for this stock)">${r.proV.toFixed(1)} ⚠</span>`;
  const ch = isNum(r.proCh) ? `<br><small class="${r.proCh <= -1 ? 'dn' : r.proCh >= 1 ? 'up' : 'mut'}" title="change over about a year">${r.proCh >= 0 ? '+' : ''}${r.proCh.toFixed(1)}${r.proCh <= -1 ? ' ⚠' : ''}</small>` : '';
  return `<span${r.proV < 25 ? ' class="dn" title="low promoter holding"' : ''}>${r.proV.toFixed(1)}</span>${ch}`;
}
function fiiCell(r) {
  if (!isNum(r.fii)) return '<span class="mut" title="FII holding not read yet for this stock">–</span>';
  const t = fiiTrend(r), q = r.fiiQ ? new Date(r.fiiQ + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) : '';
  const ch = isNum(r.fiiCh) ? `<br><small class="${t === 'inc' ? 'up' : t === 'dec' ? 'dn' : 'mut'}" title="change over the last ${r.fiiN || ''} quarters">${t === 'inc' ? '▲ +' : t === 'dec' ? '▼ ' : ''}${r.fiiCh.toFixed(1)}</small>` : '<br><small class="mut" title="only one quarter read so far">1 qtr</small>';
  return `<span title="FII / FPI holding${q ? ', ' + q : ''}">${r.fii.toFixed(1)}</span>${ch}`;
}
function plCell(r, sus) {
  if (isNum(r.pp)) return `<b style="color:${r.pp > 25 ? '#b91c1c' : r.pp > 5 ? '#b45309' : '#15803d'}">${r.pp.toFixed(1)}${r.pp > 5 ? ' ⚠' : ''}</b>`;
  if (r.plz) return sus ? `<span class="doubt" title="NSE returned 'no pledge' for every company in the latest update — uncertain">0? ⚠</span>` : '<span class="up">0</span>';
  return `<span class="mut" title="${r.s.endsWith('.BO') ? 'not available for BSE-only stocks' : 'not fetched yet'}">–</span>`;
}
async function renderScores(box) {
  if (!SUMMARY || !SUMMARY.rows.length) { box.innerHTML = `<p>${NA} — summary data could not be loaded.</p>`; return; }
  const all = scoreRows(), mk = SCF.mk, ql = (SCF.q || '').toLowerCase();
  const inMk = all.filter(r => mktOf(r.s) === mk);
  const caps = mk === 'IN' ? ['All', 'Large', 'Mid', 'Small', 'Micro', 'Other', 'Penny'] : ['All'];
  if (!caps.includes(SCF.cap)) SCF.cap = 'All';
  const secs = [...new Set(inMk.map(r => r.sec).filter(Boolean))].sort();
  if (SCF.sec && !secs.includes(SCF.sec)) SCF.sec = '';
  let rows = inMk.filter(r => (SCF.cap === 'All' || (SCF.cap === 'Penny' ? r.pn : r.cap === SCF.cap)) && (!SCF.sec || r.sec === SCF.sec));
  if (ql) rows = rows.filter(r => r.s.toLowerCase().includes(ql) || (r.n || '').toLowerCase().includes(ql));
  const act = Object.entries(SCF.min).filter(([, v]) => v > 0);
  rows = rows.filter(r => act.every(([k, v]) => isNum(r[k]) && r[k] >= v));
  // promoter holding & pledge filters (India only; stocks without the data are left out when a filter is set)
  const india = mk === 'IN', nPro = india ? (SCF.pro > 0) + (SCF.pl !== '') + !!SCF.proUp + !!SCF.fiiT : 0;
  const nFii = india ? inMk.filter(r => isNum(r.fiiCh)).length : 0;
  if (india) {
    if (SCF.fiiT) rows = rows.filter(r => fiiTrend(r) === SCF.fiiT);
    if (SCF.pro > 0) rows = rows.filter(r => isNum(r.proV) && r.proV >= SCF.pro);
    if (SCF.pl !== '') rows = rows.filter(r => isNum(r.plV) && r.plV <= +SCF.pl);
    if (SCF.proUp) rows = rows.filter(r => isNum(r.proCh) && r.proCh > -1);
  }
  if (typeof CORPCOV !== 'undefined' && CORPCOV === null && india) { CORPCOV = {}; getJSON(DATA + 'corp/coverage.json').then(c => { CORPCOV = c; if (document.getElementById('sct')) renderScores(box); }).catch(() => { }); }
  const plSus = typeof pledgeSuspect === 'function' && pledgeSuspect();
  const [sk, sd] = SCF.sort;
  rows.sort((a, b) => { const x = sk === 'n' ? (a.n || a.s).toLowerCase() : a[sk], y = sk === 'n' ? (b.n || b.s).toLowerCase() : b[sk]; if (!isNum(x) && sk !== 'n') return 1; if (!isNum(y) && sk !== 'n') return -1; return (x < y ? -1 : x > y ? 1 : 0) * sd || (b.ov ?? -1) - (a.ov ?? -1); });  // ties (many 100s) -> higher Overall first
  const shown = rows.slice(0, SCN);
  const th = (k, l) => `<th data-ss="${k}" style="cursor:pointer;user-select:none">${l}${sk === k ? (sd > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  const slider = ([k, l, why]) => { const v = SCF.min[k] || 0; return `<div class="scs"><label title="${esc(why)}"><span>${l}${sgq(SC_GK[k])}</span><b id="scv-${k}">${v ? '≥ ' + v : 'any'}</b></label><input type="range" min="0" max="95" step="5" value="${v}" data-min="${k}" aria-label="Minimum ${l} score"></div>`; };
  box.innerHTML = `<style>.scg{display:grid;grid-template-columns:repeat(2,1fr);gap:6px 14px;margin:8px 0}@media(min-width:700px){.scg{grid-template-columns:repeat(4,1fr)}}.scs label{display:flex;justify-content:space-between;font-size:13px;cursor:help}.scs input{width:100%;accent-color:var(--pri)}.scbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}.scbar select,.scbar input[type=text]{padding:7px;border:1px solid var(--line);border-radius:8px;font-size:14px;background:#fff;max-width:100%}.scbar input[type=text]{flex:1;min-width:140px;width:auto}#sct td:not(:first-child),#sct th:not(:first-child){text-align:center}</style>
  <div class="tabs">${['IN', 'US'].map(m => `<button data-smk="${m}" class="${m === mk ? 'on' : ''}">${m === 'IN' ? '🇮🇳 India' : '🇺🇸 US (S&P 500)'}</button>`).join('')}</div>
  <div class="tabs">${SCPRESETS.map(([l], i) => `<button data-sp="${i}">${l}${/Promoter-backed/.test(l) ? sgq('promback') : /FIIs buying/.test(l) ? sgq('fiibuy') : ''}</button>`).join('')}<button data-sp="reset" class="btn sec" style="border:0">↺ Reset</button></div>
  <div class="scbar">${caps.length > 1 ? `<select id="sccap" aria-label="Market-cap group">${caps.map(c => `<option value="${c}" ${c === SCF.cap ? 'selected' : ''}>${c === 'All' ? 'All sizes' : c === 'Other' ? 'Other listed' : c === 'Penny' ? '⚠️ Penny (under ₹50)' : c + ' cap'}</option>`).join('')}</select>` : ''}
  <select id="scsec" aria-label="Sector"><option value="">All sectors</option>${secs.map(s => `<option ${s === SCF.sec ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
  <input type="text" id="scq" placeholder="Name or symbol…" value="${esc(SCF.q || '')}"></div>
  ${india ? `<div class="scbar"><select id="scpro" aria-label="Minimum promoter holding">${PRO_OPTS.map(v => `<option value="${v}" ${+SCF.pro === v ? 'selected' : ''}>${v ? 'Promoter ≥ ' + v + '%' : 'Promoter: any'}</option>`).join('')}</select>${sgq('promoter')}
  <select id="scpl" aria-label="Maximum promoter pledge">${PL_OPTS.map(([v, l]) => `<option value="${v}" ${SCF.pl === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${sgq('pledge')}
  <select id="scfii" aria-label="FII holding trend">${FII_OPTS.map(([v, l]) => `<option value="${v}" ${SCF.fiiT === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${sgq('fiitrend')}
  <label class="mut" style="font-size:13px;display:flex;align-items:center;gap:4px"><input type="checkbox" id="scup" ${SCF.proUp ? 'checked' : ''}> Promoter stake not cut (by 1+ pt in a year)</label></div>
  ${SCF.fiiT && nFii < 200 ? `<p class="mut" style="margin:4px 0">FII trend is available for ${nFii.toLocaleString()} stocks so far — it is read from each company's quarterly shareholding filing and fills in over the next few days.</p>` : ''}
  ${plSus && SCF.pl !== '' ? `<p class="doubt" style="text-decoration:none;margin:4px 0">⚠ Pledge data is uncertain right now: NSE returned "no pledge" for every company in the latest update, so the pledge filter may let pledged companies through.</p>` : ''}` : ''}
  <p class="mut" style="margin:6px 0 0">Minimum scores (0–100)${sgq('qsc')}. Drag right to tighten. Hover or long-press a name to see how it's scored.</p>
  <div class="scg">${SCORES.map(slider).join('')}</div>
  ${SCF.cap === 'Penny' && typeof PENNYWARN !== 'undefined' ? PENNYWARN : ''}
  <p><b>${rows.length.toLocaleString()}</b> of ${inMk.length.toLocaleString()} stocks match${act.length + nPro ? ` (${act.length + nPro} filter${act.length + nPro > 1 ? 's' : ''})` : ''}.</p>
  <div class="tw"><table class="pt" id="sct"><tr>${th('n', 'Stock')}${SCORES.map(([k, l]) => th(k, l)).join('')}${th('pe', 'P/E')}${india ? th('proV', 'Promoter %' + sgq('promoter')) + th('plV', 'Pledge %' + sgq('pledge')) + th('fiiCh', 'FII % (trend)' + sgq('fiitrend')) : ''}</tr>${shown.map(r => { const W = typeof rowDoubts === 'function' ? rowDoubts(r) : {}, bad = scDoubt(W);
    const cell = k => isNum(r[k]) && bad[k] ? `<span class="doubt" title="${esc('Built on doubtful data: ' + bad[k].join('; '))}">${Math.round(r[k])} ⚠</span>` : scCell(r[k]);
    return `<tr data-s="${esc(r.s)}"><td class="nogq" style="white-space:normal">${esc((r.n || r.s).slice(0, 30))}${typeof rowDoubtTag === 'function' ? rowDoubtTag(W) : ''}${r.sv ? ' ' + survTag(r.sv) : ''}<br><small class="mut">${esc(r.s.replace(/\.(NS|BO)$/, ''))}${r.sec ? ' · ' + esc(r.sec) : ''}</small></td>${SCORES.map(([k]) => `<td>${cell(k)}</td>`).join('')}<td>${W.pe ? `<span class="doubt" title="${esc(W.pe)}">${fx(r.pe)} ⚠</span>` : fx(r.pe)}</td>${india ? `<td>${proCell(r)}</td><td>${plCell(r, plSus)}</td><td>${fiiCell(r)}</td>` : ''}</tr>`; }).join('')}</table></div>
  <p class="mut" style="font-size:12px"><span class="doubt">Red with ⚠</span>${sgq('doubt')} = built on data that looks inconsistent (unusual P/E or P/B, extreme 1-year return, ROE beyond ±100%, or Yahoo vs exchange price gap). Hover, or open the stock, to see why.</p>
  ${rows.length > shown.length ? `<p style="text-align:center"><button class="btn sec" id="scMore">Show ${Math.min(rows.length - shown.length, 200)} more</button></p>` : ''}
  <details class="how"><summary>How the scores work</summary><div class="mut">${SCORES.map(([, l, why]) => `<p><b>${l}:</b> ${why}</p>`).join('')}<p>Each criterion earns 0 → full points on a straight line between the "poor" and "good" values shown (poor → good). A score is only given when data covers at least 40% of its weight; missing data is left out, never guessed. A stock with no score for a filter you've set is excluded.</p><p>These <b>quick scores</b> use the one-line summary kept for every stock. The full report on a stock's page also uses cash flow, dividends, margin history, technicals and more, so its Buffett / Graham / Fisher / Lynch / composite numbers can differ.</p></div></details>
  <p class="src">Data snapshot ${sumAsOf()}. Colours: <b style="color:#15803d">≥ 65 strong</b> · <b style="color:#a16207">45–64 mixed</b> · <b style="color:#b91c1c">&lt; 45 weak</b>. Educational screen built from fixed rules, not a buy or sell recommendation.</p>`;
  const rerender = () => renderScores(box);
  box.querySelectorAll('[data-smk]').forEach(b => b.onclick = () => { SCF.mk = b.dataset.smk; SCN = 50; scSave(); rerender(); });
  box.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => {
    if (b.dataset.sp === 'reset') SCF = Object.assign({}, SCDEF, { mk: SCF.mk, min: {} });
    else { const p = SCPRESETS[+b.dataset.sp]; SCF.min = Object.fromEntries(Object.entries(p[1]).filter(([, v]) => v > 0)); SCF.sort = p[2];
      Object.assign(SCF, { pro: 0, pl: '', proUp: false, fiiT: '' }, p[3] || {}); if (p[4]) SCF.mk = p[4]; }
    SCN = 50; scSave(); rerender();
  });
  box.querySelectorAll('[data-ss]').forEach(t => t.onclick = () => { const k = t.dataset.ss; SCF.sort = [k, SCF.sort[0] === k ? -SCF.sort[1] : (k === 'n' || k === 'pe' || k === 'plV' ? 1 : -1)]; scSave(); rerender(); });
  box.querySelectorAll('[data-min]').forEach(inp => {
    inp.oninput = () => { const k = inp.dataset.min, v = +inp.value; box.querySelector('#scv-' + k).textContent = v ? '≥ ' + v : 'any'; };
    inp.onchange = () => { const k = inp.dataset.min, v = +inp.value; if (v) SCF.min[k] = v; else delete SCF.min[k]; SCN = 50; scSave(); const y = window.scrollY; rerender().then(() => window.scrollTo(0, y)); };
  });
  const cs = box.querySelector('#sccap'); if (cs) cs.onchange = () => { SCF.cap = cs.value; SCN = 50; scSave(); rerender(); };
  const ss = box.querySelector('#scsec'); ss.onchange = () => { SCF.sec = ss.value; SCN = 50; scSave(); rerender(); };
  const keep = () => { SCN = 50; scSave(); const y = window.scrollY; rerender().then(() => window.scrollTo(0, y)); };
  const sp = box.querySelector('#scpro'); if (sp) sp.onchange = () => { SCF.pro = +sp.value; keep(); };
  const spl = box.querySelector('#scpl'); if (spl) spl.onchange = () => { SCF.pl = spl.value; keep(); };
  const su = box.querySelector('#scup'); if (su) su.onchange = () => { SCF.proUp = su.checked; keep(); };
  const sf = box.querySelector('#scfii'); if (sf) sf.onchange = () => { SCF.fiiT = sf.value; keep(); };
  const qi = box.querySelector('#scq'); qi.oninput = () => { SCF.q = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { const pos = qi.selectionStart; scSave(); rerender().then(() => { const n = box.querySelector('#scq'); n.focus(); n.setSelectionRange(pos, pos); }); }, 250); };
  const mb = box.querySelector('#scMore'); if (mb) mb.onclick = () => { SCN += 200; const y = window.scrollY; rerender().then(() => window.scrollTo(0, y)); };
}
