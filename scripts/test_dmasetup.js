// Unit tests for dmasetup.js (DMA setups: Best / Strongest). Run: node scripts/test_dmasetup.js - also run by check.yml.
const assert = require('assert');
const { screenDmaSetups, smaSeries } = require(process.argv[2] || require('path').join(__dirname, '..', 'dmasetup.js'));
const day = i => new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10);
// build a series from a price function and a volume function
const mk = (n, price, vol = () => 1e6) => Array.from({ length: n }, (_, i) => ({ date: day(i), close: price(i), volume: vol(i, n) }));
const spike = (i, n) => (i === n - 1 ? 2e6 : 1e6);            // last day = 2x average
const asOf = day(400);
let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('ok  ', name); };

t('SMA matches a naive average', () => {
  const v = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 7) * 10 + i * 0.1), s = smaSeries(v, 50);
  for (const i of [49, 120, 299]) assert.ok(Math.abs(s[i] - v.slice(i - 49, i + 1).reduce((a, b) => a + b) / 50) < 1e-9);
  assert.strictEqual(s[48], null);
});

t('downtrend then sharp rise: recent golden cross + volume spike -> Best and Strongest', () => {
  // falls for 300 days, then rises steeply for 100 -> 50 DMA crosses above 200 DMA inside the last 60 sessions
  const r = screenDmaSetups(mk(400, i => (i < 320 ? 300 - i * 0.5 : 140 + (i - 320) * 3), spike), { asOf });
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.goldenCross.present, true, JSON.stringify(r.goldenCross));
  assert.ok(r.goldenCross.sessionsAgo < 60); assert.strictEqual(r.volume.ratio, 2);
  assert.deepStrictEqual(r.setups, { best: true, strongest: true });
});

t('cross 61 sessions ago is outside the 60-session window (boundary)', () => {
  const r = screenDmaSetups(mk(400, i => (i < 300 ? 300 - i * 0.5 : 150 + (i - 300) * 3), spike), { asOf });
  assert.strictEqual(r.goldenCross.present, false); assert.deepStrictEqual(r.setups, { best: true, strongest: false });
  const r2 = screenDmaSetups(mk(400, i => (i < 300 ? 300 - i * 0.5 : 150 + (i - 300) * 3), spike), { asOf, crossLookback: 62 });
  assert.strictEqual(r2.goldenCross.present, true); assert.strictEqual(r2.goldenCross.sessionsAgo, 61);
});

t('long-established uptrend (cross long ago) + spike -> Best only', () => {
  const r = screenDmaSetups(mk(400, i => 100 + i, spike), { asOf });
  assert.ok(r.ok); assert.strictEqual(r.goldenCross.present, false);
  assert.deepStrictEqual(r.setups, { best: true, strongest: false });
  assert.ok(r.notMet.some(s => /no golden cross/.test(s)));
});

t('uptrend without a volume spike -> neither', () => {
  const r = screenDmaSetups(mk(400, i => 100 + i), { asOf });
  assert.deepStrictEqual(r.setups, { best: false, strongest: false }); assert.strictEqual(r.volume.ratio, 1);
});

t('exactly 1.5x volume is not "> 1.5x"', () => {
  const r = screenDmaSetups(mk(400, i => 100 + i, (i, n) => (i === n - 1 ? 1.5e6 : 1e6)), { asOf });
  assert.strictEqual(r.conditions.volumeAboveMultiple, false);
});

t('recent death cross -> neither, reason names it', () => {
  const r = screenDmaSetups(mk(400, i => (i < 300 ? 100 + i : 400 - (i - 300) * 4), spike), { asOf });
  assert.deepStrictEqual(r.setups, { best: false, strongest: false });
  assert.ok(r.notMet.some(s => /crossed below/.test(s)) || r.goldenCross.lastCrossInWindow === null, JSON.stringify(r.notMet));
});

t('listed too recently -> INSUFFICIENT_HISTORY, no throw', () => {
  const r = screenDmaSetups(mk(150, i => 100 + i), { symbol: 'NEWIPO' });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.error, 'INSUFFICIENT_HISTORY'); assert.strictEqual(r.have, 150);
});

t('bad input -> BAD_INPUT; garbage rows dropped, duplicates collapsed, unsorted ok', () => {
  assert.strictEqual(screenDmaSetups(null).error, 'BAD_INPUT');
  const rows = mk(400, i => 100 + i, spike);
  const messy = [...rows].reverse().concat([{ date: 'not a date', close: 5 }, { date: day(10), close: null }, { date: day(5), close: -3 }, { ...rows[20] }]);
  const r = screenDmaSetups(messy, { asOf });
  assert.ok(r.ok); assert.strictEqual(r.data.dropped, 3); assert.strictEqual(r.data.sessions, 400);
  assert.deepStrictEqual(r.setups, { best: true, strongest: false });
  assert.ok(r.warnings.some(w => /duplicate/.test(w)));
});

t('missing volumes: too few valid days -> ratio null, setups false, warning', () => {
  const r = screenDmaSetups(mk(400, i => 100 + i, (i, n) => (i > n - 40 && i < n - 1 ? 0 : i === n - 1 ? 2e6 : 1e6)), { asOf });
  assert.strictEqual(r.volume.ratio, null); assert.strictEqual(r.setups.best, false); assert.ok(r.warnings.some(w => /valid days/.test(w)));
});

t('no volume for today -> not met, warning', () => {
  const r = screenDmaSetups(mk(400, i => 100 + i, (i, n) => (i === n - 1 ? null : 1e6)), { asOf });
  assert.strictEqual(r.setups.best, false); assert.ok(r.warnings.some(w => /No volume/.test(w)));
});

t('stale data warning; live price override; Unix-second dates', () => {
  const rows = mk(400, i => 100 + i, spike).map((r, i) => ({ ...r, date: Date.UTC(2025, 0, 1) / 1000 + i * 86400 }));
  const r = screenDmaSetups(rows, { asOf: '2027-01-01', livePrice: 1 });
  assert.ok(r.warnings.some(w => /days old/.test(w))); assert.strictEqual(r.priceSource, 'live'); assert.strictEqual(r.setups.best, false);
});

t('20-day volume lookback option', () => {
  const r = screenDmaSetups(mk(400, i => 100 + i, spike), { asOf, volLookback: 20 });
  assert.strictEqual(r.volume.lookbackDays, 20); assert.strictEqual(r.volume.ratio, 2);
});
console.log(pass + ' tests passed');
