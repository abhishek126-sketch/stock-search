// ===== Exchange data for Indian stocks: red-flags check, filings, bulk/block deals, rule-based quality score =====
// Data: data/x/<SYM>.json built by scripts/build_corp.py from free official NSE/BSE files (no keys).
const CORP_TAG = { results: 'Results', fundraise: 'Fund-raising', order: 'Order / contract', auditor: 'Auditor', pledge: 'Pledge', mgmt: 'Management change', agm: 'Meeting' };
let CORPF = 'key';
function corpPlaceholder(d) { return d.symbol.match(/\.(NS|BO)$/) && !d.etf ? '<div id="corpx"><div class="card mut">Loading exchange filings, deals and red-flags check…</div></div>' : ''; }
async function corpLoad(d, k, R) {
  const el = document.getElementById('corpx'); if (!el) return;
  let x = null; try { x = await getJSON(DATA + 'x/' + encodeURIComponent(d.symbol) + '.json'); } catch (e) { }
  if (!document.getElementById('corpx') || CUR !== d) return;
  el.innerHTML = corpHTML(d, k, R, x || {});
  const fl = document.getElementById('falinks'); if (fl && x) fl.innerHTML = fullAnalysisLinks(d, { ...(x.links || {}), code: x.code });
  corpBind(el, d, k, R, x); autoGloss(el);
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
  else if (pl && pl.none) add('ok', 'Promoter pledge', 'no pledge disclosure on NSE (usually means no promoter shares pledged).');
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
  return `<div class="grid two">${flags}${qs}</div>${filings}${deals}`;
}
