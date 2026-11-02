'use strict';
// ===== Live refresh: quotes overlay, 60-s polling, manual refresh, "Update now" via workflow_dispatch =====
const REPO = 'abhishek126-sketch/stock-search';
let QUOTES = null, META = null, LIVE_BUSY = false;
const bust = u => u + (u.includes('?') ? '&' : '?') + 't=' + Date.now();
const tIST = s => new Date(s * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
function applyQuote(d) {
  const q = QUOTES && QUOTES.q && QUOTES.q[d.symbol]; if (!q || !d.hist || !d.hist.length) return d;
  const [p, pc, t] = q; if (!isNum(p) || !t || t <= (d.priceTime || 0)) return d;
  d.price = p; if (isNum(pc)) d.prevClose = pc; d.priceTime = t; d.liveNote = null; d.quoteFrom = QUOTES.built;
  const lastT = d.hist[d.hist.length - 1][0];
  if (new Date(t * 1000).toDateString() === new Date(lastT * 1000).toDateString()) d.hist[d.hist.length - 1] = [lastT, p]; else if (t > lastT) d.hist.push([t, p]);
  return d;
}
async function loadQuotes(force) { try { QUOTES = await getJSON(force ? bust(DATA + 'quotes.json') : DATA + 'quotes.json'); } catch { } }
function setStatus(extra) {
  const el = $('#live'); if (!el) return;
  const ts = META ? Math.max(META.quotes || 0, META.full || 0) : (QUOTES && QUOTES.built);
  el.querySelector('.st').innerHTML = (ts ? `Updated <b>${tIST(ts)} IST</b>` : 'Update time n/a') + ` · checking every minute${extra ? ' · ' + extra : ''}`;
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
    if (run.conclusion !== 'success') return done(`<span class="dn">update ${esc(run.conclusion)}</span> <a href="${esc(run.html_url)}" target="_blank" rel="noopener">log</a>`);
    for (let i = 0; i < 6; i++) { const before = META && META.quotes; await checkMeta(true); if (META && META.quotes !== before) break; await new Promise(r => setTimeout(r, 5000)); }
    done('✔ updated just now');
  } catch (e) { done(`<span class="dn">${esc(e.message)}</span>`); }
}
$('#refBtn').onclick = () => checkMeta(true);
$('#updBtn').onclick = updateNow;
document.querySelectorAll('[data-tokset]').forEach(b => b.onclick = () => { $('#tokHelp').close(); $('#setBtn').click(); });
// boot: overlay quotes before first render
const _openSym = openSym;
openSym = async function (sym, viaAV) { if (!QUOTES) await loadQuotes(false); return _openSym(sym, viaAV); };
checkMeta(false);
