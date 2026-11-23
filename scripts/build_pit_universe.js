#!/usr/bin/env node
'use strict';
/**
 * Point-in-Time (PIT) Universe Ingestion Engine
 * Reconstructs the historical universe of actively trading NSE securities on any given date.
 * Prevents survivorship bias by including companies that were liquid and trading on date T,
 * even if they were subsequently delisted, merged, or collapsed in market capitalization.
 */

const fs = require('fs'), path = require('path');
const OUT = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PIT_CACHE = process.env.PIT_CACHE || path.join(OUT, 'pit');

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9'
};

const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
const ddmmyyyy = d => d.slice(8, 10) + d.slice(5, 7) + d.slice(0, 4);

async function fetchBhavcopy(dateStr, tries = 3) {
  const url = `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy(dateStr)}.csv`;
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      err = e;
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw err;
}

/**
 * Parses raw Bhavcopy CSV text into an array of trading records
 */
function parseBhavcopy(csvText, targetDate) {
  if (!csvText || !csvText.includes('SERIES')) return [];
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 50) return [];

  const headers = lines[0].split(',').map(s => s.trim().toUpperCase());
  const idx = k => headers.indexOf(k);

  const iSym = idx('SYMBOL'), iSrs = idx('SERIES');
  const iClose = idx('CLOSE_PRICE'), iPrev = idx('PREV_CLOSE');
  const iOpen = idx('OPEN_PRICE'), iHigh = idx('HIGH_PRICE'), iLow = idx('LOW_PRICE');
  const iQty = idx('TTL_TRD_QNTY'), iVal = idx('TTL_TRD_VAL');

  const records = [];
  const ALLOWED_SERIES = new Set(['EQ', 'BE', 'BZ', 'SM', 'ST']);

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(s => s.trim());
    const series = cols[iSrs];
    if (!ALLOWED_SERIES.has(series)) continue;

    const sym = cols[iSym];
    const close = parseFloat(cols[iClose]);
    const qty = parseInt(cols[iQty] || 0, 10);
    const val = parseFloat(cols[iVal] || 0);

    if (!sym || !(close > 0) || !(qty > 0)) continue;

    const turnover = val > 0 ? val : (qty * close);

    records.push({
      symbol: sym,
      ticker: sym + '.NS',
      date: targetDate,
      series,
      close,
      turnover,
      volume: qty
    });
  }

  return records;
}

/**
 * Retrieves Point-in-Time universe for a specific historical date.
 * If local cache exists, loads from disk; otherwise fetches from NSE archive if live network is enabled.
 */
function getPitUniverseSync(dateStr, minTurnover = 1e8, minPrice = 50) {
  const cacheFile = path.join(PIT_CACHE, `${dateStr}.json`);
  if (!fs.existsSync(cacheFile)) {
    return null; // Signals caller to fall back gracefully if archive file is not yet cached
  }

  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const filtered = raw.filter(r => r.turnover >= minTurnover && r.close >= minPrice);
    return {
      date: dateStr,
      totalTraded: raw.length,
      liquidCount: filtered.length,
      symbols: new Set(filtered.map(r => r.ticker)),
      records: new Map(filtered.map(r => [r.ticker, r]))
    };
  } catch (e) {
    console.warn(`Error reading PIT cache for ${dateStr}:`, e.message);
    return null;
  }
}

/**
 * Downloads and caches historical Bhavcopies for an array of trading dates
 */
async function buildPitCache(dateList, concurrency = 4) {
  fs.mkdirSync(PIT_CACHE, { recursive: true });
  console.log(`Building PIT Universe Cache for ${dateList.length} sessions...`);

  let completed = 0;
  let queue = [...dateList];

  async function worker() {
    while (queue.length > 0) {
      const d = queue.shift();
      const cacheFile = path.join(PIT_CACHE, `${d}.json`);
      if (fs.existsSync(cacheFile)) {
        completed++;
        continue;
      }

      try {
        const csv = await fetchBhavcopy(d);
        if (csv) {
          const parsed = parseBhavcopy(csv, d);
          if (parsed.length > 100) {
            fs.writeFileSync(cacheFile, JSON.stringify(parsed));
          }
        }
      } catch (e) {
        console.warn(`Failed PIT fetch for ${d}: ${e.message}`);
      }
      completed++;
      if (completed % 25 === 0) {
        console.log(`PIT Cache progress: ${completed}/${dateList.length}`);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  console.log('PIT Universe Cache build complete.');
}

module.exports = {
  fetchBhavcopy,
  parseBhavcopy,
  getPitUniverseSync,
  buildPitCache,
  PIT_CACHE
};
