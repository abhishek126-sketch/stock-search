#!/usr/bin/env node
'use strict';
// 🧭 Daily plan (the user's swing-trading framework, rules in scripts/planrules.js). Run by data.yml every evening after
// swing.js / momentum.js / dmascan.js, on the official closing prices. Writes data/plan.json:
//   market   indices (Nifty 50, Next 50, Bank, Midcap 150, Smallcap 100, India VIX), breadth, sectors, FII/DII index-F&O
//            positions (NSE participant-wise open interest, public archive file), regime + exposure cap
//   buy      stocks that pass every rule (grade A+/A, setup score > 75, reward:risk ≥ 2) with entry / stops / targets
//   watch    strong trends that are not buyable yet, with what to wait for
//   avoid    stocks the app's other scans show that fail a rule, with the reasons
//   g        compact result for every stock checked (stock-page card)
// Capital-dependent parts (how many positions, quantities, portfolio risk) are done in the app (planui.js).
const fs = require('fs'), path = require('path');
const P = require('./planrules.js');
const OUT = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const now = Math.floor(Date.now() / 1000), IST = 19800;
const istDate = t => new Date((t + IST) * 1000).toISOString().slice(0, 10);
const readJ = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch { return d; } };
const med = a => { const b = a.filter(x => x != null && isFinite(x)).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
const r2 = P.r2;
const UA = { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' };
async function get(url, tries = 2) { let e; for (let i = 0; i < tries; i++) { try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25000) }); if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); } catch (x) { e = x; await new Promise(r => setTimeout(r, 1500)); } } throw e; }

