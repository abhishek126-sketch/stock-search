'use strict';
// ===== Price alerts: local copy + alerts.json on the repo's 'alerts' branch (saved via workflow_dispatch with the
// existing "Update now" token — needs only Actions: Read and write). The quotes job checks them every 5 min and
// pushes to ntfy.sh/<topic>.
// Private mode (11 Nov 2026): the 'alerts' branch is public, and alerts.json used to hold the topic and the list in plain
// text (anyone could read them or send fake pushes). Now this device makes a key (LS alertsKey) that the user saves once
// as the repo secret ALERTS_KEY: the list is stored and sent as an AES-256-GCM box, and the topic is derived from the key
// (never stored or sent). Same scheme as scripts/alertbox.js + alerts.py. Until the user switches it on, the old mode runs.
const AL_RAW = 'https://raw.githubusercontent.com/abhishek126-sketch/stock-search/alerts/alerts.json';
// "1,200" / "1,00,000" (thousands commas) -> 1200 / 100000; "1200,50" (comma as decimal point on some keyboards) -> 1200.5;
// "₹ 1,200" ok. Anything else that isn't a plain number -> NaN (parseFloat alone read "1,200" as 1)
function parseAmount(s) {
  s = String(s || '').replace(/[₹$%\s]/g, '');
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');              // single comma + 1-2 digits = decimal comma
  else if (/^\d{1,3}(,\d{2,3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ''); // Indian or international digit grouping
  return /^(\d+\.?\d*|\.\d+)$/.test(s) ? parseFloat(s) : NaN;
}
const AT = { above: 'Price ≥', below: 'Price ≤', chgUp: 'Day change ≥ +', chgDn: 'Day change ≤ −' };
const newTopic = () => 'stocksearch-' + Array.from(crypto.getRandomValues(new Uint8Array(16)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
function AL() { const a = LS.get('alerts', null) || { topic: null, alerts: [] }; if (!a.topic) { a.topic = newTopic(); LS.set('alerts', a); } return a; }
// ---- private mode: key, derived topic, AES-GCM box {v:2, iv, ct} (base64) ----
const AK = () => LS.get('alertsKey', ''), AK_ON = () => !!AK() && LS.get('alertsKeyOk', false);
const ub64 = u => { let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
const b64u = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const newAlertsKey = () => 'ssk1_' + ub64(crypto.getRandomValues(new Uint8Array(24))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const akSha = async s => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
async function akTopic(k = AK()) { return 'ss-' + Array.from(await akSha('ntfy-topic|' + k), b => b.toString(16).padStart(2, '0')).join('').slice(0, 32); }
const akKey = async k => crypto.subtle.importKey('raw', await akSha('alerts-enc|' + k), 'AES-GCM', false, ['encrypt', 'decrypt']);
async function akEnc(obj, k = AK()) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await akKey(k), new TextEncoder().encode(JSON.stringify(obj)))); return { v: 2, iv: ub64(iv), ct: ub64(ct) }; }
async function akDec(bx, k = AK()) { const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u(bx.iv) }, await akKey(k), b64u(bx.ct)); return JSON.parse(new TextDecoder().decode(pt)); }
// null = the repo copy is encrypted but this device has no (working) key yet: its old local topic is no longer used
async function alertsTopic() { return AK_ON() ? akTopic() : AL_SRVENC ? null : AL().topic; }
// phone set-up link: <app>#ak=<key>. The part after # never leaves the device (browsers don't send it to servers);
// opening it stores the key, removes it from the address bar and history, and shows the Alerts page.
const akLink = () => location.origin + location.pathname + '#ak=' + AK();
function akFromHash() {
  const m = /^#ak=(ssk1_[A-Za-z0-9_-]{20,})$/.exec(location.hash); if (!m) return false;
  if (m[1] !== AK()) { LS.set('alertsKey', m[1]); LS.set('alertsKeyOk', false); }
  history.replaceState(null, '', location.pathname + location.search + '#alerts'); return true;
}
akFromHash();   // runs before app.js routes the hash (that waits for the stock list), so it lands on #alerts
addEventListener('hashchange', e => { if (akFromHash()) { e.stopImmediatePropagation(); showAlerts(); } }, true);
let AL_SYNC = '', AL_SRVENC = false;
async function alertsPull() {
  try {
    let srv = await getJSON1(AL_RAW + '?t=' + Date.now()); AL_SRVENC = !!srv && srv.v === 2;
    if (AL_SRVENC) {
      if (!AK()) { AL_SYNC = '🔒 The repo copy is encrypted — add your alerts key on this device (below) to sync it.'; return AL(); }
      try { srv = await akDec(srv); } catch { AL_SYNC = "⚠ The repo copy is encrypted with a different key than this device's."; return AL(); }
      if (!LS.get('alertsKeyOk', false)) LS.set('alertsKeyOk', true);   // the server wrote it with this key: setup is complete
    }
    const loc = AL(), byId = Object.fromEntries((srv.alerts || []).map(a => [a.id, a]));
    if (!LS.get('alerts', null) || (!loc.alerts.length && !LS.get('alertsSaved', 0))) { const ad = { topic: srv.topic || loc.topic, alerts: srv.alerts || [] }; LS.set('alerts', ad); return ad; }  // first run on this device: adopt
    loc.alerts.forEach(a => { const s = byId[a.id]; if (s && s.trig && (a.ver || 0) <= s.trig) { a.trig = s.trig; a.trigP = s.trigP; } });
    LS.set('alerts', loc); AL_SYNC = srv.updated ? 'Synced with repo copy (updated ' + new Date(srv.updated * 1000).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) + ')' : ''; return loc;
  } catch { AL_SYNC = 'Repo copy not created yet'; return AL(); }
}
async function alertsPush() {
  const a = AL(); LS.set('alertsSaved', Date.now());
  if (!LS.get('ghpat', '')) return 'Saved on this device only — add your GitHub token in ⚙ Settings so the server can check alerts and send push notifications.';
  try {
    const payload = AK_ON() ? await akEnc({ alerts: a.alerts }) : { topic: a.topic, alerts: a.alerts };
    await gh('/actions/workflows/alerts-save.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { alerts: JSON.stringify(payload) } }) });
    return '✔ Saved' + (AK_ON() ? ' (encrypted)' : '') + ' — the server copy updates in ~30 s.';
  }
  catch (e) { return '⚠ Saved on this device, but the repo copy could not be updated: ' + e.message; }
}
function curPrice(s) {
  const q = QUOTES && QUOTES.q && QUOTES.q[s]; if (!q) return [];
  return typeof prefQuote === 'function' ? prefQuote(s, q[0], q[1], q[2]) : q;
}
function hitAlert(a, p, pc) { const v = +a.v, chg = pc ? (p / pc - 1) * 100 : null; return a.type === 'above' ? p >= v : a.type === 'below' ? p <= v : a.type === 'chgUp' ? chg != null && chg >= v : chg != null && chg <= -Math.abs(v); }
const alDesc = a => `${AT[a.type]}${a.type.startsWith('chg') ? a.v + '%' : ' ' + fmtP(+a.v, a.s.match(/\.(NS|BO)$/) ? 'INR' : 'USD')}`;
// in-app notifications when the app is open (once per alert version)
function alertsLocalCheck() {
  const seen = LS.get('alertSeen', {}); let ch = false;
  AL().alerts.forEach(a => {
    const key = a.id + ':' + (a.ver || 0); if (seen[key]) return;
    const [p, pc] = curPrice(a.s); const fired = a.trig || (isNum(p) && hitAlert(a, p, pc)); if (!fired) return;
    seen[key] = Date.now(); ch = true; const msg = `${a.s.replace(/\.(NS|BO)$/, '')}: ${alDesc(a)} — now ${fmtP(isNum(p) ? p : a.trigP, a.s.match(/\.(NS|BO)$/) ? 'INR' : 'USD').replace(/<[^>]+>/g, '')}`;
    try { if ('Notification' in window && Notification.permission === 'granted') { const n = new Notification('🔔 Price alert', { body: msg, icon: 'icon.svg', tag: key }); n.onclick = () => { focus(); openSym(a.s); }; } } catch { }
    setStatus('🔔 ' + esc(msg));
  });
  if (ch) LS.set('alertSeen', seen);
}
function alertDialog(sym, id) {
  const A = AL(), a = A.alerts.find(x => x.id === id) || { s: sym, type: 'above', v: '' }, d = $('#alDlg');
  const [p] = curPrice(a.s); const ccy = a.s.match(/\.(NS|BO)$/) ? 'INR' : 'USD';
  d.innerHTML = `<h2 style="margin-top:0">🔔 ${id ? 'Edit' : 'Set'} alert — ${esc(a.s.replace(/\.(NS|BO)$/, ''))}</h2><p class="mut">Current price ${isNum(p) ? fmtP(p, ccy) : (CUR && CUR.symbol === a.s ? fmtP(CUR.price, ccy) : 'n/a')}</p>
  <label class="mut">Condition</label><select id="alT" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--line);font-size:15px;margin-bottom:8px">${Object.entries({ above: 'Price goes above', below: 'Price goes below', chgUp: "Day's change rises above +%", chgDn: "Day's change falls below −%" }).map(([k, l]) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
  <label class="mut">Value (${ccy === 'INR' ? '₹' : '$'} or %)</label><input type="text" inputmode="decimal" id="alV" value="${esc(a.v)}" placeholder="e.g. ${isNum(p) ? (p * 1.05).toFixed(0) : '100'}">
  <label class="mut" style="display:block;margin-top:8px">Note (optional)</label><input type="text" id="alN" value="${esc(a.note || '')}" maxlength="80">
  <p class="mut" id="alMsg"></p><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn sec" id="alX">Cancel</button><button class="btn" id="alS">Save alert</button></div>`;
  d.showModal(); $('#alX').onclick = () => d.close();
  $('#alS').onclick = async () => {
    const v = parseAmount($('#alV').value); if (!isFinite(v) || v <= 0) { $('#alMsg').textContent = 'Enter a positive number, e.g. 1200 or 1,200.50'; return; }
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
  const A = AL(), topic = await alertsTopic(), url = topic ? 'https://ntfy.sh/' + topic : '';
  const row = a => { const ccy = a.s.match(/\.(NS|BO)$/) ? 'INR' : 'USD', [p] = curPrice(a.s);
    return `<tr><td><a href="#" data-s="${esc(a.s)}">${esc(a.s.replace(/\.(NS|BO)$/, ''))}</a>${a.note ? `<br><small class="mut">${esc(a.note)}</small>` : ''}</td><td>${alDesc(a)}</td><td>${isNum(p) ? fmtP(p, ccy) : '–'}</td>
    <td>${a.trig ? `<span style="color:var(--warn)">🔔 Triggered ${new Date(a.trig * 1000).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}${a.trigP ? ' @ ' + fmtP(a.trigP, ccy) : ''}</span><br><button class="btn sec" data-rearm="${a.id}" style="padding:3px 8px;font-size:12px">Re-arm</button>` : '<span class="up">● Armed</span>'}</td>
    <td><button class="btn sec" data-edit="${a.id}" style="padding:3px 8px;font-size:12px">Edit</button> <button class="btn sec" data-del="${a.id}" style="padding:3px 8px;font-size:12px">Delete</button></td></tr>`; };
  v.innerHTML = `<div class="card"><a href="#" id="aback" class="mut">← Back</a><h2 style="margin-top:6px">🔔 Price alerts <span class="mut">(${A.alerts.length})</span></h2>
  ${A.alerts.length ? `<div class="tw"><table class="pt"><tr><th>Stock</th><th>Condition</th><th>Now</th><th>Status</th><th></th></tr>${A.alerts.map(row).join('')}</table></div>` : '<p class="mut">No alerts yet. Open any stock and tap <b>🔔 Set alert</b>.</p>'}
  <p class="mut" id="alStat">${esc(AL_SYNC)}</p>
  <p class="src">Checked by the server every ~5 min in market hours (every 3 h otherwise) against the latest quotes; each alert fires once until you re-arm it. While the app is open you also get an in-app notification.</p></div>
  ${privCard()}
  <div class="card"><h2>📲 Push notifications (ntfy)</h2>
  ${topic ? `<p>Your private topic: <code style="word-break:break-all" id="alTopic">${esc(topic)}</code> <button class="btn sec" id="alCopyT" style="padding:3px 8px;font-size:12px">Copy topic</button></p>
  <div class="links"><a class="btn" href="ntfy://ntfy.sh/${esc(topic)}">Open in ntfy app</a><a class="btn sec" href="${url}" target="_blank" rel="noopener">Open in browser</a><a class="btn sec" href="https://ntfy.sh/app" target="_blank" rel="noopener">Get the ntfy app</a><button class="btn sec" id="alTest">Send test push</button></div>
  <p class="mut"><b>On your phone:</b> install the free <b>ntfy</b> app (Android: Play Store / F-Droid; iPhone: App Store) → open it → tap <b>+</b> → <b>Topic name:</b> paste the topic above (leave “Use another server” off, so it uses ntfy.sh) → <b>Subscribe</b>. Then tap <b>Send test push</b> here. On Android, <b>Open in ntfy app</b> fills it in for you. Anyone who knows the topic could read these alerts, so don't share it.${AK_ON() ? ' <b>If you subscribed to an older topic</b> (starting <code>stocksearch-</code>), remove it in the ntfy app — it is no longer used.' : ''}</p>`
  : '<p class="doubt" style="text-decoration:none">🔒 Your alerts are private: this device needs your alerts key before it can show your push topic — open the phone set-up link from your other device, or paste the key in the card above.</p>'}
  ${'Notification' in window && Notification.permission !== 'granted' ? '<button class="btn sec" id="alPerm">Allow in-app notifications</button>' : ''}</div>`;
  $('#aback').onclick = e => { e.preventDefault(); goHome(); };
  const save = async () => { $('#alStat').textContent = 'Saving…'; const m = await alertsPush(); showAlerts().then(() => $('#alStat').textContent = m); };
  v.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { if (!confirm('Delete this alert?')) return; const X = AL(); X.alerts = X.alerts.filter(a => a.id !== b.dataset.del); LS.set('alerts', X); save(); });
  v.querySelectorAll('[data-rearm]').forEach(b => b.onclick = () => { const X = AL(), a = X.alerts.find(a => a.id === b.dataset.rearm); a.trig = a.trigP = null; a.ver = Math.floor(Date.now() / 1000); LS.set('alerts', X); save(); });
  v.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => alertDialog(null, b.dataset.edit));
  const ct = $('#alCopyT'); if (ct) ct.onclick = async () => { try { await navigator.clipboard.writeText(topic); ct.textContent = 'Copied'; } catch { ct.textContent = 'Select it by hand'; } };
  if ($('#alTest')) $('#alTest').onclick = async () => { try { await fetch(url, { method: 'POST', body: 'Test from Stock Search — push notifications are working.' }); $('#alStat').textContent = '✔ Test push sent to your topic.'; } catch (e) { $('#alStat').textContent = 'Test failed: ' + e.message; } };
  const pb = $('#alPerm'); if (pb) pb.onclick = () => Notification.requestPermission().then(() => showAlerts());
  privWire();
  window.scrollTo(0, 0);
}
// ---- private-mode setup card (Alerts page) ----
const SECRET_URL = 'https://github.com/abhishek126-sketch/stock-search/settings/secrets/actions/new';
function privCard() {
  const k = AK();
  if (AK_ON()) return `<div class="card"><h2>🔒 Private alerts: on</h2><p class="mut">${AL_SRVENC ? 'The copy on GitHub is encrypted with your key' : 'Switched on — the encrypted copy appears on GitHub after the next save (if it never does, check the <b>ALERTS_KEY</b> secret)'}; the push topic is made from the key and is never stored online.</p>
    <p><b>📱 Set up your phone:</b> <button class="btn sec" id="akLinkBtn" style="padding:4px 10px">Copy phone set-up link</button></p>
    <p class="mut">Send that link to your own phone privately (e.g. e-mail it to yourself) and open it there in the browser you use for this app (on iPhone: copy it, open the installed app → 🔔 Alerts → paste the key instead). Your phone then shows your topic and alert list. The link contains your key — treat it like a password and delete the message afterwards.</p>
    <details><summary class="mut">Or copy just the key</summary><p><code style="word-break:break-all" id="akShow">••••••••</code> <button class="btn sec" id="akReveal" style="padding:3px 8px;font-size:12px">Show</button> <button class="btn sec" id="akCopy" style="padding:3px 8px;font-size:12px">Copy</button></p></details></div>`;
  if (AL_SRVENC && !AK_ON()) return `<div class="card" style="border:2px solid var(--warn)"><h2>🔒 Add your alerts key to this device</h2>
    <p>${k ? '<b>The key on this device does not match your alerts.</b> ' : ''}Your alerts are private and locked with a key made on your other device. Open the <b>phone set-up link</b> from that device (🔔 Alerts → Copy phone set-up link), or paste the key here:</p>
    <p><input type="text" id="akPaste" placeholder="ssk1_…" style="width:100%"></p><button class="btn" id="akUse">Use this key</button><p class="mut" id="akMsg"></p></div>`;
  return `<div class="card" style="border:2px solid var(--warn)"><h2>🔒 Make your alerts private (recommended)</h2>
    <p>Right now your alert list and your push topic are stored in plain text in the app's public GitHub repo — anyone could read them or send fake alerts to your phone. This locks them with a key that only this app and your GitHub repo know.</p>
    <ol style="padding-left:18px">
      <li>${k ? 'Your key: <code style="word-break:break-all">' + esc(k) + '</code> <button class="btn sec" id="akCopy" style="padding:3px 8px;font-size:12px">Copy</button>' : '<button class="btn" id="akMake">Create my private key</button>'}</li>
      <li>Open <a href="${SECRET_URL}" target="_blank" rel="noopener">GitHub → repo Settings → Secrets → New secret</a>. <b>Name:</b> <code>ALERTS_KEY</code> · <b>Secret:</b> paste the key · <b>Add secret</b>.</li>
      <li><button class="btn" id="akOn" ${k ? '' : 'disabled'}>I've added it — switch on</button> Then subscribe to the new topic in the ntfy app (shown below once it's on).</li>
    </ol>
    <details><summary class="mut">Already set up on another device? Paste its key</summary><p><input type="text" id="akPaste" placeholder="ssk1_…" style="width:100%"></p><button class="btn sec" id="akUse">Use this key</button></details>
    <p class="mut" id="akMsg"></p></div>`;
}
function privWire() {
  const m = t => { const e = $('#akMsg'); if (e) e.textContent = t; };
  const mk = $('#akMake'); if (mk) mk.onclick = () => { LS.set('alertsKey', newAlertsKey()); showAlerts(); };
  const cp = $('#akCopy'); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(AK()); cp.textContent = 'Copied'; } catch { cp.textContent = 'Copy failed — select it by hand'; } };
  const lk = $('#akLinkBtn'); if (lk) lk.onclick = async () => { try { await navigator.clipboard.writeText(akLink()); lk.textContent = 'Link copied'; } catch { lk.textContent = 'Copy failed'; } };
  const rv = $('#akReveal'); if (rv) rv.onclick = () => { $('#akShow').textContent = AK(); rv.remove(); };
  const on = $('#akOn'); if (on) on.onclick = async () => {
    if (!LS.get('ghpat', '')) { m('Add your GitHub token in ⚙ Settings first — it is needed to save alerts to the repo.'); return; }
    LS.set('alertsKeyOk', true); m('Saving your alerts encrypted…'); const r = await alertsPush(); await showAlerts(); const st = $('#alStat'); if (st) st.textContent = r;
  };
  const us = $('#akUse'); if (us) us.onclick = async () => {
    const k = ($('#akPaste').value || '').trim(); if (!/^ssk1_[A-Za-z0-9_-]{20,}$/.test(k)) { m('That does not look like an alerts key (it starts with ssk1_).'); return; }
    LS.set('alertsKey', k); LS.set('alertsKeyOk', false); LS.set('alertsSaved', 0); const X = AL(); X.alerts = []; LS.set('alerts', X); await showAlerts();
    m(AK_ON() ? '✔ Key works — alerts loaded from the encrypted copy.' : 'Key saved. If the encrypted copy does not load, check the key.');
  };
}
// hooks: refresh check after every quotes load; stock-page button
const _loadQuotesA = loadQuotes; loadQuotes = async f => { await _loadQuotesA(f); alertsLocalCheck(); };
alertsPull().then(alertsLocalCheck);
document.addEventListener('click', e => { const b = e.target.closest('#alBtn'); if (b && CUR) alertDialog(CUR.symbol); });
