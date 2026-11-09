// ===== Exchange data for Indian stocks: red-flags check, filings, bulk/block deals, rule-based quality score =====
// Data: data/x/<SYM>.json built by scripts/build_corp.py from free official NSE/BSE files (no keys).
const CORP_TAG = { results: 'Results', fundraise: 'Fund-raising', order: 'Order / contract', auditor: 'Auditor', pledge: 'Pledge', mgmt: 'Management change', agm: 'Meeting' };
let CORPF = 'key', CORPCOV = null;
// NSE returned "no pledge" for (almost) every company in the last run -> a "no pledge" result can't be trusted
const pledgeSuspect = () => !!(CORPCOV && !CORPCOV.pledge && ((CORPCOV.pledgeNone || 0) > 500 || (CORPCOV.nse || 0) > 500));
function corpPlaceholder(d) { return d.symbol.match(/\.(NS|BO)$/) && !d.etf ? '<div id="corpx"><div class="card mut">Loading exchange filings, deals and red-flags check…</div></div>' : ''; }
async function corpLoad(d, k, R, A) {
  const el = document.getElementById('corpx'); if (!el) { if (typeof autoUpdate === 'function') autoUpdate(d, k, A, R, {}); return; }
  let x = null; try { x = await getJSON(DATA + 'x/' + encodeURIComponent(d.symbol) + '.json'); } catch (e) { }
  if (!CORPCOV) { try { CORPCOV = await getJSON(DATA + 'corp/coverage.json'); } catch (e) { CORPCOV = {}; } }
  if (!document.getElementById('corpx') || CUR !== d) return;
  el.innerHTML = corpHTML(d, k, R, x || {});
  const fl = document.getElementById('falinks'); if (fl && x) fl.innerHTML = fullAnalysisLinks(d, { ...(x.links || {}), code: x.code });
  corpBind(el, d, k, R, x); autoGloss(el);
  if (typeof autoUpdate === 'function') autoUpdate(d, k, A, R, x || {});
}
function corpBind(el, d, k, R, x) {
  el.querySelectorAll('[data-jump]').forEach(a => a.onclick = e => { e.preventDefault(); const t = document.getElementById(a.dataset.jump); if (!t) return; if (t.tagName === 'DETAILS') t.open = true; t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  el.querySelectorAll('[data-cf]').forEach(b => b.onclick = () => { CORPF = b.dataset.cf; el.innerHTML = corpHTML(d, k, R, x || {}); corpBind(el, d, k, R, x); autoGloss(el); }); }
function corpHTML(d, k, R, x) {
  const bse = d.symbol.endsWith('.BO'), base = d.symbol.replace(/\.(NS|BO)$/, ''), fin = typeof isFinD === 'function' && isFinD(d), f = d.fund || {};
  const fd = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const L = [], add = (st, t, why) => L.push({ st, t, why }), ic = { ok: '✅', warn: '⚠️', na: '▫️' };
  // 1 promoter pledge
  const pl = x.pledge;
  if (pl && !pl.none && isNum(pl.pp)) add(pl.pp > 5 ? 'warn' : 'ok', 'Promoter pledge', `${pl.pp.toFixed(1)}% of promoter shares pledged (${pl.pt.toFixed(2)}% of all shares), as of ${esc(pl.shp || '')} · NSE disclosure. Warning if above 5%; above 25% is serious.`);
  else if (pl && pl.none && pledgeSuspect()) add('na', 'Promoter pledge', '<span class="doubt" title="NSE returned no pledge data for any company in the latest update">uncertain ⚠</span> — NSE returned no pledge data for any company in the latest update, so "no pledge" can\'t be trusted right now. Check NSE\'s pledge disclosures.');
  else if (pl && pl.none) add('ok', 'Promoter pledge', 'no pledge disclosure on NSE (usually means no promoter shares pledged).');
  else if (pl && pl.unk) add('na', 'Promoter pledge', 'NSE\'s pledge data could not be read in the latest update.');
  else add('na', 'Promoter pledge', bse ? 'not available for BSE-only stocks (BSE\'s data service blocks automated access) — check the BSE shareholding pattern.' : 'not fetched yet (refreshed in daily batches).');
  // 2 promoter holding trend
  const pr = x.prom || [];
  if (pr.length >= 2) { const a = pr[Math.max(0, pr.length - 5)], b = pr[pr.length - 1], ch = b[1] - a[1], q = pr.length - 1 - Math.max(0, pr.length - 5);
    add(ch <= -1 ? 'warn' : 'ok', 'Promoter holding trend', `${a[1].toFixed(2)}% → ${b[1].toFixed(2)}% over the last ${q} quarter(s) (${ch >= 0 ? '+' : ''}${ch.toFixed(2)} pts; warning if it fell by 1 pt or more) · trail: ${pr.slice(-5).map(p => p[1].toFixed(1) + '%').join(' → ')}`);
    if (b[1] < 25) L[L.length - 1].why += ` · promoters own only ${b[1].toFixed(1)}%.`; }
  else add('na', 'Promoter holding trend', bse ? 'not available for BSE-only stocks (BSE data service blocked) — check the BSE shareholding pattern.' : 'not fetched yet.');
  // 3 losses
  const ni = (f.annualNetIncome || []).slice(-3), qn = (f.quarterlyNetIncome || []).slice(-4);
  const lossY = ni.filter(v => v[1] < 0).length, ttm = qn.length === 4 ? qn.reduce((s, v) => s + v[1], 0) : undefined;
  if (ni.length || isNum(ttm)) add(lossY || (isNum(ttm) && ttm < 0) || k.loss ? 'warn' : 'ok', 'Losses', `${isNum(ttm) ? 'last 4 quarters ' + (ttm < 0 ? 'loss' : 'profit') + ' ' + fmtBig(ttm, d.currency) + '; ' : ''}${ni.length ? lossY + ' loss-making year(s) in the last ' + ni.length : ''} (Yahoo Finance statements).`);
  else add('na', 'Losses', 'no profit/loss statements available from the free data source.');
  // 4 high debt
  if (fin) add('na', 'High debt', 'not meaningful for banks/financials.');
  else if (k.negEquity) add('warn', 'High debt', 'negative shareholders\' equity — liabilities exceed assets.');
  else if (isNum(k.de)) add(k.de > 1 ? 'warn' : 'ok', 'High debt', `debt / equity ${k.de.toFixed(2)} (warning if above 1.0).`);
  else add('na', 'High debt', 'debt / equity not available.');
  // 5 auditor change / resignation
  const au = x.aud || [];
  if (x.ann || x.annN !== undefined) add(au.length ? 'warn' : 'ok', 'Auditor change / resignation', au.length ? `${x.audBad ? '<b>auditor resignation</b>' : 'auditor change'} filed: ${au.map(a => `${fd(a.d)} — <a href="${esc(a.u)}" target="_blank" rel="noopener">${esc(a.t.slice(0, 90))}</a>`).join('; ')}` : `none in ${bse ? 'BSE filings collected since ' + fd(x.bseSince) : 'the last 12 months of NSE filings'}.`);
  else add('na', 'Auditor change / resignation', bse ? `no BSE filings collected yet (collected daily since ${fd(x.bseSince) || 'today'}).` : 'not fetched yet.');
  // 6 ASM/GSM
  const sv = x.surv || (d.penny && d.penny.surv);
  if (sv) add('warn', 'ASM / GSM surveillance', `<b>on the list: ${esc(sv)}</b> (${bse ? 'matched by ISIN on ' : ''}NSE surveillance files).`);
  else if (bse) add('na', 'ASM / GSM surveillance', 'not on NSE\'s lists; BSE\'s own ASM/GSM list is not freely downloadable — check bseindia.com.');
  else add('ok', 'ASM / GSM surveillance', 'not on NSE\'s current ASM or GSM lists.');
  const nw = L.filter(i => i.st === 'warn').length, nc = L.filter(i => i.st !== 'na').length;
  const flags = `<div class="card"><h2>🚦 Red flags check <span class="mut">(${nw} warning${nw === 1 ? '' : 's'} of ${nc} checked)</span></h2>
   <ul class="flags">${L.map(i => `<li class="${i.st === 'warn' ? 'flag' : i.st}">${ic[i.st]} <b>${i.t}</b> — ${i.why}</li>`).join('')}</ul>
   <p class="src">Sources: NSE shareholding &amp; pledge disclosures and corporate filings${bse ? ', BSE announcements feed' : ''}, NSE ASM/GSM lists, Yahoo Finance statements. A warning is a prompt to read the filings, not a conclusion. ▫️ = could not be checked.</p></div>`;
  // filings
  const an = x.ann || [], key = an.filter(a => (a.g || []).some(g => ['results', 'fundraise', 'order', 'auditor', 'pledge'].includes(g))), show = CORPF === 'key' ? key : an;
  const filings = `<div class="card"><h2>📄 Recent company filings &amp; announcements <span class="mut">(${bse ? 'BSE' : 'NSE'})</span></h2>
   <div class="tabs"><button data-cf="key" class="${CORPF === 'key' ? 'on' : ''}">Key (${key.length})</button><button data-cf="all" class="${CORPF === 'all' ? 'on' : ''}">All recent (${an.length})</button></div>
   ${show.length ? `<div class="tw"><table><tr><th>Date</th><th>Type</th><th>Filing</th></tr>${show.slice(0, 25).map(a => `<tr><td style="white-space:nowrap">${fd(a.d)}</td><td>${(a.g || []).filter(g => g !== 'agm' || a.g.length === 1).map(g => `<span class="tag">${CORP_TAG[g] || g}</span>`).join(' ') || '<span class="mut">Other</span>'}</td><td>${a.u ? `<a href="${esc(a.u)}" target="_blank" rel="noopener">${esc(a.t)}</a>` : esc(a.t)}</td></tr>`).join('')}</table></div>`
     : `<p class="mut">${an.length ? 'No results, fund-raising, order or auditor filings in this period — see "All recent".' : bse ? `No BSE filings collected yet for this company (BSE's public feed holds only the current day, so filings are collected daily since ${fd(x.bseSince) || 'today'}).` : 'No filings fetched yet (refreshed in daily batches).'}</p>`}
   <p class="src">${bse ? `BSE public announcements feed, collected daily since ${fd(x.bseSince)}.` : `NSE corporate announcements, last 12 months${isNum(x.annN) ? ' (' + x.annN + ' in total)' : ''}.`} Types are tagged by keywords in the filing subject. Links open the original exchange document. <a href="${bse ? `https://www.bseindia.com/stock-share-price/x/${esc(base)}/${esc(x.code || '')}/corp-announcements/` : `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(base)}`}" target="_blank" rel="noopener">All filings on ${bse ? 'BSE' : 'NSE'} ↗</a></p></div>`;
  // deals
  const dl = x.deals || [], qf = v => v.toLocaleString('en-IN');
  const deals = `<div class="card"><h2>🤝 Bulk &amp; block deals</h2>
   ${dl.length ? `<div class="tw"><table><tr><th>Date</th><th>Exch.</th><th>Type</th><th>Buyer / seller</th><th>Side</th><th>Quantity</th><th>Price</th><th>Value</th></tr>${dl.map(r => `<tr><td style="white-space:nowrap">${fd(r.d)}</td><td>${r.x}</td><td>${r.k === 'block' ? 'Block' : 'Bulk'}</td><td>${esc(r.c)}</td><td class="${r.s === 'BUY' ? 'up' : 'dn'}">${r.s === 'BUY' ? 'Buy' : 'Sell'}</td><td>${qf(r.q)}</td><td>₹${r.p.toFixed(2)}</td><td>${fmtBig(r.q * r.p, 'INR')}</td></tr>`).join('')}</table></div>`
     : `<p class="mut">No ${bse ? 'NSE ' : ''}bulk or block deals recorded since ${fd(x.dealsSince) || 'collection started'}.</p>`}
   <p class="src">NSE daily bulk/block deal files, collected every day since ${fd(x.dealsSince) || 'today'} (NSE's historical-deals service blocks automated access, so older deals are not shown). ${bse ? 'BSE bulk/block deals are not available — BSE\'s data service blocks automated access; check bseindia.com.' : 'BSE deals are not included (BSE\'s data service blocks automated access).'} A bulk deal is a trade of over 0.5% of the company's shares in a day; a block deal is a single large trade (₹10 Cr+) in a special window.</p></div>`;
  // quality score (from the existing 25-point report)
  let qs = '';
  if (R && isNum(R.comp)) { const s = Math.round(R.comp), col = s >= 68 ? '#16a34a' : s >= 55 ? '#65a30d' : s >= 42 ? '#eab308' : '#dc2626';
    qs = `<div class="card"><h2>🧮 Quality score <span class="mut">(rule-based estimate)</span></h2>
     <div style="display:flex;align-items:center;gap:12px"><b style="font-size:28px;color:${col}">${s}<span class="mut" style="font-size:14px">/100</span></b><div style="flex:1"><div class="bar" style="height:10px;background:#e2e8f0;border-radius:5px"><i style="display:block;height:10px;border-radius:5px;width:${s}%;background:${col}"></i></div><div class="mut">${esc(R.verdict)}${R.flags ? ` · ${R.flags} red flag(s) in the report` : ''}${nw ? ` · ${nw} warning(s) above` : ''}</div></div></div>
     <p class="mut" style="margin-top:6px">${R.parts.map(p => `${p[0]} ${isNum(p[1]) ? Math.round(p[1]) : 'n/a'} (weight ${p[2]})`).join(' · ')}</p>
     <p class="src"><b>This is an estimate from fixed rules, not expert opinion and not a recommendation.</b> It is the weighted composite of the 25-point research report below (fundamentals, Buffett, Graham, Fisher, Lynch, CANSLIM, technicals), using only the free data shown on this page; missing data is left out. The exchange red-flags check above is not part of the score — read both. <a href="#" data-jump="r-exec">See the full report ↓</a></p></div>`; }
  else qs = `<div class="card"><h2>🧮 Quality score <span class="mut">(rule-based estimate)</span></h2><p class="mut">Not enough data to compute the score from the 25-point report for this stock.</p></div>`;
  return `${typeof swingCard === 'function' ? swingCard(d) : ''}<div class="grid two">${flags}${qs}</div>${promoterHTML(d, x)}${growthHTML(d, x)}${filings}${deals}`;
}
// ===== Promoter holding & pledge (NSE disclosures for NSE stocks; Yahoo Finance holder data as cross-check / for BSE-only) =====
function promoterHTML(d, x) {
  const bse = d.symbol.endsWith('.BO'), base = d.symbol.replace(/\.(NS|BO)$/, ''), pr = x.prom || [], pl = x.pledge, yi = d.profile && d.profile.insiders;
  const qd = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '';
  const yTxt = isNum(yi) ? `${(yi * 100).toFixed(1)}%` : null;
  let hold = '', pledge = '';
  if (pr.length) {
    const last = pr[pr.length - 1], yr = pr.length > 4 ? pr[pr.length - 5] : pr[0], ch = last[1] - yr[1];
    const gap = isNum(yi) ? Math.abs(last[1] - yi * 100) : null;
    hold = `<div class="kv"><div><span>Promoter holding (${qd(last[0])})</span><b style="font-size:20px">${last[1].toFixed(2)}%</b></div>
      <div><span>Change since ${qd(yr[0])}</span><b class="${ch <= -1 ? 'dn' : ch >= 1 ? 'up' : ''}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)} pts${ch <= -1 ? ' ⚠' : ''}</b></div>
      <div><span>Yahoo Finance (insiders)</span><b>${yTxt ? (gap > 10 ? `<span class="doubt" title="NSE says ${last[1].toFixed(1)}%, Yahoo says ${yTxt} — ${gap.toFixed(0)} pts apart; Yahoo's 'insiders' is not the same definition as SEBI 'promoter group', but a gap this large needs checking">${yTxt} ⚠</span>` : yTxt) : NA}</b></div></div>
      <div class="tw" style="margin-top:8px"><table><tr><th>Quarter</th>${pr.map(p => `<th>${qd(p[0])}</th>`).join('')}</tr><tr><td>Promoter %</td>${pr.map((p, i) => { const c = i ? p[1] - pr[i - 1][1] : 0; return `<td class="${c <= -0.5 ? 'dn' : c >= 0.5 ? 'up' : ''}">${p[1].toFixed(2)}</td>`; }).join('')}</tr></table></div>
      ${last[1] < 25 ? `<p class="dn" style="margin:6px 0 0">⚠ Promoters own only ${last[1].toFixed(1)}% — low promoter "skin in the game".</p>` : ''}${ch <= -1 ? `<p class="dn" style="margin:6px 0 0">⚠ Promoters have cut their stake by ${(-ch).toFixed(2)} pts in this period — read the shareholding filings for the reason.</p>` : ''}`;
  } else if (bse) {
    hold = `<div class="kv"><div><span>Promoter / insider holding</span><b style="font-size:20px">${yTxt ? `<span class="doubt" title="From Yahoo Finance 'insiders' — an approximation of SEBI's promoter group; BSE's own shareholding data can't be downloaded automatically">${yTxt} ⚠</span>` : NA}</b></div></div>
      <p class="mut">BSE-only stock: the official promoter-holding history isn't freely downloadable (BSE's data service blocks automated access). ${yTxt ? "The figure above is Yahoo Finance's \"insiders\" holding — shown in red as approximate." : ''} Check the latest shareholding pattern on BSE.</p>`;
  } else hold = `<p class="mut">Promoter holding not fetched yet for this stock (NSE data is refreshed in daily batches).${yTxt ? ` Yahoo Finance shows insiders holding ${yTxt}.` : ''}</p>`;
  if (bse) pledge = `<p><b>Pledge:</b> <span class="mut">not available for BSE-only stocks (BSE's pledge disclosures can't be downloaded automatically) — check BSE.</span></p>`;
  else if (pl && isNum(pl.pp)) { const col = pl.pp > 25 ? '#b91c1c' : pl.pp > 5 ? '#b45309' : '#15803d';
    pledge = `<div class="kv" style="margin-top:8px"><div><span>Promoter shares pledged</span><b style="font-size:20px;color:${col}">${pl.pp.toFixed(2)}%${pl.pp > 5 ? ' ⚠' : ''}</b></div><div><span>Pledged, % of all shares</span><b>${pl.pt.toFixed(2)}%</b></div><div><span>As of</span><b>${esc(pl.shp || '') || NA}</b></div></div>
      <p class="mut">${pl.pp > 25 ? '<b class="dn">Above 25% is serious</b> — if the share price falls, lenders can sell pledged shares, which can push the price down further.' : pl.pp > 5 ? 'Above 5% is worth watching.' : 'Low pledge.'} Source: NSE pledge disclosure.</p>`; }
  else if (pl && pl.none) pledge = pledgeSuspect()
    ? `<p><b>Pledge:</b> <span class="doubt" title="NSE returned no pledge data for any company in the latest update">uncertain ⚠</span> <span class="mut">— NSE returned no pledge data for <i>any</i> company in the latest update, which looks like a data problem, so "no pledge" can't be trusted. Check NSE's pledge disclosures.</span></p>`
    : `<p><b>Pledge:</b> <span class="up">none disclosed</span> <span class="mut">— no promoter pledge disclosure on NSE.</span></p>`;
  else pledge = `<p><b>Pledge:</b> <span class="mut">${pl && pl.unk ? "NSE's pledge data couldn't be read in the latest update." : 'not fetched yet.'}</span></p>`;
  // FII (foreign institutions / FPIs) and DII (domestic institutions) from the quarterly shareholding-pattern filings
  const inst = (x.inst || []).filter(q => isNum(q[1]) || isNum(q[2]));
  let fii = '';
  if (inst.length) {
    const tr = i => { const v = inst.filter(q => isNum(q[i])); if (v.length < 2) return ''; const c = v[v.length - 1][i] - v[0][i];
      return ` <span class="${c >= 0.5 ? 'up' : c <= -0.5 ? 'dn' : 'mut'}">${c >= 0.5 ? '▲ increasing' : c <= -0.5 ? '▼ decreasing' : 'flat'} (${c >= 0 ? '+' : ''}${c.toFixed(2)} pts since ${qd(v[0][0])})</span>`; };
    fii = `<h3>🌍 Institutional holding</h3><div class="tw"><table><tr><th>Quarter</th>${inst.map(q => `<th>${qd(q[0])}</th>`).join('')}</tr>
      <tr><td>FII / FPI %</td>${inst.map(q => `<td>${isNum(q[1]) ? q[1].toFixed(2) : '–'}</td>`).join('')}</tr>
      <tr><td>DII %</td>${inst.map(q => `<td>${isNum(q[2]) ? q[2].toFixed(2) : '–'}</td>`).join('')}</tr></table></div>
      <p style="margin:4px 0"><b>FII:</b>${tr(1) || ' <span class="mut">trend needs 2+ quarters (filling in)</span>'} · <b>DII:</b>${tr(2) || ' <span class="mut">—</span>'}</p>`;
  } else if (!bse) fii = `<p class="mut"><b>FII / DII holding:</b> not read yet — taken from each quarterly shareholding filing, filling in over the next few days.</p>`;
  else fii = `<p class="mut"><b>FII / DII holding:</b> not available for BSE-only stocks (BSE's shareholding data can't be downloaded automatically).</p>`;
  const link = bse ? `https://www.bseindia.com/stock-share-price/x/${esc(base)}/${esc(x.code || '')}/` : `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(base)}`;
  return `<div class="card nogq" id="promoter"><h2>👥 Promoter holding, pledge &amp; FIIs</h2>${hold}${pledge}${fii}
    <p class="src">${bse ? 'Yahoo Finance holder data (approximate).' : 'NSE shareholding-pattern and pledge disclosures (quarterly); Yahoo Finance "insiders" shown as a cross-check.'} Promoters are the founders / controlling group. A falling stake or a high pledge is a reason to read the filings, not a verdict. <a href="${link}" target="_blank" rel="noopener">Shareholding on ${bse ? 'BSE' : 'NSE'} ↗</a></p></div>`;
}
// ===== Growth plans, orders received / completed, court cases & legal matters (Indian stocks) =====
// Same keyword rules as scripts/build_corp.py, re-applied here so older stored filings are tagged too.
const GRX = {
  expansion: /expan|capex|guidance|invest(ment)? (of|in|worth) (rs|inr|₹|\$|usd)|\bplans? (to|inr|rs|₹)|capital expenditure|new (plant|unit|facility|factory|capacity|product|line)|greenfield|brownfield|capacity (addition|enhancement|augment)|commercial production|commission(ing|ed)? of|acqui(re|sition)|amalgamat|(?<!de)merger|joint venture|\bjv\b|memorandum of understanding|\bmou\b|strategic (partnership|alliance|tie.?up)|foray|launch(es|ed|ing)? (of )?(a |its |new |the )?(new )?(product|brand|service|plant|range|model|vehicle|drug|medicine|platform|facility|variant)|set(ting)? up (a |an |its |new )?(plant|unit|facility|factory|manufactur)|incorporation of (a )?(wholly owned )?subsidiar|diversif/,
  done: /(complet|execut|deliver|handed over|handover|commission)\w*.{0,40}\b(order|project|contract|work|plant|supply)|(order|project|contract|work)s?.{0,40}\b(complet|execut|deliver|handed over|commissioned)/,
  legal: /litigation|court|pronouncement of order|order dated|judg(e)?ment|verdict|\bdisputes?\b|\brulings?\b|stay order|contempt|quash|summons|charge.?sheet|tribunal|\bnclt\b|\bnclat\b|arbitra|lawsuit|\bsuit\b|petition|writ\b|show.?cause|penalt|\bfine[ds]?\b|action\(?s?\)? initiated|orders? passed|adjudicat|demand (order|notice)|tax demand|\bgst\b.{0,30}(demand|notice|order)|income.?tax.{0,30}(search|survey|demand|notice)|enforcement directorate|\bcbi\b|\bfir\b|insolvency|\bcirp\b|winding.?up|\bsebi\b.{0,40}(order|notice|penalt|settle)|settlement order|regulatory action|search and seizure|raid/,
  order: /(?<!in )\borders?\b(?! to\b)(?! of\b)|contract|letter of (award|intent)|\bloa\b|work order|tender|bagg|awarded/ };
function growthCats(t, g0) {
  const s = String(t || '').toLowerCase(), g = new Set(g0 || []);
  for (const k of ['expansion', 'done', 'legal']) if (GRX[k].test(s)) g.add(k);
  if (g.has('legal') && g.has('order') && /orders? passed|action\(?s?\)? (initiated|taken)|court|tribunal|demand order|penalt|pronouncement of order|order dated|judg(e)?ment/.test(s)) g.delete('order');
  return g;
}
function growthHTML(d, x) {
  const bse = d.symbol.endsWith('.BO'), ex = bse ? 'BSE' : 'NSE', base = d.symbol.replace(/\.(NS|BO)$/, '');
  const fd = s => s ? new Date(typeof s === 'number' ? s * 1000 : s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const F = (x.ann || []).map(a => ({ src: 'filing', d: a.d, ts: Date.parse(a.d + 'T00:00:00') / 1000, t: a.t, u: a.u, g: growthCats(a.t, a.g) }));
  // headlines: only this card's own rules (the broader news tags also catch outlooks, appointments etc.)
  const N = ((d.news && d.news.items) || []).map(n => { const s = String(n.t || '').toLowerCase(), g = growthCats(n.t, GRX.order.test(s) && !/acqui|stake|merger|order dated|court/.test(s) ? ['order'] : []);
    return { src: 'news', d: n.d, ts: n.d, t: n.t, u: n.u, s: n.s, g }; });
  const pick = k => [...F.filter(i => i.g.has(k)), ...N.filter(i => i.g.has(k))].sort((a, b) => (a.src === b.src ? 0 : a.src === 'filing' ? -1 : 1) || b.ts - a.ts);
  const item = i => `<li>${i.src === 'filing' ? `<span class="tag" style="background:#dcfce7;color:#166534;margin-left:0">${ex} filing</span>` : `<span class="tag" style="background:#f1f5f9;color:#475569;margin-left:0" title="Headline matched by keywords — not verified">News</span>`} <small class="mut">${fd(i.d)}</small><br>${i.u ? `<a href="${esc(i.u)}" target="_blank" rel="noopener">${esc(i.t)}</a>` : esc(i.t)}${i.s ? ` <small class="mut">— ${esc(i.s)}</small>` : ''}</li>`;
  const block = (k, title, none, red) => { const L = pick(k), nf = L.filter(i => i.src === 'filing').length;
    return `<details class="gsec" ${L.length ? 'open' : ''}><summary><b${red && L.length ? ' style="color:#b91c1c"' : ''}>${title}</b> <span class="mut">(${nf} filing${nf === 1 ? '' : 's'}${L.length - nf ? ' · ' + (L.length - nf) + ' news' : ''})</span></summary>
      ${L.length ? `<ul class="news">${L.slice(0, 8).map(item).join('')}</ul>${L.length > 8 ? `<details><summary class="mut">Show ${L.length - 8} more</summary><ul class="news">${L.slice(8).map(item).join('')}</ul></details>` : ''}` : `<p class="mut">${none}</p>`}</details>`; };
  const nfAll = F.length, period = bse ? `BSE filings collected since ${fd(x.bseSince) || 'recently'}` : 'NSE filings of the last 12 months';
  return `<div class="card nogq" id="growth"><h2>🏗️ Growth plans, orders &amp; legal matters</h2>
   <style>.gsec{border-top:1px solid var(--line);padding:6px 0}.gsec>summary{cursor:pointer;list-style:none;padding:4px 0}.gsec>summary::-webkit-details-marker{display:none}.gsec ul.news{margin:4px 0 6px;padding-left:18px}</style>
   ${!nfAll && !N.length ? `<p class="mut">No filings or news collected yet for this company.</p>` : ''}
   ${block('expansion', '🚀 Expansion &amp; plans to grow revenue', 'No expansion, capacity, acquisition, JV or new-product filings or headlines found.')}
   ${block('order', '📥 Orders &amp; contracts received', 'No order or contract wins filed or reported.')}
   ${block('done', '✅ Orders &amp; projects completed', 'No completion, execution or commissioning of orders/projects filed or reported. (Companies rarely announce completions separately; they usually show up in quarterly results.)')}
   ${block('legal', '⚖️ Court cases, legal &amp; regulatory matters', 'No litigation, tribunal, penalty, tax-demand or regulatory-action filings or headlines found.', true)}
   <p class="src"><b>How this is built:</b> ${period}${nfAll ? ` (${nfAll} kept)` : ''} and Google News headlines of the last 90 days, sorted by keywords in the exchange's own subject line or the headline. <b>Filings</b> are the company's official disclosures; <b>News</b> items are unverified. <b>Court cases:</b> only matters the company disclosed to the exchange (SEBI rules require material litigation to be disclosed) or that made the news are shown — this is <b>not a complete list of pending cases</b>. For the full picture see the annual report (contingent liabilities / legal proceedings) and the company's page on <a href="${bse ? `https://www.bseindia.com/stock-share-price/x/${esc(base)}/${esc(x.code || '')}/corp-announcements/` : `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(base)}`}" target="_blank" rel="noopener">${ex} ↗</a>. Educational only.</p></div>`;
}
