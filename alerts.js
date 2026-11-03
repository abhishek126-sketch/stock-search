'use strict';
// ===== Price alerts: local copy + alerts.json on the repo's 'alerts' branch (saved via workflow_dispatch with the
// existing "Update now" token — needs only Actions: Read and write). The quotes job checks them every 5 min and
// pushes to ntfy.sh/<topic>. Topic = random 22-char name generated here (not a credential; stored in alerts.json).
const AL_RAW = 'https://raw.githubusercontent.com/abhishek126-sketch/stock-search/alerts/alerts.json';
const AT = { above: 'Price ≥', below: 'Price ≤', chgUp: 'Day change ≥ +', chgDn: 'Day change ≤ −' };
const newTopic = () => 'stocksearch-' + Array.from(crypto.getRandomValues(new Uint8Array(16)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
function AL() { const a = LS.get('alerts', null) || { topic: null, alerts: [] }; if (!a.topic) { a.topic = newTopic(); LS.set('alerts', a); } return a; }
let AL_SYNC = '';
async function alertsPull() {
  try {
    const srv = await getJSON1(AL_RAW + '?t=' + Date.now()), loc = AL(), byId = Object.fromEntries((srv.alerts || []).map(a => [a.id, a]));
    if (!LS.get('alerts', null) || (!loc.alerts.length && !LS.get('alertsSaved', 0))) { LS.set('alerts', srv); return srv; }  // first run on this device: adopt
    loc.alerts.forEach(a => { const s = byId[a.id]; if (s && s.trig && (a.ver || 0) <= s.trig) { a.trig = s.trig; a.trigP = s.trigP; } });
    LS.set('alerts', loc); AL_SYNC = srv.updated ? 'Synced with repo copy (updated ' + new Date(srv.updated * 1000).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) + ')' : ''; return loc;
  } catch { AL_SYNC = 'Repo copy not created yet'; return AL(); }
}
async function alertsPush() {
  const a = AL(); LS.set('alertsSaved', Date.now());
  if (!LS.get('ghpat', '')) return 'Saved on this device only — add your GitHub token in ⚙ Settings so the server can check alerts and send push notifications.';
  try { await gh('/actions/workflows/alerts-save.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { alerts: JSON.stringify({ topic: a.topic, alerts: a.alerts }) } }) }); return '✔ Saved — the server copy updates in ~30 s.'; }
  catch (e) { return '⚠ Saved on this device, but the repo copy could not be updated: ' + e.message; }
}
function curPrice(s) {
  const q = QUOTES && QUOTES.q && QUOTES.q[s]; if (!q) return [];
  return typeof prefQuote === 'function' ? prefQuote(s, q[0], q[1], q[2]) : q;
}
function hitAlert(a, p, pc) { const v = +a.v, chg = pc ? (p / pc - 1) * 100 : null; return a.type === 'above' ? p >= v : a.type === 'below' ? p <= v : a.type === 'chgUp' ? chg != null && chg >= v : chg != null && chg <= -Math.abs(v); }
const alDesc = a => `${AT[a.type]}${a.type.startsWith('chg') ? a.v + '%' : ' ' + fmtP(+a.v, a.s.endsWith('.NS') ? 'INR' : 'USD')}`;
// in-app notifications when the app is open (once per alert version)
function alertsLocalCheck() {
  const seen = LS.get('alertSeen', {}); let ch = false;
  AL().alerts.forEach(a => {
    const key = a.id + ':' + (a.ver || 0); if (seen[key]) return;
    const [p, pc] = curPrice(a.s); const fired = a.trig || (isNum(p) && hitAlert(a, p, pc)); if (!fired) return;
    seen[key] = Date.now(); ch = true; const msg = `${a.s.replace(/\.NS$/, '')}: ${alDesc(a)} — now ${fmtP(isNum(p) ? p : a.trigP, a.s.endsWith('.NS') ? 'INR' : 'USD').replace(/<[^>]+>/g, '')}`;
    try { if ('Notification' in window && Notification.permission === 'granted') { const n = new Notification('🔔 Price alert', { body: msg, icon: 'icon.svg', tag: key }); n.onclick = () => { focus(); openSym(a.s); }; } } catch { }
    setStatus('🔔 ' + esc(msg));
  });
  if (ch) LS.set('alertSeen', seen);
}
function alertDialog(sym, id) {
  const A = AL(), a = A.alerts.find(x => x.id === id) || { s: sym, type: 'above', v: '' }, d = $('#alDlg');
  const [p] = curPrice(a.s); const ccy = a.s.endsWith('.NS') ? 'INR' : 'USD';
  d.innerHTML = `<h2 style="margin-top:0">🔔 ${id ? 'Edit' : 'Set'} alert — ${esc(a.s.replace(/\.NS$/, ''))}</h2><p class="mut">Current price ${isNum(p) ? fmtP(p, ccy) : (CUR && CUR.symbol === a.s ? fmtP(CUR.price, ccy) : 'n/a')}</p>
  <label class="mut">Condition</label><select id="alT" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);font-size:15px;margin-bottom:8px">${Object.entries({ above: 'Price goes above', below: 'Price goes below', chgUp: "Day's change rises above +%", chgDn: "Day's change falls below −%" }).map(([k, l]) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
  <label class="mut">Value (${ccy === 'INR' ? '₹' : '$'} or %)</label><input type="text" inputmode="decimal" id="alV" value="${esc(a.v)}" placeholder="e.g. ${isNum(p) ? (p * 1.05).toFixed(0) : '100'}">
  <label class="mut" style="display:block;margin-top:8px">Note (optional)</label><input type="text" id="alN" value="${esc(a.note || '')}" maxlength="80">
  <p class="mut" id="alMsg"></p><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn sec" id="alX">Cancel</button><button class="btn" id="alS">Save alert</button></div>`;
  d.showModal(); $('#alX').onclick = () => d.close();
  $('#alS').onclick = async () => {
    const v = parseFloat($('#alV').value); if (!isFinite(v) || v <= 0) { $('#alMsg').textContent = 'Enter a positive number.'; return; }
    const A2 = AL(), n = { id: a.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6), s: a.s, type: $('#alT').value, v, note: $('#alN').value.trim() || null, ver: Math.floor(Date.now() / 1000), trig: null, trigP: null };
    A2.alerts = A2.alerts.filter(x => x.id !== n.id).concat(n); LS.set('alerts', A2);
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    $('#alS').disabled = true; $('#alMsg').textContent = 'Saving…'; const m = await alertsPush(); $('#alMsg').textContent = m; $('#alS').disabled = false;
    setTimeout(() => { d.close(); if (location.hash === '#alerts') showAlerts(); }, 1600);
  };
}
async function showAlerts() {
  const v = $('#view'); $('#home').hidden = true; v.hidden = false; CUR = null; updFav(); navTo('#alerts');
  v.innerHTML = '<div class="card"><p class="mut">Loading alerts…</p></div>'; await alertsPull(); if (!QUOTES) await loadQuotes(false);
  const A = AL(), url = 'https://ntfy.sh/' + A.topic;
  const row = a => { const ccy = a.s.endsWith('.NS') ? 'INR' : 'USD', [p] = curPrice(a.s);
    return `<tr><td><a href="#" data-s="${esc(a.s)}">${esc(a.s.replace(/\.NS$/, ''))}</a>${a.note ? `<br><small class="mut">${esc(a.note)}</small>` : ''}</td><td>${alDesc(a)}</td><td>${isNum(p) ? fmtP(p, ccy) : '–'}</td>
    <td>${a.trig ? `<span style="color:var(--warn)">🔔 Triggered ${new Date(a.trig * 1000).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}${a.trigP ? ' @ ' + fmtP(a.trigP, ccy) : ''}</span><br><button class="btn sec" data-rearm="${a.id}" style="padding:3px 8px;font-size:12px">Re-arm</button>` : '<span class="up">● Armed</span>'}</td>
    <td><button class="btn sec" data-edit="${a.id}" style="padding:3px 8px;font-size:12px">Edit</button> <button class="btn sec" data-del="${a.id}" style="padding:3px 8px;font-size:12px">Delete</button></td></tr>`; };
  v.innerHTML = `<div class="card"><a href="#" id="aback" class="mut">← Back</a><h2 style="margin-top:6px">🔔 Price alerts <span class="mut">(${A.alerts.length})</span></h2>
  ${A.alerts.length ? `<div class="tw"><table class="pt"><tr><th>Stock</th><th>Condition</th><th>Now</th><th>Status</th><th></th></tr>${A.alerts.map(row).join('')}</table></div>` : '<p class="mut">No alerts yet. Open any stock and tap <b>🔔 Set alert</b>.</p>'}
  <p class="mut" id="alStat">${esc(AL_SYNC)}</p>
  <p class="src">Checked by the server every ~5 min in market hours (every 3 h otherwise) against the latest quotes; each alert fires once until you re-arm it. While the app is open you also get an in-app notification.</p></div>
  <div class="card"><h2>📲 Push notifications (ntfy)</h2><p>Your private topic: <code style="word-break:break-all">${esc(A.topic)}</code></p>
  <div class="links"><a class="btn" href="${url}" target="_blank" rel="noopener">Open in ntfy</a><a class="btn sec" href="https://ntfy.sh/app" target="_blank" rel="noopener">Get the ntfy app</a><button class="btn sec" id="alTest">Send test push</button></div>
  <p class="mut">Install the free <b>ntfy</b> app (Android: Play Store / F-Droid; iPhone: App Store), tap <b>+</b>, and subscribe to the topic above (server ntfy.sh). Anyone who knows the topic name could read these alerts, so don't share it.</p>
  ${'Notification' in window && Notification.permission !== 'granted' ? '<button class="btn sec" id="alPerm">Allow in-app notifications</button>' : ''}</div>`;
  $('#aback').onclick = e => { e.preventDefault(); goHome(); };
  const save = async () => { $('#alStat').textContent = 'Saving…'; const m = await alertsPush(); showAlerts().then(() => $('#alStat').textContent = m); };
  v.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { if (!confirm('Delete this alert?')) return; const X = AL(); X.alerts = X.alerts.filter(a => a.id !== b.dataset.del); LS.set('alerts', X); save(); });
  v.querySelectorAll('[data-rearm]').forEach(b => b.onclick = () => { const X = AL(), a = X.alerts.find(a => a.id === b.dataset.rearm); a.trig = a.trigP = null; a.ver = Math.floor(Date.now() / 1000); LS.set('alerts', X); save(); });
  v.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => alertDialog(null, b.dataset.edit));
  $('#alTest').onclick = async () => { try { await fetch(url, { method: 'POST', body: 'Test from Stock Search — push notifications are working.' }); $('#alStat').textContent = '✔ Test push sent to your topic.'; } catch (e) { $('#alStat').textContent = 'Test failed: ' + e.message; } };
  const pb = $('#alPerm'); if (pb) pb.onclick = () => Notification.requestPermission().then(() => showAlerts());
  window.scrollTo(0, 0);
}
// hooks: refresh check after every quotes load; stock-page button
const _loadQuotesA = loadQuotes; loadQuotes = async f => { await _loadQuotesA(f); alertsLocalCheck(); };
alertsPull().then(alertsLocalCheck);
document.addEventListener('click', e => { const b = e.target.closest('#alBtn'); if (b && CUR) alertDialog(CUR.symbol); });