const INDICES = [['^NSEI', 'Nifty 50'], ['^NSMIDCP', 'Nifty Next 50'], ['^NSEBANK', 'Bank Nifty'], ['NIFTYMIDCAP150.NS', 'Nifty Midcap 150'], ['NIFTYSMLCAP250.NS', 'Nifty Smallcap 250'], ['^INDIAVIX', 'India VIX']];
async function indices() {
  const out = [];
  for (const [sym, name] of INDICES) {
    try {
      const ch = JSON.parse(await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1d`)).chart.result[0];
      const q = ch.indicators.quote[0], pts = ch.timestamp.map((t, i) => [t, q.close[i], q.high[i]]).filter(x => x[1] != null);
      // Yahoo's daily candles can lag a session (e.g. after a holiday) while the quote is current: add / update the latest day
      const m = ch.meta || {}, lt = pts.length ? pts[pts.length - 1][0] : 0;
      if (m.regularMarketPrice && m.regularMarketTime) { if (istDate(m.regularMarketTime) > istDate(lt)) pts.push([m.regularMarketTime, m.regularMarketPrice, m.regularMarketDayHigh || m.regularMarketPrice]); else if (istDate(m.regularMarketTime) === istDate(lt)) pts[pts.length - 1][1] = m.regularMarketPrice; }
      if (pts.length < 220) { console.log("index", sym, "only", pts.length, "days - skipped"); continue; }
      const c = pts.map(x => x[1]), n = c.length - 1, e20 = P.emaS(c, 20), e50 = P.emaS(c, 50), e200 = P.emaS(c, 200), R = P.rsiS(c);
      const hi52 = Math.max(...pts.slice(-250).map(x => x[2] || x[1]));
      out.push({ sym, name, t: pts[n][0], c, close: r2(c[n]), chg: r2((c[n] / c[n - 1] - 1) * 100), e20: r2(e20[n]), e50: r2(e50[n]), e200: r2(e200[n]), rsi: Math.round(R[n]), hi52: r2(hi52), offHi: r2((c[n] / hi52 - 1) * 100), r1m: r2((c[n] / c[n - 21] - 1) * 100), v5ago: c[n - 5] });
    } catch (e) { console.log('index', sym, e.message); }
  }
  return out;
}

// NSE participant-wise open interest (public end-of-day archive file): FII / DII / Pro / Client positions in index F&O
async function fiiOI(lastDay) {
  const hp = path.join(OUT, 'fiioi.json'), H = readJ('fiioi.json', { rows: [] });
  for (let k = 0; k < 6; k++) {
    const d = new Date(Date.parse(lastDay + 'T12:00:00Z') - k * 864e5); if ([0, 6].includes(d.getUTCDay())) continue;
    const iso = d.toISOString().slice(0, 10), dd = iso.slice(8, 10) + iso.slice(5, 7) + iso.slice(0, 4);
    if (H.rows.some(r => r.d === iso)) break;   // already have the latest available day
    let csv = null; try { csv = await get(`https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_${dd}.csv`); } catch (e) { console.log('fii oi', iso, e.message); continue; }
    if (!csv) continue;
    const lines = csv.trim().split(/\r?\n/).map(l => l.split(',').map(x => x.replace(/"/g, '').trim()));
    const hi = lines.findIndex(l => /client type/i.test(l[0])); if (hi < 0) continue;
    const head = lines[hi].map(h => h.toLowerCase()), col = n => head.findIndex(h => h.replace(/\s+/g, ' ') === n);
    const ix = { fl: col('future index long'), fs: col('future index short'), cl: col('option index call long'), cs: col('option index call short'), pl: col('option index put long'), ps: col('option index put short') };
    const row = t => { const l = lines.find(x => x[0].toUpperCase() === t); return l ? Object.fromEntries(Object.entries(ix).map(([k, i]) => [k, +l[i] || 0])) : null; };
    const fii = row('FII'), dii = row('DII'); if (!fii) continue;
    H.rows.push({ d: iso, fii, dii }); console.log('fii oi: got', iso); break;
  }
  H.rows = H.rows.sort((a, b) => a.d < b.d ? -1 : 1).slice(-40); fs.writeFileSync(hp, JSON.stringify(H));
  const L = H.rows[H.rows.length - 1], Pv = H.rows[H.rows.length - 2]; if (!L) return null;
  const sum = r => r && { long: r.fl, short: r.fs, net: r.fl - r.fs, longPct: r2(r.fl / Math.max(1, r.fl + r.fs) * 100), callNet: r.cl - r.cs, putNet: r.pl - r.ps };
  return { d: L.d, fii: sum(L.fii), dii: sum(L.dii), prev: Pv ? { d: Pv.d, fii: sum(Pv.fii) } : null, hist: H.rows.slice(-20).map(r => [r.d, r2(r.fii.fl / Math.max(1, r.fii.fl + r.fii.fs) * 100)]) };
}

async function main() {
  const S = readJ('summary.json'); if (!S) throw new Error('summary.json missing');
  const stats = readJ('planstats.json'), ST = stats ? stats.by : null;
  const appTag = {}; const tag = (s, t) => (appTag[s] = appTag[s] || []).push(t);
  for (const x of (readJ('swing.json', {}).list || [])) if (x.st !== 'avoid') tag(x.s, 'Swing ' + x.t + ' (' + x.st + ')');
  for (const x of (readJ('momentum.json', {}).list || [])) tag(x.s, 'Earnings momentum');
  for (const x of (readJ('dma.json', {}).list || [])) if (x.liq) tag(x.s, 'DMA ' + x.st);

  // ---- market ----
  const IX = await indices(); const nif = IX.find(x => x.sym === '^NSEI'), vix = IX.find(x => x.sym === '^INDIAVIX');
  let niftyC = nif ? nif.c : null, niftyHi = nif ? nif.hi52 : null;
  if (!niftyC) { const m = readJ('market.json', {}); niftyC = ((m.IN || {}).hist || []).map(x => x[1]); niftyHi = Math.max(...niftyC.slice(-250)); }
  const niftyR3m = niftyC[niftyC.length - 1] / niftyC[niftyC.length - 64] - 1;

  // ---- pass 1: load NSE stocks, light metrics for breadth + industry strength ----
  const D = [];
  for (const row of S.rows) {
    if (!/\.NS$/.test(row.s) || String(row.cap || '').startsWith('ETF')) continue;
    let d; try { d = JSON.parse(fs.readFileSync(path.join(OUT, 's', row.s + '.json'), 'utf8')); } catch { continue; }
    if (!d.hist || d.hist.length < 260 || !d.ohlc || d.ohlc.length < 60) continue;
    if (now - d.hist[d.hist.length - 1][0] > 6 * 86400) continue;           // not trading recently
    const c = d.hist.map(h => h[1]), n = c.length - 1, vb = d.ohlc.slice(-50).map(x => x[5]).filter(v => v > 0);
    const tov = vb.length ? vb.reduce((s, v) => s + v, 0) / vb.length * c[n] : 0;
    const e20 = P.emaS(c, 20)[n], e50 = P.emaS(c, 50)[n], e200 = P.emaS(c, 200)[n];
    D.push({ row, d: { hist: d.hist, ohlc: d.ohlc, hl52: d.hl52, profile: { earnDates: d.profile && d.profile.earnDates }, sector: d.sector, industry: d.industry },
      tov, p: c[n], pc: c[n - 1], e20, e50, e200, r1m: c[n] / c[n - 21] - 1, r3m: c[n] / c[n - 63] - 1, ind: row.ind || d.industry || '', sec: row.sec || d.sector || '' });
  }
  const liq = D.filter(x => x.tov >= 5e7), frac = f => liq.length ? liq.filter(f).length / liq.length : null;
  const breadth = { n: liq.length, above20: r2(frac(x => x.p > x.e20)), above50: r2(frac(x => x.p > x.e50)), above200: r2(frac(x => x.p > x.e200)), aligned: r2(frac(x => x.p > x.e20 && x.e20 > x.e50 && x.e50 > x.e200)),
    adv: liq.filter(x => x.p > x.pc).length, dec: liq.filter(x => x.p < x.pc).length, r1m: { large: r2(med(liq.filter(x => x.row.cap === 'Large').map(x => x.r1m)) * 100), mid: r2(med(liq.filter(x => x.row.cap === 'Mid').map(x => x.r1m)) * 100), small: r2(med(liq.filter(x => x.row.cap === 'Small').map(x => x.r1m)) * 100) } };
  const G = {}; for (const x of liq) if (x.ind) (G[x.ind] = G[x.ind] || []).push(x);
  const inds = Object.entries(G).filter(([, a]) => a.length >= 6).map(([k, a]) => { const r1 = med(a.map(x => x.r1m)), r3 = med(a.map(x => x.r3m)), ab = a.filter(x => x.p > x.e50).length / a.length; return { ind: k, n: a.length, r1m: r2(r1 * 100), r3m: r2(r3 * 100), above50: r2(ab), sc: r1 * 0.4 + r3 * 0.4 + (ab - 0.5) * 0.2 }; }).sort((a, b) => b.sc - a.sc);
  const IR = {}; inds.forEach((x, i) => IR[x.ind] = { rank: i + 1, of: inds.length });
  const SG = {}; for (const x of liq) if (x.sec) (SG[x.sec] = SG[x.sec] || []).push(x);
  const secs = Object.entries(SG).filter(([, a]) => a.length >= 8).map(([k, a]) => ({ sec: k, n: a.length, r1m: r2(med(a.map(x => x.r1m)) * 100), r3m: r2(med(a.map(x => x.r3m)) * 100), above50: r2(a.filter(x => x.p > x.e50).length / a.length) })).sort((a, b) => b.r3m - a.r3m);
  const regime = P.classifyMarket({ c: niftyC, hi52: niftyHi }, breadth, vix ? { v: vix.close, v5ago: vix.v5ago } : null);
  const lastDay = istDate(Math.max(...D.map(x => x.d.hist[x.d.hist.length - 1][0])));
  let oi = null; try { oi = await fiiOI(lastDay); } catch (e) { console.log('fii oi failed', e.message); }

  // ---- pass 2: evaluate every stock ----
  const ctx = { niftyR3m, stats: ST, regimeScore: regime.score, now };
  const res = [];
  for (const x of D) {
    if (x.tov < 1e7 && !appTag[x.row.s]) continue;                         // under ₹1 Cr/day: not worth a full check
    let X = null; try { X = JSON.parse(fs.readFileSync(path.join(OUT, 'x', x.row.s + '.json'), 'utf8')); } catch { }
    let o; try { o = P.evaluate(x.d, x.row, X, { ...ctx, ind: IR[x.ind] }); } catch (e) { console.log('plan eval', x.row.s, e.message); continue; }
    if (!o) continue; o.tags = appTag[x.row.s] || []; o.indRank = IR[x.ind] ? IR[x.ind].rank + '/' + IR[x.ind].of : null; res.push(o);
  }
  const strip = o => { const { hl, ...r } = o; return r; };
  const buy = res.filter(o => o.buy).sort((a, b) => b.conf - a.conf).slice(0, 40).map(strip);
  const watch = res.filter(o => o.pass && !o.buy && (P.RULES.buyGrades.includes(o.grade) || (o.grade === 'B' && o.ss > P.RULES.minSetupScore))).sort((a, b) => b.ts - a.ts || b.conf - a.conf).slice(0, 60).map(strip);
  const avoid = res.filter(o => !o.pass && (o.tags.length || (o.tovCr >= 10 && o.code.some(c => ['pump', 'surv', 'para'].includes(c)))))
    .sort((a, b) => b.tags.length - a.tags.length || b.tovCr - a.tovCr).slice(0, 60).map(o => ({ s: o.s, n: o.n, cap: o.cap, p: o.p, chg: o.chg, tags: o.tags, why: o.why, code: o.code, warn: o.warn, tovCr: o.tovCr }));
  const rejCount = {}; for (const o of res) if (!o.pass && o.tovCr >= 10) for (const c of o.code) rejCount[c] = (rejCount[c] || 0) + 1;
  const g = {}; for (const o of res) g[o.s] = o.pass ? [o.grade, o.setup, o.ss, o.conf, o.buy ? 1 : 0, o.ts] : ['-', 'none', 0, 0, 0, 0, o.code.join(',')];
  const ixOut = IX.map(({ c, v5ago, ...r }) => r);
  const asOf = lastDay, next = require('./swing.js').nextSession(Math.floor(Date.parse(asOf + 'T10:00:00Z') / 1000));
  const outp = { built: now, asOf, next, rules: P.RULES, market: { indices: ixOut, breadth, secs, indTop: inds.slice(0, 10), indBottom: inds.slice(-8).reverse(), regime, fiiOI: oi },
    stats: stats ? { from: stats.from, to: stats.to, stocks: stats.stocks, by: ST, built: stats.built } : null,
    counts: { checked: res.filter(o => o.tovCr >= 10).length, passed: res.filter(o => o.pass && o.tovCr >= 10).length, buy: buy.length, rej: rejCount },
    buy, watch, avoid, g };
  fs.writeFileSync(path.join(OUT, 'plan.json'), JSON.stringify(outp));
  console.log('plan:', asOf, '→', next, '| regime', regime.cls, regime.label, regime.score, '| checked', outp.counts.checked, '| buy', buy.length, buy.slice(0, 8).map(b => b.s.replace('.NS', '')).join(' '), '| watch', watch.length, '| avoid', avoid.length, '| FII OI', oi ? oi.d : 'none');
}
main().catch(e => { console.error('plan failed:', e); process.exit(1); });
