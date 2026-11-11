#!/usr/bin/env node
'use strict';
// Shared indicator definitions. Run: node scripts/test_indicators.js — also run by check.yml.
const assert = require('assert');
const I = require('../indicators.js');
const P = require('./planrules.js');
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('ok  ', name); };

t('SMA is the mean of the last n, and of an earlier window', () => {
  const v = [1, 2, 3, 4, 10];
  assert.strictEqual(I.sma(v, 3), 17 / 3);
  assert.strictEqual(I.sma(v, 3, 3), 2);
  assert.strictEqual(I.sma(v, 6), null);
  const s = I.smaSeries(v, 3);
  assert.strictEqual(s[1], null);
  assert.strictEqual(s[2], 2);
  assert.strictEqual(s[4], 17 / 3);
});

t('EMA starts at the SMA, then uses k = 2/(n+1)', () => {
  const v = Array.from({ length: 30 }, (_, i) => i + 1);
  const e = I.emaSeries(v, 10);
  assert.strictEqual(e[8], null);
  assert.strictEqual(e[9], I.sma(v, 10, 10));
  const k = 2 / 11;
  assert.ok(Math.abs(e[10] - (v[10] * k + e[9] * (1 - k))) < 1e-12);
  assert.strictEqual(I.ema(v, 10), e[29]);
  assert.strictEqual(P.emaS, I.emaSeries);
});

t('RSI is 100 on a one-way rise and matches the plan series', () => {
  const up = Array.from({ length: 20 }, (_, i) => 100 + i);
  assert.strictEqual(I.rsi(up), 100);
  assert.strictEqual(I.rsi([1, 2]), null);
  assert.deepStrictEqual(P.rsiS(up), I.rsiSeries(up));
});

t('ATR uses high, low and the previous close', () => {
  const bars = [[0, 10, 11, 9, 10, 1]];
  for (let i = 1; i <= 20; i++) bars.push([i, 10, 12, 8, 10, 1]); // true range 4 every bar
  assert.strictEqual(I.atr(bars, 14), 4);
  assert.strictEqual(I.atr(bars.slice(0, 10), 14), null);
  assert.strictEqual(P.atrW, I.atr);
});

t('MACD hist is the line minus its signal, both SMA-seeded', () => {
  const v = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 3 + i * 0.2);
  const m = I.macd(v);
  assert.ok(m.macd != null && m.signal != null);
  assert.ok(Math.abs(m.hist - (m.macd - m.signal)) < 1e-12);
  assert.strictEqual(I.macd([1, 2, 3]).macd, null);
});

t('relative strength ranks 1 to 99 inside each market, with half-even rounding', () => {
  assert.strictEqual(I.pyRound(0.5), 0);
  assert.strictEqual(I.pyRound(1.5), 2);
  assert.strictEqual(I.pyRound(2.5), 2);
  const rows = [
    { s: 'LOW.NS', r3m: 0, r6m: 0, r1y: 0, market: 'IN' },
    { s: 'MID.NS', r3m: 0.1, r6m: 0.1, r1y: 0.1, market: 'IN' },
    { s: 'HIGH.NS', r3m: 0.5, r6m: 0.5, r1y: 0.5, market: 'IN' },
    { s: 'AAPL', r3m: 0.2, market: 'US' },
  ];
  const r = I.rsRanks(rows);
  assert.strictEqual(r['LOW.NS'], 1);
  assert.strictEqual(r['HIGH.NS'], 99);
  assert.ok(r['MID.NS'] > 1 && r['MID.NS'] < 99);
  assert.strictEqual(r.AAPL, 1);
  assert.strictEqual(I.rsScore({ r3m: 0.1, r6m: null, r1y: 0.5 }), 0.4 * 0.1 + 0.2 * 0.1 + 0.4 * 0.5);
});

console.log(pass + ' passed');
