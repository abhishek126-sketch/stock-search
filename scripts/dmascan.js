'use strict';
// DMA setups scan (data job, after nsedaily.js so the official close and NSE volumes are in): every Indian stock in
// data/s -> data/dma.json with the stocks meeting "Best" (price > 50 DMA > 200 DMA, volume > 1.5x its 50-day average)
// and "Strongest" (also price > 20 DMA > 50 DMA and a golden cross within the last 60 sessions). The rules and all the
// error handling live in ../dmasetup.js - the same code the app runs for the line on the stock page.
const fs = require('fs'), path = require('path');
const { screenDmaSetups, rowsFromAppDoc, DEFAULTS } = require('../dmasetup.js');
const OUT = process.env.DATA_DIR || path.join(__dirname, '..', 'data'), MIN_TOV = 1e7;   // liquid = avg turnover >= Rs 1 Cr a day

function main() {
  let S = []; try { S = JSON.parse(fs.readFileSync(path.join(OUT, 'summary.json'), 'utf8')).rows || []; } catch { }
  const meta = Object.fromEntries(S.map(r => [r.s, r]));
  const cnt = { screened: 0, short: 0, stale: 0, other: 0, best: 0, strongest: 0, liquidBest: 0, liquidStrongest: 0 }, list = [], asOfs = {};
  for (const f of fs.readdirSync(path.join(OUT, 's'))) {
    if (!/\.(NS|BO)\.json$/.test(f)) continue;
    const sym = f.slice(0, -5), m = meta[sym] || {};
    if (m.cap && m.cap.startsWith('ETF')) continue;
    let d; try { d = JSON.parse(fs.readFileSync(path.join(OUT, 's', f), 'utf8')); } catch { cnt.other++; continue; }
    if (d.etf) continue;
    const r = screenDmaSetups(rowsFromAppDoc(d), { symbol: sym }); cnt.screened++;
    if (!r.ok) { if (r.error === 'INSUFFICIENT_HISTORY') cnt.short++; else cnt.other++; continue; }
    if (r.warnings.some(w => /days old/.test(w))) { cnt.stale++; continue; }       // suspended / not trading: no setup
    asOfs[r.asOf] = (asOfs[r.asOf] || 0) + 1;
    if (!r.setups.best) continue;
    const liquid = r.volume.avgTurnover >= MIN_TOV;
    cnt.best++; cnt.liquidBest += liquid; if (r.setups.strongest) { cnt.strongest++; cnt.liquidStrongest += liquid; }
    list.push({ s: sym, n: m.n || d.name || sym, cap: m.cap || '', sec: m.sec || '', ind: m.ind || '', st: r.setups.strongest ? 'strongest' : 'best',
      p: r.price, d20: r.dma.d20, d50: r.dma.d50, d200: r.dma.d200, vr: r.volume.ratio, tov: r.volume.avgTurnover, liq: liquid ? 1 : 0,
      gc: r.goldenCross.present ? r.goldenCross.date : null, gcAgo: r.goldenCross.sessionsAgo, asOf: r.asOf });
  }
  // strongest first, then by how far today's volume is above normal
  list.sort((a, b) => (b.st === 'strongest') - (a.st === 'strongest') || b.vr - a.vr);
  const asOf = Object.entries(asOfs).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const out = { built: Math.floor(Date.now() / 1000), asOf, rules: { ...DEFAULTS, minTurnover: MIN_TOV }, cnt, list };
  fs.writeFileSync(path.join(OUT, 'dma.json'), JSON.stringify(out));
  console.log('DMA setups:', JSON.stringify(cnt), 'as of', asOf);
}
if (require.main === module) main();
module.exports = { main };
