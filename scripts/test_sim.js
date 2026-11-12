#!/usr/bin/env node
'use strict';
// Tests for planport.js (costs, portfolio, fills, trade management), simengine.js and track.js (run by check.yml).
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const PP = require('../planport.js'), SE = require('./simengine.js');
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } else console.log('ok  ', m); };
const near = (a, b, e = 0.01) => Math.abs(a - b) <= e;

// costs, Zerodha: ₹10,000 buy = STT 10 + stamp 1.5 + exch/sebi 0.31 + GST 0.06 ≈ 11.87; sell adds the DP charge instead of stamp
const ZE = PP.BROKERS.zerodha, GR = PP.BROKERS.groww;
ok(near(PP.buyCost(10000, ZE), 11.87, 0.05), 'Zerodha buy cost of ₹10,000 ≈ ₹11.87 (' + PP.buyCost(10000, ZE).toFixed(2) + ')');
ok(near(PP.sellCost(10000, ZE), 10.37 + 15.93, 0.05), 'Zerodha sell cost of ₹10,000 ≈ ₹26.30 incl. DP (' + PP.sellCost(10000, ZE).toFixed(2) + ')');
// Groww: brokerage 0.1% (min ₹5, max ₹20) + GST; ₹10,000 buy = 10 + 1.5 + 0.33 + 10 + GST 1.86 ≈ 23.69; sell = 10 + 0.33 + 10 + 1.86 + DP 23.60 ≈ 45.79
ok(near(PP.buyCost(10000, GR), 23.69, 0.05), 'Groww buy cost of ₹10,000 ≈ ₹23.69 (' + PP.buyCost(10000, GR).toFixed(2) + ')');
ok(near(PP.sellCost(10000, GR), 45.79, 0.05), 'Groww sell cost of ₹10,000 ≈ ₹45.79 (' + PP.sellCost(10000, GR).toFixed(2) + ')');
ok(PP.brokerage(2000, GR) === 5 && PP.brokerage(50000, GR) === 20 && near(PP.brokerage(12000, GR), 12), 'Groww brokerage floor ₹5, cap ₹20, else 0.1%');
ok(PP.COSTS === GR && PP.costsFor('zerodha') === ZE && PP.costsFor('other', 20).brk === 20 && PP.brokerage(1e6, PP.costsFor('other', 20)) === 20, 'default = Groww; "other" = flat brokerage');
const IND = require('../indicators.js'), cd = IND.candle([0, 102, 110, 100, 108, 1]);
ok(cd && cd.cl === 80 && cd.body === 60 && cd.uw === 20 && cd.lw === 20 && cd.up, 'candle: close location 80%, body 60%, wicks 20/20 (' + JSON.stringify(cd) + ')');
ok(IND.candle([0, 100, 100, 100, 100, 0]) === null && IND.candle([0, 100, 101, 99, 100, 1], 98).cl === 0, 'candle: no range → null; official close overrides the bar');
ok(PP.maxPositions(30000) === 3 && PP.maxPositions(100000) === 5, 'positions by capital');

// portfolio: risk 1% of ₹1L = ₹1,000; R ₹50 → 20 shares; one per theme; exposure cap; cost check
const mk = (s, E, R, conf, theme) => ({ s, plan: { E, R, SL: E - R, T1: E + 2 * R, T3: E + 4 * R }, conf, theme });
let r = PP.buildPortfolio([mk('A', 500, 25, 80, 'X'), mk('B', 400, 20, 75, 'X'), mk('C', 300, 15, 70, 'Y')], { capital: 100000, riskPct: 1, maxRisk: 5, posPct: 25, exposure: 50 });
ok(r.picks.length === 2 && r.picks[0].s === 'A' && r.picks[1].s === 'C', 'one stock per sector theme (B skipped)');
ok(r.picks[0].q === 40 && r.picks[1].q === 66, 'quantity = min(risk ₹1,000 ÷ R, 25% per stock) → 40 and 66 (' + r.picks.map(p => p.q) + ')');
r = PP.buildPortfolio([mk('A', 500, 25, 80, 'X'), mk('C', 300, 15, 70, 'Y')], { capital: 100000, riskPct: 1, maxRisk: 5, posPct: 25, exposure: 25 });
ok(r.inv <= 25000 + 1, 'exposure cap 25% respected (invested ₹' + Math.round(r.inv) + ')');
r = PP.buildPortfolio([mk('T', 2000, 160, 80, 'X')], { capital: 30000, riskPct: 1, maxRisk: 5, posPct: 25, exposure: 50, maxCostR: 0.1 });
ok(!r.picks.length && /charges/.test(r.skipped[0][1]), 'tiny position whose charges eat > 10% of the risk is skipped');

// fills: trigger 100, limit 100.5
ok(PP.fillBuy(100, [0, 99, 101, 98, 100.5, 1]) === 100, 'buy-stop fills at the trigger when the price rises through it');
ok(PP.fillBuy(100, [0, 100.3, 101, 99, 100, 1]) === 100.3, 'gap open between trigger and limit fills at the open');
ok(PP.fillBuy(100, [0, 101, 103, 100.8, 102, 1]) === null, 'gap above the limit: no fill (no chasing)');
ok(PP.fillBuy(100, [0, 98, 99.9, 97, 99, 1]) === null, 'never reaches the trigger: no fill');

