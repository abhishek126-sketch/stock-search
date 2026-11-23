#!/usr/bin/env node
'use strict';
/**
 * Pre-Publish Data Validation Engine
 * Runs before publish.sh to prevent publishing corrupt, partial, or malformed data snapshots.
 * Exits with code 0 if all validation rules pass, or code 1 on critical violations.
 */
const fs = require('fs'), path = require('path');
const OUT = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

const ERRORS = [];
const WARNINGS = [];

function checkFile(name, minBytes = 1000) {
  const p = path.join(OUT, name);
  if (!fs.existsSync(p)) {
    ERRORS.push(`Missing mandatory data file: ${name}`);
    return null;
  }
  const stat = fs.statSync(p);
  if (stat.size < minBytes) {
    ERRORS.push(`File ${name} is suspiciously small: ${stat.size} bytes (min: ${minBytes})`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    ERRORS.push(`File ${name} failed to parse as valid JSON: ${e.message}`);
    return null;
  }
}

function validate() {
  console.log('Running Pre-Publish Data Validation Engine...');

  // 1. Check core files
  const summary = checkFile('summary.json', 500000);
  const index = checkFile('index.json', 50000);
  const quotes = checkFile('quotes.json', 40000);
  const plan = checkFile('plan.json', 10000);
  const swing = checkFile('swing.json', 10000);

  if (!summary || !summary.rows) {
    console.error('FATAL: summary.json is unreadable or missing rows array.');
    process.exit(1);
  }

  // 2. Universe count verification
  const rows = summary.rows;
  console.log(`Checking summary.json: ${rows.length} total symbols loaded.`);
  if (rows.length < 3500) {
    ERRORS.push(`Symbol count dropped below safety threshold: ${rows.length} (expected >= 3500)`);
  }

  // 3. Price and field sanity checks
  let invalidPrices = 0, zeroPrices = 0;
  for (const r of rows) {
    if (r.p == null || !Number.isFinite(r.p)) {
      invalidPrices++;
    } else if (r.p <= 0) {
      zeroPrices++;
    }
  }
  if (invalidPrices > 50) {
    ERRORS.push(`Too many symbols with non-numeric prices: ${invalidPrices}`);
  }
  if (zeroPrices > 20) {
    WARNINGS.push(`Found ${zeroPrices} symbols with non-positive prices.`);
  }

  // 4. Sample OHLC integrity check on individual stock files
  const sampleSymbols = rows.slice(0, 100).map(r => r.s);
  let checkedOhlc = 0, ohlcViolations = 0;
  for (const sym of sampleSymbols) {
    const sp = path.join(OUT, 's', sym + '.json');
    if (!fs.existsSync(sp)) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(sp, 'utf8'));
      const bars = doc.ohlc || [];
      for (const b of bars.slice(-10)) {
        checkedOhlc++;
        const [t, o, h, l, c] = b;
        if (l > Math.min(o, c) + 1e-4 || h < Math.max(o, c) - 1e-4 || l > h) {
          ohlcViolations++;
        }
      }
    } catch { }
  }
  console.log(`Checked ${checkedOhlc} OHLC bars across sample symbols. Violations: ${ohlcViolations}`);
  if (ohlcViolations > 5) {
    ERRORS.push(`Detected geometric OHLC bar violations in sample: ${ohlcViolations}`);
  }

  // 5. Plan sanity check
  if (plan) {
    if (!plan.market || !plan.market.regime) {
      WARNINGS.push('plan.json is missing market regime classification.');
    }
  }

  // 6. Write validation summary
  const report = {
    timestamp: Math.floor(Date.now() / 1000),
    asOf: new Date().toISOString(),
    status: ERRORS.length === 0 ? 'PASSED' : 'FAILED',
    symbols: rows.length,
    errors: ERRORS,
    warnings: WARNINGS
  };

  const valPath = path.join(OUT, 'validation.json');
  try {
    fs.writeFileSync(valPath, JSON.stringify(report, null, 2));
  } catch (e) {
    console.warn('Could not write validation.json:', e.message);
  }

  if (ERRORS.length > 0) {
    console.error('Validation FAILED with critical errors:');
    ERRORS.forEach(e => console.error('  ❌', e));
    process.exit(1);
  }

  console.log('Validation PASSED successfully.');
  if (WARNINGS.length > 0) {
    WARNINGS.forEach(w => console.warn('  ⚠️', w));
  }
}

if (require.main === module) {
  validate();
}

module.exports = { validate };
