// 1D / 1W intraday charts from data/i/<SYM>.json (built by the quotes workflow every 5 min in market hours).
const INTRA = {};
async function loadIntra(sym) {
  const c = INTRA[sym]; if (c && Date.now() - c.at < 120000) return c.d;
  try { const d = await getJSON(DATA + 'i/' + encodeURIComponent(sym) + '.json?t=' + Math.floor(Date.now() / 120000)); INTRA[sym] = { d, at: Date.now() }; return d; } catch { INTRA[sym] = { d: null, at: Date.now() }; return null; }
}
const IST = { timeZone: 'Asia/Kolkata' }, ET = { timeZone: 'America/New_York' };
const tfmt = (t, z) => new Date(t * 1000).toLocaleTimeString('en-GB', { ...z, hour: '2-digit', minute: '2-digit' });
const dfmt = t => new Date(t * 1000).toLocaleDateString('en-GB', { ...IST, weekday: 'short', day: 'numeric' });
const _drawDaily = drawChart;
drawChart = function () {
  if (RANGE !== '1D' && RANGE !== '1W') return _drawDaily();
  const svg = $('#chart'); if (!svg || !CUR) return; const sym = CUR.symbol, rr = RANGE;
  if (!INTRA[sym]) { svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#64748b" font-size="13">Loading intraday…</text>'; $('#rchg').textContent = ''; loadIntra(sym).then(() => { if (CUR && CUR.symbol === sym && RANGE === rr) drawChart(); }); return; }
  const I = INTRA[sym].d, us = I && !/Asia\/(Kolkata|Calcutta)/.test(I.tz || '');
  const W = svg.clientWidth || 600, H = 260, pad = { l: 8, r: 54, t: 10, b: 22 }; svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const pts = I ? (rr === '1D' ? I.d1 : I.w) : null;
  if (!pts || pts.length < 2) { svg.innerHTML = `<text x="50%" y="50%" text-anchor="middle" fill="#64748b" font-size="13">Intraday data not available yet for this stock</text>`; $('#rchg').textContent = 'Intraday: not available (it is built every 5 min during market hours).'; return; }
  // x-scale: 1D = clock time over the session (gaps stay visible as empty space); 1W = bar index (overnight/weekend gaps collapsed, day separators drawn)
  let xs, x0, x1;
  if (rr === '1D') { x0 = I.ses ? Math.min(I.ses[0], pts[0][0]) : pts[0][0]; x1 = I.ses ? Math.max(I.ses[1], last(pts)[0]) : last(pts)[0]; xs = pts.map(p => p[0]); }
  else { xs = pts.map((p, i) => i); x0 = 0; x1 = pts.length - 1; }
  const vals = pts.map(p => p[1]), ref = rr === '1D' && isNum(I.pc) ? I.pc : null;
  let lo = Math.min(...vals, ...(ref ? [ref] : [])), hi = Math.max(...vals, ...(ref ? [ref] : [])); const pd = (hi - lo) * 0.06 || 1; lo -= pd; hi += pd;
  const X = v => pad.l + (W - pad.l - pad.r) * (v - x0) / (x1 - x0 || 1), Y = v => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
  // break the line across gaps > 20 min within 1D (halts / missing bars)
  let path = ''; pts.forEach((p, i) => { const brk = i && rr === '1D' && p[0] - pts[i - 1][0] > 1200; path += (i && !brk ? 'L' : 'M') + X(xs[i]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); });
  const base = ref ?? vals[0], up = last(vals) >= base, col = up ? '#15803d' : '#b91c1c';
  let g = ''; for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, y = Y(v); g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" stroke="#e2e8f0"/><text x="${W - pad.r + 4}" y="${y + 4}" font-size="10" fill="#64748b">${v >= 1000 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(v < 10 ? 2 : 1)}</text>`; }
  if (rr === '1D') { for (let i = 0; i <= 3; i++) { const t = x0 + (x1 - x0) * i / 3; g += `<text x="${Math.min(Math.max(X(t), pad.l), W - pad.r - 30)}" y="${H - 6}" font-size="10" fill="#64748b" text-anchor="${i === 0 ? 'start' : 'middle'}">${tfmt(t, IST)}</text>`; } }
  else { let pd0 = null; pts.forEach((p, i) => { const dk = new Date((p[0] + I.off) * 1000).toISOString().slice(0, 10); if (dk !== pd0) { pd0 = dk; const x = X(i); if (i) g += `<line x1="${x}" x2="${x}" y1="${pad.t}" y2="${H - pad.b}" stroke="#cbd5e1" stroke-dasharray="2 3"/>`; g += `<text x="${Math.min(x + 3, W - pad.r - 30)}" y="${H - 6}" font-size="10" fill="#64748b">${new Date((p[0] + I.off) * 1000).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric' })}</text>`; } }); }
  const refl = ref ? `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(ref)}" y2="${Y(ref)}" stroke="#475569" stroke-dasharray="5 4" stroke-width="1"/><text x="${pad.l + 2}" y="${Y(ref) - 4}" font-size="10" fill="#475569">Prev close ${fmtP(ref, CUR.currency)}</text>` : '';
  const fill = rr === '1W' ? `<path d="${path}L${X(x1)} ${H - pad.b}L${X(x0)} ${H - pad.b}Z" fill="${col}" opacity=".08"/>` : '';
  svg.innerHTML = `${g}${fill}${refl}<path d="${path}" fill="none" stroke="${col}" stroke-width="1.8"/><g id="cx" style="display:none"><line id="cxl" y1="${pad.t}" y2="${H - pad.b}" stroke="#94a3b8" stroke-dasharray="3 3"/><circle id="cxc" r="4" fill="${col}"/></g>`;
  const ch = last(vals) / base - 1, zl = us ? 'times IST (ET in tooltip)' : 'times IST';
  $('#rchg').innerHTML = `${rr} change: ${sgnPct(ch)}${ref ? ' vs previous close' : ''} · ${rr === '1D' ? '5-min' : '30-min'} bars, market hours only, ${zl} · as of ${new Date(I.asOf * 1000).toLocaleString('en-IN', { ...IST, dateStyle: 'medium', timeStyle: 'short' })} IST`;
  const tip = $('#tip');
  const move = e => { const r = svg.getBoundingClientRect(), x = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) * W / r.width;
    let best = 0, bd = Infinity; xs.forEach((v, i) => { const dd = Math.abs(X(v) - x); if (dd < bd) { bd = dd; best = i; } });
    const p = pts[best]; $('#cx').style.display = ''; ['x1', 'x2'].forEach(a => $('#cxl').setAttribute(a, X(xs[best]))); $('#cxc').setAttribute('cx', X(xs[best])); $('#cxc').setAttribute('cy', Y(p[1]));
    tip.innerHTML = `${rr === '1W' ? dfmt(p[0]) + ' ' : ''}${tfmt(p[0], IST)} IST${us ? ' (' + tfmt(p[0], ET) + ' ET)' : ''}: <b>${fmtP(p[1], CUR.currency)}</b> ${sgnPct(p[1] / base - 1)}`; };
  svg.onmousemove = move; svg.ontouchstart = svg.ontouchmove = move; svg.onmouseleave = () => { $('#cx').style.display = 'none'; tip.innerHTML = ''; };
};