// trade management: entry 100, stop 95 (R 5), T1 110, T3 120
const pos = () => ({ s: 'Z', entry: 100, qty: 10, rem: 10, sl: 95, R0: 5, T1: 110, T3: 120, half: false, best: 100, days: 0 });
let p = pos(), x = PP.manageDay(p, [0, 96, 97, 94, 96, 1]);
ok(x.length === 1 && x[0].px === 95 && p.rem === 0, 'stop hit intraday → sold at the stop');
p = pos(); x = PP.manageDay(p, [0, 92, 93, 90, 91, 1]);
ok(x[0].px === 92, 'gap below the stop → sold at the open (worse than the stop)');
p = pos(); x = PP.manageDay(p, [0, 101, 111, 100, 109, 1]);
ok(x.length === 1 && x[0].qty === 5 && x[0].px === 110 && p.half && p.sl === 100, 'T1 → sell half at T1; stop moved to breakeven (+1R close)');
p = pos(); PP.manageDay(p, [0, 101, 106, 100.5, 105.5, 1]);
ok(p.sl === 100 && p.rem === 10, 'close above +1R → stop to breakeven, nothing sold');
p = pos(); x = PP.manageDay(p, [0, 101, 111, 94, 100, 1]);
ok(x[0].px === 95 && p.rem === 0, 'stop and target on the same bar → stop first (conservative)');
p = pos(); p.half = true; p.rem = 5; PP.manageDay(p, [0, 112, 113, 108, 108.5, 1], { e20: 109, lo5: 104 }); x = PP.manageDay(p, [0, 108, 109, 107, 108, 1], {});
ok(x.length && x[0].px === 108 && p.rem === 0, 'after T1: close below the 20 EMA → sold at the next open');
p = pos(); for (let i = 0; i < 15; i++) PP.manageDay(p, [0, 100, 101, 99, 100.5, 1], {}); x = PP.manageDay(p, [0, 100.2, 101, 99, 100, 1], {});
ok(x.length && /time stop/.test(x[0].why), 'time stop after 15 sessions without +1R');

// simengine: one order, a fill, a stop, costs taken from cash
const B = SE.newBook(100000); B.curve.push(['2026-01-01', 100000]);
B.pending = [{ s: 'Z', E: 100, SL: 95, T1: 110, T3: 120, q: 100, theme: 'X', setup: 'continuation', grade: 'A', conf: 70, regime: 'C' }];
SE.advance(B, '2026-01-02', { Z: [0, 99, 101, 99, 100.5, 1] }, { Z: { e20: 97, lo5: 98 } });
ok(B.open.length === 1 && B.open[0].entry === 100 && B.cash < 90000, 'order filled at the trigger, cash reduced by cost + charges');
SE.advance(B, '2026-01-05', { Z: [0, 99, 99.5, 94, 95, 1] }, { Z: { e20: 97, lo5: 94 } });
const t = B.closed[0];
ok(t && near(t.gross, -500) && t.net < -500 && t.R < -1, 'stopped out: gross −₹500 (−1R), net worse after charges (' + (t && t.net) + ', ' + (t && t.R) + 'R)');

// track.js: two evenings in a temp data folder
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trk-')); fs.mkdirSync(path.join(dir, 's'));
const day = d => Math.floor(Date.parse(d + 'T03:45:00Z') / 1000);
const hist = Array.from({ length: 60 }, (_, i) => [day('2026-01-01') + i * 86400, 90 + i * 0.1]);
const docZ = bars => ({ hist: hist.concat(bars.map(b => [b[0], b[4]])), ohlc: bars });
const planOf = (asOf, buy) => ({ asOf, market: { regime: { exposure: 50, cls: 'C' }, indices: [] }, buy });
const buyZ = { s: 'Z.NS', ind: 'Steel', sec: 'Basic Materials', setup: 'continuation', grade: 'A', conf: 70, plan: { E: 100, SL: 95, R: 5, T1: 110, T3: 120 } };
fs.writeFileSync(path.join(dir, 's', 'Z.NS.json'), JSON.stringify(docZ([[day('2026-03-02'), 98, 99, 97, 98.5, 1000]])));
fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(planOf('2026-03-02', [buyZ])));
const run = () => cp.execFileSync(process.execPath, [path.join(__dirname, 'track.js')], { env: { ...process.env, DATA_DIR: dir } }).toString();
run(); let T = JSON.parse(fs.readFileSync(path.join(dir, 'track.json')));
ok(T.pendingView.length === 1 && T.pendingView[0].q === 200, 'evening 1: order for Z, 200 shares (₹1,000 risk ÷ ₹5)');
fs.writeFileSync(path.join(dir, 's', 'Z.NS.json'), JSON.stringify(docZ([[day('2026-03-02'), 98, 99, 97, 98.5, 1000], [day('2026-03-03'), 99.5, 104, 99, 103, 1000]])));
fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(planOf('2026-03-03', [])));
run(); T = JSON.parse(fs.readFileSync(path.join(dir, 'track.json')));
ok(T.openView.length === 1 && T.openView[0].entry === 100 && T.asOf === '2026-03-03', 'evening 2: filled at ₹100 next session, position open');
run(); const T2 = JSON.parse(fs.readFileSync(path.join(dir, 'track.json')));
ok(T2.openView.length === 1 && T2.book.filled === 1 && T2.sum.filled === 1, 'running the same evening again does not double-count');
fs.rmSync(dir, { recursive: true, force: true });
if (fail) { console.log(fail + ' failed'); process.exit(1); } console.log('all simulation tests passed');
