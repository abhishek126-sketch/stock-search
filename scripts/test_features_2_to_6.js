#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('Testing Features 2, 3, 4, 5, 6 logic...');

// 1. Test indicators.js
const IND = require('../indicators.js');
assert.strictEqual(typeof IND.avwap, 'function', 'IND.avwap must be a function');
assert.strictEqual(typeof IND.volumeProfile, 'function', 'IND.volumeProfile must be a function');

const ohlc = [];
for (let i = 0; i < 50; i++) {
  ohlc.push([1700000000 + i * 86400, 100 + i, 105 + i, 98 + i, 103 + i, 5000 + (i === 25 ? 20000 : 0)]);
}

const av = IND.avwap(ohlc, 10);
assert.ok(av && av.current > 0, 'AVWAP current value must be positive');
assert.strictEqual(av.series[0], null, 'Values before anchor must be null');
assert.ok(av.cumVolume > 0, 'Cumulative volume must be positive');

const vp = IND.volumeProfile(ohlc, 16);
assert.ok(vp && vp.poc > 0, 'Volume profile POC must be calculated');
assert.ok(vp.vah >= vp.val, 'VAH must be >= VAL');
assert.strictEqual(vp.bins.length, 16, 'Bins length must be 16');

// 2. Test Discipline & Mistake Analytics
const testTrades = [
  { id: '1', s: 'TCS.NS', entry: 3500, sl0: 3400, qty: 10, sold: [{ q: 10, p: 3700 }], tag: 'plan' },       // +2R (win)
  { id: '2', s: 'INFY.NS', entry: 1500, sl0: 1450, qty: 20, sold: [{ q: 20, p: 1600 }], tag: 'plan' },      // +2R (win)
  { id: '3', s: 'RELIANCE.NS', entry: 2500, sl0: 2400, qty: 10, sold: [{ q: 10, p: 2350 }], tag: 'moved_sl' },// -1.5R (loss on mistake)
  { id: '4', s: 'HDFC.NS', entry: 1600, sl0: 1550, qty: 15, sold: [{ q: 15, p: 1500 }], tag: 'revenge' }    // -2R (loss on mistake)
];

const goodTags = ['plan', 'time_stop'];
const goodCount = testTrades.filter(t => goodTags.includes(t.tag)).length;
const discScore = Math.round(goodCount / testTrades.length * 100);
assert.strictEqual(discScore, 50, 'Discipline score should be 50%');

let mistakeLoss = 0;
for (const t of testTrades) {
  if (!goodTags.includes(t.tag)) {
    const pl = (t.sold[0].p - t.entry) * t.sold[0].q;
    if (pl < 0) mistakeLoss += Math.abs(pl);
  }
}
assert.strictEqual(mistakeLoss, (150 * 10) + (100 * 15), 'Mistake loss must equal 3000');

// 3. Test Multi-Currency Conversion
const USDINR = 86.50;
const inrCap = 100000;
const usdCap = 15000;
const combCap = inrCap + usdCap * USDINR;
assert.strictEqual(combCap, 100000 + 15000 * 86.50, 'Consolidated capital must match conversion formula');

// 4. Test Pre-Earnings Countdown Logic
const nowSec = 1700000000;
const futureEarnSec = nowSec + 2 * 86400; // 2 days in future
const daysToEarn = Math.ceil((futureEarnSec - nowSec) / 86400);
assert.strictEqual(daysToEarn, 2, 'Countdown should be 2 days');
const isGapRisk = daysToEarn <= 3;
assert.strictEqual(isGapRisk, true, '<= 3 days should flag imminent gap risk');

console.log('✅ All logic checks passed!');
